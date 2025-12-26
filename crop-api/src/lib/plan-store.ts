/**
 * Plan Store
 *
 * Zustand store for managing editable crop plans with undo/redo.
 * Uses immer for immutable state updates.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  Plan,
  PlanMetadata,
  PlanState,
  PlanActions,
  PlanStore,
  TimelineCrop,
  ResourceGroup,
  PlanChange,
  BedSpanInfo,
} from './plan-types';

const MAX_HISTORY_SIZE = 50;
const MAX_SNAPSHOTS = 32;
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const SNAPSHOTS_STORAGE_KEY = 'crop-plan-snapshots';

interface PlanSnapshot {
  id: string;
  timestamp: number;
  plan: Plan;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Snapshot management functions
function getSnapshots(): PlanSnapshot[] {
  try {
    const data = localStorage.getItem(SNAPSHOTS_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveSnapshot(plan: Plan): void {
  const snapshots = getSnapshots();
  const newSnapshot: PlanSnapshot = {
    id: generateId(),
    timestamp: Date.now(),
    plan: JSON.parse(JSON.stringify(plan)), // Deep clone
  };

  snapshots.push(newSnapshot);

  // Keep only the last MAX_SNAPSHOTS
  while (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.shift();
  }

  try {
    localStorage.setItem(SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshots));
  } catch (e) {
    console.warn('Failed to save snapshot:', e);
  }
}

export function getAutoSaveSnapshots(): PlanSnapshot[] {
  return getSnapshots();
}

export function restoreFromSnapshot(snapshotId: string): Plan | null {
  const snapshots = getSnapshots();
  const snapshot = snapshots.find(s => s.id === snapshotId);
  return snapshot?.plan ?? null;
}

function createChangeEntry(
  type: PlanChange['type'],
  description: string,
  groupIds: string[]
): PlanChange {
  return {
    id: generateId(),
    timestamp: Date.now(),
    type,
    description,
    groupIds,
  };
}

export const usePlanStore = create<PlanStore>()(
  persist(
    immer((set, get) => ({
      // Initial state
      currentPlan: null,
      past: [],
      future: [],
      isDirty: false,
      isLoading: false,
      lastSaved: null,

      // Plan lifecycle
      loadPlan: (plan: Plan) => {
        set((state) => {
          state.currentPlan = plan;
          state.past = [];
          state.future = [];
          state.isDirty = false;
          state.isLoading = false;
        });
      },

      createNewPlan: (
        name: string,
        crops: TimelineCrop[],
        resources: string[],
        groups: ResourceGroup[]
      ) => {
        const now = Date.now();
        const id = generateId();
        const plan: Plan = {
          id,
          metadata: {
            id,
            name,
            createdAt: now,
            lastModified: now,
          },
          crops,
          resources,
          groups,
          changeLog: [],
        };
        set((state) => {
          state.currentPlan = plan;
          state.past = [];
          state.future = [];
          state.isDirty = true;
          state.isLoading = false;
        });
      },

      resetPlan: () => {
        set((state) => {
          state.currentPlan = null;
          state.past = [];
          state.future = [];
          state.isDirty = false;
        });
      },

      // Crop mutations - all push to undo stack
      moveCrop: (groupId: string, newResource: string, bedSpanInfo?: BedSpanInfo[]) => {
        set((state) => {
          if (!state.currentPlan) return;

          // Save current state to undo stack (deep copy)
          state.past.push(state.currentPlan.crops.map(c => ({ ...c })));
          if (state.past.length > MAX_HISTORY_SIZE) {
            state.past.shift();
          }
          // Clear redo stack on new change
          state.future = [];

          // Find all crops with this groupId
          const groupCrops = state.currentPlan.crops.filter((c) => c.groupId === groupId);
          const otherCrops = state.currentPlan.crops.filter((c) => c.groupId !== groupId);

          if (groupCrops.length === 0) return;

          const template = groupCrops[0];
          const feetNeeded = template.feetNeeded || 50;

          if (newResource === '' || !bedSpanInfo || bedSpanInfo.length === 0) {
            // Moving to Unassigned - collapse to single entry
            const unassignedCrop: TimelineCrop = {
              ...template,
              id: `${template.groupId}_unassigned`,
              resource: '',
              totalBeds: 1,
              bedIndex: 1,
              feetNeeded: feetNeeded,
              feetUsed: undefined,
              bedCapacityFt: undefined,
            };
            state.currentPlan.crops = [...otherCrops, unassignedCrop];
          } else {
            // Moving to specific beds - expand to multiple entries with proper feetUsed
            const newGroupCrops: TimelineCrop[] = bedSpanInfo.map((info, index) => ({
              ...template,
              id: `${template.groupId}_bed${index}`,
              resource: info.bed,
              totalBeds: bedSpanInfo.length,
              bedIndex: index + 1,
              feetNeeded: feetNeeded,
              feetUsed: info.feetUsed,
              bedCapacityFt: info.bedCapacityFt,
            }));
            state.currentPlan.crops = [...otherCrops, ...newGroupCrops];
          }

          // Sort by start date
          state.currentPlan.crops.sort((a, b) =>
            new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
          );

          // Update metadata
          state.currentPlan.metadata.lastModified = Date.now();
          state.currentPlan.changeLog.push(
            createChangeEntry('move', `Moved ${groupId} to ${newResource || 'unassigned'}`, [groupId])
          );
          state.isDirty = true;
        });
      },

      updateCropDates: (groupId: string, startDate: string, endDate: string) => {
        set((state) => {
          if (!state.currentPlan) return;

          // Save current state to undo stack
          state.past.push([...state.currentPlan.crops]);
          if (state.past.length > MAX_HISTORY_SIZE) {
            state.past.shift();
          }
          state.future = [];

          // Update all crops with this groupId
          state.currentPlan.crops
            .filter((c) => c.groupId === groupId)
            .forEach((crop) => {
              crop.startDate = startDate;
              crop.endDate = endDate;
            });

          state.currentPlan.metadata.lastModified = Date.now();
          state.currentPlan.changeLog.push(
            createChangeEntry('date_change', `Updated dates for ${groupId}`, [groupId])
          );
          state.isDirty = true;
        });
      },

      deleteCrop: (groupId: string) => {
        set((state) => {
          if (!state.currentPlan) return;

          // Save current state to undo stack
          state.past.push([...state.currentPlan.crops]);
          if (state.past.length > MAX_HISTORY_SIZE) {
            state.past.shift();
          }
          state.future = [];

          // Remove all crops with this groupId
          state.currentPlan.crops = state.currentPlan.crops.filter(
            (c) => c.groupId !== groupId
          );

          state.currentPlan.metadata.lastModified = Date.now();
          state.currentPlan.changeLog.push(
            createChangeEntry('delete', `Deleted ${groupId}`, [groupId])
          );
          state.isDirty = true;
        });
      },

      // History
      undo: () => {
        set((state) => {
          if (!state.currentPlan || state.past.length === 0) return;

          const previous = state.past.pop()!;
          state.future.push(state.currentPlan.crops.map(c => ({ ...c })));
          state.currentPlan.crops = previous;
          state.currentPlan.metadata.lastModified = Date.now();
          state.isDirty = true;
        });
      },

      redo: () => {
        set((state) => {
          if (!state.currentPlan || state.future.length === 0) return;

          const next = state.future.pop()!;
          state.past.push(state.currentPlan.crops.map(c => ({ ...c })));
          state.currentPlan.crops = next;
          state.currentPlan.metadata.lastModified = Date.now();
          state.isDirty = true;
        });
      },

      canUndo: () => {
        const state = get();
        return state.past.length > 0;
      },

      canRedo: () => {
        const state = get();
        return state.future.length > 0;
      },

      // Persistence helpers
      markSaved: () => {
        set((state) => {
          state.isDirty = false;
          state.lastSaved = Date.now();
        });
      },

      markDirty: () => {
        set((state) => {
          state.isDirty = true;
        });
      },
    })),
    {
      name: 'crop-plan-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Persist plan and undo/redo history
        currentPlan: state.currentPlan,
        past: state.past,
        future: state.future,
        lastSaved: state.lastSaved,
      }),
    }
  )
);

/**
 * Helper hook to get just the crops array
 */
