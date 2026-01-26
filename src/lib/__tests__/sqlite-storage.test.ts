import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';
import {
  openPlanDb,
  loadPlan,
  savePlan,
  deletePlan,
  planExists,
  appendPatch,
  getPatches,
  getLastPatch,
  deletePatch,
  clearPatches,
  listPlans,
  updatePlanIndex,
  loadPlanIndex,
  savePlanIndex,
  PlanFromFutureError,
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  deleteCheckpoint,
  deleteAllCheckpoints,
  undoPatch,
  redoPatch,
  getRedoStackCount,
  getPlanSchemaVersion,
  migrateStoredPatches,
} from '../sqlite-storage';
import { CURRENT_SCHEMA_VERSION } from '../migrations';
import type { Plan } from '../entities/plan';

// =============================================================================
// TEST SETUP
// =============================================================================

const TEST_PLAN_ID = 'test-plan-123';

// Create a minimal valid plan for testing
function createTestPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: TEST_PLAN_ID,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    metadata: {
      id: TEST_PLAN_ID,
      name: 'Test Plan',
      createdAt: Date.now(),
      lastModified: Date.now(),
      year: 2025,
    },
    beds: {},
    bedGroups: {},
    plantings: [],
    cropCatalog: {},
    changeLog: [],
    ...overrides,
  };
}

// Override the PLANS_DIR for testing
// We need to modify the module's behavior to use test directory
// For now, we'll use the actual directory but clean up after
const PLANS_DIR = join(process.cwd(), 'data', 'plans');

function cleanupTestPlan(): void {
  const dbPath = join(PLANS_DIR, `${TEST_PLAN_ID}.db`);
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  const checkpointsDir = join(PLANS_DIR, `${TEST_PLAN_ID}.checkpoints`);

  if (existsSync(dbPath)) rmSync(dbPath);
  if (existsSync(walPath)) rmSync(walPath);
  if (existsSync(shmPath)) rmSync(shmPath);
  if (existsSync(checkpointsDir)) rmSync(checkpointsDir, { recursive: true });
}

// =============================================================================
// TESTS
// =============================================================================

