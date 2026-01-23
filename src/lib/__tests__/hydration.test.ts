/**
 * Hydration Tests
 *
 * Tests for patch-based plan hydration - reconstructing plan state from
 * checkpoint + patches instead of reading full snapshots.
 *
 * IMPORTANT: These tests are written BEFORE implementing the hydration functions.
 * They define the expected behavior that implementation must satisfy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';
import { applyPatches, enablePatches, produceWithPatches } from 'immer';
import {
  openPlanDb,
  savePlan,
  deletePlan,
  planExists,
  appendPatch,
  getPatches,
  clearPatches,
  getPatchCount,
  createCheckpoint,
  listCheckpoints,
  pushToRedoStack,
  popFromRedoStack,
  getRedoStackCount,
  clearRedoStack,
  // New hydration functions:
  hydratePlan,
  getPatchesAfter,
  getLatestCheckpointMetadata,
  undoPatch,
  redoPatch,
  createCheckpointWithMetadata,
  maybeCreateCheckpoint,
} from '../sqlite-storage';
import { CURRENT_SCHEMA_VERSION } from '../migrations';
import type { Plan } from '../entities/plan';
import type { Patch } from 'immer';

// Enable Immer patches
enablePatches();

// =============================================================================
// TEST SETUP
// =============================================================================

const TEST_PLAN_ID = 'hydration-test-plan';
const PLANS_DIR = join(process.cwd(), 'data', 'plans');

function createTestPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: TEST_PLAN_ID,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    metadata: {
      id: TEST_PLAN_ID,
      name: 'Hydration Test Plan',
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

/** Helper to create a mutation and get patches */
function createMutation<T>(
  base: T,
  mutator: (draft: T) => void,
  description: string
): { result: T; patches: Patch[]; inversePatches: Patch[] } {
  const [result, patches, inversePatches] = produceWithPatches(base, mutator);
  return { result, patches, inversePatches };
}

// =============================================================================
// CORE HYDRATION TESTS
// =============================================================================

describe('hydratePlan', () => {
  beforeEach(() => {
    cleanupTestPlan();
  });

  afterEach(() => {
    cleanupTestPlan();
  });

  it('returns plan from plan table when no patches exist', () => {
    // Setup: save a plan with no patches
    const plan = createTestPlan({ metadata: { ...createTestPlan().metadata, name: 'Base Plan' } });
    savePlan(TEST_PLAN_ID, plan);

    const hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.metadata.name).toBe('Base Plan');
    expect(hydrated.plantings).toHaveLength(0);
  });

  it('applies single patch to base plan', () => {
    // Setup: save a plan
    const basePlan = createTestPlan();
    savePlan(TEST_PLAN_ID, basePlan);

    // Create a mutation
    const { patches, inversePatches } = createMutation(
      basePlan,
      (draft) => {
        draft.metadata.name = 'Renamed Plan';
      },
      'Rename plan'
    );

    // Append patch (but don't save full plan)
    appendPatch(TEST_PLAN_ID, { patches, inversePatches, description: 'Rename plan' });

    // hydratePlan should apply the patch
    const hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.metadata.name).toBe('Renamed Plan');
  });

  it('applies multiple patches in order', () => {
    const basePlan = createTestPlan();
    savePlan(TEST_PLAN_ID, basePlan);

    // First mutation: add a planting
    const { result: plan1, patches: p1, inversePatches: ip1 } = createMutation(
      basePlan,
      (draft) => {
        draft.plantings!.push({
          id: 'P1',
          configId: 'config-1',
          fieldStartDate: '2025-03-15',
          startBed: null,
          bedFeet: 50,
          lastModified: Date.now(),
        });
      },
      'Add planting P1'
    );
    appendPatch(TEST_PLAN_ID, { patches: p1, inversePatches: ip1, description: 'Add planting P1' });

    // Second mutation: add another planting
    const { result: plan2, patches: p2, inversePatches: ip2 } = createMutation(
      plan1,
      (draft) => {
        draft.plantings!.push({
          id: 'P2',
          configId: 'config-2',
          fieldStartDate: '2025-04-01',
          startBed: null,
          bedFeet: 100,
          lastModified: Date.now(),
        });
      },
      'Add planting P2'
    );
    appendPatch(TEST_PLAN_ID, { patches: p2, inversePatches: ip2, description: 'Add planting P2' });

    // Third mutation: rename plan
    const { patches: p3, inversePatches: ip3 } = createMutation(
      plan2,
      (draft) => {
        draft.metadata.name = 'Modified Plan';
      },
      'Rename plan'
    );
    appendPatch(TEST_PLAN_ID, { patches: p3, inversePatches: ip3, description: 'Rename plan' });

    // hydratePlan should apply all 3 patches in order
    const hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.plantings).toHaveLength(2);
    expect(hydrated.plantings![0].id).toBe('P1');
    expect(hydrated.plantings![1].id).toBe('P2');
    expect(hydrated.metadata.name).toBe('Modified Plan');
  });

  it('applies 1000 patches correctly', () => {
    const basePlan = createTestPlan();
    savePlan(TEST_PLAN_ID, basePlan);

    let currentPlan = basePlan;

    // Apply 1000 mutations
    for (let i = 0; i < 1000; i++) {
      const { result, patches, inversePatches } = createMutation(
        currentPlan,
        (draft) => {
          draft.metadata.lastModified = Date.now() + i;
        },
        `Mutation ${i}`
      );
      appendPatch(TEST_PLAN_ID, { patches, inversePatches, description: `Mutation ${i}` });
      currentPlan = result;
    }

    // hydratePlan should correctly apply all 1000 patches
    const hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.metadata.lastModified).toBe(currentPlan.metadata.lastModified);
  });

  it('throws on non-existent plan (no silent fallback)', () => {
    expect(() => hydratePlan('non-existent-plan')).toThrow('Plan non-existent-plan not found');
  });
});

