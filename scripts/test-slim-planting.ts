/**
 * Parity Test Script for Slim Planting Computation
 *
 * Verifies that computeTimelineCrop() produces dates matching
 * the pre-computed values in bed-template.json.
 *
 * Run with: npx tsx scripts/test-slim-planting.ts
 */

import bedPlanData from '../src/data/bed-template.json';
import {
  computeTimelineCrop,
  extractSlimPlanting,
  extractConfigLookup,
} from '../src/lib/slim-planting';
import { buildBedLengthsFromTemplate } from '../src/lib/entities/bed';

interface BedPlanAssignment {
  crop: string;
  identifier: string;
  bed: string;
  bedsCount?: number;
  // Stored dates (what we compare against)
  tpOrDsDate: string;
  endOfHarvest: string;
  beginningOfHarvest: string;
  // Config fields
  dtm?: number;
  harvestWindow?: number;
  trueHarvestWindow?: number;
  daysInCells?: number;
  dsTp?: 'DS' | 'TP';
  category?: string | number;
  growingStructure?: string;
  // Input fields
  fixedFieldStartDate?: string | null;
  followsCrop?: string | null;
  followOffset?: number | null;
  // Override fields
  additionalDaysOfHarvest?: number | string | null;
  additionalDaysInField?: number | string | null;
  additionalDaysInCells?: number | string | null;
  // Actual fields
  actualGreenhouseDate?: string | null;
  actualTpOrDsDate?: string | null;
  actualBeginningOfHarvest?: string | null;
  actualEndOfHarvest?: string | null;
  failed?: boolean | null;
}

interface BedPlanData {
  assignments: BedPlanAssignment[];
  beds: string[];
  bedGroups: Record<string, string[]>;
}

/**
 * Compare two date strings, allowing for slight formatting differences.
 * Returns true if dates match (same day).
 */
function datesMatch(expected: string, computed: string): boolean {
  if (!expected || !computed) return false;

  const expectedDate = new Date(expected);
  const computedDate = new Date(computed);

  // Compare year, month, day only (ignore time component)
  return (
    expectedDate.getFullYear() === computedDate.getFullYear() &&
    expectedDate.getMonth() === computedDate.getMonth() &&
    expectedDate.getDate() === computedDate.getDate()
  );
}

/**
 * Get day difference between two dates.
 */
