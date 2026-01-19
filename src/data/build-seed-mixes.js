#!/usr/bin/env node
/**
 * Build seed-mixes-template.json from extracted Excel data.
 *
 * Reads: tmp/seed_mixes_from_excel.json
 * Writes: src/data/seed-mixes-template.json
 *
 * Transforms raw Excel seed mix data into CreateSeedMixInput format (no IDs).
 * Components store variety content keys that get resolved to IDs at import time.
 *
 * Usage:
 *   node src/data/build-seed-mixes.js
 */

const fs = require('fs');
const path = require('path');
const { normalizeCropName } = require('./crop-name-mapping');

// Paths
const inputPath = path.join(__dirname, '..', '..', 'tmp', 'seed_mixes_from_excel.json');
const outputPath = path.join(__dirname, 'seed-mixes-template.json');

// Generate a content key for deduplication (matches seed-mix.ts getSeedMixContentKey)
function getMixContentKey(name, crop) {
  return `${name}|${crop}`.toLowerCase().trim();
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

console.log(`Processing ${rawMixes.length} seed mixes...`);

// Transform to CreateSeedMixInput format (no id field - store generates IDs)
// Components use _varietyRef for resolution at import time
const seedMixes = [];
const seenKeys = new Set();

for (const raw of rawMixes) {
  // Skip mixes without name
  if (!raw.name) continue;

  const crop = normalizeCropName(raw.crop || '');
  const name = raw.name.trim();

  // CreateSeedMixInput format - no id field
  const mix = {
    name,
    crop,
    components: [],
  };

  // Process components - store variety reference info for resolution at import
  for (const comp of raw.components || []) {
    const varietyName = (comp.variety || '').trim();
    const supplier = (comp.supplier || '').trim();

    // Normalize percent (ensure it's a decimal between 0-1)
    let percent = comp.percent || 0;
    if (percent > 1) {
      // Assume it's a percentage like 33.3 instead of 0.333
      percent = percent / 100;
    }

    // Store variety reference for resolution at import time
    // The store will look up the variety by content and substitute the actual ID
    mix.components.push({
      percent,
      // These are used by import to find the variety ID
      _varietyCrop: crop,
      _varietyName: varietyName,
      _varietySupplier: supplier,
    });
  }

  // Handle duplicates (same name+crop)
  const contentKey = getMixContentKey(name, crop);
  if (seenKeys.has(contentKey)) {
    console.warn(`Duplicate mix: ${name} (${crop})`);
    continue;
  }
  seenKeys.add(contentKey);

  seedMixes.push(mix);
}

console.log(`Processed ${seedMixes.length} unique seed mixes`);

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