// =============================================================================
// CHECKPOINT-AWARE HYDRATION TESTS
// =============================================================================

describe('hydratePlan with checkpoints', () => {
  beforeEach(() => {
    cleanupTestPlan();
  });

  afterEach(() => {
    cleanupTestPlan();
  });

  it('uses checkpoint when available', () => {
    const basePlan = createTestPlan();
    savePlan(TEST_PLAN_ID, basePlan);

    // Add some patches (but don't save full plan - that's the new pattern)
    const { result: plan1, patches: p1, inversePatches: ip1 } = createMutation(
      basePlan,
      (draft) => {
        draft.plantings!.push({
          id: 'P1',
          configId: 'config-1',
          fieldStartDate: '2025-03-15',
          startBed: null,
          bedFeet: 50,
          lastModified: Date.now(),
        });
      },
      'Add planting P1'
    );
    appendPatch(TEST_PLAN_ID, { patches: p1, inversePatches: ip1, description: 'Add planting P1' });

    // Create checkpoint (this hydrates, saves, and copies)
    // The checkpoint will contain the plan with P1 applied
    createCheckpointWithMetadata(TEST_PLAN_ID, 'After P1');

    // Add more patches after checkpoint
    const { patches: p2, inversePatches: ip2 } = createMutation(
      plan1,
      (draft) => {
        draft.plantings!.push({
          id: 'P2',
          configId: 'config-2',
          fieldStartDate: '2025-04-01',
          startBed: null,
          bedFeet: 100,
          lastModified: Date.now(),
        });
      },
      'Add planting P2'
    );
    appendPatch(TEST_PLAN_ID, { patches: p2, inversePatches: ip2, description: 'Add planting P2' });

    // hydratePlan should:
    // 1. Load plan from checkpoint (which has P1)
    // 2. Only apply P2 (the patch after checkpoint)
    const hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.plantings).toHaveLength(2);
  });

  it('only applies patches after checkpoint', () => {
    const basePlan = createTestPlan();
    savePlan(TEST_PLAN_ID, basePlan);

    // Add 10 patches before checkpoint (don't save full plan - new pattern)
    let currentPlan = basePlan;
    for (let i = 0; i < 10; i++) {
      const { result, patches, inversePatches } = createMutation(
        currentPlan,
        (draft) => {
          draft.plantings!.push({
            id: `P${i}`,
            configId: `config-${i}`,
            fieldStartDate: '2025-03-15',
            startBed: null,
            bedFeet: 50,
            lastModified: Date.now(),
          });
        },
        `Add planting P${i}`
      );
      appendPatch(TEST_PLAN_ID, { patches, inversePatches, description: `Add planting P${i}` });
      currentPlan = result;
    }

    // Create checkpoint (hydrates + saves + copies)
    createCheckpointWithMetadata(TEST_PLAN_ID, 'After 10 plantings');

    // Add 5 more patches after checkpoint
    for (let i = 10; i < 15; i++) {
      const { result, patches, inversePatches } = createMutation(
        currentPlan,
        (draft) => {
          draft.plantings!.push({
            id: `P${i}`,
            configId: `config-${i}`,
            fieldStartDate: '2025-04-01',
            startBed: null,
            bedFeet: 100,
            lastModified: Date.now(),
          });
        },
        `Add planting P${i}`
      );
      appendPatch(TEST_PLAN_ID, { patches, inversePatches, description: `Add planting P${i}` });
      currentPlan = result;
    }

    // hydratePlan should only apply 5 patches (not all 15)
    const hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.plantings).toHaveLength(15);
  });

  it('uses most recent checkpoint when multiple exist', () => {
    const basePlan = createTestPlan();
    savePlan(TEST_PLAN_ID, basePlan);

    // Checkpoint 1: empty plan
    createCheckpointWithMetadata(TEST_PLAN_ID, 'Empty');

    // Add 5 plantings
    let currentPlan = basePlan;
    for (let i = 0; i < 5; i++) {
      const { result, patches, inversePatches } = createMutation(
        currentPlan,
        (draft) => {
          draft.plantings!.push({
            id: `P${i}`,
            configId: `config-${i}`,
            fieldStartDate: '2025-03-15',
            startBed: null,
            bedFeet: 50,
            lastModified: Date.now(),
          });
        },
        `Add planting P${i}`
      );
      appendPatch(TEST_PLAN_ID, { patches, inversePatches, description: `Add planting P${i}` });
      currentPlan = result;
    }

    // Checkpoint 2: 5 plantings
    savePlan(TEST_PLAN_ID, currentPlan);
    createCheckpointWithMetadata(TEST_PLAN_ID, 'After 5');

    // Add 3 more plantings
    for (let i = 5; i < 8; i++) {
      const { result, patches, inversePatches } = createMutation(
        currentPlan,
        (draft) => {
          draft.plantings!.push({
            id: `P${i}`,
            configId: `config-${i}`,
            fieldStartDate: '2025-04-01',
            startBed: null,
            bedFeet: 100,
            lastModified: Date.now(),
          });
        },
        `Add planting P${i}`
      );
      appendPatch(TEST_PLAN_ID, { patches, inversePatches, description: `Add planting P${i}` });
      currentPlan = result;
    }

    // hydratePlan should use checkpoint 2 (5 plantings) and apply only 3 patches
    const hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.plantings).toHaveLength(8);
  });
});

