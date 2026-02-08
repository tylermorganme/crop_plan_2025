/**
 * Repair Broken Sequences
 *
 * Fixes 5 sequences (S14, S16, S18, S20, S21) that were corrupted by
 * a failed restore script. The damage pattern:
 *   - Missing slot 0 (anchor)
 *   - Duplicate plantings at anchor date assigned to wrong high slot numbers
 *
 * Fix strategy:
 *   - For each broken sequence, group members by date
 *   - Dates with duplicates: keep the best planting (bed assigned > most bedFeet), delete rest
 *   - Sort remaining by date ascending
 *   - Assign slots 0, 1, 2, ...
 *
 * Uses direct SQLite access to ensure both main DB and checkpoints are updated.
 *
 * Run with: npx tsx scripts/repair-sequences.ts
 */

import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const PLAN_ID = '1770248310946-bqfcf3box';
const DATA_DIR = join(__dirname, '..', 'data', 'plans');
const DB_PATH = join(DATA_DIR, `${PLAN_ID}.db`);
const CHECKPOINTS_DIR = join(DATA_DIR, `${PLAN_ID}.checkpoints`);
const BROKEN_SEQUENCES = ['S14', 'S16', 'S18', 'S20', 'S21'];

interface Planting {
  id: string;
  specId: string;
  sequenceId?: string;
  sequenceSlot?: number;
  fieldStartDate: string;
  startBed?: string;
  bedFeet: number;
  lastModified: number;
  [key: string]: unknown;
}

interface Plan {
  id: string;
  schemaVersion: number;
  plantings: Planting[];
  metadata: Record<string, unknown>;
  [key: string]: unknown;
}

function loadPlanDirect(): Plan {
  const db = new Database(DB_PATH);
  try {
    const row = db.prepare('SELECT data FROM plan WHERE id = ?').get('main') as { data: string };
    return JSON.parse(row.data) as Plan;
  } finally {
    db.close();
  }
}

function savePlanDirect(plan: Plan): void {
  const db = new Database(DB_PATH);
  try {
    db.prepare(
      `INSERT OR REPLACE INTO plan (id, data, schema_version, updated_at)
       VALUES ('main', ?, ?, datetime('now'))`
    ).run(JSON.stringify(plan), plan.schemaVersion);
  } finally {
    db.close();
  }
}

function clearPatchesDirect(): void {
  const db = new Database(DB_PATH);
  try {
    db.exec('DELETE FROM patches');
    // Also clear redo stack if it exists
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    if (tables.some(t => t.name === 'redo_stack')) {
      db.exec('DELETE FROM redo_stack');
    }
  } finally {
    db.close();
  }
}

function clearOldCheckpoints(): void {
  // Clear checkpoint metadata from main DB
  const db = new Database(DB_PATH);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    if (tables.some(t => t.name === 'checkpoint_metadata')) {
      db.exec('DELETE FROM checkpoint_metadata');
    }
  } finally {
    db.close();
  }

  // Delete old checkpoint files
  if (existsSync(CHECKPOINTS_DIR)) {
    const files = readdirSync(CHECKPOINTS_DIR);
    for (const file of files) {
      rmSync(join(CHECKPOINTS_DIR, file));
    }
  }
}

function createCheckpointDirect(name: string): string {
  if (!existsSync(CHECKPOINTS_DIR)) {
    mkdirSync(CHECKPOINTS_DIR, { recursive: true });
  }

  const checkpointId = randomUUID();
  const destPath = join(CHECKPOINTS_DIR, `${checkpointId}.db`);

  // Copy main DB as checkpoint
  copyFileSync(DB_PATH, destPath);

  // Record in checkpoint_metadata
  const db = new Database(DB_PATH);
  try {
    // Ensure table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint_metadata (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_patch_id INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.prepare(
      `INSERT INTO checkpoint_metadata (id, name, last_patch_id, created_at)
       VALUES (?, ?, 0, datetime('now'))`
    ).run(checkpointId, name);
  } finally {
    db.close();
  }

  // Update checkpoints index.json
  const indexPath = join(CHECKPOINTS_DIR, 'index.json');
  const index = [{ id: checkpointId, name, createdAt: Date.now() }];
  const { writeFileSync } = require('fs');
  writeFileSync(indexPath, JSON.stringify(index, null, 2));

  return checkpointId;
}

