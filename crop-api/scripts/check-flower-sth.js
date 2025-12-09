/**
 * Check if flower STH calculations are correct or stale
 */
const d = require('../src/data/crops.json');

console.log('=== Flower STH Analysis ===\n');

// Get all flowers
const flowers = d.crops.filter(c => c.Category === 'Flower');
console.log(`Total flowers: ${flowers.length}`);

// Check flowers with STH and DTM
const flowersWithData = flowers.filter(c => c.STH && c.DTM);
console.log(`Flowers with both STH and DTM: ${flowersWithData.length}\n`);

// Group by planting method and DTM method
const groups = {
  DS_DS: [], // Direct seed DTM, direct seed actual
  DS_TP: [], // Direct seed DTM, transplant actual
  TP_TP: [], // Transplant DTM, transplant actual
  TP_DS: [], // Transplant DTM, direct seed actual
};

flowersWithData.forEach(c => {
  const dtmMethod = c['Normal Method'] || 'X';
  const plantingMethod = c['Planting Method'] || 'X';
  const key = `${dtmMethod}_${plantingMethod}`;
  if (groups[key]) {
    groups[key].push(c);
  }
});

// Analyze each group
Object.entries(groups).forEach(([key, crops]) => {
  if (crops.length === 0) return;

  console.log(`\n=== ${key} (${crops.length} flowers) ===`);

  crops.slice(0, 8).forEach(c => {
    const daysInCells = c['Days in Cells'] || 0;
    const diff = c.STH - c.DTM;

    // What we'd expect:
    let expected;
    let expectedCalc;
    if (key === 'DS_DS') {
      expected = c.DTM;
      expectedCalc = 'DTM';
    } else if (key === 'TP_DS') {
      expected = c.DTM + 20;
      expectedCalc = 'DTM + 20';
    } else if (key === 'TP_TP') {
      expected = c.DTM + daysInCells;
      expectedCalc = `DTM + DIC (${c.DTM} + ${daysInCells})`;
    } else if (key === 'DS_TP') {
      expected = c.DTM + Math.round(daysInCells * 0.65);
      expectedCalc = `DTM + DIC×0.65 (${c.DTM} + ${Math.round(daysInCells * 0.65)})`;
    }

    const offBy = c.STH - expected;
    const flag = Math.abs(offBy) > 5 ? ' ⚠️' : '';

    console.log(`\n${c.Identifier}:`);
    console.log(`  DTM=${c.DTM}, DIC=${daysInCells}, STH=${c.STH}`);
    console.log(`  Expected: ${expectedCalc} = ${expected}`);
    console.log(`  Actual STH - Expected = ${offBy}${flag}`);
    console.log(`  Harvests=${c.Harvests}, Days Between=${c['Days Between Harvest']}`);
  });
});

// Look for suspicious patterns
console.log('\n\n=== SUSPICIOUS PATTERNS ===\n');

// Flowers where STH = DTM but they're transplanted (likely stale)
const suspiciousTP = flowersWithData.filter(c =>
  c['Planting Method'] === 'TP' &&
  c['Days in Cells'] > 0 &&
  Math.abs(c.STH - c.DTM) < 5
);

if (suspiciousTP.length > 0) {
  console.log(`Flowers transplanted but STH ≈ DTM (likely stale): ${suspiciousTP.length}`);
  suspiciousTP.slice(0, 5).forEach(c => {
    console.log(`  ${c.Identifier}: DTM=${c.DTM}, DIC=${c['Days in Cells']}, STH=${c.STH}`);
  });
}

// Flowers where STH is exactly DTM + some round number (might be formula)
const roundDiffs = flowersWithData.filter(c => {
  const diff = c.STH - c.DTM;
  return diff > 0 && diff % 7 === 0; // Multiple of 7 (weeks)
});

console.log(`\nFlowers where STH-DTM is multiple of 7 (weeks): ${roundDiffs.length}`);
roundDiffs.slice(0, 5).forEach(c => {
  const weeks = (c.STH - c.DTM) / 7;
  console.log(`  ${c.Identifier}: DTM=${c.DTM}, STH=${c.STH}, diff=${weeks} weeks`);
});

// Check the actual formulas - what columns reference STH?
console.log('\n\n=== STH VALUES DISTRIBUTION ===');
const sthValues = flowersWithData.map(c => c.STH);
const uniqueSTH = [...new Set(sthValues)].sort((a, b) => a - b);
console.log(`Unique STH values for flowers: ${uniqueSTH.join(', ')}`);

// Check if any flowers have STH = DTM exactly (suggesting no formula applied)
const exactMatch = flowersWithData.filter(c => c.STH === c.DTM);
console.log(`\nFlowers where STH === DTM exactly: ${exactMatch.length}`);
exactMatch.slice(0, 5).forEach(c => {
  console.log(`  ${c.Identifier}: STH=DTM=${c.STH}, DIC=${c['Days in Cells']}, Method=${c['Planting Method']}`);
});
