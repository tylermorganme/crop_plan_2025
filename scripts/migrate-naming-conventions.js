#!/usr/bin/env node
/**
 * Migrate crops.json to use new naming conventions.
 *
 * Changes:
 * - yieldFormula: PPB → plantingsPerBed, DBH → daysBetweenHarvest
 * - normalMethod: DS → from-seeding, TP → from-transplant, X → total-time
 * - growingStructure: Field → field, Greenhouse → greenhouse, Tunnel → high-tunnel
 *
 * Usage:
 *   node scripts/migrate-naming-conventions.js
 *   node scripts/migrate-naming-conventions.js --dry-run
 */

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

// Read crops.json
const cropsPath = path.join(__dirname, '..', 'src', 'data', 'crops.json');
const cropsData = JSON.parse(fs.readFileSync(cropsPath, 'utf8'));
const crops = cropsData.crops;

// Mapping tables
const NORMAL_METHOD_MAP = {
  'DS': 'from-seeding',
  'TP': 'from-transplant',
  'X': 'total-time',
};

const GROWING_STRUCTURE_MAP = {
  'Field': 'field',
  'Greenhouse': 'greenhouse',
  'GH': 'greenhouse',
  'Tunnel': 'high-tunnel',
  'HT': 'high-tunnel',
};

// Stats
let formulaUpdates = 0;
let normalMethodUpdates = 0;
let growingStructureUpdates = 0;

// Process each crop
for (const crop of crops) {
  // Update formulas: PPB → plantingsPerBed, DBH → daysBetweenHarvest
  if (crop.yieldFormula) {
    const original = crop.yieldFormula;
    crop.yieldFormula = crop.yieldFormula
      .replace(/\bPPB\b/g, 'plantingsPerBed')
      .replace(/\bDBH\b/g, 'daysBetweenHarvest');

    if (crop.yieldFormula !== original) {
      formulaUpdates++;
    }
  }

  // Update normalMethod
  if (crop.normalMethod && NORMAL_METHOD_MAP[crop.normalMethod]) {
    crop.normalMethod = NORMAL_METHOD_MAP[crop.normalMethod];
    normalMethodUpdates++;
  }

  // Update growingStructure
  if (crop.growingStructure && GROWING_STRUCTURE_MAP[crop.growingStructure]) {
    crop.growingStructure = GROWING_STRUCTURE_MAP[crop.growingStructure];
    growingStructureUpdates++;
  }
}

console.log('='.repeat(60));
console.log('MIGRATE NAMING CONVENTIONS');
console.log('='.repeat(60));
console.log();
console.log(`Total crops: ${crops.length}`);
console.log(`Formula updates (PPB/DBH): ${formulaUpdates}`);
console.log(`normalMethod updates: ${normalMethodUpdates}`);
console.log(`growingStructure updates: ${growingStructureUpdates}`);
console.log();

if (DRY_RUN) {
  console.log('DRY RUN - no changes written');
  console.log();
  console.log('Sample migrated crops:');
  let count = 0;
  for (const crop of crops) {
    if (count < 5) {
      console.log(`  ${crop.identifier}`);
      console.log(`    normalMethod: ${crop.normalMethod}`);
      console.log(`    growingStructure: ${crop.growingStructure}`);
      if (crop.yieldFormula) {
        console.log(`    yieldFormula: ${crop.yieldFormula}`);
      }
      console.log();
      count++;
    }
  }
} else {
  // Write updated crops.json
  fs.writeFileSync(cropsPath, JSON.stringify(cropsData, null, 2) + '\n');
  console.log(`Updated ${cropsPath}`);
}
