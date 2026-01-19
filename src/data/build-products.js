/**
 * Build products-template.json from Excel data
 *
 * Extracts unique products (crop + product + unit combinations)
 * with their pricing information stored as prices[marketId].
 *
 * Usage: node src/data/build-products.js
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Market IDs matching src/lib/entities/market.ts
const MARKET_IDS = {
  DIRECT: 'market-direct',
  WHOLESALE: 'market-wholesale',
  UPICK: 'market-upick',
};

// Column indices (1-based, matching Excel)
const COLUMNS = {
  crop: 9,        // Column I
  product: 11,    // Column K
  directPrice: 65,    // Column BM
  wholesalePrice: 67, // Column BO
  unit: 68,       // Column BP
};

/**
 * Generate deterministic product key
 */
function getProductKey(crop, product, unit) {
  return `${crop.toLowerCase().trim()}|${product.toLowerCase().trim()}|${unit.toLowerCase().trim()}`;
}

/**
 * Main build function
 */
function buildProducts() {
  const xlsxPath = path.join(__dirname, '../../Crop Plan 2025 V20.xlsm');

  if (!fs.existsSync(xlsxPath)) {
    console.error('Excel file not found:', xlsxPath);
    process.exit(1);
  }

  console.log('Reading Excel file...');
  const workbook = XLSX.readFile(xlsxPath);
  const sheet = workbook.Sheets['Crop Chart'];

  if (!sheet) {
    console.error('Sheet "Crop Chart" not found');
    process.exit(1);
  }

  // Convert to array of arrays for easier processing
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Track unique products by key
  const productsMap = new Map();

  // Skip header rows (row 1 is index 0, row 2 is index 1 - headers)
  // Data starts at row 3 (index 2)
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    // Column indices are 0-based in the array
    const crop = row[COLUMNS.crop - 1];
    const product = row[COLUMNS.product - 1];
    const unit = row[COLUMNS.unit - 1];
    const directPrice = row[COLUMNS.directPrice - 1];
    const wholesalePrice = row[COLUMNS.wholesalePrice - 1];

    // Skip rows without crop, product, or unit
    if (!crop || !product || !unit) continue;

    const key = getProductKey(crop, product, unit);

    // Build prices object
    const prices = {};
    if (typeof directPrice === 'number') {
      prices[MARKET_IDS.DIRECT] = directPrice;
      // Derive u-pick price as 70% of direct
      prices[MARKET_IDS.UPICK] = Math.round(directPrice * 0.7 * 100) / 100;
    }
    if (typeof wholesalePrice === 'number') {
      prices[MARKET_IDS.WHOLESALE] = wholesalePrice;
    } else if (typeof directPrice === 'number') {
      // Derive wholesale as 60% of direct if not specified
      prices[MARKET_IDS.WHOLESALE] = Math.round(directPrice * 0.6 * 100) / 100;
    }

    // Only add if we haven't seen this combination before
    // Or update if we have better price data
    const existing = productsMap.get(key);
    if (!existing) {
      productsMap.set(key, {
        id: key,
        crop: String(crop).trim(),
        product: String(product).trim(),
        unit: String(unit).trim(),
        prices,
      });
    } else {
      // Update if we found prices where there were none
      if (!existing.prices[MARKET_IDS.DIRECT] && prices[MARKET_IDS.DIRECT]) {
        existing.prices[MARKET_IDS.DIRECT] = prices[MARKET_IDS.DIRECT];
      }
      if (!existing.prices[MARKET_IDS.WHOLESALE] && prices[MARKET_IDS.WHOLESALE]) {
        existing.prices[MARKET_IDS.WHOLESALE] = prices[MARKET_IDS.WHOLESALE];
      }
      if (!existing.prices[MARKET_IDS.UPICK] && prices[MARKET_IDS.UPICK]) {
        existing.prices[MARKET_IDS.UPICK] = prices[MARKET_IDS.UPICK];
      }
    }
  }

  // Convert to array and sort
  const products = Array.from(productsMap.values()).sort((a, b) => {
    // Sort by crop, then product, then unit
    const cropCompare = a.crop.localeCompare(b.crop);
    if (cropCompare !== 0) return cropCompare;
    const productCompare = a.product.localeCompare(b.product);
    if (productCompare !== 0) return productCompare;
    return a.unit.localeCompare(b.unit);
  });

  // Write output
  const outputPath = path.join(__dirname, 'products-template.json');
  fs.writeFileSync(outputPath, JSON.stringify(products, null, 2));

  console.log(`\nExtracted ${products.length} unique products`);
  console.log(`Output: ${outputPath}`);

  // Summary stats
  const withDirectPrice = products.filter(p => p.prices[MARKET_IDS.DIRECT] !== undefined).length;
  const withWholesalePrice = products.filter(p => p.prices[MARKET_IDS.WHOLESALE] !== undefined).length;
  const withUpickPrice = products.filter(p => p.prices[MARKET_IDS.UPICK] !== undefined).length;
  console.log(`\nPricing coverage:`);
  console.log(`  Direct price: ${withDirectPrice}/${products.length} (${Math.round(100 * withDirectPrice / products.length)}%)`);
  console.log(`  Wholesale price: ${withWholesalePrice}/${products.length} (${Math.round(100 * withWholesalePrice / products.length)}%)`);
  console.log(`  U-Pick price: ${withUpickPrice}/${products.length} (${Math.round(100 * withUpickPrice / products.length)}%)`);

  // Sample output
  console.log(`\nSample products:`);
  products.slice(0, 5).forEach(p => {
    const d = p.prices[MARKET_IDS.DIRECT];
    const w = p.prices[MARKET_IDS.WHOLESALE];
    const u = p.prices[MARKET_IDS.UPICK];
    console.log(`  ${p.crop} - ${p.product} (${p.unit}): D:$${d ?? 'N/A'} W:$${w ?? 'N/A'} U:$${u ?? 'N/A'}`);
  });
}

buildProducts();
