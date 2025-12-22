/**
 * Crop Timing Calculator
 *
 * Implements the exact calculation chain from the Bed Plan Excel sheet.
 * This allows computing dates from normalized crop config data.
 *
 * DAG Summary:
 *   Fixed Field Start Date
 *     → Planned GH Start (- Days in Cells)
 *       → GH Start Date (or Actual override)
 *         → Expected Begin Harvest (+ DTM)
 *           → Expected End Harvest (+ Harvest Window + Additional Days)
 *             → End of Harvest (or Actual override)
 */

export interface CropTimingInputs {
  // Core timing config (from crop database / normalized data)
  dtm: number;                    // Days to Maturity
  harvestWindow: number;          // Days of harvest
  daysInCells: number;            // Days in greenhouse (0 = direct seed)

  // Scheduling inputs
  fixedFieldStartDate?: Date;     // When crop goes in field (or null if follows)
  followsCrop?: string;           // Identifier of crop this follows
  followOffset?: number;          // Days after followed crop ends

  // User adjustments (extend/modify defaults)
  additionalDaysOfHarvest?: number;
  additionalDaysInField?: number;  // (not used in main calc, but tracked)
  additionalDaysInCells?: number;  // (not used in main calc, but tracked)

  // Actual dates (override planned)
  actualGreenhouseDate?: Date;
  actualTpOrDsDate?: Date;
  actualBeginningOfHarvest?: Date;
  actualEndOfHarvest?: Date;

  // For succession planting - lookup function
  getFollowedCropEndDate?: (identifier: string) => Date | null;
}

export interface CropTimingOutput {
  // Key dates for timeline
  startDate: Date;           // Display start (GH start or field date)
  endDate: Date;             // End of harvest (final)

  // Intermediate dates (for debugging/display)
  plannedGreenhouseStartDate: Date | null;
  greenhouseStartDate: Date | null;
  plannedTpOrDsDate: Date;
  tpOrDsDate: Date;
  expectedBeginningOfHarvest: Date;
  beginningOfHarvest: Date;
  expectedEndOfHarvest: Date;

  // Tracking
  inGroundDaysLate: number;  // Deviation from plan
  isTransplant: boolean;
}

/**
 * Add days to a date
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Subtract days from a date
 */
function subtractDays(date: Date, days: number): Date {
  return addDays(date, -days);
}

/**
 * Days between two dates
 */
function daysBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / msPerDay);
}

/**
 * Calculate all timing dates for a crop.
 *
 * This implements the exact same calculation chain as the Bed Plan Excel sheet:
 *
 * 1. Planned GH Start = Field Date - Days in Cells (if transplant)
 * 2. GH Start = Actual GH Date OR Planned GH Start
 * 3. Planned TP/DS = (Actual GH + Days in Cells) OR Field Date
 * 4. TP/DS Date = Actual TP/DS OR Planned TP/DS
 * 5. Expected Begin Harvest = (GH Start OR TP/DS) + DTM
 * 6. Begin Harvest = Actual Begin OR Expected Begin
 * 7. Expected End Harvest = Expected Begin + Harvest Window + Additional Days
 * 8. End Harvest = Actual End OR Expected End
 */
