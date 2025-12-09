/**
 * Test DTM conversion against actual STH values in the database
 */
const d = require('../src/data/crops.json');

// Conversion constants (matching dtm-conversion.ts)
const TP_TO_DS_ADJUSTMENT = 20;
const DS_TO_TP_CELL_TIME_FACTOR = 0.65;

function convertDtm(dtm, dtmMethod, actualPlantingType, daysInCells = 0) {
  if (!dtmMethod || actualPlantingType === 'perennial') return dtm;

  const isMethodDS = dtmMethod === 'DS';
  const isMethodTP = dtmMethod === 'TP';
  const isActualDS = actualPlantingType === 'DS';
  const isActualTP = actualPlantingType === 'TP';

  if (isMethodTP && isActualDS) {
    return dtm + TP_TO_DS_ADJUSTMENT;
  }

  if (isMethodDS && isActualTP && daysInCells > 0) {
    const adjustment = Math.round(daysInCells * DS_TO_TP_CELL_TIME_FACTOR);
    return Math.max(dtm - adjustment, 1);
  }

  return dtm;
}

function calculateSth(dtm, dtmMethod, plantingType, daysInCells = 0) {
  if (plantingType === 'DS') {
    return convertDtm(dtm, dtmMethod, 'DS', 0);
  }

  // Transplant
  if (dtmMethod === 'TP') {
    // DTM from transplant: STH = DTM + daysInCells
    return dtm + daysInCells;
  }
  if (dtmMethod === 'DS') {
    // DTM from direct seed but transplanting:
    // Cell time doesn't fully count - only ~35% of it "helps"
    // So STH = DTM + (daysInCells * inefficiency factor)
    // Looking at data: 70 + 35 * 0.65 ≈ 93
    const inefficiency = 0.65; // ~65% of cell time is "wasted" vs direct seed
    return dtm + Math.round(daysInCells * inefficiency);
  }
  return dtm + daysInCells;
}

console.log('=== Testing DTM Conversion Against Actual STH ===\n');

// Test TP method but DS actual (should add 20 days)
console.log('--- TP→DS Conversion (expect +20 days) ---');
const tpToDsTestCases = d.crops.filter(c =>
  c['Normal Method'] === 'TP' &&
  c['Planting Method'] === 'DS' &&
  c.STH && c.DTM
);

let tpToDsErrors = [];
tpToDsTestCases.forEach(c => {
  const calculated = calculateSth(c.DTM, 'TP', 'DS', c['Days in Cells'] || 0);
  const actual = c.STH;
  const diff = Math.abs(calculated - actual);
  if (diff > 5) {
    tpToDsErrors.push({ name: c.Identifier, dtm: c.DTM, calculated, actual, diff });
  }
});

console.log(`Tested ${tpToDsTestCases.length} cases, ${tpToDsErrors.length} with >5 day error`);
tpToDsErrors.slice(0, 3).forEach(e => {
  console.log(`  ${e.name}: DTM=${e.dtm}, calc=${e.calculated}, actual=${e.actual} (off by ${e.diff})`);
});

// Test DS method but TP actual (should subtract portion of DIC)
console.log('\n--- DS→TP Conversion (expect -65% of DIC) ---');
const dsTpTestCases = d.crops.filter(c =>
  c['Normal Method'] === 'DS' &&
  c['Planting Method'] === 'TP' &&
  c.STH && c.DTM && c['Days in Cells']
);

let dsTpErrors = [];
dsTpTestCases.forEach(c => {
  const daysInCells = c['Days in Cells'] || 0;
  const calculated = calculateSth(c.DTM, 'DS', 'TP', daysInCells);
  const actual = c.STH;
  const diff = Math.abs(calculated - actual);
  if (diff > 10) {
    dsTpErrors.push({
      name: c.Identifier,
      dtm: c.DTM,
      dic: daysInCells,
      calculated,
      actual,
      diff
    });
  }
});

console.log(`Tested ${dsTpTestCases.length} cases, ${dsTpErrors.length} with >10 day error`);
dsTpErrors.slice(0, 5).forEach(e => {
  console.log(`  ${e.name}: DTM=${e.dtm}, DIC=${e.dic}, calc=${e.calculated}, actual=${e.actual} (off by ${e.diff})`);
});

