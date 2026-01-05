/**
 * Plan Entity
 *
 * A self-contained crop plan with all data needed for rendering and calculations.
 * Plans own their beds, crop catalog, and plantings - no external dependencies.
 */

import type { Bed, BedGroup, ResourceGroup } from './bed';
import type { Planting } from './planting';
import type { CropConfig } from './crop-config';

// =============================================================================
// TYPES
// =============================================================================

/** Current schema version for data migrations */
export const CURRENT_SCHEMA_VERSION = 3;

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
// MIGRATIONS
// =============================================================================

/**
 * Legacy bed format (schema v2 and earlier).
 * Used for migration purposes only.
 */
interface LegacyBed {
  id: string;
  lengthFt: number;
  group: string;
}

/**
 * Migrate a plan from an older schema version to the current version.
 * This handles:
 * - v2 -> v3: Convert beds from name-based IDs to UUIDs, create BedGroups
 */
export function migratePlan(plan: Plan): Plan {
  const currentVersion = plan.schemaVersion ?? 1;

  if (currentVersion >= CURRENT_SCHEMA_VERSION) {
    return plan; // Already up to date
  }

  let migrated = { ...plan };

  // v2 -> v3: Bed UUID migration
  if (currentVersion < 3) {
    migrated = migrateToV3(migrated);
  }

  migrated.schemaVersion = CURRENT_SCHEMA_VERSION;
  return migrated;
}

/**
 * Migrate from v2 to v3:
 * - Convert bed IDs from names (e.g., "A1") to UUIDs
 * - Create BedGroup entities from implicit groups
 * - Update planting.startBed references to use UUIDs
 */
function migrateToV3(plan: Plan): Plan {
  if (!plan.beds) {
    return plan;
  }

  // Cast old beds to legacy format
  const legacyBeds = plan.beds as unknown as Record<string, LegacyBed>;

  // Build mapping from old bed names to new UUIDs
  const nameToUuid: Record<string, string> = {};
  const newBeds: Record<string, Bed> = {};
  const newGroups: Record<string, BedGroup> = {};

  // Group legacy beds by their group property
  const groupedBeds = new Map<string, LegacyBed[]>();
  for (const bed of Object.values(legacyBeds)) {
    if (!groupedBeds.has(bed.group)) {
      groupedBeds.set(bed.group, []);
    }
    groupedBeds.get(bed.group)!.push(bed);
  }

  // Sort group names for stable ordering
  const sortedGroupNames = Array.from(groupedBeds.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  // Create BedGroups and migrate beds
  for (let groupIndex = 0; groupIndex < sortedGroupNames.length; groupIndex++) {
    const groupName = sortedGroupNames[groupIndex];
    const groupId = crypto.randomUUID();

    // Create the group
    newGroups[groupId] = {
      id: groupId,
      name: `Row ${groupName}`,
      displayOrder: groupIndex,
    };

    // Sort beds within group by number
    const bedsInGroup = groupedBeds.get(groupName)!;
    bedsInGroup.sort((a, b) => {
      const numA = parseInt(a.id.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.id.replace(/\D/g, '')) || 0;
      return numA - numB;
    });

    // Create new beds with UUIDs
    for (let bedIndex = 0; bedIndex < bedsInGroup.length; bedIndex++) {
      const legacyBed = bedsInGroup[bedIndex];
      const bedId = crypto.randomUUID();

      nameToUuid[legacyBed.id] = bedId;

      newBeds[bedId] = {
        id: bedId,
        name: legacyBed.id, // Old ID becomes the display name
        lengthFt: legacyBed.lengthFt,
        groupId,
        displayOrder: bedIndex,
      };
    }
  }

  // Update planting references
  const migratedPlantings = plan.plantings?.map(planting => {
    if (planting.startBed && nameToUuid[planting.startBed]) {
      return {
        ...planting,
        startBed: nameToUuid[planting.startBed],
      };
    }
    return planting;
  });

  return {
    ...plan,
    beds: newBeds,
    bedGroups: newGroups,
    plantings: migratedPlantings,
  };
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
