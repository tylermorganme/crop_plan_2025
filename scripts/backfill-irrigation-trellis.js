#!/usr/bin/env node
/**
 * Backfill irrigation and trellisType fields to existing plans.
 *
 * This script updates cropCatalog entries in all existing plan databases
 * AND their checkpoint files to include the irrigation and trellisType
 * fields from the template.
 *
 * Usage: node scripts/backfill-irrigation-trellis.js [--dry-run]
 *
 * Options:
 *   --dry-run  Show what would be updated without making changes
 */

const Database = require('better-sqlite3');
const { join, resolve } = require('path');
const { readdirSync, existsSync } = require('fs');

// Paths
const projectRoot = resolve(__dirname, '..');
const plansDir = join(projectRoot, 'data/plans');
const templatePath = join(projectRoot, 'src/data/crop-config-template.json');

// Load template crop catalog for lookup
const template = require(templatePath);
// Lookup by ID (hash)
const templateById = new Map();
// Lookup by identifier string (fallback for older plans with different IDs)
const templateByIdentifier = new Map();
for (const crop of template.crops) {
  const data = {
    irrigation: crop.irrigation,
    trellisType: crop.trellisType,
  };
  templateById.set(crop.id, data);
  templateByIdentifier.set(crop.identifier, data);
}

// Parse command line args
const dryRun = process.argv.includes('--dry-run');

console.log(`Backfill irrigation & trellisType to existing plans`);
console.log(`Template: ${template.crops.length} crops`);
console.log(`With irrigation: ${template.crops.filter(c => c.irrigation).length}`);
console.log(`With trellisType: ${template.crops.filter(c => c.trellisType).length}`);
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

/**
 * Update cropCatalog in a single database file.
 * Returns the number of configs updated.
 */
function updateDatabase(dbPath, label) {
  const db = new Database(dbPath);
  try {
    // Read current plan data
    const row = db.prepare('SELECT data FROM plan WHERE id = ?').get('main');
    if (!row) {
      return { updated: 0, skipped: true, reason: 'no plan data' };
    }

    const plan = JSON.parse(row.data);
    const cropCatalog = plan.cropCatalog;

    if (!cropCatalog) {
      return { updated: 0, skipped: true, reason: 'no cropCatalog' };
    }

    let updatedCount = 0;

    // Update each crop config
    for (const [configKey, config] of Object.entries(cropCatalog)) {
      // Try to find template data by ID first, then by identifier
      const templateData = templateById.get(config.id) ||
                          templateByIdentifier.get(config.identifier);

      if (!templateData) {
        // Config not in template - maybe custom, skip
        continue;
      }

      let changed = false;

      // Add irrigation if template has it and config doesn't
      if (templateData.irrigation !== undefined && config.irrigation === undefined) {
        config.irrigation = templateData.irrigation;
        changed = true;
      }

      // Add trellisType if template has it and config doesn't
      if (templateData.trellisType !== undefined && config.trellisType === undefined) {
        config.trellisType = templateData.trellisType;
        changed = true;
      }

      if (changed) {
        updatedCount++;
      }
    }

    if (updatedCount > 0 && !dryRun) {
      // Save updated plan
      db.prepare(`
        UPDATE plan SET data = ?, updated_at = datetime('now')
        WHERE id = 'main'
      `).run(JSON.stringify(plan));
    }

    return { updated: updatedCount, skipped: false };
  } catch (err) {
    return { updated: 0, skipped: true, reason: err.message };
  } finally {
    db.close();
  }
}

// Find all plan databases
if (!existsSync(plansDir)) {
  console.log('No plans directory found at', plansDir);
  process.exit(0);
}

const planFiles = readdirSync(plansDir).filter(f => f.endsWith('.db'));
console.log(`Found ${planFiles.length} plan database(s)\n`);

let totalUpdated = 0;
let totalPlans = 0;
let totalCheckpoints = 0;

for (const filename of planFiles) {
  const dbPath = join(plansDir, filename);
  const planId = filename.replace('.db', '');

  console.log(`Processing: ${planId}`);

  // Update main database
  const mainResult = updateDatabase(dbPath, 'main');
  if (mainResult.skipped) {
    console.log(`  - Main db: skipped (${mainResult.reason})`);
  } else if (mainResult.updated > 0) {
    console.log(`  - Main db: updated ${mainResult.updated} configs`);
    totalUpdated += mainResult.updated;
    totalPlans++;
  } else {
    console.log(`  - Main db: no updates needed`);
  }

  // Update checkpoint databases
  const checkpointsDir = join(plansDir, `${planId}.checkpoints`);
  if (existsSync(checkpointsDir)) {
    const checkpointFiles = readdirSync(checkpointsDir).filter(f => f.endsWith('.db'));
    for (const cpFile of checkpointFiles) {
      const cpPath = join(checkpointsDir, cpFile);
      const cpResult = updateDatabase(cpPath, cpFile);
      if (cpResult.skipped) {
        // Silent skip for checkpoints
      } else if (cpResult.updated > 0) {
        console.log(`  - Checkpoint ${cpFile.slice(0, 8)}...: updated ${cpResult.updated} configs`);
        totalCheckpoints++;
      }
    }
  }
}

console.log(`\n---`);
console.log(`Summary: Updated ${totalUpdated} crop configs across ${totalPlans} plan(s) and ${totalCheckpoints} checkpoint(s)`);
if (dryRun) {
  console.log(`This was a dry run - no changes were made.`);
  console.log(`Run without --dry-run to apply changes.`);
}
