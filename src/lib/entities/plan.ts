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
  plantingMethod?: 'DS' | 'TP' | 'PE';
  lastModified?: number;
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

  /** Bed definitions with individual lengths */
  beds?: Record<string, Bed>;

  /** Planting instances (one per planting decision) */
  plantings?: Planting[];

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
 * Get the ordered list of bed IDs for timeline display.
 * Derives from plan.beds, sorted by group then bed number.
 */
export function getResources(plan: Plan): string[] {
  if (!plan.beds) return [];

  return Object.keys(plan.beds).sort((a, b) => {
    const groupA = plan.beds![a].group;
    const groupB = plan.beds![b].group;
    if (groupA !== groupB) return groupA.localeCompare(groupB);

    const numA = parseInt(a.replace(/\D/g, '')) || 0;
    const numB = parseInt(b.replace(/\D/g, '')) || 0;
    return numA - numB;
  });
}

/**
 * Get bed groups for timeline display.
 * Derives from plan.beds, grouped by bed.group property.
 */
export function getGroups(plan: Plan): ResourceGroup[] {
  if (!plan.beds) return [];

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