// Test matching methods (no conversion)
console.log('\n--- No Conversion Needed (method matches actual) ---');
const noConversionCases = d.crops.filter(c =>
  ((c['Normal Method'] === 'DS' && c['Planting Method'] === 'DS') ||
   (c['Normal Method'] === 'TP' && c['Planting Method'] === 'TP')) &&
  c.STH && c.DTM
);

let noConvErrors = [];
noConversionCases.forEach(c => {
  const daysInCells = c['Days in Cells'] || 0;
  const calculated = calculateSth(c.DTM, c['Normal Method'], c['Planting Method'], daysInCells);
  const actual = c.STH;
  const diff = Math.abs(calculated - actual);
  if (diff > 5) {
    noConvErrors.push({
      name: c.Identifier,
      method: c['Normal Method'],
      dtm: c.DTM,
      dic: daysInCells,
      calculated,
      actual,
      diff
    });
  }
});

console.log(`Tested ${noConversionCases.length} cases, ${noConvErrors.length} with >5 day error`);
noConvErrors.slice(0, 3).forEach(e => {
  console.log(`  ${e.name}: method=${e.method}, DTM=${e.dtm}, DIC=${e.dic}, calc=${e.calculated}, actual=${e.actual} (off by ${e.diff})`);
});

// Summary
console.log('\n=== Summary ===');
const totalTests = tpToDsTestCases.length + dsTpTestCases.length + noConversionCases.length;
const totalErrors = tpToDsErrors.length + dsTpErrors.length + noConvErrors.length;
console.log(`Total tested: ${totalTests}`);
console.log(`Significant errors: ${totalErrors}`);
console.log(`Accuracy: ${((totalTests - totalErrors) / totalTests * 100).toFixed(1)}%`);

// Investigate outliers
console.log('\n=== INVESTIGATING OUTLIERS ===\n');

// Look at the "no conversion" errors in detail
console.log('--- "No Conversion Needed" Errors (method=DS, actual=DS) ---');
const dsToDs = noConvErrors.filter(e => e.method === 'DS');
dsToDs.forEach(e => {
  const crop = d.crops.find(c => c.Identifier === e.name);
  console.log(`\n${e.name}:`);
  console.log(`  DTM=${crop.DTM}, STH=${crop.STH}, diff=${crop.STH - crop.DTM}`);
  console.log(`  Harvests=${crop.Harvests}, Days Between=${crop['Days Between Harvest']}`);
  console.log(`  Category=${crop.Category}, Growing Structure=${crop['Growing Structure']}`);
});

console.log('\n--- "No Conversion Needed" Errors (method=TP, actual=TP) ---');
const tpToTp = noConvErrors.filter(e => e.method === 'TP');
tpToTp.slice(0, 5).forEach(e => {
  const crop = d.crops.find(c => c.Identifier === e.name);
  console.log(`\n${e.name}:`);
  console.log(`  DTM=${crop.DTM}, DIC=${crop['Days in Cells']}, STH=${crop.STH}`);
  console.log(`  Expected STH (DTM+DIC)=${crop.DTM + (crop['Days in Cells'] || 0)}, actual=${crop.STH}`);
  console.log(`  Diff from expected=${crop.STH - (crop.DTM + (crop['Days in Cells'] || 0))}`);
  console.log(`  Category=${crop.Category}, Growing Structure=${crop['Growing Structure']}`);
});

// Look at DS→TP outliers
console.log('\n--- DS→TP Conversion Outliers ---');
dsTpErrors.forEach(e => {
  const crop = d.crops.find(c => c.Identifier === e.name);
  console.log(`\n${e.name}:`);
  console.log(`  DTM=${crop.DTM}, DIC=${crop['Days in Cells']}, STH=${crop.STH}`);
  console.log(`  Using 0.65 factor: ${crop.DTM} + ${Math.round((crop['Days in Cells'] || 0) * 0.65)} = ${crop.DTM + Math.round((crop['Days in Cells'] || 0) * 0.65)}`);
  console.log(`  Actual ratio: (STH-DTM)/DIC = ${((crop.STH - crop.DTM) / (crop['Days in Cells'] || 1)).toFixed(2)}`);
  console.log(`  Category=${crop.Category}`);
});
