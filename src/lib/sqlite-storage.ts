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
  lastModified: number;
  cropCount: number;
  year: number;
  schemaVersion?: number;
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

  CREATE INDEX IF NOT EXISTS idx_patches_time ON patches(created_at);
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
 * Load a plan from its database.
 * Runs migrations if the plan is on an older schema version.
 *
 * @throws PlanFromFutureError if plan is from a newer schema version
 */
export function loadPlan(planId: string): Plan | null {
  if (!planExists(planId)) {
    return null;
  }

  const db = openPlanDb(planId);
  try {
    const row = db.prepare('SELECT data, schema_version FROM plan WHERE id = ?').get('main') as
      | { data: string; schema_version: number }
      | undefined;

    if (!row) {
      return null;
    }

    const plan = JSON.parse(row.data) as Plan;
    const storedVersion = row.schema_version;

    // Check for plan from the future
    if (storedVersion > CURRENT_SCHEMA_VERSION) {
      throw new PlanFromFutureError(storedVersion, CURRENT_SCHEMA_VERSION);
    }

    // Migrate if needed
    if (storedVersion < CURRENT_SCHEMA_VERSION) {
      const migrated = migratePlan(plan);
      savePlan(planId, migrated);
      return migrated;
    }

    return plan;
  } finally {
    db.close();
  }
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
    lastModified: plan.metadata?.lastModified ?? Date.now(),
    cropCount: plan.plantings?.length ?? 0,
    year: plan.metadata?.year ?? new Date().getFullYear(),
    schemaVersion: plan.schemaVersion,
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
          lastModified: plan.metadata?.lastModified ?? Date.now(),
          cropCount: plan.plantings?.length ?? 0,
          year: plan.metadata?.year ?? new Date().getFullYear(),
          schemaVersion: plan.schemaVersion ?? CURRENT_SCHEMA_VERSION,
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

  // Generate checkpoint ID from timestamp and sanitized name
  const timestamp = Date.now();
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const checkpointId = `${new Date(timestamp).toISOString().slice(0, 10)}_${safeName || 'checkpoint'}`;

  // Copy the database file
  const srcPath = getDbPath(planId);
  const destPath = getCheckpointDbPath(planId, checkpointId);
  copyFileSync(srcPath, destPath);

  // Update index
  const index = loadCheckpointsIndex(planId);
  index.push({ id: checkpointId, name, createdAt: timestamp });
  index.sort((a, b) => b.createdAt - a.createdAt); // Newest first
  saveCheckpointsIndex(planId, index);

  return checkpointId;
}

/**
 * List all checkpoints for a plan.
 */
export function listCheckpoints(planId: string): CheckpointInfo[] {
  const checkpoints = loadCheckpointsIndex(planId);
  // Return newest first
  return checkpoints.sort((a, b) => b.createdAt - a.createdAt);
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
