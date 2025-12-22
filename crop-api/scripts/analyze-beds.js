const d = require('../src/data/crops.json');

const inPlan = d.crops.filter(c => c['In Plan'] === true);

// Check 'Beds' column more closely
console.log('Crops in plan with bed requirements:\n');
inPlan.forEach(c => {
  console.log(`${c.Crop} (${c.Product}): ${c.Beds || 0} beds, ${c['Growing Structure']}`);
});

// Total beds needed
let totalBeds = 0;
const byStructure = {};
inPlan.forEach(c => {
  const beds = c.Beds || 0;
  const structure = c['Growing Structure'] || 'Unknown';
  totalBeds += beds;
  byStructure[structure] = (byStructure[structure] || 0) + beds;
});
console.log('\n=== SUMMARY ===');
console.log('Total bed-slots needed:', totalBeds);
console.log('By structure:', byStructure);

// Check if there's any actual bed assignment column
console.log('\n=== CHECKING FOR BED ASSIGNMENT COLUMN ===');
const sampleCrop = inPlan[0];
const keys = Object.keys(sampleCrop);
const bedLikeKeys = keys.filter(k =>
  k.toLowerCase().includes('bed') ||
  k.toLowerCase().includes('location') ||
  k.toLowerCase().includes('assign')
);
console.log('Bed-like columns:', bedLikeKeys);
