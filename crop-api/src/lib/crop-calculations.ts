/**
 * Crop Calculations
 *
 * Pure calculation functions for deriving crop timing and planning values.
 * These replace the pre-calculated Excel fields with runtime computation.
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

/** Raw crop input data (what we store in crops.json) */
export interface CropConfig {
  id: string;
  identifier: string;
  crop: string;
  variant?: string;
  product?: string;
  category?: string;
  growingStructure?: string;
  normalMethod?: 'DS' | 'TP' | 'X';

  // Timing inputs
  dtm?: number;
  daysToGermination?: number;
  harvestWindow?: number;

  // Greenhouse stages (empty array or undefined = direct seeded)
  trayStages?: TrayStage[];

  // Status
  deprecated?: boolean;

  // Perennial flag - indicates crop persists across seasons
  perennial?: boolean;

  /**
   * Assumed transplant age (days) when DTM was measured for TP crops.
   * Used to calculate STH when direct seeding a normally-transplanted crop.
   * Default: 35 days (5 weeks, typical Johnny's Seeds assumption).
   *
   * TODO: Could be populated per-crop by scraping seed catalogs (e.g., Johnny's
   * Seeds culture notes often specify "sow X weeks before transplanting").
   */
  assumedTransplantDays?: number;

  // Harvest/yield data - normalized inputs
  // Frontend can offer different input modes that convert to this format
  /** Days between harvests (e.g., 7 = weekly, 14 = biweekly) */
  daysBetweenHarvest?: number;
  /** Number of harvests over the production period */
  numberOfHarvests?: number;
  /** Yield per harvest in yieldUnit (scales with bed size) */
  yieldPerHarvest?: number;
  /** Unit of measure for yield (lb, bunch, head, stem, etc.) */
  yieldUnit?: string;

  /**
   * Days crop occupies bed after last harvest (e.g., tuber curing).
   * Added to harvest window calculation. Most crops = 0 (default).
   * Example: Dahlia tubers need ~28 days in ground after last cut.
   */
  postHarvestFieldDays?: number;

  /**
   * Buffer days for initial harvest window (how long crop is harvestable).
   * Accounts for not all plants maturing at exactly the same time.
   * Default: 7 days. Override for crops with different harvest flexibility.
   */
  harvestBufferDays?: number;
}

/** Calculated crop values (derived at runtime) */
export interface CropCalculated {
  /** Days spent in greenhouse trays (sum of all tray stage days) */
  daysInCells: number;
  /** Seed To Harvest - total days from seeding to first harvest */
  sth: number;
  /** How the crop is actually grown: DS (direct seed), TP (transplant), PE (perennial) */
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
 * This constant captures the timing difference between transplanting and
 * direct seeding for the same crop:
 * - Transplanting adds ~14 days due to shock ("kicked in the knee")
 * - Direct seeding saves ~14 days by avoiding shock
 *
 * Johnny's Seeds reference: "subtract about 14 days for days to maturity
 * from transplant" when converting TP timing to DS timing.
 */
const PLANTING_METHOD_DELTA_DAYS = 14;

/**
 * Default assumed transplant age (days) for TP crops.
 *
 * When a seed catalog says "DTM from transplant", they measured from
 * transplants of a certain age. This default represents ~4 weeks, which
 * is a rough middle-ground assumption.
 *
 * Fast crops like small brassicas might assume 21 days (3 weeks).
 * Larger transplants like Solanaceae (tomatoes, peppers, eggplant) typically
 * assume 42 days (6 weeks) in the greenhouse before transplanting.
 *
 * Individual crops can override via `assumedTransplantDays` field.
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
 * This converts the user-entered DTM (which has different meanings based on
 * normalMethod) into the total time from seeding to harvest.
 *
 * The key insight is that DTM from seed packets can mean different things:
 * - "DS" DTM: measured from direct seeding in field
 * - "TP" DTM: measured from transplant date (in-field time only)
 * - "X" DTM: already the full seed-to-harvest time
 *
 * When you grow a crop differently than how its DTM was measured, you need
 * to compensate for the difference in growing method.
 */
export function calculateSTH(crop: CropConfig, daysInCells: number): number {
  const method = crop.normalMethod ?? 'X';
  const dtm = crop.dtm ?? 0;
  const dtg = crop.daysToGermination ?? 0;
  const isTransplant = daysInCells > 0;

  switch (method) {
    case 'DS':
      // DTM is measured from emergence (germination), not from seeding.
      // DS direct: dtg + dtm (germination + time from emergence)
      // DS transplant: dtg + dtm + shock (same baseline, plus transplant penalty)
      return dtg + dtm + (isTransplant ? PLANTING_METHOD_DELTA_DAYS : 0);

    case 'TP': {
      // DTM is measured from transplant date (in-field time only).
      // TP transplant: daysInCells + dtm (greenhouse time + field time)
      // TP direct: We need to estimate the full STH the seed producer assumed,
      //   then subtract the shock savings from direct seeding.
      //   Formula: assumedTransplantDays + dtm - delta
      const assumedDays = crop.assumedTransplantDays ?? DEFAULT_ASSUMED_TRANSPLANT_DAYS;
      return isTransplant
        ? daysInCells + dtm
        : assumedDays + dtm - PLANTING_METHOD_DELTA_DAYS;
    }

    case 'X':
      // DTM is total time from seeding a transplant to harvest.
      // X timing already includes greenhouse time and transplant shock.
      // X transplant: dtm (use as-is)
      // X direct: dtm - delta (no shock = faster)
      return dtm - (isTransplant ? 0 : PLANTING_METHOD_DELTA_DAYS);

    default:
      return dtm;
  }
}

/**
 * Calculate Planting Method from tray stages and perennial flag.
 * This is how the crop is actually grown, not how DTM is defined.
 *
 * - PE: Perennial - crop persists across seasons
 * - TP: Transplant - started in greenhouse then moved to field
 * - DS: Direct seed - seeded directly in field
 */
export function calculatePlantingMethod(crop: CropConfig): PlantingMethod {
  // Perennials are a special category
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
 *
 * For a crop harvested 4 times, 7 days apart, with 7-day buffer:
 *   (4 - 1) * 7 + 7 + 0 = 28 days total window
 *
 * For Dahlia (17 harvests, 7 days apart, 7-day buffer, 28 days post-harvest for tuber curing):
 *   (17 - 1) * 7 + 7 + 28 = 147 days total window
 *
 * Note: harvestBufferDays should always be set on the crop (default applied during authoring).
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

// =============================================================================
// MAIN CALCULATION FUNCTION
// =============================================================================

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
 * This combines stored inputs with calculated values.
 */
export function getTimelineConfig(crop: CropConfig): {
  crop: string;
  product: string;
  category: string;
  growingStructure: string;
  plantingMethod: PlantingMethod;
  dtm: number; // Note: For timeline, this should be STH (total seed-to-harvest)
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
    dtm: calculated.sth, // Use STH for timeline calculations
    harvestWindow: crop.harvestWindow ?? 0,
    daysInCells: calculated.daysInCells,
  };
}
