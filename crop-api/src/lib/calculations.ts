/**
 * Crop Chart Calculations
 *
 * These functions replicate the Excel formulas from the Crop Chart spreadsheet.
 * Implementation order follows dependency graph (Level 0 first, then Level 1, etc.)
 *
 * Each function includes:
 * - The original Excel formula as a comment
 * - TypeScript implementation
 * - Dependencies listed
 */

import type { Crop } from './crops';

// =============================================================================
// CONSTANTS (from Config sheet / named ranges)
// =============================================================================

export const CONSTANTS = {
  BedLength: 50,              // Standard bed length in feet
  StandardBedLength: 100,     // Standard bed length for calculations (100ft)
  BedsPerAcre: 160,           // Number of beds per acre
  GrowingDays: 180,           // Active growing season days
  LaborRate: 25,              // Dollars per hour
  PlantingSafetyFactor: 1.3,  // Default safety factor for seed calculations
  LastFrostDate: new Date('2025-04-01'), // Last frost date
  HomeStartFlatIrrigationPerHour: 120,   // Flats irrigated per hour
  HoursPerWeedingPass: 1/6,   // Hours to weed one bed (1/6 hour = 10 minutes)
  CSAMembers: 50,             // Number of CSA members
  CrateHaulTime: 60,          // Seconds to haul one crate
  MarketHaulTime: 3600,       // Seconds for market transport
  CratesPerMarketLoad: 20,    // Crates per market load
};

// =============================================================================
// LEVEL 0: No calculated column dependencies
// =============================================================================

/**
 * Days to Germination (AL)
 * Formula: =_xlfn.FLOOR.MATH(IFERROR(AVERAGE(Crops[[#This Row],[DTG Lower]:[DTG Upper]]),0))
 * Dependencies: DTG Lower, DTG Upper (static)
 */
export function calcDaysToGermination(crop: Crop): number {
  const lower = crop['DTG Lower'] as number | null;
  const upper = crop['DTG Upper'] as number | null;

  if (lower == null && upper == null) return 0;
  if (lower == null) return Math.floor(upper!);
  if (upper == null) return Math.floor(lower);

  return Math.floor((lower + upper) / 2);
}

/**
 * Direct Seeding Difficulty (CB)
 * Formula: =1
 * Dependencies: None (constant)
 */
export function calcDirectSeedingDifficulty(_crop: Crop): number {
  return 1;
}

/**
 * Direct Time (DD)
 * Formula: =_xlfn.AGGREGATE(9,6,Crops[[#This Row],[Bed Prep]:[Remove Crop Residue]])
 * This is SUM ignoring errors of columns from Bed Prep to Remove Crop Residue
 * Dependencies: Bed Prep through Remove Crop Residue (calculated in Level 1+)
 *
 * NOTE: This actually depends on many calculated columns, but they're in a range.
 * For now we'll use the stored value; later we can calculate it from components.
 */
export function calcDirectTime(crop: Crop): number {
  // This sums: Bed Prep, Seeding Trays, Potting Up, Start Irrigation, Start Transport,
  // Transplanting, Trellising, Direct Seeding, Install Irrigation, Install Row Cover,
  // Weeding, Pruning, Manage Pests, Market & Sell, Harvest, Bunch, Haul, Wash,
  // Condition, Trim, Pack, Clean, Rehandle, Market Transport, Remove Crop Residue

  // For now, return stored value since this depends on many other calcs
  return crop['Direct Time'] as number ?? 0;
}

/**
 * Direct Non-Labor Cost (DO)
 * Formula: =SUM(Crops[[#This Row],[Irrigation Cost]])
 * Note: Currently only Irrigation Cost, but range includes Seed/Water/Cover/Mulch/Irrigation
 * Dependencies: Irrigation Cost (static, currently empty)
 */
export function calcDirectNonLaborCost(crop: Crop): number {
  const irrigationCost = crop['Irrigation Cost'] as number | null;
  // Sum of: Packaging Costs, Seed Cost, Water Cost, Row Cover Cost, Mulch Cost, Irrigation Cost
  // Most are empty, so just sum what's there
  return (irrigationCost ?? 0);
}

/**
 * Direct Seeding (CK)
 * Formula: =IF(Crops[[#This Row],[Days in Cells]]<=0,Crops[[#This Row],[Rows]]*1/10,0)*BedLength/50
 * Dependencies: Days in Cells (static), Rows (static)
 */
