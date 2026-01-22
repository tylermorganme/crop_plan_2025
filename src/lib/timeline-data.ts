/**
 * Transform crop data for the timeline view
 */

import { parseISO } from 'date-fns';
import cropsData from '@/data/crop-config-template.json';
import bedPlanData from '@/data/bed-template.json';

// Re-export types from plan-types for backwards compatibility
export type { TimelineCrop, ResourceGroup, BedSpanInfo } from './plan-types';
import type { TimelineCrop, ResourceGroup, BedSpanInfo } from './plan-types';
import type { SeedSource } from './entities/planting';
import { getStockVarieties, getStockSeedMixes } from './stock-data';
import { getVarietyKey } from './entities/variety';

// Import slim planting computation
import {
  computeTimelineCrop,
  extractSlimPlanting,
  lookupConfigFromCatalog,
  collapseToPlantings,
  type SlimPlanting,
  type CropCatalogEntry,
} from './slim-planting';

// Import plan types
import type { Plan, Planting, Bed, BedGroup } from './plan-types';
import { getBedGroup, getBedNumber, getBedLengthFromId } from './plan-types';

// Re-export for consumers
export type { CropCatalogEntry };

// Default catalog from static import (for backwards compatibility)
const defaultCatalog = (cropsData as { crops: CropCatalogEntry[] }).crops;


interface BedAssignment {
  crop: string;
  identifier: string;
  bed: string;
  bedsCount?: number;  // Number of 50ft beds (e.g., 0.4 = 20ft, 1 = 50ft, 2 = 100ft)
  // Dates from the bed plan (for comparison/fallback)
  tpOrDsDate: string;
  endOfHarvest: string;
  beginningOfHarvest: string;
  // Config fields (for computation)
  dtm?: number;
  harvestWindow?: number;
  trueHarvestWindow?: number;
  daysInCells?: number;
  // Input fields (for computation)
  fixedFieldStartDate?: string | null;
  // Override fields
  additionalDaysOfHarvest?: number | string | null;
  additionalDaysInField?: number | string | null;
  additionalDaysInCells?: number | string | null;
  // Actual fields
  actualGreenhouseDate?: string | null;
  actualFieldDate?: string | null;
  failed?: boolean | null;
  // Additional metadata
  category?: string | number;
  growingStructure?: string;
  dsTp?: 'DS' | 'TP';
  // Seed source (from Excel Bed Plan sheet)
  seedSourceName?: string;
  seedSourceSupplier?: string | null;
  seedSourceIsMix?: boolean;
}

interface BedPlanData {
  assignments: BedAssignment[];
  beds: string[];
  bedGroups: Record<string, string[]>;
}

/**
 * Standard bed length used for bedsCount conversion in legacy import data.
 * bed-plan.json stores bedsCount as fractions of 50ft beds (e.g., 0.4 = 20ft).
 * This constant is ONLY for converting that legacy format - actual bed lengths
 * come from the Bed entity's lengthFt property.
 */
const LEGACY_IMPORT_BED_FT = 50;

// Cache for seed source resolution
let seedSourceCache: {
  varietyByKey: Map<string, string>;
  mixByName: Map<string, string>;
} | null = null;

/**
 * Resolve seed source from assignment fields to a SeedSource reference.
 * Looks up variety by crop/name/supplier or mix by name.
 */
