/**
 * Plan Store
 *
 * Zustand store for managing editable crop plans with undo/redo.
 * Uses immer for immutable state updates.
 * Uses storage adapter for persistence (localStorage by default).
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enablePatches, produceWithPatches } from 'immer';
import { addYears, addMonths, addDays, format, parseISO, isValid } from 'date-fns';
import type {
  Plan,
  PlanMetadata,
  PlanState,
  PlanActions,
  PlanChange,
  BedSpanInfo,
  Bed,
  Planting,
  PatchEntry,
} from './plan-types';

// Enable immer patches globally
enablePatches();
import {
  CURRENT_SCHEMA_VERSION,
  validatePlan,
  createBedsFromTemplate,
  migratePlan,
} from './plan-types';
import type { BedGroup } from './plan-types';
import {
  initializePlantingIdCounter,
  clonePlanting,
  createPlanting,
} from './entities/planting';
import { cloneBeds, cloneBedGroups, createBed, createBedGroup } from './entities/bed';
import { createSequence, initializeSequenceIdCounter, type PlantingSequence } from './entities/planting-sequence';
import { storage, onSyncMessage, type PlanSummary, type PlanData } from './sqlite-client';
import bedPlanData from '@/data/bed-template.json';
import { getAllCrops } from './crops';
import { getStockVarieties, getStockSeedMixes, getStockProducts, getStockMarkets } from './stock-data';
import type { CropConfig } from './entities/crop-config';
import { cloneCropConfig, cloneCropCatalog } from './entities/crop-config';
import { createVariety, getVarietyKey, type Variety, type CreateVarietyInput, type DensityUnit } from './entities/variety';
import { createSeedMix, getSeedMixKey, type SeedMix, type CreateSeedMixInput } from './entities/seed-mix';
import { createProduct, getProductKey, type Product, type CreateProductInput } from './entities/product';
import { createSeedOrder, getSeedOrderId, type SeedOrder, type CreateSeedOrderInput } from './entities/seed-order';
import { createMarket, getActiveMarkets as getActiveMarketsFromRecord, type Market } from './entities/market';

/**
 * Raw variety input from JSON import.
 * densityUnit comes as string and gets validated during import.
 */
export interface RawVarietyInput {
  crop: string;
  name: string;
  supplier: string;
  organic?: boolean;
  pelleted?: boolean;
  pelletedApproved?: boolean;
  dtm?: number;
  density?: number;
  densityUnit?: string; // String from JSON, validated during import
  seedsPerOz?: number;
  website?: string;
  notes?: string;
  alreadyOwn?: boolean;
  deprecated?: boolean;
}

/** Valid density units for validation */
const VALID_DENSITY_UNITS = new Set(['g', 'oz', 'lb', 'ct']);

/** Convert raw variety input to typed CreateVarietyInput */
function normalizeVarietyInput(raw: RawVarietyInput): CreateVarietyInput {
  const densityUnit = raw.densityUnit && VALID_DENSITY_UNITS.has(raw.densityUnit)
    ? (raw.densityUnit as DensityUnit)
    : undefined;

  return {
    ...raw,
    densityUnit,
  };
}

/**
 * Raw seed mix component from JSON import.
 * Contains variety references that get resolved to IDs during import.
 */
export interface RawSeedMixComponent {
  percent: number;
  varietyId?: string;
  _varietyCrop?: string;
  _varietyName?: string;
  _varietySupplier?: string;
}

/**
 * Raw seed mix from JSON import.
 * May have unresolved variety references in components.
 */
export interface RawSeedMixInput {
  id?: string;
  name: string;
  crop: string;
  components: RawSeedMixComponent[];
  notes?: string;
}

// Re-export types for consumers
export type { PlanSummary, PlanData };

// Active plan ID key (shared with components that need it)
export const ACTIVE_PLAN_KEY = 'crop-explorer-active-plan';

// Get initial activePlanId synchronously from localStorage to avoid flash on HMR/reload
function getInitialActivePlanId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(ACTIVE_PLAN_KEY);
  } catch {
    return null;
  }
}

/**
 * Apply a mutation to the current plan using immer patches.
 * Patches are persisted to SQLite for undo/redo support.
 *
 * @param state - The store state (with undoCount/redoCount)
 * @param mutator - Function that mutates the plan draft
 * @param description - Human-readable description of the change
 * @returns The updated plan, or null if no plan was loaded
 */
function mutateWithPatches(
  state: {
    currentPlan: Plan | null;
    undoCount: number;
    redoCount: number;
  },
  mutator: (draft: Plan) => void,
  description: string
): Plan | null {
  if (!state.currentPlan) return null;

  const [nextPlan, patches, inversePatches] = produceWithPatches(
    state.currentPlan,
    mutator
  );

  // Update current plan
  state.currentPlan = nextPlan;

  // Create patch entry
  const entry: PatchEntry = {
    patches,
    inversePatches,
    description,
    timestamp: Date.now(),
  };

  // Increment undo count (optimistically), reset redo count
  state.undoCount += 1;
  state.redoCount = 0;

  // Persist patch to SQLite (fire-and-forget, non-blocking)
  // The API also clears the redo stack when a new patch is appended
  const planId = state.currentPlan.id;
  if (planId) {
    storage.appendPatch(planId, entry).catch((e) => {
      console.warn('Failed to persist patch:', e);
    });
  }

  return nextPlan;
}

// ============================================
// Bed/Group Uniqueness Helpers
// ============================================

/**
 * Check if a bed name already exists in a group (case-insensitive).
 * Returns the existing bed if found, null otherwise.
 */
function findBedByNameInGroup(
  beds: Record<string, Bed>,
  groupId: string,
  name: string,
  excludeBedId?: string
): Bed | null {
  const normalizedName = name.toLowerCase().trim();
  for (const bed of Object.values(beds)) {
    if (bed.groupId === groupId &&
        bed.name.toLowerCase().trim() === normalizedName &&
        bed.id !== excludeBedId) {
      return bed;
    }
  }
  return null;
}

/**
 * Check if a group name already exists (case-insensitive).
 * Returns the existing group if found, null otherwise.
 */
