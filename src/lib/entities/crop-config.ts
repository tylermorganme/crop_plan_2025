/**
 * Crop Config Entity
 *
 * Represents a planting configuration - how a specific crop variety is grown.
 * Includes timing calculations for deriving harvest dates from config data.
 *
 * KEY CONCEPT: normalMethod vs plantingMethod
 *
 * normalMethod (input) = How DTM is defined for this crop variety:
 *   - "DS": DTM is from direct seeding in field (seed packet says "60 days from sowing")
 *   - "TP": DTM is from transplant in field (seed packet says "60 days from transplant")
 *   - "X":  DTM is total time from seeding a TRANSPLANT to harvest (from growers/books,
 *          includes greenhouse time and transplant shock in the total)
 *
 * plantingMethod (calculated) = How you're actually growing it:
 *   - "DS": Direct seeding (no tray stages)
 *   - "TP": Transplanting (has tray stages)
 *   - "PE": Perennial (persists across seasons)
 *
 * These are independent! A crop with normalMethod "DS" can still be grown as
 * transplants if you add tray stages.
 */

// =============================================================================
// TYPES
// =============================================================================

/** A single tray stage in the greenhouse */
export interface TrayStage {
  /** Days spent in this tray */
  days: number;
  /** Number of cells per tray (e.g., 128, 72, 50) */
  cellsPerTray?: number;
}

/** Planting method - how the crop is actually grown */
export type PlantingMethod = 'DS' | 'TP' | 'PE';

/**
 * Crop configuration - what we store in crops.json and plan.cropCatalog.
 *
 * This is the "planting recipe" - all the data needed to calculate
 * timing and display for a specific way of growing a crop variety.
 */
export interface CropConfig {
  /** Unique identifier (e.g., "arugula-baby-leaf-field-ds-sp") */
  id: string;

  /** Human-readable identifier matching legacy data */
  identifier: string;

  /** Crop family (e.g., "Arugula", "Tomato") */
  crop: string;

  /** Variant/variety name */
  variant?: string;

  /** Product type (e.g., "Baby Leaf", "Slicing") */
  product?: string;

  /** Category for color coding (e.g., "Green", "Brassica") */
  category?: string;

  /** Growing structure: "Field", "GH", "HT" */
  growingStructure?: string;

  /** How DTM is measured: DS, TP, or X */
  normalMethod?: 'DS' | 'TP' | 'X';

  // ---- Timing Inputs ----

  /** Days to maturity (meaning depends on normalMethod) */
  dtm?: number;

  /** Days from seeding to germination */
  daysToGermination?: number;

  /** Base harvest window in days (before adjustments) */
  harvestWindow?: number;

  /** Greenhouse tray stages (empty = direct seeded) */
  trayStages?: TrayStage[];

  // ---- Status ----

  /** Whether this config is deprecated */
  deprecated?: boolean;

  /** Whether crop is perennial (persists across seasons) */
  perennial?: boolean;

  // ---- Advanced Timing ----

  /**
   * Assumed transplant age (days) when DTM was measured for TP crops.
   * Default: 30 days. Override per-crop if known.
   */
  assumedTransplantDays?: number;

  /** Days between harvests (for multiple harvest crops) */
  daysBetweenHarvest?: number;

  /** Number of harvests over the production period */
  numberOfHarvests?: number;

  /** Yield per harvest in yieldUnit */
  yieldPerHarvest?: number;

  /** Unit of measure for yield (lb, bunch, head, etc.) */
  yieldUnit?: string;

  /**
   * Days crop occupies bed after last harvest (e.g., tuber curing).
   * Added to harvest window calculation. Default: 0.
   */
  postHarvestFieldDays?: number;

  /**
   * Buffer days for initial harvest window.
   * Accounts for plants not maturing at exactly the same time.
   * Default: 7 days.
   */
  harvestBufferDays?: number;

  // ---- Scheduling ----

  /**
   * Target field date as month-day (format: "MM-DD") for default scheduling.
   * When adding a planting, this is combined with the plan year to set fieldStartDate.
   */
  targetFieldDate?: string;
}

