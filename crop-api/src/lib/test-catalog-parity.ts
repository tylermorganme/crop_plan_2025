/**
 * Catalog Parity Test
 *
 * Verifies that config values from crops.json catalog match
 * the embedded values in bed-plan.json assignments.
 *
 * Run with: npx tsx src/lib/test-catalog-parity.ts
 */

import cropsData from '../data/crops.json';
import bedPlanData from '../data/bed-plan.json';
import {
  lookupConfigFromCatalog,
  type CropCatalogEntry,
} from './slim-planting';

interface BedPlanAssignment {
  crop: string;
  identifier: string;
  // Config fields embedded in bed-plan
  dtm?: number;
  harvestWindow?: number;
  trueHarvestWindow?: number;
  daysInCells?: number;
  dsTp?: 'DS' | 'TP';
  category?: string | number;
  growingStructure?: string;
  // Override fields
  additionalDaysInField?: number | string | null;
}

interface BedPlanData {
  assignments: BedPlanAssignment[];
  beds: string[];
  bedGroups: Record<string, string[]>;
}

interface CropsData {
  crops: CropCatalogEntry[];
}

interface MismatchDetail {
  field: string;
  bedPlan: unknown;
  catalog: unknown;
}

interface TestResult {
  identifier: string;
  cropId: string;
  found: boolean;
  matches: boolean;
  mismatches: MismatchDetail[];
}

