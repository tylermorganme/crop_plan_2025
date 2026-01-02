/**
 * Build minimal crops.json from the full Excel export.
 *
 * Based on notes from DAG reconciliation:
 * - Tray Size -> cellsPerTray (better name for tray size enum)
 * - Category should eventually be product-level (for now keep on config)
 * - Normal Method describes what DTM means: DS (from direct seed), TP (from transplant), X (total time)
 * - Variety might be better named "variant" to not conflate with actual crop varieties
 *
 * DATA FIXES APPLIED (audit trail):
 * See DATA_FIXES below for specific corrections made during import.
 */

const fs = require('fs');
const crops = JSON.parse(fs.readFileSync('./crops.json.old', 'utf8')).crops;

// =============================================================================
// DATA FIXES - Corrections applied during import with explanations
// =============================================================================
const DATA_FIXES = {
  // Duplicate ID: Two Tokyo Turnip configs got the same hash ID but have different DTM values.
  // Keep DTM=40 (Spring), skip DTM=50 (appears to be a duplicate entry).
  // The remaining configs are: DS Sp (DTM 40), DS SuFa (DTM 40)
  // NOTE: Fixed in Excel as of 2025-12-31, can remove this fix after re-import
  SKIP_DUPLICATE_TURNIP: {
    id: 'crop_ad95c1f7',
    dtmToSkip: 50,
    reason: 'Duplicate ID - two Tokyo Turnip configs got same hash. Keeping DTM=40, skipping DTM=50.',
  },
  // NOTE: Perennials fixed in Excel as of 2025-12-31 - Dropmore and Lovage now have PE planting method
};

// Track seen IDs to detect duplicates
const seenIds = new Set();
const skippedCrops = [];

// Build crops with cleaner structure
const cleanCrops = crops.map((c) => {
  // FIX: Skip duplicate Tokyo Turnip entry (see DATA_FIXES.SKIP_DUPLICATE_TURNIP)
  if (c.id === DATA_FIXES.SKIP_DUPLICATE_TURNIP.id && c.DTM === DATA_FIXES.SKIP_DUPLICATE_TURNIP.dtmToSkip) {
    skippedCrops.push({ identifier: c.Identifier, reason: DATA_FIXES.SKIP_DUPLICATE_TURNIP.reason });
    return null; // Will be filtered out
  }

  // Detect any other duplicate IDs (should not happen after fixes)
  let id = c.id;
  if (seenIds.has(id)) {
    console.warn(`WARNING: Unexpected duplicate ID: ${c.id} (${c.Identifier}) - this should be added to DATA_FIXES`);
    return null;
  }
  seenIds.add(id);

  // Check if this is a perennial (Planting Method = PE)
  const isPerennial = c['Planting Method'] === 'PE';

  // Extract targetFieldDate as MM-DD from ISO date like "2025-04-01T00:00:00"
  const rawTargetDate = c['Target Field Date'];
  const targetFieldDate = rawTargetDate && typeof rawTargetDate === 'string'
    ? rawTargetDate.slice(5, 10)  // "04-01"
    : undefined;

  const crop = {
    id,
    identifier: c.Identifier,
    crop: c.Crop,
    // "variant" might be better than "variety" per notes, but keeping for now
    variant: c.Variety !== 'General' ? c.Variety : undefined,
    product: c.Product,
    // Category should eventually be product-level
    category: c.Category || undefined,
    growingStructure: c['Growing Structure'] || 'Field',
    // normalMethod describes what DTM means, not how it's planted
    normalMethod: c['Normal Method'] || 'X',
    dtm: c.DTM,
    daysToGermination: c['Days to Germination'] || undefined,
    deprecated: c.Deprecated || false,
    // Perennial flag for crops that don't fit DS/TP model
    perennial: isPerennial || undefined,

    // Harvest/yield data - these are the normalized inputs
    // Frontend can offer different input modes that convert to this format
    daysBetweenHarvest: c['Days Between Harvest'] || undefined,
    numberOfHarvests: c['Harvests'] || undefined,
    harvestBufferDays: 7, // Default buffer for harvest window (how long crop is harvestable)
    yieldPerHarvest: c['Units Per Harvest'] || undefined,
    yieldUnit: c['Unit'] || undefined,

    // Scheduling - target field date for default planting schedule
    targetFieldDate,
  };

  // Detect postHarvestFieldDays from harvest window formula overrides
  // Only applies to multi-harvest crops where Excel formula has extra days added
  // Example: Dahlia (Tuber) formula is (harvests-1)*dbh+35 instead of +7, meaning 28 post-harvest days
  const dbh = c['Days Between Harvest'] ?? 0;
  const harvests = c['Harvests'] ?? 1;
  const storedHW = c['Harvest window'];
  if (storedHW != null && harvests > 1 && dbh > 0) {
    const formulaHW = (harvests - 1) * dbh + 7;
    const diff = storedHW - formulaHW;
    if (diff > 0) {
      // Extra days beyond formula = postHarvestFieldDays (bed occupied after last harvest)
      crop.postHarvestFieldDays = diff;
    }
    // Note: diff < 0 or diff = 0 means Excel has an error or matches formula - use formula
  }
  // Single-harvest crops and crops with dbh=0: any Excel override is likely an error
  // Let the formula calculate correctly (7-day buffer)

  // Build tray stages array - each stage has days and cellsPerTray
  const trayStages = [];
  if (c['Tray 1 Days']) {
    const stage = { days: c['Tray 1 Days'] };
    if (c['Tray 1 Size']) stage.cellsPerTray = c['Tray 1 Size'];
    trayStages.push(stage);
  }
  if (c['Tray 2 Days']) {
    const stage = { days: c['Tray 2 Days'] };
    if (c['Tray 2 Size']) stage.cellsPerTray = c['Tray 2 Size'];
    trayStages.push(stage);
  }
  if (c['Tray 3 Days']) {
    const stage = { days: c['Tray 3 Days'] };
    if (c['Tray 3 Size']) stage.cellsPerTray = c['Tray 3 Size'];
    trayStages.push(stage);
  }
  if (trayStages.length > 0) {
    crop.trayStages = trayStages;
  }

  // Remove undefined values for cleaner JSON
  Object.keys(crop).forEach(k => {
    if (crop[k] === undefined) delete crop[k];
  });

  return crop;
}).filter(c => c !== null); // Remove skipped crops

fs.writeFileSync('./crops.json', JSON.stringify({ crops: cleanCrops }, null, 2));

console.log('Created crops.json with', cleanCrops.length, 'crops');

// Report skipped crops
if (skippedCrops.length > 0) {
  console.log('\nSkipped crops (data fixes applied):');
  skippedCrops.forEach(s => console.log(`  - ${s.identifier}: ${s.reason}`));
}

console.log('\nSample transplanted crop (with tray stages):');
const sample = cleanCrops.find(c => c.trayStages && c.trayStages.length > 1);
console.log(JSON.stringify(sample, null, 2));

console.log('\nSample direct-seeded crop (no tray stages):');
const dsCrop = cleanCrops.find(c => !c.trayStages);
console.log(JSON.stringify(dsCrop, null, 2));
