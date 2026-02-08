#!/usr/bin/env npx tsx
/**
 * Cleanup deprecated spec fields from all plans.
 *
 * Removes deprecated fields from PlantingSpecs that have productYields populated.
 * These fields are now redundant since timing/yield comes from productYields.
 *
 * Fields removed (only if productYields exists and has entries):
 * - dtm (now in productYields[].dtm)
 * - numberOfHarvests (now in productYields[].numberOfHarvests)
 * - daysBetweenHarvest (now in productYields[].daysBetweenHarvest)
 * - harvestBufferDays (now in productYields[].harvestBufferDays)
 * - yieldPerHarvest (calculated from productYields[].yieldFormula)
 * - yieldUnit (now from Product entity)
 * - harvestWindow (calculated from productYields)
 *
 * Cover crops without productYields keep their deprecated fields for timing.
 *
 * Usage: npx tsx scripts/cleanup-deprecated-spec-fields.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import {
  loadPlan,
  savePlan,
  createCheckpointWithMetadata,
} from '../src/lib/sqlite-storage';
import type { Plan } from '../src/lib/entities/plan';

const INDEX_PATH = path.join(process.cwd(), 'data', 'plans', 'index.json');

interface PlanIndex {
  id: string;
  name: string;
  schemaVersion?: number;
}

// Fields to remove from specs that have productYields
const DEPRECATED_FIELDS = [
  'dtm',
  'numberOfHarvests',
  'daysBetweenHarvest',
  'harvestBufferDays',
  'yieldPerHarvest',
  'yieldUnit',
  'harvestWindow',
] as const;

function cleanupSpec(spec: Record<string, unknown>): {
  changed: boolean;
  removedFields: string[];
} {
  const removedFields: string[] = [];

  // Only remove deprecated fields if productYields exists and has entries
  const productYields = spec.productYields as unknown[] | undefined;
  if (!productYields || productYields.length === 0) {
    return { changed: false, removedFields };
  }

  for (const field of DEPRECATED_FIELDS) {
    if (field in spec && spec[field] !== undefined) {
      delete spec[field];
      removedFields.push(field);
    }
  }

  return { changed: removedFields.length > 0, removedFields };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    console.log('🔍 DRY RUN - no changes will be made\n');
  }

  // Load plan index
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`Plan index not found: ${INDEX_PATH}`);
    process.exit(1);
  }

  const planIndex: PlanIndex[] = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  console.log(`📁 Found ${planIndex.length} plans\n`);

  let totalPlansModified = 0;
  let totalSpecsModified = 0;
  let totalFieldsRemoved = 0;
  let totalErrors = 0;

  for (const planInfo of planIndex) {
    // Load plan
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
      continue;
    }

    // Make a mutable copy
    const plan: Plan = JSON.parse(JSON.stringify(loadedPlan));

    // Process all specs
    const specs = plan.specs ?? {};
    let planModified = false;
    let planSpecsModified = 0;
    let planFieldsRemoved = 0;

    for (const [identifier, spec] of Object.entries(specs)) {
      const result = cleanupSpec(spec as unknown as Record<string, unknown>);
      if (result.changed) {
        planModified = true;
        planSpecsModified++;
        planFieldsRemoved += result.removedFields.length;

        if (dryRun) {
          console.log(`   ${identifier}: would remove [${result.removedFields.join(', ')}]`);
        }
      }
    }

    if (planModified) {
      console.log(`✅ ${planInfo.name}: ${planSpecsModified} specs, ${planFieldsRemoved} fields`);

      if (!dryRun) {
        // Save updated plan
        savePlan(planInfo.id, plan as Parameters<typeof savePlan>[1]);

        // Create checkpoint so app picks up changes
        createCheckpointWithMetadata(
          planInfo.id,
          'cleanup-deprecated-spec-fields',
          plan as Parameters<typeof createCheckpointWithMetadata>[2]
        );
      }

      totalPlansModified++;
      totalSpecsModified += planSpecsModified;
      totalFieldsRemoved += planFieldsRemoved;
    } else {
      console.log(`⏭️  ${planInfo.name}: no deprecated fields to remove`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Summary:`);
  console.log(`   Plans modified:  ${totalPlansModified}`);
  console.log(`   Specs modified:  ${totalSpecsModified}`);
  console.log(`   Fields removed:  ${totalFieldsRemoved}`);
  console.log(`   Errors:          ${totalErrors}`);

  if (dryRun) {
    console.log('\n🔍 This was a dry run. Run without --dry-run to apply changes.');
  }
}

main().catch(console.error);
