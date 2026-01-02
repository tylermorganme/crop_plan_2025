/**
 * Plan Store
 *
 * Zustand store for managing editable crop plans with undo/redo.
 * Uses immer for immutable state updates.
 * Uses storage adapter for persistence (localStorage by default).
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import pako from 'pako';
import { addYears, addMonths, format, parseISO, isValid } from 'date-fns';
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
  Checkpoint,
  HistoryEntry,
  Bed,
} from './plan-types';
import {
  CURRENT_SCHEMA_VERSION,
  generatePlantingId,
  initializeIdCounter,
  validatePlan,
  createBedsFromTemplate,
} from './plan-types';
import { storage, type PlanSummary, type PlanSnapshot, type PlanData } from './storage-adapter';
import { recalculateCropsForConfig } from './slim-planting';
import bedPlanData from '@/data/bed-plan.json';
import { getAllCrops } from './crops';
import type { CropConfig } from './crop-calculations';

// Re-export types for consumers
export type { PlanSummary, PlanSnapshot, PlanData };

const MAX_HISTORY_SIZE = 50;
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Helper to get crops from a plan safely.
 * During transitional period, plans may have crops (legacy) or plantings (new).
 * Returns crops array, defaulting to empty array if not present.
 */
function getPlanCrops(plan: Plan | null): TimelineCrop[] {
  return plan?.crops ?? [];
}

/**
 * Helper to get resources from a plan safely.
 */
function getPlanResources(plan: Plan | null): string[] {
  return plan?.resources ?? [];
}

/**
 * Helper to get groups from a plan safely.
 */
function getPlanGroups(plan: Plan | null): ResourceGroup[] {
  return plan?.groups ?? [];
}

/**
 * Deep copy a plan for undo stack.
 * Must create new objects to avoid immer draft reference issues.
 */
function deepCopyPlan(plan: Plan): Plan {
  return JSON.parse(JSON.stringify(plan));
}

/**
 * Snapshot the current plan state for undo.
 * Call this BEFORE making any mutations.
 */
function snapshotForUndo(state: { currentPlan: Plan | null; past: Plan[]; future: Plan[] }): void {
  if (!state.currentPlan) return;

  state.past.push(deepCopyPlan(state.currentPlan));

  // Limit history size
  if (state.past.length > MAX_HISTORY_SIZE) {
    state.past.shift();
  }

  // Clear redo stack on new change
  state.future = [];
}

// ============================================
// Plan Library Functions (async, use adapter)
// ============================================

/**
 * Get list of all saved plans (summaries only)
 */
export async function getPlanList(): Promise<PlanSummary[]> {
  return storage.getPlanList();
}

/**
 * Save plan to library
 */
export async function savePlanToLibrary(plan: Plan): Promise<void> {
  const data: PlanData = {
    plan,
    past: [],  // Don't persist undo history per-plan
    future: [],
  };
  return storage.savePlan(plan.id, data);
}

/**
 * Load a plan from library by ID
 */
export async function loadPlanFromLibrary(planId: string): Promise<PlanData | null> {
  return storage.getPlan(planId);
}

/**
 * Delete a plan from library
 */
export async function deletePlanFromLibrary(planId: string): Promise<void> {
  return storage.deletePlan(planId);
}

/**
 * Check if a plan exists in the library
 */
export async function planExistsInLibrary(planId: string): Promise<boolean> {
  const data = await storage.getPlan(planId);
  return data !== null;
}

/**
 * Generate a unique plan name by appending a number if needed
 */
export async function getUniquePlanName(baseName: string): Promise<string> {
  const plans = await getPlanList();
  const existingNames = new Set(plans.map(p => p.name));

  // If the name is already unique, return it
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  // Try appending numbers until we find a unique name
  let counter = 2;
  while (existingNames.has(`${baseName} (${counter})`)) {
    counter++;
  }

  return `${baseName} (${counter})`;
}

