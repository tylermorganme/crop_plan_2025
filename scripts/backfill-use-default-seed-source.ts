/**
 * Backfill useDefaultSeedSource on plantings.
 *
 * Many plantings have useDefaultSeedSource=undefined because they were created
 * before the feature was added, or through code paths that didn't set it.
 * This script sets useDefaultSeedSource=true on plantings that:
 *   1. Have no explicit seedSource
 *   2. Have useDefaultSeedSource === undefined (not explicitly false)
 *   3. Have a spec with defaultSeedSource set
 *
 * Uses the dev server API to load plans (ensuring hydration/migrations run),
 * then writes directly to SQLite + clears patches for a clean state.
 *
 * Run with:
 *   1. Start the dev server: npm run dev
 *   2. npx tsx scripts/backfill-use-default-seed-source.ts [--dry-run]
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const BASE_URL = 'http://localhost:5336';
const PLANS_DIR = path.join(process.cwd(), 'data/plans');
const DRY_RUN = process.argv.includes('--dry-run');

interface SeedSource {
  type: 'variety' | 'mix';
  id: string;
}

interface Planting {
  id: string;
  specId: string;
  seedSource?: SeedSource;
  useDefaultSeedSource?: boolean;
  [key: string]: unknown;
}

interface Spec {
  id: string;
  defaultSeedSource?: SeedSource;
  [key: string]: unknown;
}

interface Plan {
  id: string;
  schemaVersion: number;
  plantings: Planting[];
  specs: Record<string, Spec>;
  [key: string]: unknown;
}

interface PlanIndex {
  id: string;
  name: string;
  [key: string]: unknown;
}

async function loadPlanFromApi(planId: string): Promise<Plan | null> {
  const response = await fetch(`${BASE_URL}/api/sqlite/${planId}`);
  if (!response.ok) {
    console.error(`  Failed to fetch plan ${planId}: ${response.status}`);
    return null;
  }
  const { plan } = await response.json();
  return plan;
}

function fixPlan(plan: Plan): { fixedCount: number; totalPlantings: number; details: string[] } {
  const details: string[] = [];
  let fixedCount = 0;

  for (const planting of plan.plantings) {
    // Only fix plantings that have no explicit seedSource and undefined useDefaultSeedSource
    if (planting.seedSource) continue;
    if (planting.useDefaultSeedSource !== undefined) continue;

    const spec = plan.specs[planting.specId];
    if (!spec?.defaultSeedSource) continue;

    // This planting should use the default
    planting.useDefaultSeedSource = true;
    fixedCount++;
    details.push(`  ${planting.id} (spec: ${planting.specId}) → useDefaultSeedSource=true`);
  }

  return { fixedCount, totalPlantings: plan.plantings.length, details };
}

function savePlanToSqlite(planId: string, plan: Plan): void {
  const dbPath = path.join(PLANS_DIR, `${planId}.db`);
  if (!fs.existsSync(dbPath)) {
    console.error(`  DB not found: ${dbPath}`);
    return;
  }

  const db = new Database(dbPath);

  // Update main db
  db.prepare("UPDATE plan SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'main'")
    .run(JSON.stringify(plan));

  // Clear patches and redo stack so hydration uses fresh state
  const patchCount = (db.prepare("SELECT COUNT(*) as count FROM patches").get() as { count: number }).count;
  if (patchCount > 0) {
    console.log(`  Clearing ${patchCount} patches`);
    db.prepare("DELETE FROM patches").run();
  }
  // redo_stack may not exist in older dbs
  try { db.prepare("DELETE FROM redo_stack").run(); } catch { /* ok */ }

  db.close();

  // Also update checkpoint db if it exists
  const checkpointDir = path.join(PLANS_DIR, `${planId}.checkpoints`);
  if (fs.existsSync(checkpointDir)) {
    const cpFiles = fs.readdirSync(checkpointDir).filter(f => f.endsWith('.db'));
    for (const cpFile of cpFiles) {
      const cpDb = new Database(path.join(checkpointDir, cpFile));
      try {
        cpDb.prepare("UPDATE plan SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'main'")
          .run(JSON.stringify(plan));
      } catch {
        // Checkpoint db might have different schema
      }
      cpDb.close();
    }
    console.log(`  Updated ${cpFiles.length} checkpoint db(s)`);
  }
}

async function main() {
  console.log(`=== Backfill useDefaultSeedSource ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}\n`);

  // Load plan index
  const indexPath = path.join(PLANS_DIR, 'index.json');
  const planIndex: PlanIndex[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

  let totalFixed = 0;
  let plansModified = 0;

  for (const entry of planIndex) {
    console.log(`\n${entry.name} (${entry.id})`);

    const plan = await loadPlanFromApi(entry.id);
    if (!plan) continue;

    const { fixedCount, totalPlantings, details } = fixPlan(plan);

    if (fixedCount === 0) {
      console.log(`  ${totalPlantings} plantings — all OK, nothing to fix`);
      continue;
    }

    console.log(`  ${totalPlantings} plantings — fixing ${fixedCount}:`);
    for (const d of details) {
      console.log(d);
    }

    if (!DRY_RUN) {
      savePlanToSqlite(entry.id, plan);
      console.log(`  Saved!`);
      plansModified++;
    }

    totalFixed += fixedCount;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Plans scanned: ${planIndex.length}`);
  console.log(`Plans modified: ${DRY_RUN ? '0 (dry run)' : plansModified}`);
  console.log(`Total plantings fixed: ${totalFixed}`);

  if (DRY_RUN) {
    console.log(`\nRe-run without --dry-run to apply changes.`);
  } else if (plansModified > 0) {
    console.log(`\nRefresh your browser to see the changes.`);
  }
}

main().catch(console.error);
