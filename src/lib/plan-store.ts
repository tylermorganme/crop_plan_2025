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
  PlanChange,
  BedSpanInfo,
  CropPlanFile,
  StashEntry,
  Checkpoint,
  HistoryEntry,
  Bed,
  Planting,
  TimelineCrop,
} from './plan-types';
import {
  CURRENT_SCHEMA_VERSION,
  validatePlan,
  createBedsFromTemplate,
  migratePlan,
} from './plan-types';
import type { BedGroup } from './plan-types';
import {
  generatePlantingId,
  initializePlantingIdCounter,
  clonePlanting,
} from './entities/planting';
import { cloneBeds, cloneBedGroups, createBed, createBedGroup } from './entities/bed';
import { storage, onSyncMessage, type PlanSummary, type PlanSnapshot, type PlanData } from './storage-adapter';
import bedPlanData from '@/data/bed-plan.json';
import { getAllCrops } from './crops';
import type { CropConfig } from './entities/crop-config';
import { cloneCropConfig, cloneCropCatalog } from './entities/crop-config';

// Re-export types for consumers
export type { PlanSummary, PlanSnapshot, PlanData };

// Active plan ID key (shared with components that need it)
export const ACTIVE_PLAN_KEY = 'crop-explorer-active-plan';

const MAX_HISTORY_SIZE = 50;

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
   */
  function shiftDate(dateStr: string): string {
    if (!options.shiftDates || options.shiftAmount === 0) {
      return dateStr;
    }

    const date = parseISO(dateStr);
    if (!isValid(date)) {
      console.warn('[shiftDate] Invalid date:', dateStr);
      return dateStr;
    }

    const shifted = options.shiftUnit === 'years'
      ? addYears(date, options.shiftAmount)
      : addMonths(date, options.shiftAmount);

    if (dateStr.includes('T')) {
      return format(shifted, "yyyy-MM-dd'T'HH:mm:ss");
    }
    return format(shifted, 'yyyy-MM-dd');
  }

  // Clone plantings using CRUD function
  const sourcePlantings = state.currentPlan.plantings ?? [];
  const newPlantings: Planting[] = sourcePlantings.map((p) =>
    clonePlanting(p, {
      fieldStartDate: shiftDate(p.fieldStartDate),
      startBed: options.unassignAll ? null : p.startBed,
    })
  );

  // Calculate the new plan year based on shift
  let newYear = state.currentPlan.metadata.year ?? new Date().getFullYear();
  if (options.shiftAmount !== 0 && options.shiftUnit === 'years') {
    newYear += options.shiftAmount;
  } else if (options.shiftAmount !== 0 && options.shiftUnit === 'months') {
    const currentMonth = new Date().getMonth();
    const totalMonths = currentMonth + options.shiftAmount;
    newYear += Math.floor(totalMonths / 12);
  }

  const uniqueName = await getUniquePlanName(options.newName);

  // Clone beds, groups, and catalog using CRUD functions
  let beds: Record<string, Bed>;
  let bedGroups: Record<string, BedGroup>;

  if (state.currentPlan.beds && state.currentPlan.bedGroups) {
    beds = cloneBeds(state.currentPlan.beds);
    bedGroups = cloneBedGroups(state.currentPlan.bedGroups);
  } else {
    const bedGroupsTemplate = (bedPlanData as { bedGroups: Record<string, string[]> }).bedGroups;
    const result = createBedsFromTemplate(bedGroupsTemplate);
    beds = result.beds;
    bedGroups = result.groups;
  }

  const cropCatalog = state.currentPlan.cropCatalog
    ? cloneCropCatalog(Object.values(state.currentPlan.cropCatalog))
    : {};

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
    plantings: newPlantings,
    beds,
    bedGroups,
    cropCatalog,
    changeLog: [],
  };

  try {
    validatePlan(newPlan);
  } catch (e) {
    console.warn('[copyPlan] Plan validation warning:', e);
  }

  // Save to library
  await savePlanToLibrary(newPlan);

  return newId;
}

