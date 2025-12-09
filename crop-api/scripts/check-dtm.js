const data = require('../src/data/normalized.json');
const { crops } = require('../src/data/crops.json');

// Get all tomato products with their DTM
const tomatoProductIds = data.productByCropFamilyIndex['Tomato'] || [];
console.log('=== TOMATO PRODUCTS (normalized) ===');
tomatoProductIds.forEach(pid => {
  const p = data.products[pid];
  console.log(`${p.name} (${p.unit}): DTM=${p.dtm}, dtmLower=${p.dtmLower}, dtmUpper=${p.dtmUpper}`);
});

// Check the source - what DTM values exist for each product in flat crops (crops.json)
const tomatoCrops = crops.filter(fc => fc.Crop === 'Tomato');

console.log('\n=== TOMATO RAW CROPS (source data) ===');
const byProduct = {};
tomatoCrops.forEach(fc => {
  const key = `${fc.Product}|${fc.Unit}`;
  if (!byProduct[key]) byProduct[key] = [];
  byProduct[key].push({ variety: fc.Variety, DTM: fc.DTM, structure: fc['Growing Structure'] });
});

Object.entries(byProduct).forEach(([key, entries]) => {
  console.log(`\n${key}:`);
  entries.forEach(e => console.log(`  ${e.variety} (${e.structure}): DTM=${e.DTM}`));
});