/** Calculated crop values (derived at runtime) */
export interface CropCalculated {
  /** Days spent in greenhouse trays (sum of all tray stage days) */
  daysInCells: number;
  /** Seed To Harvest - total days from seeding to first harvest */
  sth: number;
  /** How the crop is actually grown: DS, TP, or PE */
  plantingMethod: PlantingMethod;
  /** Duration of harvest period in days */
  harvestWindow: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Transplant shock / Direct seed establishment compensation (days).
 *
 * Johnny's Seeds reference: "subtract about 14 days for days to maturity
 * from transplant" when converting TP timing to DS timing.
 */
const PLANTING_METHOD_DELTA_DAYS = 14;

/**
 * Default assumed transplant age (days) for TP crops.
 * ~4 weeks, a rough middle-ground assumption.
 */
const DEFAULT_ASSUMED_TRANSPLANT_DAYS = 30;

// =============================================================================
// CALCULATIONS
// =============================================================================

/**
 * Calculate Days in Cells from tray stages.
 * This is the total time spent in greenhouse before transplanting.
 */
export function calculateDaysInCells(crop: CropConfig): number {
  if (!crop.trayStages || crop.trayStages.length === 0) {
    return 0;
  }
  return crop.trayStages.reduce((sum, stage) => sum + (stage.days ?? 0), 0);
}

/**
 * Calculate STH (Seed To Harvest) based on normalMethod.
 *
 * Converts the user-entered DTM into total time from seeding to harvest,
 * accounting for how DTM was measured vs how the crop is being grown.
 */
export function calculateSTH(crop: CropConfig, daysInCells: number): number {
  const method = crop.normalMethod ?? 'X';
  const dtm = crop.dtm ?? 0;
  const dtg = crop.daysToGermination ?? 0;
  const isTransplant = daysInCells > 0;

  switch (method) {
    case 'DS':
      // DTM is measured from emergence (germination)
      // DS direct: dtg + dtm
      // DS transplant: dtg + dtm + shock
      return dtg + dtm + (isTransplant ? PLANTING_METHOD_DELTA_DAYS : 0);

    case 'TP': {
      // DTM is measured from transplant date (in-field time only)
      // TP transplant: daysInCells + dtm
      // TP direct: assumedDays + dtm - delta
      const assumedDays = crop.assumedTransplantDays ?? DEFAULT_ASSUMED_TRANSPLANT_DAYS;
      return isTransplant
        ? daysInCells + dtm
        : assumedDays + dtm - PLANTING_METHOD_DELTA_DAYS;
    }

    case 'X':
      // DTM is total time from seeding a transplant to harvest
      // X transplant: dtm (use as-is)
      // X direct: dtm - delta (no shock = faster)
      return dtm - (isTransplant ? 0 : PLANTING_METHOD_DELTA_DAYS);

    default:
      return dtm;
  }
}

/**
 * Calculate Planting Method from tray stages and perennial flag.
 */
export function calculatePlantingMethod(crop: CropConfig): PlantingMethod {
  if (crop.perennial) {
    return 'PE';
  }
  const daysInCells = calculateDaysInCells(crop);
  return daysInCells === 0 ? 'DS' : 'TP';
}

/**
 * Calculate Harvest Window from number of harvests and days between harvests.
 *
 * Formula: (numberOfHarvests - 1) * daysBetweenHarvest + harvestBufferDays + postHarvestFieldDays
 */
export function calculateHarvestWindow(crop: CropConfig): number {
  const harvests = crop.numberOfHarvests ?? 1;
  const daysBetween = crop.daysBetweenHarvest ?? 0;
  const buffer = crop.harvestBufferDays ?? 0;
  const postHarvest = crop.postHarvestFieldDays ?? 0;

  // Single harvest crops just get the buffer + post-harvest time
  if (harvests <= 1 || daysBetween === 0) {
    return buffer + postHarvest;
  }

  return (harvests - 1) * daysBetween + buffer + postHarvest;
}

/**
 * Calculate all derived timing fields for a crop.
 */
export function calculateCropFields(crop: CropConfig): CropCalculated {
  const daysInCells = calculateDaysInCells(crop);
  const sth = calculateSTH(crop, daysInCells);
  const plantingMethod = calculatePlantingMethod(crop);
  const harvestWindow = calculateHarvestWindow(crop);

  return {
    daysInCells,
    sth,
    plantingMethod,
    harvestWindow,
  };
}

/**
 * Get the config needed for timeline calculations from a crop.
 * Combines stored inputs with calculated values.
 */
export function getTimelineConfig(crop: CropConfig): {
  crop: string;
  product: string;
  category: string;
  growingStructure: string;
  plantingMethod: PlantingMethod;
  dtm: number; // For timeline, this is STH (total seed-to-harvest)
  harvestWindow: number;
  daysInCells: number;
} {
  const calculated = calculateCropFields(crop);

  return {
    crop: crop.crop,
    product: crop.product ?? 'General',
    category: crop.category ?? '',
    growingStructure: crop.growingStructure ?? 'Field',
    plantingMethod: calculated.plantingMethod,
    dtm: calculated.sth,
    harvestWindow: crop.harvestWindow ?? 0,
    daysInCells: calculated.daysInCells,
  };
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Generate a unique ID for a custom crop config.
 * Format: custom_{timestamp}_{random}
 */
export function generateConfigId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `custom_${timestamp}_${random}`;
}

/**
 * Create a blank CropConfig with sensible defaults.
 * Used when creating a new config from scratch.
 */
export function createBlankConfig(): CropConfig {
  return {
    id: generateConfigId(),
    identifier: '',
    crop: '',
    variant: '',
    product: '',
    category: '',
    growingStructure: 'Field',
    normalMethod: 'DS',
    dtm: 60,
    daysToGermination: 7,
    harvestWindow: 7,
    harvestBufferDays: 7,
    numberOfHarvests: 1,
    daysBetweenHarvest: 0,
    trayStages: [],
    deprecated: false,
    perennial: false,
  };
}

/**
 * Create a copy of an existing CropConfig for modification.
 * Generates a new ID and clears the identifier (user must provide a new one).
 */
export function copyConfig(source: CropConfig): CropConfig {
  return {
    ...source,
    id: generateConfigId(),
    identifier: '', // User must provide a unique identifier
  };
}
