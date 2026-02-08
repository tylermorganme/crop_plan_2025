/**
 * Restore sequences from grandparent plan using the API.
 *
 * This script properly goes through the app's mutation layer so that:
 * 1. Changes are saved correctly to SQLite
 * 2. Patches are created properly for undo/redo
 * 3. The in-memory store is updated
 *
 * Run with: npx tsx scripts/restore-sequences-api.ts
 */

import Database from 'better-sqlite3';
import path from 'path';

const GRANDPARENT_ID = '1769032930477-6g40ntg61';
const CURRENT_ID = '1770248310946-bqfcf3box';
const PLANS_DIR = path.join(process.cwd(), 'data/plans');
const BASE_URL = 'http://localhost:5336';

// Backup path (from tar archive extraction)
const BACKUP_GRANDPARENT_PATH = `/tmp/data/plans/${GRANDPARENT_ID}.db`;

interface Planting {
  id: string;
  specId: string;
  sequenceId: string | null;
  sequenceSlot?: number | null;
  fieldStartDate: string;
  [key: string]: unknown;
}

interface Sequence {
  id: string;
  name?: string;
  offsetDays: number;
  useGddStagger?: boolean;
  [key: string]: unknown;
}

interface Plan {
  id: string;
  plantings: Planting[];
  sequences?: Record<string, Sequence>;
  [key: string]: unknown;
}

async function main() {
  console.log('=== Restoring Sequences via API ===\n');

  // Step 1: Read grandparent plan from backup to get sequences
  console.log(`Reading grandparent plan from: ${BACKUP_GRANDPARENT_PATH}`);
  const grandparentDb = new Database(BACKUP_GRANDPARENT_PATH, { readonly: true });
  const grandparentRow = grandparentDb.prepare("SELECT data FROM plan WHERE id = 'main'").get() as { data: string } | undefined;

  if (!grandparentRow) {
    console.error('Grandparent plan not found!');
    process.exit(1);
  }

  const grandparentPlan: Plan = JSON.parse(grandparentRow.data);
  const sequences = grandparentPlan.sequences ?? {};
  console.log(`Found ${Object.keys(sequences).length} sequences in grandparent plan\n`);

  if (Object.keys(sequences).length === 0) {
    console.log('No sequences to restore.');
    grandparentDb.close();
    return;
  }

  // Map grandparent planting specId+date to sequenceId
  const plantingSequenceMap = new Map<string, { sequenceId: string; sequenceSlot?: number | null }>();
  for (const p of grandparentPlan.plantings ?? []) {
    if (p.sequenceId) {
      const key = `${p.specId}|${p.fieldStartDate}`;
      plantingSequenceMap.set(key, {
        sequenceId: p.sequenceId,
        sequenceSlot: p.sequenceSlot,
      });
    }
  }
  console.log(`Found ${plantingSequenceMap.size} plantings with sequence references\n`);
  grandparentDb.close();

  // Step 2: Get current plan via API
  console.log('Fetching current plan from API...');
  const response = await fetch(`${BASE_URL}/api/sqlite/${CURRENT_ID}`);
  if (!response.ok) {
    console.error('Failed to fetch current plan:', response.status);
    process.exit(1);
  }
  const { plan: currentPlan }: { plan: Plan } = await response.json();
  console.log(`Current plan has ${currentPlan.plantings?.length ?? 0} plantings`);
  console.log(`Current plan sequences: ${Object.keys(currentPlan.sequences ?? {}).length}\n`);

  // Step 3: Build the updates we need to make
  // We'll need to:
  // a) Add sequences to the plan
  // b) Update plantings with sequenceId/sequenceSlot

  // For now, let's use direct SQLite updates but properly recreate the plan state
  // and clear patches so hydration uses the fresh state.

  // Actually, the cleanest approach is to:
  // 1. Update the main db
  // 2. Delete all patches (lose undo history but get correct state)
  // 3. OR create a checkpoint at the current state

  console.log('The proper fix requires either:');
  console.log('1. Using store actions (createSequenceFromPlantings) - but that requires browser context');
  console.log('2. Clearing patches and updating main db');
  console.log('3. Creating a checkpoint from the updated main db');
  console.log('\nLet me apply option 3: update main db, then create a checkpoint');

  // Read current main db directly
  const currentDbPath = path.join(PLANS_DIR, `${CURRENT_ID}.db`);
  const currentDb = new Database(currentDbPath);

  // Get current data from main db
  const currentRow = currentDb.prepare("SELECT data FROM plan WHERE id = 'main'").get() as { data: string };
  const planData: Plan = JSON.parse(currentRow.data);

  // Add sequences
  planData.sequences = { ...planData.sequences, ...sequences };
  console.log(`Added ${Object.keys(sequences).length} sequences to plan`);

  // Update plantings with sequence references
  let updatedCount = 0;
  for (const p of planData.plantings ?? []) {
    const key = `${p.specId}|${p.fieldStartDate}`;
    const seqInfo = plantingSequenceMap.get(key);
    if (seqInfo) {
      p.sequenceId = seqInfo.sequenceId;
      p.sequenceSlot = seqInfo.sequenceSlot ?? undefined;
      updatedCount++;
    }
  }
  console.log(`Updated ${updatedCount} plantings with sequence references`);

  // Save to main db
  currentDb.prepare("UPDATE plan SET data = ? WHERE id = 'main'").run(JSON.stringify(planData));
  console.log('Updated main db');

  // Now clear patches so hydration uses the main db state directly
  const patchCount = (currentDb.prepare("SELECT COUNT(*) as count FROM patches").get() as { count: number }).count;
  console.log(`\nClearing ${patchCount} patches (losing undo history)...`);
  currentDb.prepare("DELETE FROM patches").run();
  currentDb.prepare("DELETE FROM redo_stack").run();
  currentDb.prepare("DELETE FROM checkpoint_metadata").run();

  currentDb.close();

  console.log('\n=== Done! ===');
  console.log('Hard refresh your browser to see the restored sequences.');
  console.log('Note: Undo history has been cleared for this plan.');
}

main().catch(console.error);