// =============================================================================
// getPatchesAfter TESTS
// =============================================================================

describe('getPatchesAfter', () => {
  beforeEach(() => {
    cleanupTestPlan();
    savePlan(TEST_PLAN_ID, createTestPlan());
  });

  afterEach(() => {
    cleanupTestPlan();
  });

  it('returns all patches when afterPatchId is 0', () => {
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 1' });
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 2' });
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 3' });

    const patches = getPatchesAfter(TEST_PLAN_ID, 0);
    expect(patches).toHaveLength(3);
  });

  it('returns only patches after given ID', () => {
    const id1 = appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 1' });
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 2' });
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 3' });

    const patches = getPatchesAfter(TEST_PLAN_ID, id1);
    expect(patches).toHaveLength(2);
    expect(patches[0].description).toBe('Patch 2');
    expect(patches[1].description).toBe('Patch 3');
  });

  it('returns empty array when no patches after given ID', () => {
    const id1 = appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 1' });

    const patches = getPatchesAfter(TEST_PLAN_ID, id1);
    expect(patches).toHaveLength(0);
  });
});

// =============================================================================
// getLatestCheckpointMetadata TESTS
// =============================================================================

describe('getLatestCheckpointMetadata', () => {
  beforeEach(() => {
    cleanupTestPlan();
    savePlan(TEST_PLAN_ID, createTestPlan());
  });

  afterEach(() => {
    cleanupTestPlan();
  });

  it('returns null when no checkpoints exist', () => {
    const metadata = getLatestCheckpointMetadata(TEST_PLAN_ID);
    expect(metadata).toBeNull();
  });

  it('returns metadata for most recent checkpoint', () => {
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 1' });
    createCheckpointWithMetadata(TEST_PLAN_ID, 'First');

    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 2' });
    createCheckpointWithMetadata(TEST_PLAN_ID, 'Second');

    const metadata = getLatestCheckpointMetadata(TEST_PLAN_ID);
    expect(metadata).not.toBeNull();
    expect(metadata!.name).toBe('Second');
  });

  it('includes last_patch_id in metadata', () => {
    const patchId = appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 1' });
    createCheckpointWithMetadata(TEST_PLAN_ID, 'With Patch');

    const metadata = getLatestCheckpointMetadata(TEST_PLAN_ID);
    expect(metadata!.lastPatchId).toBe(patchId);
  });
});

