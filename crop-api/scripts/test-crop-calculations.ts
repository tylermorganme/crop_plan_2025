/**
 * Test Harness for Crop Calculations
 *
 * Compares calculated values against the original Excel export to verify parity.
 * Run with: npx tsx scripts/test-crop-calculations.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  calculateDaysInCells,
  calculateSTH,
  calculatePlantingMethod,
  calculateHarvestWindow,
  calculateCropFields,
  type CropConfig,
} from '../src/lib/crop-calculations';

// Load both datasets
const dataDir = path.join(__dirname, '../src/data');
const newCrops = JSON.parse(fs.readFileSync(path.join(dataDir, 'crops.json'), 'utf8')).crops as CropConfig[];
const oldCrops = JSON.parse(fs.readFileSync(path.join(dataDir, 'crops.json.old'), 'utf8')).crops;

// Create lookup by id
const oldById = new Map<string, Record<string, unknown>>(
  oldCrops.map((c: Record<string, unknown>) => [c.id as string, c])
);

interface TestResult {
  field: string;
  total: number;
  matches: number;
  mismatches: Array<{
    crop: string;
    expected: unknown;
    actual: unknown;
    inputs?: Record<string, unknown>;
  }>;
}

function testField(
  fieldName: string,
  calculator: (crop: CropConfig, old: Record<string, unknown>) => unknown,
  getExpected: (old: Record<string, unknown>) => unknown
): TestResult {
  const result: TestResult = {
    field: fieldName,
    total: newCrops.length,
    matches: 0,
    mismatches: [],
  };

  for (const crop of newCrops) {
    const old = oldById.get(crop.id);
    if (!old) continue;

    const expected = getExpected(old);
    const actual = calculator(crop, old);

    if (expected === actual) {
      result.matches++;
    } else {
      result.mismatches.push({
        crop: old.Identifier as string,
        expected,
        actual,
      });
    }
  }

  return result;
}

function printResult(result: TestResult, showMismatches = 5): void {
  const pct = ((result.matches / result.total) * 100).toFixed(1);
  const status = result.matches === result.total ? '✓' : '✗';

  console.log(`\n${status} ${result.field}: ${result.matches}/${result.total} (${pct}%)`);

  if (result.mismatches.length > 0 && showMismatches > 0) {
    console.log('  First mismatches:');
    result.mismatches.slice(0, showMismatches).forEach((m) => {
      console.log(`    ${m.crop}`);
      console.log(`      Expected: ${JSON.stringify(m.expected)}`);
      console.log(`      Actual:   ${JSON.stringify(m.actual)}`);
      if (m.inputs) {
        console.log(`      Inputs:   ${JSON.stringify(m.inputs)}`);
      }
    });
  }
}

// =============================================================================
// RUN TESTS
// =============================================================================

console.log('='.repeat(60));
console.log('Crop Calculation Parity Tests');
console.log('='.repeat(60));
console.log(`Testing ${newCrops.length} crops against Excel export\n`);

// Test: Days in Cells
const daysInCellsResult = testField(
  'Days in Cells',
  (crop) => calculateDaysInCells(crop),
  (old) => old['Days in Cells']
);
printResult(daysInCellsResult);

// Test: STH
const sthResult = testField(
  'STH (Seed To Harvest)',
  (crop) => {
    const dic = calculateDaysInCells(crop);
    return calculateSTH(crop, dic);
  },
  (old) => old.STH
);
printResult(sthResult);

// Test: Planting Method
const plantingMethodResult = testField(
  'Planting Method',
  (crop) => calculatePlantingMethod(crop),
  (old) => old['Planting Method']
);
printResult(plantingMethodResult);

// Test: Harvest Window
const harvestWindowResult = testField(
  'Harvest Window',
  (crop) => calculateHarvestWindow(crop),
  (old) => old['Harvest window']
);
printResult(harvestWindowResult);

// Summary
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));

const results = [daysInCellsResult, sthResult, plantingMethodResult, harvestWindowResult];
const allMatch = results.every((r) => r.matches === r.total);

results.forEach((r) => {
  const status = r.matches === r.total ? '✓' : '✗';
  console.log(`  ${status} ${r.field}: ${r.matches}/${r.total}`);
});

console.log('\n' + (allMatch ? '✓ All tests pass!' : '✗ Some tests failed - see above for details'));
