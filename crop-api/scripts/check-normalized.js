const data = require('../src/data/normalized.json');

console.log('=== DATA MODEL VERSION ===');
console.log(`Version: ${data.meta.version}`);
console.log(`Extracted: ${data.meta.extractedAt}`);

// Find tomato
const tomatoCrops = Object.values(data.crops).filter(c => c.cropFamily === 'Tomato');
console.log('\n=== TOMATO CROPS ===');
console.log(`Found ${tomatoCrops.length} tomato varieties`);
tomatoCrops.slice(0,3).forEach(c => console.log(`  - ${c.name} (id: ${c.id}, DTM: ${c.dtm})`));

// Find tomato products (no DTM - timing in ProductSequence)
const tomatoProducts = data.productByCropFamilyIndex['Tomato'] || [];
console.log(`\n=== TOMATO PRODUCTS (${tomatoProducts.length}) ===`);
tomatoProducts.forEach(pid => {
  const p = data.products[pid];
  const priceStr = p.prices.length ? p.prices.map(pr => `${pr.marketType}: $${pr.price}`).join(', ') : 'no price';
  console.log(`  - ${p.name} (${p.unit}) - ${priceStr}`);
});

// Find tomato configs and their sequences
const tomatoConfigs = Object.values(data.plantingConfigs).filter(c =>
  tomatoCrops.some(tc => tc.id === c.cropId)
);
console.log(`\n=== TOMATO CONFIGS (${tomatoConfigs.length}) ===`);
tomatoConfigs.slice(0,3).forEach(c => {
  console.log(`  - ${c.quickDescription}`);
  console.log(`    Structure: ${c.growingStructure}, Type: ${c.plantingType}`);
  // Get sequences for this config
  const seqIds = data.sequencesByConfigIndex[c.id] || [];
  seqIds.forEach(sid => {
    const seq = data.productSequences[sid];
    const product = data.products[seq.productId];
    console.log(`    Sequence: ${product?.name || seq.productId} - start: ${seq.harvestStartDays}d, harvests: ${seq.harvestCount}`);
  });
});

// Summary stats
console.log('\n=== COVERAGE STATS ===');
console.log(`Crops: ${Object.keys(data.crops).length}`);
console.log(`Products: ${Object.keys(data.products).length}`);
console.log(`Planting Configs: ${Object.keys(data.plantingConfigs).length}`);
console.log(`Product Sequences: ${Object.keys(data.productSequences).length}`);

const cropsWithDtm = Object.values(data.crops).filter(c => c.dtm != null);
console.log(`Crops with DTM: ${cropsWithDtm.length}/${Object.keys(data.crops).length}`);

const cropsWithProducts = Object.values(data.crops).filter(c => c.productIds.length > 0);
console.log(`Crops with products: ${cropsWithProducts.length}/${Object.keys(data.crops).length}`);

const familiesWithProducts = Object.keys(data.productByCropFamilyIndex).length;
const totalFamilies = Object.keys(data.cropFamilyIndex).length;
console.log(`Families with products: ${familiesWithProducts}/${totalFamilies}`);

// Multi-harvest sequences
const multiHarvest = Object.values(data.productSequences).filter(s => s.harvestCount > 1);
console.log(`\n=== MULTI-HARVEST SEQUENCES (${multiHarvest.length}) ===`);
multiHarvest.slice(0, 5).forEach(seq => {
  const config = data.plantingConfigs[seq.plantingConfigId];
  const product = data.products[seq.productId];
  console.log(`  - ${config?.quickDescription}: ${product?.name || 'unknown'} x${seq.harvestCount} (every ${seq.daysBetweenHarvest}d)`);
});

// Missing families
const familiesWithoutProducts = Object.keys(data.cropFamilyIndex)
  .filter(f => !data.productByCropFamilyIndex[f]);
console.log(`\nFamilies without products (${familiesWithoutProducts.length}):`);
familiesWithoutProducts.slice(0, 5).forEach(f => console.log(`  - ${f}`));
if (familiesWithoutProducts.length > 5) {
  console.log(`  ... and ${familiesWithoutProducts.length - 5} more`);
}
