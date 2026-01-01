/**
 * Plan Data Types
 *
 * Core types for editable crop plans with undo/redo support.
 */

/** A single crop entry on the timeline (may be one of several beds for a planting) */
export interface TimelineCrop {
  id: string;
  name: string;
  startDate: string;  // ISO date
  endDate: string;    // ISO date
  resource: string;   // Bed assignment (empty = unassigned)
  category?: string;
  bgColor?: string;
  textColor?: string;
  /** Total feet needed for this planting */
  feetNeeded?: number;
  structure?: string;
  /** Short planting ID from bed plan (e.g., "PEP004") */
  plantingId?: string;
  /** Crop config identifier matching crops.json (e.g., "Pepper (Hot) - Ripe Fruit...") */
  cropConfigId: string;
  /** Total number of beds this crop occupies */
  totalBeds: number;
  /** Which bed number this is (1-indexed) in the sequence */
  bedIndex: number;
  /** The base planting ID for grouping related bed entries */
  groupId: string;
  /** Feet of this bed actually used by the crop */
  feetUsed?: number;
  /** Total feet capacity of this bed */
  bedCapacityFt?: number;
  /** Harvest start date (ISO date) - when harvest window begins */
  harvestStartDate?: string;
  /** Planting method: DS (Direct Seed), TP (Transplant), PE (Perennial) */
  plantingMethod?: 'DS' | 'TP' | 'PE';
  /** Timestamp of last modification to this crop (for future sync) */
  lastModified?: number;
}

/** A group of beds (e.g., row "A" contains beds A1-A8) */
export interface ResourceGroup {
  name: string | null;
  beds: string[];
}

/** Info about each bed in a span, including how much is used */
export interface BedSpanInfo {
  bed: string;
  feetUsed: number;
  bedCapacityFt: number;
}

/** Metadata about a saved plan */
export interface PlanMetadata {
  id: string;
  name: string;
  createdAt: number;
  lastModified: number;
  description?: string;
  /** Target year for new plantings (crops added use this year with their target month/day) */
  year: number;
  /** Version number, incremented on export */
  version?: number;
  /** ID of plan this was copied/forked from */
  parentPlanId?: string;
  /** Version of parent plan when copied */
  parentVersion?: number;
}

/** A single change entry for undo history */
export interface PlanChange {
  id: string;
  timestamp: number;
  type: 'move' | 'date_change' | 'delete' | 'create' | 'batch';
  description: string;
  /** Affected crop group IDs */
  groupIds: string[];
}

/** Complete saveable plan state */
export interface Plan {
  /** Unique plan identifier */
  id: string;
  /** Plan metadata */
  metadata: PlanMetadata;
  /** Current crop state */
  crops: TimelineCrop[];
  /** Available resources (beds) */
  resources: string[];
  /** Resource grouping */
  groups: ResourceGroup[];
  /** Change history (for persistence) */
  changeLog: PlanChange[];
  /**
   * Plan's own crop catalog - copy from master on plan creation.
   * Edits to crop configs modify this, not the global crops.json.
   * Stored as a map keyed by identifier for fast lookup.
   */
  cropCatalog?: Record<string, import('./crop-calculations').CropConfig>;
}

/** State for the plan store */
export interface PlanState {
  /** Current plan being edited */
  currentPlan: Plan | null;
  /** Past states for undo */
  past: TimelineCrop[][];
  /** Future states for redo */
  future: TimelineCrop[][];
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Loading/saving state */
  isLoading: boolean;
  /** Last auto-save timestamp */
  lastSaved: number | null;
}

/** Actions available on the plan store */
export interface PlanActions {
  // Plan lifecycle
  loadPlan: (plan: Plan) => void;
  loadPlanById: (planId: string) => void;
  createNewPlan: (name: string, crops: TimelineCrop[], resources: string[], groups: ResourceGroup[]) => void;
  renamePlan: (newName: string) => void;
  resetPlan: () => void;

  // Crop mutations (all create undo points)
  moveCrop: (groupId: string, newResource: string, bedSpanInfo?: BedSpanInfo[]) => void;
  updateCropDates: (groupId: string, startDate: string, endDate: string) => void;
  deleteCrop: (groupId: string) => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Persistence
  markSaved: () => void;
  markDirty: () => void;
}

export type PlanStore = PlanState & PlanActions;

// ============================================
// Export/Import File Format Types
// ============================================

/** Current schema version for data migrations */
export const CURRENT_SCHEMA_VERSION = 1;

// ============================================
// TimelineCrop Factory
// ============================================