function runCatalogParityTest() {
  const bedPlan = bedPlanData as BedPlanData;
  const catalog = (cropsData as CropsData).crops;

  console.log('='.repeat(80));
  console.log('CATALOG PARITY TEST');
  console.log(`Comparing ${bedPlan.assignments.length} bed-plan assignments against crops.json catalog`);
  console.log('='.repeat(80));
  console.log();

  const results: TestResult[] = [];
  let notFound = 0;
  let matched = 0;
  let mismatched = 0;

  for (const assignment of bedPlan.assignments) {
    const config = lookupConfigFromCatalog(assignment.crop, catalog);

    if (!config) {
      results.push({
        identifier: assignment.identifier,
        cropId: assignment.crop,
        found: false,
        matches: false,
        mismatches: [],
      });
      notFound++;
      continue;
    }

    // Compare config values
    const mismatches: MismatchDetail[] = [];

    // DTM - bed-plan.dtm = catalog.STH + additionalDaysInField
    // The catalog lookup returns STH, and we apply the override
    const additionalDaysInField = typeof assignment.additionalDaysInField === 'number'
      ? assignment.additionalDaysInField
      : 0;
    const expectedDtm = config.dtm + additionalDaysInField;
    if (assignment.dtm != null && assignment.dtm !== expectedDtm) {
      mismatches.push({
        field: 'dtm',
        bedPlan: assignment.dtm,
        catalog: `${config.dtm} + ${additionalDaysInField} = ${expectedDtm}`
      });
    }

    // Harvest Window - bed-plan has harvestWindow + additionalDaysOfHarvest baked into trueHarvestWindow
    // For comparison, use the base harvestWindow from catalog
    if (assignment.harvestWindow != null && assignment.harvestWindow !== config.harvestWindow) {
      mismatches.push({ field: 'harvestWindow', bedPlan: assignment.harvestWindow, catalog: config.harvestWindow });
    }

    // Days in Cells
    if (assignment.daysInCells != null && assignment.daysInCells !== config.daysInCells) {
      mismatches.push({ field: 'daysInCells', bedPlan: assignment.daysInCells, catalog: config.daysInCells });
    }

    // Category - handle bed-plan having number (data bug)
    const bedPlanCategory = typeof assignment.category === 'number' ? '' : assignment.category;
    if (bedPlanCategory != null && bedPlanCategory !== config.category) {
      mismatches.push({ field: 'category', bedPlan: bedPlanCategory, catalog: config.category });
    }

    // Growing Structure
    if (assignment.growingStructure != null && assignment.growingStructure !== config.growingStructure) {
      mismatches.push({ field: 'growingStructure', bedPlan: assignment.growingStructure, catalog: config.growingStructure });
    }

    // Planting Method
    if (assignment.dsTp != null && assignment.dsTp !== config.plantingMethod) {
      mismatches.push({ field: 'plantingMethod', bedPlan: assignment.dsTp, catalog: config.plantingMethod });
    }

    const allMatch = mismatches.length === 0;
    results.push({
      identifier: assignment.identifier,
      cropId: assignment.crop,
      found: true,
      matches: allMatch,
      mismatches,
    });

    if (allMatch) {
      matched++;
    } else {
      mismatched++;
    }
  }

  // Summary by field
  const fieldMismatches = new Map<string, number>();
  for (const result of results) {
    for (const m of result.mismatches) {
      fieldMismatches.set(m.field, (fieldMismatches.get(m.field) || 0) + 1);
    }
  }

  console.log('FIELD-BY-FIELD RESULTS:');
  console.log('-'.repeat(40));
  const fields = ['dtm', 'harvestWindow', 'daysInCells', 'category', 'growingStructure', 'plantingMethod'];
  for (const field of fields) {
    const count = fieldMismatches.get(field) || 0;
    const total = results.filter(r => r.found).length;
    const matchCount = total - count;
    console.log(`  ${field.padEnd(18)}: ${matchCount}/${total} (${((matchCount / total) * 100).toFixed(1)}%)`);
  }
  console.log();

  // Show not found
  const notFoundResults = results.filter(r => !r.found);
  if (notFoundResults.length > 0) {
    console.log('NOT FOUND IN CATALOG:');
    console.log('-'.repeat(40));
    for (const r of notFoundResults.slice(0, 10)) {
      console.log(`  ${r.identifier}: "${r.cropId}"`);
    }
    if (notFoundResults.length > 10) {
      console.log(`  ... and ${notFoundResults.length - 10} more`);
    }
    console.log();
  }

  // Show mismatches
  const mismatchedResults = results.filter(r => r.found && !r.matches);
  if (mismatchedResults.length > 0) {
    console.log('MISMATCHES:');
    console.log('-'.repeat(40));
    for (const r of mismatchedResults.slice(0, 15)) {
      console.log(`  ${r.identifier}:`);
      for (const m of r.mismatches) {
        console.log(`    ${m.field}: bedPlan=${JSON.stringify(m.bedPlan)}, catalog=${JSON.stringify(m.catalog)}`);
      }
    }
    if (mismatchedResults.length > 15) {
      console.log(`  ... and ${mismatchedResults.length - 15} more`);
    }
    console.log();
  }

  // Categorize known per-planting adjustments
  const knownAdjustments = ['GAR533', 'GAR534', 'GAR535', 'SCA633'];
  const knownAdjustmentResults = mismatchedResults.filter(r =>
    knownAdjustments.includes(r.identifier)
  );
  const unexpectedMismatches = mismatchedResults.filter(r =>
    !knownAdjustments.includes(r.identifier)
  );

  if (knownAdjustmentResults.length > 0) {
    console.log('KNOWN PER-PLANTING ADJUSTMENTS:');
    console.log('-'.repeat(40));
    console.log(`  ${knownAdjustmentResults.map(r => r.identifier).join(', ')}`);
    console.log('  (These have manually adjusted values in bed-plan)');
    console.log();
  }

  // Overall summary
  console.log('='.repeat(80));
  console.log(`SUMMARY: ${matched} matched, ${unexpectedMismatches.length} mismatched, ${knownAdjustmentResults.length} known adjustments, ${notFound} not found`);
  console.log('='.repeat(80));

  // Exit with error if any not found (can't proceed with catalog lookup)
  if (notFound > 0) {
    process.exit(1);
  }
}

runCatalogParityTest();
