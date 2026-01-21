'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { parseISO } from 'date-fns';
import {
  usePlanStore,
  loadPlanFromLibrary,
} from '@/lib/plan-store';
import { getTimelineCropsFromPlan } from '@/lib/timeline-data';
import type { TimelineCrop } from '@/lib/plan-types';
import type { BedGroup, Bed } from '@/lib/entities/bed';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Colors by category (matching CropTimeline.tsx) */
const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  'Root': { bg: '#ff7043', text: '#fff' },
  'Brassica': { bg: '#66bb6a', text: '#fff' },
  'Green': { bg: '#43a047', text: '#fff' },
  'Herb': { bg: '#7cb342', text: '#fff' },
  'Tomato': { bg: '#ef5350', text: '#fff' },
  'Pepper': { bg: '#ab47bc', text: '#fff' },
  'Cucumber': { bg: '#26a69a', text: '#fff' },
  'Onion': { bg: '#8d6e63', text: '#fff' },
  'Garlic': { bg: '#a1887f', text: '#fff' },
  'Winter Squash': { bg: '#ffa726', text: '#000' },
  'Summer Squash': { bg: '#ffca28', text: '#000' },
  'Beans': { bg: '#5c6bc0', text: '#fff' },
  'Flower': { bg: '#ec407a', text: '#fff' },
  'Melon': { bg: '#ffee58', text: '#000' },
  'Corn': { bg: '#ffeb3b', text: '#000' },
  'Celery': { bg: '#aed581', text: '#000' },
  'Fennel': { bg: '#dce775', text: '#000' },
  'Fava Bean': { bg: '#4db6ac', text: '#fff' },
};

const DEFAULT_COLOR = { bg: '#78909c', text: '#fff' };

function getColorForCategory(category?: string): { bg: string; text: string } {
  if (!category) return DEFAULT_COLOR;
  return CATEGORY_COLORS[category] || DEFAULT_COLOR;
}

// =============================================================================
// TYPES
// =============================================================================

interface CropBlock {
  id: string;
  name: string;
  category?: string;
  startPercent: number; // 0-100% of year
  widthPercent: number; // 0-100% of year
  bgColor: string;
  textColor: string;
}

interface BedRow {
  bedId: string;
  bedName: string;
  crops: CropBlock[];
}

interface BedGroupSection {
  groupId: string;
  groupName: string;
  beds: BedRow[];
}

// =============================================================================
// DATE UTILITIES
// =============================================================================

/**
 * Convert a date to a percentage of the year (0-100).
 * Jan 1 = 0%, Dec 31 = 100%
 */
function dateToYearPercent(dateStr: string, year: number): number {
  const date = parseISO(dateStr);
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);
  const yearDuration = yearEnd.getTime() - yearStart.getTime();
  const elapsed = date.getTime() - yearStart.getTime();
  return Math.max(0, Math.min(100, (elapsed / yearDuration) * 100));
}

// =============================================================================
// DATA PROCESSING
// =============================================================================

/**
 * Build bed group sections from plan data.
 */