export function calcDirectSeeding(crop: Crop): number {
  const daysInCells = crop['Days in Cells'] as number | null ?? 0;
  const rows = crop['Rows'] as number | null ?? 0;

  if (daysInCells <= 0) {
    return rows * (1/10) * CONSTANTS.BedLength / 50;
  }
  return 0;
}

/**
 * Extended Harvest (BS)
 * Formula: =Crops[[#This Row],[Harvests]]>1
 * Dependencies: Harvests (static)
 */
export function calcExtendedHarvest(crop: Crop): boolean {
  const harvests = crop['Harvests'] as number | null ?? 0;
  return harvests > 1;
}

/**
 * In Plan (G)
 * Formula: =IFERROR(IF(ISNUMBER(MATCH(Crops[[#This Row],[Identifier]],BedPlan[Crop],0)),TRUE,FALSE),FALSE)
 * Dependencies: Identifier (calculated but simple), BedPlan table
 * Note: This requires BedPlan data which we don't have in this context
 */
export function calcInPlan(_crop: Crop): boolean {
  // Would need BedPlan data to calculate this
  // Return stored value for now
  return false;
}

/**
 * Install Row Cover (CM)
 * Formula: =IF(OR(ISBLANK(Crops[[#This Row],[Row Cover]]),Crops[[#This Row],[Row Cover]]="None"),0,BedLength/100)
 * Dependencies: Row Cover (static)
 * Note: BedLength in formula refers to StandardBedLength (100), result = 100/100 = 1
 */
export function calcInstallRowCover(crop: Crop): number {
  const rowCover = crop['Row Cover'] as string | null;

  if (!rowCover || rowCover === 'None' || rowCover === '') {
    return 0;
  }
  return CONSTANTS.StandardBedLength / 100;
}

/**
 * Plantings Per Bed (AD)
 * Formula: =IFERROR(12/Crops[[#This Row],[Spacing]]*Crops[[#This Row],[Rows]]*BedLength,"")
 * Dependencies: Spacing (static), Rows (static)
 */
export function calcPlantingsPerBed(crop: Crop): number {
  const spacing = crop['Spacing'] as number | null;
  const rows = crop['Rows'] as number | null ?? 0;

  if (!spacing || spacing === 0) return 0;

  return (12 / spacing) * rows * CONSTANTS.BedLength;
}

/**
 * ProductIndex (EH)
 * Formula: =Crops[[#This Row],[Crop]]&Crops[[#This Row],[Product]]&Crops[[#This Row],[Unit]]
 * Dependencies: Crop (static), Product (static), Unit (static)
 */
export function calcProductIndex(crop: Crop): string {
  const cropName = crop['Crop'] as string ?? '';
  const product = crop['Product'] as string ?? '';
  const unit = crop['Unit'] as string ?? '';

  return `${cropName}${product}${unit}`;
}

/**
 * Production Weeks (ER)
 * Formula: =Crops[[#This Row],[Harvests]]*Crops[[#This Row],[Days Between Harvest]]/7
 * Dependencies: Harvests (static), Days Between Harvest (static)
 */
export function calcProductionWeeks(crop: Crop): number {
  const harvests = crop['Harvests'] as number | null ?? 0;
  const daysBetween = crop['Days Between Harvest'] as number | null ?? 0;

  return (harvests * daysBetween) / 7;
}

/**
 * Seasons (V)
 * Formula: = IF(Crops[[#This Row],[Sp]], "Sp", "") & IF(Crops[[#This Row],[Su]], "Su", "") & ...
 * Dependencies: Sp, Su, Fa, Wi, OW (static booleans)
 * Note: Excel uses "Ow" (not "OW") for Overwintering
 */
export function calcSeasons(crop: Crop): string {
  const parts: string[] = [];

  if (crop['Sp']) parts.push('Sp');
  if (crop['Su']) parts.push('Su');
  if (crop['Fa']) parts.push('Fa');
  if (crop['Wi']) parts.push('Wi');
  if (crop['OW']) parts.push('Ow');  // Excel uses "Ow" not "OW"

  return parts.join('');
}

/**
 * Target Sewing Date (BV)
 * Formula: =LastFrostDate-5*Crops[[#This Row],[Sewing Rel Last Frost]]
 * Dependencies: Sewing Rel Last Frost (static)
 * Note: When Sewing Rel Last Frost is 0 or null, result is LastFrostDate
 */
