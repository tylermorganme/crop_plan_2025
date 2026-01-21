#!/usr/bin/env node
/**
 * One-off script to mark crop configs used in plantings as favorites.
 *
 * This script:
 * 1. Updates all SQLite plan databases in data/plans/
 * 2. Updates the crop-config-template.json
 *
 * For each plan, it finds all configIds used in plantings and marks those
 * configs as isFavorite: true in the cropCatalog.
 *
 * For the template, it marks configs that are used in ANY plan as favorites.
 *
 * Usage: node scripts/mark-used-configs-as-favorites.js
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const PLANS_DIR = path.join(__dirname, '..', 'data', 'plans');
const TEMPLATE_PATH = path.join(__dirname, '..', 'src', 'data', 'crop-config-template.json');

// Track all used config identifiers across all plans (for template)
const allUsedConfigIds = new Set();

function processDatabase(dbPath) {
  const dbName = path.basename(dbPath);
  console.log(`\nProcessing: ${dbName}`);

  const db = new Database(dbPath);

  try {
    // Read the plan data
    const row = db.prepare('SELECT data FROM plan WHERE id = ?').get('main');
    if (!row) {
      console.log(`  No plan data found, skipping.`);
      return;
    }

    const plan = JSON.parse(row.data);

    // Get all configIds used in plantings
    const plantings = plan.plantings || [];
    const usedConfigIds = new Set(plantings.map(p => p.configId));

    console.log(`  Found ${plantings.length} plantings using ${usedConfigIds.size} unique configs`);

    // Add to global set for template
    usedConfigIds.forEach(id => allUsedConfigIds.add(id));

    // Update cropCatalog
    const catalog = plan.cropCatalog || {};
    let updatedCount = 0;

    for (const [identifier, config] of Object.entries(catalog)) {
      if (usedConfigIds.has(identifier)) {
        if (!config.isFavorite) {
          config.isFavorite = true;
          updatedCount++;
        }
      }
    }

    console.log(`  Marked ${updatedCount} configs as favorites`);

    if (updatedCount > 0) {
      // Write back to database
      const stmt = db.prepare('UPDATE plan SET data = ?, updated_at = datetime(\'now\') WHERE id = ?');
      stmt.run(JSON.stringify(plan), 'main');
      console.log(`  Saved changes to database`);
    }

  } finally {
    db.close();
  }
}

function processTemplate() {
  console.log(`\nProcessing template: ${path.basename(TEMPLATE_PATH)}`);
  console.log(`  Total unique configs used across all plans: ${allUsedConfigIds.size}`);

  const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  const crops = template.crops || [];

  let updatedCount = 0;
  for (const config of crops) {
    if (allUsedConfigIds.has(config.identifier)) {
      if (!config.isFavorite) {
        config.isFavorite = true;
        updatedCount++;
      }
    }
  }

  console.log(`  Marked ${updatedCount} configs as favorites in template`);

  if (updatedCount > 0) {
    fs.writeFileSync(TEMPLATE_PATH, JSON.stringify(template, null, 2) + '\n');
    console.log(`  Saved changes to template`);
  }
}

function main() {
  console.log('=== Mark Used Configs as Favorites ===');

  // Find all .db files in plans directory
  const files = fs.readdirSync(PLANS_DIR);
  const dbFiles = files.filter(f => f.endsWith('.db'));

  console.log(`Found ${dbFiles.length} plan databases`);

  // Process each database
  for (const dbFile of dbFiles) {
    const dbPath = path.join(PLANS_DIR, dbFile);
    processDatabase(dbPath);
  }

  // Process template
  processTemplate();

  console.log('\n=== Done ===');
}

main();
