#!/usr/bin/env node
/**
 * Build varieties.json from extracted Excel data.
 *
 * Reads: tmp/varieties_from_excel.json
 * Writes: src/data/varieties.json
 *
 * Transforms raw Excel variety data into the app's Variety format,
 * generating stable IDs and normalizing field names.
 *
 * Usage:
 *   node src/data/build-varieties.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Paths
const inputPath = path.join(__dirname, '..', '..', 'tmp', 'varieties_from_excel.json');
const outputPath = path.join(__dirname, 'varieties.json');

// Generate a stable ID from variety data
function generateId(variety) {
  // Create a stable hash from crop + name + supplier
  const key = `${variety.crop}|${variety.name}|${variety.supplier}`.toLowerCase();
  const hash = crypto.createHash('md5').update(key).digest('hex').slice(0, 12);
  return `V_${hash}`;
}

// Normalize crop name (capitalize first letter of each word)
function normalizeCropName(name) {
  if (!name) return '';
  return name.trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// Read input
console.log('Reading extracted variety data...');
if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  console.error('Run: python scripts/extract-varieties.py');
  process.exit(1);
}

const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const rawVarieties = rawData.varieties || [];

console.log(`Processing ${rawVarieties.length} varieties...`);

// Transform to app format
const varieties = [];
const seenIds = new Set();

for (const raw of rawVarieties) {
  // Skip varieties without required fields
  if (!raw.crop && !raw.name) continue;

  const variety = {
    id: generateId(raw),
    crop: normalizeCropName(raw.crop || ''),
    name: (raw.name || '').trim(),
    supplier: (raw.supplier || '').trim(),
    organic: Boolean(raw.organic),
    pelleted: Boolean(raw.pelleted),
  };

  // Optional fields
  if (raw.pelletedApproved) variety.pelletedApproved = true;
  if (raw.dtm && typeof raw.dtm === 'number') variety.dtm = raw.dtm;
  if (raw.website) variety.website = raw.website;
  if (raw.alreadyOwn) variety.alreadyOwn = true;
  if (raw.subCategory) variety.subCategory = raw.subCategory;

  // Handle duplicate IDs (same crop/name/supplier)
  if (seenIds.has(variety.id)) {
    console.warn(`Duplicate variety: ${variety.crop} - ${variety.name} (${variety.supplier})`);
    continue;
  }
  seenIds.add(variety.id);

  varieties.push(variety);
}

console.log(`Processed ${varieties.length} unique varieties`);

// Sort by crop, then name
varieties.sort((a, b) => {
  const cropCmp = a.crop.localeCompare(b.crop);
  if (cropCmp !== 0) return cropCmp;
  return a.name.localeCompare(b.name);
});

// Output structure
const output = {
  _generated: new Date().toISOString(),
  _source: 'tmp/varieties_from_excel.json',
  varieties: varieties,
};

// Write output
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote ${outputPath}`);

// Stats
const crops = new Set(varieties.map(v => v.crop));
const suppliers = new Set(varieties.map(v => v.supplier).filter(Boolean));
const organicCount = varieties.filter(v => v.organic).length;

console.log('\n--- Statistics ---');
console.log(`Total varieties: ${varieties.length}`);
console.log(`Unique crops: ${crops.size}`);
console.log(`Unique suppliers: ${suppliers.size}`);
console.log(`Organic varieties: ${organicCount}`);
