#!/usr/bin/env node
/**
 * Backfill Crop Colors Script
 *
 * This script updates existing plans to include crop colors from the template.
 * It reads all SQLite plan databases and adds/updates the crops field if needed.
 *
 * Usage: node scripts/backfill-crop-colors.js [--dry-run]
 *
 * Options:
 *   --dry-run  Show what would be changed without making modifications
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Load the crops template
const templatePath = path.join(__dirname, '../src/data/crops-template.json');
const cropsTemplate = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

// Build a template lookup by crop name
const templateByName = new Map();
for (const crop of cropsTemplate) {
  templateByName.set(crop.name.toLowerCase(), crop);
}

// Default crop color
const DEFAULT_COLOR = { bg: '#78909c', text: '#ffffff' };

/**
 * Generate a crop ID from a name.
 */
function getCropId(name) {
  return `crop_${name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
}

/**
 * Extract unique crop names from a plan's cropCatalog and products.
 */
function extractCropNames(plan) {
  const cropNames = new Set();

  // From cropCatalog
  if (plan.cropCatalog) {
    for (const config of Object.values(plan.cropCatalog)) {
      if (config.crop) {
        cropNames.add(config.crop);
      }
    }
  }

  // From products
  if (plan.products) {
    for (const product of Object.values(plan.products)) {
      if (product.crop) {
        cropNames.add(product.crop);
      }
    }
  }

  return cropNames;
}

/**
 * Build the crops record for a plan.
 */
function buildCropsRecord(plan) {
  const cropNames = extractCropNames(plan);
  const crops = {};

  for (const name of cropNames) {
    const id = getCropId(name);
    const template = templateByName.get(name.toLowerCase());

    crops[id] = {
      id,
      name,
      bgColor: template?.bgColor || DEFAULT_COLOR.bg,
      textColor: template?.textColor || DEFAULT_COLOR.text,
    };
  }

  return crops;
}

/**
 * Process a single plan database file.
 */
function processPlanDb(dbPath, dryRun) {
  const planName = path.basename(dbPath, '.db');

  try {
    const db = new Database(dbPath);

    // Read the plan data
    const row = db.prepare("SELECT data FROM plan WHERE id = 'main'").get();
    if (!row) {
      console.log(`  [${planName}] No plan data found, skipping`);
      db.close();
      return { skipped: true };
    }

    const plan = JSON.parse(row.data);

    // Check if crops already exist
    const existingCrops = plan.crops ? Object.keys(plan.crops).length : 0;
    const cropNames = extractCropNames(plan);

    if (existingCrops >= cropNames.size && existingCrops > 0) {
      console.log(`  [${planName}] Already has ${existingCrops} crops (${cropNames.size} unique), skipping`);
      db.close();
      return { skipped: true };
    }

    // Build new crops record
    const newCrops = buildCropsRecord(plan);
    const newCount = Object.keys(newCrops).length;

    if (dryRun) {
      console.log(`  [${planName}] Would add ${newCount} crops (had ${existingCrops})`);
      db.close();
      return { wouldUpdate: true, count: newCount };
    }

    // Update the plan
    plan.crops = newCrops;

    // Write back to database
    db.prepare("UPDATE plan SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'main'")
      .run(JSON.stringify(plan));

    console.log(`  [${planName}] Added ${newCount} crops`);
    db.close();
    return { updated: true, count: newCount };

  } catch (error) {
    console.error(`  [${planName}] Error: ${error.message}`);
    return { error: true };
  }
}

/**
 * Main function.
 */
function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('Backfill Crop Colors');
  console.log('====================');
  console.log(`Template crops: ${cropsTemplate.length}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (will modify databases)'}`);
  console.log('');

  // Find all plan databases
  const plansDir = path.join(__dirname, '../data/plans');
  if (!fs.existsSync(plansDir)) {
    console.error(`Plans directory not found: ${plansDir}`);
    process.exit(1);
  }

  const dbFiles = fs.readdirSync(plansDir)
    .filter(f => f.endsWith('.db'))
    .map(f => path.join(plansDir, f));

  console.log(`Found ${dbFiles.length} plan database(s)`);
  console.log('');

  // Process each database
  const results = { updated: 0, skipped: 0, errors: 0 };

  for (const dbPath of dbFiles) {
    const result = processPlanDb(dbPath, dryRun);
    if (result.updated || result.wouldUpdate) {
      results.updated++;
    } else if (result.skipped) {
      results.skipped++;
    } else if (result.error) {
      results.errors++;
    }
  }

  console.log('');
  console.log('Summary');
  console.log('-------');
  console.log(`Updated: ${results.updated}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Errors:  ${results.errors}`);

  if (dryRun && results.updated > 0) {
    console.log('');
    console.log('Run without --dry-run to apply changes.');
  }
}

main();