function findGroupByName(
  groups: Record<string, BedGroup>,
  name: string,
  excludeGroupId?: string
): BedGroup | null {
  const normalizedName = name.toLowerCase().trim();
  for (const group of Object.values(groups)) {
    if (group.name.toLowerCase().trim() === normalizedName &&
        group.id !== excludeGroupId) {
      return group;
    }
  }
  return null;
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
  const data: PlanData = { plan };
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
  notes?: string;
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

  // Copy varieties, seed mixes, and products (shallow copy - IDs are preserved)
  const varieties = state.currentPlan.varieties ? { ...state.currentPlan.varieties } : undefined;
  const seedMixes = state.currentPlan.seedMixes ? { ...state.currentPlan.seedMixes } : undefined;
  const products = state.currentPlan.products ? { ...state.currentPlan.products } : undefined;

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
    varieties,
    seedMixes,
    products,
    notes: options.notes,
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
  /** Bulk delete multiple plantings (single undo step) */
  bulkDeletePlantings: (plantingIds: string[]) => Promise<number>;
  addPlanting: (planting: Planting) => Promise<void>;
  /** Bulk add multiple plantings (single undo step) */
  bulkAddPlantings: (plantings: Planting[]) => Promise<number>;
  /** Bulk update multiple plantings (single undo step) */
  bulkUpdatePlantings: (updates: { id: string; changes: Partial<Pick<Planting, 'startBed' | 'bedFeet' | 'overrides' | 'notes' | 'seedSource' | 'actuals'>> }[]) => Promise<number>;
  duplicatePlanting: (plantingId: string) => Promise<string>;
  updatePlanting: (plantingId: string, updates: Partial<Pick<Planting, 'startBed' | 'bedFeet' | 'overrides' | 'notes' | 'seedSource' | 'actuals'>>) => Promise<void>;
  /** Assign a seed variety or mix to a planting */
  assignSeedSource: (plantingId: string, seedSource: import('./entities/planting').SeedSource | null) => Promise<void>;
  recalculateCrops: (configIdentifier: string, catalog: import('./entities/crop-config').CropConfig[]) => Promise<number>;
  /** Update a crop config in the plan's catalog and recalculate affected crops */
  updateCropConfig: (config: import('./entities/crop-config').CropConfig) => Promise<number>;
  /** Add a new crop config to the plan's catalog */
  addCropConfig: (config: import('./entities/crop-config').CropConfig) => Promise<void>;
  /** Delete crop configs from the plan's catalog by their identifiers */
  deleteCropConfigs: (identifiers: string[]) => Promise<number>;
  /** Toggle a crop config's favorite status */
  toggleConfigFavorite: (identifier: string) => Promise<void>;
  /** Bulk update multiple crop configs (single undo step) */
  bulkUpdateCropConfigs: (updates: { identifier: string; changes: Partial<import('./entities/crop-config').CropConfig> }[]) => Promise<number>;
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
  /** Update a bed's properties (name and/or length) */
  updateBed: (bedId: string, updates: { name?: string; lengthFt?: number }) => Promise<void>;
  /** Add a new bed to a group */
  addBed: (groupId: string, name: string, lengthFt: number) => Promise<string>;
  /**
   * Batch upsert beds atomically (single save at the end).
   * All changes succeed or none are persisted.
   * @returns { added, updated, errors }
   */
  upsertBeds: (beds: { groupName: string; bedName: string; lengthFt: number }[]) => Promise<{
    added: number;
    updated: number;
    errors: string[];
  }>;
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
  /** Delete a bed group with all its beds, unassigning any plantings */
  deleteBedGroupWithBeds: (groupId: string) => Promise<void>;
  /** Move a bed group to a new position */
  reorderBedGroup: (groupId: string, newDisplayOrder: number) => Promise<void>;

  // ---- Variety Management ----
  /** Add a variety to the plan */
  addVariety: (variety: import('./entities/variety').Variety) => Promise<void>;
  /** Update a variety in the plan */
  updateVariety: (variety: import('./entities/variety').Variety) => Promise<void>;
  /** Delete a variety from the plan */
  deleteVariety: (varietyId: string) => Promise<void>;
  /** Import varieties with content-based deduplication (accepts raw JSON with string densityUnit) */
  importVarieties: (inputs: RawVarietyInput[]) => Promise<{ added: number; updated: number }>;
  /** Get variety by ID */
  getVariety: (varietyId: string) => import('./entities/variety').Variety | undefined;
  /** Get all varieties for a crop */
  getVarietiesForCrop: (crop: string) => import('./entities/variety').Variety[];

  // ---- Seed Mix Management ----
  /** Add a seed mix to the plan */
  addSeedMix: (mix: import('./entities/seed-mix').SeedMix) => Promise<void>;
  /** Update a seed mix in the plan */
  updateSeedMix: (mix: import('./entities/seed-mix').SeedMix) => Promise<void>;
  /** Delete a seed mix from the plan */
  deleteSeedMix: (mixId: string) => Promise<void>;
  /** Import seed mixes with variety reference resolution */
  importSeedMixes: (inputs: RawSeedMixInput[]) => Promise<{ added: number; updated: number; unresolvedVarieties: number }>;
  /** Get seed mix by ID */
  getSeedMix: (mixId: string) => import('./entities/seed-mix').SeedMix | undefined;
  /** Get all seed mixes for a crop */
  getSeedMixesForCrop: (crop: string) => import('./entities/seed-mix').SeedMix[];

  // ---- Product Management ----
  /** Add a product to the plan */
  addProduct: (product: import('./entities/product').Product) => Promise<void>;
  /** Update a product in the plan */
  updateProduct: (product: import('./entities/product').Product) => Promise<void>;
  /** Delete a product from the plan */
  deleteProduct: (productId: string) => Promise<void>;
  /** Import products with content-based deduplication */
  importProducts: (inputs: import('./entities/product').CreateProductInput[]) => Promise<{ added: number; updated: number }>;
  /** Get product by ID */
  getProduct: (productId: string) => import('./entities/product').Product | undefined;
  /** Get all products for a crop */
  getProductsForCrop: (crop: string) => import('./entities/product').Product[];

  // ---- Seed Order Management ----
  /** Add or update a seed order for a variety */
  upsertSeedOrder: (order: import('./entities/seed-order').SeedOrder) => Promise<void>;
  /** Delete a seed order */
  deleteSeedOrder: (orderId: string) => Promise<void>;
  /** Import seed orders with content-based deduplication */
  importSeedOrders: (inputs: import('./entities/seed-order').CreateSeedOrderInput[]) => Promise<{ added: number; updated: number }>;
  /** Get seed order by ID */
  getSeedOrder: (orderId: string) => import('./entities/seed-order').SeedOrder | undefined;
  /** Get seed order for a variety */
  getSeedOrderForVariety: (varietyId: string) => import('./entities/seed-order').SeedOrder | undefined;
  /** Get all seed orders */
  getAllSeedOrders: () => import('./entities/seed-order').SeedOrder[];

  // ---- Market Management ----
  /** Add a market to the plan */
  addMarket: (name: string) => Promise<void>;
  /** Update a market in the plan */
  updateMarket: (id: string, updates: Partial<Omit<import('./entities/market').Market, 'id'>>) => Promise<void>;
  /** Soft-delete a market (set active=false) */
  deactivateMarket: (id: string) => Promise<void>;
  /** Reactivate a deactivated market */
  reactivateMarket: (id: string) => Promise<void>;
  /** Get market by ID */
  getMarket: (id: string) => import('./entities/market').Market | undefined;
  /** Get all active markets */
  getActiveMarkets: () => import('./entities/market').Market[];

  // ---- Plan Metadata ----
  /** Update plan metadata (name, description, year, timezone, etc.) */
  updatePlanMetadata: (updates: Partial<Omit<import('./entities/plan').PlanMetadata, 'id' | 'createdAt' | 'lastModified'>>) => Promise<void>;
  /** Update plan notes */
  updatePlanNotes: (notes: string) => Promise<void>;

  // ---- Sequence Management (Succession Planting) ----
  /**
   * Create a sequence from an existing planting.
   * The original planting becomes the anchor (index 0).
   * New plantings are cloned with staggered fieldStartDate values.
   */
  createSequenceFromPlanting: (
    plantingId: string,
    options: {
      /** Total number of plantings in the sequence (2-20) */
      count: number;
      /** Days between each planting's fieldStartDate (1-90) */
      offsetDays: number;
      /** Optional name for the sequence */
      name?: string;
      /** Bed assignment for new plantings: 'same' keeps original bed, 'unassigned' sets to null */
      bedAssignment: 'same' | 'unassigned';
    }
  ) => Promise<{ sequenceId: string; plantingIds: string[] }>;

  /**
   * Update a sequence's offset days.
   * This recalculates all follower fieldStartDates based on the anchor.
   */
  updateSequenceOffset: (sequenceId: string, newOffsetDays: number) => Promise<void>;

  /**
   * Remove a planting from its sequence (becomes standalone).
   * If removing the anchor, the next planting becomes the new anchor.
   * If only one planting remains, the sequence is dissolved.
   */
  unlinkFromSequence: (plantingId: string) => Promise<void>;

  /**
   * Delete an entire sequence and all its plantings.
   * Returns the number of plantings deleted.
   */
  deleteSequence: (sequenceId: string) => Promise<number>;

  /** Get a sequence by ID */
  getSequence: (sequenceId: string) => PlantingSequence | undefined;

  /** Get all plantings in a sequence, sorted by index */
  getSequencePlantings: (sequenceId: string) => Planting[];
}

type ExtendedPlanStore = ExtendedPlanState & ExtendedPlanActions;

// ============================================
// Zustand Store (no persist middleware)
// ============================================

