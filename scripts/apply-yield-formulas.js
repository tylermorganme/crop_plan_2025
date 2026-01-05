#!/usr/bin/env node
/**
 * Apply yield formula shim data to crops.json
 *
 * Reads tmp/yield-formulas.json and updates src/data/crops.json
 * by adding yieldFormula to each matching config.
 *
 * Usage:
 *   node scripts/apply-yield-formulas.js
 *   node scripts/apply-yield-formulas.js --dry-run
 */

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

// Read shim data
const shimPath = path.join(__dirname, '..', 'tmp', 'yield-formulas.json');
const shimData = JSON.parse(fs.readFileSync(shimPath, 'utf8'));

// Read crops.json
const cropsPath = path.join(__dirname, '..', 'src', 'data', 'crops.json');
const cropsData = JSON.parse(fs.readFileSync(cropsPath, 'utf8'));
const crops = cropsData.crops;

let matched = 0;
let unmatched = 0;
let alreadyHasFormula = 0;

// Normalize identifier for matching (strip trailing spaces)
const normalizeId = (id) => id ? id.trim() : id;

// Build normalized shim lookup
const normalizedShim = {};
for (const [key, value] of Object.entries(shimData)) {
  normalizedShim[normalizeId(key)] = value;
}

// Apply formulas
for (const crop of crops) {
  const shim = normalizedShim[normalizeId(crop.identifier)];

  if (!shim) {
    unmatched++;
    continue;
  }

  if (crop.yieldFormula) {
    alreadyHasFormula++;
    continue;
  }

  crop.yieldFormula = shim.yieldFormula;

  // Remove legacy yieldPerHarvest if we have a formula
  if (crop.yieldPerHarvest !== undefined) {
    delete crop.yieldPerHarvest;
  }

  matched++;
}

console.log('='.repeat(60));
console.log('APPLY YIELD FORMULAS');
console.log('='.repeat(60));
console.log();
console.log(`Total crops: ${crops.length}`);
console.log(`Matched & updated: ${matched}`);
console.log(`Already had formula: ${alreadyHasFormula}`);
console.log(`No shim data: ${unmatched}`);
console.log();

if (DRY_RUN) {
  console.log('DRY RUN - no changes written');
  console.log();
  console.log('Sample updates:');
  let count = 0;
  for (const crop of crops) {
    if (crop.yieldFormula && count < 5) {
      console.log(`  ${crop.identifier}`);
      console.log(`    yieldFormula: ${crop.yieldFormula}`);
      count++;
    }
  }
} else {
  // Write updated crops.json
  fs.writeFileSync(cropsPath, JSON.stringify(cropsData, null, 2) + '\n');
  console.log(`Updated ${cropsPath}`);
}
