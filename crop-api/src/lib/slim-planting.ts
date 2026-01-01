/**
 * Slim Planting Types and Computation
 *
 * This module defines the minimal data needed to store a planting,
 * and computes the full TimelineCrop at runtime from catalog lookups.
 */

import { format } from 'date-fns';
import { calculateCropTiming, type CropTimingInputs } from './crop-timing-calculator';
import { calculateRowSpan } from './timeline-data';
import type { TimelineCrop, BedSpanInfo } from './plan-types';
import {
  calculateDaysInCells,
  calculateSTH,
  calculatePlantingMethod,
  calculateHarvestWindow,
  type CropConfig,
} from './crop-calculations';

// =============================================================================
// SLIM PLANTING TYPES
// =============================================================================

/**
 * Minimal planting data that gets stored.
 * All other fields are computed from config lookups at runtime.
 */
export interface SlimPlanting {
  /** Unique planting identifier, e.g., "ARU001" */
  id: string;

  /** Reference to planting config in catalog */
  cropConfigId: string;

  /** Assigned bed, or null if unassigned */
  bed: string | null;

  /** Number of beds in 50ft units (e.g., 0.5 = 25ft, 1 = 50ft) */
  bedsCount: number;

  /** Fixed field start date (ISO string) - when crop enters field */
  fixedFieldStartDate?: string;

  /** ID of crop this follows (for succession planting) */
  followsCrop?: string;

  /** Days after followed crop ends before this one starts */
  followOffset?: number;

  /** Overrides to default config values */
  overrides?: {
    additionalDaysOfHarvest?: number;
    additionalDaysInField?: number;
    additionalDaysInCells?: number;
  };

  /** Actual dates (for tracking variance from plan) */
  actuals?: {
    greenhouseDate?: string;
    tpOrDsDate?: string;
    beginningOfHarvest?: string;
    endOfHarvest?: string;
    failed?: boolean;
  };
}

/**
 * Config data needed from the planting catalog to compute timeline.
 */
export interface PlantingConfigLookup {
  /** Crop name, e.g., "Arugula" */
  crop: string;

  /** Product type, e.g., "Baby Leaf" */
  product: string;

  /** Category for color coding, e.g., "Green" */
  category: string;

  /** Growing structure: "Field", "GH", "HT" */
  growingStructure: string;

  /** Planting method */
  plantingMethod: 'DS' | 'TP' | 'PE';

  /** Days to maturity */
  dtm: number;

  /** Days of harvest window */
  harvestWindow: number;

  /** Days in greenhouse cells (0 = direct seed) */
  daysInCells: number;
}

/**
 * Raw crop entry from crops.json catalog.
 * This matches the CropConfig type from crop-calculations.ts
 */
export type CropCatalogEntry = CropConfig;

/**
 * Look up planting config from the crops catalog by identifier.
 *
 * @param cropIdentifier - The crop identifier (e.g., "Arugula - Baby Leaf 1X | Field DS Sp")
 * @param catalog - Array of crop entries from crops.json
 * @returns PlantingConfigLookup or null if not found
 */
export function lookupConfigFromCatalog(
  cropIdentifier: string,
  catalog: CropCatalogEntry[]
): PlantingConfigLookup | null {
  const entry = catalog.find(c => c.identifier === cropIdentifier);
  if (!entry) return null;

  // Calculate derived fields from the minimal crop config
  const daysInCells = calculateDaysInCells(entry);
  const sth = calculateSTH(entry, daysInCells);
  const plantingMethod = calculatePlantingMethod(entry);
  const harvestWindow = calculateHarvestWindow(entry);

  return {
    crop: entry.crop,
    product: entry.product || 'General',
    category: entry.category ?? '',
    growingStructure: entry.growingStructure || 'Field',
    plantingMethod,
    dtm: sth, // Use STH for timeline calculations
    harvestWindow,
    daysInCells,
  };
}

// =============================================================================
// COMPUTATION
// =============================================================================

const STANDARD_BED_FT = 50;

/**
 * Compute TimelineCrop objects from a slim planting and config lookup.
 *
 * @param planting - The slim planting data
 * @param config - Config values looked up from catalog
 * @param bedGroups - Bed groupings for span calculation
 * @param getFollowedCropEndDate - Optional callback for succession lookups
 * @returns Array of TimelineCrop objects (one per bed in span)
 */
