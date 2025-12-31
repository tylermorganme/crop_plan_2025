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
 *   - "X":  DTM is total time from seeding (used when you just want DTM = STH)
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
 * Transplant shock compensation (days).
 *
 * When a crop's DTM is based on direct seeding but you grow it as a transplant,
 * the transplanting process adds stress/shock that slows growth.
 *
 * Note: Could be standardized with DIRECT_SEED_ESTABLISHMENT_DAYS to a single
 * value (~18 days) in the future if exact parity with legacy data isn't needed.
 */
const TRANSPLANT_SHOCK_DAYS = 15;

/**
 * Direct seed establishment compensation (days).
 *
 * When a crop's DTM is based on transplanting but you direct seed it instead,
 * the seedling needs extra time to establish compared to a transplant.
 *
 * Note: Could be standardized with TRANSPLANT_SHOCK_DAYS to a single value
 * (~18 days) in the future if exact parity with legacy data isn't needed.
 */
const DIRECT_SEED_ESTABLISHMENT_DAYS = 20;

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
      // DTM is measured from direct seeding in field.
      // Base: germination time + DTM
      // If grown as transplant: add shock compensation
      return dtg + dtm + (isTransplant ? TRANSPLANT_SHOCK_DAYS : 0);

    case 'TP':
      // DTM is measured from transplant date (in-field time only).
      // If grown as transplant: add greenhouse days
      // If direct seeded: add establishment compensation (plant needs longer
      // to establish than a transplant would, but no shock)
      return dtm + (isTransplant ? daysInCells : DIRECT_SEED_ESTABLISHMENT_DAYS);

    case 'X':
      // DTM is already the full seed-to-harvest time, use as-is
      return dtm;

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
