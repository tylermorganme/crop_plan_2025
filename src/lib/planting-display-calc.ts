/**
 * Planting Display Calculation
 *
 * Transforms raw storage Planting entities into display-ready TimelineCrop entries.
 *
 * Data Flow:
 *   Planting (storage) → PlantingWithDates (computed) → TimelineCrop (1:1 display)
 *
 * This module:
 * - Resolves config values with overrides
 * - Calculates all dates (field, greenhouse, harvest)
 * - Creates one TimelineCrop per planting (bed spanning computed at render time)
 */

import { format } from 'date-fns';
import { calculateCropTiming, type CropTimingInputs } from './crop-timing-calculator';
import type { TimelineCrop, Planting } from './plan-types';
import type { GddCalculator } from './gdd';
import { NON_FIELD_STRUCTURE_OFFSET } from './gdd';
import {
  calculateDaysInCells,
  calculatePlantingMethod,
  getPrimarySeedToHarvest,
  calculateAggregateHarvestWindow,
  getPrimaryProductName,
  type PlantingSpec,
} from './entities/planting-specs';
import { createPlanting } from './entities/planting';
import { parseLocalDate, parseLocalDateOrNull } from './date-utils';

// =============================================================================
// PLANTING WITH COMPUTED DATES
// =============================================================================

/**
 * Planting entity with computed dates and effective timing values.
 *
 * This is the intermediate format between raw storage (Planting entity)
 * and display format (TimelineCrop[]). Contains all calculated dates
 * (field date, harvest dates) and resolved config values (DTM, harvest window).
 *
 * Used for: Converting storage format → display format with all dates calculated
 */
export interface PlantingWithDates {
  /** Unique planting identifier, e.g., "ARU001" */
  id: string;

  /** Reference to planting config in catalog */
  specId: string;

  /** Assigned bed, or null if unassigned */
  bed: string | null;

  /** Total feet needed for this planting */
  bedFeet: number;

  /** Fixed field start date (ISO string) - when crop enters field */
  fixedFieldStartDate?: string;

  /** Use GDD-based timing instead of static DTM */
  useGddTiming?: boolean;

  /** Overrides to default config values */
  overrides?: {
    additionalDaysOfHarvest?: number;
    additionalDaysInField?: number;
    additionalDaysInCells?: number;
  };

  /** Actual dates (for tracking variance from plan) */
  actuals?: {
    greenhouseDate?: string;
    fieldDate?: string;
    failed?: boolean;
  };
}

/**
 * Config data needed from the planting catalog to compute timeline.
 */
export interface PlantingConfigLookup {
  /** Crop name, e.g., "Arugula" */
  crop: string;

  /** Crop entity ID for stable linking */
  cropId?: string;

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

  // ---- GDD Fields ----

  /** Target field date for GDD reference (MM-DD format) */
  targetFieldDate?: string;

  /** GDD base temperature (°F) - from Crop entity */
  gddBaseTemp?: number;

  /** GDD ceiling temperature (°F) - from Crop entity */
  gddUpperTemp?: number;
}

/**
 * Raw crop entry from crop catalog (template or plan-specific).
 * This matches the PlantingSpec type from entities/crop-config.ts
 */
