/**
 * Transform crop data for the timeline view
 */

import cropsData from '@/data/crops.json';
import bedPlanData from '@/data/bed-plan.json';

// Re-export types from plan-types for backwards compatibility
export type { TimelineCrop, ResourceGroup } from './plan-types';
import type { TimelineCrop, ResourceGroup } from './plan-types';

interface RawCrop {
  id: string;
  Identifier: string;
  'In Plan': boolean;
  Category: string | null;
  Crop: string;
  Variety: string;
  Product: string;
  'Growing Structure': string;
  'Target Sewing Date': string | null;
  'Target Field Date': string | null;
  'Target Harvest Data': string | null;
  'Target End of Harvest': string | null;
  Beds?: number;
  [key: string]: unknown;
}

interface BedAssignment {
  crop: string;
  identifier: string;
  bed: string;
}

interface BedPlanData {
  assignments: BedAssignment[];
  beds: string[];
  bedGroups: Record<string, string[]>;
}

/** Bed size in feet - F and J rows are 20ft, all others are 50ft */
const SHORT_ROWS = ['F', 'J'];
const STANDARD_BED_FT = 50;
const SHORT_BED_FT = 20;

/**
 * Get the row letter from a bed name (e.g., "A5" -> "A", "GH1" -> "GH")
 */
function getBedRow(bed: string): string {
  let row = '';
  for (const char of bed) {
    if (char.match(/[A-Za-z]/)) {
      row += char;
    } else {
      break;
    }
  }
  return row;
}

/**
 * Get the bed number from a bed name (e.g., "A5" -> 5)
 */
