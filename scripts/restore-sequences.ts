/**
 * Restore sequences from grandparent plan to current plan.
 *
 * This script:
 * 1. Reads sequences from the grandparent plan (1769032930477-6g40ntg61)
 * 2. Reads the current plan (1770248310946-bqfcf3box)
 * 3. Adds the sequences to the current plan
 * 4. Updates plantings to reference their original sequence IDs
 *
 * Run with: npx ts-node scripts/restore-sequences.ts
 */

import Database from 'better-sqlite3';
import path from 'path';

const GRANDPARENT_ID = '1769032930477-6g40ntg61';
const CURRENT_ID = '1770248310946-bqfcf3box';
const PLANS_DIR = path.join(process.cwd(), 'data/plans');

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

interface Plan {
  id: string;
  plantings: Planting[];
  sequences?: Record<string, unknown>;
  [key: string]: unknown;
}

function main() {
  console.log('=== Restoring Sequences from Grandparent Plan ===\n');

  // Read grandparent plan from backup
  console.log(`Reading grandparent plan from: ${BACKUP_GRANDPARENT_PATH}`);
  const grandparentDb = new Database(BACKUP_GRANDPARENT_PATH, { readonly: true });
  const grandparentRow = grandparentDb.prepare("SELECT data FROM plan WHERE id = 'main'").get() as { data: string } | undefined;

  if (!grandparentRow) {
    console.error('Grandparent plan not found!');
    process.exit(1);
  }

  const grandparentPlan: Plan = JSON.parse(grandparentRow.data);
  const sequences = grandparentPlan.sequences;
  console.log(`Found ${Object.keys(sequences ?? {}).length} sequences in grandparent plan\n`);

  if (!sequences || Object.keys(sequences).length === 0) {
    console.log('No sequences to restore.');
    grandparentDb.close();
    return;
  }

  // Map grandparent planting specId+date to sequenceId
  const plantingSequenceMap = new Map<string, { sequenceId: string; sequenceSlot?: number | null }>();
  for (const p of grandparentPlan.plantings ?? []) {
    if (p.sequenceId) {
      // Use specId + fieldStartDate as key to match plantings
      const key = `${p.specId}|${p.fieldStartDate}`;
      plantingSequenceMap.set(key, {
        sequenceId: p.sequenceId,
        sequenceSlot: p.sequenceSlot,
      });
    }
  }
  console.log(`Found ${plantingSequenceMap.size} plantings with sequence references\n`);

  // Read current plan
  const currentPath = path.join(PLANS_DIR, `${CURRENT_ID}.db`);
  console.log(`Reading current plan from: ${currentPath}`);
  const currentDb = new Database(currentPath);
  const currentRow = currentDb.prepare("SELECT data FROM plan WHERE id = 'main'").get() as { data: string } | undefined;

  if (!currentRow) {
    console.error('Current plan not found!');
    grandparentDb.close();
    currentDb.close();
    process.exit(1);
  }

  const currentPlan: Plan = JSON.parse(currentRow.data);
  console.log(`Current plan has ${currentPlan.plantings?.length ?? 0} plantings`);
  console.log(`Current plan sequences: ${currentPlan.sequences ? Object.keys(currentPlan.sequences).length : 'none'}\n`);

  // Add sequences to current plan
  currentPlan.sequences = sequences;
  console.log('Added sequences to current plan');

  // Update plantings with sequence references
  let updatedCount = 0;
  for (const p of currentPlan.plantings ?? []) {
    const key = `${p.specId}|${p.fieldStartDate}`;
    const seqInfo = plantingSequenceMap.get(key);
    if (seqInfo) {
      p.sequenceId = seqInfo.sequenceId;
      p.sequenceSlot = seqInfo.sequenceSlot ?? undefined;
      updatedCount++;
      console.log(`  Updated ${p.id}: ${p.specId} -> sequence ${seqInfo.sequenceId}`);
    }
  }
  console.log(`\nUpdated ${updatedCount} plantings with sequence references`);

  // Save back to database
  const updateStmt = currentDb.prepare("UPDATE plan SET data = ? WHERE id = 'main'");
  updateStmt.run(JSON.stringify(currentPlan));
  console.log('\nSaved updated plan to database');

  grandparentDb.close();
  currentDb.close();

  console.log('\n=== Done! ===');
  console.log('Restart the app to see the restored sequences.');
}

main();