export function usePlanCrops(): TimelineCrop[] {
  return usePlanStore((state) => state.currentPlan?.crops ?? []);
}

/**
 * Helper hook to get plan metadata
 */
export function usePlanMetadata(): PlanMetadata | null {
  return usePlanStore((state) => state.currentPlan?.metadata ?? null);
}

/**
 * Helper hook for undo/redo state
 */
export function useUndoRedo() {
  const canUndo = usePlanStore((state) => state.past.length > 0);
  const canRedo = usePlanStore((state) => state.future.length > 0);
  const undo = usePlanStore((state) => state.undo);
  const redo = usePlanStore((state) => state.redo);
  const undoCount = usePlanStore((state) => state.past.length);
  const redoCount = usePlanStore((state) => state.future.length);

  return { canUndo, canRedo, undo, redo, undoCount, redoCount };
}

/**
 * Start auto-save timer (call once on app initialization)
 * Saves a snapshot every 15 minutes if there's a plan
 */
let autoSaveInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSave(): void {
  if (autoSaveInterval) return; // Already running

  autoSaveInterval = setInterval(() => {
    const state = usePlanStore.getState();
    if (state.currentPlan) {
      saveSnapshot(state.currentPlan);
      console.log('[AutoSave] Snapshot saved at', new Date().toLocaleTimeString());
    }
  }, SNAPSHOT_INTERVAL_MS);

  // Save initial snapshot when starting
  const state = usePlanStore.getState();
  if (state.currentPlan) {
    saveSnapshot(state.currentPlan);
  }
}

export function stopAutoSave(): void {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}