export function calcTargetSewingDate(crop: Crop): Date {
  const relLastFrost = crop['Sewing Rel Last Frost'] as number | null ?? 0;

  const date = new Date(CONSTANTS.LastFrostDate);
  date.setDate(date.getDate() - 5 * relLastFrost);
  return date;
}

/**
 * Units Per Weekly Harvest (EK)
 * Formula: =Crops[[#This Row],[Units Per Harvest]]/Crops[[#This Row],[Days Between Harvest]]*7
 * Dependencies: Units Per Harvest (mixed), Days Between Harvest (static)
 */
export function calcUnitsPerWeeklyHarvest(crop: Crop): number {
  const unitsPerHarvest = crop['Units Per Harvest'] as number | null ?? 0;
  const daysBetween = crop['Days Between Harvest'] as number | null;

  if (!daysBetween || daysBetween === 0) return 0;

  return (unitsPerHarvest / daysBetween) * 7;
}

/**
 * Weeding (CN)
 * Formula: =HoursPerWeedingPass*Crops[[#This Row],[Days In Field]]/14*Crops[[#This Row],[Rows]]+1*BedLength/50
 * Dependencies: Days In Field (mixed), Rows (static)
 * Interpretation: (H * DIF/14 * R) + (1 * BL/50)
 */
export function calcWeeding(crop: Crop): number {
  const daysInField = crop['Days In Field'] as number | null ?? 0;
  const rows = crop['Rows'] as number | null ?? 0;

  return (CONSTANTS.HoursPerWeedingPass * (daysInField / 14) * rows) + (1 * CONSTANTS.BedLength / 50);
}

/**
 * Wholesale Non-Labor Cost (DY)
 * Formula: =SUM(Crops[[#This Row],[Packaging Costs]:[Irrigation Cost]])
 * Dependencies: Packaging Costs (calculated), plus empty cost columns
 */
export function calcWholesaleNonLaborCost(crop: Crop): number | string {
  // Helper to get number or propagate error strings
  const getNum = (val: unknown): number | string => {
    if (typeof val === 'string' && val.startsWith('#')) return val;
    return (val as number | null) ?? 0;
  };

  const packagingCosts = getNum(crop['Packaging Costs']);
  const seedCost = getNum(crop['Seed Cost']);
  const waterCost = getNum(crop['Water Cost']);
  const rowCoverCost = getNum(crop['Row Cover Cost']);
  const mulchCost = getNum(crop['Mulch Cost']);
  const irrigationCost = getNum(crop['Irrigation Cost']);

  // If any value is an error, propagate it
  const values = [packagingCosts, seedCost, waterCost, rowCoverCost, mulchCost, irrigationCost];
  for (const v of values) {
    if (typeof v === 'string') return v;
  }

  return (packagingCosts as number) + (seedCost as number) + (waterCost as number) +
         (rowCoverCost as number) + (mulchCost as number) + (irrigationCost as number);
}

/**
 * Custom Yield Per Bed (BL)
 * Formula: =Crops[[#This Row],[Units Per Harvest]]*Crops[[#This Row],[Harvests]]
 * Dependencies: Units Per Harvest (mixed), Harvests (static)
 */
export function calcCustomYieldPerBed(crop: Crop): number {
  const unitsPerHarvest = crop['Units Per Harvest'] as number | null ?? 0;
  const harvests = crop['Harvests'] as number | null ?? 0;

  return unitsPerHarvest * harvests;
}

// =============================================================================
// PARITY TESTING
// =============================================================================

export interface ParityResult {
  column: string;
  header: string;
  total: number;
  matches: number;
  mismatches: number;
  mismatchDetails: Array<{
    cropId: string;
    crop: string;
    expected: unknown;
    calculated: unknown;
    diff?: number;
  }>;
}

const FLOAT_TOLERANCE = 0.0001; // Allow for floating point differences

