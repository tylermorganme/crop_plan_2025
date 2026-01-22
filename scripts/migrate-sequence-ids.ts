/**
 * One-off migration script to convert UUID sequence IDs to clean S1, S2, etc. format.
 *
 * Usage: npx tsx scripts/migrate-sequence-ids.ts <planId>
 *
 * This script:
 * 1. Loads the plan from SQLite
 * 2. Maps old UUID sequence IDs to new clean IDs (S1, S2, etc.)
 * 3. Updates the sequences record with new IDs
 * 4. Updates all plantings' sequenceId references
 * 5. Saves the updated plan back to SQLite
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const PLANS_DIR = path.join(process.cwd(), 'data', 'plans');

function migrateSequenceIds(planId: string) {
  const dbPath = path.join(PLANS_DIR, `${planId}.db`);

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath);

  // Get current plan data
  const row = db.prepare('SELECT data FROM plan WHERE id = ?').get('main') as { data: string } | undefined;
  if (!row) {
    console.error('No plan data found in database');
    db.close();
    process.exit(1);
  }

  const plan = JSON.parse(row.data);

  // Check if there are sequences to migrate
  const sequences = plan.sequences ?? {};
  const sequenceIds = Object.keys(sequences);

  if (sequenceIds.length === 0) {
    console.log('No sequences found in plan');
    db.close();
    return;
  }

  // Check if already migrated (all IDs match S{number} pattern)
  const alreadyMigrated = sequenceIds.every(id => /^S\d+$/.test(id));
  if (alreadyMigrated) {
    console.log('Sequences already have clean IDs:', sequenceIds);
    db.close();
    return;
  }

  console.log('Found sequences to migrate:', sequenceIds);

  // Build mapping from old UUID to new clean ID
  const idMap: Record<string, string> = {};
  let nextId = 1;

  for (const oldId of sequenceIds) {
    if (/^S\d+$/.test(oldId)) {
      // Already clean, keep it and track the number
      idMap[oldId] = oldId;
      const num = parseInt(oldId.slice(1), 10);
      if (num >= nextId) nextId = num + 1;
    } else {
      // UUID - assign new clean ID
      idMap[oldId] = `S${nextId++}`;
    }
  }

  console.log('ID mapping:', idMap);

  // Update sequences record
  const newSequences: Record<string, unknown> = {};
  for (const [oldId, sequence] of Object.entries(sequences)) {
    const newId = idMap[oldId];
    newSequences[newId] = { ...(sequence as object), id: newId };
  }
  plan.sequences = newSequences;

  // Update plantings' sequenceId references
  const plantings = plan.plantings ?? [];
  let updatedCount = 0;
  for (const planting of plantings) {
    if (planting.sequenceId && idMap[planting.sequenceId]) {
      const oldId = planting.sequenceId;
      planting.sequenceId = idMap[oldId];
      if (oldId !== planting.sequenceId) {
        updatedCount++;
      }
    }
  }

  console.log(`Updated ${updatedCount} planting references`);

  // Save back to database
  db.prepare('UPDATE plan SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(plan), 'main');

  console.log('Migration complete!');
  console.log('New sequence IDs:', Object.keys(newSequences));

  db.close();
}

// Main
const planId = process.argv[2];
if (!planId) {
  console.error('Usage: npx tsx scripts/migrate-sequence-ids.ts <planId>');
  console.error('\nAvailable plans:');
  const files = fs.readdirSync(PLANS_DIR).filter(f => f.endsWith('.db'));
  for (const file of files) {
    console.error(`  ${file.replace('.db', '')}`);
  }
  process.exit(1);
}

migrateSequenceIds(planId);