/**
 * Options for copying a plan
 */
export interface CopyPlanOptions {
  newName: string;
  shiftDates: boolean;
  shiftAmount: number;
  shiftUnit: 'years' | 'months';
  unassignAll: boolean;
}

/**
 * Copy the current plan with optional date shifting and crop unassignment.
 * Returns the new plan ID.
 */
export async function copyPlan(options: CopyPlanOptions): Promise<string> {
  const state = usePlanStore.getState();
  if (!state.currentPlan) {
    throw new Error('No plan loaded to copy');
  }

  const now = Date.now();
  const newId = generateId();

  /**
   * Shift a date string by the specified amount.
   * Handles ISO date strings (e.g., 2025-01-26T00:00:00).
   */
  function shiftDate(dateStr: string): string {
    if (!options.shiftDates || options.shiftAmount === 0) {
      return dateStr;
    }

    // Parse the ISO date string
    const date = parseISO(dateStr);

    if (!isValid(date)) {
      console.warn('[shiftDate] Invalid date:', dateStr);
      return dateStr;
    }

    // Apply the shift
    const shifted = options.shiftUnit === 'years'
      ? addYears(date, options.shiftAmount)
      : addMonths(date, options.shiftAmount);

    // Return in same format as input (with time component if present)
    if (dateStr.includes('T')) {
      return format(shifted, "yyyy-MM-dd'T'HH:mm:ss");
    }
    return format(shifted, 'yyyy-MM-dd');
  }

  // Deep clone and transform crops
  const newCrops: TimelineCrop[] = getPlanCrops(state.currentPlan).map((crop) => {
    const newCrop: TimelineCrop = {
      ...crop,
      id: `${crop.groupId}_${newId.slice(-6)}`, // New unique ID
      startDate: shiftDate(crop.startDate),
      endDate: shiftDate(crop.endDate),
      harvestStartDate: crop.harvestStartDate ? shiftDate(crop.harvestStartDate) : undefined,
      lastModified: now,
    };

    // Unassign all crops if requested
    if (options.unassignAll) {
      newCrop.resource = '';
      newCrop.totalBeds = 1;
      newCrop.bedIndex = 1;
      newCrop.feetUsed = undefined;
      newCrop.bedCapacityFt = undefined;
    }

    return newCrop;
  });

  // If unassigning, collapse each group to a single entry
  let finalCrops = newCrops;
  if (options.unassignAll) {
    const groupMap = new Map<string, TimelineCrop>();
    for (const crop of newCrops) {
      if (!groupMap.has(crop.groupId)) {
        groupMap.set(crop.groupId, {
          ...crop,
          id: `${crop.groupId}_unassigned`,
        });
      }
    }
    finalCrops = Array.from(groupMap.values());
  }

  // Calculate the new plan year based on shift
  let newYear = state.currentPlan.metadata.year ?? new Date().getFullYear();
  if (options.shiftAmount !== 0 && options.shiftUnit === 'years') {
    newYear += options.shiftAmount;
  } else if (options.shiftAmount !== 0 && options.shiftUnit === 'months') {
    // If shifting by months, calculate the new year based on month shift
    const currentMonth = new Date().getMonth(); // 0-indexed
    const totalMonths = currentMonth + options.shiftAmount;
    newYear += Math.floor(totalMonths / 12);
  }

  // Ensure unique name
  const uniqueName = await getUniquePlanName(options.newName);

  // Copy beds from source plan or create from template
  let beds: Record<string, Bed>;
  if (state.currentPlan.beds) {
    beds = JSON.parse(JSON.stringify(state.currentPlan.beds));
  } else {
    const bedGroups = (bedPlanData as { bedGroups: Record<string, string[]> }).bedGroups;
    beds = createBedsFromTemplate(bedGroups);
  }

  // Copy cropCatalog from source plan
  const cropCatalog = state.currentPlan.cropCatalog
    ? JSON.parse(JSON.stringify(state.currentPlan.cropCatalog))
    : {};

  // Create new plan with lineage tracking
  const newPlan: Plan = {
    id: newId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    metadata: {
      id: newId,
      name: uniqueName,
      createdAt: now,
      lastModified: now,
      year: newYear,
      version: 1,
      parentPlanId: state.currentPlan.id,
      parentVersion: state.currentPlan.metadata.version,
    },
    crops: finalCrops,
    resources: [...getPlanResources(state.currentPlan)],
    groups: getPlanGroups(state.currentPlan).map((g) => ({
      name: g.name,
      beds: [...g.beds],
    })),
    beds,
    cropCatalog,
    changeLog: [],
  };

  // Validate before saving
  try {
    validatePlan(newPlan);
  } catch (e) {
    console.warn('[copyPlan] Plan validation warning:', e);
  }

  // Save to library
  await savePlanToLibrary(newPlan);

  return newId;
}

