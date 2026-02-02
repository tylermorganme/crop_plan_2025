/**
 * PlantingSequence Entity
 *
 * A sequence links multiple plantings temporally (succession planting).
 * Each planting in the sequence has its fieldStartDate calculated as:
 *   anchor.fieldStartDate + (slot * offsetDays) + additionalDaysInField
 *
 * Key concepts:
 * - Anchor: The planting with slot 0 - owns its own fieldStartDate
 * - Followers: Subsequent plantings (slot > 0) - dates calculated from anchor
 * - Sparse slots: Slot numbers can have gaps (e.g., 0, 1, 2, 5, 10)
 * - Offset: Days between each slot's fieldStartDate
 *
 * Sequences are orthogonal to bed-spanning - a planting can both be in
 * a sequence AND span multiple beds.
 */

import { parseISO, format, addDays } from 'date-fns';

export interface PlantingSequence {
  /** Unique sequence identifier (UUID) */
  id: string;

  /** Optional user-friendly name (e.g., "Spring Cilantro Succession") */
  name?: string;

  /**
   * Days between each planting.
   * - When useGddStagger is OFF: days between planting dates (current behavior)
   * - When useGddStagger is ON: days between harvest dates (goal)
   */
  offsetDays: number;

  /**
   * Use GDD-based harvest staggering.
   *
   * When enabled, offsetDays represents the target days between harvests,
   * and planting dates are calculated dynamically to achieve even harvest spacing.
   *
   * When disabled (default), offsetDays represents days between planting dates,
   * which may result in uneven harvest spacing due to seasonal temperature variation.
   */
  useGddStagger?: boolean;
}

export interface CreateSequenceInput {
  /** Optional custom ID (defaults to generated S1, S2, etc.) */
  id?: string;
  /** Optional sequence name */
  name?: string;
  /** Days between each planting (required) */
  offsetDays: number;
  /** Use GDD-based harvest staggering */
  useGddStagger?: boolean;
}

// Simple counter for generating unique sequence IDs
let nextSequenceId = 1;

/**
 * Generate a unique sequence ID.
 * Format: S{sequential number} e.g., S1, S2, S3...
 */
export function generateSequenceId(): string {
  return `S${nextSequenceId++}`;
}

/**
 * Initialize the sequence ID counter based on existing sequences.
 * Call this when loading a plan to avoid ID collisions.
 */
export function initializeSequenceIdCounter(existingIds: string[]): void {
  let maxId = 0;
  for (const id of existingIds) {
    const match = id.match(/^S(\d+)$/);
    if (match) {
      maxId = Math.max(maxId, parseInt(match[1], 10));
    }
  }
  nextSequenceId = maxId + 1;
}

/**
 * Create a new PlantingSequence entity.
 */
export function createSequence(input: CreateSequenceInput): PlantingSequence {
  return {
    id: input.id ?? generateSequenceId(),
    name: input.name,
    offsetDays: input.offsetDays,
    useGddStagger: input.useGddStagger,
  };
}

/**
 * Clone a sequence with optional overrides.
 * Generates a new ID by default.
 */
export function cloneSequence(
  source: PlantingSequence,
  overrides?: Partial<PlantingSequence>
): PlantingSequence {
  return {
    id: crypto.randomUUID(),
    name: source.name,
    offsetDays: source.offsetDays,
    useGddStagger: source.useGddStagger,
    ...overrides,
  };
}

/**
 * Compute the effective field start date for a sequence member.
 *
 * Formula: anchor.fieldStartDate + (slot * offsetDays) + additionalDaysInField
 *
 * @param anchorFieldStartDate - The anchor planting's fieldStartDate (ISO string)
 * @param slot - The slot number of this planting (0 = anchor)
 * @param offsetDays - Days between each slot
 * @param additionalDaysInField - Optional per-planting adjustment (default 0)
 * @returns ISO date string for the effective field start date
 */
export function computeSequenceDate(
  anchorFieldStartDate: string,
  slot: number,
  offsetDays: number,
  additionalDaysInField: number = 0
): string {
  const anchorDate = parseISO(anchorFieldStartDate);
  const totalOffset = slot * offsetDays + additionalDaysInField;
  return format(addDays(anchorDate, totalOffset), 'yyyy-MM-dd');
}

/**
 * Parameters needed for GDD-based sequence date calculation.
 */
export interface GddStaggerParams {
  /** GDD cache with pre-computed cumulative tables */
  gddCache: import('../gdd-cache').GddCache;
  /** Anchor planting's field start date (YYYY-MM-DD) */
  anchorFieldStartDate: string;
  /** Days from field start to harvest (DTM - greenhouse time) */
  fieldDaysToHarvest: number;
  /** Crop's base temperature for GDD calculation */
  baseTemp: number;
  /** Crop's ceiling temperature (optional) */
  upperTemp?: number;
  /** Structure offset for non-field growing (optional) */
  structureOffset?: number;
  /**
   * Target/reference field date for GDD calculation (MM-DD format).
   * This is used to calculate a FIXED GDD requirement based on the crop's
   * typical planting date, ensuring consistent GDD across seasons.
   * If not provided, falls back to using anchorFieldStartDate.
   */
  targetFieldDate?: string;
  /** Plan year for converting targetFieldDate to full date */
  planYear?: number;
}

