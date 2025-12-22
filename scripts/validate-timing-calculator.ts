/**
 * Validate the crop timing calculator against actual Excel data.
 *
 * Run with: npx tsx scripts/validate-timing-calculator.ts
 */

import { calculateFromBedPlanAssignment, type BedPlanAssignment } from '../crop-api/src/lib/crop-timing-calculator';
import bedPlanData from '../crop-api/src/data/bed-plan.json';

interface BedPlanJson {
  assignments: BedPlanAssignment[];
  beds: string[];
  bedGroups: Record<string, string[]>;
}

const data = bedPlanData as BedPlanJson;

// Build lookup for followed crops
const assignmentMap = new Map<string, BedPlanAssignment>();
for (const a of data.assignments) {
  assignmentMap.set(a.identifier, a);
}

function getFollowedCropEndDate(identifier: string): Date | null {
  const followed = assignmentMap.get(identifier);
  if (followed?.expectedEndOfHarvest) {
    return new Date(followed.expectedEndOfHarvest);
  }
  return null;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return 'null';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return 'invalid';
  return date.toISOString().split('T')[0];
}

function daysDiff(d1: Date | string, d2: Date | string): number {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  if (isNaN(date1.getTime()) || isNaN(date2.getTime())) return NaN;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((date2.getTime() - date1.getTime()) / msPerDay);
}

console.log('='  .repeat(100));
console.log('VALIDATING CROP TIMING CALCULATOR');
console.log('='  .repeat(100));
console.log();

let exactMatches = 0;
let closeMatches = 0;  // within 1 day
let mismatches = 0;
let skipped = 0;

const mismatchDetails: {
  identifier: string;
  calculated: string;
  expected: string;
  diff: number;
  details: string;
}[] = [];

for (const assignment of data.assignments) {
  // Skip if missing required data
  if (!assignment.dtm || !assignment.harvestWindow) {
    skipped++;
    continue;
  }
  if (!assignment.fixedFieldStartDate && !assignment.followsCrop) {
    skipped++;
    continue;
  }
  if (!assignment.endOfHarvest) {
    skipped++;
    continue;
  }

  const result = calculateFromBedPlanAssignment(assignment, getFollowedCropEndDate);

  if (!result) {
    skipped++;
    continue;
  }

  const calculatedEnd = formatDate(result.endDate);
  const expectedEnd = formatDate(assignment.endOfHarvest);

  const diff = daysDiff(result.endDate, assignment.endOfHarvest);

  if (isNaN(diff)) {
    skipped++;
    continue;
  }

  if (diff === 0) {
    exactMatches++;
  } else if (Math.abs(diff) <= 1) {
    closeMatches++;
  } else {
    mismatches++;
    mismatchDetails.push({
      identifier: assignment.identifier,
      calculated: calculatedEnd,
      expected: expectedEnd,
      diff,
      details: `DTM=${assignment.dtm}, HW=${assignment.harvestWindow}, AddHarvest=${assignment.additionalDaysOfHarvest || 0}`,
    });
  }
}

console.log('SUMMARY');
console.log('-'.repeat(50));
console.log(`Total assignments: ${data.assignments.length}`);
console.log(`Skipped (missing data): ${skipped}`);
console.log(`Validated: ${exactMatches + closeMatches + mismatches}`);
console.log();
console.log(`  Exact matches: ${exactMatches}`);
console.log(`  Close (±1 day): ${closeMatches}`);
console.log(`  Mismatches: ${mismatches}`);
console.log();

if (mismatchDetails.length > 0) {
  console.log('MISMATCHES (showing first 20)');
  console.log('-'.repeat(100));

  for (const m of mismatchDetails.slice(0, 20)) {
    console.log(`${m.identifier}:`);
    console.log(`  Calculated: ${m.calculated}`);
    console.log(`  Expected:   ${m.expected}`);
    console.log(`  Diff:       ${m.diff} days`);
    console.log(`  Config:     ${m.details}`);
    console.log();
  }
}

// Show a few exact matches for verification
console.log('SAMPLE EXACT MATCHES');
console.log('-'.repeat(100));

let shown = 0;
for (const assignment of data.assignments) {
  if (shown >= 5) break;
  if (!assignment.dtm || !assignment.harvestWindow || !assignment.endOfHarvest) continue;
  if (!assignment.fixedFieldStartDate && !assignment.followsCrop) continue;

  const result = calculateFromBedPlanAssignment(assignment, getFollowedCropEndDate);
  if (!result) continue;

  const diff = daysDiff(result.endDate, assignment.endOfHarvest);
  if (diff === 0) {
    console.log(`${assignment.identifier}: ${assignment.crop}`);
    console.log(`  Start: ${formatDate(result.startDate)} → End: ${formatDate(result.endDate)}`);
    console.log(`  DTM=${assignment.dtm}, HW=${assignment.harvestWindow}, DaysInCells=${assignment.daysInCells || 0}`);
    console.log();
    shown++;
  }
}
