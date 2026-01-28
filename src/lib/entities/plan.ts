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
import type { Market } from './market';
import type { PlantingSequence } from './planting-sequence';
import type { Crop } from './crop';

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
  /** IANA timezone identifier (e.g., "America/Los_Angeles"). Defaults to "America/Los_Angeles" */
  timezone?: string;
  /** Last frost date for the growing season (MM-DD format, e.g., "04-01"). Used for scheduling calculations. */
  lastFrostDate?: string;
  /** Location for GDD (Growing Degree Days) calculations */
  location?: {
    lat: number;
    lon: number;
    name?: string;
  };
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
 * Configuration for crop box display in timeline.
 * Uses token-based templates for header and description lines.
 *
 * Available tokens:
 * - {name} - Crop name
 * - {configId} - Config identifier
 * - {category} - Category
 * - {startDate} - Field start date (formatted)
 * - {endDate} - End date (formatted)
 * - {harvestDate} - Harvest start date (formatted)
 * - {feet} - Total feet needed
 * - {revenue} - Calculated revenue
 * - {method} - Planting method (DS/TP/PE)
 * - {bed} - Current bed name
 * - {beds} - Bed span (e.g., "1/3")
 * - {seq} - Sequence slot (e.g., "S2")
 */
export interface CropBoxDisplayConfig {
  /** Template for the header line. Default: "{name}" */
  headerTemplate: string;
  /** Template for the description line. Default: "{startDate} - {endDate}" */
  descriptionTemplate: string;
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
  /**
   * Total bed-feet needed for this planting.
   * REQUIRED - derived from Planting.bedFeet. This is the source of truth for
   * planting size in all timeline calculations (span, revenue, yield, etc.).
   *
   * If you see `|| 50` fallbacks in code that uses this field, that's a bug -
   * feetNeeded should always be set when the TimelineCrop is created.
   */
  feetNeeded: number;
  structure?: string;
  /** Growing structure with proper typing for display */
  growingStructure?: 'field' | 'greenhouse' | 'high-tunnel';
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
  /** Crop entity ID for stable color lookup */
  cropId?: string;
  /** Actuals tracking data (actual dates, failed status) */
  actuals?: import('./planting').PlantingActuals;
  /** Sequence ID if planting is part of a succession sequence */
  sequenceId?: string;
  /** Slot number in sequence (0 = anchor, sparse allowed for followers) */
  sequenceSlot?: number;
  /** Whether this planting is locked due to actual dates being set */
  isLocked?: boolean;
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

  /** Crop definitions with colors (keyed by ID) */
  crops?: Record<string, Crop>;

  /** Seed orders (keyed by ID) - tracks ordering decisions per variety */
  seedOrders?: Record<string, SeedOrder>;

  /** Markets for revenue split (keyed by ID) */
  markets?: Record<string, Market>;

  /** Planting sequences for succession planting (keyed by ID) */
  sequences?: Record<string, PlantingSequence>;

  /** Crop box display configuration for timeline */
  cropBoxDisplay?: CropBoxDisplayConfig;

  /** Change history for undo/redo */
  changeLog: PlanChange[];

  /** Optional notes about this plan */
  notes?: string;
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
 *
 * Call this on plan load and before save to catch bugs early.
 */
export function validatePlan(plan: Plan): void {
  if (!plan.plantings || !plan.beds) {
    return; // Empty plan is valid
  }

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