function buildOverviewData(
  beds: Record<string, Bed>,
  bedGroups: Record<string, BedGroup>,
  crops: TimelineCrop[],
  year: number
): BedGroupSection[] {
  // Group beds by their group
  const bedsByGroup = new Map<string, Bed[]>();
  for (const bed of Object.values(beds)) {
    const list = bedsByGroup.get(bed.groupId) ?? [];
    list.push(bed);
    bedsByGroup.set(bed.groupId, list);
  }

  // Sort groups by displayOrder
  const sortedGroups = Object.values(bedGroups).sort(
    (a, b) => a.displayOrder - b.displayOrder
  );

  // Group crops by bed name
  const cropsByBed = new Map<string, TimelineCrop[]>();
  for (const crop of crops) {
    if (!crop.resource || crop.resource === 'Unassigned') continue;
    const list = cropsByBed.get(crop.resource) ?? [];
    list.push(crop);
    cropsByBed.set(crop.resource, list);
  }

  // Build sections
  const sections: BedGroupSection[] = [];

  for (const group of sortedGroups) {
    const bedsInGroup = bedsByGroup.get(group.id) ?? [];
    // Sort beds by displayOrder
    bedsInGroup.sort((a, b) => a.displayOrder - b.displayOrder);

    const bedRows: BedRow[] = bedsInGroup.map((bed) => {
      const bedCrops = cropsByBed.get(bed.name) ?? [];

      // Convert crops to blocks with year percentages
      const cropBlocks: CropBlock[] = bedCrops.map((crop) => {
        const startPercent = dateToYearPercent(crop.startDate, year);
        const endPercent = dateToYearPercent(crop.endDate, year);
        const colors = getColorForCategory(crop.category);

        return {
          id: crop.id,
          name: crop.name,
          category: crop.category,
          startPercent,
          widthPercent: Math.max(0.5, endPercent - startPercent), // min width
          bgColor: colors.bg,
          textColor: colors.text,
        };
      });

      // Sort by start position
      cropBlocks.sort((a, b) => a.startPercent - b.startPercent);

      return {
        bedId: bed.id,
        bedName: bed.name,
        crops: cropBlocks,
      };
    });

    sections.push({
      groupId: group.id,
      groupName: group.name,
      beds: bedRows,
    });
  }

  return sections;
}

// =============================================================================
// COMPONENTS
// =============================================================================

type StackedCrop = CropBlock & { stackLevel: number };

interface StackResult {
  crops: StackedCrop[];
  maxLevel: number;
}

/** Fixed row height for all beds */
const ROW_HEIGHT = 36;

/**
 * Calculate stacking for crops in a lane using time-based overlap detection.
 * Same algorithm as CropTimeline - assigns crops to rows so non-overlapping
 * crops can share the same row.
 */
function calculateStacking(crops: CropBlock[]): StackResult {
  if (crops.length === 0) return { crops: [], maxLevel: 1 };

  // Sort by start position
  const sorted = [...crops].sort((a, b) => a.startPercent - b.startPercent);

  const stacked: StackedCrop[] = [];
  const rowEndPercents: number[] = []; // Track end position for each row

  for (const crop of sorted) {
    const startPercent = crop.startPercent;
    const endPercent = crop.startPercent + crop.widthPercent;

    // Find first available row where previous crop has ended
    let assignedRow = -1;
    for (let r = 0; r < rowEndPercents.length; r++) {
      if (startPercent >= rowEndPercents[r]) {
        assignedRow = r;
        break;
      }
    }

    // If no row available, create a new one
    if (assignedRow === -1) {
      assignedRow = rowEndPercents.length;
      rowEndPercents.push(endPercent);
    } else {
      rowEndPercents[assignedRow] = endPercent;
    }

    stacked.push({ ...crop, stackLevel: assignedRow });
  }

  return { crops: stacked, maxLevel: Math.max(1, rowEndPercents.length) };
}

/**
 * A single bed row with crops positioned by date.
 * Fixed row height - overlapping crops shrink vertically to fit.
 */