function daysDiff(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffMs = d2.getTime() - d1.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

interface TestResult {
  identifier: string;
  passed: boolean;
  startDateMatch: boolean;
  endDateMatch: boolean;
  harvestStartMatch: boolean;
  details?: {
    expectedStart: string;
    computedStart: string;
    startDiff: number;
    expectedEnd: string;
    computedEnd: string;
    endDiff: number;
    expectedHarvestStart: string;
    computedHarvestStart: string;
    harvestStartDiff: number;
  };
  error?: string;
}

function runParityTests() {
  const data = bedPlanData as BedPlanData;
  const { assignments, bedGroups, beds } = data;

  // Build bed lengths from template
  const bedLengths = buildBedLengthsFromTemplate(beds);

  console.log('='.repeat(80));
  console.log('SLIM PLANTING COMPUTATION PARITY TESTS');
  console.log(`Testing against ${assignments.length} bed-plan assignments`);
  console.log('='.repeat(80));
  console.log();

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const assignment of assignments) {
    // Skip assignments without required timing data
    if (!assignment.dtm || !assignment.harvestWindow) {
      skipped++;
      continue;
    }

    // Skip assignments without a field start date (succession not yet supported)
    if (!assignment.fixedFieldStartDate && assignment.followsCrop) {
      skipped++;
      continue;
    }

    try {
      // Extract slim planting and config
      // Use trueHarvestWindow for corrupted additionalDaysOfHarvest data
      const slim = extractSlimPlanting(assignment);
      const config = extractConfigLookup(assignment, true);

      // Compute timeline crops
      const timelineCrops = computeTimelineCrop(slim, config, bedGroups, bedLengths);

      if (timelineCrops.length === 0) {
        results.push({
          identifier: assignment.identifier,
          passed: false,
          startDateMatch: false,
          endDateMatch: false,
          harvestStartMatch: false,
          error: 'No timeline crops returned',
        });
        failed++;
        continue;
      }

      // Compare the first crop's dates (they all have same dates)
      const computed = timelineCrops[0];

      const startMatch = datesMatch(assignment.tpOrDsDate, computed.startDate);
      const endMatch = datesMatch(assignment.endOfHarvest, computed.endDate);
      const harvestStartMatch = datesMatch(
        assignment.beginningOfHarvest,
        computed.harvestStartDate ?? ''
      );

      const allMatch = startMatch && endMatch && harvestStartMatch;

      results.push({
        identifier: assignment.identifier,
        passed: allMatch,
        startDateMatch: startMatch,
        endDateMatch: endMatch,
        harvestStartMatch: harvestStartMatch,
        details: {
          expectedStart: assignment.tpOrDsDate,
          computedStart: computed.startDate,
          startDiff: daysDiff(assignment.tpOrDsDate, computed.startDate),
          expectedEnd: assignment.endOfHarvest,
          computedEnd: computed.endDate,
          endDiff: daysDiff(assignment.endOfHarvest, computed.endDate),
          expectedHarvestStart: assignment.beginningOfHarvest,
          computedHarvestStart: computed.harvestStartDate ?? '',
          harvestStartDiff: daysDiff(
            assignment.beginningOfHarvest,
            computed.harvestStartDate ?? ''
          ),
        },
      });

      if (allMatch) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      results.push({
        identifier: assignment.identifier,
        passed: false,
        startDateMatch: false,
        endDateMatch: false,
        harvestStartMatch: false,
        error: error instanceof Error ? error.message : String(error),
      });
      failed++;
    }
  }

  // Summary by field
  const startMatches = results.filter((r) => r.startDateMatch).length;
  const endMatches = results.filter((r) => r.endDateMatch).length;
  const harvestStartMatches = results.filter((r) => r.harvestStartMatch).length;
  const tested = results.length;

  console.log('FIELD-BY-FIELD RESULTS:');
  console.log('-'.repeat(40));
  console.log(
    `  startDate:        ${startMatches}/${tested} (${((startMatches / tested) * 100).toFixed(1)}%)`
  );
  console.log(
    `  endDate:          ${endMatches}/${tested} (${((endMatches / tested) * 100).toFixed(1)}%)`
  );
  console.log(
    `  harvestStartDate: ${harvestStartMatches}/${tested} (${((harvestStartMatches / tested) * 100).toFixed(1)}%)`
  );
  console.log();

  // Show failures
  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.log('FAILURES:');
    console.log('-'.repeat(40));

    for (const fail of failures.slice(0, 10)) {
      // Show first 10
      console.log(`  ${fail.identifier}:`);
      if (fail.error) {
        console.log(`    ERROR: ${fail.error}`);
      } else if (fail.details) {
        if (!fail.startDateMatch) {
          console.log(
            `    startDate: expected ${fail.details.expectedStart}, got ${fail.details.computedStart} (${fail.details.startDiff > 0 ? '+' : ''}${fail.details.startDiff} days)`
          );
        }
        if (!fail.endDateMatch) {
          console.log(
            `    endDate: expected ${fail.details.expectedEnd}, got ${fail.details.computedEnd} (${fail.details.endDiff > 0 ? '+' : ''}${fail.details.endDiff} days)`
          );
        }
        if (!fail.harvestStartMatch) {
          console.log(
            `    harvestStart: expected ${fail.details.expectedHarvestStart}, got ${fail.details.computedHarvestStart} (${fail.details.harvestStartDiff > 0 ? '+' : ''}${fail.details.harvestStartDiff} days)`
          );
        }
      }
    }

    if (failures.length > 10) {
      console.log(`  ... and ${failures.length - 10} more failures`);
    }
    console.log();
  }

  // Overall summary
  console.log('='.repeat(80));
  console.log(`SUMMARY: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

runParityTests();
