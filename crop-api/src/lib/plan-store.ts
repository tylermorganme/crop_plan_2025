/**
 * Plan Store
 *
 * Zustand store for managing editable crop plans with undo/redo.
 * Uses immer for immutable state updates.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';
import pako from 'pako';
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
  CropPlanFile,
  StashEntry,
} from './plan-types';
import { CURRENT_SCHEMA_VERSION } from './plan-types';

const MAX_HISTORY_SIZE = 50;
const MAX_SNAPSHOTS = 32;
const MAX_STASH_ENTRIES = 10;
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const SNAPSHOTS_STORAGE_KEY = 'crop-plan-snapshots';
const STASH_STORAGE_KEY = 'crop-plan-stash';

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

          const now = Date.now();

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
              lastModified: now,
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
              lastModified: now,
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
          const now = Date.now();
          state.currentPlan.crops
            .filter((c) => c.groupId === groupId)
            .forEach((crop) => {
              crop.startDate = startDate;
              crop.endDate = endDate;
              crop.lastModified = now;
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

// ============================================
// Stash Functions (safety saves before import)
// ============================================

function getStashEntries(): StashEntry[] {
  try {
    const data = localStorage.getItem(STASH_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveToStash(plan: Plan, reason: string): StashEntry {
  const entries = getStashEntries();
  const entry: StashEntry = {
    id: generateId(),
    timestamp: Date.now(),
    reason,
    plan: JSON.parse(JSON.stringify(plan)), // Deep clone
  };

  entries.push(entry);

  // Keep only the last MAX_STASH_ENTRIES
  while (entries.length > MAX_STASH_ENTRIES) {
    entries.shift();
  }

  try {
    localStorage.setItem(STASH_STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('Failed to save stash entry:', e);
  }

  return entry;
}

export function getStash(): StashEntry[] {
  return getStashEntries();
}

export function restoreFromStash(stashId: string): Plan | null {
  const entries = getStashEntries();
  const entry = entries.find(e => e.id === stashId);
  return entry?.plan ?? null;
}

export function clearStash(): void {
  try {
    localStorage.removeItem(STASH_STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear stash:', e);
  }
}

// ============================================
// Export/Import Functions
// ============================================

/**
 * Export the current plan to a gzip-compressed JSON file.
 * Downloads a .crop-plan.gz file to the user's computer.
 */
export function exportPlanToFile(): void {
  const state = usePlanStore.getState();
  if (!state.currentPlan) {
    throw new Error('No plan to export');
  }

  // Increment version on export
  const plan: Plan = {
    ...state.currentPlan,
    metadata: {
      ...state.currentPlan.metadata,
      version: (state.currentPlan.metadata.version ?? 0) + 1,
      lastModified: Date.now(),
    },
  };

  const fileData: CropPlanFile = {
    formatVersion: 1,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    plan,
  };

  // Convert to JSON and compress
  const jsonString = JSON.stringify(fileData, null, 2);
  const compressed = pako.gzip(jsonString);

  // Create blob and download
  const blob = new Blob([compressed], { type: 'application/gzip' });
  const url = URL.createObjectURL(blob);

  const fileName = `${plan.metadata.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-v${plan.metadata.version}.crop-plan.gz`;

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Update the store with the new version
  usePlanStore.setState((state) => {
    if (state.currentPlan) {
      state.currentPlan.metadata.version = plan.metadata.version;
    }
  });
}

/**
 * Import a plan from a gzip-compressed JSON file.
 * Stashes the current plan before importing.
 * Returns the imported plan or throws on error.
 */
export async function importPlanFromFile(file: File): Promise<Plan> {
  const state = usePlanStore.getState();

  // Stash current plan if one exists
  if (state.currentPlan) {
    saveToStash(state.currentPlan, `Before importing ${file.name}`);
  }

  // Read file
  const arrayBuffer = await file.arrayBuffer();
  const compressed = new Uint8Array(arrayBuffer);

  // Decompress
  let jsonString: string;
  try {
    const decompressed = pako.ungzip(compressed);
    jsonString = new TextDecoder().decode(decompressed);
  } catch (e) {
    throw new Error('Failed to decompress file. Is this a valid .crop-plan.gz file?');
  }

  // Parse JSON
  let fileData: CropPlanFile;
  try {
    fileData = JSON.parse(jsonString);
  } catch (e) {
    throw new Error('Failed to parse file. Invalid JSON format.');
  }

  // Validate format version
  if (fileData.formatVersion !== 1) {
    throw new Error(`Unsupported file format version: ${fileData.formatVersion}`);
  }

  // Validate required fields
  if (!fileData.plan || !fileData.plan.id || !fileData.plan.metadata) {
    throw new Error('Invalid file: missing plan data');
  }

  // TODO: Add schema migration logic here when schemaVersion > 1

  // Load the imported plan
  const { loadPlan } = usePlanStore.getState();
  loadPlan(fileData.plan);

  return fileData.plan;
}

/**
 * Read a .crop-plan.gz file and return the parsed data without importing.
 * Useful for previewing before import.
 */
export async function previewPlanFile(file: File): Promise<CropPlanFile> {
  const arrayBuffer = await file.arrayBuffer();
  const compressed = new Uint8Array(arrayBuffer);

  let jsonString: string;
  try {
    const decompressed = pako.ungzip(compressed);
    jsonString = new TextDecoder().decode(decompressed);
  } catch (e) {
    throw new Error('Failed to decompress file. Is this a valid .crop-plan.gz file?');
  }

  let fileData: CropPlanFile;
  try {
    fileData = JSON.parse(jsonString);
  } catch (e) {
    throw new Error('Failed to parse file. Invalid JSON format.');
  }

  if (fileData.formatVersion !== 1) {
    throw new Error(`Unsupported file format version: ${fileData.formatVersion}`);
  }

  return fileData;
}
