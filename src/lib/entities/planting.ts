/**
 * Planting Entity
 *
 * Represents a single planting instance in a plan.
 * One Planting = one planting decision, regardless of how many beds it spans.
 * Bed span is calculated at render time from bedFeet + bed lengths.
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Overrides to default config values for this specific planting.
 * These are additive adjustments, not absolute values.
 */
export interface PlantingOverrides {
  /** Additional days to extend harvest window */
  additionalDaysOfHarvest?: number;
  /** Additional days to add to DTM (delays harvest) */
  additionalDaysInField?: number;
  /** Additional days in greenhouse (delays field date) */
  additionalDaysInCells?: number;
}

/**
 * Actual dates for tracking variance from plan.
 * Used for in-season tracking against planned dates.
 */
export interface PlantingActuals {
  /** Actual greenhouse seeding date */
  greenhouseDate?: string;
  /** Actual transplant or direct seed date */
  tpOrDsDate?: string;
  /** Actual first harvest date */
  beginningOfHarvest?: string;
  /** Actual last harvest date */
  endOfHarvest?: string;
  /** Whether the planting failed (disease, pests, etc.) */
  failed?: boolean;
}

/**
 * Reference to a specific seed variety or mix.
 * Links a planting to the actual seeds used.
 */
export interface SeedSource {
  /** Whether this is a single variety or a mix */
  type: 'variety' | 'mix';
  /** Reference to Variety.id or SeedMix.id */
  id: string;
}

/**
 * A planting instance in a plan.
 *
 * Design: Store one Planting per planting decision.
 * The bed span (which beds it occupies) is calculated at render time
 * from bedFeet + starting bed + bed lengths.
 */
export interface Planting {
  /** Unique planting identifier (e.g., "ARU001", "P1") */
  id: string;

  /** Reference to CropConfig.id in plan's cropCatalog */
  configId: string;

  // ---- Scheduling ----

  /** When crop enters field (ISO date string) */
  fieldStartDate: string;

  /** Reference to another Planting.id for succession scheduling */
  followsPlantingId?: string;

  /** Days after followed planting ends before this one starts */
  followOffset?: number;

  // ---- Bed Assignment ----

  /** Starting bed ID, or null if unassigned */
  startBed: string | null;

  /** Total feet needed for this planting */
  bedFeet: number;

  // ---- Seed Source ----

  /** Reference to the actual seed variety or mix used */
  seedSource?: SeedSource;

  /**
   * When true, use the CropConfig's defaultSeedSource instead of seedSource.
   * This allows the planting to automatically follow config updates.
   */
  useDefaultSeedSource?: boolean;

  // ---- Market Split ----

  /** Market split for this planting - maps marketId to percentage (0-100) */
  marketSplit?: import('./market').MarketSplit;

  /**
   * When true, use the CropConfig's defaultMarketSplit instead of marketSplit.
   * This allows the planting to automatically follow config updates.
   * Defaults to true if not specified.
   */
  useDefaultMarketSplit?: boolean;

  // ---- Adjustments ----

  /** Overrides to default config timing */
  overrides?: PlantingOverrides;

  /** Actual dates for variance tracking */
  actuals?: PlantingActuals;

  /** User notes about this planting */
  notes?: string;

  // ---- Metadata ----

  /** Timestamp of last modification */
  lastModified: number;
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

// Simple counter for generating unique IDs within a session
let nextPlantingId = 1;

/**
 * Generate a unique planting ID.
 * Format: P{sequential number} e.g., P1, P2, P3...
 */
export function generatePlantingId(): string {
  return `P${nextPlantingId++}`;
}

/**
 * Initialize the ID counter based on existing plantings.
 * Call this when loading a plan to avoid ID collisions.
 */
export function initializePlantingIdCounter(existingIds: string[]): void {
  let maxId = 0;
  for (const id of existingIds) {
    const match = id.match(/^P(\d+)$/);
    if (match) {
      maxId = Math.max(maxId, parseInt(match[1], 10));
    }
  }
  nextPlantingId = maxId + 1;
}

/**
 * Input for creating a new Planting.
 */
export interface CreatePlantingInput {
  /** Optional ID (generated if not provided) */
  id?: string;
  /** Reference to crop config identifier */
  configId: string;
  /** When crop enters field (ISO date string) */
  fieldStartDate: string;
  /** Starting bed ID, or null if unassigned */
  startBed: string | null;
  /** Total feet needed */
  bedFeet: number;
  /** Optional: planting this follows */
  followsPlantingId?: string;
  /** Optional: days after followed crop */
  followOffset?: number;
  /** Optional: seed variety or mix reference */
  seedSource?: SeedSource;
  /** Optional: use config's default seed source */
  useDefaultSeedSource?: boolean;
  /** Optional: market split for this planting */
  marketSplit?: import('./market').MarketSplit;
  /** Optional: use config's default market split */
  useDefaultMarketSplit?: boolean;
  /** Optional: timing overrides */
  overrides?: PlantingOverrides;
  /** Optional: actual dates */
  actuals?: PlantingActuals;
  /** Optional: user notes */
  notes?: string;
}

/**
 * Factory function for creating Planting objects.
 */
export function createPlanting(input: CreatePlantingInput): Planting {
  return {
    id: input.id ?? generatePlantingId(),
    configId: input.configId,
    fieldStartDate: input.fieldStartDate,
    startBed: input.startBed,
    bedFeet: input.bedFeet,
    followsPlantingId: input.followsPlantingId,
    followOffset: input.followOffset,
    seedSource: input.seedSource,
    useDefaultSeedSource: input.useDefaultSeedSource,
    marketSplit: input.marketSplit,
    useDefaultMarketSplit: input.useDefaultMarketSplit,
    overrides: input.overrides,
    actuals: input.actuals,
    notes: input.notes,
    lastModified: Date.now(),
  };
}

/**
 * Clone a planting with a new ID.
 * Use this for duplicating plantings within a plan.
 */
export function clonePlanting(
  source: Planting,
  overrides?: Partial<CreatePlantingInput>
): Planting {
  return createPlanting({
    configId: source.configId,
    fieldStartDate: source.fieldStartDate,
    startBed: overrides?.startBed !== undefined ? overrides.startBed : source.startBed,
    bedFeet: source.bedFeet,
    followsPlantingId: source.followsPlantingId,
    followOffset: source.followOffset,
    seedSource: source.seedSource,
    useDefaultSeedSource: source.useDefaultSeedSource,
    marketSplit: source.marketSplit,
    useDefaultMarketSplit: source.useDefaultMarketSplit,
    overrides: source.overrides,
    actuals: source.actuals,
    notes: source.notes,
    ...overrides,
  });
}
