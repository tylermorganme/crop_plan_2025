/**
 * Test that all yield formulas in crops.json evaluate correctly.
 */

import * as fs from 'fs';
import { evaluateYieldFormula, calculatePlantsPerBed } from '../src/lib/entities/crop-config';

const cropsData = JSON.parse(fs.readFileSync('./src/data/crops.json', 'utf8'));
const crops = cropsData.crops;

console.log('Testing yield formula evaluation...');
console.log();

let passed = 0;
let failed = 0;
let noFormula = 0;

for (const crop of crops) {
  if (!crop.yieldFormula) {
    noFormula++;
    continue;
  }

  // Build context with typical values
  const spacing = 12;  // inches
  const rows = 2;
  const bedFeet = 50;
  const PPB = calculatePlantsPerBed(spacing, rows, bedFeet);

  const context = {
    PPB,
    plantsPerBed: PPB,
    bedFeet,
    harvests: crop.numberOfHarvests ?? 1,
    DBH: crop.daysBetweenHarvest ?? 7,
    rows,
    spacing,
    seeds: crop.seedsPerBed ?? 0,
  };

  const result = evaluateYieldFormula(crop.yieldFormula, context);

  if (result.error) {
    console.log(`FAIL: ${crop.identifier}`);
    console.log(`  Formula: ${crop.yieldFormula}`);
    console.log(`  Error: ${result.error}`);
    failed++;
  } else if (result.value === null || !isFinite(result.value)) {
    console.log(`FAIL: ${crop.identifier}`);
    console.log(`  Formula: ${crop.yieldFormula}`);
    console.log(`  Result: ${result.value}`);
    failed++;
  } else {
    passed++;
  }
}

console.log();
console.log('='.repeat(60));
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`No formula: ${noFormula}`);
console.log(`Total: ${crops.length}`);