describe('sqlite-storage', () => {
  beforeEach(() => {
    cleanupTestPlan();
  });

  afterEach(() => {
    cleanupTestPlan();
  });

  describe('openPlanDb', () => {
    it('creates new plan database with correct schema', () => {
      const db = openPlanDb(TEST_PLAN_ID);
      try {
        // Check tables exist
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all() as Array<{ name: string }>;
        const tableNames = tables.map((t) => t.name);

        expect(tableNames).toContain('plan');
        expect(tableNames).toContain('patches');

        // Check plan table columns
        const planColumns = db.prepare('PRAGMA table_info(plan)').all() as Array<{ name: string }>;
        const planColumnNames = planColumns.map((c) => c.name);
        expect(planColumnNames).toContain('id');
        expect(planColumnNames).toContain('data');
        expect(planColumnNames).toContain('schema_version');
        expect(planColumnNames).toContain('created_at');
        expect(planColumnNames).toContain('updated_at');

        // Check patches table columns
        const patchColumns = db.prepare('PRAGMA table_info(patches)').all() as Array<{
          name: string;
        }>;
        const patchColumnNames = patchColumns.map((c) => c.name);
        expect(patchColumnNames).toContain('id');
        expect(patchColumnNames).toContain('patches');
        expect(patchColumnNames).toContain('inverse_patches');
        expect(patchColumnNames).toContain('description');
        expect(patchColumnNames).toContain('created_at');
      } finally {
        db.close();
      }
    });

    it('uses WAL journal mode', () => {
      const db = openPlanDb(TEST_PLAN_ID);
      try {
        const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
        expect(result[0].journal_mode).toBe('wal');
      } finally {
        db.close();
      }
    });
  });

  describe('savePlan and loadPlan', () => {
    it('round-trips plan data correctly', () => {
      const plan = createTestPlan({
        plantings: [
          {
            id: 'P1',
            configId: 'config-1',
            fieldStartDate: '2025-03-15',
            startBed: null,
            bedFeet: 50,
            lastModified: Date.now(),
          },
        ],
      });

      savePlan(TEST_PLAN_ID, plan);
      const loaded = loadPlan(TEST_PLAN_ID);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(plan.id);
      expect(loaded!.metadata.name).toBe(plan.metadata.name);
      expect(loaded!.plantings).toHaveLength(1);
      expect(loaded!.plantings![0].configId).toBe('config-1');
    });

    it('preserves all plan fields', () => {
      const plan = createTestPlan({
        beds: { 'bed-1': { id: 'bed-1', name: 'A1', lengthFt: 50, groupId: 'g1', displayOrder: 0 } },
        bedGroups: { g1: { id: 'g1', name: 'Row A', displayOrder: 0 } },
        cropCatalog: { 'crop-1': { id: 'crop-1', identifier: 'tomato-1', crop: 'Tomato' } as never },
        varieties: { 'var-1': { id: 'var-1', crop: 'Tomato', name: 'Cherokee Purple' } as never },
        seedMixes: { 'mix-1': { id: 'mix-1', name: 'Salad Mix' } as never },
        products: { 'prod-1': { id: 'prod-1', name: 'Tomatoes' } as never },
        markets: { 'market-1': { id: 'market-1', name: 'Farmers Market' } as never },
      });

      savePlan(TEST_PLAN_ID, plan);
      const loaded = loadPlan(TEST_PLAN_ID);

      expect(loaded!.beds).toHaveProperty('bed-1');
      expect(loaded!.bedGroups).toHaveProperty('g1');
      expect(loaded!.cropCatalog).toHaveProperty('crop-1');
      expect(loaded!.varieties).toHaveProperty('var-1');
      expect(loaded!.seedMixes).toHaveProperty('mix-1');
      expect(loaded!.products).toHaveProperty('prod-1');
      expect(loaded!.markets).toHaveProperty('market-1');
    });
  });

  describe('loadPlan edge cases', () => {
    it('returns null for non-existent plan', () => {
      const result = loadPlan('non-existent-plan-xyz');
      expect(result).toBeNull();
    });

    it('throws PlanFromFutureError for plan from future schema version', () => {
      // Create a plan with future schema version
      const db = openPlanDb(TEST_PLAN_ID);
      try {
        const futurePlan = createTestPlan({ schemaVersion: CURRENT_SCHEMA_VERSION + 10 });
        db.prepare(`
          INSERT INTO plan (id, data, schema_version)
          VALUES ('main', ?, ?)
        `).run(JSON.stringify(futurePlan), CURRENT_SCHEMA_VERSION + 10);
      } finally {
        db.close();
      }

      expect(() => loadPlan(TEST_PLAN_ID)).toThrow(PlanFromFutureError);
      expect(() => loadPlan(TEST_PLAN_ID)).toThrow(/newer than app version/);
    });

    it('runs migrations on load if schema version outdated', () => {
      // Create a plan with old schema version
      // v3 -> v4 migration adds products field
      const db = openPlanDb(TEST_PLAN_ID);
      try {
        const oldPlan = {
          id: TEST_PLAN_ID,
          schemaVersion: 3,
          metadata: {
            id: TEST_PLAN_ID,
            name: 'Old Plan',
            createdAt: Date.now(),
            lastModified: Date.now(),
            year: 2025,
          },
          beds: {},
          bedGroups: {},
          plantings: [],
          cropCatalog: {},
          changeLog: [],
          // Note: no products field (added in v4)
        };
        db.prepare(`
          INSERT INTO plan (id, data, schema_version)
          VALUES ('main', ?, ?)
        `).run(JSON.stringify(oldPlan), 3);
      } finally {
        db.close();
      }

      const loaded = loadPlan(TEST_PLAN_ID);

      expect(loaded).not.toBeNull();
      expect(loaded!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      // v4 migration adds products field
      expect(loaded!.products).toBeDefined();
    });
  });

  describe('planExists', () => {
    it('returns false for non-existent plan', () => {
      expect(planExists('non-existent-xyz')).toBe(false);
    });

    it('returns true after saving a plan', () => {
      savePlan(TEST_PLAN_ID, createTestPlan());
      expect(planExists(TEST_PLAN_ID)).toBe(true);
    });
  });

  describe('deletePlan', () => {
    it('removes database file', () => {
      savePlan(TEST_PLAN_ID, createTestPlan());
      expect(planExists(TEST_PLAN_ID)).toBe(true);

      const result = deletePlan(TEST_PLAN_ID);

      expect(result).toBe(true);
      expect(planExists(TEST_PLAN_ID)).toBe(false);
    });

    it('returns false for non-existent plan', () => {
      const result = deletePlan('non-existent-xyz');
      expect(result).toBe(false);
    });
  });

  describe('patch operations', () => {
    beforeEach(() => {
      savePlan(TEST_PLAN_ID, createTestPlan());
    });

    it('appendPatch stores patch entry', () => {
      const patchId = appendPatch(TEST_PLAN_ID, {
        patches: [{ op: 'replace', path: ['metadata', 'name'], value: 'New Name' }],
        inversePatches: [{ op: 'replace', path: ['metadata', 'name'], value: 'Test Plan' }],
        description: 'Renamed plan',
      });

      expect(patchId).toBeGreaterThan(0);

      const patches = getPatches(TEST_PLAN_ID);
      expect(patches).toHaveLength(1);
      expect(patches[0].description).toBe('Renamed plan');
    });

    it('getPatches retrieves patches in order', () => {
      appendPatch(TEST_PLAN_ID, {
        patches: [{ op: 'add', path: ['plantings', 0], value: { id: 'P1' } }],
        inversePatches: [{ op: 'remove', path: ['plantings', 0] }],
        description: 'First change',
      });

      appendPatch(TEST_PLAN_ID, {
        patches: [{ op: 'add', path: ['plantings', 1], value: { id: 'P2' } }],
        inversePatches: [{ op: 'remove', path: ['plantings', 1] }],
        description: 'Second change',
      });

      appendPatch(TEST_PLAN_ID, {
        patches: [{ op: 'add', path: ['plantings', 2], value: { id: 'P3' } }],
        inversePatches: [{ op: 'remove', path: ['plantings', 2] }],
        description: 'Third change',
      });

      const patches = getPatches(TEST_PLAN_ID);

      expect(patches).toHaveLength(3);
      expect(patches[0].description).toBe('First change');
      expect(patches[1].description).toBe('Second change');
      expect(patches[2].description).toBe('Third change');
    });

    it('getLastPatch returns most recent patch', () => {
      appendPatch(TEST_PLAN_ID, {
        patches: [],
        inversePatches: [],
        description: 'First',
      });
      appendPatch(TEST_PLAN_ID, {
        patches: [],
        inversePatches: [],
        description: 'Last',
      });

      const last = getLastPatch(TEST_PLAN_ID);

      expect(last).not.toBeNull();
      expect(last!.description).toBe('Last');
    });

    it('getLastPatch returns null for plan with no patches', () => {
      const last = getLastPatch(TEST_PLAN_ID);
      expect(last).toBeNull();
    });

    it('deletePatch removes specific patch', () => {
      appendPatch(TEST_PLAN_ID, {
        patches: [],
        inversePatches: [],
        description: 'Keep',
      });
      const id2 = appendPatch(TEST_PLAN_ID, {
        patches: [],
        inversePatches: [],
        description: 'Delete',
      });

      deletePatch(TEST_PLAN_ID, id2);

      const patches = getPatches(TEST_PLAN_ID);
      expect(patches).toHaveLength(1);
      expect(patches[0].description).toBe('Keep');
    });

    it('clearPatches removes all patches', () => {
      appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: '1' });
      appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: '2' });
      appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: '3' });

      clearPatches(TEST_PLAN_ID);

      const patches = getPatches(TEST_PLAN_ID);
      expect(patches).toHaveLength(0);
    });

    it('getPatches returns empty array for non-existent plan', () => {
      const patches = getPatches('non-existent-xyz');
      expect(patches).toEqual([]);
    });
  });

  describe('plan index', () => {
    const originalIndex = loadPlanIndex();

    afterEach(() => {
      // Restore original index
      savePlanIndex(originalIndex);
    });

    it('updatePlanIndex adds new plan to index', () => {
      const plan = createTestPlan({ metadata: { ...createTestPlan().metadata, name: 'Test Plan' } });
      updatePlanIndex(plan);

      const index = loadPlanIndex();
      const entry = index.find((p) => p.id === TEST_PLAN_ID);

      expect(entry).toBeDefined();
      expect(entry!.name).toBe('Test Plan');
      expect(entry!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('updatePlanIndex updates existing plan in index', () => {
      const plan1 = createTestPlan({ metadata: { ...createTestPlan().metadata, name: 'Original Name' } });
      const plan2 = createTestPlan({ metadata: { ...createTestPlan().metadata, name: 'Updated Name' } });
      updatePlanIndex(plan1);
      updatePlanIndex(plan2);

      const index = loadPlanIndex();
      const entries = index.filter((p) => p.id === TEST_PLAN_ID);

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Updated Name');
    });

    it('listPlans returns index entries', () => {
      const plan = createTestPlan({ metadata: { ...createTestPlan().metadata, name: 'Listed Plan' } });
      updatePlanIndex(plan);

      const plans = listPlans();
      const entry = plans.find((p) => p.id === TEST_PLAN_ID);

      expect(entry).toBeDefined();
    });

    it('deletePlan removes entry from index', () => {
      const plan = createTestPlan({ metadata: { ...createTestPlan().metadata, name: 'To Delete' } });
      savePlan(TEST_PLAN_ID, plan);
      updatePlanIndex(plan);

      deletePlan(TEST_PLAN_ID);

      const index = loadPlanIndex();
      const entry = index.find((p) => p.id === TEST_PLAN_ID);
      expect(entry).toBeUndefined();
    });
  });

  describe('checkpoints', () => {
    beforeEach(() => {
      // Create a plan to work with
      const plan = createTestPlan();
      savePlan(TEST_PLAN_ID, plan);
    });

    it('createCheckpoint creates a checkpoint database copy', () => {
      const checkpointId = createCheckpoint(TEST_PLAN_ID, 'First Checkpoint');

      // ID is a UUID
      expect(checkpointId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      const checkpointPath = join(PLANS_DIR, `${TEST_PLAN_ID}.checkpoints`, `${checkpointId}.db`);
      expect(existsSync(checkpointPath)).toBe(true);
    });

    it('listCheckpoints returns all checkpoints sorted by creation time', () => {
      createCheckpoint(TEST_PLAN_ID, 'Checkpoint 1');
      // Small delay to ensure different timestamps
      const start = Date.now();
      while (Date.now() === start) { /* spin until next millisecond */ }
      createCheckpoint(TEST_PLAN_ID, 'Checkpoint 2');

      const checkpoints = listCheckpoints(TEST_PLAN_ID);

      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].name).toBe('Checkpoint 2'); // Newest first
      expect(checkpoints[1].name).toBe('Checkpoint 1');
    });

    it('restoreCheckpoint overwrites plan with checkpoint data', () => {
      // Save initial state
      const initialPlan = createTestPlan({ plantings: [] });
      savePlan(TEST_PLAN_ID, initialPlan);

      // Create checkpoint
      const checkpointId = createCheckpoint(TEST_PLAN_ID, 'Before Changes');

      // Modify the plan
      const modifiedPlan = createTestPlan({
        plantings: [{ id: 'test-planting', configId: 'test-config' } as never],
      });
      savePlan(TEST_PLAN_ID, modifiedPlan);

      // Verify modification
      const afterModify = loadPlan(TEST_PLAN_ID);
      expect(afterModify?.plantings).toHaveLength(1);

      // Restore checkpoint
      const restored = restoreCheckpoint(TEST_PLAN_ID, checkpointId);

      expect(restored.plantings).toHaveLength(0);

      // Verify the database was overwritten
      const afterRestore = loadPlan(TEST_PLAN_ID);
      expect(afterRestore?.plantings).toHaveLength(0);
    });

    it('deleteCheckpoint removes a checkpoint', () => {
      const checkpointId = createCheckpoint(TEST_PLAN_ID, 'To Delete');

      const before = listCheckpoints(TEST_PLAN_ID);
      expect(before).toHaveLength(1);

      deleteCheckpoint(TEST_PLAN_ID, checkpointId);

      const after = listCheckpoints(TEST_PLAN_ID);
      expect(after).toHaveLength(0);

      const checkpointPath = join(PLANS_DIR, `${TEST_PLAN_ID}.checkpoints`, `${checkpointId}.db`);
      expect(existsSync(checkpointPath)).toBe(false);
    });

    it('deleteAllCheckpoints removes all checkpoints', () => {
      createCheckpoint(TEST_PLAN_ID, 'Checkpoint 1');
      createCheckpoint(TEST_PLAN_ID, 'Checkpoint 2');
      createCheckpoint(TEST_PLAN_ID, 'Checkpoint 3');

      const before = listCheckpoints(TEST_PLAN_ID);
      expect(before).toHaveLength(3);

      deleteAllCheckpoints(TEST_PLAN_ID);

      const after = listCheckpoints(TEST_PLAN_ID);
      expect(after).toHaveLength(0);
    });

    it('createCheckpoint throws for non-existent plan', () => {
      expect(() => createCheckpoint('non-existent-plan', 'Test')).toThrow('Plan non-existent-plan not found');
    });

    it('restoreCheckpoint throws for non-existent checkpoint', () => {
      expect(() => restoreCheckpoint(TEST_PLAN_ID, 'non-existent-checkpoint')).toThrow(
        'Checkpoint non-existent-checkpoint not found'
      );
    });

    it('checkpoint includes undo/redo history', () => {
      // Add some patches
      appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Edit 1' });
      appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Edit 2' });

      // Create checkpoint (should include patches)
      const checkpointId = createCheckpoint(TEST_PLAN_ID, 'With History');

      // Clear patches from live plan
      clearPatches(TEST_PLAN_ID);
      expect(getPatches(TEST_PLAN_ID)).toHaveLength(0);

      // Restore checkpoint
      restoreCheckpoint(TEST_PLAN_ID, checkpointId);

      // Patches should be restored
      const patches = getPatches(TEST_PLAN_ID);
      expect(patches).toHaveLength(2);
      expect(patches[0].description).toBe('Edit 1');
      expect(patches[1].description).toBe('Edit 2');
    });
  });

  describe('database schema migration', () => {
    it('sets PRAGMA user_version after migration', () => {
      const db = openPlanDb(TEST_PLAN_ID);
      try {
        const version = db.pragma('user_version', { simple: true }) as number;
        // Currently at db schema version 2 (migration 1: schema versions, migration 2: is_no_op)
        expect(version).toBe(2);
      } finally {
        db.close();
      }
    });

    it('adds schema version columns to patches table', () => {
      const db = openPlanDb(TEST_PLAN_ID);
      try {
        const columns = db.prepare('PRAGMA table_info(patches)').all() as Array<{ name: string }>;
        const columnNames = columns.map((c) => c.name);

        expect(columnNames).toContain('original_schema_version');
        expect(columnNames).toContain('current_schema_version');
      } finally {
        db.close();
      }
    });

    it('adds schema version columns to redo_stack table', () => {
      const db = openPlanDb(TEST_PLAN_ID);
      try {
        const columns = db.prepare('PRAGMA table_info(redo_stack)').all() as Array<{ name: string }>;
        const columnNames = columns.map((c) => c.name);

        expect(columnNames).toContain('original_schema_version');
        expect(columnNames).toContain('current_schema_version');
      } finally {
        db.close();
      }
    });

    it('adds is_no_op column to patches and redo_stack tables', () => {
      const db = openPlanDb(TEST_PLAN_ID);
      try {
        const patchColumns = db.prepare('PRAGMA table_info(patches)').all() as Array<{ name: string }>;
        const redoColumns = db.prepare('PRAGMA table_info(redo_stack)').all() as Array<{ name: string }>;

        expect(patchColumns.map((c) => c.name)).toContain('is_no_op');
        expect(redoColumns.map((c) => c.name)).toContain('is_no_op');
      } finally {
        db.close();
      }
    });

    it('migration is idempotent (running twice is safe)', () => {
      // Open twice to trigger migration logic twice
      let db = openPlanDb(TEST_PLAN_ID);
      db.close();

      db = openPlanDb(TEST_PLAN_ID);
      try {
        const version = db.pragma('user_version', { simple: true }) as number;
        expect(version).toBe(2);

        // Table should still be valid
        const columns = db.prepare('PRAGMA table_info(patches)').all() as Array<{ name: string }>;
        expect(columns.map((c) => c.name)).toContain('original_schema_version');
        expect(columns.map((c) => c.name)).toContain('is_no_op');
      } finally {
        db.close();
      }
    });
  });

  describe('patch schema version tracking', () => {
    beforeEach(() => {
      savePlan(TEST_PLAN_ID, createTestPlan());
    });

    it('appendPatch sets schema versions on new patches', () => {
      appendPatch(TEST_PLAN_ID, {
        patches: [{ op: 'replace', path: ['test'], value: 'value' }],
        inversePatches: [{ op: 'replace', path: ['test'], value: null }],
        description: 'Test patch',
      });

      const patches = getPatches(TEST_PLAN_ID);
      expect(patches).toHaveLength(1);
      expect(patches[0].originalSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(patches[0].currentSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('getPatches returns schema versions', () => {
      appendPatch(TEST_PLAN_ID, {
        patches: [],
        inversePatches: [],
        description: 'Patch 1',
      });
      appendPatch(TEST_PLAN_ID, {
        patches: [],
        inversePatches: [],
        description: 'Patch 2',
      });

      const patches = getPatches(TEST_PLAN_ID);

      expect(patches).toHaveLength(2);
      patches.forEach((patch) => {
        expect(patch.originalSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(patch.currentSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      });
    });

    it('getLastPatch returns schema versions', () => {
      appendPatch(TEST_PLAN_ID, {
        patches: [],
        inversePatches: [],
        description: 'Test',
      });

      const last = getLastPatch(TEST_PLAN_ID);

      expect(last).not.toBeNull();
      expect(last!.originalSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(last!.currentSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('undoPatch preserves schema versions in redo stack', () => {
      appendPatch(TEST_PLAN_ID, {
        patches: [{ op: 'replace', path: ['test'], value: 'value' }],
        inversePatches: [{ op: 'replace', path: ['test'], value: null }],
        description: 'To undo',
      });

      // Verify patch has schema version
      const patchesBefore = getPatches(TEST_PLAN_ID);
      expect(patchesBefore[0].originalSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);

      // Undo
      undoPatch(TEST_PLAN_ID);

      // Verify it moved to redo stack with schema version preserved
      const db = openPlanDb(TEST_PLAN_ID);
      try {
        const redoEntry = db.prepare(`
          SELECT original_schema_version, current_schema_version
          FROM redo_stack
          ORDER BY id DESC
          LIMIT 1
        `).get() as { original_schema_version: number; current_schema_version: number };

        expect(redoEntry.original_schema_version).toBe(CURRENT_SCHEMA_VERSION);
        expect(redoEntry.current_schema_version).toBe(CURRENT_SCHEMA_VERSION);
      } finally {
        db.close();
      }
    });

    it('redoPatch preserves schema versions back in patches', () => {
      appendPatch(TEST_PLAN_ID, {
        patches: [{ op: 'replace', path: ['test'], value: 'value' }],
        inversePatches: [{ op: 'replace', path: ['test'], value: null }],
        description: 'To undo then redo',
      });

      // Undo then redo
      undoPatch(TEST_PLAN_ID);
      expect(getRedoStackCount(TEST_PLAN_ID)).toBe(1);

      redoPatch(TEST_PLAN_ID);

      // Verify schema versions are preserved
      const patches = getPatches(TEST_PLAN_ID);
      expect(patches).toHaveLength(1);
      expect(patches[0].originalSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(patches[0].currentSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('handles patches without schema versions (legacy data)', () => {
      // Manually insert a patch without schema versions (simulates pre-migration data)
      const db = openPlanDb(TEST_PLAN_ID);
      try {
        db.prepare(`
          INSERT INTO patches (patches, inverse_patches, description)
          VALUES (?, ?, ?)
        `).run('[]', '[]', 'Legacy patch');
      } finally {
        db.close();
      }

      // Should not crash, schema versions should be undefined
      const patches = getPatches(TEST_PLAN_ID);
      expect(patches).toHaveLength(1);
      expect(patches[0].originalSchemaVersion).toBeUndefined();
      expect(patches[0].currentSchemaVersion).toBeUndefined();
    });
  });

  describe('getPlanSchemaVersion', () => {
    it('returns null for non-existent plan', () => {
      const version = getPlanSchemaVersion('non-existent-plan');
      expect(version).toBeNull();
    });

    it('returns schema version for existing plan', () => {
      const plan = createTestPlan({ schemaVersion: CURRENT_SCHEMA_VERSION });
      savePlan(TEST_PLAN_ID, plan);

      const version = getPlanSchemaVersion(TEST_PLAN_ID);
      expect(version).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('returns correct version after plan is saved with different version', () => {
      // Save with version 1
      const plan1 = createTestPlan({ schemaVersion: 1 } as never);
      savePlan(TEST_PLAN_ID, plan1);
      expect(getPlanSchemaVersion(TEST_PLAN_ID)).toBe(1);

      // Save with version 5
      const plan5 = createTestPlan({ schemaVersion: 5 });
      savePlan(TEST_PLAN_ID, plan5);
      expect(getPlanSchemaVersion(TEST_PLAN_ID)).toBe(5);
    });
  });

  describe('migrateStoredPatches', () => {
    it('updates current_schema_version when no declarative operations exist', () => {
      const plan = createTestPlan();
      savePlan(TEST_PLAN_ID, plan);

      // Manually insert a patch with old schema version
      const db = openPlanDb(TEST_PLAN_ID);
      db.prepare(
        `INSERT INTO patches (patches, inverse_patches, description, original_schema_version, current_schema_version)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        JSON.stringify([{ op: 'replace', path: ['metadata', 'name'], value: 'New Name' }]),
        JSON.stringify([{ op: 'replace', path: ['metadata', 'name'], value: 'Old Name' }]),
        'Rename plan',
        1,
        1
      );
      db.close();

      // Migrate patches from v1 to v4 (no declarative operations exist for these)
      const result = migrateStoredPatches(TEST_PLAN_ID, 1, 4);

      expect(result.migrated).toBe(1);
      expect(result.markedNoOp).toBe(0);

      // Verify current_schema_version was updated
      const patches = getPatches(TEST_PLAN_ID);
      expect(patches[0].currentSchemaVersion).toBe(4);
    });

    it('transforms patch paths for renamePath operations (v4→v5)', () => {
      const plan = createTestPlan();
      savePlan(TEST_PLAN_ID, plan);

      // Insert a patch that touches plantings.*.sequenceIndex (the old field name)
      const db = openPlanDb(TEST_PLAN_ID);
      db.prepare(
        `INSERT INTO patches (patches, inverse_patches, description, original_schema_version, current_schema_version)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        JSON.stringify([{ op: 'replace', path: ['plantings', 0, 'sequenceIndex'], value: 5 }]),
        JSON.stringify([{ op: 'replace', path: ['plantings', 0, 'sequenceIndex'], value: 3 }]),
        'Update sequence index',
        4,
        4
      );
      db.close();

      // Migrate patches from v4 to v5 (has renamePath operation)
      const result = migrateStoredPatches(TEST_PLAN_ID, 4, 5);

      expect(result.migrated).toBe(1);
      expect(result.markedNoOp).toBe(0);

      // Verify patch paths were transformed
      const patches = getPatches(TEST_PLAN_ID);
      expect(patches[0].patches[0].path).toEqual(['plantings', 0, 'sequenceSlot']);
      expect(patches[0].inversePatches[0].path).toEqual(['plantings', 0, 'sequenceSlot']);
      expect(patches[0].currentSchemaVersion).toBe(5);
    });

    it('transforms patch values for transformValue operations (v5→v6)', () => {
      const plan = createTestPlan();
      savePlan(TEST_PLAN_ID, plan);

      // Insert a patch that touches plantings.*.bedsCount (the old field name with value)
      const db = openPlanDb(TEST_PLAN_ID);
      db.prepare(
        `INSERT INTO patches (patches, inverse_patches, description, original_schema_version, current_schema_version)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        JSON.stringify([{ op: 'replace', path: ['plantings', 0, 'bedsCount'], value: 2 }]),
        JSON.stringify([{ op: 'replace', path: ['plantings', 0, 'bedsCount'], value: 1 }]),
        'Update beds count',
        5,
        5
      );
      db.close();

      // Migrate patches from v5 to v6 (has transformValue + renamePath)
      const result = migrateStoredPatches(TEST_PLAN_ID, 5, 6);

      expect(result.migrated).toBe(1);
      expect(result.markedNoOp).toBe(0);

      // Verify patch paths and values were transformed
      const patches = getPatches(TEST_PLAN_ID);
      // Path renamed from bedsCount to bedFeet
      expect(patches[0].patches[0].path).toEqual(['plantings', 0, 'bedFeet']);
      // Value multiplied by 50 (2 * 50 = 100)
      expect(patches[0].patches[0].value).toBe(100);
      // Inverse also transformed
      expect(patches[0].inversePatches[0].path).toEqual(['plantings', 0, 'bedFeet']);
      expect(patches[0].inversePatches[0].value).toBe(50);
      expect(patches[0].currentSchemaVersion).toBe(6);
    });

    it('returns zero counts when no patches need migration', () => {
      const plan = createTestPlan();
      savePlan(TEST_PLAN_ID, plan);

      // Add a patch with current schema version
      appendPatch(TEST_PLAN_ID, {
        patches: [{ op: 'replace', path: ['metadata', 'name'], value: 'New' }],
        inversePatches: [{ op: 'replace', path: ['metadata', 'name'], value: 'Old' }],
        description: 'Test',
      });

      // Try to migrate (patches already at CURRENT_SCHEMA_VERSION)
      const result = migrateStoredPatches(TEST_PLAN_ID, CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);

      expect(result.migrated).toBe(0);
      expect(result.markedNoOp).toBe(0);
    });
  });
});
