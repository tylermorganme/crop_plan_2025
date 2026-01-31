/**
 * Fix duplicate spec ID for "Arugula - Tunnel - Spring"
 *
 * Run with: npx tsx scripts/fix-duplicate-spec-id.ts
 */

import { loadPlan, savePlan, createCheckpointWithMetadata } from '../src/lib/sqlite-storage';

const PLAN_ID = '1769032930477-6g40ntg61';
const SPEC_TO_FIX = 'Arugula - Tunnel - Spring';

function main() {
  console.log(`Loading plan ${PLAN_ID}...`);
  const plan = loadPlan(PLAN_ID);

  if (!plan) {
    console.error('Plan not found');
    process.exit(1);
  }

  if (!plan.specs?.[SPEC_TO_FIX]) {
    console.error(`Spec "${SPEC_TO_FIX}" not found`);
    process.exit(1);
  }

  const oldId = plan.specs[SPEC_TO_FIX].id;
  const newId = `custom_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

  console.log(`Current ID: ${oldId}`);
  console.log(`New ID: ${newId}`);

  // Deep clone to unfreeze (immer freezes loaded plans)
  const mutablePlan = JSON.parse(JSON.stringify(plan));

  // Update the spec's id
  mutablePlan.specs[SPEC_TO_FIX].id = newId;
  mutablePlan.specs[SPEC_TO_FIX].updatedAt = new Date().toISOString();
  mutablePlan.metadata.lastModified = Date.now();

  // Save the plan (this updates the main db)
  console.log('Saving plan...');
  savePlan(PLAN_ID, mutablePlan);

  // Create a checkpoint so the app sees the change (must use createCheckpointWithMetadata to register in metadata table)
  console.log('Creating checkpoint...');
  createCheckpointWithMetadata(PLAN_ID, 'fix-duplicate-spec-id', mutablePlan);

  console.log('Done! Verify in the app.');

  // Verify
  const verified = loadPlan(PLAN_ID);
  console.log(`Verified new ID: ${verified?.specs?.[SPEC_TO_FIX]?.id}`);
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
