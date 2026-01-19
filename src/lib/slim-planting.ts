/**
 * Slim Planting Types and Computation
 *
 * This module defines the minimal data needed to store a planting,
 * and computes the full TimelineCrop at runtime from catalog lookups.
 */

import { format } from 'date-fns';
import { calculateCropTiming, type CropTimingInputs } from './crop-timing-calculator';
import { calculateRowSpan } from './timeline-data';
import type { TimelineCrop, BedSpanInfo, Planting } from './plan-types';
import {
  calculateDaysInCells,
  calculatePlantingMethod,
  getPrimarySeedToHarvest,
  calculateAggregateHarvestWindow,
  getPrimaryProductName,
  type CropConfig,
} from './entities/crop-config';
import { createPlanting } from './entities/planting';

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

  /** Growing structure: "field", "greenhouse", "high-tunnel" */
  growingStructure: string;

  /** Planting method */
  plantingMethod: 'direct-seed' | 'transplant' | 'perennial';

  /** Days to maturity */
  dtm: number;

  /** Days of harvest window */
  harvestWindow: number;

  /** Days in greenhouse cells (0 = direct seed) */
  daysInCells: number;

  /** Seeds needed per 50ft bed (for ordering calculations) */
  seedsPerBed?: number;
}

/**
 * Raw crop entry from crop catalog (template or plan-specific).
 * This matches the CropConfig type from entities/crop-config.ts
 */
export type CropCatalogEntry = CropConfig;

/**
 * Look up planting config from the crops catalog by identifier.
 *
 * @param cropIdentifier - The crop identifier (e.g., "Arugula - Baby Leaf 1X | Field DS Sp")
 * @param catalog - Array of crop entries from the crop catalog
 * @param products - Optional product lookup map for deriving product name
 * @returns PlantingConfigLookup or null if not found
 */
export function lookupConfigFromCatalog(
  cropIdentifier: string,
  catalog: CropCatalogEntry[],
  products?: Record<string, { product: string }>
): PlantingConfigLookup | null {
  // Trim both to handle trailing whitespace in legacy data
  const trimmedId = cropIdentifier.trim();
  const entry = catalog.find(c => c.identifier.trim() === trimmedId);
  if (!entry) return null;

  // Calculate derived fields from the minimal crop config
  // Uses product-aware calculations if productYields exists
  const daysInCells = calculateDaysInCells(entry);
  const seedToHarvest = getPrimarySeedToHarvest(entry);
  const plantingMethod = calculatePlantingMethod(entry);
  const harvestWindow = calculateAggregateHarvestWindow(entry);

  return {
    crop: entry.crop,
    product: getPrimaryProductName(entry, products),
    category: entry.category ?? '',
    growingStructure: entry.growingStructure || 'field',
    plantingMethod,
    dtm: seedToHarvest, // Use seedToHarvest for timeline calculations
    harvestWindow,
    daysInCells,
    seedsPerBed: entry.seedsPerBed,
  };
}

// =============================================================================
// EFFECTIVE TIMING RESOLUTION
// =============================================================================

/**
 * Effective timing values after applying overrides with sensible clamping.
 * This is the single source of truth for resolved timing values.
 */
export interface EffectiveTiming {
  /** Effective days to maturity (base + override, min 1) */
  dtm: number;
  /** Effective harvest window (base + override, min 0) */
  harvestWindow: number;
  /** Effective days in greenhouse (base + override, min 0) */
  daysInCells: number;
}

/**
 * Resolve effective timing values by coalescing overrides onto base config.
 *
 * Applies the pattern: planting overrides → base config → defaults
 * Clamps values to sensible minimums to prevent invalid states.
 *
 * @param baseConfig - Config values from the catalog
 * @param overrides - Planting-level adjustments (additive)
 * @returns Resolved effective values with clamping applied
 */
export function resolveEffectiveTiming(
  baseConfig: Pick<PlantingConfigLookup, 'dtm' | 'harvestWindow' | 'daysInCells'>,
  overrides?: SlimPlanting['overrides']
): EffectiveTiming {
  const additionalDaysInField = overrides?.additionalDaysInField ?? 0;
  const additionalDaysInCells = overrides?.additionalDaysInCells ?? 0;
  const additionalDaysOfHarvest = overrides?.additionalDaysOfHarvest ?? 0;

  return {
    // DTM can go negative (harvest before field date) but clamp to at least 1 day
    // to prevent zero-duration or time-traveling crops
    dtm: Math.max(1, baseConfig.dtm + additionalDaysInField),
    // Harvest window: 0 = single-day harvest (valid), can't be negative
    harvestWindow: Math.max(0, baseConfig.harvestWindow + additionalDaysOfHarvest),
    // Greenhouse time: 0 = direct seed (valid), can't be negative
    daysInCells: Math.max(0, baseConfig.daysInCells + additionalDaysInCells),
  };
}

