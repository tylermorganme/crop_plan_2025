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
import { getAllCrops } from './planting-specs';
import { getStockVarieties, getStockSeedMixes, getStockProducts, getStockMarkets } from './stock-data';
import type { PlantingSpec } from './entities/planting-specs';
import { clonePlantingSpec, clonePlantingCatalog } from './entities/planting-specs';
import { createVariety, getVarietyKey, type Variety, type CreateVarietyInput, type DensityUnit } from './entities/variety';
import { createSeedMix, getSeedMixKey, type SeedMix, type CreateSeedMixInput } from './entities/seed-mix';
import { createProduct, getProductKey, type Product, type CreateProductInput } from './entities/product';
import { createSeedOrder, getSeedOrderId, type SeedOrder, type CreateSeedOrderInput } from './entities/seed-order';

/** Result type for mutations that can fail validation */
export type MutationResult = { success: true } | { success: false; error: string };
import { useUIStore } from './ui-store';
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
export const ACTIVE_PLAN_KEY = 'spec-explorer-active-plan';

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

  const specs = state.currentPlan.specs
    ? clonePlantingCatalog(Object.values(state.currentPlan.specs))
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
    specs,
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
  loadPlanById: (planId: string, options?: { force?: boolean }) => Promise<void>;
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
  /** Bulk update multiple plantings (single undo step). Returns error if validation fails. */
  bulkUpdatePlantings: (updates: { id: string; changes: Partial<Pick<Planting, 'startBed' | 'bedFeet' | 'fieldStartDate' | 'overrides' | 'notes' | 'seedSource' | 'useDefaultSeedSource' | 'marketSplit' | 'actuals'>> }[]) => Promise<MutationResult & { count?: number }>;
  duplicatePlanting: (plantingId: string) => Promise<string>;
  /** Bulk duplicate multiple plantings (single undo step) */
  bulkDuplicatePlantings: (plantingIds: string[]) => Promise<string[]>;
  /** Update a single planting. Returns error if validation fails (e.g., bedFeet exceeds bed capacity). */
  updatePlanting: (plantingId: string, updates: Partial<Pick<Planting, 'specId' | 'startBed' | 'bedFeet' | 'fieldStartDate' | 'overrides' | 'notes' | 'seedSource' | 'useDefaultSeedSource' | 'marketSplit' | 'actuals' | 'useGddTiming'>>) => Promise<MutationResult>;
  /** Assign a seed variety or mix to a planting */
  assignSeedSource: (plantingId: string, seedSource: import('./entities/planting').SeedSource | null) => Promise<void>;
  recalculateSpecs: (specIdentifier: string, catalog: import('./entities/planting-specs').PlantingSpec[]) => Promise<number>;
  /** Update a planting spec in the plan's catalog and recalculate affected plantings.
   * @param spec - The updated spec
   * @param originalIdentifier - The original identifier if it was renamed (required when identifier changes)
   */
  updatePlantingSpec: (spec: import('./entities/planting-specs').PlantingSpec, originalIdentifier?: string) => Promise<number>;
  /** Add a new planting spec to the plan's catalog */
  addPlantingSpec: (spec: import('./entities/planting-specs').PlantingSpec) => Promise<void>;
  /** Delete planting specs from the plan's catalog by their identifiers */
  deletePlantingSpecs: (identifiers: string[]) => Promise<number>;
  /** Toggle a planting spec's favorite status */
  toggleSpecFavorite: (identifier: string) => Promise<void>;
  /** Bulk update multiple planting specs (single undo step) */
  bulkUpdatePlantingSpecs: (updates: { identifier: string; changes: Partial<import('./entities/planting-specs').PlantingSpec> }[]) => Promise<number>;
  /** Update a crop entity's colors or name */
  updateCrop: (cropId: string, updates: { bgColor?: string; textColor?: string; name?: string; gddBaseTemp?: number; gddUpperTemp?: number }) => Promise<void>;
  /** Add a new crop entity */
  addCropEntity: (crop: import('./entities/crop').Crop) => Promise<void>;
  /** Delete a crop entity (fails if referenced by configs) */
  deleteCropEntity: (cropId: string) => Promise<void>;
  /** Bulk add crop entities (single undo step) */
  bulkAddCropEntities: (crops: import('./entities/crop').Crop[]) => Promise<number>;
  /** Bulk update crop entities (single undo step) */
  bulkUpdateCropEntities: (updates: { cropId: string; changes: Partial<import('./entities/crop').Crop> }[]) => Promise<number>;
  /** Bulk delete crop entities (single undo step) */
  bulkDeleteCropEntities: (cropIds: string[]) => Promise<number>;

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
  /** Update crop box display configuration */
  updatePlantingBoxDisplay: (config: import('./entities/plan').PlantingBoxDisplayConfig) => Promise<void>;

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

  /**
   * Update a sequence's name.
   */
  updateSequenceName: (sequenceId: string, newName: string | undefined) => Promise<void>;

  /**
   * Reorder sequence slots by reassigning slot numbers.
   * Validates that slot 0 exists (anchor) and compacts slots to remove gaps at the end.
   */
  reorderSequenceSlots: (
    sequenceId: string,
    newSlotAssignments: { plantingId: string; slot: number }[]
  ) => Promise<void>;

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
    },

    loadPlanById: async (planId: string, options?: { force?: boolean }) => {
      // Skip reload if we already have this plan in memory
      // This avoids race conditions with async patch writes during same-tab navigation
      // Use force: true for cross-tab sync when we know SQLite has newer data
      const { currentPlan } = get();
      if (currentPlan?.id === planId && !options?.force) {
        return;
      }

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

      // Client staleness check: warn if plan was saved by newer code
      const planSchemaVersion = (data.plan as { schemaVersion?: number }).schemaVersion ?? 1;
      if (planSchemaVersion > CURRENT_SCHEMA_VERSION) {
        useUIStore.getState().setToast({
          message: `This plan was saved with a newer version of the app. Please refresh to get the latest code.`,
          type: 'error',
        });
        console.warn(
          `[loadPlanById] Schema mismatch: plan has version ${planSchemaVersion}, client has ${CURRENT_SCHEMA_VERSION}`
        );
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
      });
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
      const specs = clonePlantingCatalog(masterCrops);

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
        specs,
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
      });
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

      // If this planting is locked (has actuals set), don't allow date changes
      // Note: Locked plantings in sequences will have their fieldStartDate updated,
      // but their actual dates stay put, so they remain visually pinned.
      if (planting.actuals?.greenhouseDate || planting.actuals?.fieldDate) {
        return;
      }

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
      });
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
      });
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
      });

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
          planting.specId && currentPlan.specs) {
        const spec = currentPlan.specs[planting.specId];
        if (spec?.defaultSeedSource) {
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
      });
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
            planting.specId && state.currentPlan!.specs) {
          const spec = state.currentPlan!.specs[planting.specId];
          if (spec?.defaultSeedSource) {
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
      });

      return processedPlantings.length;
    },

    bulkUpdatePlantings: async (updates: { id: string; changes: Partial<Pick<Planting, 'startBed' | 'bedFeet' | 'fieldStartDate' | 'overrides' | 'notes' | 'seedSource' | 'useDefaultSeedSource' | 'marketSplit' | 'actuals'>> }[]) => {
      const state = get();
      if (!state.currentPlan?.plantings) {
        return { success: true, count: 0 };
      }

      // Filter to only updates for plantings that exist
      const existingIds = new Set(state.currentPlan.plantings.map(p => p.id));
      const plantingsById = new Map(state.currentPlan.plantings.map(p => [p.id, p]));
      const validUpdates = updates.filter(u => existingIds.has(u.id));

      if (validUpdates.length === 0) {
        return { success: true, count: 0 };
      }

      // Validate planting fits in available space when bedFeet or startBed changes
      const beds = state.currentPlan.beds;
      if (beds) {
        for (const update of validUpdates) {
          const planting = plantingsById.get(update.id);
          const needsValidation = update.changes.bedFeet !== undefined || update.changes.startBed !== undefined;

          if (needsValidation && planting) {
            // Determine the bedFeet to validate (new value or existing)
            const feetToValidate = update.changes.bedFeet ?? planting.bedFeet;
            // Determine the target bed (new startBed or existing)
            const bedId = update.changes.startBed !== undefined
              ? update.changes.startBed
              : planting.startBed;

            if (bedId && feetToValidate) {
              const startBed = beds[bedId];
              if (startBed) {
                // Get all beds in the same group, sorted by displayOrder
                const bedsInGroup = Object.values(beds)
                  .filter(b => b.groupId === startBed.groupId)
                  .sort((a, b) => a.displayOrder - b.displayOrder);

                // Find beds from startBed onwards (consecutive beds that can be spanned)
                const startIndex = bedsInGroup.findIndex(b => b.id === bedId);
                const availableBeds = bedsInGroup.slice(startIndex);
                const totalAvailable = availableBeds.reduce((sum, b) => sum + b.lengthFt, 0);

                if (feetToValidate > totalAvailable) {
                  const action = update.changes.startBed !== undefined ? 'move' : 'resize';
                  return {
                    success: false,
                    error: action === 'move'
                      ? `Cannot move ${feetToValidate}' planting to "${startBed.name}" - only ${totalAvailable}' available`
                      : `Cannot set to ${feetToValidate}' - only ${totalAvailable}' available from bed "${startBed.name}" onwards`,
                  };
                }
              }
            }
          }
        }
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
              if (changes.fieldStartDate !== undefined) {
                planting.fieldStartDate = changes.fieldStartDate;
              }
              if ('overrides' in changes) {
                if (changes.overrides === undefined) {
                  // Explicitly clear all overrides
                  planting.overrides = undefined;
                } else {
                  // Merge overrides (shallow merge)
                  planting.overrides = {
                    ...planting.overrides,
                    ...changes.overrides,
                  };
                }
              }
              if (changes.notes !== undefined) {
                planting.notes = changes.notes || undefined;
              }
              if (changes.seedSource !== undefined) {
                planting.seedSource = changes.seedSource || undefined;
              }
              if (changes.useDefaultSeedSource !== undefined) {
                planting.useDefaultSeedSource = changes.useDefaultSeedSource;
              }
              if ('marketSplit' in changes) {
                planting.marketSplit = changes.marketSplit || undefined;
              }
              if (changes.actuals !== undefined) {
                // Merge actuals - explicitly handle undefined to clear values
                const newActuals = { ...planting.actuals };
                for (const [key, value] of Object.entries(changes.actuals)) {
                  if (value === undefined) {
                    delete (newActuals as Record<string, unknown>)[key];
                  } else {
                    (newActuals as Record<string, unknown>)[key] = value;
                  }
                }
                // If all values are cleared, set actuals to undefined
                planting.actuals = Object.keys(newActuals).length > 0 ? newActuals : undefined;
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
      });

      return { success: true, count: validUpdates.length };
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

    bulkDuplicatePlantings: async (plantingIds: string[]) => {
      const state = get();
      if (!state.currentPlan?.plantings) {
        throw new Error('No plan loaded');
      }

      if (plantingIds.length === 0) {
        return [];
      }

      // Find all plantings to duplicate
      const originals = plantingIds
        .map(id => state.currentPlan!.plantings!.find(p => p.id === id))
        .filter((p): p is Planting => p !== undefined);

      if (originals.length === 0) {
        return [];
      }

      // Clone all plantings (generates new IDs, sets startBed to null)
      const newPlantings = originals.map(original => clonePlanting(original, { startBed: null }));

      // Use bulk add for single undo step
      await get().bulkAddPlantings(newPlantings);

      return newPlantings.map(p => p.id);
    },

    updatePlanting: async (plantingId: string, updates: Partial<Pick<Planting, 'specId' | 'startBed' | 'bedFeet' | 'fieldStartDate' | 'overrides' | 'notes' | 'seedSource' | 'useDefaultSeedSource' | 'marketSplit' | 'actuals' | 'useGddTiming'>>) => {
      // Pre-validate
      const { currentPlan } = get();
      if (!currentPlan?.plantings) {
        return { success: true };
      }

      const planting = currentPlan.plantings.find(p => p.id === plantingId);
      if (!planting) {
        return { success: true };
      }

      // Validate planting fits in available space when bedFeet or startBed changes
      const beds = currentPlan.beds;
      const needsValidation = (updates.bedFeet !== undefined || updates.startBed !== undefined) && beds;
      if (needsValidation && beds) {
        // Determine the bedFeet to validate (new value or existing)
        const feetToValidate = updates.bedFeet ?? planting.bedFeet;
        // Determine the target bed (new startBed or existing)
        const bedId = updates.startBed !== undefined ? updates.startBed : planting.startBed;

        if (bedId && feetToValidate) {
          const startBed = beds[bedId];
          if (startBed) {
            // Get all beds in the same group, sorted by displayOrder
            const bedsInGroup = Object.values(beds)
              .filter(b => b.groupId === startBed.groupId)
              .sort((a, b) => a.displayOrder - b.displayOrder);

            // Find beds from startBed onwards (consecutive beds that can be spanned)
            const startIndex = bedsInGroup.findIndex(b => b.id === bedId);
            const availableBeds = bedsInGroup.slice(startIndex);
            const totalAvailable = availableBeds.reduce((sum, b) => sum + b.lengthFt, 0);

            if (feetToValidate > totalAvailable) {
              const action = updates.startBed !== undefined ? 'move' : 'resize';
              return {
                success: false,
                error: action === 'move'
                  ? `Cannot move ${feetToValidate}' planting to "${startBed.name}" - only ${totalAvailable}' available`
                  : `Cannot set to ${feetToValidate}' - only ${totalAvailable}' available from bed "${startBed.name}" onwards`,
              };
            }
          }
        }
      }

      set((state) => {
        // Use patch-based mutation
        mutateWithPatches(
          state,
          (plan) => {
            const p = plan.plantings?.find(p => p.id === plantingId);
            if (!p) return;

            const now = Date.now();

            // Apply updates
            if (updates.specId !== undefined) {
              p.specId = updates.specId;
            }
            if ('startBed' in updates) {
              p.startBed = updates.startBed ?? null;
            }
            if (updates.bedFeet !== undefined) {
              p.bedFeet = updates.bedFeet;
            }
            if ('overrides' in updates) {
              if (updates.overrides === undefined) {
                // Explicitly clear all overrides
                p.overrides = undefined;
              } else {
                // Merge overrides (shallow merge)
                p.overrides = {
                  ...p.overrides,
                  ...updates.overrides,
                };
              }
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
              // Merge actuals - explicitly handle undefined to clear values
              const newActuals = { ...p.actuals };
              for (const [key, value] of Object.entries(updates.actuals)) {
                if (value === undefined) {
                  delete (newActuals as Record<string, unknown>)[key];
                } else {
                  (newActuals as Record<string, unknown>)[key] = value;
                }
              }
              // If all values are cleared, set actuals to undefined
              p.actuals = Object.keys(newActuals).length > 0 ? newActuals : undefined;
            }
            if ('marketSplit' in updates) {
              p.marketSplit = updates.marketSplit || undefined; // Clear if null/empty
            }
            if ('fieldStartDate' in updates && updates.fieldStartDate !== undefined) {
              p.fieldStartDate = updates.fieldStartDate;
            }
            if ('useGddTiming' in updates) {
              p.useGddTiming = updates.useGddTiming || undefined; // Clear if false
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
      });

      return { success: true };
    },

    assignSeedSource: async (plantingId: string, seedSource) => {
      // Convenience wrapper for assigning seed source
      await get().updatePlanting(plantingId, { seedSource: seedSource ?? undefined });
    },

    recalculateSpecs: async (specIdentifier: string) => {
      const state = get();
      if (!state.currentPlan?.plantings) {
        throw new Error('No plan loaded');
      }

      // Count affected plantings
      const affected = state.currentPlan.plantings.filter(p => p.specId === specIdentifier);
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
              createChangeEntry('batch', `Spec changed: ${specIdentifier}`, affected.map(p => p.id))
            );
          },
          `Spec changed: ${specIdentifier}`
        );
        storeState.isDirty = true;
      });

      return affected.length;
    },

    updatePlantingSpec: async (spec: PlantingSpec, originalIdentifier?: string) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (!state.currentPlan.specs) {
        throw new Error('Plan has no crop catalog');
      }

      // Determine if this is a rename operation
      const isRename = originalIdentifier && originalIdentifier !== spec.identifier;
      const lookupIdentifier = originalIdentifier ?? spec.identifier;

      // Count affected plantings (use original identifier for lookup)
      const affectedPlantingIds = (state.currentPlan.plantings ?? [])
        .filter(p => p.specId === lookupIdentifier)
        .map(p => p.id);

      // Check for duplicate identifier on rename
      if (isRename && state.currentPlan.specs[spec.identifier]) {
        throw new Error(`A spec with identifier "${spec.identifier}" already exists`);
      }

      set((storeState) => {
        if (!storeState.currentPlan?.specs) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            const cloned = clonePlantingSpec(spec);
            cloned.updatedAt = new Date().toISOString();

            // If identifier changed, delete old entry and update planting references
            if (isRename) {
              delete plan.specs![originalIdentifier];
              // Update plantings to reference the new identifier
              for (const planting of plan.plantings ?? []) {
                if (planting.specId === originalIdentifier) {
                  planting.specId = spec.identifier;
                }
              }
            }

            // Add/update with new identifier
            plan.specs![spec.identifier] = cloned;
            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('batch', `Updated spec "${spec.identifier}"`, affectedPlantingIds)
            );
          },
          isRename
            ? `Rename spec "${originalIdentifier}" to "${spec.identifier}"`
            : `Update spec "${spec.identifier}"`
        );
        storeState.isDirty = true;
      });

      return affectedPlantingIds.length;
    },

    addPlantingSpec: async (spec: PlantingSpec) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      // Initialize catalog if it doesn't exist
      if (!state.currentPlan.specs) {
        state.currentPlan.specs = {};
      }

      // Check for duplicate identifier
      if (state.currentPlan.specs[spec.identifier]) {
        throw new Error(`A spec with identifier "${spec.identifier}" already exists`);
      }

      const now = new Date().toISOString();

      set((storeState) => {
        if (!storeState.currentPlan) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            // Initialize catalog if needed
            if (!plan.specs) {
              plan.specs = {};
            }
            // Add new spec to catalog using CRUD function
            const cloned = clonePlantingSpec(spec);
            cloned.createdAt = now;
            cloned.updatedAt = now;
            plan.specs[spec.identifier] = cloned;
            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('batch', `Added new spec "${spec.identifier}"`, [])
            );
          },
          `Add spec "${spec.identifier}"`
        );
        storeState.isDirty = true;
      });
    },

    deletePlantingSpecs: async (identifiers: string[]) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (!state.currentPlan.specs) {
        throw new Error('Plan has no crop catalog');
      }

      // Find which identifiers actually exist
      const existingIdentifiers = identifiers.filter(
        id => state.currentPlan!.specs![id]
      );

      if (existingIdentifiers.length === 0) {
        return 0;
      }

      set((storeState) => {
        if (!storeState.currentPlan?.specs) return;

        const description = existingIdentifiers.length === 1
          ? `Delete spec "${existingIdentifiers[0]}"`
          : `Delete ${existingIdentifiers.length} specs`;

        mutateWithPatches(
          storeState,
          (plan) => {
            // Delete specs from catalog
            for (const identifier of existingIdentifiers) {
              delete plan.specs![identifier];
            }

            plan.metadata.lastModified = Date.now();
            plan.changeLog.push(
              createChangeEntry('batch', description, [])
            );
          },
          description
        );
        storeState.isDirty = true;
      });

      return existingIdentifiers.length;
    },

    toggleSpecFavorite: async (identifier: string) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (!state.currentPlan.specs) {
        throw new Error('Plan has no crop catalog');
      }

      const spec = state.currentPlan.specs[identifier];
      if (!spec) {
        throw new Error(`Spec "${identifier}" not found`);
      }

      const newValue = !spec.isFavorite;
      const description = newValue
        ? `Add "${identifier}" to favorites`
        : `Remove "${identifier}" from favorites`;

      set((storeState) => {
        if (!storeState.currentPlan?.specs) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            plan.specs![identifier].isFavorite = newValue;
            plan.metadata.lastModified = Date.now();
          },
          description
        );
        storeState.isDirty = true;
      });
    },

    bulkUpdatePlantingSpecs: async (updates: { identifier: string; changes: Partial<PlantingSpec> }[]) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (!state.currentPlan.specs) {
        throw new Error('Plan has no crop catalog');
      }

      // Filter to only specs that exist
      const validUpdates = updates.filter(u => state.currentPlan!.specs![u.identifier]);

      if (validUpdates.length === 0) {
        return 0;
      }

      const description = `Update ${validUpdates.length} planting spec${validUpdates.length !== 1 ? 's' : ''}`;

      const now = new Date().toISOString();

      set((storeState) => {
        if (!storeState.currentPlan?.specs) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            for (const { identifier, changes } of validUpdates) {
              Object.assign(plan.specs![identifier], changes, { updatedAt: now });
            }
            plan.metadata.lastModified = Date.now();
          },
          description
        );
        storeState.isDirty = true;
      });

      return validUpdates.length;
    },

    updateCrop: async (cropId: string, updates: { bgColor?: string; textColor?: string; name?: string; gddBaseTemp?: number; gddUpperTemp?: number }) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      const existingCrop = state.currentPlan.crops?.[cropId];
      if (!existingCrop) {
        throw new Error(`Crop not found: ${cropId}`);
      }

      const cropName = existingCrop.name;
      const newName = updates.name;

      set((storeState) => {
        if (!storeState.currentPlan?.crops) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            const crop = plan.crops?.[cropId];
            if (crop) {
              if (updates.bgColor !== undefined) {
                crop.bgColor = updates.bgColor;
              }
              if (updates.textColor !== undefined) {
                crop.textColor = updates.textColor;
              }
              if (updates.gddBaseTemp !== undefined) {
                crop.gddBaseTemp = updates.gddBaseTemp;
              } else if (updates.gddBaseTemp === undefined && 'gddBaseTemp' in updates) {
                // Explicitly clearing the value
                delete crop.gddBaseTemp;
              }
              if (updates.gddUpperTemp !== undefined) {
                crop.gddUpperTemp = updates.gddUpperTemp;
              } else if (updates.gddUpperTemp === undefined && 'gddUpperTemp' in updates) {
                // Explicitly clearing the value
                delete crop.gddUpperTemp;
              }
              if (newName !== undefined) {
                crop.name = newName;

                // Propagate name change to all linked entities (by cropId)
                // PlantingSpec
                if (plan.specs) {
                  for (const spec of Object.values(plan.specs)) {
                    if (spec.cropId === cropId) {
                      spec.crop = newName;
                    }
                  }
                }
                // Variety
                if (plan.varieties) {
                  for (const variety of Object.values(plan.varieties)) {
                    if (variety.cropId === cropId) {
                      variety.crop = newName;
                    }
                  }
                }
                // SeedMix
                if (plan.seedMixes) {
                  for (const mix of Object.values(plan.seedMixes)) {
                    if (mix.cropId === cropId) {
                      mix.crop = newName;
                    }
                  }
                }
                // Product
                if (plan.products) {
                  for (const product of Object.values(plan.products)) {
                    if (product.cropId === cropId) {
                      product.crop = newName;
                    }
                  }
                }
              }
            }
            plan.metadata.lastModified = Date.now();
          },
          `Update crop: ${cropName}${newName ? ` → ${newName}` : ''}`
        );
        storeState.isDirty = true;
      });
    },

    addCropEntity: async (crop) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (state.currentPlan.crops?.[crop.id]) {
        throw new Error(`Crop already exists: ${crop.id}`);
      }

      set((storeState) => {
        if (!storeState.currentPlan) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            if (!plan.crops) {
              plan.crops = {};
            }
            plan.crops[crop.id] = { ...crop };
            plan.metadata.lastModified = Date.now();
          },
          `Add crop: ${crop.name}`
        );
        storeState.isDirty = true;
      });
    },

    deleteCropEntity: async (cropId: string) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      const existingCrop = state.currentPlan.crops?.[cropId];
      if (!existingCrop) {
        throw new Error(`Crop not found: ${cropId}`);
      }

      // Check if crop is referenced by any specs
      const { getCropId } = await import('./entities/crop');
      const referencingSpecs = Object.values(state.currentPlan.specs || {})
        .filter(spec => getCropId(spec.crop) === cropId);

      if (referencingSpecs.length > 0) {
        throw new Error(`Cannot delete crop "${existingCrop.name}" - used by ${referencingSpecs.length} spec(s)`);
      }

      const cropName = existingCrop.name;

      set((storeState) => {
        if (!storeState.currentPlan?.crops) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            if (plan.crops) {
              delete plan.crops[cropId];
            }
            plan.metadata.lastModified = Date.now();
          },
          `Delete crop: ${cropName}`
        );
        storeState.isDirty = true;
      });
    },

    bulkAddCropEntities: async (crops) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (crops.length === 0) return 0;

      // Filter out crops that already exist
      const newCrops = crops.filter(crop => !state.currentPlan?.crops?.[crop.id]);
      if (newCrops.length === 0) return 0;

      set((storeState) => {
        if (!storeState.currentPlan) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            if (!plan.crops) {
              plan.crops = {};
            }
            for (const crop of newCrops) {
              plan.crops[crop.id] = { ...crop };
            }
            plan.metadata.lastModified = Date.now();
          },
          `Add ${newCrops.length} crop(s)`
        );
        storeState.isDirty = true;
      });

      return newCrops.length;
    },

    bulkUpdateCropEntities: async (updates) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (updates.length === 0) return 0;

      // Filter to valid updates (crops that exist)
      const validUpdates = updates.filter(u => state.currentPlan?.crops?.[u.cropId]);
      if (validUpdates.length === 0) return 0;

      set((storeState) => {
        if (!storeState.currentPlan?.crops) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            for (const { cropId, changes } of validUpdates) {
              const crop = plan.crops?.[cropId];
              if (crop) {
                if (changes.bgColor !== undefined) crop.bgColor = changes.bgColor;
                if (changes.textColor !== undefined) crop.textColor = changes.textColor;
                if (changes.name !== undefined) crop.name = changes.name;
              }
            }
            plan.metadata.lastModified = Date.now();
          },
          `Update ${validUpdates.length} crop(s)`
        );
        storeState.isDirty = true;
      });

      return validUpdates.length;
    },

    bulkDeleteCropEntities: async (cropIds) => {
      const state = get();
      if (!state.currentPlan) {
        throw new Error('No plan loaded');
      }

      if (cropIds.length === 0) return 0;

      // Filter to crops that exist and aren't referenced
      const { getCropId } = await import('./entities/crop');
      const referencedCropIds = new Set(
        Object.values(state.currentPlan.specs || {})
          .map(spec => getCropId(spec.crop))
      );

      const deletableCropIds = cropIds.filter(id =>
        state.currentPlan?.crops?.[id] && !referencedCropIds.has(id)
      );

      if (deletableCropIds.length === 0) return 0;

      set((storeState) => {
        if (!storeState.currentPlan?.crops) return;

        mutateWithPatches(
          storeState,
          (plan) => {
            for (const cropId of deletableCropIds) {
              if (plan.crops) {
                delete plan.crops[cropId];
              }
            }
            plan.metadata.lastModified = Date.now();
          },
          `Delete ${deletableCropIds.length} crop(s)`
        );
        storeState.isDirty = true;
      });

      return deletableCropIds.length;
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
      });
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
        }
      });
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
      });

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
        }
      });

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
      });
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
      });
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
      });
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
      });
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
      });
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
      });

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
      });
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
      });
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
      });
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
      });
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
      });
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
      });
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
      });

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
      });
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
      });
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
      });
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
      });

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
      });
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
      });
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
      });
    },

    importProducts: async (inputs: CreateProductInput[]) => {
      const existingProducts = get().currentPlan?.products ?? {};
      // Map from compound key to existing product ID for deduplication
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
                // Update existing product - preserve the UUID, update data
                const existing = plan.products[existingId];
                plan.products[existingId] = {
                  ...existing,
                  crop: input.crop.trim(),
                  product: input.product.trim(),
                  unit: input.unit.trim(),
                  prices: input.prices ?? existing.prices,
                  holdingWindow: input.holdingWindow ?? existing.holdingWindow,
                };
                updated++;
              } else {
                // Add new product with a fresh UUID
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
      });

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
      });
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
      });
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
      });

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

      await get().refreshPlanList();
    },

    updatePlantingBoxDisplay: async (config) => {
      const { currentPlan } = get();
      if (!currentPlan) return;

      set((state) => {
        if (!state.currentPlan) return;
        mutateWithPatches(
          state,
          (plan) => {
            plan.plantingBoxDisplay = config;
            plan.metadata.lastModified = Date.now();
          },
          `Update crop box display settings`
        );
        state.isDirty = true;
      });
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
          specId: original.specId,
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
    },

    updateSequenceName: async (sequenceId, newName) => {
      const { currentPlan } = get();
      if (!currentPlan?.sequences) return;

      const sequence = currentPlan.sequences[sequenceId];
      if (!sequence) {
        throw new Error(`Sequence not found: ${sequenceId}`);
      }

      set((state) => {
        if (!state.currentPlan?.sequences) return;

        mutateWithPatches(
          state,
          (plan) => {
            const now = Date.now();

            if (plan.sequences?.[sequenceId]) {
              plan.sequences[sequenceId].name = newName;
            }

            plan.metadata.lastModified = now;
          },
          `Update sequence name to "${newName ?? '(unnamed)'}"`
        );

        state.isDirty = true;
      });
    },

    reorderSequenceSlots: async (sequenceId, newSlotAssignments) => {
      const { currentPlan } = get();
      if (!currentPlan?.plantings || !currentPlan.sequences) return;

      const sequence = currentPlan.sequences[sequenceId];
      if (!sequence) {
        throw new Error(`Sequence not found: ${sequenceId}`);
      }

      // Validate: all plantings must be in this sequence
      const sequencePlantingIds = new Set(
        currentPlan.plantings
          .filter(p => p.sequenceId === sequenceId)
          .map(p => p.id)
      );

      for (const { plantingId } of newSlotAssignments) {
        if (!sequencePlantingIds.has(plantingId)) {
          throw new Error(`Planting ${plantingId} is not in sequence ${sequenceId}`);
        }
      }

      // Validate: slot 0 must exist (anchor)
      const hasAnchor = newSlotAssignments.some(a => a.slot === 0);
      if (!hasAnchor) {
        throw new Error('Sequence must have an anchor (slot 0)');
      }

      // Validate: no duplicate slots
      const slots = newSlotAssignments.map(a => a.slot);
      const uniqueSlots = new Set(slots);
      if (uniqueSlots.size !== slots.length) {
        throw new Error('Duplicate slot numbers in assignment');
      }

      set((state) => {
        if (!state.currentPlan?.plantings) return;

        mutateWithPatches(
          state,
          (plan) => {
            const now = Date.now();

            for (const { plantingId, slot } of newSlotAssignments) {
              const planting = plan.plantings?.find(p => p.id === plantingId);
              if (planting) {
                planting.sequenceSlot = slot;
                planting.lastModified = now;
              }
            }

            plan.metadata.lastModified = now;
          },
          `Reorder sequence slots`
        );

        state.isDirty = true;
      });
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
              // Removing anchor - promote next lowest slot and shift all slots down
              const remaining = plan.plantings?.filter(
                rp => rp.sequenceId === sequenceId && rp.id !== plantingId
              ).sort((a, b) => (a.sequenceSlot ?? 0) - (b.sequenceSlot ?? 0)) ?? [];

              if (remaining.length > 0) {
                const seq = plan.sequences?.[sequenceId];
                const offsetDays = seq?.offsetDays ?? 7;
                const oldAnchorDate = parseISO(p.fieldStartDate);
                const newAnchorOldSlot = remaining[0].sequenceSlot ?? 1;

                // Materialize new anchor's computed date as its fieldStartDate
                // Formula: anchor.fieldStartDate + (slot * offsetDays) + additionalDaysInField
                const newAnchorAdditionalDays = remaining[0].overrides?.additionalDaysInField ?? 0;
                const totalOffset = newAnchorOldSlot * offsetDays + newAnchorAdditionalDays;
                const newAnchorComputedDate = addDays(oldAnchorDate, totalOffset);
                remaining[0].fieldStartDate = format(newAnchorComputedDate, 'yyyy-MM-dd');

                // Shift all remaining slots down by the displacement
                for (const rp of remaining) {
                  rp.sequenceSlot = (rp.sequenceSlot ?? 0) - newAnchorOldSlot;
                  rp.lastModified = now;
                }
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

  // Load active plan ID from localStorage and load the plan
  try {
    const storedId = localStorage.getItem(ACTIVE_PLAN_KEY);
    if (storedId) {
      store.setActivePlanId(storedId);
      // Also load the plan if not already loaded
      if (!store.currentPlan || store.currentPlan.id !== storedId) {
        await store.loadPlanById(storedId);
      }
    }
  } catch { /* ignore */ }

  // Set up cross-tab sync listener (BroadcastChannel)
  onSyncMessage((message) => {
    if (message.type === 'plan-updated' || message.type === 'plan-deleted') {
      // Refresh plan list when any tab creates/updates/deletes a plan
      usePlanStore.getState().refreshPlanList();

      // If the current plan was updated in another tab, force reload it
      const state = usePlanStore.getState();
      if (message.type === 'plan-updated' && state.currentPlan?.id === message.planId) {
        state.loadPlanById(message.planId, { force: true }).catch(console.error);
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
