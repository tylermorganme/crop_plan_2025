#!/usr/bin/env npx tsx
/**
 * Backfill GDD temperatures to all crops in all plans.
 *
 * Uses server-side storage functions to load/save, then creates a checkpoint
 * so the app properly picks up the changes.
 *
 * Data is in Celsius, converts to Fahrenheit for storage.
 *
 * Usage: npx tsx scripts/backfill-gdd-temps.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import {
  loadPlan,
  savePlan,
  createCheckpointWithMetadata,
} from '../src/lib/sqlite-storage';

// Paths
const GDD_DATA_PATH = path.join(process.cwd(), 'src', 'data', 'gdd-temperatures.json');
const INDEX_PATH = path.join(process.cwd(), 'data', 'plans', 'index.json');

// Celsius to Fahrenheit
function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9 / 5) + 32);
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

// Use real Plan type from entities
import type { Plan } from '../src/lib/entities/plan';

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

  for (const planInfo of planIndex) {
    // Load plan using server-side hydration (handles checkpoints properly)
    let loadedPlan: Plan | null;
    try {
      loadedPlan = loadPlan(planInfo.id) as Plan | null;
    } catch (err) {
      console.error(`❌ Error loading ${planInfo.name}:`, (err as Error).message);
      continue;
    }

    if (!loadedPlan) {
      console.log(`⚠️  Skipping ${planInfo.name} - could not load`);
      continue;
    }

    // Make a mutable copy (loadPlan returns frozen immer object)
    const plan: Plan = JSON.parse(JSON.stringify(loadedPlan));

    if (!plan.crops) {
      console.log(`⚠️  Skipping ${planInfo.name} - no crops`);
      continue;
    }

    // Find crops that need updating
    const updates: Array<{ cropId: string; name: string; base: number; upper: number }> = [];

    for (const [cropId, crop] of Object.entries(plan.crops)) {
      const gddTemps = gddLookup.get(cropId);

      if (!gddTemps) {
        continue;
      }

      const needsBase = gddTemps.base !== null && crop.gddBaseTemp !== gddTemps.base;
      const needsUpper = gddTemps.upper !== null && crop.gddUpperTemp !== gddTemps.upper;

      if (needsBase || needsUpper) {
        // Update in place
        if (gddTemps.base !== null) {
          crop.gddBaseTemp = gddTemps.base;
        }
        if (gddTemps.upper !== null) {
          crop.gddUpperTemp = gddTemps.upper;
        }

        updates.push({
          cropId,
          name: crop.name,
          base: gddTemps.base!,
          upper: gddTemps.upper!,
        });
      }
    }

    if (updates.length === 0) {
      console.log(`⏭️  ${planInfo.name}: no updates needed`);
      continue;
    }

    console.log(`\n✅ ${planInfo.name}: updating ${updates.length} crops`);

    if (!dryRun) {
      // Save updated plan
      savePlan(planInfo.id, plan as Parameters<typeof savePlan>[1]);

      // Create checkpoint so app picks up changes
      createCheckpointWithMetadata(
        planInfo.id,
        'backfill-gdd-temps',
        plan as Parameters<typeof createCheckpointWithMetadata>[2]
      );
    }

    // Show sample updates
    if (updates.length <= 5) {
      updates.forEach(u => console.log(`  ${u.name}: base=${u.base}°F, upper=${u.upper}°F`));
    } else {
      updates.slice(0, 3).forEach(u => console.log(`  ${u.name}: base=${u.base}°F, upper=${u.upper}°F`));
      console.log(`  ... and ${updates.length - 3} more`);
    }

    totalUpdated += updates.length;
    totalPlans++;
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Summary: Updated ${totalUpdated} crops across ${totalPlans} plans`);

  if (dryRun) {
    console.log('\n🔍 This was a dry run. Run without --dry-run to apply changes.');
  }
}

main().catch(console.error);