/**
 * Migrate plans from old storage format to new library format.
 * Call this once on app initialization.
 */
export async function migrateOldStorageFormat(): Promise<void> {
  const OLD_STORAGE_KEY = 'crop-plan-storage';
  const MIGRATION_FLAG_KEY = 'crop-plan-migrated';

  // Check if already migrated
  const migrated = await storage.getFlag(MIGRATION_FLAG_KEY);
  if (migrated) {
    return;
  }

  try {
    // Read old data directly from localStorage (one-time migration)
    const oldData = localStorage.getItem(OLD_STORAGE_KEY);
    if (!oldData) {
      await storage.setFlag(MIGRATION_FLAG_KEY, 'true');
      return;
    }

    const parsed = JSON.parse(oldData);
    const oldPlan = parsed?.state?.currentPlan;

    if (oldPlan && oldPlan.id && oldPlan.metadata) {
      // Migrate the old plan to the new library
      await savePlanToLibrary(oldPlan);
      console.log('[Migration] Migrated plan from old storage:', oldPlan.metadata.name);
    }

    // Mark as migrated (but keep old data as backup)
    await storage.setFlag(MIGRATION_FLAG_KEY, 'true');
  } catch (e) {
    console.error('[Migration] Failed to migrate old storage:', e);
    // Still mark as migrated to avoid repeated failures
    await storage.setFlag(MIGRATION_FLAG_KEY, 'true');
  }
}

// ============================================
// Helper Functions
// ============================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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

// ============================================
// Snapshot Functions (async, use adapter)
// ============================================

async function saveSnapshot(plan: Plan): Promise<void> {
  const snapshot: PlanSnapshot = {
    id: generateId(),
    timestamp: Date.now(),
    plan: JSON.parse(JSON.stringify(plan)), // Deep clone
  };
  await storage.saveSnapshot(snapshot);
}

export async function getAutoSaveSnapshots(): Promise<PlanSnapshot[]> {
  return storage.getSnapshots();
}

export async function restoreFromSnapshot(snapshotId: string): Promise<Plan | null> {
  const snapshots = await storage.getSnapshots();
  const snapshot = snapshots.find(s => s.id === snapshotId);
  return snapshot?.plan ?? null;
}

// ============================================
// Stash Functions (async, use adapter)
// ============================================

async function saveToStashInternal(plan: Plan, reason: string): Promise<StashEntry> {
  const entry: StashEntry = {
    id: generateId(),
    timestamp: Date.now(),
    reason,
    plan: JSON.parse(JSON.stringify(plan)), // Deep clone
  };
  await storage.saveToStash(entry);
  return entry;
}

export async function getStash(): Promise<StashEntry[]> {
  return storage.getStash();
}

export async function restoreFromStash(stashId: string): Promise<Plan | null> {
  const entries = await storage.getStash();
  const entry = entries.find(e => e.id === stashId);
  return entry?.plan ?? null;
}

export async function clearStash(): Promise<void> {
  return storage.clearStash();
}

