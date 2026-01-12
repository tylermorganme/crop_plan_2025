/**
 * Plan Entity
 *
 * A self-contained crop plan with all data needed for rendering and calculations.
 * Plans own their beds, crop catalog, and plantings - no external dependencies.
 */

import type { Bed, BedGroup, ResourceGroup } from './bed';
import type { Planting } from './planting';
import type { CropConfig } from './crop-config';
import type { Variety } from './variety';
import type { SeedMix } from './seed-mix';
import type { Product } from './product';
import type { SeedOrder } from './seed-order';

// Re-export migration utilities for backwards compatibility
export { CURRENT_SCHEMA_VERSION, migratePlan } from '../migrations';

// =============================================================================
// TYPES
// =============================================================================

/** Metadata about a saved plan */
export interface PlanMetadata {
  /** Unique plan identifier */
  id: string;
  /** User-provided plan name */
  name: string;
  /** When the plan was created */
  createdAt: number;
  /** When the plan was last modified */
  lastModified: number;
  /** Optional description */
  description?: string;
  /** Target year for new plantings */
  year: number;
  /** Version number, incremented on export */
  version?: number;
  /** ID of plan this was copied from */
  parentPlanId?: string;
  /** Version of parent plan when copied */
  parentVersion?: number;
}

/** A single change entry for history/undo */
export interface PlanChange {
  id: string;
  timestamp: number;
  type: 'move' | 'date_change' | 'delete' | 'create' | 'batch' | 'edit';
  description: string;
  /** Affected group IDs (legacy name, refers to planting/group IDs) */
  groupIds: string[];
}

/**
 * TimelineCrop - Display format for timeline rendering (one entry per bed).
 * Computed at runtime from Planting[] via expandPlantingsToTimelineCrops().
 */
export interface TimelineCrop {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  resource: string;
  category?: string;
  bgColor?: string;
  textColor?: string;
  feetNeeded?: number;
  structure?: string;
  plantingId?: string;
  cropConfigId: string;
  totalBeds: number;
  bedIndex: number;
  groupId: string;
  feetUsed?: number;
  bedCapacityFt?: number;
  harvestStartDate?: string;
  plantingMethod?: 'direct-seed' | 'transplant' | 'perennial';
  lastModified?: number;
  /** Planting-level timing overrides (for editing in inspector) */
  overrides?: import('./planting').PlantingOverrides;
  /** User notes about this planting */
  notes?: string;
  /** Reference to the seed variety or mix used */
  seedSource?: import('./planting').SeedSource;
  /** Whether planting uses config's default seed source */
  useDefaultSeedSource?: boolean;
  /** Calculated seeds needed for this planting (based on CropConfig.seedsPerBed) */
  seedsNeeded?: number;
  /** Crop name (for filtering varieties/mixes in picker) */
  crop?: string;
}

/**
 * A complete, self-contained crop plan.
 */
export interface Plan {
  /** Unique plan identifier */
  id: string;

  /** Schema version for migrations */
  schemaVersion?: number;

  /** Plan metadata */
  metadata: PlanMetadata;

  /** Bed definitions keyed by UUID */
  beds?: Record<string, Bed>;

  /** Bed group definitions keyed by UUID */
  bedGroups?: Record<string, BedGroup>;

  /** Planting instances (one per planting decision) */
  plantings?: Planting[];

  /** Crop configurations (keyed by identifier) */
  cropCatalog?: Record<string, CropConfig>;

  /** Seed varieties (keyed by ID) */
  varieties?: Record<string, Variety>;

  /** Seed mixes (keyed by ID) */
  seedMixes?: Record<string, SeedMix>;

  /** Products for revenue calculation (keyed by ID) */
  products?: Record<string, Product>;

  /** Seed orders (keyed by ID) - tracks ordering decisions per variety */
  seedOrders?: Record<string, SeedOrder>;