/**
 * Generate a deterministic ID for a timeline crop entry.
 * Format: {plantingId}_bed{bedIndex} or {plantingId}_unassigned
 *
 * This ensures stable IDs when re-importing from the same source data.
 */
export function generateCropId(plantingId: string, bedIndex: number | 'unassigned'): string {
  return bedIndex === 'unassigned'
    ? `${plantingId}_unassigned`
    : `${plantingId}_bed${bedIndex}`;
}

/**
 * Extract the base planting ID, stripping any _copy_* suffixes.
 * e.g., "PEP002_copy_123" -> "PEP002"
 */
export function getBasePlantingId(plantingId: string): string {
  const match = plantingId.match(/^(.+?)(?:_\d+)?$/);
  return match ? match[1] : plantingId;
}

// Simple counter for generating unique IDs within a session
let nextId = 1;

/**
 * Generate a short unique planting ID.
 * Format: P{sequential number} e.g., P1, P2, P3...
 */
export function generatePlantingId(): string {
  return `P${nextId++}`;
}

/**
 * Initialize the ID counter based on existing plantings.
 * Call this when loading a plan to avoid ID collisions.
 */
export function initializeIdCounter(existingIds: string[]): void {
  let maxId = 0;
  for (const id of existingIds) {
    const match = id.match(/^P(\d+)$/);
    if (match) {
      maxId = Math.max(maxId, parseInt(match[1], 10));
    }
  }
  nextId = maxId + 1;
}

/** Required fields for creating a TimelineCrop */
export interface CreateTimelineCropInput {
  /** Base planting ID (e.g., "PEP004") */
  plantingId: string;
  /** Crop config identifier from crops.json */
  cropConfigId: string;
  /** Display name */
  name: string;
  /** Start date (ISO string) */
  startDate: string;
  /** End date (ISO string) */
  endDate: string;
  /** Bed assignment (empty string = unassigned) */
  resource: string;
  /** Total beds in this planting */
  totalBeds: number;
  /** Which bed this is (1-indexed), or 0 for unassigned */
  bedIndex: number;
  /** Optional: override groupId (for duplicates) */
  groupId?: string;
  /** Optional fields */
  category?: string;
  bgColor?: string;
  textColor?: string;
  feetNeeded?: number;
  structure?: string;
  feetUsed?: number;
  bedCapacityFt?: number;
  harvestStartDate?: string;
  plantingMethod?: 'DS' | 'TP' | 'PE';
  lastModified?: number;
}

/**
 * Factory function for creating TimelineCrop objects.
 * Ensures all required fields are set with deterministic IDs.
 */
export function createTimelineCrop(input: CreateTimelineCropInput): TimelineCrop {
  const groupId = input.groupId ?? input.plantingId;
  const id = input.resource
    ? generateCropId(groupId, input.bedIndex - 1)  // bed index in ID is 0-based
    : generateCropId(groupId, 'unassigned');

  return {
    id,
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    resource: input.resource,
    cropConfigId: input.cropConfigId,
    totalBeds: input.totalBeds,
    bedIndex: input.bedIndex,
    groupId,
    plantingId: input.plantingId,
    category: input.category,
    bgColor: input.bgColor,
    textColor: input.textColor,
    feetNeeded: input.feetNeeded,
    structure: input.structure,
    feetUsed: input.feetUsed,
    bedCapacityFt: input.bedCapacityFt,
    harvestStartDate: input.harvestStartDate,
    plantingMethod: input.plantingMethod,
    lastModified: input.lastModified,
  };
}

/** Exported crop plan file format */
export interface CropPlanFile {
  /** File format version */
  formatVersion: 1;
  /** Data schema version for migrations */
  schemaVersion: number;
  /** When the file was exported */
  exportedAt: number;
  /** The plan data */
  plan: Plan;
}

/** Stash entry for safety saves before destructive operations */
export interface StashEntry {
  id: string;
  timestamp: number;
  reason: string;
  plan: Plan;
}

// ============================================
// Checkpoint Types (Named Saves)
// ============================================

/** User-created named checkpoint */
export interface Checkpoint {
  id: string;
  /** Which plan this checkpoint belongs to */
  planId: string;
  /** User-provided name */
  name: string;
  /** Optional description */
  description?: string;
  timestamp: number;
  /** Full plan state at checkpoint time */
  plan: Plan;
}

/** Unified history entry for display (combines checkpoints, auto-saves, stash) */
export interface HistoryEntry {
  id: string;
  type: 'checkpoint' | 'auto-save' | 'stash';
  /** Checkpoint name, or "Auto-save" / stash reason */
  name: string;
  timestamp: number;
  plan: Plan;
}