function pickBestPlanting(plantings: Planting[]): Planting {
  return plantings.sort((a, b) => {
    if (a.startBed && !b.startBed) return -1;
    if (!a.startBed && b.startBed) return 1;
    if (a.bedFeet !== b.bedFeet) return b.bedFeet - a.bedFeet;
    return a.id.localeCompare(b.id);
  })[0];
}

function repair() {
  console.log('='.repeat(70));
  console.log('SEQUENCE REPAIR SCRIPT');
  console.log('='.repeat(70));
  console.log();

  // 1. Load plan
  console.log('Loading plan from %s...', DB_PATH);
  const plan = loadPlanDirect();
  console.log('  %d total plantings', plan.plantings.length);
  console.log();

  const toDelete: string[] = [];
  const toUpdate: { id: string; sequenceSlot: number }[] = [];

  for (const seqId of BROKEN_SEQUENCES) {
    const members = plan.plantings.filter(p => p.sequenceId === seqId);
    console.log('--- %s: %d members ---', seqId, members.length);

    // Group by date
    const byDate = new Map<string, Planting[]>();
    for (const m of members) {
      const existing = byDate.get(m.fieldStartDate) || [];
      existing.push(m);
      byDate.set(m.fieldStartDate, existing);
    }

    // For each date group, keep the best, mark rest for deletion
    const keepers: Planting[] = [];
    for (const [date, group] of byDate) {
      const best = pickBestPlanting(group);
      keepers.push(best);
      const extras = group.filter(p => p.id !== best.id);
      if (extras.length > 0) {
        console.log('  date %s: keeping %s (%dft%s), deleting %s',
          date, best.id, best.bedFeet, best.startBed ? ' +bed' : '',
          extras.map(e => e.id).join(', '));
        toDelete.push(...extras.map(e => e.id));
      }
    }

    // Sort keepers by date ascending, assign slots 0, 1, 2...
    keepers.sort((a, b) => a.fieldStartDate.localeCompare(b.fieldStartDate));
    console.log('  Repaired slots:');
    for (let i = 0; i < keepers.length; i++) {
      const k = keepers[i];
      const oldSlot = k.sequenceSlot;
      console.log('    slot %d: %s date=%s %dft (was slot %s)',
        i, k.id, k.fieldStartDate, k.bedFeet, oldSlot);
      toUpdate.push({ id: k.id, sequenceSlot: i });
    }
    console.log();
  }

  console.log('SUMMARY:');
  console.log('  Plantings to delete: %d (%s)', toDelete.length, toDelete.join(', '));
  console.log('  Slots to reassign: %d', toUpdate.length);
  console.log();

  // 2. Apply changes to plan
  console.log('Applying changes...');
  const now = Date.now();

  plan.plantings = plan.plantings.filter(p => !toDelete.includes(p.id));

  for (const upd of toUpdate) {
    const planting = plan.plantings.find(p => p.id === upd.id);
    if (planting) {
      planting.sequenceSlot = upd.sequenceSlot;
      planting.lastModified = now;
    }
  }

  plan.metadata = { ...plan.metadata, lastModified: now };
  console.log('  Plan now has %d plantings', plan.plantings.length);

  // 3. Clear old state and save
  console.log('Clearing old checkpoints...');
  clearOldCheckpoints();

  console.log('Saving plan to main DB...');
  savePlanDirect(plan);

  console.log('Clearing patches...');
  clearPatchesDirect();

  console.log('Creating fresh checkpoint...');
  const cpId = createCheckpointDirect('Post sequence repair');
  console.log('  Checkpoint: %s', cpId);

  console.log();
  console.log('='.repeat(70));
  console.log('DONE. Refresh the app (hard refresh) to see fixed sequences.');
  console.log('='.repeat(70));

  // 4. Verify by re-reading
  console.log();
  console.log('VERIFICATION (re-reading from DB):');
  const verifyPlan = loadPlanDirect();
  for (const seqId of BROKEN_SEQUENCES) {
    const members = verifyPlan.plantings
      .filter(p => p.sequenceId === seqId)
      .sort((a, b) => (a.sequenceSlot ?? 999) - (b.sequenceSlot ?? 999));
    const hasAnchor = members.some(m => m.sequenceSlot === 0);
    const slots = members.map(m => m.sequenceSlot);
    const dupes = slots.length !== new Set(slots).size;
    const status = hasAnchor && !dupes ? 'OK' : 'STILL BROKEN';
    console.log('  %s [%s]: %d members, slots=[%s]',
      seqId, status, members.length, slots.join(','));
  }
}

repair();