// ============================================
// Checkpoint Functions (async, use adapter)
// ============================================

/**
 * Create a named checkpoint for the current plan
 */
export async function createCheckpoint(name: string, description?: string): Promise<Checkpoint> {
  const state = usePlanStore.getState();
  if (!state.currentPlan) {
    throw new Error('No plan loaded');
  }

  const checkpoint: Checkpoint = {
    id: generateId(),
    planId: state.currentPlan.id,
    name,
    description,
    timestamp: Date.now(),
    plan: JSON.parse(JSON.stringify(state.currentPlan)), // Deep clone
  };

  await storage.saveCheckpoint(checkpoint);
  return checkpoint;
}

/**
 * Get all checkpoints for a plan
 */
export async function getCheckpoints(planId?: string): Promise<Checkpoint[]> {
  const id = planId ?? usePlanStore.getState().currentPlan?.id;
  if (!id) return [];
  return storage.getCheckpoints(id);
}

/**
 * Delete a checkpoint
 */
export async function deleteCheckpoint(checkpointId: string, planId?: string): Promise<void> {
  const id = planId ?? usePlanStore.getState().currentPlan?.id;
  if (!id) return;
  return storage.deleteCheckpoint(checkpointId, id);
}

/**
 * Get unified history combining checkpoints, auto-saves, and stash entries
 * Sorted by timestamp descending (most recent first)
 */
export async function getHistory(planId?: string): Promise<HistoryEntry[]> {
  const id = planId ?? usePlanStore.getState().currentPlan?.id;
  if (!id) return [];

  const [checkpoints, snapshots, stash] = await Promise.all([
    storage.getCheckpoints(id),
    storage.getSnapshots(),
    storage.getStash(),
  ]);

  const entries: HistoryEntry[] = [];

  // Add checkpoints
  for (const cp of checkpoints) {
    entries.push({
      id: cp.id,
      type: 'checkpoint',
      name: cp.name,
      timestamp: cp.timestamp,
      plan: cp.plan,
    });
  }

  // Add auto-saves (only for current plan)
  for (const snap of snapshots) {
    if (snap.plan.id === id) {
      entries.push({
        id: snap.id,
        type: 'auto-save',
        name: 'Auto-save',
        timestamp: snap.timestamp,
        plan: snap.plan,
      });
    }
  }

  // Add stash entries (only for current plan)
  for (const s of stash) {
    if (s.plan.id === id) {
      entries.push({
        id: s.id,
        type: 'stash',
        name: s.reason,
        timestamp: s.timestamp,
        plan: s.plan,
      });
    }
  }

  // Sort by timestamp descending (most recent first)
  entries.sort((a, b) => b.timestamp - a.timestamp);

  return entries;
}

/**
 * Restore from any history entry
 * Stashes current state first for safety (only if there are unsaved changes)
 */
export async function restoreFromHistory(entry: HistoryEntry): Promise<void> {
  const state = usePlanStore.getState();

  // Only stash if there are unsaved changes - no point stashing an unchanged restore
  if (state.currentPlan && state.isDirty) {
    await saveToStashInternal(state.currentPlan, `Before restoring "${entry.name}"`);
  }

  // Load the plan from the history entry
  state.loadPlan(entry.plan);
}

// ============================================
// Extended State and Actions with isSaving
// ============================================

interface ExtendedPlanState extends PlanState {
  isSaving: boolean;
  saveError: string | null;
}

