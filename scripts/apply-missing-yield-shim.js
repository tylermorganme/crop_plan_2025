#!/usr/bin/env node
/**
 * Apply missing yield formula shim data to crops.json
 *
 * Reads tmp/missing-yield-shim.json and updates src/data/crops.json
 * by adding yieldFormula to each matching config that doesn't already have one.
 *
 * Usage:
 *   node scripts/apply-missing-yield-shim.js
 *   node scripts/apply-missing-yield-shim.js --dry-run
 */

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

// Read shim data
const shimPath = path.join(__dirname, '..', 'tmp', 'missing-yield-shim.json');
const shimData = JSON.parse(fs.readFileSync(shimPath, 'utf8'));

// Read crops.json
const cropsPath = path.join(__dirname, '..', 'src', 'data', 'crops.json');
const cropsData = JSON.parse(fs.readFileSync(cropsPath, 'utf8'));
const crops = cropsData.crops;

let matched = 0;
let unmatched = 0;
let alreadyHasFormula = 0;
const unmatchedIds = [];

// Normalize identifier for matching (strip trailing spaces)
const normalizeId = (id) => id ? id.trim() : id;

// Build normalized shim lookup
const normalizedShim = {};
for (const [key, value] of Object.entries(shimData)) {
  normalizedShim[normalizeId(key)] = value;
}

// Track which shim entries were used
const usedShimKeys = new Set();

// Apply formulas
for (const crop of crops) {
  const normalizedCropId = normalizeId(crop.identifier);
  const shim = normalizedShim[normalizedCropId];

  if (!shim) {
    continue; // Not in our missing list
  }

  usedShimKeys.add(normalizedCropId);

  if (crop.yieldFormula) {
    alreadyHasFormula++;
    console.log(`  SKIP (has formula): ${crop.identifier}`);
    continue;
  }

  crop.yieldFormula = shim.yieldFormula;
  matched++;
  console.log(`  ADD: ${crop.identifier} → ${shim.yieldFormula}`);
}

// Check for shim entries that didn't match any crop
for (const key of Object.keys(normalizedShim)) {
  if (!usedShimKeys.has(normalizeId(key))) {
    unmatchedIds.push(key);
    unmatched++;
  }
}

console.log();
console.log('='.repeat(60));
console.log('APPLY MISSING YIELD SHIM');
console.log('='.repeat(60));
console.log();
console.log(`Shim entries: ${Object.keys(shimData).length}`);
console.log(`Matched & updated: ${matched}`);
console.log(`Already had formula: ${alreadyHasFormula}`);
console.log(`Unmatched shim entries: ${unmatched}`);

if (unmatchedIds.length > 0) {
  console.log();
  console.log('Unmatched shim identifiers:');
  for (const id of unmatchedIds) {
    console.log(`  - "${id}"`);
  }
}

console.log();

if (DRY_RUN) {
  console.log('DRY RUN - no changes written');
} else {
  // Write updated crops.json
  fs.writeFileSync(cropsPath, JSON.stringify(cropsData, null, 2) + '\n');
  console.log(`Updated ${cropsPath}`);
}
