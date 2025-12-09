const d = require('../src/data/crops.json');

// Look at the relationship between STH, DTM, and other fields for DS_DS flowers
const dsDs = d.crops.filter(c =>
  c.Category === 'Flower' &&
  c['Normal Method'] === 'DS' &&
  c['Planting Method'] === 'DS' &&
  c.STH && c.DTM
);

console.log('DS_DS Flowers: Looking for pattern in STH calculation');
console.log('');

dsDs.forEach(c => {
  const diff = c.STH - c.DTM;
  const harvestWindow = c['Harvest Window'];
  const daysBetween = c['Days Between Harvest'] || 0;
  const harvests = c.Harvests || 1;

  // Is diff related to harvest window?
  console.log(c.Identifier.slice(0,50));
  console.log(`  DTM=${c.DTM}, STH=${c.STH}, diff=${diff}`);
  console.log(`  Harvests=${harvests}, DaysBetween=${daysBetween}, HarvestWindow=${harvestWindow}`);

  // Check if there's a formula: STH = DTM + some_factor * days_between
  if (daysBetween > 0) {
    const factor = diff / daysBetween;
    console.log(`  diff/DaysBetween = ${factor.toFixed(2)}`);
  }
  console.log('');
});

// Summary: what's the most common diff value?
const diffs = dsDs.map(c => c.STH - c.DTM);
const counts = {};
diffs.forEach(d => counts[d] = (counts[d] || 0) + 1);
console.log('\nDiff value frequency:');
Object.entries(counts).sort((a,b) => b[1] - a[1]).forEach(([diff, count]) => {
  console.log(`  ${diff} days: ${count} flowers`);
});