interface ExtendedPlanActions extends Omit<PlanActions, 'loadPlanById' | 'renamePlan' | 'createNewPlan' | 'moveCrop' | 'updateCropDates' | 'deleteCrop' | 'undo' | 'redo'> {
  // Async versions of actions that persist
  loadPlanById: (planId: string) => Promise<void>;
  renamePlan: (newName: string) => Promise<void>;
  createNewPlan: (name: string, crops: TimelineCrop[], resources: string[], groups: ResourceGroup[]) => Promise<void>;
  moveCrop: (groupId: string, newResource: string, bedSpanInfo?: BedSpanInfo[]) => Promise<void>;
  updateCropDates: (groupId: string, startDate: string, endDate: string) => Promise<void>;
  deleteCrop: (groupId: string) => Promise<void>;
  addCrop: (crop: TimelineCrop) => Promise<void>;
  duplicateCrop: (groupId: string) => Promise<string>;
  recalculateCrops: (configIdentifier: string, catalog: import('./crop-calculations').CropConfig[]) => Promise<number>;
  /** Update a crop config in the plan's catalog and recalculate affected crops */
  updateCropConfig: (config: import('./crop-calculations').CropConfig) => Promise<number>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clearSaveError: () => void;
}

type ExtendedPlanStore = ExtendedPlanState & ExtendedPlanActions;

// ============================================
// Zustand Store (no persist middleware)
// ============================================