export function calculateCropTiming(inputs: CropTimingInputs): CropTimingOutput {
  const {
    dtm,
    harvestWindow,
    daysInCells,
    fixedFieldStartDate,
    followsCrop,
    followOffset = 0,
    additionalDaysOfHarvest = 0,
    actualGreenhouseDate,
    actualTpOrDsDate,
    actualBeginningOfHarvest,
    actualEndOfHarvest,
    getFollowedCropEndDate,
  } = inputs;

  const isTransplant = daysInCells > 0;

  // Resolve the base field date (either fixed or from followed crop)
  let baseFieldDate: Date;

  if (followsCrop && getFollowedCropEndDate) {
    const followedEnd = getFollowedCropEndDate(followsCrop);
    if (followedEnd) {
      // Field date = followed crop's end + 1 + offset
      baseFieldDate = addDays(followedEnd, 1 + followOffset);
    } else if (fixedFieldStartDate) {
      baseFieldDate = fixedFieldStartDate;
    } else {
      throw new Error(`Crop follows ${followsCrop} but no end date found and no fallback`);
    }
  } else if (fixedFieldStartDate) {
    baseFieldDate = fixedFieldStartDate;
  } else {
    throw new Error('Crop must have either fixedFieldStartDate or followsCrop');
  }

  // [17] Planned Greenhouse Start Date
  // = Field Date - Days in Cells (for transplants only)
  const plannedGreenhouseStartDate = isTransplant
    ? subtractDays(baseFieldDate, daysInCells)
    : null;

  // [19] Greenhouse Start Date
  // = COALESCE(Actual GH Date, Planned GH Start)
  const greenhouseStartDate = actualGreenhouseDate || plannedGreenhouseStartDate;

  // [23] Planned TP or DS Date
  // = IF(Actual GH exists, Actual GH + Days in Cells, Base Field Date)
  const plannedTpOrDsDate = actualGreenhouseDate
    ? addDays(actualGreenhouseDate, daysInCells)
    : baseFieldDate;

  // [26] TP or DS Date
  // = COALESCE(Actual TP/DS, Planned TP/DS)
  const tpOrDsDate = actualTpOrDsDate || plannedTpOrDsDate;

  // [25] In Ground Days Late
  // = Actual TP/DS - Planned TP/DS (deviation tracking)
  const inGroundDaysLate = actualTpOrDsDate
    ? daysBetween(plannedTpOrDsDate, actualTpOrDsDate)
    : 0;

  // [28] Expected Beginning of Harvest
  // = IF(GH Start exists, GH Start + DTM, TP/DS + DTM)
  // For transplants, DTM counts from greenhouse start
  // For direct seed, DTM counts from field date
  const expectedBeginningOfHarvest = isTransplant && greenhouseStartDate
    ? addDays(greenhouseStartDate, dtm)
    : addDays(tpOrDsDate, dtm);

  // [30] Beginning of Harvest
  // = COALESCE(Actual Begin, Expected Begin)
  const beginningOfHarvest = actualBeginningOfHarvest || expectedBeginningOfHarvest;

  // [31] Expected End of Harvest
  // = Expected Begin + Harvest Window + Additional Days of Harvest
  const expectedEndOfHarvest = addDays(
    expectedBeginningOfHarvest,
    harvestWindow + additionalDaysOfHarvest
  );

  // [36] End of Harvest
  // = COALESCE(Actual End, Expected End)
  const endOfHarvest = actualEndOfHarvest || expectedEndOfHarvest;

  // [16] Start Date (for display - earliest activity)
  // = COALESCE(Planned GH Start, Planned TP/DS)
  const startDate = plannedGreenhouseStartDate || plannedTpOrDsDate;

  return {
    startDate,
    endDate: endOfHarvest,
    plannedGreenhouseStartDate,
    greenhouseStartDate,
    plannedTpOrDsDate,
    tpOrDsDate,
    expectedBeginningOfHarvest,
    beginningOfHarvest,
    expectedEndOfHarvest,
    inGroundDaysLate,
    isTransplant,
  };
}

/**
 * Calculate timing from a bed plan assignment with all the raw data.
 */
export interface BedPlanAssignment {
  identifier: string;
  crop: string;
  bed: string;

  // Computed dates from sheet (for comparison)
  startDate?: string;
  endOfHarvest?: string;
  expectedEndOfHarvest?: string;

  // Config values
  dtm?: number;
  harvestWindow?: number;
  daysInCells?: number;

  // Inputs
  fixedFieldStartDate?: string;
  followsCrop?: string;
  followOffset?: number;

  // Adjustments
  additionalDaysOfHarvest?: number;
  additionalDaysInField?: number;
  additionalDaysInCells?: number;

  // Actuals
  actualGreenhouseDate?: string;
  actualTpOrDsDate?: string;
  actualBeginningOfHarvest?: string;
  actualEndOfHarvest?: string;
}

/**
 * Parse a date string to Date object
 */
function parseDate(dateStr?: string | null): Date | undefined {
  if (!dateStr) return undefined;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * Calculate timing from a bed plan assignment
 */
export function calculateFromBedPlanAssignment(
  assignment: BedPlanAssignment,
  getFollowedCropEndDate?: (id: string) => Date | null
): CropTimingOutput | null {
  const {
    dtm,
    harvestWindow,
    daysInCells,
    fixedFieldStartDate,
    followsCrop,
    followOffset,
    additionalDaysOfHarvest,
    actualGreenhouseDate,
    actualTpOrDsDate,
    actualBeginningOfHarvest,
    actualEndOfHarvest,
  } = assignment;

  // Need at least DTM and harvest window
  if (dtm === undefined || dtm === null) return null;
  if (harvestWindow === undefined || harvestWindow === null) return null;

  // Need a starting point
  const fixedDate = parseDate(fixedFieldStartDate);
  if (!fixedDate && !followsCrop) return null;

  try {
    return calculateCropTiming({
      dtm,
      harvestWindow,
      daysInCells: daysInCells || 0,
      fixedFieldStartDate: fixedDate,
      followsCrop: followsCrop || undefined,
      followOffset: followOffset || 0,
      additionalDaysOfHarvest: additionalDaysOfHarvest || 0,
      actualGreenhouseDate: parseDate(actualGreenhouseDate),
      actualTpOrDsDate: parseDate(actualTpOrDsDate),
      actualBeginningOfHarvest: parseDate(actualBeginningOfHarvest),
      actualEndOfHarvest: parseDate(actualEndOfHarvest),
      getFollowedCropEndDate,
    });
  } catch {
    return null;
  }
}
