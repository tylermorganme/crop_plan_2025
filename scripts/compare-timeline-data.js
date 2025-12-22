/**
 * Compare timeline crop data generated from:
 * 1. Raw crops.json (current approach - uses Target dates directly)
 * 2. Normalized data (computes dates from DTM/STH values)
 *
 * This helps identify mismatches where the normalized approach
 * might calculate different (possibly more correct) dates.
 */

const rawCrops = require('../crop-api/src/data/crops.json');
const normalized = require('../crop-api/src/data/normalized.json');
const bedPlan = require('../crop-api/src/data/bed-plan.json');

// ============================================================================
// Approach 1: Raw data (current timeline implementation)
// Uses Target Sewing Date and Target End of Harvest directly
// ============================================================================

function getTimelineCropsFromRaw() {
  const crops = rawCrops.crops.filter(c =>
    c['In Plan'] === true &&
    c['Target Sewing Date'] &&
    c['Target End of Harvest']
  );

  return crops.map(crop => {
    const name = crop.Product && crop.Product !== 'General'
      ? `${crop.Crop} (${crop.Product})`
      : crop.Crop;

    return {
      id: crop.id,
      identifier: crop.Identifier,
      name,
      category: crop.Category,
      startDate: crop['Target Sewing Date'],
      endDate: crop['Target End of Harvest'],
      beds: crop.Beds || 1,
      // Raw date fields for comparison
      targetSewingDate: crop['Target Sewing Date'],
      targetFieldDate: crop['Target Field Date'],
      targetHarvestDate: crop['Target Harvest Data'],
      targetEndOfHarvest: crop['Target End of Harvest'],
      // Timing fields
      dtm: crop.DTM,
      sth: crop.STH,
      daysInField: crop['Days In Field'],
      daysInCells: crop['Days in Cells'],
      harvestWindow: crop['Harvest window'],
    };
  });
}

// ============================================================================
// Approach 2: Normalized data (compute dates from DTM/STH)
// Uses normalized plantingConfigs and computes dates
// ============================================================================

function getTimelineCropsFromNormalized() {
  // We need to match raw crops to plantingConfigs
  // The raw crop's "Identifier" should match plantingConfig's "quickDescription"

  const crops = rawCrops.crops.filter(c =>
    c['In Plan'] === true &&
    c['Target Sewing Date'] // Need at least a start date to compute from
  );

  const configsByQuickDesc = {};
  for (const config of Object.values(normalized.plantingConfigs)) {
    configsByQuickDesc[config.quickDescription] = config;
  }

  return crops.map(crop => {
    const config = configsByQuickDesc[crop.Identifier];

    const name = crop.Product && crop.Product !== 'General'
      ? `${crop.Crop} (${crop.Product})`
      : crop.Crop;

    // Parse the sewing date
    const sewingDate = new Date(crop['Target Sewing Date']);

    // Compute dates using normalized DTM/STH values
    let computedEndDate = null;
    let computedHarvestStart = null;

    if (config) {
      // Use normalized STH (seed to harvest) for first harvest
      const sth = config.sth || config.dtm || crop.STH || crop.DTM;
      const daysInField = config.daysInField || crop['Days In Field'];

      if (sth) {
        computedHarvestStart = new Date(sewingDate);
        computedHarvestStart.setDate(computedHarvestStart.getDate() + sth);
      }

      if (daysInField) {
        computedEndDate = new Date(sewingDate);
        computedEndDate.setDate(computedEndDate.getDate() + daysInField);
      } else if (sth && crop['Harvest window']) {
        // Fallback: STH + harvest window
        computedEndDate = new Date(sewingDate);
        computedEndDate.setDate(computedEndDate.getDate() + sth + crop['Harvest window']);
      }
    }

    return {
      id: crop.id,
      identifier: crop.Identifier,
      name,
      category: crop.Category,
      startDate: crop['Target Sewing Date'],
      endDate: computedEndDate ? computedEndDate.toISOString() : null,
      beds: crop.Beds || 1,
      // Computed values
      computedHarvestStart: computedHarvestStart?.toISOString(),
      computedEndDate: computedEndDate?.toISOString(),
      // Config values used
      configSth: config?.sth,
      configDtm: config?.dtm,
      configDaysInField: config?.daysInField,
      // Raw values for comparison
      rawSth: crop.STH,
      rawDtm: crop.DTM,
      rawDaysInField: crop['Days In Field'],
      rawHarvestWindow: crop['Harvest window'],
      hasConfig: !!config,
    };
  });
}

