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

      expect(checkpointId).toMatch(/^\d{4}-\d{2}-\d{2}_first-checkpoint$/);

      const checkpointPath = join(PLANS_DIR, `${TEST_PLAN_ID}.checkpoints`, `${checkpointId}.db`);
      expect(existsSync(checkpointPath)).toBe(true);
    });

    it('listCheckpoints returns all checkpoints', () => {
      createCheckpoint(TEST_PLAN_ID, 'Checkpoint 1');
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
});