export function computeTimelineCrop(
  planting: SlimPlanting,
  config: PlantingConfigLookup,
  bedGroups: Record<string, string[]>,
  getFollowedCropEndDate?: (identifier: string) => Date | null
): TimelineCrop[] {
  // Build timing inputs
  const timingInputs: CropTimingInputs = {
    dtm: config.dtm,
    harvestWindow: config.harvestWindow,
    daysInCells: config.daysInCells,
    fixedFieldStartDate: planting.fixedFieldStartDate
      ? new Date(planting.fixedFieldStartDate)
      : undefined,
    followsCrop: planting.followsCrop,
    followOffset: planting.followOffset ?? 0,
    additionalDaysOfHarvest: planting.overrides?.additionalDaysOfHarvest ?? 0,
    actualGreenhouseDate: planting.actuals?.greenhouseDate
      ? new Date(planting.actuals.greenhouseDate)
      : undefined,
    actualTpOrDsDate: planting.actuals?.tpOrDsDate
      ? new Date(planting.actuals.tpOrDsDate)
      : undefined,
    actualBeginningOfHarvest: planting.actuals?.beginningOfHarvest
      ? new Date(planting.actuals.beginningOfHarvest)
      : undefined,
    actualEndOfHarvest: planting.actuals?.endOfHarvest
      ? new Date(planting.actuals.endOfHarvest)
      : undefined,
    getFollowedCropEndDate,
  };

  // Calculate timing
  const timing = calculateCropTiming(timingInputs);

  // Format dates as ISO strings
  const startDate = format(timing.tpOrDsDate, "yyyy-MM-dd'T'HH:mm:ss");
  const endDate = format(timing.endDate, "yyyy-MM-dd'T'HH:mm:ss");
  const harvestStartDate = format(timing.beginningOfHarvest, "yyyy-MM-dd'T'HH:mm:ss");

  // Calculate feet needed
  const feetNeeded = planting.bedsCount * STANDARD_BED_FT;

  // Build display name
  const name = config.product && config.product !== 'General'
    ? `${config.crop} (${config.product})`
    : config.crop;

  // Handle unassigned plantings
  if (!planting.bed) {
    return [{
      id: `${planting.id}_unassigned`,
      name,
      startDate,
      endDate,
      harvestStartDate,
      resource: '',
      category: config.category,
      feetNeeded,
      structure: config.growingStructure,
      plantingId: planting.id,
      cropConfigId: planting.cropConfigId,
      totalBeds: 1,
      bedIndex: 1,
      groupId: planting.id,
      plantingMethod: config.plantingMethod,
    }];
  }

  // Calculate bed span
  const spanResult = calculateRowSpan(feetNeeded, planting.bed, bedGroups);

  // Create a TimelineCrop for each bed in the span
  return spanResult.bedSpanInfo.map((info: BedSpanInfo, index: number) => ({
    id: `${planting.id}_bed${index}`,
    name,
    startDate,
    endDate,
    harvestStartDate,
    resource: info.bed,
    category: config.category,
    feetNeeded,
    structure: config.growingStructure,
    plantingId: planting.id,
    cropConfigId: planting.cropConfigId,
    totalBeds: spanResult.bedSpanInfo.length,
    bedIndex: index + 1,
    groupId: planting.id,
    feetUsed: info.feetUsed,
    bedCapacityFt: info.bedCapacityFt,
    plantingMethod: config.plantingMethod,
  }));
}

// =============================================================================
// RECALCULATION HELPERS
// =============================================================================

/**
 * Recalculate timeline crops that use a specific config.
 * Used after saving a crop config to update existing timeline entries.
 *
 * @param crops - Current timeline crops
 * @param configIdentifier - The crop config identifier that was updated
 * @param catalog - Fresh crop catalog with updated config
 * @param bedGroups - Bed groupings for span calculation
 * @returns Updated array of timeline crops with recalculated dates
 */
export function recalculateCropsForConfig(
  crops: TimelineCrop[],
  configIdentifier: string,
  catalog: CropCatalogEntry[],
  bedGroups: Record<string, string[]>
): TimelineCrop[] {
  const config = lookupConfigFromCatalog(configIdentifier, catalog);
  if (!config) {
    // Config not found, return crops unchanged
    return crops;
  }

  // Group crops by groupId to process each planting once
  const groupedCrops = new Map<string, TimelineCrop[]>();
  for (const crop of crops) {
    if (!groupedCrops.has(crop.groupId)) {
      groupedCrops.set(crop.groupId, []);
    }
    groupedCrops.get(crop.groupId)!.push(crop);
  }

  const result: TimelineCrop[] = [];

  for (const [groupId, groupCrops] of groupedCrops) {
    const firstCrop = groupCrops[0];

    // Only recalculate if this planting uses the updated config
    if (firstCrop.cropConfigId !== configIdentifier) {
      result.push(...groupCrops);
      continue;
    }

    // Extract slim planting from existing timeline crop
    const slim: SlimPlanting = {
      id: firstCrop.plantingId || groupId,
      cropConfigId: configIdentifier,
      bed: firstCrop.resource || null,
      bedsCount: (firstCrop.feetNeeded || 50) / STANDARD_BED_FT,
      fixedFieldStartDate: firstCrop.startDate, // Use current start as fixed date
    };

    // Recalculate with fresh config
    const recalculated = computeTimelineCrop(slim, config, bedGroups);

    // Preserve any non-calculated fields from original crops
    for (let i = 0; i < recalculated.length; i++) {
      const original = groupCrops.find(c => c.bedIndex === recalculated[i].bedIndex);
      if (original) {
        recalculated[i] = {
          ...recalculated[i],
          id: original.id, // Preserve original ID for React keys
          bgColor: original.bgColor,
          textColor: original.textColor,
          lastModified: Date.now(),
        };
      }
    }

    result.push(...recalculated);
  }

  return result;
}