// ============================================
// Helper Functions
// ============================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Build a name-to-UUID lookup for beds.
 * Used to convert display names from timeline to UUIDs for storage.
 */
function buildBedNameToUuidMap(beds: Record<string, Bed>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const bed of Object.values(beds)) {
    map[bed.name] = bed.id;
  }
  return map;
}

/**
 * Convert a bed name to its UUID.
 * Returns null if bed not found (e.g., for "Unassigned").
 */
function bedNameToUuid(name: string, beds: Record<string, Bed>): string | null {
  if (!name || name === 'Unassigned') return null;
  const map = buildBedNameToUuidMap(beds);
  return map[name] ?? null;
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
  /** Centralized plan list for all components */
  planList: PlanSummary[];
  /** Active plan ID (synced to localStorage for cross-tab) */
  activePlanId: string | null;
}

interface ExtendedPlanActions extends Omit<PlanActions, 'loadPlanById' | 'renamePlan' | 'createNewPlan' | 'moveCrop' | 'updateCropDates' | 'deleteCrop' | 'undo' | 'redo'> {
  // Async versions of actions that persist
  loadPlanById: (planId: string) => Promise<void>;
  renamePlan: (newName: string) => Promise<void>;
  createNewPlan: (name: string, plantings?: Planting[]) => Promise<void>;
  moveCrop: (groupId: string, newResource: string, bedSpanInfo?: BedSpanInfo[]) => Promise<void>;
  updateCropDates: (groupId: string, startDate: string, endDate: string) => Promise<void>;
  deleteCrop: (groupId: string) => Promise<void>;
  addPlanting: (planting: Planting) => Promise<void>;
  duplicatePlanting: (plantingId: string) => Promise<string>;
  updatePlanting: (plantingId: string, updates: Partial<Pick<Planting, 'bedFeet' | 'overrides' | 'notes'>>) => Promise<void>;
  recalculateCrops: (configIdentifier: string, catalog: import('./entities/crop-config').CropConfig[]) => Promise<number>;
  /** Update a crop config in the plan's catalog and recalculate affected crops */
  updateCropConfig: (config: import('./entities/crop-config').CropConfig) => Promise<number>;
  /** Add a new crop config to the plan's catalog */
  addCropConfig: (config: import('./entities/crop-config').CropConfig) => Promise<void>;
  /** Delete crop configs from the plan's catalog by their identifiers */
  deleteCropConfigs: (identifiers: string[]) => Promise<number>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clearSaveError: () => void;
  /** Refresh plan list from storage */
  refreshPlanList: () => Promise<void>;
  /** Set active plan ID (syncs to localStorage) */
  setActivePlanId: (planId: string | null) => void;

  // ---- Bed Management ----
  /** Rename a bed */
  renameBed: (bedId: string, newName: string) => Promise<void>;
  /** Add a new bed to a group */
  addBed: (groupId: string, name: string, lengthFt: number) => Promise<string>;
  /** Delete a bed (fails if plantings reference it) */
  deleteBed: (bedId: string) => Promise<void>;
  /** Delete a bed and handle its plantings */
  deleteBedWithPlantings: (bedId: string, action: 'unassign') => Promise<void>;
  /** Move a bed to a new position within its group */
  reorderBed: (bedId: string, newDisplayOrder: number) => Promise<void>;
  /** Move a bed to a different group */
  moveBedToGroup: (bedId: string, newGroupId: string, newDisplayOrder: number) => Promise<void>;

  // ---- Bed Group Management ----
  /** Rename a bed group */
  renameBedGroup: (groupId: string, newName: string) => Promise<void>;
  /** Add a new bed group */
  addBedGroup: (name: string) => Promise<string>;
  /** Delete an empty bed group */
  deleteBedGroup: (groupId: string) => Promise<void>;
  /** Move a bed group to a new position */
  reorderBedGroup: (groupId: string, newDisplayOrder: number) => Promise<void>;
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
    planList: [],
    activePlanId: null,

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