// =============================================================================
// SIMPLIFIED UNDO/REDO TESTS
// =============================================================================

describe('undoPatch (simplified)', () => {
  beforeEach(() => {
    cleanupTestPlan();
    savePlan(TEST_PLAN_ID, createTestPlan());
  });

  afterEach(() => {
    cleanupTestPlan();
  });

  it('moves patch from patches table to redo_stack', () => {
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Edit 1' });
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Edit 2' });

    expect(getPatchCount(TEST_PLAN_ID)).toBe(2);
    expect(getRedoStackCount(TEST_PLAN_ID)).toBe(0);

    undoPatch(TEST_PLAN_ID);

    expect(getPatchCount(TEST_PLAN_ID)).toBe(1);
    expect(getRedoStackCount(TEST_PLAN_ID)).toBe(1);
  });

  it('returns description of undone action', () => {
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Important Edit' });

    const result = undoPatch(TEST_PLAN_ID);
    expect(result).not.toBeNull();
    expect(result!.description).toBe('Important Edit');
  });

  it('returns null when no patches to undo', () => {
    const result = undoPatch(TEST_PLAN_ID);
    expect(result).toBeNull();
  });

  it('hydratePlan after undo reflects undone state', () => {
    const basePlan = createTestPlan();
    savePlan(TEST_PLAN_ID, basePlan);

    // Add a planting
    const { patches, inversePatches } = createMutation(
      basePlan,
      (draft) => {
        draft.plantings!.push({
          id: 'P1',
          configId: 'config-1',
          fieldStartDate: '2025-03-15',
          startBed: null,
          bedFeet: 50,
          lastModified: Date.now(),
        });
      },
      'Add planting'
    );
    appendPatch(TEST_PLAN_ID, { patches, inversePatches, description: 'Add planting' });

    // Before undo, hydratePlan should show 1 planting
    let hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.plantings).toHaveLength(1);

    // After undo, hydratePlan should show 0 plantings
    undoPatch(TEST_PLAN_ID);
    hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.plantings).toHaveLength(0);
  });
});

