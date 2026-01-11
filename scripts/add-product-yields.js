/**
 * Add productYields to crops.json by matching crop+yieldUnit to products.
 *
 * This migrates legacy timing fields into the new productYields structure.
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../src/data');
const cropsData = require(path.join(dataDir, 'crops.json'));
const products = require(path.join(dataDir, 'products.json'));

// Build product lookup by crop+unit
const productLookup = new Map();
for (const p of products) {
  const key = `${p.crop.toLowerCase().trim()}|${p.unit.toLowerCase().trim()}`;
  if (!productLookup.has(key)) {
    productLookup.set(key, p);
  }
}

let matched = 0;
let unmatched = 0;
const unmatchedCrops = [];

// Add productYields to each crop
const updatedCrops = cropsData.crops.map(c => {
  // Skip if already has productYields
  if (c.productYields && c.productYields.length > 0) {
    matched++;
    return c;
  }

  // Match by crop + yieldUnit
  const cropName = c.crop?.toLowerCase().trim();
  const unit = c.yieldUnit?.toLowerCase().trim();

  if (cropName && unit) {
    const key = `${cropName}|${unit}`;
    const product = productLookup.get(key);

    if (product) {
      matched++;
      const productYield = {
        productId: product.id,
        dtm: c.dtm ?? 0,
        numberOfHarvests: c.numberOfHarvests ?? 1,
        harvestBufferDays: c.harvestBufferDays ?? 7,
      };

      // Only add optional fields if they have values
      if (c.daysBetweenHarvest) productYield.daysBetweenHarvest = c.daysBetweenHarvest;
      if (c.postHarvestFieldDays) productYield.postHarvestFieldDays = c.postHarvestFieldDays;
      if (c.yieldFormula) productYield.yieldFormula = c.yieldFormula;

      return {
        ...c,
        productYields: [productYield]
      };
    }
  }

  unmatched++;
  unmatchedCrops.push({ id: c.identifier, crop: c.crop, unit: c.yieldUnit });
  return c;
});

fs.writeFileSync(
  path.join(dataDir, 'crops.json'),
  JSON.stringify({ crops: updatedCrops }, null, 2) + '\n'
);

console.log('Updated crops.json');
console.log(`Matched: ${matched}`);
console.log(`Unmatched: ${unmatched}`);
if (unmatchedCrops.length > 0) {
  console.log('Unmatched crops:');
  unmatchedCrops.forEach(c => console.log(`  - ${c.id} (crop: ${c.crop}, unit: ${c.unit})`));
}