export const usePlanStore = create<ExtendedPlanStore>()(
  immer((set, get) => ({
    // Initial state
    currentPlan: null,
    undoCount: 0,
    redoCount: 0,
    isDirty: false,
    isLoading: false,
    isSaving: false,
    saveError: null,
    lastSaved: null,
    planList: [],
    activePlanId: getInitialActivePlanId(),

    // Plan lifecycle
    loadPlan: (plan: Plan) => {
      set((state) => {
        state.currentPlan = plan;
        state.undoCount = 0;
        state.redoCount = 0;
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

      // Ensure varieties, seedMixes, products, and seedOrders exist (for plans created before stock data loading)
      if (!data.plan.varieties || Object.keys(data.plan.varieties).length === 0) {
        data.plan.varieties = getStockVarieties();
      }
      if (!data.plan.seedMixes || Object.keys(data.plan.seedMixes).length === 0) {
        data.plan.seedMixes = getStockSeedMixes();
      }
      if (!data.plan.products || Object.keys(data.plan.products).length === 0) {
        data.plan.products = getStockProducts();
      }
      // Seed orders start empty - user enters them fresh
      if (!data.plan.seedOrders) {
        data.plan.seedOrders = {};
      }
      // Ensure markets exist (for plans created before markets feature)
      if (!data.plan.markets || Object.keys(data.plan.markets).length === 0) {
        data.plan.markets = getStockMarkets();
      }

      // Validate plan on load
      try {
        validatePlan(data.plan);
      } catch (e) {
        console.warn('[loadPlanById] Plan validation warning:', e);
        // Continue loading - don't fail on invalid data, just warn
      }

      // Initialize ID counters based on existing data to avoid collisions
      const existingPlantingIds = (data.plan.plantings ?? []).map(p => p.id);
      initializePlantingIdCounter(existingPlantingIds);

      const existingSequenceIds = Object.keys(data.plan.sequences ?? {});
      initializeSequenceIdCounter(existingSequenceIds);

      // Load undo/redo counts from SQLite
      const { undoCount, redoCount } = await storage.getUndoRedoCounts(planId);

      set((state) => {
        state.currentPlan = data.plan;
        state.activePlanId = planId;
        state.undoCount = undoCount;
        state.redoCount = redoCount;
        state.isDirty = false;
        state.isLoading = false;
      });

      // Sync to localStorage for cross-tab via storage events
      try {
        localStorage.setItem(ACTIVE_PLAN_KEY, planId);
      } catch { /* ignore */ }
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

      // Determine the plan year:
      // - If plantings provided, detect year from the most common planting date year
      // - Otherwise, default to closest April (if May or later, next year)
      let planYear: number;
      if (plantings && plantings.length > 0) {
        // Count years from planting dates
        const yearCounts = new Map<number, number>();
        for (const p of plantings) {
          if (p.fieldStartDate) {
            const year = parseISO(p.fieldStartDate).getFullYear();
            yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
          }
        }
        // Use the most common year
        let maxCount = 0;
        planYear = new Date().getFullYear();
        for (const [year, count] of yearCounts) {
          if (count > maxCount) {
            maxCount = count;
            planYear = year;
          }
        }
      } else {
        // Default to closest April: if May or later, use next year; otherwise current year
        const currentMonth = new Date().getMonth(); // 0-indexed (0=Jan, 4=May)
        const currentYear = new Date().getFullYear();
        planYear = currentMonth >= 4 ? currentYear + 1 : currentYear;
      }

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

      // Load stock varieties, seed mixes, products, and markets (seed orders start empty)
      const varieties = getStockVarieties();
      const seedMixes = getStockSeedMixes();
      const products = getStockProducts();
      const markets = getStockMarkets();

      const plan: Plan = {
        id,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        metadata: {
          id,
          name: uniqueName,
          createdAt: now,
          lastModified: now,
          year: planYear,
        },
        plantings: convertedPlantings,
        beds,
        bedGroups,
        cropCatalog,
        varieties,
        seedMixes,
        products,
        seedOrders: {}, // Start empty - user enters fresh
        markets,
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
        state.undoCount = 0;
        state.redoCount = 0;
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
        state.undoCount = 0;
        state.redoCount = 0;
        state.isDirty = false;
      });
    },

    // Crop mutations - all push to undo stack and save
    // NOTE: newResource is a bed NAME from the timeline, not a UUID.
    // We convert to UUID for storage.
    moveCrop: async (groupId: string, newResource: string, bedSpanInfo?: BedSpanInfo[]) => {
      // Pre-validate before mutation
      const { currentPlan } = get();
      if (!currentPlan?.plantings || !currentPlan.beds) return;

      const planting = currentPlan.plantings.find(p => p.id === groupId);
      if (!planting) return;

      // Resolve bed UUID before mutation
      let bedUuid: string | null = null;
      if (newResource !== '' && newResource !== 'Unassigned' && bedSpanInfo && bedSpanInfo.length > 0) {
        bedUuid = bedNameToUuid(newResource, currentPlan.beds);
        if (!bedUuid) {
          console.warn(`[moveCrop] Bed not found: ${newResource}`);
          return;
        }
      }

      const totalBedFeet = bedSpanInfo?.reduce((sum, b) => sum + b.feetUsed, 0) ?? planting.bedFeet;

      set((state) => {
        // Use patch-based mutation
        mutateWithPatches(
          state,
          (plan) => {
            const p = plan.plantings?.find(p => p.id === groupId);
            if (!p) return;

            const now = Date.now();

            if (!bedUuid) {
              // Moving to Unassigned
              p.startBed = null;
            } else {
              p.startBed = bedUuid;
              p.bedFeet = totalBedFeet;
            }
            p.lastModified = now;

            // NOTE: Moving a sequence member does NOT unlink it from the sequence.
            // Sequence membership is based on fieldStartDate offsets, not bed assignment.
            // Use "Break from Sequence" to explicitly unlink.

            // Update metadata
            plan.metadata.lastModified = now;
            plan.changeLog.push(
              createChangeEntry('move', `Moved ${groupId} to ${newResource || 'unassigned'}`, [groupId])
            );
          },
          `Move ${groupId} to ${newResource || 'unassigned'}`
        );

        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      // Save to library
      const newState = get();
      if (newState.currentPlan) {
        try {
          await savePlanToLibrary(newState.currentPlan);
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

    updateCropDates: async (groupId: string, startDate: string, _endDate: string) => {
      // Pre-validate
      const { currentPlan } = get();
      if (!currentPlan?.plantings) return;

      const planting = currentPlan.plantings.find(p => p.id === groupId);
      if (!planting) return;

      // Check if this planting is part of a sequence - if so, move ALL members together
      const sequenceId = planting.sequenceId;
      const sequence = sequenceId && currentPlan.sequences ? currentPlan.sequences[sequenceId] : null;

      set((state) => {
        // Use patch-based mutation
        mutateWithPatches(
          state,
          (plan) => {
            const p = plan.plantings?.find(p => p.id === groupId);
            if (!p) return;

            const now = Date.now();

            // If this planting is in a sequence, only update the anchor's date.
            // Followers will auto-recompute at render time via the formula.
            if (sequence && sequenceId && plan.plantings) {
              // Find the anchor (slot 0)
              const anchor = plan.plantings.find(
                sp => sp.sequenceId === sequenceId && sp.sequenceSlot === 0
              );

              if (anchor) {
                const newDraggedDate = parseISO(startDate);
                // Get the effective date of the dragged planting
                // For anchor (slot 0): it's the planting's own fieldStartDate
                // For followers: it's computed from anchor + slot * offset
                const draggedSlot = p.sequenceSlot ?? 0;
                const effectiveDraggedDate = draggedSlot === 0
                  ? parseISO(p.fieldStartDate)
                  : addDays(parseISO(anchor.fieldStartDate), draggedSlot * sequence.offsetDays);

                if (isValid(newDraggedDate) && isValid(effectiveDraggedDate)) {
                  // Calculate the delta (how many days the user dragged)
                  const deltaDays = Math.round(
                    (newDraggedDate.getTime() - effectiveDraggedDate.getTime()) / (1000 * 60 * 60 * 24)
                  );

                  // Only update the anchor's fieldStartDate
                  // All followers will auto-recompute via the formula at render time
                  const anchorDate = parseISO(anchor.fieldStartDate);
                  if (isValid(anchorDate)) {
                    anchor.fieldStartDate = format(addDays(anchorDate, deltaDays), 'yyyy-MM-dd');
                    anchor.lastModified = now;
                  }
                }
              }
            } else {
              // Not in a sequence - just update this planting
              p.fieldStartDate = startDate;
              p.lastModified = now;
            }

            plan.metadata.lastModified = now;
            plan.changeLog.push(
              createChangeEntry('date_change', `Updated dates for ${groupId}`, [groupId])
            );
          },
          `Update dates for ${groupId}`
        );

        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      // Save to library
      const newState = get();
      if (newState.currentPlan) {
        try {
          await savePlanToLibrary(newState.currentPlan);
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
      // Pre-validate
      const { currentPlan } = get();
      if (!currentPlan?.plantings) return;

      set((state) => {
        // Use patch-based mutation
        mutateWithPatches(
          state,
          (plan) => {
            if (!plan.plantings) return;

            // Remove the planting
            const index = plan.plantings.findIndex(p => p.id === groupId);
            if (index !== -1) {
              plan.plantings.splice(index, 1);
            }

            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('delete', `Deleted ${groupId}`, [groupId])
            );
          },
          `Delete ${groupId}`
        );

        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      // Save to library
      const newState = get();
      if (newState.currentPlan) {
        try {
          await savePlanToLibrary(newState.currentPlan);
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

    bulkDeletePlantings: async (plantingIds: string[]) => {
      const state = get();
      if (!state.currentPlan?.plantings) {
        return 0;
      }

      // Filter to only IDs that actually exist
      const existingIds = new Set(state.currentPlan.plantings.map(p => p.id));
      const toDelete = plantingIds.filter(id => existingIds.has(id));

      if (toDelete.length === 0) {
        return 0;
      }

      const description = `Delete ${toDelete.length} planting${toDelete.length !== 1 ? 's' : ''}`;

      set((storeState) => {
        if (!storeState.currentPlan?.plantings) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            if (!plan.plantings) return;

            // Remove all plantings in one pass
            const idsToDelete = new Set(toDelete);
            plan.plantings = plan.plantings.filter(p => !idsToDelete.has(p.id));

            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('batch', description, toDelete)
            );
          },
          description
        );
        storeState.isDirty = true;
        storeState.isSaving = true;
        storeState.saveError = null;
      });

      // Save to library (single save for all deletions)
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

      return toDelete.length;
    },

    // NOTE: planting.startBed may be a bed NAME from the timeline.
    // We convert to UUID for storage.
    addPlanting: async (planting: Planting) => {
      // Pre-validate
      const { currentPlan } = get();
      if (!currentPlan?.plantings || !currentPlan.beds) return;

      // Convert bed name to UUID if needed (before mutation)
      let startBedUuid = planting.startBed;
      if (startBedUuid && startBedUuid !== 'Unassigned') {
        // Check if it's already a UUID (exists as key in beds)
        if (!currentPlan.beds[startBedUuid]) {
          // It's a name, convert to UUID
          const uuid = bedNameToUuid(startBedUuid, currentPlan.beds);
          startBedUuid = uuid;
        }
      } else {
        startBedUuid = null;
      }

      // Check if planting should use default seed source
      let shouldUseDefaultSeedSource = false;
      if (!planting.seedSource && planting.useDefaultSeedSource === undefined &&
          planting.configId && currentPlan.cropCatalog) {
        const config = currentPlan.cropCatalog[planting.configId];
        if (config?.defaultSeedSource) {
          shouldUseDefaultSeedSource = true;
        }
      }

      set((state) => {
        // Use patch-based mutation
        mutateWithPatches(
          state,
          (plan) => {
            if (!plan.plantings) return;

            const now = Date.now();
            const newPlanting: Planting = {
              ...planting,
              startBed: startBedUuid,
              lastModified: now,
            };

            if (shouldUseDefaultSeedSource) {
              newPlanting.useDefaultSeedSource = true;
            }

            plan.plantings.push(newPlanting);

            plan.metadata.lastModified = now;
            plan.changeLog.push(
              createChangeEntry('create', `Added planting ${planting.id}`, [planting.id])
            );
          },
          `Add planting ${planting.id}`
        );

        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      // Save to library
      const newState = get();
      if (newState.currentPlan) {
        try {
          await savePlanToLibrary(newState.currentPlan);
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

    bulkAddPlantings: async (plantings: Planting[]) => {
      const state = get();
      if (!state.currentPlan?.plantings || !state.currentPlan.beds) {
        return 0;
      }

      if (plantings.length === 0) {
        return 0;
      }

      // Pre-process plantings: convert bed names to UUIDs and check default seed sources
      const processedPlantings: Planting[] = plantings.map(planting => {
        let startBedUuid = planting.startBed;
        if (startBedUuid && startBedUuid !== 'Unassigned') {
          if (!state.currentPlan!.beds![startBedUuid]) {
            startBedUuid = bedNameToUuid(startBedUuid, state.currentPlan!.beds!);
          }
        } else {
          startBedUuid = null;
        }

        const processed: Planting = {
          ...planting,
          startBed: startBedUuid,
          lastModified: Date.now(),
        };

        // Check for default seed source
        if (!planting.seedSource && planting.useDefaultSeedSource === undefined &&
            planting.configId && state.currentPlan!.cropCatalog) {
          const config = state.currentPlan!.cropCatalog[planting.configId];
          if (config?.defaultSeedSource) {
            processed.useDefaultSeedSource = true;
          }
        }

        return processed;
      });

      const description = `Add ${processedPlantings.length} planting${processedPlantings.length !== 1 ? 's' : ''}`;

      set((storeState) => {
        if (!storeState.currentPlan?.plantings) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            if (!plan.plantings) return;

            const now = Date.now();
            for (const planting of processedPlantings) {
              plan.plantings.push(planting);
            }

            plan.metadata.lastModified = now;
            plan.changeLog.push(
              createChangeEntry('batch', description, processedPlantings.map(p => p.id))
            );
          },
          description
        );
        storeState.isDirty = true;
        storeState.isSaving = true;
        storeState.saveError = null;
      });

      // Save to library (single save for all additions)
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

      return processedPlantings.length;
    },

    bulkUpdatePlantings: async (updates: { id: string; changes: Partial<Pick<Planting, 'startBed' | 'bedFeet' | 'overrides' | 'notes' | 'seedSource' | 'actuals'>> }[]) => {
      const state = get();
      if (!state.currentPlan?.plantings) {
        return 0;
      }

      // Filter to only updates for plantings that exist
      const existingIds = new Set(state.currentPlan.plantings.map(p => p.id));
      const validUpdates = updates.filter(u => existingIds.has(u.id));

      if (validUpdates.length === 0) {
        return 0;
      }

      const description = `Update ${validUpdates.length} planting${validUpdates.length !== 1 ? 's' : ''}`;

      set((storeState) => {
        if (!storeState.currentPlan?.plantings) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            if (!plan.plantings) return;

            const now = Date.now();
            const updateMap = new Map(validUpdates.map(u => [u.id, u.changes]));

            for (const planting of plan.plantings) {
              const changes = updateMap.get(planting.id);
              if (!changes) continue;

              // Apply updates (same logic as updatePlanting)
              if ('startBed' in changes) {
                planting.startBed = changes.startBed ?? null;
              }
              if (changes.bedFeet !== undefined) {
                planting.bedFeet = changes.bedFeet;
              }
              if (changes.overrides !== undefined) {
                planting.overrides = {
                  ...planting.overrides,
                  ...changes.overrides,
                };
              }
              if (changes.notes !== undefined) {
                planting.notes = changes.notes || undefined;
              }
              if (changes.seedSource !== undefined) {
                planting.seedSource = changes.seedSource || undefined;
              }
              if (changes.actuals !== undefined) {
                planting.actuals = {
                  ...planting.actuals,
                  ...changes.actuals,
                };
              }

              planting.lastModified = now;
            }

            plan.metadata.lastModified = now;
            plan.changeLog.push(
              createChangeEntry('batch', description, validUpdates.map(u => u.id))
            );
          },
          description
        );
        storeState.isDirty = true;
        storeState.isSaving = true;
        storeState.saveError = null;
      });

      // Save to library (single save for all updates)
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

      return validUpdates.length;
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

    updatePlanting: async (plantingId: string, updates: Partial<Pick<Planting, 'startBed' | 'bedFeet' | 'overrides' | 'notes' | 'seedSource' | 'useDefaultSeedSource' | 'actuals'>>) => {
      // Pre-validate
      const { currentPlan } = get();
      if (!currentPlan?.plantings) return;

      const planting = currentPlan.plantings.find(p => p.id === plantingId);
      if (!planting) return;

      set((state) => {
        // Use patch-based mutation
        mutateWithPatches(
          state,
          (plan) => {
            const p = plan.plantings?.find(p => p.id === plantingId);
            if (!p) return;

            const now = Date.now();

            // Apply updates
            if ('startBed' in updates) {
              p.startBed = updates.startBed ?? null;
            }
            if (updates.bedFeet !== undefined) {
              p.bedFeet = updates.bedFeet;
            }
            if (updates.overrides !== undefined) {
              // Merge overrides (shallow merge)
              p.overrides = {
                ...p.overrides,
                ...updates.overrides,
              };
            }
            if (updates.notes !== undefined) {
              p.notes = updates.notes || undefined; // Clear if empty string
            }
            if (updates.seedSource !== undefined) {
              p.seedSource = updates.seedSource || undefined; // Clear if null
            }
            if (updates.useDefaultSeedSource !== undefined) {
              p.useDefaultSeedSource = updates.useDefaultSeedSource;
            }
            if (updates.actuals !== undefined) {
              // Merge actuals (shallow merge)
              p.actuals = {
                ...p.actuals,
                ...updates.actuals,
              };
            }

            p.lastModified = now;

            plan.metadata.lastModified = now;
            plan.changeLog.push(
              createChangeEntry('edit', `Updated planting ${plantingId}`, [plantingId])
            );
          },
          `Update planting ${plantingId}`
        );

        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      // Save to library
      const newState = get();
      if (newState.currentPlan) {
        try {
          await savePlanToLibrary(newState.currentPlan);
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

    assignSeedSource: async (plantingId: string, seedSource) => {
      // Convenience wrapper for assigning seed source
      await get().updatePlanting(plantingId, { seedSource: seedSource ?? undefined });
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

        mutateWithPatches(
          storeState,
          (plan) => {
            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('batch', `Config changed: ${configIdentifier}`, affected.map(p => p.id))
            );
          },
          `Config changed: ${configIdentifier}`
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

        mutateWithPatches(
          storeState,
          (plan) => {
            // Update catalog using CRUD function - display will recompute automatically
            plan.cropCatalog![config.identifier] = cloneCropConfig(config);
            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('batch', `Updated config "${config.identifier}"`, affectedPlantingIds)
            );
          },
          `Update config "${config.identifier}"`
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

        mutateWithPatches(
          storeState,
          (plan) => {
            // Initialize catalog if needed
            if (!plan.cropCatalog) {
              plan.cropCatalog = {};
            }
            // Add new config to catalog using CRUD function
            plan.cropCatalog[config.identifier] = cloneCropConfig(config);
            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('batch', `Added new config "${config.identifier}"`, [])
            );
          },
          `Add config "${config.identifier}"`
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

        const description = existingIdentifiers.length === 1
          ? `Delete config "${existingIdentifiers[0]}"`
          : `Delete ${existingIdentifiers.length} configs`;

        mutateWithPatches(
          storeState,
          (plan) => {
            // Delete configs from catalog
            for (const identifier of existingIdentifiers) {
              delete plan.cropCatalog![identifier];
            }

            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('batch', description, [])
            );
          },
          description
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

    toggleConfigFavorite: async (identifier: string) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (!state.currentPlan.cropCatalog) {
        throw new Error('Plan has no crop catalog');
      }

      const config = state.currentPlan.cropCatalog[identifier];
      if (!config) {
        throw new Error(`Config "${identifier}" not found`);
      }

      const newValue = !config.isFavorite;
      const description = newValue
        ? `Add "${identifier}" to favorites`
        : `Remove "${identifier}" from favorites`;

      set((storeState) => {
        if (!storeState.currentPlan?.cropCatalog) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            plan.cropCatalog![identifier].isFavorite = newValue;
            plan.metadata.lastModified = Date.now();
          },
          description
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

    bulkUpdateCropConfigs: async (updates: { identifier: string; changes: Partial<CropConfig> }[]) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (!state.currentPlan.cropCatalog) {
        throw new Error('Plan has no crop catalog');
      }

      // Filter to only configs that exist
      const validUpdates = updates.filter(u => state.currentPlan!.cropCatalog![u.identifier]);

      if (validUpdates.length === 0) {
        return 0;
      }

      const description = `Update ${validUpdates.length} crop config${validUpdates.length !== 1 ? 's' : ''}`;

      set((storeState) => {
        if (!storeState.currentPlan?.cropCatalog) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            for (const { identifier, changes } of validUpdates) {
              Object.assign(plan.cropCatalog![identifier], changes);
            }
            plan.metadata.lastModified = Date.now();
          },
          description
        );
        storeState.isDirty = true;
        storeState.isSaving = true;
        storeState.saveError = null;
      });

      // Save to library (single save for all changes)
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

      return validUpdates.length;
    },

    // History - uses SQLite as single source of truth
    undo: async () => {
      const { currentPlan } = get();
      if (!currentPlan) return;

      set((state) => {
        state.isSaving = true;
        state.saveError = null;
      });

      try {
        // Call server to perform undo - server handles patch application and plan save
        const result = await storage.undo(currentPlan.id);

        if (result.ok && result.plan) {
          set((state) => {
            state.currentPlan = result.plan;
            state.undoCount = result.canUndo ? state.undoCount - 1 : 0;
            state.redoCount = state.redoCount + 1;
            state.isSaving = false;
            state.isDirty = false;
          });
        } else {
          set((state) => {
            state.isSaving = false;
            state.saveError = 'Nothing to undo';
          });
        }
      } catch (e) {
        set((state) => {
          state.isSaving = false;
          state.saveError = e instanceof Error ? e.message : 'Undo failed';
        });
      }
    },

    redo: async () => {
      const { currentPlan } = get();
      if (!currentPlan) return;

      set((state) => {
        state.isSaving = true;
        state.saveError = null;
      });

      try {
        // Call server to perform redo - server handles patch application and plan save
        const result = await storage.redo(currentPlan.id);

        if (result.ok && result.plan) {
          set((state) => {
            state.currentPlan = result.plan;
            state.undoCount = state.undoCount + 1;
            state.redoCount = result.canRedo ? state.redoCount - 1 : 0;
            state.isSaving = false;
            state.isDirty = false;
          });
        } else {
          set((state) => {
            state.isSaving = false;
            state.saveError = 'Nothing to redo';
          });
        }
      } catch (e) {
        set((state) => {
          state.isSaving = false;
          state.saveError = e instanceof Error ? e.message : 'Redo failed';
        });
      }
    },

    canUndo: () => {
      const state = get();
      return state.undoCount > 0;
    },

    canRedo: () => {
      const state = get();
      return state.redoCount > 0;
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
      const state = get();
      if (!state.currentPlan?.beds) {
        throw new Error('No plan loaded');
      }
      const bed = state.currentPlan.beds[bedId];
      if (!bed) {
        throw new Error('Bed not found');
      }

      // Check uniqueness (exclude current bed)
      const existingBed = findBedByNameInGroup(state.currentPlan.beds, bed.groupId, newName, bedId);
      if (existingBed) {
        const groupName = state.currentPlan.bedGroups?.[bed.groupId]?.name ?? 'Unknown';
        throw new Error(`Bed "${newName}" already exists in group "${groupName}"`);
      }

      set((state) => {
        if (!state.currentPlan?.beds) return;
        const bed = state.currentPlan.beds[bedId];
        if (!bed) return;

        mutateWithPatches(
          state,
          (plan) => {
            plan.beds![bedId].name = newName;
            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('edit', `Renamed bed to "${newName}"`, [])
            );
          },
          `Rename bed to "${newName}"`
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

    updateBed: async (bedId: string, updates: { name?: string; lengthFt?: number }) => {
      const state = get();
      if (!state.currentPlan?.beds) {
        throw new Error('No plan loaded');
      }
      const bed = state.currentPlan.beds[bedId];
      if (!bed) {
        throw new Error('Bed not found');
      }

      // Check uniqueness if name is being changed
      if (updates.name !== undefined && updates.name !== bed.name) {
        const existingBed = findBedByNameInGroup(state.currentPlan.beds, bed.groupId, updates.name, bedId);
        if (existingBed) {
          const groupName = state.currentPlan.bedGroups?.[bed.groupId]?.name ?? 'Unknown';
          throw new Error(`Bed "${updates.name}" already exists in group "${groupName}"`);
        }
      }

      set((state) => {
        if (!state.currentPlan?.beds) return;
        const bed = state.currentPlan.beds[bedId];
        if (!bed) return;

        const changes: string[] = [];
        if (updates.name !== undefined && updates.name !== bed.name) {
          changes.push(`name to "${updates.name}"`);
        }
        if (updates.lengthFt !== undefined && updates.lengthFt !== bed.lengthFt) {
          changes.push(`length to ${updates.lengthFt}ft`);
        }

        if (changes.length > 0) {
          mutateWithPatches(
            state,
            (plan) => {
              const planBed = plan.beds![bedId];
              if (updates.name !== undefined) {
                planBed.name = updates.name;
              }
              if (updates.lengthFt !== undefined) {
                planBed.lengthFt = updates.lengthFt;
              }
              plan.metadata.lastModified = Date.now();
              plan.changeLog.push(
                createChangeEntry('edit', `Updated bed: ${changes.join(', ')}`, [])
              );
            },
            `Update bed: ${changes.join(', ')}`
          );
          state.isDirty = true;
          state.isSaving = true;
          state.saveError = null;
        }
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
      const state = get();
      if (!state.currentPlan?.beds || !state.currentPlan?.bedGroups) {
        throw new Error('No plan loaded');
      }
      if (!state.currentPlan.bedGroups[groupId]) {
        throw new Error('Group not found');
      }

      // Check uniqueness
      const existingBed = findBedByNameInGroup(state.currentPlan.beds, groupId, name);
      if (existingBed) {
        const groupName = state.currentPlan.bedGroups[groupId]?.name ?? 'Unknown';
        throw new Error(`Bed "${name}" already exists in group "${groupName}"`);
      }

      let newBedId = '';

      set((state) => {
        if (!state.currentPlan?.beds || !state.currentPlan?.bedGroups) return;

        // Find max displayOrder in this group
        const bedsInGroup = Object.values(state.currentPlan.beds)
          .filter(b => b.groupId === groupId);
        const maxOrder = bedsInGroup.reduce((max, b) => Math.max(max, b.displayOrder), -1);

        const newBed = createBed(name, groupId, lengthFt, maxOrder + 1);
        newBedId = newBed.id;

        mutateWithPatches(
          state,
          (plan) => {
            plan.beds![newBed.id] = newBed;
            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('create', `Added bed "${name}"`, [])
            );
          },
          `Add bed "${name}"`
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

    upsertBeds: async (beds: { groupName: string; bedName: string; lengthFt: number }[]) => {
      const state = get();
      if (!state.currentPlan?.beds || !state.currentPlan?.bedGroups) {
        throw new Error('No plan loaded');
      }

      let added = 0;
      let updated = 0;
      const errors: string[] = [];

      // Single mutation for all changes
      set((state) => {
        if (!state.currentPlan?.beds || !state.currentPlan?.bedGroups) return;

        mutateWithPatches(
          state,
          (plan) => {
            // Track groups we create during this batch (by normalized name -> groupId)
            const createdGroups = new Map<string, string>();

            for (const { groupName, bedName, lengthFt } of beds) {
              try {
                const normalizedGroupName = groupName.toLowerCase().trim();
                const normalizedBedName = bedName.toLowerCase().trim();

                // Find or create group
                let groupId = Object.values(plan.bedGroups!).find(
                  g => g.name.toLowerCase().trim() === normalizedGroupName
                )?.id ?? createdGroups.get(normalizedGroupName);

                if (!groupId) {
                  const maxGroupOrder = Object.values(plan.bedGroups!)
                    .reduce((max, g) => Math.max(max, g.displayOrder), -1);
                  const newGroup = createBedGroup(groupName.trim(), maxGroupOrder + 1);
                  groupId = newGroup.id;
                  plan.bedGroups![newGroup.id] = newGroup;
                  createdGroups.set(normalizedGroupName, groupId);
                }

                // Find existing bed in this group
                const existingBed = Object.values(plan.beds!).find(
                  b => b.groupId === groupId && b.name.toLowerCase().trim() === normalizedBedName
                );

                if (existingBed) {
                  // Update if length differs
                  if (existingBed.lengthFt !== lengthFt) {
                    existingBed.lengthFt = lengthFt;
                    updated++;
                  }
                } else {
                  // Create new bed
                  const bedsInGroup = Object.values(plan.beds!).filter(b => b.groupId === groupId);
                  const maxOrder = bedsInGroup.reduce((max, b) => Math.max(max, b.displayOrder), -1);
                  const newBed = createBed(bedName.trim(), groupId, lengthFt, maxOrder + 1);
                  plan.beds![newBed.id] = newBed;
                  added++;
                }
              } catch (e) {
                errors.push(`${groupName}/${bedName}: ${e instanceof Error ? e.message : 'Unknown error'}`);
              }
            }

            if (added > 0 || updated > 0) {
              plan.metadata.lastModified = Date.now();
              const parts = [];
              if (added > 0) parts.push(`${added} added`);
              if (updated > 0) parts.push(`${updated} updated`);
              plan.changeLog.push(
                createChangeEntry('create', `Imported beds: ${parts.join(', ')}`, [])
              );
            }
          },
          `Import beds`
        );

        if (added > 0 || updated > 0) {
          state.isDirty = true;
          state.isSaving = true;
          state.saveError = null;
        }
      });

      // Single save at the end
      if (added > 0 || updated > 0) {
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
            errors.push(`Save failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
          }
        }
      }

      return { added, updated, errors };
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

        const bedName = bed.name;
        mutateWithPatches(
          state,
          (plan) => {
            delete plan.beds![bedId];
            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('delete', `Deleted bed "${bedName}"`, [])
            );
          },
          `Delete bed "${bedName}"`
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

        const bedName = bed.name;
        const oldOrder = bed.displayOrder;
        const groupId = bed.groupId;

        mutateWithPatches(
          state,
          (plan) => {
            // Shift other beds in the same group
            for (const b of Object.values(plan.beds!)) {
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

            plan.beds![bedId].displayOrder = newDisplayOrder;

            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('edit', `Reordered bed "${bedName}"`, [])
            );
          },
          `Reorder bed "${bedName}"`
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

        const bedName = bed.name;
        mutateWithPatches(
          state,
          (plan) => {
            // Unassign all plantings from this bed
            if (action === 'unassign' && plan.plantings) {
              for (const planting of plan.plantings) {
                if (planting.startBed === bedId) {
                  planting.startBed = null;
                }
              }
            }

            delete plan.beds![bedId];

            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('delete', `Deleted bed "${bedName}" and unassigned plantings`, [])
            );
          },
          `Delete bed "${bedName}" and unassign plantings`
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

        const oldGroupId = bed.groupId;
        const oldDisplayOrder = bed.displayOrder;
        const bedName = bed.name;

        mutateWithPatches(
          state,
          (plan) => {
            // Shift beds in old group (fill the gap)
            for (const b of Object.values(plan.beds!)) {
              if (b.groupId === oldGroupId && b.displayOrder > oldDisplayOrder) {
                b.displayOrder--;
              }
            }

            // Shift beds in new group (make room)
            for (const b of Object.values(plan.beds!)) {
              if (b.groupId === newGroupId && b.displayOrder >= newDisplayOrder) {
                b.displayOrder++;
              }
            }

            // Move the bed
            plan.beds![bedId].groupId = newGroupId;
            plan.beds![bedId].displayOrder = newDisplayOrder;

            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('edit', `Moved bed "${bedName}" to different group`, [])
            );
          },
          `Move bed "${bedName}" to different group`
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
      const state = get();
      if (!state.currentPlan?.bedGroups) {
        throw new Error('No plan loaded');
      }
      const group = state.currentPlan.bedGroups[groupId];
      if (!group) {
        throw new Error('Group not found');
      }

      // Check uniqueness (exclude current group)
      const existingGroup = findGroupByName(state.currentPlan.bedGroups, newName, groupId);
      if (existingGroup) {
        throw new Error(`Group "${newName}" already exists`);
      }

      set((state) => {
        if (!state.currentPlan?.bedGroups) return;
        const group = state.currentPlan.bedGroups[groupId];
        if (!group) return;

        mutateWithPatches(
          state,
          (plan) => {
            plan.bedGroups![groupId].name = newName;
            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('edit', `Renamed group to "${newName}"`, [])
            );
          },
          `Rename group to "${newName}"`
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
      const state = get();
      if (!state.currentPlan?.bedGroups) {
        throw new Error('No plan loaded');
      }

      // Check uniqueness
      const existingGroup = findGroupByName(state.currentPlan.bedGroups, name);
      if (existingGroup) {
        throw new Error(`Group "${name}" already exists`);
      }

      let newGroupId = '';

      set((state) => {
        if (!state.currentPlan?.bedGroups) return;

        // Find max displayOrder
        const maxOrder = Object.values(state.currentPlan.bedGroups)
          .reduce((max, g) => Math.max(max, g.displayOrder), -1);

        const newGroup = createBedGroup(name, maxOrder + 1);
        newGroupId = newGroup.id;

        mutateWithPatches(
          state,
          (plan) => {
            plan.bedGroups![newGroup.id] = newGroup;
            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('create', `Added group "${name}"`, [])
            );
          },
          `Add group "${name}"`
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

        const groupName = group.name;
        mutateWithPatches(
          state,
          (plan) => {
            delete plan.bedGroups![groupId];
            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('delete', `Deleted group "${groupName}"`, [])
            );
          },
          `Delete group "${groupName}"`
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

    deleteBedGroupWithBeds: async (groupId: string) => {
      const state = get();
      if (!state.currentPlan?.beds || !state.currentPlan?.bedGroups || !state.currentPlan?.plantings) {
        throw new Error('No plan loaded');
      }

      const group = state.currentPlan.bedGroups[groupId];
      if (!group) {
        throw new Error('Group not found');
      }

      // Find all beds in this group
      const bedsInGroup = Object.values(state.currentPlan.beds).filter(
        b => b.groupId === groupId
      );
      const bedIds = new Set(bedsInGroup.map(b => b.id));

      set((state) => {
        if (!state.currentPlan?.beds || !state.currentPlan?.bedGroups || !state.currentPlan?.plantings) return;

        const groupName = state.currentPlan.bedGroups[groupId].name;
        let unassignedCount = 0;

        mutateWithPatches(
          state,
          (plan) => {
            // Unassign all plantings from beds in this group
            for (const planting of plan.plantings ?? []) {
              if (planting.startBed && bedIds.has(planting.startBed)) {
                planting.startBed = null;
                unassignedCount++;
              }
            }

            // Delete all beds in the group
            for (const bedId of bedIds) {
              delete plan.beds![bedId];
            }

            // Delete the group
            delete plan.bedGroups![groupId];

            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry(
                'delete',
                `Deleted group "${groupName}" with ${bedIds.size} bed(s), unassigned ${unassignedCount} planting(s)`,
                []
              )
            );
          },
          `Delete group "${groupName}" with ${bedIds.size} beds`
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

        const oldOrder = group.displayOrder;
        const groupName = group.name;

        mutateWithPatches(
          state,
          (plan) => {
            // Shift other groups
            for (const g of Object.values(plan.bedGroups!)) {
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

            plan.bedGroups![groupId].displayOrder = newDisplayOrder;

            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('edit', `Reordered group "${groupName}"`, [])
            );
          },
          `Reorder group "${groupName}"`
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

    // ---- Variety Management ----

    addVariety: async (variety: Variety) => {
      set((state) => {
        if (!state.currentPlan) return;

        mutateWithPatches(
          state,
          (plan) => {
            if (!plan.varieties) {
              plan.varieties = {};
            }
            plan.varieties[variety.id] = variety;
            plan.metadata.lastModified = Date.now();
          },
          `Add variety ${variety.name}`
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

    updateVariety: async (variety: Variety) => {
      set((state) => {
        if (!state.currentPlan?.varieties?.[variety.id]) return;

        mutateWithPatches(
          state,
          (plan) => {
            plan.varieties![variety.id] = variety;
            plan.metadata.lastModified = Date.now();
          },
          `Update variety ${variety.name}`
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

    deleteVariety: async (varietyId: string) => {
      set((state) => {
        if (!state.currentPlan?.varieties?.[varietyId]) return;

        mutateWithPatches(
          state,
          (plan) => {
            delete plan.varieties![varietyId];

            // Also remove from any seed mixes that reference this variety
            if (plan.seedMixes) {
              for (const mix of Object.values(plan.seedMixes)) {
                mix.components = mix.components.filter((c) => c.varietyId !== varietyId);
              }
            }

            // Clear seedSource from plantings that referenced this variety
            if (plan.plantings) {
              for (const planting of plan.plantings) {
                if (planting.seedSource?.type === 'variety' && planting.seedSource.id === varietyId) {
                  planting.seedSource = undefined;
                }
              }
            }

            // Delete associated seed order
            if (plan.seedOrders) {
              const orderId = getSeedOrderId(varietyId);
              delete plan.seedOrders[orderId];
            }

            plan.metadata.lastModified = Date.now();
          },
          `Delete variety ${varietyId}`
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

    importVarieties: async (rawInputs: RawVarietyInput[]) => {
      const existingVarieties = get().currentPlan?.varieties ?? {};
      const existingByKey = new Map<string, string>();
      for (const v of Object.values(existingVarieties)) {
        existingByKey.set(getVarietyKey(v), v.id);
      }

      let added = 0;
      let updated = 0;

      set((state) => {
        if (!state.currentPlan) return;

        mutateWithPatches(
          state,
          (plan) => {
            if (!plan.varieties) {
              plan.varieties = {};
            }

            for (const raw of rawInputs) {
              // Normalize the raw input (validates densityUnit)
              const input = normalizeVarietyInput(raw);
              const contentKey = `${input.crop}|${input.name}|${input.supplier}`.toLowerCase().trim();
              const existingId = existingByKey.get(contentKey);

              if (existingId) {
                const variety = createVariety({ ...input, id: existingId });
                plan.varieties[existingId] = variety;
                updated++;
              } else {
                const variety = createVariety(input);
                plan.varieties[variety.id] = variety;
                existingByKey.set(contentKey, variety.id);
                added++;
              }
            }

            plan.metadata.lastModified = Date.now();
          },
          `Import ${rawInputs.length} varieties`
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

      return { added, updated };
    },

    getVariety: (varietyId: string) => {
      return get().currentPlan?.varieties?.[varietyId];
    },

    getVarietiesForCrop: (crop: string) => {
      const varieties = get().currentPlan?.varieties ?? {};
      return Object.values(varieties).filter((v) => v.crop === crop);
    },

    // ---- Seed Mix Management ----

    addSeedMix: async (mix: SeedMix) => {
      set((state) => {
        if (!state.currentPlan) return;

        mutateWithPatches(
          state,
          (plan) => {
            if (!plan.seedMixes) {
              plan.seedMixes = {};
            }
            plan.seedMixes[mix.id] = mix;
            plan.metadata.lastModified = Date.now();
          },
          `Add seed mix ${mix.name}`
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

    updateSeedMix: async (mix: SeedMix) => {
      set((state) => {
        if (!state.currentPlan?.seedMixes?.[mix.id]) return;

        mutateWithPatches(
          state,
          (plan) => {
            plan.seedMixes![mix.id] = mix;
            plan.metadata.lastModified = Date.now();
          },
          `Update seed mix ${mix.name}`
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

    deleteSeedMix: async (mixId: string) => {
      set((state) => {
        if (!state.currentPlan?.seedMixes?.[mixId]) return;

        mutateWithPatches(
          state,
          (plan) => {
            delete plan.seedMixes![mixId];

            // Clear seedSource from plantings that referenced this mix
            if (plan.plantings) {
              for (const planting of plan.plantings) {
                if (planting.seedSource?.type === 'mix' && planting.seedSource.id === mixId) {
                  planting.seedSource = undefined;
                }
              }
            }

            plan.metadata.lastModified = Date.now();
          },
          `Delete seed mix ${mixId}`
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

    importSeedMixes: async (inputs: RawSeedMixInput[]) => {
      const existingMixes = get().currentPlan?.seedMixes ?? {};
      const existingVarieties = get().currentPlan?.varieties ?? {};

      const existingMixesByKey = new Map<string, string>();
      for (const m of Object.values(existingMixes)) {
        existingMixesByKey.set(getSeedMixKey(m), m.id);
      }

      const varietyIdByKey = new Map<string, string>();
      for (const v of Object.values(existingVarieties)) {
        varietyIdByKey.set(getVarietyKey(v), v.id);
      }

      let added = 0;
      let updated = 0;
      let unresolvedVarieties = 0;

      set((state) => {
        if (!state.currentPlan) return;

        mutateWithPatches(
          state,
          (plan) => {
            if (!plan.seedMixes) {
              plan.seedMixes = {};
            }

            for (const rawInput of inputs) {
              const resolvedComponents = rawInput.components.map((comp) => {
                if (comp.varietyId) {
                  return { varietyId: comp.varietyId, percent: comp.percent };
                }

                if (comp._varietyCrop && comp._varietyName) {
                  const varietyKey = `${comp._varietyCrop}|${comp._varietyName}|${comp._varietySupplier || ''}`.toLowerCase().trim();
                  const varietyId = varietyIdByKey.get(varietyKey);
                  if (varietyId) {
                    return { varietyId, percent: comp.percent };
                  }
                }

                unresolvedVarieties++;
                return null;
              }).filter((c): c is { varietyId: string; percent: number } => c !== null);

              const input: CreateSeedMixInput = {
                id: rawInput.id,
                name: rawInput.name,
                crop: rawInput.crop,
                components: resolvedComponents,
                notes: rawInput.notes,
              };

              const contentKey = `${input.name}|${input.crop}`.toLowerCase().trim();
              const existingId = existingMixesByKey.get(contentKey);

              if (existingId) {
                const mix = createSeedMix({ ...input, id: existingId });
                plan.seedMixes[existingId] = mix;
                updated++;
              } else {
                const mix = createSeedMix(input);
                plan.seedMixes[mix.id] = mix;
                existingMixesByKey.set(contentKey, mix.id);
                added++;
              }
            }

            plan.metadata.lastModified = Date.now();
          },
          `Import ${inputs.length} seed mixes`
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

      return { added, updated, unresolvedVarieties };
    },

    getSeedMix: (mixId: string) => {
      return get().currentPlan?.seedMixes?.[mixId];
    },

    getSeedMixesForCrop: (crop: string) => {
      const mixes = get().currentPlan?.seedMixes ?? {};
      return Object.values(mixes).filter((m) => m.crop === crop);
    },

    // ---- Product Management ----

    addProduct: async (product: Product) => {
      set((state) => {
        if (!state.currentPlan) return;

        mutateWithPatches(
          state,
          (plan) => {
            if (!plan.products) {
              plan.products = {};
            }
            plan.products[product.id] = product;
            plan.metadata.lastModified = Date.now();
          },
          `Add product ${product.product}`
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

    updateProduct: async (product: Product) => {
      set((state) => {
        if (!state.currentPlan?.products?.[product.id]) return;

        mutateWithPatches(
          state,
          (plan) => {
            plan.products![product.id] = product;
            plan.metadata.lastModified = Date.now();
          },
          `Update product ${product.product}`
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

    deleteProduct: async (productId: string) => {
      set((state) => {
        if (!state.currentPlan?.products?.[productId]) return;

        mutateWithPatches(
          state,
          (plan) => {
            delete plan.products![productId];
            plan.metadata.lastModified = Date.now();
          },
          `Delete product ${productId}`
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

    importProducts: async (inputs: CreateProductInput[]) => {
      const existingProducts = get().currentPlan?.products ?? {};
      const existingByKey = new Map<string, string>();
      for (const p of Object.values(existingProducts)) {
        existingByKey.set(getProductKey(p.crop, p.product, p.unit), p.id);
      }

      let added = 0;
      let updated = 0;

      set((state) => {
        if (!state.currentPlan) return;

        mutateWithPatches(
          state,
          (plan) => {
            if (!plan.products) {
              plan.products = {};
            }

            for (const input of inputs) {
              const key = getProductKey(input.crop, input.product, input.unit);
              const existingId = existingByKey.get(key);

              if (existingId) {
                // Update existing product
                const product = createProduct(input);
                plan.products[product.id] = product;
                updated++;
              } else {
                // Add new product
                const product = createProduct(input);
                plan.products[product.id] = product;
                added++;
              }
            }

            plan.metadata.lastModified = Date.now();
          },
          `Import ${inputs.length} products`
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

      return { added, updated };
    },

    getProduct: (productId: string) => {
      return get().currentPlan?.products?.[productId];
    },

    getProductsForCrop: (crop: string) => {
      const products = get().currentPlan?.products ?? {};
      return Object.values(products).filter((p) => p.crop.toLowerCase() === crop.toLowerCase());
    },

    // ---- Seed Order Management ----

    upsertSeedOrder: async (order: SeedOrder) => {
      set((state) => {
        if (!state.currentPlan) return;

        mutateWithPatches(
          state,
          (plan) => {
            if (!plan.seedOrders) {
              plan.seedOrders = {};
            }
            plan.seedOrders[order.id] = order;
            plan.metadata.lastModified = Date.now();
          },
          `Upsert seed order ${order.id}`
        );

        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const plan = get().currentPlan;
      if (plan) {
        try {
          await savePlanToLibrary(plan);
        } finally {
          set((state) => {
            state.isSaving = false;
          });
        }
      }
    },

    deleteSeedOrder: async (orderId: string) => {
      set((state) => {
        if (!state.currentPlan?.seedOrders?.[orderId]) return;

        mutateWithPatches(
          state,
          (plan) => {
            delete plan.seedOrders![orderId];
            plan.metadata.lastModified = Date.now();
          },
          `Delete seed order ${orderId}`
        );

        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const plan = get().currentPlan;
      if (plan) {
        try {
          await savePlanToLibrary(plan);
        } finally {
          set((state) => {
            state.isSaving = false;
          });
        }
      }
    },

    importSeedOrders: async (inputs: CreateSeedOrderInput[]) => {
      let added = 0;
      let updated = 0;

      set((state) => {
        if (!state.currentPlan) return;

        mutateWithPatches(
          state,
          (plan) => {
            if (!plan.seedOrders) {
              plan.seedOrders = {};
            }

            for (const input of inputs) {
              const order = createSeedOrder(input);
              const existingOrder = plan.seedOrders[order.id];

              if (existingOrder) {
                // Update existing - merge fields (don't overwrite user's quantity choices with empty values)
                if (input.productWeight !== undefined) existingOrder.productWeight = input.productWeight;
                if (input.productUnit !== undefined) existingOrder.productUnit = input.productUnit;
                if (input.productCost !== undefined) existingOrder.productCost = input.productCost;
                if (input.productLink !== undefined) existingOrder.productLink = input.productLink;
                // Don't overwrite quantity or alreadyHave - those are user decisions
                updated++;
              } else {
                plan.seedOrders[order.id] = order;
                added++;
              }
            }

            plan.metadata.lastModified = Date.now();
          },
          `Import ${inputs.length} seed orders`
        );

        state.isDirty = true;
        state.isSaving = true;
        state.saveError = null;
      });

      const plan = get().currentPlan;
      if (plan) {
        try {
          await savePlanToLibrary(plan);
        } finally {
          set((state) => {
            state.isSaving = false;
          });
        }
      }

      return { added, updated };
    },

    getSeedOrder: (orderId: string) => {
      return get().currentPlan?.seedOrders?.[orderId];
    },

    getSeedOrderForVariety: (varietyId: string) => {
      const orderId = getSeedOrderId(varietyId);
      return get().currentPlan?.seedOrders?.[orderId];
    },

    getAllSeedOrders: () => {
      const seedOrders = get().currentPlan?.seedOrders ?? {};
      return Object.values(seedOrders);
    },

    // ---- Market Management ----

    addMarket: async (name: string) => {
      const currentPlan = get().currentPlan;
      if (!currentPlan) return;

      // Get next display order
      const markets = currentPlan.markets ?? {};
      const maxOrder = Math.max(-1, ...Object.values(markets).map(m => m.displayOrder));

      const market = createMarket({
        name: name.trim(),
        displayOrder: maxOrder + 1,
        active: true,
      });

      set((state) => {
        if (!state.currentPlan) return;
        mutateWithPatches(
          state,
          (plan) => {
            if (!plan.markets) {
              plan.markets = {};
            }
            plan.markets[market.id] = market;
            plan.metadata.lastModified = Date.now();
          },
          `Add market "${name}"`
        );
        state.isDirty = true;
      });

      await savePlanToLibrary(get().currentPlan!);
    },

    updateMarket: async (id: string, updates: Partial<Omit<Market, 'id'>>) => {
      const currentPlan = get().currentPlan;
      if (!currentPlan?.markets?.[id]) return;

      const marketName = currentPlan.markets[id].name;
      set((state) => {
        if (!state.currentPlan?.markets?.[id]) return;
        mutateWithPatches(
          state,
          (plan) => {
            Object.assign(plan.markets![id], updates);
            plan.metadata.lastModified = Date.now();
          },
          `Update market "${marketName}"`
        );
        state.isDirty = true;
      });

      await savePlanToLibrary(get().currentPlan!);
    },

    deactivateMarket: async (id: string) => {
      const currentPlan = get().currentPlan;
      if (!currentPlan?.markets?.[id]) return;

      const marketName = currentPlan.markets[id].name;
      set((state) => {
        if (!state.currentPlan?.markets?.[id]) return;
        mutateWithPatches(
          state,
          (plan) => {
            plan.markets![id].active = false;
            plan.metadata.lastModified = Date.now();
          },
          `Deactivate market "${marketName}"`
        );
        state.isDirty = true;
      });

      await savePlanToLibrary(get().currentPlan!);
    },

    reactivateMarket: async (id: string) => {
      const currentPlan = get().currentPlan;
      if (!currentPlan?.markets?.[id]) return;

      const marketName = currentPlan.markets[id].name;
      set((state) => {
        if (!state.currentPlan?.markets?.[id]) return;
        mutateWithPatches(
          state,
          (plan) => {
            plan.markets![id].active = true;
            plan.metadata.lastModified = Date.now();
          },
          `Reactivate market "${marketName}"`
        );
        state.isDirty = true;
      });

      await savePlanToLibrary(get().currentPlan!);
    },

    getMarket: (id: string) => {
      return get().currentPlan?.markets?.[id];
    },

    getActiveMarkets: () => {
      const markets = get().currentPlan?.markets ?? {};
      return getActiveMarketsFromRecord(markets);
    },

    // ---- Plan Metadata ----
    updatePlanMetadata: async (updates) => {
      const { currentPlan } = get();
      if (!currentPlan) return;

      set((state) => {
        if (!state.currentPlan) return;
        mutateWithPatches(
          state,
          (plan) => {
            Object.assign(plan.metadata, updates);
            plan.metadata.lastModified = Date.now();
          },
          `Update plan settings`
        );
        state.isDirty = true;
      });

      await savePlanToLibrary(get().currentPlan!);

      // If name changed, update the plan list
      if (updates.name) {
        await get().refreshPlanList();
      }
    },

    updatePlanNotes: async (notes: string) => {
      const { currentPlan } = get();
      if (!currentPlan) return;

      set((state) => {
        if (!state.currentPlan) return;
        mutateWithPatches(
          state,
          (plan) => {
            plan.notes = notes;
            plan.metadata.lastModified = Date.now();
          },
          `Update plan notes`
        );
        state.isDirty = true;
      });

      await savePlanToLibrary(get().currentPlan!);
      await get().refreshPlanList();
    },

    // ---- Sequence Management (Succession Planting) ----

    createSequenceFromPlanting: async (plantingId, options) => {
      const { currentPlan } = get();
      if (!currentPlan?.plantings) {
        throw new Error('No plan loaded');
      }

      // Validate options
      if (options.count < 2 || options.count > 20) {
        throw new Error('Sequence count must be between 2 and 20');
      }
      if (options.offsetDays < 1 || options.offsetDays > 90) {
        throw new Error('Offset days must be between 1 and 90');
      }

      // Find the original planting
      const original = currentPlan.plantings.find(p => p.id === plantingId);
      if (!original) {
        throw new Error(`Planting not found: ${plantingId}`);
      }

      // Check if already in a sequence
      if (original.sequenceId) {
        throw new Error('Planting is already part of a sequence');
      }

      // Create the sequence entity
      const sequence = createSequence({
        name: options.name,
        offsetDays: options.offsetDays,
      });

      // Calculate dates for all plantings
      const anchorDate = parseISO(original.fieldStartDate);
      if (!isValid(anchorDate)) {
        throw new Error('Invalid anchor date');
      }

      // Create new plantings (indices 1 to count-1)
      const newPlantingIds: string[] = [];
      const newPlantings: Planting[] = [];

      for (let i = 1; i < options.count; i++) {
        const offsetDate = addDays(anchorDate, i * options.offsetDays);
        const newPlanting = createPlanting({
          configId: original.configId,
          fieldStartDate: format(offsetDate, 'yyyy-MM-dd'),
          startBed: options.bedAssignment === 'same' ? original.startBed : null,
          bedFeet: original.bedFeet,
          seedSource: original.seedSource,
          useDefaultSeedSource: original.useDefaultSeedSource,
          marketSplit: original.marketSplit,
          overrides: original.overrides,
          notes: original.notes,
          sequenceId: sequence.id,
          sequenceSlot: i,
        });
        newPlantings.push(newPlanting);
        newPlantingIds.push(newPlanting.id);
      }

      const allPlantingIds = [plantingId, ...newPlantingIds];
      const description = `Create sequence "${options.name || 'Succession'}" with ${options.count} plantings`;

      set((state) => {
        if (!state.currentPlan?.plantings) return;

        mutateWithPatches(
          state,
          (plan) => {
            const now = Date.now();

            // Initialize sequences if needed
            if (!plan.sequences) {
              plan.sequences = {};
            }

            // Add the sequence
            plan.sequences[sequence.id] = sequence;

            // Update the original planting to be the anchor
            const anchor = plan.plantings?.find(p => p.id === plantingId);
            if (anchor) {
              anchor.sequenceId = sequence.id;
              anchor.sequenceSlot = 0;
              anchor.lastModified = now;
            }

            // Add all new plantings
            for (const planting of newPlantings) {
              plan.plantings?.push(planting);
            }

            plan.metadata.lastModified = now;
            plan.changeLog.push(
              createChangeEntry('create', description, allPlantingIds)
            );
          },
          description
        );

        state.isDirty = true;
      });

      await savePlanToLibrary(get().currentPlan!);

      return { sequenceId: sequence.id, plantingIds: allPlantingIds };
    },

    updateSequenceOffset: async (sequenceId, newOffsetDays) => {
      const { currentPlan } = get();
      if (!currentPlan?.sequences) return;

      const sequence = currentPlan.sequences[sequenceId];
      if (!sequence) {
        throw new Error(`Sequence not found: ${sequenceId}`);
      }

      if (newOffsetDays < 1 || newOffsetDays > 365) {
        throw new Error('Offset days must be between 1 and 365');
      }

      set((state) => {
        if (!state.currentPlan?.sequences) return;

        mutateWithPatches(
          state,
          (plan) => {
            const now = Date.now();

            // Update the sequence offset - followers auto-recompute at render time
            if (plan.sequences?.[sequenceId]) {
              plan.sequences[sequenceId].offsetDays = newOffsetDays;
            }

            plan.metadata.lastModified = now;
          },
          `Update sequence offset to ${newOffsetDays} days`
        );

        state.isDirty = true;
      });

      await savePlanToLibrary(get().currentPlan!);
    },

    unlinkFromSequence: async (plantingId) => {
      const { currentPlan } = get();
      if (!currentPlan?.plantings || !currentPlan.sequences) return;

      const planting = currentPlan.plantings.find(p => p.id === plantingId);
      if (!planting || !planting.sequenceId) {
        return; // Not in a sequence, nothing to do
      }

      const sequenceId = planting.sequenceId;
      const sequence = currentPlan.sequences[sequenceId];
      if (!sequence) return;

      // Get all plantings in this sequence
      const sequencePlantings = currentPlan.plantings
        .filter(p => p.sequenceId === sequenceId)
        .sort((a, b) => (a.sequenceSlot ?? 0) - (b.sequenceSlot ?? 0));

      const isAnchor = planting.sequenceSlot === 0;
      const remainingCount = sequencePlantings.length - 1;

      set((state) => {
        if (!state.currentPlan?.plantings || !state.currentPlan.sequences) return;

        mutateWithPatches(
          state,
          (plan) => {
            const now = Date.now();
            const p = plan.plantings?.find(p => p.id === plantingId);
            if (!p) return;

            // Clear sequence membership from this planting
            delete p.sequenceId;
            delete p.sequenceSlot;
            p.lastModified = now;

            if (remainingCount <= 1) {
              // Only one planting left - dissolve the sequence entirely
              const lastPlanting = plan.plantings?.find(
                p => p.sequenceId === sequenceId && p.id !== plantingId
              );
              if (lastPlanting) {
                delete lastPlanting.sequenceId;
                delete lastPlanting.sequenceSlot;
                lastPlanting.lastModified = now;
              }
              // Remove the sequence
              delete plan.sequences?.[sequenceId];
            } else if (isAnchor) {
              // Removing anchor - promote next lowest slot to anchor (slot 0)
              // Other plantings keep their slot numbers (sparse slots preserved)
              const remaining = plan.plantings?.filter(
                p => p.sequenceId === sequenceId && p.id !== plantingId
              ).sort((a, b) => (a.sequenceSlot ?? 0) - (b.sequenceSlot ?? 0)) ?? [];

              if (remaining.length > 0) {
                // The first one (lowest slot) becomes the new anchor
                remaining[0].sequenceSlot = 0;
                remaining[0].lastModified = now;
                // Other plantings keep their existing slot numbers - no reindexing
              }
            }
            // If removing a follower (non-anchor): do nothing to remaining plantings
            // They keep their slot numbers, creating gaps (sparse slots)

            plan.metadata.lastModified = now;
          },
          `Unlink planting from sequence`
        );

        state.isDirty = true;
      });

      await savePlanToLibrary(get().currentPlan!);
    },

    deleteSequence: async (sequenceId) => {
      const { currentPlan } = get();
      if (!currentPlan?.plantings || !currentPlan.sequences) return 0;

      const sequence = currentPlan.sequences[sequenceId];
      if (!sequence) return 0;

      // Find all plantings to delete
      const toDelete = currentPlan.plantings.filter(p => p.sequenceId === sequenceId);
      const count = toDelete.length;
      const idsToDelete = toDelete.map(p => p.id);

      if (count === 0) return 0;

      set((state) => {
        if (!state.currentPlan?.plantings || !state.currentPlan.sequences) return;

        mutateWithPatches(
          state,
          (plan) => {
            const now = Date.now();

            // Remove all plantings in the sequence
            plan.plantings = plan.plantings?.filter(p => p.sequenceId !== sequenceId);

            // Remove the sequence itself
            delete plan.sequences?.[sequenceId];

            plan.metadata.lastModified = now;
            plan.changeLog.push(
              createChangeEntry('delete', `Delete sequence with ${count} plantings`, idsToDelete)
            );
          },
          `Delete sequence (${count} plantings)`
        );

        state.isDirty = true;
      });

      await savePlanToLibrary(get().currentPlan!);

      return count;
    },

    getSequence: (sequenceId) => {
      const { currentPlan } = get();
      return currentPlan?.sequences?.[sequenceId];
    },

    getSequencePlantings: (sequenceId) => {
      const { currentPlan } = get();
      if (!currentPlan?.plantings) return [];

      return currentPlan.plantings
        .filter(p => p.sequenceId === sequenceId)
        .sort((a, b) => (a.sequenceSlot ?? 0) - (b.sequenceSlot ?? 0));
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
  // Undo/redo state is tracked in SQLite, counts are synced to store
  const canUndo = usePlanStore((state) => state.undoCount > 0);
  const canRedo = usePlanStore((state) => state.redoCount > 0);
  const undo = usePlanStore((state) => state.undo);
  const redo = usePlanStore((state) => state.redo);
  const undoCount = usePlanStore((state) => state.undoCount);
  const redoCount = usePlanStore((state) => state.redoCount);

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
