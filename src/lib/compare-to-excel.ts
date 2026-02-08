/**
 * Compare calculated values against a fresh Excel export.
 *
 * Usage: npx tsx src/lib/compare-to-excel.ts <path-to-excel-export.json>
 *
 * This compares our crop-config-template.json (with calculated fields) against the raw
 * Excel export to verify parity.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  calculateDaysInCells,
  calculateSeedToHarvest,
  calculatePlantingMethod,
  calculateHarvestWindow,
  type PlantingSpec,
} from './entities/planting-specs';

// Get Excel export path from command line
const excelExportPath = process.argv[2];
if (!excelExportPath) {
  console.error('Usage: npx tsx src/lib/compare-to-excel.ts <path-to-excel-export.json>');
  process.exit(1);
}

// Load our crop-config-template.json
const dataDir = path.join(__dirname, '../data');
const ourCrops = JSON.parse(fs.readFileSync(path.join(dataDir, 'crop-config-template.json'), 'utf8')).crops as PlantingSpec[];

// Load fresh Excel export
const excelCrops = JSON.parse(fs.readFileSync(excelExportPath, 'utf8')).crops;

// Build lookup by Name (more stable than generated IDs)
const excelByName = new Map<string, Record<string, unknown>>(
  excelCrops.map((c: Record<string, unknown>) => [c.Identifier as string, c])
);

interface TestResult {
  field: string;
  total: number;
  matches: number;
  mismatches: Array<{
    name: string;
    expected: unknown;
    actual: unknown;
  }>;
}

function testField(
  fieldName: string,
  calculator: (crop: PlantingSpec) => unknown,
  getExpected: (excel: Record<string, unknown>) => unknown
): TestResult {
  const result: TestResult = {
    field: fieldName,
    total: 0,
    matches: 0,
    mismatches: [],
  };

  for (const crop of ourCrops) {
    const excel = excelByName.get(crop.name);
    if (!excel) {
      // Crop not in Excel export (might have been removed)
      continue;
    }
    result.total++;

    const expected = getExpected(excel);
    const actual = calculator(crop);

    if (expected === actual) {
      result.matches++;
    } else {
      result.mismatches.push({
        name: crop.name,
        expected,
        actual,
      });
    }
  }

  return result;
}

function printResult(result: TestResult, showMismatches = 5): void {
  const pct = result.total > 0 ? ((result.matches / result.total) * 100).toFixed(1) : '0.0';
  const status = result.matches === result.total ? '✓' : '✗';

  console.log(`\n${status} ${result.field}: ${result.matches}/${result.total} (${pct}%)`);

  if (result.mismatches.length > 0 && showMismatches > 0) {
    console.log('  Mismatches:');
    result.mismatches.slice(0, showMismatches).forEach((m) => {
      console.log(`    ${m.name}`);
      console.log(`      Excel: ${JSON.stringify(m.expected)}`);
      console.log(`      Calc:  ${JSON.stringify(m.actual)}`);
    });
    if (result.mismatches.length > showMismatches) {
      console.log(`    ... and ${result.mismatches.length - showMismatches} more`);
    }
  }
}

// =============================================================================
// RUN COMPARISON
// =============================================================================

console.log('='.repeat(60));
console.log('Comparing Calculated Values to Excel Export');
console.log('='.repeat(60));
console.log(`Our crops.json: ${ourCrops.length} crops`);
console.log(`Excel export: ${excelCrops.length} crops`);
console.log(`Excel file: ${excelExportPath}`);

// Test: Days in Cells
const daysInCellsResult = testField(
  'Days in Cells',
  (crop) => calculateDaysInCells(crop),
  (excel) => excel['Days in Cells']
);
printResult(daysInCellsResult);

// Test: Seed To Harvest
const sthResult = testField(
  'Seed To Harvest',
  (crop) => {
    const dic = calculateDaysInCells(crop);
    return calculateSeedToHarvest(crop, dic);
  },
  (excel) => excel.STH
);
printResult(sthResult);

// Test: Planting Method
const plantingMethodResult = testField(
  'Planting Method',
  (crop) => calculatePlantingMethod(crop),
  (excel) => excel['Planting Method']
);
printResult(plantingMethodResult);

// Test: Harvest Window
const harvestWindowResult = testField(
  'Harvest Window',
  (crop) => calculateHarvestWindow(crop),
  (excel) => excel['Harvest window']
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

console.log('\n' + (allMatch ? '✓ All calculations match Excel!' : '✗ Some mismatches found - see above'));
