const bedPlan = require('../crop-api/src/data/bed-plan.json');

// Show all beds grouped
console.log('Bed groups:');
for (const [group, beds] of Object.entries(bedPlan.bedGroups)) {
  console.log(`  ${group}: ${beds.join(', ')}`);
}

// Count beds per group
console.log('\nBed counts and sizes:');
for (const [group, beds] of Object.entries(bedPlan.bedGroups)) {
  const size = (group === 'F' || group === 'J') ? '20ft' : '50ft';
  console.log(`  Row ${group}: ${beds.length} beds (${size})`);
}

// Check crops with fractional beds
const crops = require('../crop-api/src/data/crops.json').crops;
console.log('\nCrops with fractional bed needs:');
crops.filter(c => c['In Plan'] && c.Beds && c.Beds % 1 !== 0).forEach(c => {
  const assignments = bedPlan.assignments.filter(a => a.crop === c.Identifier);
  console.log(`  ${c.Crop}: ${c.Beds} beds -> ${assignments.map(a => a.bed).join(', ') || 'unassigned'}`);
});
