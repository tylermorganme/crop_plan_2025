#!/usr/bin/env tsx
/**
 * Migration Script: Create Initial Checkpoints
 *
 * This script creates initial checkpoints for all existing plans.
 * Run this BEFORE deploying the hydration-based system.
 *
 * What it does:
 * 1. Lists all plan databases in data/plans/
 * 2. For each plan without a checkpoint:
 *    - Creates a checkpoint at the current state
 *    - Records the last_patch_id in checkpoint_metadata
 *
 * This ensures hydration has a known-good starting point for each plan.
 *
 * Usage:
 *   npx tsx scripts/create-initial-checkpoints.ts
 *   npx tsx scripts/create-initial-checkpoints.ts --dry-run
 */

import { readdirSync } from 'fs';
import { join } from 'path';
import {
  planExists,
  getPatchCount,
  getLatestCheckpointMetadata,
  createCheckpointWithMetadata,
  loadPlan,
  savePlan,
  clearPatches,
  openPlanDb,
} from '../src/lib/sqlite-storage';
import type { Plan } from '../src/lib/entities/plan';

const PLANS_DIR = join(process.cwd(), 'data', 'plans');

interface MigrationResult {
  planId: string;
  patchCount: number;
  checkpointCreated: boolean;
  checkpointId?: string;
  patchesCleared?: boolean;
  error?: string;
}

/**
 * Load plan directly from plan table, bypassing hydration.
 * Used for plans with corrupt patches.
 */
function loadPlanDirect(planId: string): Plan | null {
  const db = openPlanDb(planId);
  try {
    const row = db.prepare('SELECT data FROM plan WHERE id = ?').get('main') as
      | { data: string }
      | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.data) as Plan;
  } finally {
    db.close();
  }
}

async function migrate(dryRun: boolean): Promise<void> {
  console.log(`\n=== Create Initial Checkpoints Migration ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Plans directory: ${PLANS_DIR}\n`);

  // Find all plan databases
  let dbFiles: string[];
  try {
    dbFiles = readdirSync(PLANS_DIR).filter(
      (f) => f.endsWith('.db') && !f.endsWith('-wal') && !f.endsWith('-shm')
    );
  } catch (e) {
    console.error('Failed to read plans directory:', e);
    return;
  }

  console.log(`Found ${dbFiles.length} plan database(s)\n`);

  const results: MigrationResult[] = [];

  for (const file of dbFiles) {
    const planId = file.replace('.db', '');
    console.log(`Processing: ${planId}`);

    const result: MigrationResult = {
      planId,
      patchCount: 0,
      checkpointCreated: false,
    };

    try {
      // Check if plan exists
      if (!planExists(planId)) {
        result.error = 'Plan does not exist';
        results.push(result);
        console.log(`  ⚠️  Skipped: Plan does not exist\n`);
        continue;
      }

      // Get patch count
      const patchCount = getPatchCount(planId);
      result.patchCount = patchCount;
      console.log(`  Patches: ${patchCount}`);

      // Check if checkpoint already exists
      const existingCheckpoint = getLatestCheckpointMetadata(planId);
      if (existingCheckpoint) {
        console.log(`  ✓ Already has checkpoint: ${existingCheckpoint.name}`);
        console.log(`    Last patch ID: ${existingCheckpoint.lastPatchId}\n`);
        results.push(result);
        continue;
      }

      // Try to load plan via hydration first
      let plan: Plan | null = null;
      let hydrationFailed = false;
      let hydrationError = '';

      try {
        plan = loadPlan(planId);
        if (!plan) {
          result.error = 'Failed to load plan';
          results.push(result);
          console.log(`  ⚠️  Skipped: Failed to load plan\n`);
          continue;
        }
        console.log(`  Plan name: ${plan.metadata?.name || planId}`);
      } catch (e) {
        hydrationFailed = true;
        hydrationError = String(e);
        console.log(`  ⚠️  Hydration failed: ${e}`);

        // Try loading directly from plan table (bypassing patches)
        console.log(`  🔧 Attempting direct load from plan table...`);
        plan = loadPlanDirect(planId);

        if (!plan) {
          result.error = `Hydration and direct load both failed: ${e}`;
          results.push(result);
          console.log(`  ❌ Direct load also failed\n`);
          continue;
        }

        console.log(`  ✓ Direct load successful: ${plan.metadata?.name || planId}`);
        console.log(`  📋 Will clear ${patchCount} corrupt patches`);
      }

      // Create checkpoint
      if (dryRun) {
        console.log(`  📋 Would create checkpoint: "Migration checkpoint (${patchCount} patches)"`);
        if (hydrationFailed) {
          console.log(`  📋 Would clear corrupt patches and save plan state`);
        }
        console.log('');
        result.checkpointCreated = true;
        result.checkpointId = '(dry-run)';
        if (hydrationFailed) {
          result.patchesCleared = true;
        }
      } else {
        // If hydration failed, save the plan state and clear patches first
        if (hydrationFailed && plan) {
          console.log(`  🔧 Saving plan state and clearing corrupt patches...`);
          savePlan(planId, plan);
          clearPatches(planId);
          result.patchesCleared = true;
        }

        const checkpointId = createCheckpointWithMetadata(
          planId,
          `Migration checkpoint (${hydrationFailed ? '0 - patches cleared' : patchCount + ' patches'})`
        );
        result.checkpointCreated = true;
        result.checkpointId = checkpointId;
        console.log(`  ✓ Created checkpoint: ${checkpointId}\n`);
      }

      results.push(result);
    } catch (e) {
      result.error = String(e);
      results.push(result);
      console.log(`  ❌ Error: ${e}\n`);
    }
  }

  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`Total plans: ${results.length}`);
  console.log(`Checkpoints created: ${results.filter((r) => r.checkpointCreated).length}`);
  console.log(`Patches cleared (corrupt): ${results.filter((r) => r.patchesCleared).length}`);
  console.log(`Already had checkpoint: ${results.filter((r) => !r.checkpointCreated && !r.error).length}`);
  console.log(`Errors: ${results.filter((r) => r.error).length}`);

  if (results.some((r) => r.error)) {
    console.log(`\nErrors:`);
    for (const r of results.filter((r) => r.error)) {
      console.log(`  ${r.planId}: ${r.error}`);
    }
  }

  if (results.some((r) => r.patchesCleared)) {
    console.log(`\nPlans with cleared patches:`);
    for (const r of results.filter((r) => r.patchesCleared)) {
      console.log(`  ${r.planId}: ${r.patchCount} patches were corrupt and cleared`);
    }
  }

  if (dryRun) {
    console.log(`\n⚠️  This was a dry run. No changes were made.`);
    console.log(`   Run without --dry-run to create checkpoints.`);
  }
}

// Parse command line args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

migrate(dryRun).catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
