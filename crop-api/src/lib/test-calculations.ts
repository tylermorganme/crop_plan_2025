/**
 * Parity Test Script for Crop Calculations
 *
 * Run with: npx tsx src/lib/test-calculations.ts
 */

import { getAllCrops } from './crops';
import { testParity, LEVEL_0_CALCULATIONS } from './calculations';

function runParityTests() {
  const crops = getAllCrops();

  console.log('='.repeat(80));
  console.log('CALCULATION PARITY TESTS');
  console.log(`Testing against ${crops.length} crops`);
  console.log('='.repeat(80));
  console.log();

  let totalPassed = 0;
  let totalFailed = 0;

  for (const [header, calcFn] of Object.entries(LEVEL_0_CALCULATIONS)) {
    const result = testParity(crops, header, calcFn);

    const status = result.mismatches === 0 ? '✓ PASS' : '✗ FAIL';
    const pct = ((result.matches / result.total) * 100).toFixed(1);

    console.log(`${status} ${header}`);
    console.log(`       ${result.matches}/${result.total} matches (${pct}%)`);

    if (result.mismatches > 0) {
      totalFailed++;
      console.log(`       ${result.mismatches} mismatches:`);
      for (const detail of result.mismatchDetails) {
        const diffStr = detail.diff !== undefined ? ` (diff: ${detail.diff.toFixed(6)})` : '';
        console.log(`         - ${detail.crop}: expected=${JSON.stringify(detail.expected)}, got=${JSON.stringify(detail.calculated)}${diffStr}`);
      }
    } else {
      totalPassed++;
    }
    console.log();
  }

  console.log('='.repeat(80));
  console.log(`SUMMARY: ${totalPassed} passed, ${totalFailed} failed`);
  console.log('='.repeat(80));
}

runParityTests();