function getBedNumber(bed: string): number {
  const match = bed.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

/**
 * Get bed size in feet for a given bed
 */
function getBedSizeFt(bed: string): number {
  const row = getBedRow(bed);
  return SHORT_ROWS.includes(row) ? SHORT_BED_FT : STANDARD_BED_FT;
}

/** Info about each bed in a span, including how much is used */
export interface BedSpanInfo {
  bed: string;
  feetUsed: number;
  bedCapacityFt: number;
}

/**
 * Calculate how many bed rows a crop spans based on bedsNeeded (in 50ft units)
 * and the starting bed's row type.
 * Returns spanBeds (the actual beds), bedsRequired (how many were needed), and isComplete (if we got enough).
 * Also returns bedSpanInfo with feet used per bed.
 */
export function calculateRowSpan(bedsNeeded: number, startBed: string, bedGroups?: Record<string, string[]>): {
  rowSpan: number;
  spanBeds: string[];
  bedSpanInfo: BedSpanInfo[];
  bedsRequired: number;
  isComplete: boolean;
  totalFeetNeeded: number;
} {
  const groups = bedGroups || (bedPlanData as BedPlanData).bedGroups;
  const row = getBedRow(startBed);
  const bedSizeFt = getBedSizeFt(startBed);

  if (bedsNeeded <= 0) {
    return {
      rowSpan: 1,
      spanBeds: [startBed],
      bedSpanInfo: [{ bed: startBed, feetUsed: bedSizeFt, bedCapacityFt: bedSizeFt }],
      bedsRequired: 1,
      isComplete: true,
      totalFeetNeeded: bedSizeFt
    };
  }

  // Convert bedsNeeded (in 50ft units) to feet, then to number of beds in this row
  const feetNeeded = bedsNeeded * STANDARD_BED_FT;
  const bedsRequired = Math.ceil(feetNeeded / bedSizeFt);

  // Get available beds in this row, sorted numerically
  const rowBeds = (groups[row] || []).sort((a, b) => getBedNumber(a) - getBedNumber(b));

  // Find beds starting from startBed
  const startIndex = rowBeds.findIndex(b => b === startBed);
  if (startIndex === -1) {
    return {
      rowSpan: 1,
      spanBeds: [startBed],
      bedSpanInfo: [{ bed: startBed, feetUsed: Math.min(feetNeeded, bedSizeFt), bedCapacityFt: bedSizeFt }],
      bedsRequired,
      isComplete: false,
      totalFeetNeeded: feetNeeded
    };
  }

  // Collect consecutive beds from the starting position (only those that exist)
  const spanBeds: string[] = [];
  const bedSpanInfo: BedSpanInfo[] = [];
  let remainingFeet = feetNeeded;

  for (let i = 0; i < bedsRequired && startIndex + i < rowBeds.length; i++) {
    const bed = rowBeds[startIndex + i];
    const thisBedCapacity = getBedSizeFt(bed);
    const feetUsed = Math.min(remainingFeet, thisBedCapacity);

    spanBeds.push(bed);
    bedSpanInfo.push({
      bed,
      feetUsed,
      bedCapacityFt: thisBedCapacity
    });

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
  }

  return {
    rowSpan: spanBeds.length,
    spanBeds,
    bedSpanInfo,
    bedsRequired,
    isComplete: spanBeds.length >= bedsRequired,
    totalFeetNeeded: feetNeeded
  };
}

/**
 * Build a mapping from crop Identifier -> bed assignments
 * One crop can have multiple bed assignments (succession plantings)
 */
function buildBedAssignmentMap(): Map<string, BedAssignment[]> {
  const bedPlan = bedPlanData as BedPlanData;
  const cropToBeds = new Map<string, BedAssignment[]>();

  for (const assignment of bedPlan.assignments) {
    const cropId = assignment.crop.trim();
    if (!cropToBeds.has(cropId)) {
      cropToBeds.set(cropId, []);
    }
    cropToBeds.get(cropId)!.push(assignment);
  }

  return cropToBeds;
}

/**
 * Get crops that are "In Plan" with valid dates, formatted for the timeline
 * Uses actual bed assignments from the Bed Plan sheet
 */
export function getTimelineCrops(): TimelineCrop[] {
  const rawCrops = (cropsData as { crops: RawCrop[] }).crops;
  const bedPlan = bedPlanData as BedPlanData;
  const bedAssignmentMap = buildBedAssignmentMap();

  const timelineCrops: TimelineCrop[] = [];
  const seenIdentifiers = new Set<string>();

  // Filter to crops in plan with dates
  const inPlanCrops = rawCrops.filter(c =>
    c['In Plan'] === true &&
    c['Target Sewing Date'] &&
    c['Target End of Harvest']
  );

  let unassignedCounter = 0;

  for (const crop of inPlanCrops) {
    const name = crop.Product && crop.Product !== 'General'
      ? `${crop.Crop} (${crop.Product})`
      : crop.Crop;

    // Get bed assignments for this crop
    const bedAssignments = bedAssignmentMap.get(crop.Identifier) ||
                           bedAssignmentMap.get(crop.Identifier.trim()) ||
                           [];

    const bedsNeeded = crop.Beds || 1;

    if (bedAssignments.length > 0) {
      // Create a timeline entry for each bed assignment (succession plantings)
      for (const assignment of bedAssignments) {
        // Skip if we've already seen this planting identifier (handles duplicate crops in source data)
        if (seenIdentifiers.has(assignment.identifier)) {
          continue;
        }
        seenIdentifiers.add(assignment.identifier);

        // Calculate which beds this crop spans
        const { bedSpanInfo } = calculateRowSpan(
          bedsNeeded,
          assignment.bed,
          bedPlan.bedGroups
        );

        const totalBeds = bedSpanInfo.length;
        const displayName = bedAssignments.length > 1 ? `${name} (${assignment.identifier})` : name;

        // Create a separate entry for each bed the crop occupies
        bedSpanInfo.forEach((info, index) => {
          timelineCrops.push({
            id: `${assignment.identifier}_bed${index}`, // Unique ID for each bed entry
            name: displayName,
            startDate: crop['Target Sewing Date']!,
            endDate: crop['Target End of Harvest']!,
            harvestStartDate: crop['Target Harvest Data'] || undefined,
            resource: info.bed,
            category: crop.Category || undefined,
            bedsNeeded,
            structure: crop['Growing Structure'] || 'Field',
            plantingId: assignment.identifier,
            totalBeds,
            bedIndex: index + 1, // 1-indexed for display
            groupId: assignment.identifier, // For grouping related entries
            feetUsed: info.feetUsed,
            bedCapacityFt: info.bedCapacityFt,
          });
        });
      }
    } else {
      // No bed assignment - put in Unassigned with unique counter
      timelineCrops.push({
        id: `unassigned_${++unassignedCounter}`,
        name,
        startDate: crop['Target Sewing Date']!,
        endDate: crop['Target End of Harvest']!,
        harvestStartDate: crop['Target Harvest Data'] || undefined,
        resource: '', // Unassigned
        category: crop.Category || undefined,
        bedsNeeded,
        structure: crop['Growing Structure'] || 'Field',
        totalBeds: 1,
        bedIndex: 1,
        groupId: `unassigned_${unassignedCounter}`,
      });
    }
  }

  return timelineCrops.sort((a, b) =>
    new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
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
  const dates = crops.map(c => [new Date(c.startDate), new Date(c.endDate)]).flat();
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
