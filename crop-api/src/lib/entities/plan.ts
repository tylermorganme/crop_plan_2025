/**
 * Plan Entity
 *
 * A self-contained crop plan with all data needed for rendering and calculations.
 * Plans own their beds, crop catalog, and plantings - no external dependencies.
 */

import type { Bed, ResourceGroup } from './bed';
import type { Planting } from './planting';
import type { CropConfig } from './crop-config';

// =============================================================================
// TYPES
// =============================================================================

/** Current schema version for data migrations */
export const CURRENT_SCHEMA_VERSION = 2;

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
  type: 'move' | 'date_change' | 'delete' | 'create' | 'batch';
  description: string;
  /** Affected group IDs (legacy name, refers to planting/group IDs) */
  groupIds: string[];
}

/**
 * TimelineCrop - Legacy format for crop entries (one per bed).
 * @deprecated Use Planting instead. Kept for migration compatibility.
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
  plantingMethod?: 'DS' | 'TP' | 'PE';
  lastModified?: number;
}

/**
 * A complete, self-contained crop plan.
 *
 * TRANSITIONAL: Supports both old (crops) and new (plantings) formats.
 * - Old format: crops[], resources[], groups[]
 * - New format: plantings[], beds{}
 *
 * During migration, plans may have both. New plans have only new format.
 */
export interface Plan {
  /** Unique plan identifier */
  id: string;

  /** Schema version for migrations (1 = legacy, 2 = new format) */
  schemaVersion?: number;

  /** Plan metadata */
  metadata: PlanMetadata;

  // ---- Legacy Format (v1) ----

  /** @deprecated Use plantings instead */
  crops?: TimelineCrop[];

  /** @deprecated Use beds instead - Available resources (bed names) */
  resources?: string[];

  /** @deprecated Use beds instead - Resource grouping */
  groups?: ResourceGroup[];

  // ---- New Format (v2) ----

  /** Bed definitions with individual lengths */
  beds?: Record<string, Bed>;

  /** Planting instances (one per planting decision) */
  plantings?: Planting[];

  // ---- Required in both formats ----

  /** Crop configurations (keyed by identifier) */
  cropCatalog?: Record<string, CropConfig>;

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
 * Check if a plan is in the new format (v2 with plantings).
 */
export function isNewFormatPlan(plan: Plan): boolean {
  return !!(plan.plantings && plan.beds);
}

/**
 * Check if a plan is in the legacy format (v1 with crops).
 */
export function isLegacyPlan(plan: Plan): boolean {
  return !!(plan.crops && !plan.plantings);
}

/**
 * Validate a plan's internal references.
 *
 * For new format plans (v2), throws PlanValidationError if:
 * - A planting references a missing config
 * - A planting references a missing bed
 * - A planting's followsPlantingId references a missing planting
 *
 * For legacy format plans (v1), validates:
 * - Each crop has a valid cropConfigId (if cropCatalog exists)
 *
 * Call this on plan load and before save to catch bugs early.
 */
export function validatePlan(plan: Plan): void {
  // New format validation (v2)
  if (plan.plantings && plan.beds) {
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
    return;
  }

  // Legacy format validation (v1)
  if (plan.crops) {
    for (const crop of plan.crops) {
      // Check config reference (if catalog exists)
      if (plan.cropCatalog && !plan.cropCatalog[crop.cropConfigId]) {
        throw new PlanValidationError(
          `Crop ${crop.groupId} references missing config ${crop.cropConfigId}`,
          { plantingId: crop.groupId, configId: crop.cropConfigId }
        );
      }
    }
    return;
  }

  // Empty plan is valid
}

// =============================================================================
// DERIVED DATA
// =============================================================================

/**
 * Get the ordered list of bed IDs for timeline display.
 * Uses plan.beds if available (new format), otherwise plan.resources (legacy).
 */
export function getResources(plan: Plan): string[] {
  // New format: derive from beds
  if (plan.beds) {
    return Object.keys(plan.beds).sort((a, b) => {
      const groupA = plan.beds![a].group;
      const groupB = plan.beds![b].group;
      if (groupA !== groupB) return groupA.localeCompare(groupB);

      const numA = parseInt(a.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.replace(/\D/g, '')) || 0;
      return numA - numB;
    });
  }

  // Legacy format: use stored resources
  return plan.resources || [];
}

/**
 * Get bed groups for timeline display.
 * Uses plan.beds if available (new format), otherwise plan.groups (legacy).
 */
export function getGroups(plan: Plan): ResourceGroup[] {
  // New format: derive from beds
  if (plan.beds) {
    const groupMap = new Map<string, string[]>();

    for (const bed of Object.values(plan.beds)) {
      if (!groupMap.has(bed.group)) {
        groupMap.set(bed.group, []);
      }
      groupMap.get(bed.group)!.push(bed.id);
    }

    return Array.from(groupMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, bedIds]) => ({
        name: `Row ${group}`,
        beds: bedIds.sort((a, b) => {
          const numA = parseInt(a.replace(/\D/g, '')) || 0;
          const numB = parseInt(b.replace(/\D/g, '')) || 0;
          return numA - numB;
        }),
      }));
  }

  // Legacy format: use stored groups
  return plan.groups || [];
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