      // Migrate plan to current schema version
      data.plan = migratePlan(data.plan);

      // Ensure beds and groups exist (for brand new plans without any beds)
      if (!data.plan.beds || !data.plan.bedGroups) {
        const bedGroupsTemplate = (bedPlanData as { bedGroups: Record<string, string[]> }).bedGroups;
        const { beds, groups } = createBedsFromTemplate(bedGroupsTemplate);
        data.plan.beds = beds;
        data.plan.bedGroups = groups;
      }

      // Validate plan on load
      try {
        validatePlan(data.plan);
      } catch (e) {
        console.warn('[loadPlanById] Plan validation warning:', e);
        // Continue loading - don't fail on invalid data, just warn
      }

      // Initialize ID counter based on existing plantings to avoid collisions
      const existingIds = (data.plan.plantings ?? []).map(p => p.id);
      initializePlantingIdCounter(existingIds);

      set((state) => {
        // Only clear undo/redo history if loading a different plan
        const isNewPlan = state.currentPlan?.id !== data.plan.id;

        state.currentPlan = data.plan;

        if (isNewPlan) {
          // Start with empty undo/redo history for new plan
          state.past = [];
          state.future = [];
        }
        // If same plan, preserve undo/redo history

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

    createNewPlan: async (name: string, plantings?: Planting[]) => {
      const now = Date.now();
      const id = generateId();
      // Default to closest April: if May or later, use next year; otherwise current year
      const currentMonth = new Date().getMonth(); // 0-indexed (0=Jan, 4=May)
      const currentYear = new Date().getFullYear();
      const defaultYear = currentMonth >= 4 ? currentYear + 1 : currentYear;
      // Ensure unique plan name
      const uniqueName = await getUniquePlanName(name);

      // Build crop catalog map from master using CRUD function
      const masterCrops = getAllCrops();
      const cropCatalog = cloneCropCatalog(masterCrops);

      // Build beds and groups from template
      const bedGroupsTemplate = (bedPlanData as { bedGroups: Record<string, string[]> }).bedGroups;
      const { beds, groups: bedGroups, nameToIdMap } = createBedsFromTemplate(bedGroupsTemplate);

      // Convert imported plantings' bed names to UUIDs
      // (plantings from collapseToPlantings have bed names like "A1", not UUIDs)
      const convertedPlantings = (plantings ?? []).map(p => {
        if (p.startBed && nameToIdMap[p.startBed]) {
          return { ...p, startBed: nameToIdMap[p.startBed] };
        }
        return p;
      });

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
        plantings: convertedPlantings,
        beds,
        bedGroups,
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
    // NOTE: newResource is a bed NAME from the timeline, not a UUID.
    // We convert to UUID for storage.
    moveCrop: async (groupId: string, newResource: string, bedSpanInfo?: BedSpanInfo[]) => {
      set((state) => {
        if (!state.currentPlan?.plantings || !state.currentPlan.beds) return;

        // Snapshot for undo before any mutations
        snapshotForUndo(state);

        // Find the planting (groupId = planting.id in new format)
        const planting = state.currentPlan.plantings.find(p => p.id === groupId);
        if (!planting) return;

        const now = Date.now();

        if (newResource === '' || newResource === 'Unassigned' || !bedSpanInfo || bedSpanInfo.length === 0) {
          // Moving to Unassigned
          planting.startBed = null;
          // Keep existing bedFeet
        } else {
          // Convert bed name to UUID for storage
          const bedUuid = bedNameToUuid(newResource, state.currentPlan.beds!);
          if (!bedUuid) {
            console.warn(`[moveCrop] Bed not found: ${newResource}`);
            return;
          }
          planting.startBed = bedUuid;
          planting.bedFeet = bedSpanInfo.reduce((sum, b) => sum + b.feetUsed, 0);
        }
        planting.lastModified = now;

        // Update metadata
        state.currentPlan.metadata.lastModified = now;
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
        if (!state.currentPlan?.plantings) return;

        // Snapshot for undo before any mutations
        snapshotForUndo(state);

        // Find the planting
        const planting = state.currentPlan.plantings.find(p => p.id === groupId);
        if (!planting) return;

        const now = Date.now();
        // Only fieldStartDate is stored; endDate is computed from config
        // TODO: If user drags endDate, may need to store override
        planting.fieldStartDate = startDate;
        planting.lastModified = now;

        state.currentPlan.metadata.lastModified = now;
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
        if (!state.currentPlan?.plantings) return;

        // Snapshot for undo before any mutations
        snapshotForUndo(state);

        // Remove the planting
        state.currentPlan.plantings = state.currentPlan.plantings.filter(
          p => p.id !== groupId
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

    // NOTE: planting.startBed may be a bed NAME from the timeline.
    // We convert to UUID for storage.
    addPlanting: async (planting: Planting) => {
      set((state) => {
        if (!state.currentPlan?.plantings || !state.currentPlan.beds) return;

        // Snapshot for undo before any mutations
        snapshotForUndo(state);

        // Convert bed name to UUID if needed
        let startBedUuid = planting.startBed;
        if (startBedUuid && startBedUuid !== 'Unassigned') {
          // Check if it's already a UUID (exists as key in beds)
          if (!state.currentPlan.beds[startBedUuid]) {
            // It's a name, convert to UUID
            const uuid = bedNameToUuid(startBedUuid, state.currentPlan.beds);
            startBedUuid = uuid;
          }
        } else {
          startBedUuid = null;
        }

        // Add the new planting
        const now = Date.now();
        const newPlanting: Planting = {
          ...planting,
          startBed: startBedUuid,
          lastModified: now,
        };
        state.currentPlan.plantings.push(newPlanting);

        state.currentPlan.metadata.lastModified = now;
        state.currentPlan.changeLog.push(
          createChangeEntry('create', `Added planting ${planting.id}`, [planting.id])
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

    duplicatePlanting: async (plantingId: string) => {
      const state = get();
      if (!state.currentPlan?.plantings) {
        throw new Error('No plan loaded');
      }

      // Find the planting
      const original = state.currentPlan.plantings.find(p => p.id === plantingId);
      if (!original) {
        throw new Error(`No planting found with id: ${plantingId}`);
      }

      // Clone using CRUD function (generates new ID, sets startBed to null)
      const newPlanting = clonePlanting(original, { startBed: null });

      await get().addPlanting(newPlanting);

      return newPlanting.id;
    },

    updatePlanting: async (plantingId: string, updates: Partial<Pick<Planting, 'bedFeet' | 'overrides' | 'notes'>>) => {
      set((state) => {
        if (!state.currentPlan?.plantings) return;

        // Find the planting
        const planting = state.currentPlan.plantings.find(p => p.id === plantingId);
        if (!planting) return;

        // Snapshot for undo before any mutations
        snapshotForUndo(state);

        const now = Date.now();

        // Apply updates
        if (updates.bedFeet !== undefined) {
          planting.bedFeet = updates.bedFeet;
        }
        if (updates.overrides !== undefined) {
          // Merge overrides (shallow merge)
          planting.overrides = {
            ...planting.overrides,
            ...updates.overrides,
          };
        }
        if (updates.notes !== undefined) {
          planting.notes = updates.notes || undefined; // Clear if empty string
        }

        planting.lastModified = now;

        state.currentPlan.metadata.lastModified = now;
        state.currentPlan.changeLog.push(
          createChangeEntry('edit', `Updated planting ${plantingId}`, [plantingId])
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

    recalculateCrops: async (configIdentifier: string) => {
      const state = get();
      if (!state.currentPlan?.plantings) {
        throw new Error('No plan loaded');
      }

      // Count affected plantings
      const affected = state.currentPlan.plantings.filter(p => p.configId === configIdentifier);
      if (affected.length === 0) {
        return 0;
      }

      // With plantings model, no stored data needs updating - display is computed on-demand
      // Just touch lastModified to trigger re-render
      set((storeState) => {
        if (!storeState.currentPlan) return;

        snapshotForUndo(storeState);
        storeState.currentPlan.metadata.lastModified = Date.now();
        storeState.currentPlan.changeLog.push(
          createChangeEntry('batch', `Config changed: ${configIdentifier}`, affected.map(p => p.id))
        );
        storeState.isDirty = true;
        storeState.isSaving = true;
        storeState.saveError = null;
      });

      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((s) => { s.isSaving = false; s.isDirty = false; });
        } catch (e) {
          set((s) => { s.isSaving = false; s.saveError = e instanceof Error ? e.message : 'Failed to save'; });
        }
      }

      return affected.length;
    },

    updateCropConfig: async (config: CropConfig) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (!state.currentPlan.cropCatalog) {
        throw new Error('Plan has no crop catalog');
      }

      // Count affected plantings
      const affectedPlantingIds = (state.currentPlan.plantings ?? [])
        .filter(p => p.configId === config.identifier)
        .map(p => p.id);

      set((storeState) => {
        if (!storeState.currentPlan?.cropCatalog) return;

        // Snapshot for undo
        snapshotForUndo(storeState);

        // Update catalog using CRUD function - display will recompute automatically
        storeState.currentPlan.cropCatalog[config.identifier] = cloneCropConfig(config);
        storeState.currentPlan.metadata.lastModified = Date.now();
        storeState.currentPlan.changeLog.push(
          createChangeEntry('batch', `Updated config "${config.identifier}"`, affectedPlantingIds)
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

      return affectedPlantingIds.length;
    },

    addCropConfig: async (config: CropConfig) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      // Initialize catalog if it doesn't exist
      if (!state.currentPlan.cropCatalog) {
        state.currentPlan.cropCatalog = {};
      }

      // Check for duplicate identifier
      if (state.currentPlan.cropCatalog[config.identifier]) {
        throw new Error(`A config with identifier "${config.identifier}" already exists`);
      }

      set((storeState) => {
        if (!storeState.currentPlan) return;

        // Initialize catalog if needed
        if (!storeState.currentPlan.cropCatalog) {
          storeState.currentPlan.cropCatalog = {};
        }

        // Snapshot for undo
        snapshotForUndo(storeState);

        // Add new config to catalog using CRUD function
        storeState.currentPlan.cropCatalog[config.identifier] = cloneCropConfig(config);
        storeState.currentPlan.metadata.lastModified = Date.now();
        storeState.currentPlan.changeLog.push(
          createChangeEntry('batch', `Added new config "${config.identifier}"`, [])
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
    },

    deleteCropConfigs: async (identifiers: string[]) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (!state.currentPlan.cropCatalog) {
        throw new Error('Plan has no crop catalog');
      }

      // Find which identifiers actually exist
      const existingIdentifiers = identifiers.filter(
        id => state.currentPlan!.cropCatalog![id]
      );

      if (existingIdentifiers.length === 0) {
        return 0;
      }

      set((storeState) => {
        if (!storeState.currentPlan?.cropCatalog) return;

        // Snapshot for undo
        snapshotForUndo(storeState);

        // Delete configs from catalog
        for (const identifier of existingIdentifiers) {
          delete storeState.currentPlan.cropCatalog[identifier];
        }

        storeState.currentPlan.metadata.lastModified = Date.now();
        storeState.currentPlan.changeLog.push(
          createChangeEntry(
            'batch',
            existingIdentifiers.length === 1
              ? `Deleted config "${existingIdentifiers[0]}"`
              : `Deleted ${existingIdentifiers.length} configs`,
            []
          )
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

      return existingIdentifiers.length;
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

    refreshPlanList: async () => {
      const plans = await storage.getPlanList();
      set((state) => {
        state.planList = plans;
        // If active plan was deleted, clear it
        if (state.activePlanId && !plans.some(p => p.id === state.activePlanId)) {
          state.activePlanId = null;
          try {
            localStorage.removeItem(ACTIVE_PLAN_KEY);
          } catch { /* ignore */ }
        }
      });
    },

    setActivePlanId: (planId: string | null) => {
      set((state) => {
        state.activePlanId = planId;
      });
      // Sync to localStorage for cross-tab via storage events
      try {
        if (planId) {
          localStorage.setItem(ACTIVE_PLAN_KEY, planId);
        } else {
          localStorage.removeItem(ACTIVE_PLAN_KEY);
        }
      } catch { /* ignore */ }
      // Dispatch event for same-tab components that still listen
      window.dispatchEvent(new CustomEvent('plan-list-updated'));
    },

    // ========================================
    // Bed Management
    // ========================================

    renameBed: async (bedId: string, newName: string) => {
      set((state) => {
        if (!state.currentPlan?.beds) return;
        const bed = state.currentPlan.beds[bedId];
        if (!bed) return;

        snapshotForUndo(state);

        bed.name = newName;
        state.currentPlan.metadata.lastModified = Date.now();
        state.currentPlan.changeLog.push(
          createChangeEntry('edit', `Renamed bed to "${newName}"`, [])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => { state.isSaving = false; state.isDirty = false; });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },

    addBed: async (groupId: string, name: string, lengthFt: number) => {
      let newBedId = '';

      set((state) => {
        if (!state.currentPlan?.beds || !state.currentPlan?.bedGroups) return;
        if (!state.currentPlan.bedGroups[groupId]) return;

        snapshotForUndo(state);

        // Find max displayOrder in this group
        const bedsInGroup = Object.values(state.currentPlan.beds)
          .filter(b => b.groupId === groupId);
        const maxOrder = bedsInGroup.reduce((max, b) => Math.max(max, b.displayOrder), -1);

        const newBed = createBed(name, groupId, lengthFt, maxOrder + 1);
        newBedId = newBed.id;
        state.currentPlan.beds[newBed.id] = newBed;

        state.currentPlan.metadata.lastModified = Date.now();
        state.currentPlan.changeLog.push(
          createChangeEntry('create', `Added bed "${name}"`, [])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => { state.isSaving = false; state.isDirty = false; });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }

      return newBedId;
    },

    deleteBed: async (bedId: string) => {
      const state = get();
      if (!state.currentPlan?.beds || !state.currentPlan?.plantings) {
        throw new Error('No plan loaded');
      }

      // Check if any plantings reference this bed
      const referencingPlantings = state.currentPlan.plantings.filter(
        p => p.startBed === bedId
      );
      if (referencingPlantings.length > 0) {
        throw new Error(
          `Cannot delete bed: ${referencingPlantings.length} planting(s) reference it`
        );
      }

      set((state) => {
        if (!state.currentPlan?.beds) return;
        const bed = state.currentPlan.beds[bedId];
        if (!bed) return;

        snapshotForUndo(state);

        const bedName = bed.name;
        delete state.currentPlan.beds[bedId];

        state.currentPlan.metadata.lastModified = Date.now();
        state.currentPlan.changeLog.push(
          createChangeEntry('delete', `Deleted bed "${bedName}"`, [])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => { state.isSaving = false; state.isDirty = false; });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },

    reorderBed: async (bedId: string, newDisplayOrder: number) => {
      set((state) => {
        if (!state.currentPlan?.beds) return;
        const bed = state.currentPlan.beds[bedId];
        if (!bed) return;

        snapshotForUndo(state);

        const oldOrder = bed.displayOrder;
        const groupId = bed.groupId;

        // Shift other beds in the same group
        for (const b of Object.values(state.currentPlan.beds)) {
          if (b.groupId !== groupId || b.id === bedId) continue;

          if (oldOrder < newDisplayOrder) {
            // Moving down: shift beds in between up
            if (b.displayOrder > oldOrder && b.displayOrder <= newDisplayOrder) {
              b.displayOrder--;
            }
          } else {
            // Moving up: shift beds in between down
            if (b.displayOrder >= newDisplayOrder && b.displayOrder < oldOrder) {
              b.displayOrder++;
            }
          }
        }

        bed.displayOrder = newDisplayOrder;

        state.currentPlan.metadata.lastModified = Date.now();
        state.currentPlan.changeLog.push(
          createChangeEntry('edit', `Reordered bed "${bed.name}"`, [])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => { state.isSaving = false; state.isDirty = false; });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },

    deleteBedWithPlantings: async (bedId: string, action: 'unassign') => {
      set((state) => {
        if (!state.currentPlan?.beds || !state.currentPlan?.plantings) return;
        const bed = state.currentPlan.beds[bedId];
        if (!bed) return;

        snapshotForUndo(state);

        // Unassign all plantings from this bed
        if (action === 'unassign') {
          for (const planting of state.currentPlan.plantings) {
            if (planting.startBed === bedId) {
              planting.startBed = null;
            }
          }
        }

        const bedName = bed.name;
        delete state.currentPlan.beds[bedId];

        state.currentPlan.metadata.lastModified = Date.now();
        state.currentPlan.changeLog.push(
          createChangeEntry('delete', `Deleted bed "${bedName}" and unassigned plantings`, [])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => { state.isSaving = false; state.isDirty = false; });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },

    moveBedToGroup: async (bedId: string, newGroupId: string, newDisplayOrder: number) => {
      set((state) => {
        if (!state.currentPlan?.beds || !state.currentPlan?.bedGroups) return;
        const bed = state.currentPlan.beds[bedId];
        if (!bed) return;
        if (!state.currentPlan.bedGroups[newGroupId]) return;

        snapshotForUndo(state);

        const oldGroupId = bed.groupId;

        // Shift beds in old group (fill the gap)
        for (const b of Object.values(state.currentPlan.beds)) {
          if (b.groupId === oldGroupId && b.displayOrder > bed.displayOrder) {
            b.displayOrder--;
          }
        }

        // Shift beds in new group (make room)
        for (const b of Object.values(state.currentPlan.beds)) {
          if (b.groupId === newGroupId && b.displayOrder >= newDisplayOrder) {
            b.displayOrder++;
          }
        }

        // Move the bed
        bed.groupId = newGroupId;
        bed.displayOrder = newDisplayOrder;

        state.currentPlan.metadata.lastModified = Date.now();
        state.currentPlan.changeLog.push(
          createChangeEntry('edit', `Moved bed "${bed.name}" to different group`, [])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => { state.isSaving = false; state.isDirty = false; });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },

    // ========================================
    // Bed Group Management
    // ========================================

    renameBedGroup: async (groupId: string, newName: string) => {
      set((state) => {
        if (!state.currentPlan?.bedGroups) return;
        const group = state.currentPlan.bedGroups[groupId];
        if (!group) return;

        snapshotForUndo(state);

        group.name = newName;
        state.currentPlan.metadata.lastModified = Date.now();
        state.currentPlan.changeLog.push(
          createChangeEntry('edit', `Renamed group to "${newName}"`, [])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => { state.isSaving = false; state.isDirty = false; });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },

    addBedGroup: async (name: string) => {
      let newGroupId = '';

      set((state) => {
        if (!state.currentPlan?.bedGroups) return;

        snapshotForUndo(state);

        // Find max displayOrder
        const maxOrder = Object.values(state.currentPlan.bedGroups)
          .reduce((max, g) => Math.max(max, g.displayOrder), -1);

        const newGroup = createBedGroup(name, maxOrder + 1);
        newGroupId = newGroup.id;
        state.currentPlan.bedGroups[newGroup.id] = newGroup;

        state.currentPlan.metadata.lastModified = Date.now();
        state.currentPlan.changeLog.push(
          createChangeEntry('create', `Added group "${name}"`, [])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => { state.isSaving = false; state.isDirty = false; });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }

      return newGroupId;
    },

    deleteBedGroup: async (groupId: string) => {
      const state = get();
      if (!state.currentPlan?.beds || !state.currentPlan?.bedGroups) {
        throw new Error('No plan loaded');
      }

      // Check if group has any beds
      const bedsInGroup = Object.values(state.currentPlan.beds).filter(
        b => b.groupId === groupId
      );
      if (bedsInGroup.length > 0) {
        throw new Error(
          `Cannot delete group: ${bedsInGroup.length} bed(s) still in group`
        );
      }

      set((state) => {
        if (!state.currentPlan?.bedGroups) return;
        const group = state.currentPlan.bedGroups[groupId];
        if (!group) return;

        snapshotForUndo(state);

        const groupName = group.name;
        delete state.currentPlan.bedGroups[groupId];

        state.currentPlan.metadata.lastModified = Date.now();
        state.currentPlan.changeLog.push(
          createChangeEntry('delete', `Deleted group "${groupName}"`, [])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => { state.isSaving = false; state.isDirty = false; });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },

    reorderBedGroup: async (groupId: string, newDisplayOrder: number) => {
      set((state) => {
        if (!state.currentPlan?.bedGroups) return;
        const group = state.currentPlan.bedGroups[groupId];
        if (!group) return;

        snapshotForUndo(state);

        const oldOrder = group.displayOrder;

        // Shift other groups
        for (const g of Object.values(state.currentPlan.bedGroups)) {
          if (g.id === groupId) continue;

          if (oldOrder < newDisplayOrder) {
            // Moving down: shift groups in between up
            if (g.displayOrder > oldOrder && g.displayOrder <= newDisplayOrder) {
              g.displayOrder--;
            }
          } else {
            // Moving up: shift groups in between down
            if (g.displayOrder >= newDisplayOrder && g.displayOrder < oldOrder) {
              g.displayOrder++;
            }
          }
        }

        group.displayOrder = newDisplayOrder;

        state.currentPlan.metadata.lastModified = Date.now();
        state.currentPlan.changeLog.push(
          createChangeEntry('edit', `Reordered group "${group.name}"`, [])
        );
        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const currentState = get();
      if (currentState.currentPlan) {
        try {
          await savePlanToLibrary(currentState.currentPlan);
          set((state) => { state.isSaving = false; state.isDirty = false; });
        } catch (e) {
          set((state) => {
            state.isSaving = false;
            state.saveError = e instanceof Error ? e.message : 'Failed to save';
          });
        }
      }
    },
  }))
);

// ============================================
// Store Initialization
// ============================================

/**
 * Initialize the plan store with data from storage.
 * Should be called once on app startup (client-side only).
 */
export async function initializePlanStore(): Promise<void> {
  if (typeof window === 'undefined') return;

  const store = usePlanStore.getState();

  // Load plan list from storage
  await store.refreshPlanList();

  // Load active plan ID from localStorage
  try {
    const storedId = localStorage.getItem(ACTIVE_PLAN_KEY);
    if (storedId) {
      store.setActivePlanId(storedId);
    }
  } catch { /* ignore */ }

  // Set up cross-tab sync listener (BroadcastChannel)
  onSyncMessage((message) => {
    if (message.type === 'plan-updated' || message.type === 'plan-deleted') {
      // Refresh plan list when any tab creates/updates/deletes a plan
      usePlanStore.getState().refreshPlanList();

      // If the current plan was updated in another tab, reload it
      const state = usePlanStore.getState();
      if (message.type === 'plan-updated' && state.currentPlan?.id === message.planId) {
        state.loadPlanById(message.planId).catch(console.error);
      }
    }
  });

  // Also listen for localStorage changes (for active plan ID cross-tab sync)
  window.addEventListener('storage', (e) => {
    if (e.key === ACTIVE_PLAN_KEY) {
      usePlanStore.setState({ activePlanId: e.newValue });
    }
  });
}

// ============================================
// Helper Hooks
// ============================================

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
