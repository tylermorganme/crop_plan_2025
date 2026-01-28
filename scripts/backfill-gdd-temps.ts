#!/usr/bin/env npx tsx
/**
 * Backfill GDD temperatures to all crops in all plans.
 *
 * Reads researched GDD data from src/data/gdd-temperatures.json and updates
 * the crops in each plan with gddBaseTemp and gddUpperTemp values.
 *
 * IMPORTANT: Updates BOTH main .db AND all checkpoint .db files.
 * The app loads from checkpoints first, so both must be updated.
 *
 * Data is in Celsius, converts to Fahrenheit for storage.
 *
 * Usage: npx tsx scripts/backfill-gdd-temps.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// Paths
const DATA_DIR = path.join(process.cwd(), 'data', 'plans');
const GDD_DATA_PATH = path.join(process.cwd(), 'src', 'data', 'gdd-temperatures.json');
const INDEX_PATH = path.join(DATA_DIR, 'index.json');

// Celsius to Fahrenheit
function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9/5) + 32);
}

interface GddCropData {
  name: string;
  base: number | null;
  upper: number | null;
  confidence: string;
  notes: string;
  source: string;
}

interface GddDataFile {
  _metadata: {
    description: string;
    generated: string;
    units: string;
  };
  crops: Record<string, GddCropData>;
}

interface PlanIndex {
  id: string;
  name: string;
}

interface Crop {
  id: string;
  name: string;
  bgColor: string;
  textColor: string;
  gddBaseTemp?: number;
  gddUpperTemp?: number;
}

interface Plan {
  crops?: Record<string, Crop>;
}

/**
 * Update crops in a plan with GDD temps.
 * Returns the number of crops updated.
 */
function updatePlanCrops(
  plan: Plan,
  gddLookup: Map<string, { base: number | null; upper: number | null }>
): { updated: number; updates: string[] } {
  if (!plan.crops) {
    return { updated: 0, updates: [] };
  }

  let updated = 0;
  const updates: string[] = [];

  for (const [cropId, crop] of Object.entries(plan.crops)) {
    const gddTemps = gddLookup.get(cropId);

    if (!gddTemps) {
      continue; // No GDD data for this crop
    }

    let changed = false;

    // Update if we have data (overwrite to ensure consistency)
    if (gddTemps.base !== null) {
      if (crop.gddBaseTemp !== gddTemps.base) {
        crop.gddBaseTemp = gddTemps.base;
        changed = true;
      }
    }

    if (gddTemps.upper !== null) {
      if (crop.gddUpperTemp !== gddTemps.upper) {
        crop.gddUpperTemp = gddTemps.upper;
        changed = true;
      }
    }

    if (changed) {
      updated++;
      updates.push(`  ${crop.name}: base=${gddTemps.base}°F, upper=${gddTemps.upper}°F`);
    }
  }

  return { updated, updates };
}

/**
 * Update a single database file with GDD temps.
 */
function updateDatabase(
  dbPath: string,
  gddLookup: Map<string, { base: number | null; upper: number | null }>,
  dryRun: boolean
): { updated: number; updates: string[] } {
  const db = new Database(dbPath);

  try {
    const row = db.prepare('SELECT data FROM plan WHERE id = ?').get('main') as { data: string } | undefined;

    if (!row) {
      return { updated: 0, updates: [] };
    }

    const plan: Plan = JSON.parse(row.data);
    const result = updatePlanCrops(plan, gddLookup);

    if (result.updated > 0 && !dryRun) {
      db.prepare('UPDATE plan SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(plan), 'main');
    }

    return result;
  } finally {
    db.close();
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    console.log('🔍 DRY RUN - no changes will be made\n');
  }

  // Load GDD data
  if (!fs.existsSync(GDD_DATA_PATH)) {
    console.error(`GDD data file not found: ${GDD_DATA_PATH}`);
    process.exit(1);
  }

  const gddData: GddDataFile = JSON.parse(fs.readFileSync(GDD_DATA_PATH, 'utf-8'));
  console.log(`📊 Loaded GDD data for ${Object.keys(gddData.crops).length} crops\n`);

  // Build lookup map (crop_id -> temps in Fahrenheit)
  const gddLookup = new Map<string, { base: number | null; upper: number | null }>();
  for (const [cropId, data] of Object.entries(gddData.crops)) {
    gddLookup.set(cropId, {
      base: data.base !== null ? celsiusToFahrenheit(data.base) : null,
      upper: data.upper !== null ? celsiusToFahrenheit(data.upper) : null,
    });
  }

  // Load plan index
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`Plan index not found: ${INDEX_PATH}`);
    process.exit(1);
  }

  const planIndex: PlanIndex[] = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  console.log(`📁 Found ${planIndex.length} plans\n`);

  let totalUpdated = 0;
  let totalPlans = 0;
  let totalCheckpoints = 0;

  for (const planInfo of planIndex) {
    const mainDbPath = path.join(DATA_DIR, `${planInfo.id}.db`);
    const checkpointsDir = path.join(DATA_DIR, `${planInfo.id}.checkpoints`);

    if (!fs.existsSync(mainDbPath)) {
      console.log(`⚠️  Skipping ${planInfo.name} - database not found`);
      continue;
    }

    // Update main database
    const mainResult = updateDatabase(mainDbPath, gddLookup, dryRun);
    let planCheckpointsUpdated = 0;

    // Always check and update checkpoint databases (they may be out of sync)
    if (fs.existsSync(checkpointsDir)) {
      const checkpointFiles = fs.readdirSync(checkpointsDir)
        .filter(f => f.endsWith('.db'));

      for (const checkpointFile of checkpointFiles) {
        const checkpointDbPath = path.join(checkpointsDir, checkpointFile);
        const checkpointResult = updateDatabase(checkpointDbPath, gddLookup, dryRun);
        if (checkpointResult.updated > 0) {
          planCheckpointsUpdated++;
          totalCheckpoints++;
        }
      }
    }

    if (mainResult.updated > 0 || planCheckpointsUpdated > 0) {
      totalUpdated += Math.max(mainResult.updated, 0);
      totalPlans++;

      console.log(`\n✅ ${planInfo.name}:`);
      if (mainResult.updated > 0) {
        console.log(`  📄 Main db: ${mainResult.updated} crops`);
        if (mainResult.updates.length <= 3) {
          mainResult.updates.forEach(u => console.log(`    ${u.trim()}`));
        } else {
          console.log(`    ... ${mainResult.updates.length} crops updated`);
        }
      } else {
        console.log(`  📄 Main db: already up to date`);
      }
      if (planCheckpointsUpdated > 0) {
        console.log(`  📦 Checkpoints: ${planCheckpointsUpdated} updated`);
      }
    } else {
      console.log(`⏭️  ${planInfo.name}: no updates needed`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Summary: Updated ${totalUpdated} crops across ${totalPlans} plans`);
  console.log(`📦 Updated ${totalCheckpoints} checkpoint databases`);

  if (dryRun) {
    console.log('\n🔍 This was a dry run. Run without --dry-run to apply changes.');
  }
}

main().catch(console.error);
