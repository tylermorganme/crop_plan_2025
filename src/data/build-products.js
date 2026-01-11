/**
 * Build products.json from Excel data
 *
 * Extracts unique products (crop + product + unit combinations)
 * with their pricing information.
 *
 * Usage: node src/data/build-products.js
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

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

    // Only add if we haven't seen this combination before
    // Or update if we have better price data
    const existing = productsMap.get(key);
    if (!existing) {
      productsMap.set(key, {
        id: key,
        crop: String(crop).trim(),
        product: String(product).trim(),
        unit: String(unit).trim(),
        directPrice: typeof directPrice === 'number' ? directPrice : undefined,
        wholesalePrice: typeof wholesalePrice === 'number' ? wholesalePrice : undefined,
      });
    } else {
      // Update if we found prices where there were none
      if (!existing.directPrice && typeof directPrice === 'number') {
        existing.directPrice = directPrice;
      }
      if (!existing.wholesalePrice && typeof wholesalePrice === 'number') {
        existing.wholesalePrice = wholesalePrice;
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
  const outputPath = path.join(__dirname, 'products.json');
  fs.writeFileSync(outputPath, JSON.stringify(products, null, 2));

  console.log(`\nExtracted ${products.length} unique products`);
  console.log(`Output: ${outputPath}`);

  // Summary stats
  const withDirectPrice = products.filter(p => p.directPrice !== undefined).length;
  const withWholesalePrice = products.filter(p => p.wholesalePrice !== undefined).length;
  console.log(`\nPricing coverage:`);
  console.log(`  Direct price: ${withDirectPrice}/${products.length} (${Math.round(100 * withDirectPrice / products.length)}%)`);
  console.log(`  Wholesale price: ${withWholesalePrice}/${products.length} (${Math.round(100 * withWholesalePrice / products.length)}%)`);

  // Sample output
  console.log(`\nSample products:`);
  products.slice(0, 5).forEach(p => {
    console.log(`  ${p.crop} - ${p.product} (${p.unit}): D:$${p.directPrice ?? 'N/A'} W:$${p.wholesalePrice ?? 'N/A'}`);
  });
}

buildProducts();