function BedRowComponent({ row, isEven }: { row: BedRow; isEven: boolean }) {
  // Calculate stacking for overlapping crops
  const stacks: StackResult = useMemo(() => calculateStacking(row.crops), [row.crops]);

  const maxLevels = stacks.maxLevel;

  // Calculate height per crop level (fixed row height, crops shrink to fit)
  // No minimum - crops shrink as much as needed to fit all levels
  const cropHeight = (ROW_HEIGHT - 2) / maxLevels;

  // Alternate row background for visual distinction
  const rowBg = isEven ? 'bg-gray-50' : 'bg-white';

  return (
    <div className={`flex items-stretch border-b border-gray-100 ${rowBg} overflow-hidden`} style={{ height: ROW_HEIGHT }}>
      {/* Bed label */}
      <div className="w-12 flex-shrink-0 text-xs font-medium text-gray-600 pr-2 text-right flex items-center justify-end">
        {row.bedName}
      </div>

      {/* Timeline area */}
      <div className="flex-1 relative overflow-hidden">
        {stacks.crops.map((crop) => {
          const topPx = crop.stackLevel * cropHeight + 1;

          return (
            <div
              key={crop.id}
              className="absolute overflow-hidden rounded-sm border border-white/20"
              style={{
                left: `${crop.startPercent}%`,
                width: `${crop.widthPercent}%`,
                top: topPx,
                height: Math.max(1, cropHeight - 1),
                backgroundColor: crop.bgColor,
                minWidth: '4px',
              }}
              title={`${crop.name} (${crop.category || 'Unknown'})`}
            >
              {/* Only show text if there's enough height */}
              {cropHeight >= 12 && (
                <span
                  className="text-[9px] px-0.5 truncate block whitespace-nowrap flex items-center h-full"
                  style={{ color: crop.textColor }}
                >
                  {crop.name}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Fixed width for each bed group in the grid */
const GROUP_WIDTH = 280;

/**
 * A bed group section with header and bed rows.
 * Fixed width for grid layout.
 */
function BedGroupComponent({ section }: { section: BedGroupSection }) {
  return (
    <div style={{ width: GROUP_WIDTH }}>
      {/* Group header */}
      <div className="bg-gray-200 px-2 py-1 font-semibold text-gray-700 text-sm rounded-t text-center">
        {section.groupName}
      </div>

      {/* Beds */}
      <div className="bg-white border border-t-0 border-gray-200 rounded-b">
        {section.beds.map((bed, index) => (
          <BedRowComponent key={bed.bedId} row={bed} isEven={index % 2 === 0} />
        ))}
        {section.beds.length === 0 && (
          <div className="h-6 flex items-center justify-center text-xs text-gray-400">
            No beds
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Extract the row letter from a group name like "Row A" or "A Block".
 * Returns the single letter identifier.
 */
function getRowLetter(groupName: string): string {
  // Try patterns like "Row A", "A Block", "Block A", or just "A"
  const match = groupName.match(/\b([A-Z])\b/i);
  return match ? match[1].toUpperCase() : groupName.charAt(0).toUpperCase();
}

type FieldTab = 'old-field' | 'reed-canary';

/**
 * Farm grid layout - arranges bed groups in rows with tabs for different fields.
 */
function FarmGrid({ sections, year }: { sections: BedGroupSection[]; year: number }) {
  const [activeTab, setActiveTab] = useState<FieldTab>('old-field');

  // Create a map for quick lookup by row letter (e.g., "Row A" -> "A")
  const sectionsByLetter = useMemo(() => {
    const map = new Map<string, BedGroupSection>();
    for (const section of sections) {
      const letter = getRowLetter(section.groupName);
      map.set(letter, section);
    }
    return map;
  }, [sections]);

  // Old Field rows (A-J)
  const oldFieldTopLetters = ['F', 'G', 'H', 'I', 'J'];
  const oldFieldBottomLetters = ['A', 'B', 'C', 'D', 'E'];

  // Reed Canary Island rows (U, X)
  const reedCanaryLetters = ['U', 'X'];

  const oldFieldTop = oldFieldTopLetters
    .map(letter => sectionsByLetter.get(letter))
    .filter((s): s is BedGroupSection => s !== undefined);

  const oldFieldBottom = oldFieldBottomLetters
    .map(letter => sectionsByLetter.get(letter))
    .filter((s): s is BedGroupSection => s !== undefined);

  const reedCanary = reedCanaryLetters
    .map(letter => sectionsByLetter.get(letter))
    .filter((s): s is BedGroupSection => s !== undefined);

  return (
    <div className="flex flex-col gap-4">
      {/* Tab bar */}
      <div className="flex items-center gap-4">
        <div className="text-lg font-semibold text-gray-700">{year}</div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('old-field')}
            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'old-field'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Old Field
          </button>
          <button
            onClick={() => setActiveTab('reed-canary')}
            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'reed-canary'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Reed Canary Island
          </button>
        </div>
      </div>

      {/* Old Field layout */}
      {activeTab === 'old-field' && (
        <div className="flex flex-col gap-3">
          {/* Top row: F-J */}
          <div className="flex gap-3 flex-wrap">
            {oldFieldTop.map((section) => (
              <BedGroupComponent key={section.groupId} section={section} />
            ))}
          </div>

          {/* Bottom row: A-E */}
          <div className="flex gap-3 flex-wrap">
            {oldFieldBottom.map((section) => (
              <BedGroupComponent key={section.groupId} section={section} />
            ))}
          </div>
        </div>
      )}

      {/* Reed Canary Island layout */}
      {activeTab === 'reed-canary' && (
        <div className="flex gap-3 flex-wrap">
          {reedCanary.map((section) => (
            <BedGroupComponent key={section.groupId} section={section} />
          ))}
          {reedCanary.length === 0 && (
            <div className="text-gray-500 text-sm">No beds in Reed Canary Island</div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function OverviewPage() {
  const params = useParams();
  const planId = params.planId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Plan store state
  const currentPlan = usePlanStore((state) => state.currentPlan);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);

  // Load the specific plan by ID
  useEffect(() => {
    async function loadPlan() {
      if (!planId) {
        setError('No plan ID provided');
        setLoading(false);
        return;
      }

      try {
        // Check if plan is already loaded in store
        if (currentPlan?.id === planId) {
          setLoading(false);
          return;
        }

        // Try to load from library
        const loaded = await loadPlanFromLibrary(planId);
        if (loaded) {
          loadPlanById(planId);
          setLoading(false);
        } else {
          setError(`Plan "${planId}" not found`);
          setLoading(false);
        }
      } catch (err) {
        console.error('Error loading plan:', err);
        setError('Failed to load plan');
        setLoading(false);
      }
    }

    loadPlan();
  }, [planId, currentPlan?.id, loadPlanById]);

  // Build overview data
  const { overviewData, displayYear } = useMemo(() => {
    if (!currentPlan?.beds || !currentPlan?.bedGroups) {
      return { overviewData: [], displayYear: new Date().getFullYear() };
    }

    const crops = getTimelineCropsFromPlan(currentPlan);

    // Determine the year from actual crop data, not just plan metadata
    // Find the most common year in the crop dates
    const yearCounts = new Map<number, number>();
    for (const crop of crops) {
      if (crop.startDate) {
        const year = parseISO(crop.startDate).getFullYear();
        yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
      }
    }

    // Use the year with most crops, or plan metadata, or current year
    let year = currentPlan.metadata.year || new Date().getFullYear();
    let maxCount = 0;
    for (const [y, count] of yearCounts) {
      if (count > maxCount) {
        maxCount = count;
        year = y;
      }
    }

    return {
      overviewData: buildOverviewData(
        currentPlan.beds,
        currentPlan.bedGroups,
        crops,
        year
      ),
      displayYear: year,
    };
  }, [currentPlan]);

  // Calculate stats
  const stats = useMemo(() => {
    if (!currentPlan) return { beds: 0, plantings: 0, groups: 0 };
    return {
      beds: Object.keys(currentPlan.beds ?? {}).length,
      plantings: currentPlan.plantings?.length ?? 0,
      groups: Object.keys(currentPlan.bedGroups ?? {}).length,
    };
  }, [currentPlan]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">Loading plan...</div>
      </div>
    );
  }

  if (error || !currentPlan) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-sm p-8 max-w-md">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Error</h1>
          <p className="text-gray-600 mb-4">{error || 'Plan not found'}</p>
          <Link href="/plans" className="text-blue-600 hover:text-blue-800">
            Back to Plans
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                href={`/timeline/${planId}`}
                className="text-gray-600 hover:text-gray-900"
              >
                Timeline
              </Link>
              <h1 className="text-xl font-semibold text-gray-900">
                Farm Overview: {currentPlan.metadata.name}
              </h1>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>{stats.groups} blocks</span>
              <span>{stats.beds} beds</span>
              <span>{stats.plantings} plantings</span>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="px-4 sm:px-6 lg:px-8 py-6">
        {overviewData.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500">No beds configured for this plan.</p>
            <Link
              href={`/beds/${planId}`}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              Configure beds
            </Link>
          </div>
        ) : (
          <FarmGrid sections={overviewData} year={displayYear} />
        )}
      </main>
    </div>
  );
}