// ============================================================================
// Compare the two approaches
// ============================================================================

function formatDate(dateStr) {
  if (!dateStr) return 'null';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysDiff(date1, date2) {
  if (!date1 || !date2) return null;
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function compare() {
  const rawCrops = getTimelineCropsFromRaw();
  const normalizedCrops = getTimelineCropsFromNormalized();

  console.log('='.repeat(80));
  console.log('TIMELINE DATA COMPARISON: Raw vs Normalized');
  console.log('='.repeat(80));
  console.log(`\nTotal "In Plan" crops: ${rawCrops.length}`);
  console.log(`Crops with normalized config: ${normalizedCrops.filter(c => c.hasConfig).length}`);
  console.log('\n');

  const mismatches = [];
  const noConfig = [];
  const matches = [];

  for (let i = 0; i < rawCrops.length; i++) {
    const raw = rawCrops[i];
    const norm = normalizedCrops[i];

    if (!norm.hasConfig) {
      noConfig.push({ raw, norm });
      continue;
    }

    const rawEndDate = formatDate(raw.endDate);
    const normEndDate = formatDate(norm.computedEndDate);
    const diff = daysDiff(norm.computedEndDate, raw.endDate);

    if (diff !== null && Math.abs(diff) > 0) {
      mismatches.push({
        raw,
        norm,
        diff,
        rawEndDate,
        normEndDate,
      });
    } else {
      matches.push({ raw, norm });
    }
  }

  // Report mismatches
  console.log('-'.repeat(80));
  console.log(`DATE MISMATCHES (${mismatches.length} found)`);
  console.log('-'.repeat(80));

  // Sort by diff magnitude
  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  for (const m of mismatches) {
    console.log(`\n${m.raw.name} [${m.raw.identifier}]`);
    console.log(`  Start Date:    ${formatDate(m.raw.startDate)}`);
    console.log(`  Raw End:       ${m.rawEndDate} (from spreadsheet)`);
    console.log(`  Computed End:  ${m.normEndDate} (from DTM/STH calculation)`);
    console.log(`  DIFFERENCE:    ${m.diff > 0 ? '+' : ''}${m.diff} days`);
    console.log(`  ---`);
    console.log(`  Raw values:    DTM=${m.raw.dtm}, STH=${m.raw.sth}, DaysInField=${m.raw.daysInField}, HarvestWindow=${m.raw.harvestWindow}`);
    console.log(`  Config values: DTM=${m.norm.configDtm}, STH=${m.norm.configSth}, DaysInField=${m.norm.configDaysInField}`);
  }

  // Report no config matches
  if (noConfig.length > 0) {
    console.log('\n' + '-'.repeat(80));
    console.log(`CROPS WITHOUT NORMALIZED CONFIG (${noConfig.length})`);
    console.log('-'.repeat(80));
    for (const m of noConfig) {
      console.log(`  - ${m.raw.name} [${m.raw.identifier}]`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`  Exact matches:    ${matches.length}`);
  console.log(`  Mismatches:       ${mismatches.length}`);
  console.log(`  No config found:  ${noConfig.length}`);

  if (mismatches.length > 0) {
    const avgDiff = mismatches.reduce((sum, m) => sum + Math.abs(m.diff), 0) / mismatches.length;
    console.log(`  Avg mismatch:     ${avgDiff.toFixed(1)} days`);
    console.log(`  Max mismatch:     ${Math.max(...mismatches.map(m => Math.abs(m.diff)))} days`);
  }

  // Group mismatches by type
  if (mismatches.length > 0) {
    console.log('\n' + '-'.repeat(80));
    console.log('MISMATCH ANALYSIS');
    console.log('-'.repeat(80));

    const positive = mismatches.filter(m => m.diff > 0);
    const negative = mismatches.filter(m => m.diff < 0);

    console.log(`\n  Raw end date LATER than computed: ${positive.length} crops`);
    console.log(`    (spreadsheet shows longer duration than calculated)`);
    console.log(`  Raw end date EARLIER than computed: ${negative.length} crops`);
    console.log(`    (spreadsheet shows shorter duration than calculated)`);
  }

  return { matches, mismatches, noConfig };
}

// Run comparison
compare();