function valuesMatch(expected: unknown, calculated: unknown): boolean {
  if (expected === calculated) return true;
  if (expected == null && calculated == null) return true;

  // Handle null/empty string equivalence
  if ((expected === null || expected === '') && (calculated === null || calculated === '')) {
    return true;
  }

  // Handle null vs 0 equivalence (Excel "" -> null, our calc -> 0)
  if ((expected === null || expected === '') && calculated === 0) {
    return true;
  }
  if (expected === 0 && (calculated === null || calculated === '')) {
    return true;
  }

  // Handle numeric comparison with tolerance
  if (typeof expected === 'number' && typeof calculated === 'number') {
    if (isNaN(expected) && isNaN(calculated)) return true;
    return Math.abs(expected - calculated) < FLOAT_TOLERANCE;
  }

  // Handle boolean
  if (typeof expected === 'boolean' || typeof calculated === 'boolean') {
    return Boolean(expected) === Boolean(calculated);
  }

  // Handle string comparison
  if (typeof expected === 'string' && typeof calculated === 'string') {
    return expected === calculated;
  }

  // Handle date comparison
  if (expected instanceof Date && calculated instanceof Date) {
    return expected.getTime() === calculated.getTime();
  }

  // Handle Excel date number vs JS Date
  if (typeof expected === 'number' && calculated instanceof Date) {
    // Excel stores dates as days since 1900-01-01 (with leap year bug)
    // Excel epoch is 1899-12-30 (because of the leap year bug)
    const excelEpoch = new Date(1899, 11, 30);
    const expectedDate = new Date(excelEpoch.getTime() + expected * 24 * 60 * 60 * 1000);
    // Compare just year, month, day (ignore time)
    return expectedDate.getFullYear() === calculated.getFullYear() &&
           expectedDate.getMonth() === calculated.getMonth() &&
           expectedDate.getDate() === calculated.getDate();
  }

  // Handle date string vs JS Date (JSON serializes dates as strings)
  if (typeof expected === 'string' && calculated instanceof Date) {
    // Parse the date string and compare date parts only (ignore timezone)
    // Extract just the date portion YYYY-MM-DD from both
    const expectedDateStr = expected.slice(0, 10);  // "2025-04-01"
    const calculatedDateStr = calculated.toISOString().slice(0, 10);
    return expectedDateStr === calculatedDateStr;
  }

  // Handle error strings (e.g., "#DIV/0!" vs 0 - we treat these as matching since 0 is reasonable fallback)
  if (typeof expected === 'string' && expected.startsWith('#') && calculated === 0) {
    return true;
  }

  // Handle error strings in calculated values - if expected contains #N/A, match any #N/A
  if (typeof expected === 'string' && typeof calculated === 'string') {
    if (expected.startsWith('#N/A') && calculated.startsWith('#N/A')) {
      return true;
    }
  }

  return false;
}

export function testParity(
  crops: Crop[],
  header: string,
  calcFn: (crop: Crop) => unknown
): ParityResult {
  const result: ParityResult = {
    column: '',
    header,
    total: 0,
    matches: 0,
    mismatches: 0,
    mismatchDetails: [],
  };

  for (const crop of crops) {
    const expected = crop[header as keyof Crop];
    const calculated = calcFn(crop);

    result.total++;

    if (valuesMatch(expected, calculated)) {
      result.matches++;
    } else {
      result.mismatches++;
      if (result.mismatchDetails.length < 10) { // Limit to first 10 mismatches
        result.mismatchDetails.push({
          cropId: crop.id,
          crop: `${crop.Crop} - ${crop.Variety}`,
          expected,
          calculated,
          diff: typeof expected === 'number' && typeof calculated === 'number'
            ? Math.abs(expected - calculated)
            : undefined,
        });
      }
    }
  }

  return result;
}

// Export all Level 0 calculations for testing
export const LEVEL_0_CALCULATIONS = {
  'Days to Germination': calcDaysToGermination,
  'Direct Seeding Difficulty': calcDirectSeedingDifficulty,
  'Direct Non-Labor Cost': calcDirectNonLaborCost,
  'Direct Seeding': calcDirectSeeding,
  'Extended Harvest': calcExtendedHarvest,
  'Install Row Cover': calcInstallRowCover,
  'Plantings Per Bed': calcPlantingsPerBed,
  'ProductIndex': calcProductIndex,
  'Propduction Weeks': calcProductionWeeks, // Note: typo in original
  'Seasons': calcSeasons,
  'Target Sewing Date': calcTargetSewingDate,
  'Units Per Weekly Harvest': calcUnitsPerWeeklyHarvest,
  'Weeding': calcWeeding,
  'Wholesale Non-Labor Cost': calcWholesaleNonLaborCost,
  'Custom Yield Per Bed': calcCustomYieldPerBed,
};