describe('redoPatch (simplified)', () => {
  beforeEach(() => {
    cleanupTestPlan();
    savePlan(TEST_PLAN_ID, createTestPlan());
  });

  afterEach(() => {
    cleanupTestPlan();
  });

  it('moves entry from redo_stack back to patches', () => {
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Edit 1' });

    undoPatch(TEST_PLAN_ID);
    expect(getPatchCount(TEST_PLAN_ID)).toBe(0);
    expect(getRedoStackCount(TEST_PLAN_ID)).toBe(1);

    redoPatch(TEST_PLAN_ID);
    expect(getPatchCount(TEST_PLAN_ID)).toBe(1);
    expect(getRedoStackCount(TEST_PLAN_ID)).toBe(0);
  });

  it('returns description of redone action', () => {
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Redoable Edit' });

    undoPatch(TEST_PLAN_ID);
    const result = redoPatch(TEST_PLAN_ID);
    expect(result).not.toBeNull();
    expect(result!.description).toBe('Redoable Edit');
  });

  it('returns null when redo_stack is empty', () => {
    const result = redoPatch(TEST_PLAN_ID);
    expect(result).toBeNull();
  });

  it('hydratePlan after redo reflects redone state', () => {
    const basePlan = createTestPlan();
    savePlan(TEST_PLAN_ID, basePlan);

    // Add a planting
    const { patches, inversePatches } = createMutation(
      basePlan,
      (draft) => {
        draft.plantings!.push({
          id: 'P1',
          configId: 'config-1',
          fieldStartDate: '2025-03-15',
          startBed: null,
          bedFeet: 50,
          lastModified: Date.now(),
        });
      },
      'Add planting'
    );
    appendPatch(TEST_PLAN_ID, { patches, inversePatches, description: 'Add planting' });

    // Undo, then redo
    undoPatch(TEST_PLAN_ID);
    let hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.plantings).toHaveLength(0);

    redoPatch(TEST_PLAN_ID);
    hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.plantings).toHaveLength(1);
  });

  it.todo('new patch clears redo_stack', () => {
    // This test requires appendPatch to clear redo stack - will implement later
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Edit 1' });

    undoPatch(TEST_PLAN_ID);
    expect(getRedoStackCount(TEST_PLAN_ID)).toBe(1);

    // New patch should clear redo stack
    // appendPatch clears redo stack automatically (needs implementation)
    // appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'New Edit' });
    // expect(getRedoStackCount(TEST_PLAN_ID)).toBe(0);
  });
});

// =============================================================================
// CHECKPOINT WITH METADATA TESTS
// =============================================================================

describe('createCheckpointWithMetadata', () => {
  beforeEach(() => {
    cleanupTestPlan();
    savePlan(TEST_PLAN_ID, createTestPlan());
  });

  afterEach(() => {
    cleanupTestPlan();
  });

  it('saves hydrated state to plan table first', () => {
    const basePlan = createTestPlan();
    savePlan(TEST_PLAN_ID, basePlan);

    // Add patch (but don't save full plan)
    const { patches, inversePatches } = createMutation(
      basePlan,
      (draft) => {
        draft.metadata.name = 'Modified Name';
      },
      'Rename'
    );
    appendPatch(TEST_PLAN_ID, { patches, inversePatches, description: 'Rename' });

    // createCheckpointWithMetadata should:
    // 1. Hydrate the plan (apply patches)
    // 2. Save hydrated state to plan table
    // 3. Copy .db file as checkpoint
    createCheckpointWithMetadata(TEST_PLAN_ID, 'After Rename');

    // The checkpoint should contain the modified plan
    const checkpoints = listCheckpoints(TEST_PLAN_ID);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].name).toBe('After Rename');

    // Hydrating should still give us the modified name
    const hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.metadata.name).toBe('Modified Name');
  });

  it('records last_patch_id in metadata', () => {
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 1' });
    const id2 = appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 2' });

    createCheckpointWithMetadata(TEST_PLAN_ID, 'Checkpoint');

    const metadata = getLatestCheckpointMetadata(TEST_PLAN_ID);
    expect(metadata!.lastPatchId).toBe(id2);
  });
});