// =============================================================================
// CONVERSION HELPERS
// =============================================================================

/**
 * Safely parse a number that might be stored as a date string (data bug).
 */
function safeParseNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Check if it's a date string (data bug - dates stored in number fields)
    if (value.includes('T') || value.includes('-')) {
      return undefined; // Ignore bad data
    }
    const num = parseFloat(value);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

/**
 * Extract slim planting data from a bed-plan assignment.
 * Used for testing parity between old fat data and new computed data.
 */
export function extractSlimPlanting(assignment: {
  identifier: string;
  crop: string;
  bed: string;
  bedsCount?: number;
  fixedFieldStartDate?: string | null;
  followsCrop?: string | null;
  followOffset?: number | null;
  additionalDaysOfHarvest?: number | string | null;
  additionalDaysInField?: number | string | null;
  additionalDaysInCells?: number | string | null;
  actualGreenhouseDate?: string | null;
  actualTpOrDsDate?: string | null;
  actualBeginningOfHarvest?: string | null;
  actualEndOfHarvest?: string | null;
  failed?: boolean | null;
}): SlimPlanting {
  return {
    id: assignment.identifier,
    cropConfigId: assignment.crop, // For now, use the full crop identifier as the config ID
    bed: assignment.bed || null,
    bedsCount: assignment.bedsCount ?? 1,
    fixedFieldStartDate: assignment.fixedFieldStartDate ?? undefined,
    followsCrop: assignment.followsCrop ?? undefined,
    followOffset: assignment.followOffset ?? undefined,
    overrides: {
      additionalDaysOfHarvest: safeParseNumber(assignment.additionalDaysOfHarvest),
      additionalDaysInField: safeParseNumber(assignment.additionalDaysInField),
      additionalDaysInCells: safeParseNumber(assignment.additionalDaysInCells),
    },
    actuals: {
      greenhouseDate: assignment.actualGreenhouseDate ?? undefined,
      tpOrDsDate: assignment.actualTpOrDsDate ?? undefined,
      beginningOfHarvest: assignment.actualBeginningOfHarvest ?? undefined,
      endOfHarvest: assignment.actualEndOfHarvest ?? undefined,
      failed: assignment.failed ?? undefined,
    },
  };
}

/**
 * Extract config lookup data from a bed-plan assignment.
 * Used for testing parity - in production this would come from the catalog.
 *
 * @param useTrueHarvestWindow - If true, use trueHarvestWindow for parity testing
 *   when additionalDaysOfHarvest is corrupted (date string instead of number).
 */
export function extractConfigLookup(assignment: {
  crop: string;
  category?: string | number | null;
  growingStructure?: string | null;
  dsTp?: 'DS' | 'TP' | null;
  dtm?: number | null;
  harvestWindow?: number | null;
  trueHarvestWindow?: number | null;
  daysInCells?: number | null;
  additionalDaysOfHarvest?: number | string | null;
}, useTrueHarvestWindow = false): PlantingConfigLookup {
  // Parse crop name and product from the identifier string
  // Format: "Crop - Product X | Structure Method Season"
  const parts = assignment.crop.split(' | ')[0].split(' - ');
  const cropName = parts[0];
  const product = parts[1]?.replace(/ \dX$/, '') ?? 'General'; // Remove "1X" suffix

  // For parity testing, use trueHarvestWindow when available.
  // This field contains the actual window used in the stored data,
  // which may differ from harvestWindow + additionalDaysOfHarvest.
  let harvestWindow = assignment.harvestWindow ?? 0;
  if (useTrueHarvestWindow && assignment.trueHarvestWindow != null) {
    harvestWindow = assignment.trueHarvestWindow;
  }

  // Handle category being a number (data quality issue)
  const category = typeof assignment.category === 'number'
    ? ''
    : (assignment.category ?? '');

  return {
    crop: cropName,
    product,
    category,
    growingStructure: assignment.growingStructure ?? 'Field',
    plantingMethod: assignment.dsTp ?? 'DS',
    dtm: assignment.dtm ?? 0,
    harvestWindow,
    daysInCells: assignment.daysInCells ?? 0,
  };
}
