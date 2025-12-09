const d = require('../src/data/crops.json');

console.log('=== Yield Method Analysis ===\n');

// Look at Units Per Harvest patterns
const byUnit = {};
d.crops.forEach(c => {
  const unit = c.Unit || 'unknown';
  if (!byUnit[unit]) byUnit[unit] = [];
  byUnit[unit].push({
    name: (c.Identifier || '').slice(0, 40),
    unitsPerHarvest: c['Units Per Harvest'],
    plantingsPerBed: c['Plantings Per Bed'],
    rows: c.Rows,
    spacing: c.Spacing,
    harvests: c.Harvests
  });
});

console.log('Units found:', Object.keys(byUnit).join(', '));
console.log('');

// Analyze patterns for each unit type
['Lb', 'Bunch', 'Each', 'Head'].forEach(unit => {
  if (!byUnit[unit]) return;

  const samples = byUnit[unit].filter(c => c.unitsPerHarvest && c.plantingsPerBed);
  console.log(`=== ${unit} (${samples.length} with yield data) ===`);

  samples.slice(0, 5).forEach(c => {
    const ratio = c.unitsPerHarvest / c.plantingsPerBed;
    console.log(`  ${c.name}`);
    console.log(`    Units/Harvest=${c.unitsPerHarvest}, Plantings/Bed=${Math.round(c.plantingsPerBed)}`);
    console.log(`    Ratio (units per plant)=${ratio.toFixed(2)}, Rows=${c.rows}, Spacing=${c.spacing}`);
  });
  console.log('');
});

// Look for patterns that suggest per-foot or per-bed yield
console.log('=== Looking for yield patterns ===\n');

// Per-plant yields (Each unit, ratio near 1)
const perPlant = d.crops.filter(c =>
  c.Unit === 'Each' &&
  c['Units Per Harvest'] &&
  c['Plantings Per Bed'] &&
  Math.abs(c['Units Per Harvest'] / c['Plantings Per Bed'] - 1) < 0.5
);
console.log(`Likely per-plant (Each, ratio ~1): ${perPlant.length}`);
perPlant.slice(0, 3).forEach(c => {
  console.log(`  ${c.Identifier}: ${c['Units Per Harvest']} / ${Math.round(c['Plantings Per Bed'])} = ${(c['Units Per Harvest']/c['Plantings Per Bed']).toFixed(2)}`);
});

// Per-bed yields (round numbers like 50, 100, 200)
const perBed = d.crops.filter(c =>
  c['Units Per Harvest'] &&
  (c['Units Per Harvest'] === 50 || c['Units Per Harvest'] === 100 || c['Units Per Harvest'] === 200)
);
console.log(`\nLikely per-bed (round numbers 50/100/200): ${perBed.length}`);
perBed.slice(0, 5).forEach(c => {
  console.log(`  ${c.Identifier}: ${c['Units Per Harvest']} ${c.Unit}`);
});

// Per-foot (check if matches bed length pattern)
const BED_LENGTH = 50;
const perFoot = d.crops.filter(c =>
  c['Units Per Harvest'] &&
  c.Rows &&
  Math.abs(c['Units Per Harvest'] / (BED_LENGTH * c.Rows) - 1) < 0.3
);
console.log(`\nLikely per-foot (matches BedLength*Rows): ${perFoot.length}`);
perFoot.slice(0, 5).forEach(c => {
  const expected = BED_LENGTH * c.Rows;
  console.log(`  ${c.Identifier}: ${c['Units Per Harvest']} vs expected ${expected} (${c.Rows} rows)`);
});
