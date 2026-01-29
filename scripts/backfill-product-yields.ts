#!/usr/bin/env npx tsx
/**
 * Backfill productYields.productId fixes to all plans.
 *
 * Migration v15→v16 fixes incorrect productYields.productId references that were
 * caused by a bug in the import script (using crop|unit lookup instead of
 * crop|product|unit).
 *
 * This script loads each plan (which runs migrations automatically), then saves
 * it back to persist the changes.
 *
 * Usage: npx tsx scripts/backfill-product-yields.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import {
  loadPlan,
  savePlan,
  createCheckpointWithMetadata,
} from '../src/lib/sqlite-storage';
import { CURRENT_SCHEMA_VERSION } from '../src/lib/migrations/index';
import type { Plan } from '../src/lib/entities/plan';

const INDEX_PATH = path.join(process.cwd(), 'data', 'plans', 'index.json');

interface PlanIndex {
  id: string;
  name: string;
  schemaVersion?: number;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    console.log('🔍 DRY RUN - no changes will be made\n');
  }

  console.log(`📊 Target schema version: ${CURRENT_SCHEMA_VERSION}\n`);

  // Load plan index
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`Plan index not found: ${INDEX_PATH}`);
    process.exit(1);
  }

  const planIndex: PlanIndex[] = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  console.log(`📁 Found ${planIndex.length} plans\n`);

  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const planInfo of planIndex) {
    // Load plan using server-side hydration (runs migrations automatically)
    let loadedPlan: Plan | null;
    try {
      loadedPlan = loadPlan(planInfo.id) as Plan | null;
    } catch (err) {
      console.error(`❌ Error loading ${planInfo.name}:`, (err as Error).message);
      totalErrors++;
      continue;
    }

    if (!loadedPlan) {
      console.log(`⚠️  Skipping ${planInfo.name} - could not load`);
      totalSkipped++;
      continue;
    }

    // Check if the plan needed migration (compare schema versions)
    const originalVersion = planInfo.schemaVersion ?? 1;
    const newVersion = loadedPlan.schemaVersion ?? 1;

    if (newVersion <= originalVersion) {
      console.log(`⏭️  ${planInfo.name}: already at version ${newVersion}`);
      totalSkipped++;
      continue;
    }

    console.log(`✅ ${planInfo.name}: migrated v${originalVersion} → v${newVersion}`);

    if (!dryRun) {
      // Make a mutable copy (loadPlan returns frozen immer object)
      const plan: Plan = JSON.parse(JSON.stringify(loadedPlan));

      // Save updated plan
      savePlan(planInfo.id, plan as Parameters<typeof savePlan>[1]);

      // Create checkpoint so app picks up changes
      createCheckpointWithMetadata(
        planInfo.id,
        'backfill-product-yields',
        plan as Parameters<typeof createCheckpointWithMetadata>[2]
      );

      // Update the index entry's schemaVersion
      planInfo.schemaVersion = newVersion;
    }

    totalMigrated++;
  }

  // Update index.json with new schema versions
  if (!dryRun && totalMigrated > 0) {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(planIndex, null, 2));
    console.log(`\n📝 Updated ${INDEX_PATH}`);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Summary:`);
  console.log(`   Migrated: ${totalMigrated} plans`);
  console.log(`   Skipped:  ${totalSkipped} plans`);
  console.log(`   Errors:   ${totalErrors} plans`);

  if (dryRun) {
    console.log('\n🔍 This was a dry run. Run without --dry-run to apply changes.');
  }
}

main().catch(console.error);