export type CropCatalogEntry = PlantingSpec;

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

  // Calculate derived fields from the minimal planting spec
  // Uses product-aware calculations if productYields exists
  const daysInCells = calculateDaysInCells(entry);
  const seedToHarvest = getPrimarySeedToHarvest(entry);
  const plantingMethod = calculatePlantingMethod(entry);
  const harvestWindow = calculateAggregateHarvestWindow(entry);

  return {
    crop: entry.crop,
    cropId: entry.cropId,
    product: getPrimaryProductName(entry, products),
    category: entry.category ?? '',
    growingStructure: entry.growingStructure || 'field',
    plantingMethod,
    dtm: seedToHarvest, // Use seedToHarvest for timeline calculations
    harvestWindow,
    daysInCells,
    seedsPerBed: entry.seedsPerBed,
    targetFieldDate: entry.targetFieldDate,
    // Note: gddBaseTemp and gddUpperTemp come from Crop entity,
    // must be enriched by caller with access to plan.crops
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
  overrides?: PlantingWithDates['overrides']
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
 * Converts a planting (with computed dates) into a single TimelineCrop.
 *
 * Takes: PlantingWithDates (one planting, dates calculated)
 * Returns: TimelineCrop (1:1 mapping - one crop per planting)
 *
 * Bed spanning (totalBeds, bedIndex, feetUsed) is computed at render time
 * in CropTimeline, not here. This keeps the data model simple and makes
 * drag preview trivial.
 *
 * @param planting - Planting with computed dates and effective config
 * @param config - Config values looked up from catalog
 * @param _bedGroups - Unused (bed spanning moved to render time)
 * @param _bedLengths - Unused (bed spanning moved to render time)
 * @param getFollowedCropEndDate - Optional callback for succession lookups
 * @param gddCalculator - Optional GDD calculator for adjusted timing
 * @returns Single TimelineCrop object
 */
export function expandToTimelineCrops(
  planting: PlantingWithDates,
  config: PlantingConfigLookup,
  _bedGroups: Record<string, string[]>,
  _bedLengths: Record<string, number>,
  getFollowedCropEndDate?: (identifier: string) => Date | null,
  gddCalculator?: GddCalculator
): TimelineCrop[] {
  // ==========================================================================
  // TIMING COALESCING ORDER:
  // 1. Base field days from spec (no overrides)
  // 2. Effective field date = actuals.fieldDate ?? plannedFieldDate
  // 3. Coalesced field days = GDD-adjusted (if enabled) or base
  // 4. Final values = coalesced + overrides (additionalDaysInField is additive)
  // ==========================================================================

  // Step 1: Get BASE timing from config (no overrides yet for GDD reference)
  const baseDtm = config.dtm;
  const baseDaysInCells = config.daysInCells;
  const baseFieldDays = baseDtm - baseDaysInCells;
  const baseHarvestWindow = config.harvestWindow;

  // Step 2: Determine effective field date (actuals override planned)
  const effectiveFieldDate = planting.actuals?.fieldDate ?? planting.fixedFieldStartDate;

  // Step 3: Calculate coalesced field days (GDD-adjusted or static)
  let coalescedFieldDays = baseFieldDays;

  if (
    planting.useGddTiming &&
    gddCalculator &&
    config.targetFieldDate &&
    config.gddBaseTemp !== undefined &&
    effectiveFieldDate
  ) {
    // Calculate structure offset for non-field structures
    const structureOffset =
      config.growingStructure && config.growingStructure !== 'field'
        ? NON_FIELD_STRUCTURE_OFFSET
        : 0;

    // Get GDD-adjusted field days using effective (actual or planned) field date
    const adjustedFieldDays = gddCalculator.getAdjustedFieldDays(
      baseFieldDays,
      config.targetFieldDate,
      effectiveFieldDate.split('T')[0], // Extract date part
      config.gddBaseTemp,
      config.gddUpperTemp,
      structureOffset
    );

    if (adjustedFieldDays !== null) {
      coalescedFieldDays = Math.round(adjustedFieldDays);
    }
  }

  // Step 4: Apply overrides ON TOP of coalesced result
  const additionalDaysInField = planting.overrides?.additionalDaysInField ?? 0;
  const additionalDaysInCells = planting.overrides?.additionalDaysInCells ?? 0;
  const additionalDaysOfHarvest = planting.overrides?.additionalDaysOfHarvest ?? 0;

  const finalDaysInCells = Math.max(0, baseDaysInCells + additionalDaysInCells);
  const finalFieldDays = Math.max(1, coalescedFieldDays + additionalDaysInField);
  const finalDtm = finalDaysInCells + finalFieldDays;
  const finalHarvestWindow = Math.max(0, baseHarvestWindow + additionalDaysOfHarvest);

  const timingInputs: CropTimingInputs = {
    dtm: finalDtm,
    harvestWindow: finalHarvestWindow,
    daysInCells: finalDaysInCells,
    fixedFieldStartDate: effectiveFieldDate
      ? parseLocalDate(effectiveFieldDate)
      : undefined,
    additionalDaysOfHarvest: 0, // Already applied above
    // Use parseLocalDateOrNull for actuals since they come from user input
    // and may be incomplete (e.g., mid-entry "2025-01") or invalid
    actualGreenhouseDate: parseLocalDateOrNull(planting.actuals?.greenhouseDate) ?? undefined,
    actualTpOrDsDate: parseLocalDateOrNull(planting.actuals?.fieldDate) ?? undefined,
    getFollowedCropEndDate,
  };

  // Calculate timing
  const timing = calculateCropTiming(timingInputs);

  // Format dates as ISO strings
  const startDate = format(timing.tpOrDsDate, "yyyy-MM-dd'T'HH:mm:ss");
  const endDate = format(timing.endDate, "yyyy-MM-dd'T'HH:mm:ss");
  const harvestStartDate = format(timing.beginningOfHarvest, "yyyy-MM-dd'T'HH:mm:ss");

  // Use bedFeet directly
  const feetNeeded = planting.bedFeet;

  // Build display name - include product if not 'General'
  const name = config.product && config.product !== 'General'
    ? `${config.crop} (${config.product})`
    : config.crop;

  // Return single TimelineCrop (1:1 with planting)
  // Bed spanning (totalBeds, bedIndex) computed at render time in CropTimeline
  return [{
    id: planting.id,
    name,
    startDate,
    endDate,
    harvestStartDate,
    resource: planting.bed || '',  // Start bed name, or '' for unassigned
    category: config.category,
    feetNeeded,
    structure: config.growingStructure,
    growingStructure: config.growingStructure as 'field' | 'greenhouse' | 'high-tunnel' | undefined,
    plantingId: planting.id,
    specId: planting.specId,
    totalBeds: 1,   // Default - computed at render time
    bedIndex: 1,    // Default - computed at render time
    groupId: planting.id,
    plantingMethod: config.plantingMethod,
    actuals: planting.actuals,
  }];
}

// =============================================================================
// RECALCULATION HELPERS
// =============================================================================

/**
 * Recalculate timeline crops that use a specific config.
 * Used after saving a planting spec to update existing timeline entries.
 *
 * @param crops - Current timeline crops
 * @param specIdentifier - The planting spec identifier that was updated
 * @param catalog - Fresh crop catalog with updated config
 * @param bedGroups - Bed groupings for span calculation
 * @param bedLengths - Bed lengths mapping (bed name -> feet)
 * @returns Updated array of timeline crops with recalculated dates
 */
export function recalculateCropsForConfig(
  crops: TimelineCrop[],
  specIdentifier: string,
  catalog: CropCatalogEntry[],
  bedGroups: Record<string, string[]>,
  bedLengths: Record<string, number>
): TimelineCrop[] {
  const spec = lookupConfigFromCatalog(specIdentifier, catalog);
  if (!spec) {
    // Spec not found, return crops unchanged
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
    if (firstCrop.specId !== specIdentifier) {
      result.push(...groupCrops);
      continue;
    }

    // Extract slim planting from existing timeline crop
    const slim: PlantingWithDates = {
      id: firstCrop.plantingId || groupId,
      specId: specIdentifier,
      bed: firstCrop.resource || null,
      bedFeet: firstCrop.feetNeeded,
      fixedFieldStartDate: firstCrop.startDate, // Use current start as fixed date
    };

    // Recalculate with fresh spec
    const recalculated = expandToTimelineCrops(slim, spec, bedGroups, bedLengths);

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
 * Extracts planting data from legacy import/assignment format.
 *
 * Converts: RawAssignment (import format)
 * To: PlantingWithDates (normalized with dates)
 *
 * Used for: Legacy Excel imports and testing parity
 */
export function extractPlantingFromImport(assignment: {
  identifier: string;
  crop: string;
  bed: string;
  bedFeet?: number;
  fixedFieldStartDate?: string | null;
  additionalDaysOfHarvest?: number | string | null;
  additionalDaysInField?: number | string | null;
  additionalDaysInCells?: number | string | null;
  actualGreenhouseDate?: string | null;
  actualFieldDate?: string | null;
  failed?: boolean | null;
}): PlantingWithDates {
  return {
    id: assignment.identifier,
    specId: assignment.crop, // For now, use the full crop identifier as the config ID
    bed: assignment.bed || null,
    bedFeet: assignment.bedFeet ?? 50,
    fixedFieldStartDate: assignment.fixedFieldStartDate ?? undefined,
    overrides: {
      additionalDaysOfHarvest: safeParseNumber(assignment.additionalDaysOfHarvest),
      additionalDaysInField: safeParseNumber(assignment.additionalDaysInField),
      additionalDaysInCells: safeParseNumber(assignment.additionalDaysInCells),
    },
    actuals: {
      greenhouseDate: assignment.actualGreenhouseDate ?? undefined,
      fieldDate: assignment.actualFieldDate ?? undefined,
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
      specId: first.specId,
      fieldStartDate: first.startDate,
      startBed: startBedEntry?.resource || null,
      bedFeet: totalFeet,
      seedSource: first.seedSource,
      overrides: first.overrides,
      notes: first.notes,
    });
  });
}
