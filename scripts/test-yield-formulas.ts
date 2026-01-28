/**
 * Test that all yield formulas in crops.json evaluate correctly.
 */

import * as fs from 'fs';
import { evaluateYieldFormula, buildYieldContext, type PlantingSpec } from '../src/lib/entities/planting-specs';

const cropsData = JSON.parse(fs.readFileSync('./src/data/crop-config-template.json', 'utf8'));
const crops = cropsData.crops as PlantingSpec[];

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
  const context = buildYieldContext(crop, bedFeet, rows, spacing);

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
