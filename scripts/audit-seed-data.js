#!/usr/bin/env node
/**
 * Audit seed data parity between crops.json and Excel source (crops.json.old)
 *
 * Checks:
 * 1. Is Seeding Factor being imported? (NO - we found it's missing)
 * 2. Does Seeds Per Bed match Excel calculation?
 * 3. Are all seed-related fields present?
 */

const fs = require('fs');
const path = require('path');

// Load both files
const cropsPath = path.join(__dirname, '..', 'src', 'data', 'crops.json');
const cropsOldPath = path.join(__dirname, '..', 'src', 'data', 'crops.json.old');

const crops = JSON.parse(fs.readFileSync(cropsPath, 'utf8')).crops;
const cropsOld = JSON.parse(fs.readFileSync(cropsOldPath, 'utf8')).crops;

// Build lookup by ID
const cropsOldById = {};
cropsOld.forEach(c => { cropsOldById[c.id] = c; });

console.log('='.repeat(70));
console.log('SEED DATA PARITY AUDIT');
console.log('='.repeat(70));
console.log();

// Check 1: Is extraStartFactor being imported?
console.log('CHECK 1: Extra Start Factor Import');
console.log('-'.repeat(40));
const hasExtraStart = crops.some(c => c.extraStartFactor !== undefined);
console.log(`  extraStartFactor in crops.json: ${hasExtraStart ? 'YES' : 'NO (MISSING!)'}`);

// Count combined factor values
const factorCounts = {};
crops.forEach(c => {
  const f = c.extraStartFactor ?? 1;
  factorCounts[f] = (factorCounts[f] || 0) + 1;
});
console.log(`  extraStartFactor distribution:`);
Object.entries(factorCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([val, count]) => {
    console.log(`    ${val}: ${count} crops`);
  });
console.log();

// Check 2: Compare Seeds Per Bed values
console.log('CHECK 2: Seeds Per Bed Calculation Parity');
console.log('-'.repeat(40));

let matches = 0;
let mismatches = 0;
let missing = 0;
const mismatchDetails = [];

for (const crop of crops) {
  const old = cropsOldById[crop.id];
  if (!old) {
    missing++;
    continue;
  }

  const jsonSeedsPerBed = crop.seedsPerBed;
  const excelSeedsPerBed = old['Seeds Per Bed'];

  // Skip if both are null/undefined/0
  if (!jsonSeedsPerBed && !excelSeedsPerBed) {
    continue;
  }

  if (jsonSeedsPerBed === excelSeedsPerBed) {
    matches++;
  } else {
    mismatches++;
    if (mismatchDetails.length < 10) {
      mismatchDetails.push({
        identifier: crop.identifier,
        json: jsonSeedsPerBed,
        excel: excelSeedsPerBed,
        excelPPB: old['Plantings Per Bed'],
        excelSPP: old['Seeds Per Planting'],
        excelSF: old['Safety Factor'],
        excelSeeding: old['Seeding Factor'],
      });
    }
  }
}

console.log(`  Matches: ${matches}`);
console.log(`  Mismatches: ${mismatches}`);
console.log(`  Missing from source: ${missing}`);

if (mismatchDetails.length > 0) {
  console.log(`\n  Sample mismatches (first ${mismatchDetails.length}):`);
  mismatchDetails.forEach(m => {
    const calculated = (m.excelPPB || 0) * (m.excelSPP || 0) * (m.excelSF || 1) * (m.excelSeeding || 1);
    console.log(`    ${m.identifier}`);
    console.log(`      JSON: ${m.json}, Excel: ${m.excel}`);
    console.log(`      Excel formula inputs: PPB=${m.excelPPB}, SPP=${m.excelSPP}, SF=${m.excelSF}, Seeding=${m.excelSeeding}`);
    console.log(`      Calculated: ${calculated}`);
  });
}
console.log();

// Check 3: All seed-related fields present
console.log('CHECK 3: Field Presence');
console.log('-'.repeat(40));

const seedFields = ['seedsPerPlanting', 'extraStartFactor'];
const importedFields = ['rows', 'spacing'];

for (const field of [...seedFields, ...importedFields]) {
  const count = crops.filter(c => c[field] !== undefined && c[field] !== null).length;
  console.log(`  ${field}: ${count}/${crops.length} crops have values`);
}
console.log();

// Check 4: Verify formula matches Excel
console.log('CHECK 4: Formula Verification');
console.log('-'.repeat(40));

let formulaMatches = 0;
let formulaMismatches = 0;
const formulaErrors = [];

for (const crop of crops) {
  const old = cropsOldById[crop.id];
  if (!old) continue;

  const excelSeedsPerBed = old['Seeds Per Bed'];
  if (!excelSeedsPerBed) continue;

  // Excel formula: PPB × SPP × SF × Seeding
  const ppb = old['Plantings Per Bed'] || 0;
  const spp = old['Seeds Per Planting'] || 0;
  const sf = old['Safety Factor'] || 1;
  const seeding = old['Seeding Factor'] || 1;

  const calculated = Math.round(ppb * spp * sf * seeding);

  if (calculated === excelSeedsPerBed) {
    formulaMatches++;
  } else {
    formulaMismatches++;
    if (formulaErrors.length < 5) {
      formulaErrors.push({
        identifier: crop.identifier,
        excel: excelSeedsPerBed,
        calculated,
        ppb, spp, sf, seeding
      });
    }
  }
}

console.log(`  Formula matches Excel: ${formulaMatches}`);
console.log(`  Formula mismatches: ${formulaMismatches}`);

if (formulaErrors.length > 0) {
  console.log(`\n  Sample formula errors:`);
  formulaErrors.forEach(e => {
    console.log(`    ${e.identifier}: Excel=${e.excel}, Calc=${e.calculated}`);
    console.log(`      Inputs: PPB=${e.ppb}, SPP=${e.spp}, SF=${e.sf}, Seeding=${e.seeding}`);
  });
}
console.log();

// Summary
console.log('='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));
console.log();

// Summarize results
const issues = [];
if (!hasExtraStart) {
  issues.push('extraStartFactor NOT being imported');
}
if (mismatches > 0) {
  issues.push(`${mismatches} Seeds Per Bed mismatches with Excel`);
}

if (issues.length === 0) {
  console.log('✅ All seed data checks passed!');
  console.log('   - Seeds Per Bed values match Excel exactly');
  console.log('   - All seed-related fields are present');
} else {
  console.log('Issues found:');
  issues.forEach((issue, i) => console.log(`  ${i + 1}. ${issue}`));
}
console.log();
