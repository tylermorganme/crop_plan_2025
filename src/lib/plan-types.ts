/**
 * Plan Data Types
 *
 * Re-exports canonical types from entities/.
 * Legacy helpers kept for backward compatibility.
 */

// =============================================================================
// CANONICAL TYPES (from entities)
// =============================================================================

export type {
  PlanMetadata,
  PlanChange,
  Plan,
  PlanFile,
  StashEntry,
  Checkpoint,
  HistoryEntry,
  TimelineCrop,
} from './entities/plan';

export {
  CURRENT_SCHEMA_VERSION,
  PlanValidationError,
  validatePlan,
  isValidPlan,
  getResources,
  getGroups,
  migratePlan,
} from './entities/plan';

export type { Bed, BedGroup, ResourceGroup, BedsFromTemplateResult } from './entities/bed';
export {
  ROW_LENGTHS,
  getBedGroup,
  getBedNumber,
  getBedLength,
  getBedLengthFromId,
  generateBedUuid,
  createBedsFromTemplate,
  deriveResources,
  deriveGroups,
} from './entities/bed';

export type { Planting, PlantingOverrides, PlantingActuals, CreatePlantingInput } from './entities/planting';
export {
  generatePlantingId,
  initializePlantingIdCounter,
  createPlanting,
} from './entities/planting';

export type { CropConfig, CropCalculated, TrayStage, PlantingMethod, ProductYield } from './entities/crop-config';
export {
  calculateDaysInCells,
  calculateSeedToHarvest,
  calculatePlantingMethod,
  calculateHarvestWindow,
  calculateCropFields,
  getTimelineConfig,
  // Product-aware calculations
  getPrimarySeedToHarvest,
  calculateAggregateHarvestWindow,
  calculateProductSeedToHarvest,
  calculateProductHarvestWindow,
  calculateProductEndDay,
  calculateCropEndDay,
} from './entities/crop-config';

export type { SeedOrder, ProductUnit, CreateSeedOrderInput } from './entities/seed-order';
export {
  getSeedOrderId,
  getVarietyIdFromOrderId,
  createSeedOrder,
  cloneSeedOrder,
  cloneSeedOrders,
  getOrderedAmount,
  getOrderCost,
  formatOrderAmount,
  formatOrderCost,
} from './entities/seed-order';

export type { Variety, DensityUnit, CreateVarietyInput } from './entities/variety';
export {
  getVarietyId,
  getVarietyContentKey,
  getVarietyKey,
  createVariety,
  cloneVariety,
  cloneVarieties,
  convertMass,
  getSeedsPerGram,
  calculateWeightForSeeds,
  calculateSeedsFromWeight,
  formatDensity,
} from './entities/variety';

// =============================================================================
// PLAN STATE (for zustand store)
// =============================================================================

import type { Plan, TimelineCrop } from './entities/plan';

/** Info about each bed in a span, including how much is used */
export interface BedSpanInfo {
  bed: string;
  feetUsed: number;
  bedCapacityFt: number;
}

/** State for the plan store */
export interface PlanState {
  /** Current plan being edited */
  currentPlan: Plan | null;
  /** Past plan states for undo (full Plan snapshots) */
  past: Plan[];
  /** Future plan states for redo (full Plan snapshots) */
  future: Plan[];
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
  createNewPlan: (name: string, plantings?: import('./entities/planting').Planting[]) => void;
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

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Generate a deterministic ID for a timeline crop entry.
 * Format: {plantingId}_bed{bedIndex} or {plantingId}_unassigned
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

/** Required fields for creating a TimelineCrop */
export interface CreateTimelineCropInput {
  plantingId: string;
  cropConfigId: string;
  name: string;
  startDate: string;
  endDate: string;
  resource: string;
  totalBeds: number;
  bedIndex: number;
  groupId?: string;
  category?: string;
  bgColor?: string;
  textColor?: string;
  feetNeeded?: number;
  structure?: string;
  feetUsed?: number;
  bedCapacityFt?: number;
  harvestStartDate?: string;
  plantingMethod?: 'direct-seed' | 'transplant' | 'perennial';
  lastModified?: number;
}

/**
 * Factory function for creating TimelineCrop objects.
 */
export function createTimelineCrop(input: CreateTimelineCropInput): TimelineCrop {
  const groupId = input.groupId ?? input.plantingId;
  const id = input.resource
    ? generateCropId(groupId, input.bedIndex - 1)
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
  formatVersion: 1;
  schemaVersion: number;
  exportedAt: number;
  plan: Plan;
}
