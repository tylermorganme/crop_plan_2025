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
import { existsSync, mkdirSync, unlinkSync, readdirSync, readFileSync, writeFileSync } from 'fs';
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

  CREATE TABLE IF NOT EXISTS patches (
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
