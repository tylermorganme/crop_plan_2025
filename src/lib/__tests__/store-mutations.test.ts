/**
 * Integration Tests for Plan Store Mutations
 *
 * Tests that verify:
 * 1. Mutations correctly update plan state
 * 2. Each mutation increments undoCount (patches persisted to SQLite)
 * 3. Undo/redo operations work via server API
 *
 * Note: Undo/redo is now server-side. The store tracks counts,
 * and the server handles patch application and plan state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePlanStore } from '../plan-store';
import {
  createTestPlan,
  createTestPlanting,
  createTestBed,
  createTestBedGroup,
  createTestPlantingSpec,
  createTestPlanWithBeds,
  createTestPlanWithSpec,
} from './test-helpers';
import type { Plan } from '../plan-types';

// =============================================================================
// MOCKS
// =============================================================================

// Track plan state history for undo/redo simulation
let planHistory: Plan[] = [];
let redoStack: Plan[] = [];

// Mock the storage adapter to simulate server-side undo/redo
vi.mock('../sqlite-client', () => ({
  storage: {
    savePlan: vi.fn().mockResolvedValue(undefined),
    getPlan: vi.fn().mockResolvedValue(null),
    getPlanList: vi.fn().mockResolvedValue([]),
    deletePlan: vi.fn().mockResolvedValue(undefined),
    getFlag: vi.fn().mockResolvedValue(null),
    setFlag: vi.fn().mockResolvedValue(undefined),
    appendPatch: vi.fn().mockImplementation(async () => {
      // Save current plan state before mutation (simulates what server does)
      const currentPlan = usePlanStore.getState().currentPlan;
      if (currentPlan) {
        planHistory.push(JSON.parse(JSON.stringify(currentPlan)));
      }
      // Clear redo stack on new mutation
      redoStack = [];
      return planHistory.length;
    }),
    getPatches: vi.fn().mockResolvedValue([]),
    clearPatches: vi.fn().mockResolvedValue(undefined),
    getUndoRedoCounts: vi.fn().mockResolvedValue({ undoCount: 0, redoCount: 0 }),
    undo: vi.fn().mockImplementation(async () => {
      if (planHistory.length === 0) {
        return { ok: false, plan: null, canUndo: false, canRedo: false };
      }
      // Pop from history, push current to redo
      const currentPlan = usePlanStore.getState().currentPlan;
      if (currentPlan) {
        redoStack.push(JSON.parse(JSON.stringify(currentPlan)));
      }
      const previousPlan = planHistory.pop()!;
      return {
        ok: true,
        plan: previousPlan,
        canUndo: planHistory.length > 0,
        canRedo: true,
      };
    }),
    redo: vi.fn().mockImplementation(async () => {
      if (redoStack.length === 0) {
        return { ok: false, plan: null, canUndo: false, canRedo: false };
      }
      // Pop from redo, push current to history
      const currentPlan = usePlanStore.getState().currentPlan;
      if (currentPlan) {
        planHistory.push(JSON.parse(JSON.stringify(currentPlan)));
      }
      const nextPlan = redoStack.pop()!;
      return {
        ok: true,
        plan: nextPlan,
        canUndo: true,
        canRedo: redoStack.length > 0,
      };
    }),
  },
  onSyncMessage: vi.fn().mockReturnValue(() => {}),
}));

// =============================================================================
// SETUP
// =============================================================================

/**
 * Reset the store to initial state and load a test plan.
 */
function resetStoreWithPlan(plan = createTestPlan()) {
  // Reset mock history
  planHistory = [];
  redoStack = [];

  // Directly set state to avoid async loading
  usePlanStore.setState({
    currentPlan: plan,
    undoCount: 0,
    redoCount: 0,
    isDirty: false,
    isLoading: false,
    isSaving: false,
    saveError: null,
    lastSaved: null,
    planList: [],
  });

  return usePlanStore.getState();
}

// =============================================================================
// TESTS: PLANTING OPERATIONS
// =============================================================================

