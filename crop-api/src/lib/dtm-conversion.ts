/**
 * DTM Conversion Utilities
 *
 * DTM (Days To Maturity) values on seed packets/catalogs are measured from either:
 * - Direct seeding (DS): Days from seed in ground to harvest
 * - Transplant (TP): Days from transplant to harvest
 *
 * STH (Seed To Harvest) is always measured from seeding - it's what we actually
 * use for planning since we need to know when to start seeds.
 *
 * Conversion rules (apply consistently to ALL crops):
 * - TP→DS: Add 20 days (direct seeding takes ~3 weeks longer than transplant)
 * - DS→TP: Add daysInCells × 0.65 (cell time doesn't fully count toward maturity)
 *
 * STH Calculation:
 * - Direct seed: STH = DTM (with TP→DS conversion if needed)
 * - Transplant with TP DTM: STH = DTM + daysInCells
 * - Transplant with DS DTM: STH = DTM + (daysInCells × 0.65)
 *
 * Legacy spreadsheet data (especially flowers) may have inconsistent STH values.
 * These conversion rules are canonical - use them over stored STH values.
 */

import type { DtmMethod, PlantingType } from './types/entities';

/**
 * Constants for DTM conversion
 */
export const DTM_CONVERSION = {
  /** Days to add when converting from TP-measured DTM to direct seeding */
  TP_TO_DS_ADJUSTMENT: 20,

  /**
   * When DTM is from direct seed but we're transplanting, cell time doesn't
   * fully "count" toward maturity. This factor represents the inefficiency.
   *
   * Example: DTM=70 (from DS), DIC=35, STH = 70 + (35 * 0.65) ≈ 93
   */
  DS_TO_TP_INEFFICIENCY_FACTOR: 0.65,
};

/**
 * Calculate STH (Seed To Harvest) from DTM and planting details.
 *
 * STH is always measured from seeding, regardless of how DTM was measured.
 * This is the number we use for actual planning.
 *
 * @param dtm - Days to maturity (from seed packet or catalog)
 * @param dtmMethod - How the DTM was measured ('from_direct_seed' or 'from_transplant')
 * @param plantingType - How we're actually planting ('direct_seed' or 'transplant')
 * @param daysInCells - Days in greenhouse/cells before transplant (only for transplants)
 * @returns Days from seeding to first harvest
 */
export function calculateSth(
  dtm: number,
  dtmMethod: DtmMethod | null,
  plantingType: PlantingType,
  daysInCells: number = 0
): number {
  if (plantingType === 'perennial') {
    // Perennials don't have a simple STH calculation
    return dtm;
  }

  // === DIRECT SEEDING ===
  if (plantingType === 'direct_seed') {
    if (dtmMethod === 'from_transplant') {
      // DTM is from transplant, but we're direct seeding
      // Add ~20 days because direct seeding takes longer
      return dtm + DTM_CONVERSION.TP_TO_DS_ADJUSTMENT;
    }
    // DTM is from direct seed (or unknown) - use as-is
    return dtm;
  }

  // === TRANSPLANTING ===
  if (dtmMethod === 'from_transplant') {
    // DTM is from transplant: STH = DTM + daysInCells
    // (DTM measures field time, we add cell time)
    return dtm + daysInCells;
  }

  if (dtmMethod === 'from_direct_seed') {
    // DTM is from direct seed, but we're transplanting
    // Cell time doesn't fully count - only ~35% helps, ~65% is "wasted"
    // STH = DTM + (daysInCells * inefficiency)
    return dtm + Math.round(daysInCells * DTM_CONVERSION.DS_TO_TP_INEFFICIENCY_FACTOR);
  }

  // Unknown method - assume DTM + daysInCells as safe default
  return dtm + daysInCells;
}

/**
 * Convert a DTM value to a different measurement basis.
 *
 * Use this when you want to know "what would the DTM be if measured differently?"
 * For planning, use calculateSth() instead - it gives you the actual planting time.
 *
 * @param dtm - The original DTM value
 * @param fromMethod - How the DTM was originally measured
 * @param toMethod - How you want it measured
 * @param daysInCells - Days in cells (needed for some conversions)
 * @returns DTM in the new measurement basis
 */
export function convertDtmBasis(
  dtm: number,
  fromMethod: DtmMethod,
  toMethod: DtmMethod,
  daysInCells: number = 0
): number {
  if (fromMethod === toMethod) return dtm;

  // TP → DS: Add 20 days
  if (fromMethod === 'from_transplant' && toMethod === 'from_direct_seed') {
    return dtm + DTM_CONVERSION.TP_TO_DS_ADJUSTMENT;
  }

  // DS → TP: Subtract 20 days (inverse of above)
  if (fromMethod === 'from_direct_seed' && toMethod === 'from_transplant') {
    return Math.max(dtm - DTM_CONVERSION.TP_TO_DS_ADJUSTMENT, 1);
  }

  // Unknown conversion
  return dtm;
}

/**
 * Describe the STH calculation for UI display.
 *
 * Returns a human-readable explanation of how STH was calculated.
 */
export function describeSthCalculation(
  dtm: number,
  dtmMethod: DtmMethod | null,
  plantingType: PlantingType,
  daysInCells: number = 0
): string {
  if (plantingType === 'perennial') {
    return `${dtm} days (perennial)`;
  }

  if (plantingType === 'direct_seed') {
    if (dtmMethod === 'from_transplant') {
      const sth = dtm + DTM_CONVERSION.TP_TO_DS_ADJUSTMENT;
      return `${sth} days = ${dtm} (DTM from transplant) + ${DTM_CONVERSION.TP_TO_DS_ADJUSTMENT} (direct seed adjustment)`;
    }
    return `${dtm} days (DTM from direct seed)`;
  }

  // Transplanting
  if (dtmMethod === 'from_transplant') {
    const sth = dtm + daysInCells;
    return `${sth} days = ${dtm} (DTM from transplant) + ${daysInCells} (days in cells)`;
  }

  if (dtmMethod === 'from_direct_seed') {
    const adjustment = Math.round(daysInCells * DTM_CONVERSION.DS_TO_TP_INEFFICIENCY_FACTOR);
    const sth = dtm + adjustment;
    return `${sth} days = ${dtm} (DTM from DS) + ${adjustment} (${daysInCells} days in cells × ${DTM_CONVERSION.DS_TO_TP_INEFFICIENCY_FACTOR} inefficiency)`;
  }

  const sth = dtm + daysInCells;
  return `${sth} days = ${dtm} (DTM) + ${daysInCells} (days in cells)`;
}

/**
 * Get a short description of any conversion being applied.
 * Returns null if no conversion is needed.
 */
export function getConversionNote(
  dtmMethod: DtmMethod | null,
  plantingType: PlantingType,
  daysInCells: number = 0
): string | null {
  if (!dtmMethod || plantingType === 'perennial') {
    return null;
  }

  if (plantingType === 'direct_seed' && dtmMethod === 'from_transplant') {
    return `+${DTM_CONVERSION.TP_TO_DS_ADJUSTMENT} days (DTM from transplant, direct seeding)`;
  }

  if (plantingType === 'transplant' && dtmMethod === 'from_direct_seed' && daysInCells > 0) {
    const adjustment = Math.round(daysInCells * DTM_CONVERSION.DS_TO_TP_INEFFICIENCY_FACTOR);
    return `+${adjustment} days cell inefficiency (DTM from direct seed)`;
  }

  return null;
}
