#!/usr/bin/env node
/**
 * Fix Checkpoint Colors Script
 *
 * Updates crops colors in all checkpoint files to match the crops template.
 * This fixes the issue where backfill-crop-colors.js only updated the main
 * plan table but not the checkpoint files.
 *
 * Usage: node scripts/fix-checkpoint-colors.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Load the crops template
const templatePath = path.join(__dirname, '../src/data/crops-template.json');
const cropsTemplate = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

// Build a template lookup by crop name (case-insensitive)
const templateByName = new Map();
for (const crop of cropsTemplate) {
  templateByName.set(crop.name.toLowerCase(), crop);
}

// Default crop color
const DEFAULT_COLOR = { bg: '#78909c', text: '#ffffff' };

/**
 * Update crops colors in a plan to match the template.
 */
function updateCropColors(plan) {
  if (!plan.crops) {
    console.log('    No crops field, skipping');
    return false;
  }

  let updated = 0;
  for (const [id, crop] of Object.entries(plan.crops)) {
    const template = templateByName.get(crop.name.toLowerCase());
    if (template) {
      const oldBg = crop.bgColor;
      const newBg = template.bgColor;
      const newText = template.textColor;

      if (oldBg !== newBg) {
        crop.bgColor = newBg;
        crop.textColor = newText;
        updated++;
      }
    }
  }

  return updated;
}

/**
 * Process a single database file.
 */
function processDb(dbPath, label) {
  try {
    const db = new Database(dbPath);
    const row = db.prepare("SELECT data FROM plan WHERE id = 'main'").get();

    if (!row) {
      console.log(`  [${label}] No plan data found`);
      db.close();
      return 0;
    }

    const plan = JSON.parse(row.data);
    const updated = updateCropColors(plan);

    if (updated > 0) {
      db.prepare("UPDATE plan SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'main'")
        .run(JSON.stringify(plan));
      console.log(`  [${label}] Updated ${updated} crop colors`);
    } else {
      console.log(`  [${label}] No updates needed`);
    }

    db.close();
    return updated;
  } catch (error) {
    console.error(`  [${label}] Error: ${error.message}`);
    return 0;
  }
}

/**
 * Main function.
 */
function main() {
  console.log('Fix Checkpoint Colors');
  console.log('=====================');
  console.log(`Template crops: ${cropsTemplate.length}`);
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

  let totalUpdated = 0;

  for (const dbPath of dbFiles) {
    const planId = path.basename(dbPath, '.db');
    console.log(`Plan: ${planId}`);

    // Update main plan table
    totalUpdated += processDb(dbPath, 'main');

    // Check for checkpoints directory
    const checkpointsDir = `${dbPath.slice(0, -3)}.checkpoints`;
    if (fs.existsSync(checkpointsDir)) {
      const checkpointFiles = fs.readdirSync(checkpointsDir)
        .filter(f => f.endsWith('.db'))
        .map(f => path.join(checkpointsDir, f));

      console.log(`  Found ${checkpointFiles.length} checkpoint(s)`);

      for (const checkpointPath of checkpointFiles) {
        const checkpointId = path.basename(checkpointPath, '.db');
        totalUpdated += processDb(checkpointPath, `checkpoint:${checkpointId.slice(0, 8)}`);
      }
    }

    console.log('');
  }

  console.log('Summary');
  console.log('-------');
  console.log(`Total color updates: ${totalUpdated}`);
}

main();