describe('planting mutations', () => {
  beforeEach(() => {
    resetStoreWithPlan();
  });

  describe('addPlanting', () => {
    it('adds planting to plan', async () => {
      const store = usePlanStore.getState();
      const planting = createTestPlanting({ id: 'P1', specId: 'test-config' });

      await store.addPlanting(planting);

      const state = usePlanStore.getState();
      expect(state.currentPlan?.plantings).toHaveLength(1);
      expect(state.currentPlan?.plantings?.[0].id).toBe('P1');
    });

    it('increments undo count after mutation', async () => {
      const store = usePlanStore.getState();
      const planting = createTestPlanting({ id: 'P1' });

      await store.addPlanting(planting);

      const state = usePlanStore.getState();
      expect(state.undoCount).toBe(1);
    });

    it('can be undone', async () => {
      const store = usePlanStore.getState();
      await store.addPlanting(createTestPlanting({ id: 'P1' }));

      expect(usePlanStore.getState().currentPlan?.plantings).toHaveLength(1);

      await store.undo();

      const state = usePlanStore.getState();
      expect(state.currentPlan?.plantings).toHaveLength(0);
      expect(state.redoCount).toBeGreaterThan(0);
    });

    it('can be redone after undo', async () => {
      const store = usePlanStore.getState();
      await store.addPlanting(createTestPlanting({ id: 'P1' }));
      await store.undo();

      expect(usePlanStore.getState().currentPlan?.plantings).toHaveLength(0);

      await store.redo();

      const state = usePlanStore.getState();
      expect(state.currentPlan?.plantings).toHaveLength(1);
      expect(state.currentPlan?.plantings?.[0].id).toBe('P1');
    });
  });

  describe('deleteCrop', () => {
    it('removes planting from plan', async () => {
      const plan = createTestPlan({
        plantings: [createTestPlanting({ id: 'P1' })],
      });
      resetStoreWithPlan(plan);

      const store = usePlanStore.getState();
      await store.deleteCrop('P1');

      expect(usePlanStore.getState().currentPlan?.plantings).toHaveLength(0);
    });

    it('can be undone to restore planting', async () => {
      const planting = createTestPlanting({ id: 'P1', specId: 'tomato' });
      const plan = createTestPlan({ plantings: [planting] });
      resetStoreWithPlan(plan);

      const store = usePlanStore.getState();
      await store.deleteCrop('P1');

      expect(usePlanStore.getState().currentPlan?.plantings).toHaveLength(0);

      await store.undo();

      const state = usePlanStore.getState();
      expect(state.currentPlan?.plantings).toHaveLength(1);
      expect(state.currentPlan?.plantings?.[0].id).toBe('P1');
    });
  });

  describe('moveCrop', () => {
    it('moves planting to a different bed', async () => {
      const plan = createTestPlanWithBeds();
      const bedIds = Object.keys(plan.beds!);
      const bed1 = plan.beds![bedIds[0]];
      const bed2 = plan.beds![bedIds[1]] ?? plan.beds![bedIds[0]]; // Use second bed if exists

      const planting = createTestPlanting({ id: 'P1', startBed: bed1.id, bedFeet: 50 });
      plan.plantings = [planting];
      resetStoreWithPlan(plan);

      const store = usePlanStore.getState();
      await store.moveCrop('P1', bed2.name, [{ bed: bed2.id, feetUsed: 50, bedCapacityFt: 50 }]);

      const state = usePlanStore.getState();
      expect(state.currentPlan?.plantings?.[0].startBed).toBe(bed2.id);
    });

    it('moves planting to unassigned', async () => {
      const plan = createTestPlanWithBeds();
      const bedId = Object.keys(plan.beds!)[0];
      const bed = plan.beds![bedId];

      const planting = createTestPlanting({ id: 'P1', startBed: bed.id, bedFeet: 50 });
      plan.plantings = [planting];
      resetStoreWithPlan(plan);

      const store = usePlanStore.getState();
      await store.moveCrop('P1', 'Unassigned');

      const state = usePlanStore.getState();
      expect(state.currentPlan?.plantings?.[0].startBed).toBeNull();
    });

    it('can be undone to restore original bed', async () => {
      const plan = createTestPlanWithBeds();
      const bedIds = Object.keys(plan.beds!);
      const bed1 = plan.beds![bedIds[0]];

      const planting = createTestPlanting({ id: 'P1', startBed: bed1.id, bedFeet: 50 });
      plan.plantings = [planting];
      resetStoreWithPlan(plan);

      const store = usePlanStore.getState();

      // Move to unassigned
      await store.moveCrop('P1', 'Unassigned');
      expect(usePlanStore.getState().currentPlan?.plantings?.[0].startBed).toBeNull();

      // Undo should restore original bed
      await store.undo();

      const state = usePlanStore.getState();
      expect(state.currentPlan?.plantings?.[0].startBed).toBe(bed1.id);
    });

    it('can be redone after undo', async () => {
      const plan = createTestPlanWithBeds();
      const bedId = Object.keys(plan.beds!)[0];
      const bed = plan.beds![bedId];

      const planting = createTestPlanting({ id: 'P1', startBed: bed.id, bedFeet: 50 });
      plan.plantings = [planting];
      resetStoreWithPlan(plan);

      const store = usePlanStore.getState();

      await store.moveCrop('P1', 'Unassigned');
      await store.undo();
      expect(usePlanStore.getState().currentPlan?.plantings?.[0].startBed).toBe(bed.id);

      await store.redo();
      expect(usePlanStore.getState().currentPlan?.plantings?.[0].startBed).toBeNull();
    });
  });

  describe('updateCropDates', () => {
    it('updates planting start date', async () => {
      const planting = createTestPlanting({ id: 'P1', fieldStartDate: '2025-03-01' });
      const plan = createTestPlan({ plantings: [planting] });
      resetStoreWithPlan(plan);

      const store = usePlanStore.getState();
      await store.updateCropDates('P1', '2025-04-15', '2025-06-15');

      const state = usePlanStore.getState();
      expect(state.currentPlan?.plantings?.[0].fieldStartDate).toBe('2025-04-15');
    });

    it('can be undone to restore original date', async () => {
      const planting = createTestPlanting({ id: 'P1', fieldStartDate: '2025-03-01' });
      const plan = createTestPlan({ plantings: [planting] });
      resetStoreWithPlan(plan);

      const store = usePlanStore.getState();
      await store.updateCropDates('P1', '2025-04-15', '2025-06-15');
      expect(usePlanStore.getState().currentPlan?.plantings?.[0].fieldStartDate).toBe('2025-04-15');

      await store.undo();
      expect(usePlanStore.getState().currentPlan?.plantings?.[0].fieldStartDate).toBe('2025-03-01');
    });
  });

  describe('planting space validation', () => {
    // Setup helper: create plan with 4 beds (B1-B4) each 50ft in same group
    function createPlanWithBedGroup() {
      const group = createTestBedGroup({ id: 'g1', name: 'Row B', displayOrder: 0 });
      const beds: Record<string, ReturnType<typeof createTestBed>> = {
        b1: createTestBed({ id: 'b1', name: 'B1', groupId: 'g1', displayOrder: 0, lengthFt: 50 }),
        b2: createTestBed({ id: 'b2', name: 'B2', groupId: 'g1', displayOrder: 1, lengthFt: 50 }),
        b3: createTestBed({ id: 'b3', name: 'B3', groupId: 'g1', displayOrder: 2, lengthFt: 50 }),
        b4: createTestBed({ id: 'b4', name: 'B4', groupId: 'g1', displayOrder: 3, lengthFt: 50 }),
      };
      return createTestPlan({ beds, bedGroups: { g1: group } });
    }

    describe('resize validation (updatePlanting with bedFeet)', () => {
      it('allows resize within single bed capacity', async () => {
        const plan = createPlanWithBedGroup();
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: 'b1', bedFeet: 25 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        const result = await store.updatePlanting('P1', { bedFeet: 50 });

        expect(result.success).toBe(true);
        expect(usePlanStore.getState().currentPlan?.plantings?.[0].bedFeet).toBe(50);
      });

      it('allows resize spanning multiple beds when space available', async () => {
        const plan = createPlanWithBedGroup();
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: 'b1', bedFeet: 50 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        // B1+B2 = 100ft available from B1
        const result = await store.updatePlanting('P1', { bedFeet: 100 });

        expect(result.success).toBe(true);
        expect(usePlanStore.getState().currentPlan?.plantings?.[0].bedFeet).toBe(100);
      });

      it('allows resize to use all beds in group', async () => {
        const plan = createPlanWithBedGroup();
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: 'b1', bedFeet: 50 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        // B1+B2+B3+B4 = 200ft total
        const result = await store.updatePlanting('P1', { bedFeet: 200 });

        expect(result.success).toBe(true);
        expect(usePlanStore.getState().currentPlan?.plantings?.[0].bedFeet).toBe(200);
      });

      it('rejects resize exceeding available space in group', async () => {
        const plan = createPlanWithBedGroup();
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: 'b1', bedFeet: 50 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        // Only 200ft available, requesting 250
        const result = await store.updatePlanting('P1', { bedFeet: 250 });

        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('only 200');
        // State should be unchanged
        expect(usePlanStore.getState().currentPlan?.plantings?.[0].bedFeet).toBe(50);
      });

      it('rejects resize when starting from middle bed with insufficient space', async () => {
        const plan = createPlanWithBedGroup();
        // Planting starts at B3, only B3+B4 = 100ft available
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: 'b3', bedFeet: 50 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        const result = await store.updatePlanting('P1', { bedFeet: 150 });

        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('only 100');
      });

      it('rejects resize when starting from last bed', async () => {
        const plan = createPlanWithBedGroup();
        // Planting starts at B4, only 50ft available
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: 'b4', bedFeet: 50 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        const result = await store.updatePlanting('P1', { bedFeet: 100 });

        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('only 50');
      });
    });

    describe('move validation (updatePlanting with startBed)', () => {
      it('allows move when planting fits in new location', async () => {
        const plan = createPlanWithBedGroup();
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: 'b1', bedFeet: 50 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        // 50ft planting can fit anywhere
        const result = await store.updatePlanting('P1', { startBed: 'b4' });

        expect(result.success).toBe(true);
        expect(usePlanStore.getState().currentPlan?.plantings?.[0].startBed).toBe('b4');
      });

      it('allows move of multi-bed planting when space available', async () => {
        const plan = createPlanWithBedGroup();
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: 'b1', bedFeet: 100 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        // 100ft planting to B2 (B2+B3+B4 = 150ft available)
        const result = await store.updatePlanting('P1', { startBed: 'b2' });

        expect(result.success).toBe(true);
        expect(usePlanStore.getState().currentPlan?.plantings?.[0].startBed).toBe('b2');
      });

      it('rejects move when planting too large for new location', async () => {
        const plan = createPlanWithBedGroup();
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: 'b1', bedFeet: 100 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        // 100ft planting to B4 (only 50ft available)
        const result = await store.updatePlanting('P1', { startBed: 'b4' });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('Cannot move');
          expect(result.error).toContain('100');
          expect(result.error).toContain('only 50');
        }
        // State should be unchanged
        expect(usePlanStore.getState().currentPlan?.plantings?.[0].startBed).toBe('b1');
      });

      it('allows move to unassigned regardless of size', async () => {
        const plan = createPlanWithBedGroup();
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: 'b1', bedFeet: 200 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        // Moving to unassigned (startBed: undefined) should always work
        const result = await store.updatePlanting('P1', { startBed: undefined });

        expect(result.success).toBe(true);
      });
    });

    describe('combined move and resize validation', () => {
      it('validates against new location when both startBed and bedFeet change', async () => {
        const plan = createPlanWithBedGroup();
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: 'b1', bedFeet: 50 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        // Move to B3 and resize to 100ft (B3+B4 = 100ft available) - should work
        const result = await store.updatePlanting('P1', { startBed: 'b3', bedFeet: 100 });

        expect(result.success).toBe(true);
      });

      it('rejects when combined move and resize exceeds space', async () => {
        const plan = createPlanWithBedGroup();
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: 'b1', bedFeet: 50 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        // Move to B3 and resize to 150ft (B3+B4 = 100ft available) - should fail
        const result = await store.updatePlanting('P1', { startBed: 'b3', bedFeet: 150 });

        expect(result.success).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('allows updates to unassigned plantings without space validation', async () => {
        const plan = createPlanWithBedGroup();
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: null, bedFeet: 500 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        // Unassigned planting can have any bedFeet
        const result = await store.updatePlanting('P1', { bedFeet: 1000 });

        expect(result.success).toBe(true);
      });

      it('validates when assigning previously unassigned planting', async () => {
        const plan = createPlanWithBedGroup();
        plan.plantings = [createTestPlanting({ id: 'P1', startBed: null, bedFeet: 100 })];
        resetStoreWithPlan(plan);

        const store = usePlanStore.getState();
        // Assigning 100ft planting to B4 (only 50ft available) should fail
        const result = await store.updatePlanting('P1', { startBed: 'b4' });

        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('Cannot move');
      });
    });
  });
});

// =============================================================================
// TESTS: BED OPERATIONS
// =============================================================================

describe('bed mutations', () => {
  beforeEach(() => {
    resetStoreWithPlan(createTestPlanWithBeds());
  });

  describe('addBed', () => {
    it('adds bed to group', async () => {
      const store = usePlanStore.getState();
      const groupId = Object.keys(store.currentPlan!.bedGroups!)[0];

      await store.addBed(groupId, 'A2', 50);

      const state = usePlanStore.getState();
      const beds = Object.values(state.currentPlan!.beds!);
      expect(beds.some(b => b.name === 'A2')).toBe(true);
    });

    it('can be undone', async () => {
      const store = usePlanStore.getState();
      const groupId = Object.keys(store.currentPlan!.bedGroups!)[0];
      const initialBedCount = Object.keys(store.currentPlan!.beds!).length;

      await store.addBed(groupId, 'A2', 50);
      expect(Object.keys(usePlanStore.getState().currentPlan!.beds!).length).toBe(initialBedCount + 1);

      await store.undo();
      expect(Object.keys(usePlanStore.getState().currentPlan!.beds!).length).toBe(initialBedCount);
    });
  });

  describe('renameBed', () => {
    it('updates bed name', async () => {
      const store = usePlanStore.getState();
      const bedId = Object.keys(store.currentPlan!.beds!)[0];

      await store.renameBed(bedId, 'NewName');

      const state = usePlanStore.getState();
      expect(state.currentPlan!.beds![bedId].name).toBe('NewName');
    });

    it('can be undone to restore original name', async () => {
      const store = usePlanStore.getState();
      const bedId = Object.keys(store.currentPlan!.beds!)[0];
      const originalName = store.currentPlan!.beds![bedId].name;

      await store.renameBed(bedId, 'NewName');
      expect(usePlanStore.getState().currentPlan!.beds![bedId].name).toBe('NewName');

      await store.undo();
      expect(usePlanStore.getState().currentPlan!.beds![bedId].name).toBe(originalName);
    });
  });
});

// =============================================================================
// TESTS: BED GROUP OPERATIONS
// =============================================================================

describe('bed group mutations', () => {
  beforeEach(() => {
    resetStoreWithPlan(createTestPlanWithBeds());
  });

  describe('addBedGroup', () => {
    it('adds group to plan', async () => {
      const store = usePlanStore.getState();
      const initialGroupCount = Object.keys(store.currentPlan!.bedGroups!).length;

      await store.addBedGroup('Row B');

      const state = usePlanStore.getState();
      expect(Object.keys(state.currentPlan!.bedGroups!).length).toBe(initialGroupCount + 1);
    });

    it('can be undone', async () => {
      const store = usePlanStore.getState();
      const initialGroupCount = Object.keys(store.currentPlan!.bedGroups!).length;

      await store.addBedGroup('Row B');
      expect(Object.keys(usePlanStore.getState().currentPlan!.bedGroups!).length).toBe(initialGroupCount + 1);

      await store.undo();
      expect(Object.keys(usePlanStore.getState().currentPlan!.bedGroups!).length).toBe(initialGroupCount);
    });
  });

  describe('renameBedGroup', () => {
    it('updates group name', async () => {
      const store = usePlanStore.getState();
      const groupId = Object.keys(store.currentPlan!.bedGroups!)[0];

      await store.renameBedGroup(groupId, 'New Group Name');

      const state = usePlanStore.getState();
      expect(state.currentPlan!.bedGroups![groupId].name).toBe('New Group Name');
    });

    it('can be undone to restore original name', async () => {
      const store = usePlanStore.getState();
      const groupId = Object.keys(store.currentPlan!.bedGroups!)[0];
      const originalName = store.currentPlan!.bedGroups![groupId].name;

      await store.renameBedGroup(groupId, 'New Group Name');
      await store.undo();

      expect(usePlanStore.getState().currentPlan!.bedGroups![groupId].name).toBe(originalName);
    });
  });
});

// =============================================================================
// TESTS: PLANTING SPEC OPERATIONS
// =============================================================================

describe('planting spec mutations', () => {
  beforeEach(() => {
    resetStoreWithPlan(createTestPlanWithSpec());
  });

  describe('updatePlantingSpec', () => {
    it('updates spec in catalog', async () => {
      const store = usePlanStore.getState();
      const specId = Object.keys(store.currentPlan!.specs!)[0];
      const spec = store.currentPlan!.specs![specId];

      await store.updatePlantingSpec({ ...spec, rows: 6 });

      const state = usePlanStore.getState();
      expect(state.currentPlan!.specs![specId].rows).toBe(6);
    });

    it('can be undone', async () => {
      const store = usePlanStore.getState();
      const specId = Object.keys(store.currentPlan!.specs!)[0];
      const spec = store.currentPlan!.specs![specId];
      const originalRows = spec.rows;

      await store.updatePlantingSpec({ ...spec, rows: 6 });
      expect(usePlanStore.getState().currentPlan!.specs![specId].rows).toBe(6);

      await store.undo();
      expect(usePlanStore.getState().currentPlan!.specs![specId].rows).toBe(originalRows);
    });
  });
});

// =============================================================================
// TESTS: UNDO/REDO EDGE CASES
// =============================================================================

describe('undo/redo edge cases', () => {
  beforeEach(() => {
    resetStoreWithPlan();
  });

  it('multiple undos in sequence', async () => {
    const store = usePlanStore.getState();

    await store.addPlanting(createTestPlanting({ id: 'P1' }));
    await store.addPlanting(createTestPlanting({ id: 'P2' }));
    await store.addPlanting(createTestPlanting({ id: 'P3' }));

    expect(usePlanStore.getState().currentPlan?.plantings).toHaveLength(3);

    await store.undo();
    expect(usePlanStore.getState().currentPlan?.plantings).toHaveLength(2);

    await store.undo();
    expect(usePlanStore.getState().currentPlan?.plantings).toHaveLength(1);

    await store.undo();
    expect(usePlanStore.getState().currentPlan?.plantings).toHaveLength(0);
  });

  it('new action clears redo stack', async () => {
    const store = usePlanStore.getState();

    await store.addPlanting(createTestPlanting({ id: 'P1' }));
    await store.addPlanting(createTestPlanting({ id: 'P2' }));
    await store.undo();

    expect(usePlanStore.getState().redoCount).toBeGreaterThan(0);

    // New action should clear redo stack
    await store.addPlanting(createTestPlanting({ id: 'P3' }));

    expect(usePlanStore.getState().redoCount).toBe(0);
  });

  it('undo at empty history does nothing', async () => {
    const store = usePlanStore.getState();
    const initialPlan = { ...usePlanStore.getState().currentPlan };

    await store.undo();

    const state = usePlanStore.getState();
    expect(state.currentPlan?.id).toBe(initialPlan.id);
  });

  it('redo at empty future does nothing', async () => {
    const store = usePlanStore.getState();
    await store.addPlanting(createTestPlanting({ id: 'P1' }));

    const beforeRedo = usePlanStore.getState().currentPlan?.plantings?.length;

    await store.redo();

    expect(usePlanStore.getState().currentPlan?.plantings?.length).toBe(beforeRedo);
  });

  it('canUndo returns correct values', async () => {
    const store = usePlanStore.getState();

    expect(store.canUndo()).toBe(false);

    await store.addPlanting(createTestPlanting({ id: 'P1' }));

    expect(usePlanStore.getState().canUndo()).toBe(true);

    await usePlanStore.getState().undo();

    expect(usePlanStore.getState().canUndo()).toBe(false);
  });

  it('canRedo returns correct values', async () => {
    const store = usePlanStore.getState();

    expect(store.canRedo()).toBe(false);

    await store.addPlanting(createTestPlanting({ id: 'P1' }));
    expect(usePlanStore.getState().canRedo()).toBe(false);

    await usePlanStore.getState().undo();
    expect(usePlanStore.getState().canRedo()).toBe(true);

    await usePlanStore.getState().redo();
    expect(usePlanStore.getState().canRedo()).toBe(false);
  });
});
