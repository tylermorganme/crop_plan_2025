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

import { addDays, subDays, differenceInDays, parseISO } from 'date-fns';

export interface CropTimingInputs {
  // Core timing config (from crop database / normalized data)
  dtm: number;                    // Days to Maturity
  harvestWindow: number;          // Days of harvest
  daysInCells: number;            // Days in greenhouse (0 = direct seed)

  // Scheduling inputs
  fixedFieldStartDate?: Date;     // When crop goes in field

  // User adjustments (extend/modify defaults)
  // Note: These are applied via resolveEffectiveTiming() before calling this function
  additionalDaysOfHarvest?: number;
  additionalDaysInField?: number;
  additionalDaysInCells?: number;

  // Actual dates (override planned)
  actualGreenhouseDate?: Date;
  actualTpOrDsDate?: Date;

  // For succession planting - lookup function (legacy, unused)
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
    additionalDaysOfHarvest = 0,
    actualGreenhouseDate,
    actualTpOrDsDate,
  } = inputs;

  const isTransplant = daysInCells > 0;

  // Field date is required
  if (!fixedFieldStartDate) {
    throw new Error('Crop must have fixedFieldStartDate');
  }
  const baseFieldDate = fixedFieldStartDate;

  // [17] Planned Greenhouse Start Date
  // = Field Date - Days in Cells (for transplants only)
  const plannedGreenhouseStartDate = isTransplant
    ? subDays(baseFieldDate, daysInCells)
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
    ? differenceInDays(actualTpOrDsDate, plannedTpOrDsDate)
    : 0;

  // [28] Expected Beginning of Harvest
  // = IF(GH Start exists, GH Start + DTM, TP/DS + DTM)
  // For transplants, DTM counts from greenhouse start
  // For direct seed, DTM counts from field date
  const expectedBeginningOfHarvest = isTransplant && greenhouseStartDate
    ? addDays(greenhouseStartDate, dtm)
    : addDays(tpOrDsDate, dtm);

  // [30] Beginning of Harvest
  // = Expected Beginning of Harvest (no actual tracking for harvest dates)
  const beginningOfHarvest = expectedBeginningOfHarvest;

  // [31] Expected End of Harvest
  // = Expected Begin + Harvest Window + Additional Days of Harvest
  // Note: harvestWindow should already be clamped by resolveEffectiveTiming,
  // but we add a safety clamp here for direct callers
  const effectiveHarvestDays = Math.max(0, harvestWindow + additionalDaysOfHarvest);
  const expectedEndOfHarvest = addDays(
    expectedBeginningOfHarvest,
    effectiveHarvestDays
  );

  // [36] End of Harvest
  // = Expected End (no actual tracking for harvest dates)
  const endOfHarvest = expectedEndOfHarvest;

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
  // Adjustments
  additionalDaysOfHarvest?: number;
  additionalDaysInField?: number;
  additionalDaysInCells?: number;

  // Actuals
  actualGreenhouseDate?: string;
  actualFieldDate?: string;
}

/**
 * Parse a date string to Date object
 */
function parseDate(dateStr?: string | null): Date | undefined {
  if (!dateStr) return undefined;
  const d = parseISO(dateStr);
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * Calculate timing from a bed plan assignment
 */
export function calculateFromBedPlanAssignment(
  assignment: BedPlanAssignment
): CropTimingOutput | null {
  const {
    dtm,
    harvestWindow,
    daysInCells,
    fixedFieldStartDate,
    additionalDaysOfHarvest,
    actualGreenhouseDate,
    actualFieldDate,
  } = assignment;

  // Need at least DTM and harvest window
  if (dtm === undefined || dtm === null) return null;
  if (harvestWindow === undefined || harvestWindow === null) return null;

  // Need a starting point
  const fixedDate = parseDate(fixedFieldStartDate);
  if (!fixedDate) return null;

  try {
    return calculateCropTiming({
      dtm,
      harvestWindow,
      daysInCells: daysInCells || 0,
      fixedFieldStartDate: fixedDate,
      additionalDaysOfHarvest: additionalDaysOfHarvest || 0,
      actualGreenhouseDate: parseDate(actualGreenhouseDate),
      actualTpOrDsDate: parseDate(actualFieldDate),
    });
  } catch {
    return null;
  }
}
