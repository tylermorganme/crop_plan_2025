/**
 * SQLite Storage Layer
 *
 * Provides persistent storage for plans using SQLite databases.
 * Each plan gets its own database file in data/plans/.
 *
 * Schema:
 * - plan: Single row with current plan data as JSON blob
 * - patches: Immer patches for undo/time-travel (appended on mutations)
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync, unlinkSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import type { Plan } from './entities/plan';
import { CURRENT_SCHEMA_VERSION, migratePlan } from './migrations';
import type { Patch } from 'immer';

// =============================================================================
// TYPES
// =============================================================================

import type { PatchEntry } from './plan-types';

/** Patch entry as stored in SQLite database */
export interface StoredPatchEntry {
  id?: number;
  patches: Patch[];
  inversePatches: Patch[];
  description: string;
  createdAt: string;
}

/** Max number of patches to keep per plan (at ~700 bytes each, 10k = ~7MB) */
const MAX_STORED_PATCHES = 10000;

// =============================================================================
// PATCH TYPE CONVERSION
// =============================================================================

/** Convert client PatchEntry to storage format (drops timestamp, DB adds createdAt) */
export function toStoredPatch(entry: PatchEntry): Omit<StoredPatchEntry, 'id' | 'createdAt'> {
  return {
    patches: entry.patches,
    inversePatches: entry.inversePatches,
    description: entry.description,
  };
}

/** Convert stored patch to client PatchEntry format */
export function fromStoredPatch(stored: StoredPatchEntry): PatchEntry {
  return {
    patches: stored.patches,
    inversePatches: stored.inversePatches,
    description: stored.description,
    timestamp: new Date(stored.createdAt).getTime(),
  };
}

/** Summary of a plan for listing */
export interface PlanSummary {
  id: string;
  name: string;
  version?: number;
  createdAt: number;
  lastModified: number;
  cropCount: number;
  year: number;
  schemaVersion?: number;
  notes?: string;
}