function resolveSeedSource(assignment: BedAssignment): SeedSource | undefined {
  if (!assignment.seedSourceName) {
    return undefined;
  }

  // Build cache on first use
  if (!seedSourceCache) {
    const varieties = getStockVarieties();
    const mixes = getStockSeedMixes();

    const varietyByKey = new Map<string, string>();
    for (const v of Object.values(varieties)) {
      varietyByKey.set(getVarietyKey(v), v.id);
    }

    const mixByName = new Map<string, string>();
    for (const m of Object.values(mixes)) {
      // Key by lowercase name for fuzzy matching
      mixByName.set(m.name.toLowerCase(), m.id);
    }

    seedSourceCache = { varietyByKey, mixByName };
  }

  const { varietyByKey, mixByName } = seedSourceCache;

  if (assignment.seedSourceIsMix) {
    // Look up mix by name
    const mixId = mixByName.get(assignment.seedSourceName.toLowerCase());
    if (mixId) {
      return { type: 'mix', id: mixId };
    }
  } else {
    // Look up variety by crop/name/supplier
    // Extract crop from the assignment.crop field (e.g., "basil (tulsi) - mature leaf 1x | field tp")
    // Strip parenthetical qualifiers like "(tulsi)" or "(4x9)" to get base crop name
    const cropMatch = assignment.crop.match(/^([^(-]+)/);
    const crop = cropMatch ? cropMatch[1].trim() : '';

    const varietyKey = `${crop}|${assignment.seedSourceName}|${assignment.seedSourceSupplier || ''}`.toLowerCase().trim();
    const varietyId = varietyByKey.get(varietyKey);
    if (varietyId) {
      return { type: 'variety', id: varietyId };
    }
  }

  return undefined;
}

/**
 * Calculate how many beds a crop spans based on feetNeeded and the starting bed.
 * Returns spanBeds (the actual beds), and bedSpanInfo with feet used per bed.
 *
 * @param feetNeeded - Total feet needed for the planting
 * @param startBed - The starting bed (e.g., "J2")
 * @param bedGroups - Optional bed groups mapping (defaults to bedPlanData)
 */
export function calculateRowSpan(feetNeeded: number, startBed: string, bedGroups?: Record<string, string[]>): {
  rowSpan: number;
  spanBeds: string[];
  bedSpanInfo: BedSpanInfo[];
  isComplete: boolean;
  feetNeeded: number;
  feetAvailable: number;
} {
  const groups = bedGroups || (bedPlanData as BedPlanData).bedGroups;
  const row = getBedGroup(startBed);
  const bedSizeFt = getBedLengthFromId(startBed);

  // Default to one bed if no feet specified
  if (!feetNeeded || feetNeeded <= 0) {
    return {
      rowSpan: 1,
      spanBeds: [startBed],
      bedSpanInfo: [{ bed: startBed, feetUsed: bedSizeFt, bedCapacityFt: bedSizeFt }],
      isComplete: true,
      feetNeeded: bedSizeFt,
      feetAvailable: bedSizeFt
    };
  }

  // Get available beds in this row, sorted numerically
  const rowBeds = (groups[row] || []).sort((a, b) => getBedNumber(a) - getBedNumber(b));

  // Find beds starting from startBed
  const startIndex = rowBeds.findIndex(b => b === startBed);
  if (startIndex === -1) {
    return {
      rowSpan: 1,
      spanBeds: [startBed],
      bedSpanInfo: [{ bed: startBed, feetUsed: Math.min(feetNeeded, bedSizeFt), bedCapacityFt: bedSizeFt }],
      isComplete: feetNeeded <= bedSizeFt,
      feetNeeded,
      feetAvailable: bedSizeFt
    };
  }

  // Collect consecutive beds until we have enough footage
  const spanBeds: string[] = [];
  const bedSpanInfo: BedSpanInfo[] = [];
  let remainingFeet = feetNeeded;
  let feetAvailable = 0;

  for (let i = startIndex; i < rowBeds.length && remainingFeet > 0; i++) {
    const bed = rowBeds[i];
    const thisBedCapacity = getBedLengthFromId(bed);
    const feetUsed = Math.min(remainingFeet, thisBedCapacity);

    spanBeds.push(bed);
    bedSpanInfo.push({
      bed,
      feetUsed,
      bedCapacityFt: thisBedCapacity
    });

    feetAvailable += thisBedCapacity;
    remainingFeet -= feetUsed;
  }

  // If we couldn't get any beds, just use the start bed
  if (spanBeds.length === 0) {
    spanBeds.push(startBed);
    bedSpanInfo.push({
      bed: startBed,
      feetUsed: Math.min(feetNeeded, bedSizeFt),
      bedCapacityFt: bedSizeFt
    });
    feetAvailable = bedSizeFt;
  }

  return {
    rowSpan: spanBeds.length,
    spanBeds,
    bedSpanInfo,
    isComplete: feetAvailable >= feetNeeded,
    feetNeeded,
    feetAvailable
  };
}


/**
 * Get crops from bed plan formatted for the timeline.
 * Uses bed-plan.json for planting data and crops.json for config lookups.
 *
 * @param cropCatalog - Optional crop catalog to use instead of static import.
 *   Pass dynamically fetched crops to get live updates after editing configs.
 */
export function getTimelineCrops(cropCatalog?: CropCatalogEntry[]): TimelineCrop[] {
  const bedPlan = bedPlanData as BedPlanData;
  const catalogCrops = cropCatalog || defaultCatalog;

  const timelineCrops: TimelineCrop[] = [];
  const seenIdentifiers = new Set<string>();

  // Group assignments by crop identifier to detect succession plantings
  const assignmentsByCrop = new Map<string, BedAssignment[]>();
  for (const assignment of bedPlan.assignments) {
    const cropId = assignment.crop;
    if (!assignmentsByCrop.has(cropId)) {
      assignmentsByCrop.set(cropId, []);
    }
    assignmentsByCrop.get(cropId)!.push(assignment);
  }

  for (const assignment of bedPlan.assignments) {
    // Skip duplicates
    if (seenIdentifiers.has(assignment.identifier)) {
      continue;
    }
    seenIdentifiers.add(assignment.identifier);

    // Look up config from catalog
    const baseConfig = lookupConfigFromCatalog(assignment.crop, catalogCrops);

    // Build display name from config or parse from identifier
    let name: string;
    if (baseConfig) {
      name = baseConfig.product && baseConfig.product !== 'General'
        ? `${baseConfig.crop} (${baseConfig.product})`
        : baseConfig.crop;
    } else {
      // Fallback: parse from identifier "Crop - Product X | ..."
      const parts = assignment.crop.split(' | ')[0].split(' - ');
      const cropName = parts[0];
      const product = parts[1]?.replace(/ \dX$/, '');
      name = product && product !== 'General' ? `${cropName} (${product})` : cropName;
    }

    // Check if this crop has multiple plantings (succession)
    const allAssignments = assignmentsByCrop.get(assignment.crop) || [];
    const displayName = allAssignments.length > 1 ? `${name} (${assignment.identifier})` : name;

    // Calculate feet needed
    const feetNeeded = (assignment.bedsCount ?? 1) * LEGACY_IMPORT_BED_FT;

    // Resolve seed source from assignment fields
    const seedSource = resolveSeedSource(assignment);

    // If we can compute dates from config, do so
    if (baseConfig && assignment.fixedFieldStartDate) {
      // Extract slim planting
      const slim = extractSlimPlanting(assignment);

      // Apply planting-level overrides to catalog base values
      const additionalDaysInField = typeof assignment.additionalDaysInField === 'number'
        ? assignment.additionalDaysInField : 0;
      const additionalDaysOfHarvest = typeof assignment.additionalDaysOfHarvest === 'number'
        ? assignment.additionalDaysOfHarvest : 0;
      const additionalDaysInCells = typeof assignment.additionalDaysInCells === 'number'
        ? assignment.additionalDaysInCells : 0;

      const config = {
        ...baseConfig,
        dtm: baseConfig.dtm + additionalDaysInField,
        harvestWindow: baseConfig.harvestWindow + additionalDaysOfHarvest,
        daysInCells: baseConfig.daysInCells + additionalDaysInCells,
      };

      // Compute timeline crops with calculated dates
      const computed = computeTimelineCrop(slim, config, bedPlan.bedGroups);

      for (const tc of computed) {
        timelineCrops.push({
          ...tc,
          name: displayName,
          seedSource,
        });
      }
    } else {
      // Fall back to stored dates from bed plan
      const { bedSpanInfo } = calculateRowSpan(feetNeeded, assignment.bed, bedPlan.bedGroups);

      // Get category and structure from assignment or config
      const category = typeof assignment.category === 'number'
        ? (baseConfig?.category || undefined)
        : (assignment.category || baseConfig?.category || undefined);
      const structure = assignment.growingStructure || baseConfig?.growingStructure || 'Field';
      // Map old dsTp values to new naming convention
      const dsTpMap: Record<string, 'direct-seed' | 'transplant' | 'perennial'> = {
        'DS': 'direct-seed', 'TP': 'transplant', 'PE': 'perennial',
      };
      const rawMethod = assignment.dsTp;
      const plantingMethod = rawMethod ? dsTpMap[rawMethod] : baseConfig?.plantingMethod ?? undefined;

      bedSpanInfo.forEach((info, index) => {
        timelineCrops.push({
          id: `${assignment.identifier}_bed${index}`,
          name: displayName,
          startDate: assignment.tpOrDsDate,
          endDate: assignment.endOfHarvest,
          harvestStartDate: assignment.beginningOfHarvest || undefined,
          resource: info.bed,
          category,
          feetNeeded,
          structure,
          plantingId: assignment.identifier,
          cropConfigId: assignment.crop,
          totalBeds: bedSpanInfo.length,
          bedIndex: index + 1,
          groupId: assignment.identifier,
          feetUsed: info.feetUsed,
          bedCapacityFt: info.bedCapacityFt,
          plantingMethod,
          seedSource,
        });
      });
    }
  }

  return timelineCrops.sort((a, b) =>
    parseISO(a.startDate).getTime() - parseISO(b.startDate).getTime()
  );
}

/**
 * Get resources (beds/locations) grouped by row/section from bed plan
 */
export function getResources(): { resources: string[]; groups: ResourceGroup[] } {
  const bedPlan = bedPlanData as BedPlanData;

  const groups: ResourceGroup[] = [];
  const allResources: string[] = [];

  // Use actual bed groups from the bed plan
  // Sort groups: letters first (A-J), then special sections (U, X)
  const sortedGroupKeys = Object.keys(bedPlan.bedGroups).sort((a, b) => {
    // Single letters come first, sorted alphabetically
    if (a.length === 1 && b.length === 1) return a.localeCompare(b);
    if (a.length === 1) return -1;
    if (b.length === 1) return 1;
    return a.localeCompare(b);
  });

  for (const groupKey of sortedGroupKeys) {
    const beds = bedPlan.bedGroups[groupKey];
    // Sort beds within each group numerically
    const sortedBeds = [...beds].sort((a, b) => {
      const numA = parseInt(a.replace(/[^0-9]/g, '')) || 0;
      const numB = parseInt(b.replace(/[^0-9]/g, '')) || 0;
      return numA - numB;
    });

    groups.push({ name: `Row ${groupKey}`, beds: sortedBeds });
    allResources.push(...sortedBeds);
  }

  // Add Unassigned at the end
  allResources.push('Unassigned');
  groups.push({ name: null, beds: ['Unassigned'] });

  return { resources: allResources, groups };
}

/**
 * Summary stats for the timeline
 */
export function getTimelineStats() {
  const crops = getTimelineCrops();
  const { resources } = getResources();

  // Date range
  const dates = crops.map(c => [parseISO(c.startDate), parseISO(c.endDate)]).flat();
  const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

  // Categories
  const categories = new Map<string, number>();
  crops.forEach(c => {
    const cat = c.category || 'Unknown';
    categories.set(cat, (categories.get(cat) || 0) + 1);
  });

  return {
    cropCount: crops.length,
    resourceCount: resources.length - 1, // Exclude Unassigned
    dateRange: { start: minDate, end: maxDate },
    categories: Object.fromEntries(categories),
  };
}

// =============================================================================
// PLAN-BASED TIMELINE (Step 3 migration)
// =============================================================================

/**
 * Build mappings for bed UUID <-> name conversion.
 * Returns:
 * - nameGroups: group name -> bed names (for legacy span calculation)
 * - uuidToName: bed UUID -> bed name
 * - nameToUuid: bed name -> bed UUID
 */
function buildBedMappings(
  beds: Record<string, Bed>,
  bedGroups: Record<string, BedGroup>
): {
  nameGroups: Record<string, string[]>;
  uuidToName: Record<string, string>;
  nameToUuid: Record<string, string>;
  bedLengths: Record<string, number>;
} {
  const nameGroups: Record<string, string[]> = {};
  const uuidToName: Record<string, string> = {};
  const nameToUuid: Record<string, string> = {};
  const bedLengths: Record<string, number> = {};

  // Group beds by their group's name, sorted by displayOrder
  const groupedBeds = new Map<string, Bed[]>();
  for (const bed of Object.values(beds)) {
    const groupName = bedGroups[bed.groupId]?.name ?? 'Unknown';
    if (!groupedBeds.has(groupName)) {
      groupedBeds.set(groupName, []);
    }
    groupedBeds.get(groupName)!.push(bed);
  }

  // Sort and build mappings
  for (const [groupName, bedsInGroup] of groupedBeds) {
    // Sort by displayOrder
    bedsInGroup.sort((a, b) => a.displayOrder - b.displayOrder);

    // Key nameGroups by the letter extracted from bed names (e.g., "H" from "H1")
    // This matches the legacy bedPlanData.bedGroups format that calculateRowSpan expects
    const firstBed = bedsInGroup[0];
    const groupKey = firstBed ? getBedGroup(firstBed.name) : groupName;
    nameGroups[groupKey] = bedsInGroup.map(bed => bed.name);

    for (const bed of bedsInGroup) {
      uuidToName[bed.id] = bed.name;
      nameToUuid[bed.name] = bed.id;
      bedLengths[bed.name] = bed.lengthFt;
    }
  }

  return { nameGroups, uuidToName, nameToUuid, bedLengths };
}

/**
 * Convert Planting entity to SlimPlanting for computeTimelineCrop.
 * Converts bed UUID to bed name for span calculation.
 */
function plantingToSlim(planting: Planting, uuidToName: Record<string, string>): SlimPlanting {
  // Convert bed UUID to name for legacy span calculation
  const bedName = planting.startBed ? uuidToName[planting.startBed] ?? null : null;

  return {
    id: planting.id,
    cropConfigId: planting.configId,
    bed: bedName,
    bedsCount: planting.bedFeet / LEGACY_IMPORT_BED_FT,
    fixedFieldStartDate: planting.fieldStartDate,
    overrides: planting.overrides,
    actuals: planting.actuals,
  };
}

/**
 * Expand Planting[] to TimelineCrop[] for display.
 * Uses the existing computeTimelineCrop function.
 *
 * @param plantings - Array of plantings to expand
 * @param beds - Bed definitions keyed by UUID
 * @param catalog - Crop catalog for config lookup
 * @param bedGroups - Bed group definitions keyed by UUID
 */
export function expandPlantingsToTimelineCrops(
  plantings: Planting[],
  beds: Record<string, Bed>,
  catalog: Record<string, CropCatalogEntry>,
  bedGroups?: Record<string, BedGroup>
): TimelineCrop[] {
  // Build bed mappings for UUID <-> name conversion
  const mappings = bedGroups
    ? buildBedMappings(beds, bedGroups)
    : { nameGroups: {}, uuidToName: {}, nameToUuid: {}, bedLengths: {} };

  const catalogArray = Object.values(catalog);
  const result: TimelineCrop[] = [];

  for (const planting of plantings) {
    // Try plan catalog first, then fall back to default catalog
    let config = lookupConfigFromCatalog(planting.configId, catalogArray);
    if (!config) {
      config = lookupConfigFromCatalog(planting.configId, defaultCatalog);
    }
    if (!config) {
      console.warn(`[expandPlantings] Config not found: ${planting.configId}`);
      continue;
    }

    const slim = plantingToSlim(planting, mappings.uuidToName);
    const crops = computeTimelineCrop(slim, config, mappings.nameGroups);

    // Add planting fields for inspector editing
    // NOTE: crop.resource remains a bed NAME for display matching.
    // The store converts names to UUIDs when mutating.
    for (const crop of crops) {
      crop.lastModified = planting.lastModified;
      crop.overrides = planting.overrides;
      crop.notes = planting.notes;
      crop.seedSource = planting.seedSource;
      crop.useDefaultSeedSource = planting.useDefaultSeedSource;
      // Store crop name for filtering varieties/mixes in picker
      crop.crop = config.crop;

      // Add sequence membership info
      crop.sequenceId = planting.sequenceId;
      crop.sequenceSlot = planting.sequenceSlot;

      // Calculate seeds needed based on CropConfig.seedsPerBed
      if (config.seedsPerBed && planting.bedFeet) {
        // seedsPerBed is per 50ft bed, scale to actual feet
        const bedsEquivalent = planting.bedFeet / 50;
        crop.seedsNeeded = Math.ceil(config.seedsPerBed * bedsEquivalent);
      }
    }

    result.push(...crops);
  }

  return result.sort((a, b) =>
    parseISO(a.startDate).getTime() - parseISO(b.startDate).getTime()
  );
}

/**
 * Get TimelineCrop[] from a Plan by expanding plantings.
 * This is the single entry point for getting displayable crops from a plan.
 */
export function getTimelineCropsFromPlan(plan: Plan): TimelineCrop[] {
  if (!plan.plantings || !plan.beds || !plan.cropCatalog) {
    return [];
  }

  return expandPlantingsToTimelineCrops(
    plan.plantings,
    plan.beds,
    plan.cropCatalog,
    plan.bedGroups
  );
}

// Re-export collapseToPlantings for use in plan-store
export { collapseToPlantings };