  /** Change history for undo/redo */
  changeLog: PlanChange[];
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validation error with details about what's wrong.
 */
export class PlanValidationError extends Error {
  constructor(
    message: string,
    public readonly details: {
      plantingId?: string;
      configId?: string;
      bedId?: string;
      followsPlantingId?: string;
    }
  ) {
    super(message);
    this.name = 'PlanValidationError';
  }
}

/**
 * Check if a plan has the required data for display.
 */
export function isValidPlan(plan: Plan): boolean {
  return !!(plan.plantings && plan.beds);
}

/**
 * Validate a plan's internal references.
 *
 * Throws PlanValidationError if:
 * - A planting references a missing config
 * - A planting references a missing bed
 * - A planting's followsPlantingId references a missing planting
 *
 * Call this on plan load and before save to catch bugs early.
 */
export function validatePlan(plan: Plan): void {
  if (!plan.plantings || !plan.beds) {
    return; // Empty plan is valid
  }

  const plantingIds = new Set(plan.plantings.map(p => p.id));

  for (const planting of plan.plantings) {
    // Check config reference
    if (plan.cropCatalog && !plan.cropCatalog[planting.configId]) {
      throw new PlanValidationError(
        `Planting ${planting.id} references missing config ${planting.configId}`,
        { plantingId: planting.id, configId: planting.configId }
      );
    }

    // Check bed reference (if assigned)
    if (planting.startBed && !plan.beds[planting.startBed]) {
      throw new PlanValidationError(
        `Planting ${planting.id} references missing bed ${planting.startBed}`,
        { plantingId: planting.id, bedId: planting.startBed }
      );
    }

    // Check followsPlantingId reference
    if (planting.followsPlantingId && !plantingIds.has(planting.followsPlantingId)) {
      throw new PlanValidationError(
        `Planting ${planting.id} follows missing planting ${planting.followsPlantingId}`,
        { plantingId: planting.id, followsPlantingId: planting.followsPlantingId }
      );
    }
  }
}

// =============================================================================
// DERIVED DATA
// =============================================================================

/**
 * Get the ordered list of bed names for timeline display.
 * Uses displayOrder from beds and groups for stable ordering.
 * Returns bed.name (display name like "A1") not bed.id (UUID).
 */
export function getResources(plan: Plan): string[] {
  if (!plan.beds || !plan.bedGroups) return [];

  return Object.values(plan.beds)
    .sort((a, b) => {
      const groupA = plan.bedGroups![a.groupId];
      const groupB = plan.bedGroups![b.groupId];
      // Sort by group displayOrder first
      if (groupA?.displayOrder !== groupB?.displayOrder) {
        return (groupA?.displayOrder ?? 0) - (groupB?.displayOrder ?? 0);
      }
      // Then by bed displayOrder within group
      return a.displayOrder - b.displayOrder;
    })
    .map(bed => bed.name);
}

/**
 * Get bed groups for timeline display.
 * Uses displayOrder for stable ordering.
 * Returns bed.name (display name) not bed.id (UUID).
 */
export function getGroups(plan: Plan): ResourceGroup[] {
  if (!plan.beds || !plan.bedGroups) return [];

  // Group beds by groupId
  const groupMap = new Map<string, Bed[]>();

  for (const bed of Object.values(plan.beds)) {
    if (!groupMap.has(bed.groupId)) {
      groupMap.set(bed.groupId, []);
    }
    groupMap.get(bed.groupId)!.push(bed);
  }

  // Sort groups by displayOrder, then beds within each group
  return Array.from(groupMap.entries())
    .sort(([groupIdA], [groupIdB]) => {
      const groupA = plan.bedGroups![groupIdA];
      const groupB = plan.bedGroups![groupIdB];
      return (groupA?.displayOrder ?? 0) - (groupB?.displayOrder ?? 0);
    })
    .map(([groupId, bedsInGroup]) => ({
      name: plan.bedGroups![groupId]?.name ?? null,
      beds: bedsInGroup
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map(bed => bed.name),
    }));
}

// =============================================================================
// EXPORT/IMPORT
// =============================================================================

/** Exported plan file format */
export interface PlanFile {
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

/** Unified history entry for display */
export interface HistoryEntry {
  id: string;
  type: 'checkpoint' | 'auto-save' | 'stash';
  name: string;
  timestamp: number;
  plan: Plan;
}