/** Error thrown when plan is from a newer schema version */
export class PlanFromFutureError extends Error {
  constructor(
    public readonly planVersion: number,
    public readonly appVersion: number
  ) {
    super(
      `Plan schema version ${planVersion} is newer than app version ${appVersion}. Please update the app.`
    );
    this.name = 'PlanFromFutureError';
  }
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const PLANS_DIR = join(process.cwd(), 'data', 'plans');
const INDEX_FILE = join(PLANS_DIR, 'index.json');

/** Ensure plans directory exists */
function ensurePlansDir(): void {
  if (!existsSync(PLANS_DIR)) {
    mkdirSync(PLANS_DIR, { recursive: true });
  }
}

/** Get path to a plan's database file */
function getDbPath(planId: string): string {
  return join(PLANS_DIR, `${planId}.db`);
}

// =============================================================================
// DATABASE SCHEMA
// =============================================================================

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS plan (
    id TEXT PRIMARY KEY DEFAULT 'main',
    data JSON NOT NULL,
    schema_version INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Undo history: patches applied to get to current state
  CREATE TABLE IF NOT EXISTS patches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patches JSON NOT NULL,
    inverse_patches JSON NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Redo stack: patches that were undone (LIFO order by id DESC)
  CREATE TABLE IF NOT EXISTS redo_stack (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patches JSON NOT NULL,
    inverse_patches JSON NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Checkpoint metadata: tracks which patches are included in each checkpoint
  CREATE TABLE IF NOT EXISTS checkpoint_metadata (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    last_patch_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_patches_time ON patches(created_at);
  CREATE INDEX IF NOT EXISTS idx_checkpoint_metadata_time ON checkpoint_metadata(created_at);
`;

// =============================================================================
// DATABASE OPERATIONS
// =============================================================================

/**
 * Open a plan database, creating it with schema if needed.
 * Caller is responsible for closing the database.
 */
export function openPlanDb(planId: string): Database.Database {
  ensurePlansDir();
  const dbPath = getDbPath(planId);
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Initialize schema
  db.exec(SCHEMA);

  return db;
}

/**
 * Check if a plan database exists.
 */
export function planExists(planId: string): boolean {
  return existsSync(getDbPath(planId));
}

/**
 * Load a plan from its database using hydration.
 * Reconstructs the plan from checkpoint + patches.
 * Runs migrations if the plan is on an older schema version.
 *
 * @throws PlanFromFutureError if plan is from a newer schema version
 */
export function loadPlan(planId: string): Plan | null {
  if (!planExists(planId)) {
    return null;
  }

  // Use hydration to reconstruct plan from checkpoint + patches
  return hydratePlan(planId);
}

/**
 * Save a plan to its database.
 * Creates the database if it doesn't exist.
 */
export function savePlan(planId: string, plan: Plan): void {
  const db = openPlanDb(planId);
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO plan (id, data, schema_version, updated_at)
      VALUES ('main', ?, ?, datetime('now'))
    `);
    stmt.run(JSON.stringify(plan), plan.schemaVersion ?? CURRENT_SCHEMA_VERSION);
  } finally {
    db.close();
  }
}

/**
 * Delete a plan database.
 */
export function deletePlan(planId: string): boolean {
  const dbPath = getDbPath(planId);
  if (!existsSync(dbPath)) {
    return false;
  }

  // Also delete WAL and SHM files if they exist
  unlinkSync(dbPath);
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (existsSync(walPath)) unlinkSync(walPath);
  if (existsSync(shmPath)) unlinkSync(shmPath);

  // Update index
  const index = loadPlanIndex();
  const newIndex = index.filter((p) => p.id !== planId);
  savePlanIndex(newIndex);

  return true;
}

// =============================================================================
// PATCH OPERATIONS
// =============================================================================

/**
 * Append a patch entry to the plan's patch history.
 * Enforces MAX_STORED_PATCHES limit by removing oldest entries.
 */
export function appendPatch(planId: string, entry: Omit<StoredPatchEntry, 'id' | 'createdAt'>): number {
  const db = openPlanDb(planId);
  try {
    const stmt = db.prepare(`
      INSERT INTO patches (patches, inverse_patches, description)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(
      JSON.stringify(entry.patches),
      JSON.stringify(entry.inversePatches),
      entry.description
    );

    // Enforce limit - delete oldest patches if over limit
    const countResult = db.prepare('SELECT COUNT(*) as count FROM patches').get() as { count: number };
    if (countResult.count > MAX_STORED_PATCHES) {
      const deleteCount = countResult.count - MAX_STORED_PATCHES;
      db.prepare(`
        DELETE FROM patches WHERE id IN (
          SELECT id FROM patches ORDER BY id ASC LIMIT ?
        )
      `).run(deleteCount);
    }

    return result.lastInsertRowid as number;
  } finally {
    db.close();
  }
}

/**
 * Get all patches for a plan, ordered by creation time.
 */
export function getPatches(planId: string): StoredPatchEntry[] {
  if (!planExists(planId)) {
    return [];
  }

  const db = openPlanDb(planId);
  try {
    const rows = db
      .prepare(
        `
      SELECT id, patches, inverse_patches, description, created_at
      FROM patches
      ORDER BY created_at ASC, id ASC
    `
      )
      .all() as Array<{
      id: number;
      patches: string;
      inverse_patches: string;
      description: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      patches: JSON.parse(row.patches),
      inversePatches: JSON.parse(row.inverse_patches),
      description: row.description ?? '',
      createdAt: row.created_at,
    }));
  } finally {
    db.close();
  }
}

/**
 * Get the most recent patch entry.
 */
export function getLastPatch(planId: string): StoredPatchEntry | null {
  if (!planExists(planId)) {
    return null;
  }

  const db = openPlanDb(planId);
  try {
    const row = db
      .prepare(
        `
      SELECT id, patches, inverse_patches, description, created_at
      FROM patches
      ORDER BY id DESC
      LIMIT 1
    `
      )
      .get() as
      | {
          id: number;
          patches: string;
          inverse_patches: string;
          description: string | null;
          created_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      patches: JSON.parse(row.patches),
      inversePatches: JSON.parse(row.inverse_patches),
      description: row.description ?? '',
      createdAt: row.created_at,
    };
  } finally {
    db.close();
  }
}

/**
 * Delete a patch by ID.
 */
export function deletePatch(planId: string, patchId: number): boolean {
  if (!planExists(planId)) {
    return false;
  }

  const db = openPlanDb(planId);
  try {
    const stmt = db.prepare('DELETE FROM patches WHERE id = ?');
    const result = stmt.run(patchId);
    return result.changes > 0;
  } finally {
    db.close();
  }
}

/**
 * Clear all patches for a plan.
 */
export function clearPatches(planId: string): void {
  if (!planExists(planId)) {
    return;
  }

  const db = openPlanDb(planId);
  try {
    db.prepare('DELETE FROM patches').run();
  } finally {
    db.close();
  }
}

// =============================================================================
// REDO STACK OPERATIONS
// =============================================================================

/**
 * Push a patch entry to the redo stack.
 * Used when undoing an action.
 */
export function pushToRedoStack(planId: string, entry: Omit<StoredPatchEntry, 'id' | 'createdAt'>): number {
  const db = openPlanDb(planId);
  try {
    const stmt = db.prepare(`
      INSERT INTO redo_stack (patches, inverse_patches, description)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(
      JSON.stringify(entry.patches),
      JSON.stringify(entry.inversePatches),
      entry.description
    );
    return result.lastInsertRowid as number;
  } finally {
    db.close();
  }
}

/**
 * Pop the most recent entry from the redo stack (LIFO).
 * Returns null if redo stack is empty.
 */
export function popFromRedoStack(planId: string): StoredPatchEntry | null {
  if (!planExists(planId)) {
    return null;
  }

  const db = openPlanDb(planId);
  try {
    // Get the most recent entry
    const row = db
      .prepare(`
        SELECT id, patches, inverse_patches, description, created_at
        FROM redo_stack
        ORDER BY id DESC
        LIMIT 1
      `)
      .get() as {
        id: number;
        patches: string;
        inverse_patches: string;
        description: string | null;
        created_at: string;
      } | undefined;

    if (!row) {
      return null;
    }

    // Delete it
    db.prepare('DELETE FROM redo_stack WHERE id = ?').run(row.id);

    return {
      id: row.id,
      patches: JSON.parse(row.patches),
      inversePatches: JSON.parse(row.inverse_patches),
      description: row.description ?? '',
      createdAt: row.created_at,
    };
  } finally {
    db.close();
  }
}

/**
 * Clear all entries from the redo stack.
 * Called when a new mutation is made (invalidates redo history).
 */
export function clearRedoStack(planId: string): void {
  if (!planExists(planId)) {
    return;
  }

  const db = openPlanDb(planId);
  try {
    db.prepare('DELETE FROM redo_stack').run();
  } finally {
    db.close();
  }
}

/**
 * Get the count of entries in the redo stack.
 */
export function getRedoStackCount(planId: string): number {
  if (!planExists(planId)) {
    return 0;
  }

  const db = openPlanDb(planId);
  try {
    const result = db.prepare('SELECT COUNT(*) as count FROM redo_stack').get() as { count: number };
    return result.count;
  } finally {
    db.close();
  }
}

/**
 * Pop the most recent patch from the patches table (for undo).
 * Returns null if no patches exist.
 */
export function popLastPatch(planId: string): StoredPatchEntry | null {
  if (!planExists(planId)) {
    return null;
  }

  const db = openPlanDb(planId);
  try {
    // Get the most recent entry
    const row = db
      .prepare(`
        SELECT id, patches, inverse_patches, description, created_at
        FROM patches
        ORDER BY id DESC
        LIMIT 1
      `)
      .get() as {
        id: number;
        patches: string;
        inverse_patches: string;
        description: string | null;
        created_at: string;
      } | undefined;

    if (!row) {
      return null;
    }

    // Delete it
    db.prepare('DELETE FROM patches WHERE id = ?').run(row.id);

    return {
      id: row.id,
      patches: JSON.parse(row.patches),
      inversePatches: JSON.parse(row.inverse_patches),
      description: row.description ?? '',
      createdAt: row.created_at,
    };
  } finally {
    db.close();
  }
}

/**
 * Get the count of patches for a plan.
 */
export function getPatchCount(planId: string): number {
  if (!planExists(planId)) {
    return 0;
  }

  const db = openPlanDb(planId);
  try {
    const result = db.prepare('SELECT COUNT(*) as count FROM patches').get() as { count: number };
    return result.count;
  } finally {
    db.close();
  }
}

// =============================================================================
// PLAN INDEX
// =============================================================================

/**
 * Load the plan index (list of all plans with metadata).
 */
export function loadPlanIndex(): PlanSummary[] {
  ensurePlansDir();
  if (!existsSync(INDEX_FILE)) {
    return [];
  }

  try {
    const data = readFileSync(INDEX_FILE, 'utf-8');
    return JSON.parse(data) as PlanSummary[];
  } catch {
    return [];
  }
}

/**
 * Save the plan index.
 */
export function savePlanIndex(index: PlanSummary[]): void {
  ensurePlansDir();
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

/**
 * List all plans from the index.
 */
export function listPlans(): PlanSummary[] {
  return loadPlanIndex();
}

/**
 * Add or update a plan in the index.
 */
export function updatePlanIndex(plan: Plan): void {
  const index = loadPlanIndex();
  const existing = index.findIndex((p) => p.id === plan.id);
  const entry: PlanSummary = {
    id: plan.id,
    name: plan.metadata?.name ?? plan.id,
    version: plan.metadata?.version,
    createdAt: plan.metadata?.createdAt ?? Date.now(),
    lastModified: plan.metadata?.lastModified ?? Date.now(),
    cropCount: plan.plantings?.length ?? 0,
    year: plan.metadata?.year ?? new Date().getFullYear(),
    schemaVersion: plan.schemaVersion,
    notes: plan.notes,
  };

  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }

  // Sort by lastModified descending
  index.sort((a, b) => b.lastModified - a.lastModified);

  savePlanIndex(index);
}

/**
 * Scan for database files and rebuild the index.
 * Useful for recovering from a corrupted index or initial migration.
 */
export function rebuildPlanIndex(): PlanSummary[] {
  ensurePlansDir();
  const dbFiles = readdirSync(PLANS_DIR).filter(
    (f) => f.endsWith('.db') && !f.endsWith('-wal') && !f.endsWith('-shm')
  );

  const index: PlanSummary[] = [];

  for (const file of dbFiles) {
    const planId = file.replace('.db', '');
    try {
      const plan = loadPlan(planId);
      if (plan) {
        index.push({
          id: planId,
          name: plan.metadata?.name ?? planId,
          version: plan.metadata?.version,
          createdAt: plan.metadata?.createdAt ?? Date.now(),
          lastModified: plan.metadata?.lastModified ?? Date.now(),
          cropCount: plan.plantings?.length ?? 0,
          year: plan.metadata?.year ?? new Date().getFullYear(),
          schemaVersion: plan.schemaVersion ?? CURRENT_SCHEMA_VERSION,
          notes: plan.notes,
        });
      }
    } catch (e) {
      // Skip plans that fail to load
      console.warn(`Failed to load plan ${planId}:`, e);
    }
  }

  // Sort by lastModified descending
  index.sort((a, b) => b.lastModified - a.lastModified);

  savePlanIndex(index);
  return index;
}

// =============================================================================
// CHECKPOINTS (full database copies)
// =============================================================================

/** Checkpoint metadata */
export interface CheckpointInfo {
  id: string;
  name: string;
  createdAt: number;
}

/** Checkpoint metadata with patch tracking (stored in database) */
export interface CheckpointMetadata {
  id: string;
  name: string;
  lastPatchId: number;
  createdAt: string;
}

/** Get path to a plan's checkpoints directory */
function getCheckpointsDir(planId: string): string {
  return join(PLANS_DIR, `${planId}.checkpoints`);
}

/** Get path to checkpoints index file */
function getCheckpointsIndexPath(planId: string): string {
  return join(getCheckpointsDir(planId), 'index.json');
}

/** Get path to a specific checkpoint database */
function getCheckpointDbPath(planId: string, checkpointId: string): string {
  return join(getCheckpointsDir(planId), `${checkpointId}.db`);
}

/** Ensure checkpoints directory exists for a plan */
function ensureCheckpointsDir(planId: string): void {
  const dir = getCheckpointsDir(planId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Load checkpoints index for a plan */
function loadCheckpointsIndex(planId: string): CheckpointInfo[] {
  const indexPath = getCheckpointsIndexPath(planId);
  if (!existsSync(indexPath)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch {
    return [];
  }
}

/** Save checkpoints index for a plan */
function saveCheckpointsIndex(planId: string, index: CheckpointInfo[]): void {
  ensureCheckpointsDir(planId);
  writeFileSync(getCheckpointsIndexPath(planId), JSON.stringify(index, null, 2));
}

/**
 * Create a checkpoint (copy of the plan's database).
 * Returns the checkpoint ID.
 */
export function createCheckpoint(planId: string, name: string): string {
  if (!planExists(planId)) {
    throw new Error(`Plan ${planId} not found`);
  }

  ensureCheckpointsDir(planId);

  const timestamp = Date.now();
  const checkpointId = crypto.randomUUID();

  // Copy the database file
  const srcPath = getDbPath(planId);
  const destPath = getCheckpointDbPath(planId, checkpointId);
  copyFileSync(srcPath, destPath);

  // Update index
  const index = loadCheckpointsIndex(planId);
  index.push({ id: checkpointId, name, createdAt: timestamp });
  // Sort newest first, with ID as tiebreaker for same timestamp
  index.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  saveCheckpointsIndex(planId, index);

  return checkpointId;
}

/**
 * List all checkpoints for a plan.
 */
export function listCheckpoints(planId: string): CheckpointInfo[] {
  const checkpoints = loadCheckpointsIndex(planId);
  // Return newest first, with ID as tiebreaker for same timestamp
  return checkpoints.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

/**
 * Restore a checkpoint (overwrites the plan's database with the checkpoint).
 * Returns the restored plan.
 */
export function restoreCheckpoint(planId: string, checkpointId: string): Plan {
  const checkpointPath = getCheckpointDbPath(planId, checkpointId);
  if (!existsSync(checkpointPath)) {
    throw new Error(`Checkpoint ${checkpointId} not found`);
  }

  const destPath = getDbPath(planId);

  // Copy checkpoint over current database
  copyFileSync(checkpointPath, destPath);

  // Load and return the restored plan
  const plan = loadPlan(planId);
  if (!plan) {
    throw new Error('Failed to load restored plan');
  }

  return plan;
}

/**
 * Delete a checkpoint.
 */
export function deleteCheckpoint(planId: string, checkpointId: string): void {
  const checkpointPath = getCheckpointDbPath(planId, checkpointId);
  if (existsSync(checkpointPath)) {
    unlinkSync(checkpointPath);
  }

  // Update index
  const index = loadCheckpointsIndex(planId);
  const filtered = index.filter((c) => c.id !== checkpointId);
  saveCheckpointsIndex(planId, filtered);
}

/**
 * Delete all checkpoints for a plan.
 * Called when deleting a plan.
 */
export function deleteAllCheckpoints(planId: string): void {
  const dir = getCheckpointsDir(planId);
  if (!existsSync(dir)) {
    return;
  }

  // Delete all files in the checkpoints directory
  const files = readdirSync(dir);
  for (const file of files) {
    unlinkSync(join(dir, file));
  }

  // Remove the directory
  try {
    const { rmdirSync } = require('fs');
    rmdirSync(dir);
  } catch {
    // Directory might not be empty or already removed
  }
}

// =============================================================================
// HYDRATION FUNCTIONS
// =============================================================================

/** Default threshold for auto-checkpoint creation */
const AUTO_CHECKPOINT_THRESHOLD = 500;

/**
 * Get all patches created after a given patch ID.
 * Used for hydration to apply only patches since last checkpoint.
 */
export function getPatchesAfter(planId: string, afterPatchId: number): StoredPatchEntry[] {
  if (!planExists(planId)) {
    return [];
  }

  const db = openPlanDb(planId);
  try {
    const rows = db
      .prepare(
        `
        SELECT id, patches, inverse_patches, description, created_at
        FROM patches
        WHERE id > ?
        ORDER BY id ASC
      `
      )
      .all(afterPatchId) as Array<{
      id: number;
      patches: string;
      inverse_patches: string;
      description: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      patches: JSON.parse(row.patches),
      inversePatches: JSON.parse(row.inverse_patches),
      description: row.description ?? '',
      createdAt: row.created_at,
    }));
  } finally {
    db.close();
  }
}

/**
 * Get the most recent checkpoint metadata.
 * Returns null if no checkpoints exist.
 */
export function getLatestCheckpointMetadata(planId: string): CheckpointMetadata | null {
  if (!planExists(planId)) {
    return null;
  }

  const db = openPlanDb(planId);
  try {
    const row = db
      .prepare(
        `
        SELECT id, name, last_patch_id, created_at
        FROM checkpoint_metadata
        ORDER BY last_patch_id DESC
        LIMIT 1
      `
      )
      .get() as
      | {
          id: string;
          name: string;
          last_patch_id: number;
          created_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      lastPatchId: row.last_patch_id,
      createdAt: row.created_at,
    };
  } finally {
    db.close();
  }
}

/**
 * Record checkpoint metadata in the database.
 * Called by createCheckpointWithMetadata.
 */
function recordCheckpointMetadata(
  planId: string,
  checkpointId: string,
  name: string,
  lastPatchId: number
): void {
  const db = openPlanDb(planId);
  try {
    db.prepare(
      `
      INSERT INTO checkpoint_metadata (id, name, last_patch_id)
      VALUES (?, ?, ?)
    `
    ).run(checkpointId, name, lastPatchId);
  } finally {
    db.close();
  }
}

/**
 * Perform undo by moving the last patch to the redo stack.
 * No plan loading or saving - patches are the source of truth.
 * Returns the description of what was undone, or null if nothing to undo.
 */
export function undoPatch(planId: string): { description: string } | null {
  if (!planExists(planId)) {
    return null;
  }

  const db = openPlanDb(planId);
  try {
    // Get the most recent patch
    const row = db
      .prepare(
        `
        SELECT id, patches, inverse_patches, description, created_at
        FROM patches
        ORDER BY id DESC
        LIMIT 1
      `
      )
      .get() as
      | {
          id: number;
          patches: string;
          inverse_patches: string;
          description: string | null;
          created_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    // Move to redo stack (in a transaction)
    db.prepare('BEGIN TRANSACTION').run();
    try {
      // Delete from patches
      db.prepare('DELETE FROM patches WHERE id = ?').run(row.id);

      // Insert into redo_stack
      db.prepare(
        `
        INSERT INTO redo_stack (patches, inverse_patches, description)
        VALUES (?, ?, ?)
      `
      ).run(row.patches, row.inverse_patches, row.description);

      db.prepare('COMMIT').run();
    } catch (error) {
      db.prepare('ROLLBACK').run();
      throw error;
    }

    return { description: row.description ?? '' };
  } finally {
    db.close();
  }
}

/**
 * Perform redo by moving the last redo entry back to patches.
 * Returns the description of what was redone, or null if nothing to redo.
 */
export function redoPatch(planId: string): { description: string } | null {
  if (!planExists(planId)) {
    return null;
  }

  const db = openPlanDb(planId);
  try {
    // Get the most recent redo entry
    const row = db
      .prepare(
        `
        SELECT id, patches, inverse_patches, description, created_at
        FROM redo_stack
        ORDER BY id DESC
        LIMIT 1
      `
      )
      .get() as
      | {
          id: number;
          patches: string;
          inverse_patches: string;
          description: string | null;
          created_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    // Move to patches table (in a transaction)
    db.prepare('BEGIN TRANSACTION').run();
    try {
      // Delete from redo_stack
      db.prepare('DELETE FROM redo_stack WHERE id = ?').run(row.id);

      // Insert into patches
      db.prepare(
        `
        INSERT INTO patches (patches, inverse_patches, description)
        VALUES (?, ?, ?)
      `
      ).run(row.patches, row.inverse_patches, row.description);

      db.prepare('COMMIT').run();
    } catch (error) {
      db.prepare('ROLLBACK').run();
      throw error;
    }

    return { description: row.description ?? '' };
  } finally {
    db.close();
  }
}

/**
 * Count patches since the last checkpoint.
 * Used by maybeCreateCheckpoint to determine if auto-checkpoint is needed.
 */
export function getPatchesSinceCheckpointCount(planId: string): number {
  const metadata = getLatestCheckpointMetadata(planId);
  const lastPatchId = metadata?.lastPatchId ?? 0;
  return getPatchesAfter(planId, lastPatchId).length;
}

/**
 * Create a checkpoint and record its metadata.
 * This hydrates the current state, saves it to the plan table,
 * then copies the .db file as a checkpoint.
 */
export function createCheckpointWithMetadata(planId: string, name: string): string {
  if (!planExists(planId)) {
    throw new Error(`Plan ${planId} not found`);
  }

  // First, hydrate the plan to get current state
  const currentPlan = hydratePlan(planId);

  // Save hydrated state to plan table
  savePlan(planId, currentPlan);

  // Get last patch ID for metadata
  const lastPatch = getLastPatch(planId);
  const lastPatchId = lastPatch?.id ?? 0;

  ensureCheckpointsDir(planId);

  const checkpointId = crypto.randomUUID();

  // Copy the database file
  const srcPath = getDbPath(planId);
  const destPath = getCheckpointDbPath(planId, checkpointId);
  copyFileSync(srcPath, destPath);

  // Update file-based index (for listCheckpoints compatibility)
  const index = loadCheckpointsIndex(planId);
  index.push({ id: checkpointId, name, createdAt: Date.now() });
  index.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  saveCheckpointsIndex(planId, index);

  // Record metadata in database
  recordCheckpointMetadata(planId, checkpointId, name, lastPatchId);

  return checkpointId;
}

/**
 * Create a checkpoint if patches since last checkpoint exceeds threshold.
 * Returns the checkpoint ID if created, null otherwise.
 */
export function maybeCreateCheckpoint(
  planId: string,
  threshold: number = AUTO_CHECKPOINT_THRESHOLD
): string | null {
  const patchesSinceCheckpoint = getPatchesSinceCheckpointCount(planId);

  if (patchesSinceCheckpoint >= threshold) {
    return createCheckpointWithMetadata(planId, `Auto-checkpoint (${patchesSinceCheckpoint} patches)`);
  }

  return null;
}

/**
 * Load plan data from a checkpoint database.
 * Used internally by hydratePlan.
 */
function loadPlanFromCheckpointDb(checkpointDbPath: string): Plan | null {
  if (!existsSync(checkpointDbPath)) {
    return null;
  }

  const db = new Database(checkpointDbPath);
  try {
    const row = db.prepare('SELECT data, schema_version FROM plan WHERE id = ?').get('main') as
      | { data: string; schema_version: number }
      | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.data) as Plan;
  } finally {
    db.close();
  }
}

/**
 * Reconstruct a plan from checkpoint + patches.
 * This is THE way to load a plan. No fallback.
 *
 * Algorithm:
 * 1. Find latest checkpoint (if any)
 * 2. Load plan from checkpoint database (or main db if no checkpoint)
 * 3. Get patches created after checkpoint
 * 4. Apply patches sequentially
 * 5. Run migrations if needed
 * 6. Return reconstructed plan
 *
 * @throws Error if plan doesn't exist or hydration fails
 */
export function hydratePlan(planId: string): Plan {
  if (!planExists(planId)) {
    throw new Error(`Plan ${planId} not found`);
  }

  // Import applyPatches from immer (lazy import to avoid circular deps)
  const { applyPatches, enablePatches } = require('immer');
  enablePatches();

  // Get latest checkpoint metadata
  const checkpointMetadata = getLatestCheckpointMetadata(planId);

  let basePlan: Plan | null;
  let patchesAfterCheckpoint: StoredPatchEntry[];

  if (checkpointMetadata) {
    // Load from checkpoint .db file
    const checkpointDbPath = getCheckpointDbPath(planId, checkpointMetadata.id);
    basePlan = loadPlanFromCheckpointDb(checkpointDbPath);

    if (!basePlan) {
      // Checkpoint file missing - fall back to main db
      // (This shouldn't happen, but handle gracefully during migration)
      basePlan = loadPlanFromMainDb(planId);
      patchesAfterCheckpoint = getPatchesAfter(planId, 0);
    } else {
      // Only get patches after the checkpoint
      patchesAfterCheckpoint = getPatchesAfter(planId, checkpointMetadata.lastPatchId);
    }
  } else {
    // No checkpoint - load from main db and apply all patches
    basePlan = loadPlanFromMainDb(planId);
    patchesAfterCheckpoint = getPatchesAfter(planId, 0);
  }

  if (!basePlan) {
    throw new Error(`Failed to load base plan for ${planId}`);
  }

  // Apply patches sequentially
  let currentPlan = basePlan;
  for (const patchEntry of patchesAfterCheckpoint) {
    try {
      currentPlan = applyPatches(currentPlan, patchEntry.patches);
    } catch (error) {
      throw new Error(
        `Failed to apply patch ${patchEntry.id} (${patchEntry.description}): ${error}`
      );
    }
  }

  // Check for plan from the future
  const storedVersion = currentPlan.schemaVersion ?? 1;
  if (storedVersion > CURRENT_SCHEMA_VERSION) {
    throw new PlanFromFutureError(storedVersion, CURRENT_SCHEMA_VERSION);
  }

  // Run migrations if needed
  if (storedVersion < CURRENT_SCHEMA_VERSION) {
    currentPlan = migratePlan(currentPlan);

    // Create a checkpoint at the new schema version so we don't re-migrate every load
    // (Only if we have patches, otherwise the base plan is fine)
    if (patchesAfterCheckpoint.length > 0) {
      createCheckpointWithMetadata(planId, `Schema migration v${CURRENT_SCHEMA_VERSION}`);
    } else {
      // Just save the migrated plan to the main db
      savePlan(planId, currentPlan);
    }
  }

  return currentPlan;
}

/**
 * Load plan directly from the main database (plan table).
 * Used internally by hydratePlan when no checkpoint exists.
 */
function loadPlanFromMainDb(planId: string): Plan | null {
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