/**
 * Compute planting date for a sequence slot using GDD-based harvest staggering.
 *
 * Unlike computeSequenceDate which spaces PLANTING dates evenly,
 * this function spaces HARVEST dates evenly and calculates what
 * planting dates are needed to achieve that.
 *
 * Algorithm:
 * 1. Calculate anchor's harvest date (anchor plant date + fieldDaysToHarvest GDD)
 * 2. Calculate target harvest date for this slot (anchor harvest + slot * offsetDays)
 * 3. Reverse lookup: what plant date achieves the target harvest date?
 *
 * @param params - GDD calculation parameters
 * @param slot - The slot number (0 = anchor)
 * @param harvestOffsetDays - Days between each slot's HARVEST (not planting)
 * @param additionalDaysInField - Optional per-planting adjustment (default 0)
 * @returns ISO date string for the calculated planting date, or null if calculation fails
 */
export function computeSequenceDateWithGddStagger(
  params: GddStaggerParams,
  slot: number,
  harvestOffsetDays: number,
  additionalDaysInField: number = 0
): string | null {
  // Dynamic import to avoid circular dependency
  const { findHarvestDate, findPlantDate, makeCacheKey } = require('../gdd-cache');

  const key = makeCacheKey(params.baseTemp, params.upperTemp, params.structureOffset ?? 0);

  // Slot 0 is the anchor - its planting date is fixed
  if (slot === 0) {
    if (additionalDaysInField === 0) {
      return params.anchorFieldStartDate;
    }
    // Apply additional days adjustment
    const anchorDate = parseISO(params.anchorFieldStartDate);
    return format(addDays(anchorDate, additionalDaysInField), 'yyyy-MM-dd');
  }

  // Step 1: Calculate anchor's harvest date using GDD
  // We need to find when anchor reaches fieldDaysToHarvest worth of GDD
  const anchorHarvestDate = findHarvestDate(
    params.gddCache,
    params.anchorFieldStartDate,
    getGddForFieldDays(params, params.fieldDaysToHarvest),
    key
  );

  if (!anchorHarvestDate) {
    // Fallback to non-GDD calculation if GDD lookup fails
    return computeSequenceDate(params.anchorFieldStartDate, slot, harvestOffsetDays, additionalDaysInField);
  }

  // Step 2: Calculate target harvest date for this slot
  const anchorHarvest = parseISO(anchorHarvestDate);
  const targetHarvestDays = slot * harvestOffsetDays + additionalDaysInField;
  const targetHarvestDate = format(addDays(anchorHarvest, targetHarvestDays), 'yyyy-MM-dd');

  // Step 3: Reverse lookup - what plant date achieves the target harvest?
  const plantDate = findPlantDate(
    params.gddCache,
    targetHarvestDate,
    getGddForFieldDays(params, params.fieldDaysToHarvest),
    key
  );

  if (!plantDate) {
    // Fallback to non-GDD calculation
    return computeSequenceDate(params.anchorFieldStartDate, slot, harvestOffsetDays, additionalDaysInField);
  }

  return plantDate;
}

/**
 * Calculate total GDD needed for a given number of field days.
 * This is a helper that uses the GDD cache to get the GDD requirement.
 *
 * Uses targetFieldDate (if available) to calculate a FIXED GDD requirement
 * based on the crop's typical planting date. This ensures consistent GDD
 * across seasons - the biological constant for how much heat the crop needs.
 */
function getGddForFieldDays(params: GddStaggerParams, fieldDays: number): number {
  const { getGddForDays, makeCacheKey } = require('../gdd-cache');
  const key = makeCacheKey(params.baseTemp, params.upperTemp, params.structureOffset ?? 0);

  // Use targetFieldDate for fixed GDD calculation if available
  let referenceDate = params.anchorFieldStartDate;
  if (params.targetFieldDate && params.planYear) {
    const [month, day] = params.targetFieldDate.split('-').map(Number);
    referenceDate = `${params.planYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const gdd = getGddForDays(params.gddCache, referenceDate, fieldDays, key);
  return gdd ?? fieldDays * 15; // Fallback: ~15 GDD per day average
}

/**
 * Calculate harvest date for a planting given its field start date.
 * Used for preview displays.
 */
export function computeHarvestDate(
  fieldStartDate: string,
  fieldDaysToHarvest: number,
  gddParams?: GddStaggerParams
): string {
  if (gddParams) {
    const { findHarvestDate, makeCacheKey } = require('../gdd-cache');
    const key = makeCacheKey(gddParams.baseTemp, gddParams.upperTemp, gddParams.structureOffset ?? 0);

    const harvestDate = findHarvestDate(
      gddParams.gddCache,
      fieldStartDate,
      getGddForFieldDays(gddParams, fieldDaysToHarvest),
      key
    );

    if (harvestDate) {
      return harvestDate;
    }
  }

  // Fallback to simple calendar calculation
  const startDate = parseISO(fieldStartDate);
  return format(addDays(startDate, fieldDaysToHarvest), 'yyyy-MM-dd');
}
