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
  /** Actual greenhouse seeding date (ISO date string) */
  greenhouseDate?: string;
  /** Actual transplant or direct seed date (ISO date string) */
  fieldDate?: string;
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

  /**
   * Market split for this planting - maps marketId to percentage (0-100).
   * If not set, falls back to CropConfig's defaultMarketSplit.
   */
  marketSplit?: import('./market').MarketSplit;

  // ---- Adjustments ----

  /** Overrides to default config timing */
  overrides?: PlantingOverrides;

  /** Actual dates for variance tracking */
  actuals?: PlantingActuals;

  /** User notes about this planting */
  notes?: string;

  // ---- Sequence Membership ----

  /**
   * ID of the sequence this planting belongs to (if any).
   * Sequences link multiple plantings temporally (succession planting).
   */
  sequenceId?: string;

  /**
   * Slot number in the sequence (sparse, not necessarily consecutive).
   * - Slot 0 = anchor (owns its own fieldStartDate)
   * - Slot > 0 = follower (date calculated from anchor + slot * offsetDays)
   * Slots can have gaps (e.g., 0, 1, 2, 5, 10) when plantings are removed.
   */
  sequenceSlot?: number;

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
  /** Optional: seed variety or mix reference */
  seedSource?: SeedSource;
  /** Optional: use config's default seed source */
  useDefaultSeedSource?: boolean;
  /** Optional: market split for this planting (falls back to config if not set) */
  marketSplit?: import('./market').MarketSplit;
  /** Optional: timing overrides */
  overrides?: PlantingOverrides;
  /** Optional: actual dates */
  actuals?: PlantingActuals;
  /** Optional: user notes */
  notes?: string;
  /** Optional: sequence ID (for succession plantings) */
  sequenceId?: string;
  /** Optional: slot number in sequence (0 = anchor, sparse allowed) */
  sequenceSlot?: number;
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
    seedSource: input.seedSource,
    useDefaultSeedSource: input.useDefaultSeedSource,
    marketSplit: input.marketSplit,
    overrides: input.overrides,
    actuals: input.actuals,
    notes: input.notes,
    sequenceId: input.sequenceId,
    sequenceSlot: input.sequenceSlot,
    lastModified: Date.now(),
  };
}

/**
 * Clone a planting with a new ID.
 * Use this for duplicating plantings within a plan.
 *
 * NOTE: By default, sequence fields (sequenceId, sequenceSlot) are NOT
 * copied. Pass them explicitly in overrides if needed for sequence operations.
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
    seedSource: source.seedSource,
    useDefaultSeedSource: source.useDefaultSeedSource,
    marketSplit: source.marketSplit,
    overrides: source.overrides,
    actuals: source.actuals,
    notes: source.notes,
    // NOTE: Do NOT copy sequence fields by default - they must be explicitly provided
    // sequenceId and sequenceSlot are intentionally omitted
    ...overrides,
  });
}