// =============================================================================
// COMPUTATION
// =============================================================================

/**
 * Standard bed length used for bedsCount conversion in legacy import data.
 * The SlimPlanting.bedsCount field stores bed fractions based on 50ft beds
 * (e.g., 0.4 = 20ft, 1.0 = 50ft). This constant is ONLY for converting
 * that legacy format - actual bed lengths come from Bed.lengthFt.
 */
const LEGACY_IMPORT_BED_FT = 50;

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
  // Resolve effective timing values with overrides and clamping
  const effective = resolveEffectiveTiming(config, planting.overrides);

  const timingInputs: CropTimingInputs = {
    dtm: effective.dtm,
    harvestWindow: effective.harvestWindow,
    daysInCells: effective.daysInCells,
    fixedFieldStartDate: planting.fixedFieldStartDate
      ? new Date(planting.fixedFieldStartDate)
      : undefined,
    followsCrop: planting.followsCrop,
    followOffset: planting.followOffset ?? 0,
    additionalDaysOfHarvest: 0, // Already applied via resolveEffectiveTiming
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

  // Calculate feet needed from legacy bedsCount format
  const feetNeeded = planting.bedsCount * LEGACY_IMPORT_BED_FT;

  // Build display name - include product if not 'General'
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
    // Convert feet back to legacy bedsCount format for recalculation
    const slim: SlimPlanting = {
      id: firstCrop.plantingId || groupId,
      cropConfigId: configIdentifier,
      bed: firstCrop.resource || null,
      bedsCount: (firstCrop.feetNeeded || 50) / LEGACY_IMPORT_BED_FT,
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

  // Map old values to new naming convention
  const growingStructureMap: Record<string, string> = {
    'Field': 'field', 'Greenhouse': 'greenhouse', 'GH': 'greenhouse',
    'Tunnel': 'high-tunnel', 'HT': 'high-tunnel',
  };
  const plantingMethodMap: Record<string, 'direct-seed' | 'transplant' | 'perennial'> = {
    'DS': 'direct-seed', 'TP': 'transplant', 'PE': 'perennial',
  };

  const gs = assignment.growingStructure ?? 'Field';
  const pm = assignment.dsTp ?? 'DS';

  return {
    crop: cropName,
    product,
    category,
    growingStructure: growingStructureMap[gs] ?? gs,
    plantingMethod: plantingMethodMap[pm] ?? 'direct-seed',
    dtm: assignment.dtm ?? 0,
    harvestWindow,
    daysInCells: assignment.daysInCells ?? 0,
  };
}

/**
 * Collapse TimelineCrop[] (one per bed) to Planting[] (one per decision).
 * Used to convert TimelineCrop[] (from bed-plan.json import) to Planting[].
 *
 * Uses the createPlanting CRUD function for consistent object creation.
 *
 * @param crops - Array of TimelineCrop entries (multiple per planting)
 * @returns Array of Planting entries (one per planting decision)
 */
export function collapseToPlantings(crops: TimelineCrop[]): Planting[] {
  // Group crops by groupId (all beds of same planting share groupId)
  const groups = new Map<string, TimelineCrop[]>();
  for (const crop of crops) {
    const list = groups.get(crop.groupId) || [];
    list.push(crop);
    groups.set(crop.groupId, list);
  }

  // Convert each group to a single Planting using CRUD function
  return Array.from(groups.values()).map(beds => {
    const first = beds[0];

    // Find the entry with bedIndex=1 to get the starting bed
    const startBedEntry = beds.find(b => b.bedIndex === 1);

    // Sum feetUsed across all beds for total bedFeet
    // Default to 50ft per bed if feetUsed not set
    const totalFeet = beds.reduce((sum, b) => sum + (b.feetUsed || 50), 0);

    // Use CRUD function for consistent Planting creation
    // Pass existing ID to preserve it during import
    return createPlanting({
      id: first.plantingId || first.groupId,
      configId: first.cropConfigId,
      fieldStartDate: first.startDate,
      startBed: startBedEntry?.resource || null,
      bedFeet: totalFeet,
      seedSource: first.seedSource,
      overrides: first.overrides,
      notes: first.notes,
    });
  });
}
