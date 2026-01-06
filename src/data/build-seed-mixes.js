#!/usr/bin/env node
/**
 * Build seed-mixes.json from extracted Excel data.
 *
 * Reads: tmp/seed_mixes_from_excel.json
 *        src/data/varieties.json (for variety ID lookup)
 * Writes: src/data/seed-mixes.json
 *
 * Transforms raw Excel seed mix data into the app's SeedMix format,
 * linking components to variety IDs where possible.
 *
 * Usage:
 *   node src/data/build-seed-mixes.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Paths
const inputPath = path.join(__dirname, '..', '..', 'tmp', 'seed_mixes_from_excel.json');
const varietiesPath = path.join(__dirname, 'varieties.json');
const outputPath = path.join(__dirname, 'seed-mixes.json');

// Generate a stable ID from mix data
function generateMixId(mix) {
  const key = `${mix.name}|${mix.crop}`.toLowerCase();
  const hash = crypto.createHash('md5').update(key).digest('hex').slice(0, 12);
  return `SM_${hash}`;
}

// Generate a variety ID (must match build-varieties.js algorithm)
function generateVarietyId(crop, name, supplier) {
  const key = `${crop}|${name}|${supplier}`.toLowerCase();
  const hash = crypto.createHash('md5').update(key).digest('hex').slice(0, 12);
  return `V_${hash}`;
}

// Normalize crop name
function normalizeCropName(name) {
  if (!name) return '';
  return name.trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// Read input
console.log('Reading extracted seed mix data...');
if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  console.error('Run: python scripts/extract-seed-mixes.py');
  process.exit(1);
}

const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const rawMixes = rawData.seedMixes || [];

// Load varieties for ID lookup
let varietyLookup = {};
if (fs.existsSync(varietiesPath)) {
  console.log('Loading varieties for ID lookup...');
  const varietyData = JSON.parse(fs.readFileSync(varietiesPath, 'utf8'));
  for (const v of varietyData.varieties || []) {
    // Key by crop+name+supplier for lookup
    const key = `${v.crop}|${v.name}|${v.supplier}`.toLowerCase();
    varietyLookup[key] = v.id;
  }
  console.log(`Loaded ${Object.keys(varietyLookup).length} variety references`);
} else {
  console.warn('varieties.json not found - run build-varieties.js first');
  console.warn('Generating variety IDs without validation');
}

console.log(`Processing ${rawMixes.length} seed mixes...`);

// Transform to app format
const seedMixes = [];
const seenIds = new Set();
let matchedComponents = 0;
let unmatchedComponents = 0;

for (const raw of rawMixes) {
  // Skip mixes without name
  if (!raw.name) continue;

  const crop = normalizeCropName(raw.crop || '');

  const mix = {
    id: generateMixId({ name: raw.name, crop }),
    name: raw.name.trim(),
    crop: crop,
    components: [],
  };

  // Process components
  for (const comp of raw.components || []) {
    const varietyName = (comp.variety || '').trim();
    const supplier = (comp.supplier || '').trim();

    // Try to find matching variety ID
    const lookupKey = `${crop}|${varietyName}|${supplier}`.toLowerCase();
    let varietyId = varietyLookup[lookupKey];

    if (!varietyId) {
      // Generate an ID even if variety doesn't exist in catalog
      varietyId = generateVarietyId(crop, varietyName, supplier);
      unmatchedComponents++;
    } else {
      matchedComponents++;
    }

    // Normalize percent (ensure it's a decimal between 0-1)
    let percent = comp.percent || 0;
    if (percent > 1) {
      // Assume it's a percentage like 33.3 instead of 0.333
      percent = percent / 100;
    }

    mix.components.push({
      varietyId,
      percent,
      // Store variety info for reference (not used by app, but helpful for debugging)
      _variety: varietyName,
      _supplier: supplier,
    });
  }

  // Handle duplicate IDs
  if (seenIds.has(mix.id)) {
    console.warn(`Duplicate mix: ${mix.name} (${mix.crop})`);
    continue;
  }
  seenIds.add(mix.id);

  seedMixes.push(mix);
}

console.log(`Processed ${seedMixes.length} unique seed mixes`);
console.log(`Component variety matches: ${matchedComponents}/${matchedComponents + unmatchedComponents}`);

// Sort by crop, then name
seedMixes.sort((a, b) => {
  const cropCmp = a.crop.localeCompare(b.crop);
  if (cropCmp !== 0) return cropCmp;
  return a.name.localeCompare(b.name);
});

// Output structure
const output = {
  _generated: new Date().toISOString(),
  _source: 'tmp/seed_mixes_from_excel.json',
  seedMixes: seedMixes,
};

// Write output
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote ${outputPath}`);

// Stats
const crops = new Set(seedMixes.map(m => m.crop));
const avgComponents = seedMixes.length > 0
  ? seedMixes.reduce((sum, m) => sum + m.components.length, 0) / seedMixes.length
  : 0;

console.log('\n--- Statistics ---');
console.log(`Total seed mixes: ${seedMixes.length}`);
console.log(`Unique crops: ${crops.size}`);
console.log(`Avg components per mix: ${avgComponents.toFixed(1)}`);
