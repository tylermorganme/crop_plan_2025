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
 * Overrides to default spec values for this specific planting.
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

  /** Reference to PlantingSpec.id in plan's specs */
  specId: string;

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
   * When true, use the PlantingSpec's defaultSeedSource instead of seedSource.
   * This allows the planting to automatically follow spec updates.
   */
  useDefaultSeedSource?: boolean;

  // ---- Market Split ----

  /**
   * Market split for this planting - maps marketId to percentage (0-100).
   * If not set, falls back to PlantingSpec's defaultMarketSplit.
   */
  marketSplit?: import('./market').MarketSplit;

  // ---- Adjustments ----

  /**
   * When true, use GDD-based timing for field days instead of static DTM.
   * GDD timing adjusts harvest dates based on accumulated heat units,
   * accounting for seasonal temperature variations.
   */
  useGddTiming?: boolean;

  /**
   * Yield multiplier for this planting (default 1.0).
   * Use to adjust expected yield up or down, e.g.:
   * - 0.5 for u-pick beds where only half gets harvested
   * - 1.2 for a particularly productive variety
   */
  yieldFactor?: number;

  /** Overrides to default spec timing */
  overrides?: PlantingOverrides;

  /** Actual dates for variance tracking */
  actuals?: PlantingActuals;

  /** User notes about this planting */
  notes?: string;

  /** Arbitrary user tags for grouping/filtering */
  tags?: string[];

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
  /** Reference to planting spec ID */
  specId: string;
  /** When crop enters field (ISO date string) */
  fieldStartDate: string;
  /** Starting bed ID, or null if unassigned */
  startBed: string | null;
  /** Total feet needed */
  bedFeet: number;
  /** Optional: seed variety or mix reference */
  seedSource?: SeedSource;
  /** Optional: use spec's default seed source */
  useDefaultSeedSource?: boolean;
  /** Optional: market split for this planting (falls back to spec if not set) */
  marketSplit?: import('./market').MarketSplit;
  /** Optional: use GDD-based timing instead of static DTM */
  useGddTiming?: boolean;
  /** Optional: yield multiplier (default 1.0) */
  yieldFactor?: number;
  /** Optional: timing overrides */
  overrides?: PlantingOverrides;
  /** Optional: actual dates */
  actuals?: PlantingActuals;
  /** Optional: user notes */
  notes?: string;
  /** Optional: user tags for grouping/filtering */
  tags?: string[];
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
    specId: input.specId,
    fieldStartDate: input.fieldStartDate,
    startBed: input.startBed,
    bedFeet: input.bedFeet,
    seedSource: input.seedSource,
    useDefaultSeedSource: input.useDefaultSeedSource,
    marketSplit: input.marketSplit,
    useGddTiming: input.useGddTiming ?? true,
    yieldFactor: input.yieldFactor,
    overrides: input.overrides,
    actuals: input.actuals,
    notes: input.notes,
    tags: input.tags,
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
    specId: source.specId,
    fieldStartDate: source.fieldStartDate,
    startBed: overrides?.startBed !== undefined ? overrides.startBed : source.startBed,
    bedFeet: source.bedFeet,
    // Deep-copy object fields to avoid shared references between original and clone
    seedSource: source.seedSource ? { ...source.seedSource } : undefined,
    useDefaultSeedSource: source.useDefaultSeedSource,
    marketSplit: source.marketSplit ? { ...source.marketSplit } : undefined,
    useGddTiming: source.useGddTiming,
    yieldFactor: source.yieldFactor,
    overrides: source.overrides ? { ...source.overrides } : undefined,
    actuals: source.actuals ? { ...source.actuals } : undefined,
    notes: source.notes,
    tags: source.tags ? [...source.tags] : undefined,
    // NOTE: Do NOT copy sequence fields by default - they must be explicitly provided
    // sequenceId and sequenceSlot are intentionally omitted
    ...overrides,
  });
}

/**
 * Resolve the effective seed source for a planting.
 *
 * Priority: explicit seedSource > spec defaultSeedSource (unless opted out).
 * This is the single source of truth for seed source resolution — all views
 * and calculations should use this instead of inline logic.
 */
export function getEffectiveSeedSource(
  planting: Pick<Planting, 'seedSource' | 'useDefaultSeedSource'>,
  specDefault: SeedSource | undefined,
): SeedSource | undefined {
  return planting.seedSource
    ?? (planting.useDefaultSeedSource !== false ? specDefault : undefined);
}

/**
 * Ensure a planting has useDefaultSeedSource set correctly.
 *
 * If the planting has no explicit seedSource and useDefaultSeedSource is
 * undefined, check the spec for a defaultSeedSource and opt in automatically.
 * This is the single source of truth for this defaulting logic — all code
 * paths that create plantings should call this.
 *
 * Mutates the planting in place and returns it for chaining.
 */
export function applyDefaultSeedSource(
  planting: Planting,
  specDefault: SeedSource | undefined,
): Planting {
  if (!planting.seedSource && planting.useDefaultSeedSource === undefined && specDefault) {
    planting.useDefaultSeedSource = true;
  }
  return planting;
}
