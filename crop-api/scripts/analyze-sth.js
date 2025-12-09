const d = require('../src/data/crops.json');

console.log('=== STH Analysis (Seed to Harvest) ===');
console.log('STH = days from seeding to harvest');
console.log('DTM = days to maturity (method-specific)');
console.log('Days in Cells = greenhouse time before transplant');
console.log('');

// Group by Normal Method
const byMethod = { DS: [], TP: [], X: [], null: [] };
d.crops.forEach(c => {
  const method = c['Normal Method'] || 'null';
  if (byMethod[method] && c.STH && c.DTM) {
    byMethod[method].push({
      name: (c.Identifier || '').slice(0, 45),
      sth: c.STH,
      dtm: c.DTM,
      daysInCells: c['Days in Cells'] || 0,
      diff: c.STH - c.DTM,
      plantingMethod: c['Planting Method']
    });
  }
});

console.log('=== DS (DTM from Direct Seed) ===');
console.log('When you direct seed, STH should roughly equal DTM');
byMethod.DS.slice(0, 5).forEach(c => {
  console.log(`  ${c.name}`);
  console.log(`    STH=${c.sth}, DTM=${c.dtm}, diff=${c.diff}, method=${c.plantingMethod}`);
});

console.log('\n=== TP (DTM from Transplant) ===');
console.log('When DTM is measured from transplant, STH = DTM + time in cells');
console.log('But not all time in cells counts - transplant shock, etc.');
byMethod.TP.slice(0, 8).forEach(c => {
  const naiveExpected = c.dtm + c.daysInCells;
  const actualDiff = c.sth - naiveExpected;
  console.log(`  ${c.name}`);
  console.log(`    STH=${c.sth}, DTM=${c.dtm}, DaysInCells=${c.daysInCells}`);
  console.log(`    Naive (DTM+DIC)=${naiveExpected}, actual diff=${actualDiff}`);
});

// Look for patterns
console.log('\n=== DTM Conversion Pattern Analysis ===');

// For DS method crops that are actually transplanted
const dsButTransplanted = byMethod.DS.filter(c => c.plantingMethod === 'TP');
console.log(`\nDS method but actually transplanted (${dsButTransplanted.length}):`);
dsButTransplanted.slice(0, 5).forEach(c => {
  console.log(`  ${c.name}`);
  console.log(`    STH=${c.sth}, DTM=${c.dtm}, DIC=${c.daysInCells}, STH-DTM=${c.diff}`);
});

// For TP method crops that are direct seeded
const tpButDirectSeeded = byMethod.TP.filter(c => c.plantingMethod === 'DS');
console.log(`\nTP method but actually direct seeded (${tpButDirectSeeded.length}):`);
tpButDirectSeeded.slice(0, 5).forEach(c => {
  console.log(`  ${c.name}`);
  console.log(`    STH=${c.sth}, DTM=${c.dtm}, STH-DTM=${c.diff}`);
  // If DTM is from transplant, and we direct seed, we add ~21 days
});

// Summary
console.log('\n=== Summary ===');
console.log(`DS method crops: ${byMethod.DS.length}`);
console.log(`TP method crops: ${byMethod.TP.length}`);
console.log(`X method crops: ${byMethod.X.length}`);
console.log(`No method crops: ${byMethod.null.length}`);