describe('maybeCreateCheckpoint', () => {
  beforeEach(() => {
    cleanupTestPlan();
    savePlan(TEST_PLAN_ID, createTestPlan());
  });

  afterEach(() => {
    cleanupTestPlan();
  });

  it('creates checkpoint when patches exceed threshold', () => {
    // Add patches up to threshold
    for (let i = 0; i < 500; i++) {
      appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: `Patch ${i}` });
    }

    expect(listCheckpoints(TEST_PLAN_ID)).toHaveLength(0);

    maybeCreateCheckpoint(TEST_PLAN_ID, 500);

    expect(listCheckpoints(TEST_PLAN_ID)).toHaveLength(1);
  });

  it('does nothing when patches below threshold', () => {
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 1' });
    appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: 'Patch 2' });

    maybeCreateCheckpoint(TEST_PLAN_ID, 500);

    expect(listCheckpoints(TEST_PLAN_ID)).toHaveLength(0);
  });

  it('counts patches since last checkpoint, not total patches', () => {
    // Add 100 patches
    for (let i = 0; i < 100; i++) {
      appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: `Patch ${i}` });
    }

    // Create checkpoint
    createCheckpointWithMetadata(TEST_PLAN_ID, 'First Checkpoint');

    // Add 50 more patches (total 150, but only 50 since checkpoint)
    for (let i = 0; i < 50; i++) {
      appendPatch(TEST_PLAN_ID, { patches: [], inversePatches: [], description: `Patch ${100 + i}` });
    }

    // maybeCreateCheckpoint with threshold 100 should NOT create checkpoint
    // (only 50 patches since last checkpoint)
    const created = maybeCreateCheckpoint(TEST_PLAN_ID, 100);
    expect(created).toBeNull();
  });
});

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('full hydration flow', () => {
  beforeEach(() => {
    cleanupTestPlan();
  });

  afterEach(() => {
    cleanupTestPlan();
  });

  it('create plan -> mutate -> reload -> correct state', () => {
    // Create plan
    const plan = createTestPlan();
    savePlan(TEST_PLAN_ID, plan);

    // Mutate via patches (not full save)
    const { patches, inversePatches } = createMutation(
      plan,
      (draft) => {
        draft.plantings!.push({
          id: 'P1',
          configId: 'config-1',
          fieldStartDate: '2025-03-15',
          startBed: null,
          bedFeet: 50,
          lastModified: Date.now(),
        });
      },
      'Add planting'
    );
    appendPatch(TEST_PLAN_ID, { patches, inversePatches, description: 'Add planting' });

    // "Reload" via hydration
    const reloaded = hydratePlan(TEST_PLAN_ID);
    expect(reloaded.plantings).toHaveLength(1);
    expect(reloaded.plantings![0].id).toBe('P1');
  });

  it('create plan -> mutate 100x -> undo 50x -> reload -> correct state', () => {
    const basePlan = createTestPlan();
    savePlan(TEST_PLAN_ID, basePlan);

    // Apply 100 mutations
    let currentPlan = basePlan;
    for (let i = 0; i < 100; i++) {
      const { result, patches, inversePatches } = createMutation(
        currentPlan,
        (draft) => {
          draft.plantings!.push({
            id: `P${i}`,
            configId: `config-${i}`,
            fieldStartDate: '2025-03-15',
            startBed: null,
            bedFeet: 50,
            lastModified: Date.now(),
          });
        },
        `Add planting P${i}`
      );
      appendPatch(TEST_PLAN_ID, { patches, inversePatches, description: `Add planting P${i}` });
      currentPlan = result;
    }

    // Undo 50 times
    for (let i = 0; i < 50; i++) {
      undoPatch(TEST_PLAN_ID);
    }

    // Reload via hydration
    const reloaded = hydratePlan(TEST_PLAN_ID);
    expect(reloaded.plantings).toHaveLength(50);
  });

  it.todo('create plan -> mutate 600x -> auto-checkpoint created', () => {
    // This requires appendPatch to call maybeCreateCheckpoint
    // Will implement when we update appendPatch
  });

  it.todo('copy plan -> original and copy are independent', () => {
    // This requires copyPlan function which uses hydratePlan
    // Will implement as part of the integration
  });
});

// =============================================================================
// SCHEMA MIGRATION DURING HYDRATION TESTS
// =============================================================================

describe('schema migration during hydration', () => {
  beforeEach(() => {
    cleanupTestPlan();
  });

  afterEach(() => {
    cleanupTestPlan();
  });

  it('runs migrations on hydrated plan', () => {
    // Create a plan with old schema version directly in DB
    const db = openPlanDb(TEST_PLAN_ID);
    const oldPlan = {
      id: TEST_PLAN_ID,
      schemaVersion: 3, // Old version
      metadata: {
        id: TEST_PLAN_ID,
        name: 'Old Schema Plan',
        createdAt: Date.now(),
        lastModified: Date.now(),
        year: 2025,
      },
      beds: {},
      bedGroups: {},
      plantings: [],
      cropCatalog: {},
      changeLog: [],
    };
    db.prepare(`
      INSERT INTO plan (id, data, schema_version)
      VALUES ('main', ?, ?)
    `).run(JSON.stringify(oldPlan), 3);
    db.close();

    // hydratePlan should run migrations
    const hydrated = hydratePlan(TEST_PLAN_ID);
    expect(hydrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(hydrated.products).toBeDefined(); // Added in v4
  });
});