export const usePlanStore = create<ExtendedPlanStore>()(
  immer((set, get) => ({
    // Initial state
    currentPlan: null,
    past: [],
    future: [],
    isDirty: false,
    isLoading: false,
    isSaving: false,
    saveError: null,
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
      // Fire-and-forget save to library (loadPlan is sync for compatibility)
      savePlanToLibrary(plan).catch(e => {
        console.error('Failed to save loaded plan:', e);
      });
    },

    loadPlanById: async (planId: string) => {
      set((state) => {
        state.isLoading = true;
      });

      const data = await loadPlanFromLibrary(planId);
      if (!data) {
        set((state) => {
          state.isLoading = false;
        });
        throw new Error(`Plan not found: ${planId}`);
      }

      // Validate plan on load
      try {
        validatePlan(data.plan);
      } catch (e) {
        console.warn('[loadPlanById] Plan validation warning:', e);
        // Continue loading - don't fail on invalid data, just warn
      }

      // Initialize ID counter based on existing plantings to avoid collisions
      const existingIds = getPlanCrops(data.plan).map(c => c.groupId);
      initializeIdCounter(existingIds);

      set((state) => {
        state.currentPlan = data.plan;
        // Start with empty undo/redo history (old format was TimelineCrop[][], new is Plan[])
        // History is session-only anyway, not worth migrating
        state.past = [];
        state.future = [];
        state.isDirty = false;
        state.isLoading = false;
      });
    },

    renamePlan: async (newName: string) => {
      set((state) => {
        if (!state.currentPlan) return;
        state.currentPlan.metadata.name = newName;
        state.currentPlan.metadata.lastModified = Date.now();
        state.isSaving = true;
        state.saveError = null;
      });

      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => {
            state.isSaving = false;
            state.isDirty = false;
          });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
          throw e;
        }
      }
    },

    createNewPlan: async (
      name: string,
      crops: TimelineCrop[],
      resources: string[],
      groups: ResourceGroup[]
    ) => {
      const now = Date.now();
      const id = generateId();
      // Default to closest April: if May or later, use next year; otherwise current year
      const currentMonth = new Date().getMonth(); // 0-indexed (0=Jan, 4=May)
      const currentYear = new Date().getFullYear();
      const defaultYear = currentMonth >= 4 ? currentYear + 1 : currentYear;
      // Ensure unique plan name
      const uniqueName = await getUniquePlanName(name);

      // Build crop catalog map from master (deep copy for plan-specific edits)
      const masterCrops = getAllCrops();
      const cropCatalog: Record<string, CropConfig> = {};
      for (const crop of masterCrops) {
        // Deep copy to avoid mutations affecting master
        cropCatalog[crop.identifier] = JSON.parse(JSON.stringify(crop));
      }

      // Build beds from template
      const bedGroups = (bedPlanData as { bedGroups: Record<string, string[]> }).bedGroups;
      const beds: Record<string, Bed> = createBedsFromTemplate(bedGroups);

      const plan: Plan = {
        id,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        metadata: {
          id,
          name: uniqueName,
          createdAt: now,
          lastModified: now,
          year: defaultYear,
        },
        crops,
        resources,
        groups,
        beds,
        cropCatalog,
        changeLog: [],
      };

      // Validate before saving
      try {
        validatePlan(plan);
      } catch (e) {
        console.warn('[createNewPlan] Plan validation warning:', e);
      }

      set((state) => {
        state.currentPlan = plan;
        state.past = [];
        state.future = [];
        state.isDirty = false;
        state.isLoading = false;
        state.isSaving = true;
        state.saveError = null;
      });

      try {
        await savePlanToLibrary(plan);
        set((state) => {
          state.isSaving = false;
        });
      } catch (e) {
        set((state) => {
          state.isSaving = false;
          state.saveError = e instanceof Error ? e.message : 'Failed to save';
        });
        throw e;
      }
    },

    resetPlan: () => {
      set((state) => {
        state.currentPlan = null;
        state.past = [];
        state.future = [];
        state.isDirty = false;
      });
    },

    // Crop mutations - all push to undo stack and save
    moveCrop: async (groupId: string, newResource: string, bedSpanInfo?: BedSpanInfo[]) => {
      set((state) => {
        if (!state.currentPlan) return;

        // Snapshot for undo before any mutations
        snapshotForUndo(state);

        // Find all crops with this groupId
        const currentCrops = state.currentPlan.crops ?? [];
        const groupCrops = currentCrops.filter((c) => c.groupId === groupId);
        const otherCrops = currentCrops.filter((c) => c.groupId !== groupId);

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
        state.currentPlan.crops?.sort((a, b) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
        );

        // Update metadata
        state.currentPlan.metadata.lastModified = Date.now();
        state.currentPlan.changeLog.push(
          createChangeEntry('move', `Moved ${groupId} to ${newResource || 'unassigned'}`, [groupId])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      // Save to library
      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => {
            state.isSaving = false;
            state.isDirty = false;
          });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },

    updateCropDates: async (groupId: string, startDate: string, endDate: string) => {
      set((state) => {
        if (!state.currentPlan) return;

        // Snapshot for undo before any mutations
        snapshotForUndo(state);

        // Update all crops with this groupId
        const currentCrops = state.currentPlan.crops ?? [];
        const now = Date.now();
        currentCrops
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
        state.isSaving = true;
        state.saveError = null;
      });

      // Save to library
      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => {
            state.isSaving = false;
            state.isDirty = false;
          });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },

    deleteCrop: async (groupId: string) => {
      set((state) => {
        if (!state.currentPlan) return;

        // Snapshot for undo before any mutations
        snapshotForUndo(state);

        // Remove all crops with this groupId
        const currentCrops = state.currentPlan.crops ?? [];
        state.currentPlan.crops = currentCrops.filter(
          (c) => c.groupId !== groupId
        );

        state.currentPlan.metadata.lastModified = Date.now();
        state.currentPlan.changeLog.push(
          createChangeEntry('delete', `Deleted ${groupId}`, [groupId])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      // Save to library
      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => {
            state.isSaving = false;
            state.isDirty = false;
          });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },

    addCrop: async (crop: TimelineCrop) => {
      set((state) => {
        if (!state.currentPlan) return;

        // Snapshot for undo before any mutations
        snapshotForUndo(state);

        // Add the new crop with timestamp
        const now = Date.now();
        const newCrop: TimelineCrop = {
          ...crop,
          lastModified: now,
        };
        if (!state.currentPlan.crops) state.currentPlan.crops = [];
        state.currentPlan.crops.push(newCrop);

        // Sort by start date
        state.currentPlan.crops.sort((a, b) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
        );

        state.currentPlan.metadata.lastModified = now;
        state.currentPlan.changeLog.push(
          createChangeEntry('create', `Added ${crop.name}`, [crop.groupId])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      // Save to library
      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => {
            state.isSaving = false;
            state.isDirty = false;
          });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },

    duplicateCrop: async (groupId: string) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      // Find all crops with this groupId
      const groupCrops = getPlanCrops(state.currentPlan).filter(c => c.groupId === groupId);
      if (groupCrops.length === 0) {
        throw new Error(`No crop found with groupId: ${groupId}`);
      }

      // Generate a new short unique ID
      const newGroupId = generatePlantingId();
      const now = Date.now();

      // Create a single unassigned copy based on the first crop in the group
      const template = groupCrops[0];
      const newCrop: TimelineCrop = {
        ...template,
        id: `${newGroupId}_unassigned`,
        groupId: newGroupId,
        plantingId: newGroupId,
        resource: '', // Unassigned
        totalBeds: 1,
        bedIndex: 1,
        feetUsed: undefined,
        bedCapacityFt: undefined,
        lastModified: now,
      };

      // Use the addCrop action to add it
      await get().addCrop(newCrop);

      return newGroupId;
    },

    recalculateCrops: async (configIdentifier: string, catalog: import('./crop-calculations').CropConfig[]) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      const bedGroups = (bedPlanData as { bedGroups: Record<string, string[]> }).bedGroups;
      const currentCrops = getPlanCrops(state.currentPlan);

      // Count how many plantings will be affected
      const affectedGroupIds = new Set<string>();
      for (const crop of currentCrops) {
        if (crop.cropConfigId === configIdentifier) {
          affectedGroupIds.add(crop.groupId);
        }
      }

      if (affectedGroupIds.size === 0) {
        return 0; // No crops to recalculate
      }

      // Recalculate crops
      const recalculated = recalculateCropsForConfig(
        currentCrops,
        configIdentifier,
        catalog,
        bedGroups
      );

      set((storeState) => {
        if (!storeState.currentPlan) return;

        // Snapshot for undo
        snapshotForUndo(storeState);

        // Update crops
        storeState.currentPlan.crops = recalculated;
        storeState.currentPlan.metadata.lastModified = Date.now();
        storeState.currentPlan.changeLog.push(
          createChangeEntry('batch', `Recalculated ${affectedGroupIds.size} planting(s) for config change`, [...affectedGroupIds])
        );
        storeState.isDirty = true;
        storeState.isSaving = true;
        storeState.saveError = null;
      });

      // Save to library
      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((storeState) => {
            storeState.isSaving = false;
            storeState.isDirty = false;
          });
        } catch (e) {
          set((storeState) => {
            storeState.isSaving = false;
            storeState.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }

      return affectedGroupIds.size;
    },

    updateCropConfig: async (config: CropConfig) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (!state.currentPlan.cropCatalog) {
        throw new Error('Plan has no crop catalog');
      }

      const bedGroups = (bedPlanData as { bedGroups: Record<string, string[]> }).bedGroups;

      // Build updated catalog (copy, then update)
      const updatedCatalog = { ...state.currentPlan.cropCatalog };
      updatedCatalog[config.identifier] = JSON.parse(JSON.stringify(config));

      // Build catalog array for recalculation
      const catalogArray = Object.values(updatedCatalog);
      const currentCrops = getPlanCrops(state.currentPlan);

      // Count affected crops
      const affectedGroupIds = new Set<string>();
      for (const crop of currentCrops) {
        if (crop.cropConfigId === config.identifier) {
          affectedGroupIds.add(crop.groupId);
        }
      }

      // Recalculate affected crops
      const recalculated = affectedGroupIds.size > 0
        ? recalculateCropsForConfig(currentCrops, config.identifier, catalogArray, bedGroups)
        : currentCrops;

      set((storeState) => {
        if (!storeState.currentPlan) return;

        // Snapshot for undo
        snapshotForUndo(storeState);

        // Update catalog and crops
        storeState.currentPlan.cropCatalog = updatedCatalog;
        storeState.currentPlan.crops = recalculated;
        storeState.currentPlan.metadata.lastModified = Date.now();
        storeState.currentPlan.changeLog.push(
          createChangeEntry('batch', `Updated config "${config.identifier}"`, [...affectedGroupIds])
        );
        storeState.isDirty = true;
        storeState.isSaving = true;
        storeState.saveError = null;
      });

      // Save to library
      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((storeState) => {
            storeState.isSaving = false;
            storeState.isDirty = false;
          });
        } catch (e) {
          set((storeState) => {
            storeState.isSaving = false;
            storeState.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }

      return affectedGroupIds.size;
    },

    // History - now stores full Plan snapshots
    undo: async () => {
      set((state) => {
        if (!state.currentPlan || state.past.length === 0) return;

        const previous = state.past.pop()!;
        // Push current to future, restore previous
        state.future.push(deepCopyPlan(state.currentPlan));
        state.currentPlan = deepCopyPlan(previous);
        state.currentPlan.metadata.lastModified = Date.now();
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      // Save to library
      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => {
            state.isSaving = false;
            state.isDirty = false;
          });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },

    redo: async () => {
      set((state) => {
        if (!state.currentPlan || state.future.length === 0) return;

        const next = state.future.pop()!;
        // Push current to past, restore next
        state.past.push(deepCopyPlan(state.currentPlan));
        state.currentPlan = deepCopyPlan(next);
        state.currentPlan.metadata.lastModified = Date.now();
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      // Save to library
      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => {
            state.isSaving = false;
            state.isDirty = false;
          });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
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

    clearSaveError: () => {
      set((state) => {
        state.saveError = null;
      });
    },
  }))
);

// ============================================
// Helper Hooks
// ============================================

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
 * Helper hook for save state
 */
export function useSaveState() {
  const isSaving = usePlanStore((state) => state.isSaving);
  const saveError = usePlanStore((state) => state.saveError);
  const clearSaveError = usePlanStore((state) => state.clearSaveError);
  return { isSaving, saveError, clearSaveError };
}

// ============================================
// Auto-Save Timer (DISABLED)
// ============================================
// Auto-save snapshots are disabled because:
// 1. Every mutation already saves to the plan library immediately
// 2. Full Plan snapshots (with beds + cropCatalog) are ~400KB each
// 3. localStorage has a 5-10MB limit, easily exceeded with a few snapshots
//
// If crash recovery is needed, consider:
// - IndexedDB (larger quota)
// - Slim snapshots (exclude beds/cropCatalog, rebuild on restore)

let autoSaveInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSave(): void {
  // Disabled - mutations save immediately, snapshots would bloat localStorage
  console.log('[AutoSave] Disabled - mutations save immediately');
}

export function stopAutoSave(): void {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
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
    await saveToStashInternal(state.currentPlan, `Before importing ${file.name}`);
  }

  // Read file
  const arrayBuffer = await file.arrayBuffer();
  const compressed = new Uint8Array(arrayBuffer);

  // Decompress
  let jsonString: string;
  try {
    const decompressed = pako.ungzip(compressed);
    jsonString = new TextDecoder().decode(decompressed);
  } catch {
    throw new Error('Failed to decompress file. Is this a valid .crop-plan.gz file?');
  }

  // Parse JSON
  let fileData: CropPlanFile;
  try {
    fileData = JSON.parse(jsonString);
  } catch {
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
  } catch {
    throw new Error('Failed to decompress file. Is this a valid .crop-plan.gz file?');
  }

  let fileData: CropPlanFile;
  try {
    fileData = JSON.parse(jsonString);
  } catch {
    throw new Error('Failed to parse file. Invalid JSON format.');
  }

  if (fileData.formatVersion !== 1) {
    throw new Error(`Unsupported file format version: ${fileData.formatVersion}`);
  }

  return fileData;
}
