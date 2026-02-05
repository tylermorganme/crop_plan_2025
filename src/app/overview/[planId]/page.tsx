'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { parseISO } from 'date-fns';
import {
  usePlanStore,
  loadPlanFromLibrary,
} from '@/lib/plan-store';
import { buildBedMappings, expandCropsToBeds } from '@/lib/timeline-data';
import { useComputedCrops } from '@/lib/use-computed-crops';
import { calculateSpecRevenue, formatCurrency } from '@/lib/revenue';
import { parseSearchQuery, matchesCropFilter } from '@/lib/search-dsl';
import { SearchInput } from '@/components/SearchInput';
import { ConnectedPlantingInspector } from '@/components/ConnectedPlantingInspector';
import { useUIStore } from '@/lib/ui-store';
import type { TimelineCrop, Planting } from '@/lib/plan-types';
import type { BedGroup, Bed, ResourceGroup } from '@/lib/entities/bed';
import AppHeader from '@/components/AppHeader';
import { calculateStacking as sharedCalculateStacking, type StackableItem } from '@/lib/timeline-stacking';
import CropTimeline from '@/components/CropTimeline';
import { useDragPreview } from '@/hooks/useDragPreview';

// =============================================================================
// FIELD LAYOUT CONFIGURATION (UI-level, stored in localStorage)
// =============================================================================

/** A field/area of the farm (e.g., "Old Field", "Reed Canary Island") */
interface FieldConfig {
  id: string;
  name: string;
  /** Grid layout: lanes of bed group letters. Each inner array is one visual lane (horizontal strip). */
  lanes: string[][];
  /** Reverse the order of beds within each group (e.g., J10→J1 instead of J1→J10) */
  reverseBedOrder?: boolean;
}

/** Complete layout configuration */
interface FieldLayoutConfig {
  fields: FieldConfig[];
  /** Which field is currently active/visible */
  activeFieldId: string;
}

const LAYOUT_STORAGE_KEY = 'farm-map-layout-v1';
const COLOR_BY_STORAGE_KEY = 'farm-map-color-by-v1';
const COLOR_BY_MODE_STORAGE_KEY = 'farm-map-color-by-mode-v1';

/** Default layout matching the hardcoded original */
const DEFAULT_LAYOUT: FieldLayoutConfig = {
  fields: [
    {
      id: 'old-field',
      name: 'Old Field',
      lanes: [
        ['F', 'G', 'H', 'I', 'J'],
        ['A', 'B', 'C', 'D', 'E'],
      ],
    },
    {
      id: 'reed-canary',
      name: 'Reed Canary Island',
      lanes: [
        ['U', 'X'],
      ],
    },
  ],
  activeFieldId: 'old-field',
};

function loadLayoutFromStorage(): FieldLayoutConfig {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  try {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migrate old 'rows' to 'lanes' if needed
      if (parsed.fields) {
        for (const field of parsed.fields) {
          if (field.rows && !field.lanes) {
            field.lanes = field.rows;
            delete field.rows;
          }
        }
      }
      return parsed as FieldLayoutConfig;
    }
  } catch (e) {
    console.warn('Failed to load layout from storage:', e);
  }
  return DEFAULT_LAYOUT;
}

function saveLayoutToStorage(layout: FieldLayoutConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch (e) {
    console.warn('Failed to save layout to storage:', e);
  }
}

function loadColorByFromStorage(): ColorByField {
  if (typeof window === 'undefined') return 'none';
  try {
    const stored = localStorage.getItem(COLOR_BY_STORAGE_KEY);
    if (stored && ['none', 'growingStructure', 'plantingMethod', 'category', 'irrigation', 'trellisType'].includes(stored)) {
      return stored as ColorByField;
    }
  } catch (e) {
    console.warn('Failed to load colorBy from storage:', e);
  }
  return 'none';
}

function saveColorByToStorage(colorBy: ColorByField): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(COLOR_BY_STORAGE_KEY, colorBy);
  } catch (e) {
    console.warn('Failed to save colorBy to storage:', e);
  }
}

function loadColorByModeFromStorage(): ColorByMode {
  if (typeof window === 'undefined') return 'border';
  try {
    const stored = localStorage.getItem(COLOR_BY_MODE_STORAGE_KEY);
    if (stored && ['border', 'background'].includes(stored)) {
      return stored as ColorByMode;
    }
  } catch (e) {
    console.warn('Failed to load colorByMode from storage:', e);
  }
  return 'border';
}

function saveColorByModeToStorage(mode: ColorByMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(COLOR_BY_MODE_STORAGE_KEY, mode);
  } catch (e) {
    console.warn('Failed to save colorByMode to storage:', e);
  }
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default color when crop doesn't have colors defined */
const DEFAULT_COLOR = { bg: '#78909c', text: '#fff' };

/** Border color palettes for "Color by" categorical fields */
const COLOR_BY_PALETTES: Record<string, Record<string, string>> = {
  growingStructure: {
    field: '#3b82f6',        // blue
    greenhouse: '#22c55e',   // green
    'high-tunnel': '#f59e0b', // amber
  },
  plantingMethod: {
    'direct-seed': '#8b5cf6', // purple
    transplant: '#06b6d4',    // cyan
    perennial: '#84cc16',     // lime
  },
  irrigation: {
    drip: '#3b82f6',         // blue (water droplet)
    overhead: '#22d3ee',     // cyan (sprinkler)
    none: '#9ca3af',         // gray (no irrigation)
  },
  trellisType: {
    'florida-weave-2x': '#f59e0b', // amber (for trellised crops)
    // Other trellis types will get auto-generated colors
  },
  gddTiming: {
    On: '#22c55e',           // green (GDD enabled)
    Off: '#9ca3af',          // gray (GDD disabled)
  },
  // Category colors will be generated dynamically from unique values
};

/** Auto-generate colors for category values */
const CATEGORY_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#6b7280', // gray
];

type ColorByField = 'none' | 'growingStructure' | 'plantingMethod' | 'category' | 'irrigation' | 'trellisType' | 'gddTiming';
type ColorByMode = 'border' | 'background';

// =============================================================================
// TYPES
// =============================================================================

interface CropBlock {
  id: string;
  plantingId: string; // For drag-drop operations
  name: string;
  category?: string;
  specId?: string; // For search filtering
  startPercent: number; // 0-100% of year
  widthPercent: number; // 0-100% of year
  bgColor: string;
  textColor: string;
  feetNeeded: number; // Total bed-feet for this planting
  feetUsed?: number; // Feet used in this specific bed (for multi-bed plantings)
  // Categorical fields for "Color by" feature
  growingStructure?: string;
  plantingMethod?: string;
  irrigation?: string;
  trellisType?: string;
  useGddTiming?: boolean;
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
 * Expands crops across multiple beds based on feetNeeded.
 */
function buildOverviewData(
  beds: Record<string, Bed>,
  bedGroups: Record<string, BedGroup>,
  crops: TimelineCrop[],
  year: number,
  nameGroups: Record<string, string[]>,
  bedLengths: Record<string, number>,
  specs?: Record<string, import('@/lib/entities/planting-specs').PlantingSpec>
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

  // Use shared bed expansion logic (excludes unassigned crops)
  const cropsByBed = expandCropsToBeds(crops, nameGroups, bedLengths, {
    includeUnassigned: false,
  });

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
        // Look up spec for irrigation/trellisType (these are spec-level fields)
        const spec = specs?.[crop.specId];

        return {
          id: crop.id,
          plantingId: crop.plantingId || crop.id, // For drag-drop
          name: crop.name,
          category: crop.category,
          specId: crop.specId,
          startPercent,
          widthPercent: Math.max(0.5, endPercent - startPercent), // min width
          bgColor: crop.bgColor || DEFAULT_COLOR.bg,
          textColor: crop.textColor || DEFAULT_COLOR.text,
          feetNeeded: crop.feetNeeded,
          feetUsed: crop.feetUsed,
          growingStructure: crop.growingStructure,
          plantingMethod: crop.plantingMethod,
          irrigation: spec?.irrigation,
          trellisType: spec?.trellisType,
          useGddTiming: crop.useGddTiming,
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
const ROW_HEIGHT = 42;

/**
 * Calculate stacking for crops in a lane using the shared stacking utility.
 * Adapts CropBlock (startPercent/widthPercent) to StackableItem (start/end).
 */
function calculateStacking(crops: CropBlock[]): StackResult {
  if (crops.length === 0) return { crops: [], maxLevel: 1 };

  // Convert to stackable items
  const stackable: Array<CropBlock & StackableItem> = crops.map(crop => ({
    ...crop,
    start: crop.startPercent,
    end: crop.startPercent + crop.widthPercent,
  }));

  // Use shared stacking algorithm
  const result = sharedCalculateStacking(stackable, { allowTouching: true });

  return {
    crops: result.items,
    maxLevel: result.maxLevel,
  };
}

/**
 * A single bed row with crops positioned by date.
 * Fixed row height - overlapping crops shrink vertically to fit.
 * Acts as a drop target for unassigned plantings.
 */
function BedRowComponent({
  row,
  isEven,
  onAssignPlanting,
  onCropClick,
  selectedPlantingIds,
  filterTerms,
  filterMode,
  colorByField,
  colorPalettes,
  colorByMode = 'border',
}: {
  row: BedRow;
  isEven: boolean;
  onAssignPlanting?: (plantingId: string, bedId: string) => void;
  onCropClick?: (plantingId: string, e: React.MouseEvent) => void;
  selectedPlantingIds?: Set<string>;
  /** Current filter terms for highlighting */
  filterTerms?: string[];
  /** 'highlight' = show all, highlight matches; 'filter' = hide non-matches */
  filterMode?: 'highlight' | 'filter';
  /** Which categorical field to color by */
  colorByField?: ColorByField;
  /** Color palettes for each categorical field */
  colorPalettes?: Record<string, Record<string, string>>;
  /** How to apply the color: border or background */
  colorByMode?: ColorByMode;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Get color for a crop based on colorByField (used for both border and background modes)
  const getCategoryColor = useCallback((crop: CropBlock): string | undefined => {
    if (!colorByField || colorByField === 'none' || !colorPalettes) return undefined;

    let value: string | undefined;
    if (colorByField === 'category') {
      value = crop.category;
    } else if (colorByField === 'growingStructure') {
      value = crop.growingStructure;
    } else if (colorByField === 'plantingMethod') {
      value = crop.plantingMethod;
    } else if (colorByField === 'irrigation') {
      value = crop.irrigation;
    } else if (colorByField === 'trellisType') {
      value = crop.trellisType;
    } else if (colorByField === 'gddTiming') {
      value = crop.useGddTiming ? 'On' : 'Off';
    }

    if (!value) return '#9ca3af'; // gray for unknown/missing
    return colorPalettes[colorByField]?.[value] ?? '#9ca3af';
  }, [colorByField, colorPalettes]);

  // Filter crops if in filter mode, otherwise show all
  const visibleCrops = useMemo(() => {
    if (!filterTerms || filterTerms.length === 0 || filterMode !== 'filter') {
      return row.crops;
    }
    return row.crops.filter(crop => matchesCropFilter(crop, filterTerms));
  }, [row.crops, filterTerms, filterMode]);

  // Calculate stacking for overlapping crops
  const stacks: StackResult = useMemo(() => calculateStacking(visibleCrops), [visibleCrops]);

  const maxLevels = stacks.maxLevel;

  // Calculate height per crop level (fixed row height, crops shrink to fit)
  // No minimum - crops shrink as much as needed to fit all levels
  const cropHeight = (ROW_HEIGHT - 2) / maxLevels;

  // Alternate row background for visual distinction
  const rowBg = isDragOver ? 'bg-blue-100' : (isEven ? 'bg-gray-50' : 'bg-white');

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    try {
      // Try application/json first, fall back to text/plain
      let rawData = e.dataTransfer.getData('application/json');
      if (!rawData) {
        rawData = e.dataTransfer.getData('text/plain');
      }

      if (!rawData) {
        console.warn('[handleDrop] No drag data available');
        return;
      }

      const data = JSON.parse(rawData);
      // Accept both unassigned and assigned plantings for (re)assignment
      if ((data.type === 'unassigned-planting' || data.type === 'assigned-planting') && data.plantingId && onAssignPlanting) {
        onAssignPlanting(data.plantingId, row.bedId);
      }
    } catch (err) {
      console.error('[handleDrop] Error:', err);
    }
  }, [onAssignPlanting, row.bedId]);

  return (
    <div
      className={`flex items-stretch border-b border-gray-100 ${rowBg} overflow-hidden transition-colors`}
      style={{ height: ROW_HEIGHT }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Bed label */}
      <div className="w-12 flex-shrink-0 text-xs font-medium text-gray-600 pr-2 text-right flex items-center justify-end">
        {row.bedName}
      </div>

      {/* Timeline area with month grid lines */}
      <div className="flex-1 relative overflow-hidden">
        {/* Month grid lines */}
        {MONTH_LABELS.map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-gray-100 pointer-events-none"
            style={{ left: `${(i / 12) * 100}%` }}
          />
        ))}
        {/* Crop blocks - draggable for reassignment, clickable for selection */}
        {stacks.crops.map((crop) => {
          const topPx = crop.stackLevel * cropHeight + 1;
          const isSelected = selectedPlantingIds?.has(crop.plantingId);
          // Highlight matching crops when in highlight mode with active filter
          // De-emphasize non-matching crops when highlight mode is active
          const shouldFade = filterMode === 'highlight' && filterTerms && filterTerms.length > 0
            && !matchesCropFilter(crop, filterTerms);
          const categoryColor = getCategoryColor(crop);
          const useBorder = colorByMode === 'border' && categoryColor;
          const useBackground = colorByMode === 'background' && categoryColor;

          return (
            <div
              key={crop.id}
              className={`absolute overflow-hidden rounded-sm cursor-pointer ${
                isSelected
                  ? 'ring-2 ring-inset ring-blue-500 z-10'
                  : useBorder ? '' : 'border border-white/20'
              } ${shouldFade ? 'opacity-30' : ''}`}
              draggable
              onClick={(e) => {
                e.stopPropagation();
                onCropClick?.(crop.plantingId, e);
              }}
              onDragStart={(e) => {
                e.stopPropagation();
                const jsonStr = JSON.stringify({
                  type: 'assigned-planting',
                  plantingId: crop.plantingId,
                });
                e.dataTransfer.setData('application/json', jsonStr);
                e.dataTransfer.setData('text/plain', jsonStr);
                e.dataTransfer.effectAllowed = 'move';
              }}
              style={{
                left: `${crop.startPercent}%`,
                width: `${crop.widthPercent}%`,
                top: topPx,
                height: Math.max(1, cropHeight - 1),
                backgroundColor: useBackground ? categoryColor : crop.bgColor,
                minWidth: '4px',
                ...(useBorder ? {
                  borderWidth: 2,
                  borderColor: categoryColor,
                  borderStyle: 'solid',
                } : {}),
              }}
              title={`${crop.name} (${crop.category || 'Unknown'}) - Click to select, drag to move`}
            >
              {/* Only show text if there's enough height */}
              {cropHeight >= 12 && (
                <span
                  className="text-[9px] px-0.5 flex items-center justify-between h-full pointer-events-none w-full"
                  style={{ color: crop.textColor }}
                >
                  <span className="truncate">{crop.name}</span>
                  <span className="flex-shrink-0 ml-1">{crop.feetUsed ?? crop.feetNeeded}&apos;</span>
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

/** Month labels for timeline headers */
const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/**
 * Month header row for bed groups - shows J F M A M J J A S O N D
 */
function MonthHeaderRow() {
  return (
    <div className="flex items-center border-b border-gray-200" style={{ height: 16 }}>
      {/* Spacer for bed label column */}
      <div className="w-12 flex-shrink-0" />
      {/* Month labels */}
      <div className="flex-1 flex">
        {MONTH_LABELS.map((label, i) => (
          <div
            key={i}
            className="text-[8px] text-gray-400 text-center border-l border-gray-100 first:border-l-0"
            style={{ width: `${100 / 12}%` }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A bed group section with header, month labels, and bed rows.
 * Fixed width for grid layout.
 */
function BedGroupComponent({
  section,
  onAssignPlanting,
  onCropClick,
  onGroupClick,
  selectedPlantingIds,
  filterTerms,
  filterMode,
  reverseBedOrder,
  colorByField,
  colorPalettes,
  colorByMode,
}: {
  section: BedGroupSection;
  onAssignPlanting?: (plantingId: string, bedId: string) => void;
  onCropClick?: (plantingId: string, e: React.MouseEvent) => void;
  onGroupClick?: (groupId: string) => void;
  selectedPlantingIds?: Set<string>;
  filterTerms?: string[];
  filterMode?: 'highlight' | 'filter';
  reverseBedOrder?: boolean;
  colorByField?: ColorByField;
  colorPalettes?: Record<string, Record<string, string>>;
  colorByMode?: ColorByMode;
}) {
  // Optionally reverse bed order within the group
  const displayBeds = useMemo(() => {
    return reverseBedOrder ? [...section.beds].reverse() : section.beds;
  }, [section.beds, reverseBedOrder]);

  return (
    <div style={{ width: GROUP_WIDTH }}>
      {/* Group header - clickable to view timeline */}
      <button
        onClick={() => onGroupClick?.(section.groupId)}
        className="w-full bg-gray-200 px-2 py-1 font-semibold text-gray-700 text-sm rounded-t text-center hover:bg-gray-300 transition-colors cursor-pointer"
        title="Click to view timeline"
      >
        {section.groupName}
      </button>

      {/* Month headers + Beds */}
      <div className="bg-white border border-t-0 border-gray-200 rounded-b">
        <MonthHeaderRow />
        {displayBeds.map((bed, index) => (
          <BedRowComponent
            key={bed.bedId}
            row={bed}
            isEven={index % 2 === 0}
            onAssignPlanting={onAssignPlanting}
            onCropClick={onCropClick}
            selectedPlantingIds={selectedPlantingIds}
            filterTerms={filterTerms}
            filterMode={filterMode}
            colorByField={colorByField}
            colorPalettes={colorPalettes}
            colorByMode={colorByMode}
          />
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

// =============================================================================
// UNASSIGNED PLANTINGS PANEL (Simple Table)
// =============================================================================

interface EnrichedUnassignedCrop {
  id: string;
  plantingId?: string;
  name: string;
  cropName: string;
  category: string;
  identifier: string;
  startDate: string;
  endDate: string;
  feetNeeded: number;
  revenue: number | null;
  bgColor?: string;
  textColor?: string;
  // Fields from TimelineCrop for search consistency
  specId: string;
  crop?: string;
  notes?: string;
  plantingMethod?: string;
  growingStructure?: 'field' | 'greenhouse' | 'high-tunnel';
}

/**
 * Format a date string (YYYY-MM-DD) to a shorter display format (MM/DD)
 */
function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const [, month, day] = dateStr.split('-');
  return `${parseInt(month, 10)}/${parseInt(day, 10)}`;
}

/**
 * Simple table panel showing unassigned plantings.
 * Supports search filtering and drag-to-assign functionality.
 */
type UnassignedSortColumn = 'crop' | 'category' | 'start' | 'end' | 'config' | 'revenue';

function UnassignedPlantingsPanel({
  plantings,
  searchQuery,
  onDelete,
}: {
  plantings: EnrichedUnassignedCrop[];
  searchQuery: string;
  onDelete?: (plantingId: string) => void;
}) {
  // Parse search query: extract filter terms and sort override (matches CropTimeline DSL)
  const validSortColumns = useMemo(() => new Set<UnassignedSortColumn>(['crop', 'category', 'start', 'end', 'config', 'revenue']), []);
  const { filterTerms, sortOverride } = useMemo(() => {
    const parsed = parseSearchQuery<UnassignedSortColumn>(searchQuery, validSortColumns);
    const sortOverride = parsed.sortField
      ? { column: parsed.sortField, direction: parsed.sortDir }
      : null;
    return { filterTerms: parsed.filterTerms, sortOverride };
  }, [searchQuery, validSortColumns]);

  // Filter plantings using shared filter logic
  const filteredPlantings = useMemo(() => {
    if (filterTerms.length === 0) return plantings;
    return plantings.filter(p => matchesCropFilter(p, filterTerms));
  }, [plantings, filterTerms]);

  // Sort plantings (default: start date ascending)
  const sortedPlantings = useMemo(() => {
    const col = sortOverride?.column ?? 'start';
    const dir = sortOverride?.direction ?? 'asc';

    return [...filteredPlantings].sort((a, b) => {
      let cmp = 0;
      switch (col) {
        case 'crop': cmp = a.cropName.localeCompare(b.cropName); break;
        case 'category': cmp = a.category.localeCompare(b.category); break;
        case 'start': cmp = a.startDate.localeCompare(b.startDate); break;
        case 'end': cmp = a.endDate.localeCompare(b.endDate); break;
        case 'config': cmp = a.identifier.localeCompare(b.identifier); break;
        case 'revenue': cmp = (a.revenue ?? 0) - (b.revenue ?? 0); break;
      }
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [filteredPlantings, sortOverride]);

  if (sortedPlantings.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        {searchQuery ? 'No matching unassigned plantings' : 'No unassigned plantings for this year'}
      </div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-gray-100">
        <tr className="border-b border-gray-200">
          {onDelete && <th className="w-6"></th>}
          <th className="px-2 py-1.5 text-left font-medium text-gray-600">Planting</th>
          <th className="px-2 py-1.5 text-left font-medium text-gray-600">Config</th>
          <th className="px-2 py-1.5 text-left font-medium text-gray-600">Crop</th>
          <th className="px-2 py-1.5 text-left font-medium text-gray-600">Start</th>
          <th className="px-2 py-1.5 text-left font-medium text-gray-600">End</th>
          <th className="px-2 py-1.5 text-right font-medium text-gray-600">Revenue</th>
        </tr>
      </thead>
      <tbody>
        {sortedPlantings.map((planting, index) => {
          const colors = {
            bg: planting.bgColor || DEFAULT_COLOR.bg,
            text: planting.textColor || DEFAULT_COLOR.text,
          };
          const isEven = index % 2 === 0;
          const plantingId = planting.plantingId || planting.id;

          return (
            <tr
              key={planting.id}
              className={`border-b border-gray-100 cursor-grab hover:bg-blue-50 ${isEven ? 'bg-gray-50' : 'bg-white'}`}
              draggable
              onDragStart={(e) => {
                const jsonStr = JSON.stringify({
                  type: 'unassigned-planting',
                  plantingId,
                });
                e.dataTransfer.setData('application/json', jsonStr);
                e.dataTransfer.setData('text/plain', jsonStr);
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              {onDelete && (
                <td className="px-1 py-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(plantingId);
                    }}
                    className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Delete planting"
                  >
                    ×
                  </button>
                </td>
              )}
              <td className="px-2 py-1.5 text-gray-400 font-mono text-[10px]" title={plantingId}>{plantingId.slice(0, 8)}</td>
              <td className="px-2 py-1.5 text-gray-500 font-mono text-[10px]">{planting.identifier}</td>
              <td className="px-2 py-1.5">
                <span
                  className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
                  style={{ backgroundColor: colors.bg, color: colors.text }}
                  title={planting.category}
                >
                  {planting.cropName}
                </span>
              </td>
              <td className="px-2 py-1.5 text-gray-600">{formatShortDate(planting.startDate)}</td>
              <td className="px-2 py-1.5 text-gray-600">{formatShortDate(planting.endDate)}</td>
              <td className="px-2 py-1.5 text-right text-green-700">
                {planting.revenue !== null ? formatCurrency(planting.revenue) : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Layout Editor Modal - allows configuring field layout
 */
function LayoutEditorModal({
  layout,
  availableGroups,
  groupNames,
  onSave,
  onClose,
}: {
  layout: FieldLayoutConfig;
  availableGroups: string[]; // Available bed group IDs
  groupNames: Record<string, string>; // Map of group ID to display name
  onSave: (layout: FieldLayoutConfig) => void;
  onClose: () => void;
}) {
  // Helper to get display name for a group (with fallback)
  const getGroupName = (groupId: string) => groupNames[groupId] || groupId;
  const [editLayout, setEditLayout] = useState<FieldLayoutConfig>(JSON.parse(JSON.stringify(layout)));
  const [selectedFieldId, setSelectedFieldId] = useState(editLayout.fields[0]?.id || '');

  const selectedField = editLayout.fields.find(f => f.id === selectedFieldId);

  // Get all groups currently assigned to any field
  const assignedGroups = useMemo(() => {
    const assigned = new Set<string>();
    for (const field of editLayout.fields) {
      for (const lane of field.lanes) {
        for (const letter of lane) {
          assigned.add(letter);
        }
      }
    }
    return assigned;
  }, [editLayout]);

  // Groups not yet assigned
  const unassignedGroups = availableGroups.filter(g => !assignedGroups.has(g));

  const addField = () => {
    const newId = `field-${Date.now()}`;
    setEditLayout({
      ...editLayout,
      fields: [...editLayout.fields, { id: newId, name: 'New Field', lanes: [[]] }],
    });
    setSelectedFieldId(newId);
  };

  const deleteField = (fieldId: string) => {
    if (editLayout.fields.length <= 1) return; // Keep at least one
    const newFields = editLayout.fields.filter(f => f.id !== fieldId);
    setEditLayout({ ...editLayout, fields: newFields });
    if (selectedFieldId === fieldId) {
      setSelectedFieldId(newFields[0]?.id || '');
    }
  };

  const updateFieldName = (fieldId: string, name: string) => {
    setEditLayout({
      ...editLayout,
      fields: editLayout.fields.map(f => f.id === fieldId ? { ...f, name } : f),
    });
  };

  const toggleReverseBedOrder = (fieldId: string) => {
    setEditLayout({
      ...editLayout,
      fields: editLayout.fields.map(f =>
        f.id === fieldId ? { ...f, reverseBedOrder: !f.reverseBedOrder } : f
      ),
    });
  };

  const addLaneToField = (fieldId: string) => {
    setEditLayout({
      ...editLayout,
      fields: editLayout.fields.map(f =>
        f.id === fieldId ? { ...f, lanes: [...f.lanes, []] } : f
      ),
    });
  };

  const removeLaneFromField = (fieldId: string, laneIndex: number) => {
    setEditLayout({
      ...editLayout,
      fields: editLayout.fields.map(f =>
        f.id === fieldId ? { ...f, lanes: f.lanes.filter((_: string[], i: number) => i !== laneIndex) } : f
      ),
    });
  };

  const moveLane = (fieldId: string, fromIndex: number, toIndex: number) => {
    setEditLayout({
      ...editLayout,
      fields: editLayout.fields.map(f => {
        if (f.id !== fieldId) return f;
        const newLanes = [...f.lanes];
        const [removed] = newLanes.splice(fromIndex, 1);
        newLanes.splice(toIndex, 0, removed);
        return { ...f, lanes: newLanes };
      }),
    });
  };

  const addGroupToLane = (fieldId: string, laneIndex: number, letter: string) => {
    setEditLayout({
      ...editLayout,
      fields: editLayout.fields.map(f =>
        f.id === fieldId
          ? {
              ...f,
              lanes: f.lanes.map((lane: string[], i: number) => i === laneIndex ? [...lane, letter] : lane),
            }
          : f
      ),
    });
  };

  const removeGroupFromLane = (fieldId: string, laneIndex: number, letter: string) => {
    setEditLayout({
      ...editLayout,
      fields: editLayout.fields.map(f =>
        f.id === fieldId
          ? {
              ...f,
              lanes: f.lanes.map((lane: string[], i: number) => i === laneIndex ? lane.filter((l: string) => l !== letter) : lane),
            }
          : f
      ),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Configure Map Layout</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="flex h-[60vh]">
          {/* Field list sidebar */}
          <div className="w-48 border-r border-gray-200 p-3 flex flex-col gap-2">
            <div className="text-xs font-medium text-gray-500 uppercase">Fields</div>
            {editLayout.fields.map(field => (
              <button
                key={field.id}
                onClick={() => setSelectedFieldId(field.id)}
                className={`text-left px-2 py-1.5 rounded text-sm ${
                  selectedFieldId === field.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'hover:bg-gray-100'
                }`}
              >
                {field.name}
              </button>
            ))}
            <button
              onClick={addField}
              className="text-left px-2 py-1.5 rounded text-sm text-blue-600 hover:bg-blue-50"
            >
              + Add Field
            </button>
          </div>

          {/* Field editor */}
          <div className="flex-1 p-4 overflow-auto">
            {selectedField && (
              <div className="space-y-4">
                {/* Field name and settings */}
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={selectedField.name}
                    onChange={e => updateFieldName(selectedField.id, e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded text-lg font-medium w-64"
                  />
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedField.reverseBedOrder ?? false}
                      onChange={() => toggleReverseBedOrder(selectedField.id)}
                      className="rounded border-gray-300"
                    />
                    Reverse bed order
                  </label>
                  {editLayout.fields.length > 1 && (
                    <button
                      onClick={() => deleteField(selectedField.id)}
                      className="text-red-600 text-sm hover:underline"
                    >
                      Delete Field
                    </button>
                  )}
                </div>

                {/* Lanes */}
                <div className="space-y-3">
                  <div className="text-sm font-medium text-gray-700">Layout Lanes</div>
                  {selectedField.lanes.map((lane: string[], laneIndex: number) => (
                    <div key={laneIndex} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                      {/* Reorder buttons */}
                      <div className="flex flex-col gap-0.5">
                        <button
                          onClick={() => laneIndex > 0 && moveLane(selectedField.id, laneIndex, laneIndex - 1)}
                          disabled={laneIndex === 0}
                          className={`text-xs px-1 ${laneIndex === 0 ? 'text-gray-300' : 'text-gray-500 hover:text-gray-700'}`}
                          title="Move up"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => laneIndex < selectedField.lanes.length - 1 && moveLane(selectedField.id, laneIndex, laneIndex + 1)}
                          disabled={laneIndex === selectedField.lanes.length - 1}
                          className={`text-xs px-1 ${laneIndex === selectedField.lanes.length - 1 ? 'text-gray-300' : 'text-gray-500 hover:text-gray-700'}`}
                          title="Move down"
                        >
                          ▼
                        </button>
                      </div>
                      <span className="text-xs text-gray-500 w-14">Lane {laneIndex + 1}</span>
                      <div className="flex flex-wrap gap-1 flex-1 min-h-[32px]">
                        {lane.map((groupId: string) => (
                          <span
                            key={groupId}
                            className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm flex items-center gap-1"
                          >
                            {getGroupName(groupId)}
                            <button
                              onClick={() => removeGroupFromLane(selectedField.id, laneIndex, groupId)}
                              className="text-blue-400 hover:text-blue-600"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {/* Add group dropdown */}
                        {unassignedGroups.length > 0 && (
                          <select
                            className="px-2 py-1 border border-gray-300 rounded text-sm bg-white"
                            value=""
                            onChange={e => {
                              if (e.target.value) {
                                addGroupToLane(selectedField.id, laneIndex, e.target.value);
                              }
                            }}
                          >
                            <option value="">+ Add</option>
                            {unassignedGroups.map(g => (
                              <option key={g} value={g}>{getGroupName(g)}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      <button
                        onClick={() => removeLaneFromField(selectedField.id, laneIndex)}
                        className="text-gray-400 hover:text-red-600 text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addLaneToField(selectedField.id)}
                    className="text-blue-600 text-sm hover:underline"
                  >
                    + Add Lane
                  </button>
                </div>

                {/* Unassigned groups */}
                {unassignedGroups.length > 0 && (
                  <div className="pt-3 border-t border-gray-200">
                    <div className="text-sm font-medium text-gray-700 mb-2">Unassigned Groups</div>
                    <div className="flex flex-wrap gap-1">
                      {unassignedGroups.map(g => (
                        <span key={g} className="px-2 py-1 bg-gray-200 text-gray-600 rounded text-sm">
                          {getGroupName(g)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex justify-between">
          <button
            onClick={() => {
              setEditLayout(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)));
            }}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Reset to Default
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(editLayout)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Save Layout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Farm grid layout - arranges bed groups in rows with tabs for different fields.
 * Now uses configurable layout stored in localStorage.
 */
function FarmGrid({
  sections,
  year,
  baseYear,
  onYearChange,
  onAssignPlanting,
  onCropClick,
  onGroupClick,
  selectedPlantingIds,
  filterTerms,
  filterMode,
  colorByField,
  colorPalettes,
  colorByMode,
}: {
  sections: BedGroupSection[];
  year: number;
  baseYear: number;
  onYearChange: (year: number) => void;
  onAssignPlanting?: (plantingId: string, bedId: string) => void;
  onCropClick?: (plantingId: string, e: React.MouseEvent) => void;
  onGroupClick?: (groupId: string) => void;
  selectedPlantingIds?: Set<string>;
  filterTerms?: string[];
  filterMode?: 'highlight' | 'filter';
  colorByField?: ColorByField;
  colorPalettes?: Record<string, Record<string, string>>;
  colorByMode?: ColorByMode;
}) {
  const [layout, setLayout] = useState<FieldLayoutConfig>(DEFAULT_LAYOUT);
  const [showEditor, setShowEditor] = useState(false);

  // Load layout from localStorage on mount
  useEffect(() => {
    setLayout(loadLayoutFromStorage());
  }, []);

  // Create maps for looking up sections by ID and by legacy letter key
  const { sectionsById, sectionsByLegacyKey } = useMemo(() => {
    const byId = new Map<string, BedGroupSection>();
    const byLegacy = new Map<string, BedGroupSection>();
    for (const section of sections) {
      // Primary lookup by group ID
      byId.set(section.groupId, section);
      // Legacy lookup for old configs that used extracted letters (e.g., "A" for "Row A")
      const legacyKey = section.groupName.match(/^Row\s+([A-Z])$/i)?.[1]?.toUpperCase();
      if (legacyKey) {
        byLegacy.set(legacyKey, section);
      }
    }
    return { sectionsById: byId, sectionsByLegacyKey: byLegacy };
  }, [sections]);

  // Lookup section by ID or legacy key (for backward compatibility)
  const getSection = useCallback((key: string): BedGroupSection | undefined => {
    return sectionsById.get(key) || sectionsByLegacyKey.get(key);
  }, [sectionsById, sectionsByLegacyKey]);

  // Get all available group IDs from sections
  const availableGroups = useMemo(() => {
    return Array.from(sectionsById.keys());
  }, [sectionsById]);

  // Map of group ID to display name (for layout editor)
  const groupNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const [id, section] of sectionsById) {
      names[id] = section.groupName;
    }
    // Also include legacy key mappings for backward compatibility
    for (const [legacyKey, section] of sectionsByLegacyKey) {
      names[legacyKey] = section.groupName;
    }
    return names;
  }, [sectionsById, sectionsByLegacyKey]);

  const activeField = layout.fields.find(f => f.id === layout.activeFieldId) || layout.fields[0];

  const handleSaveLayout = useCallback((newLayout: FieldLayoutConfig) => {
    setLayout(newLayout);
    saveLayoutToStorage(newLayout);
    setShowEditor(false);
  }, []);

  const setActiveField = useCallback((fieldId: string) => {
    const newLayout = { ...layout, activeFieldId: fieldId };
    setLayout(newLayout);
    saveLayoutToStorage(newLayout);
  }, [layout]);

  // Year options: baseYear - 1, baseYear, baseYear + 1
  const yearOptions = [baseYear - 1, baseYear, baseYear + 1];

  return (
    <div className="flex flex-col gap-4">
      {/* Tab bar */}
      <div className="flex items-center gap-4">
        {/* Year toggle */}
        <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded-lg">
          {yearOptions.map(y => (
            <button
              key={y}
              onClick={() => onYearChange(y)}
              className={`px-2 py-0.5 text-sm font-medium rounded transition-colors ${
                year === y
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
        {/* Field tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {layout.fields.map(field => (
            <button
              key={field.id}
              onClick={() => setActiveField(field.id)}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                layout.activeFieldId === field.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {field.name}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowEditor(true)}
          className="ml-auto px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
          title="Configure layout"
        >
          Layout
        </button>
      </div>

      {/* Field layout */}
      {activeField && (
        <div className="flex flex-col gap-3">
          {activeField.lanes.map((lane: string[], laneIndex: number) => {
            const laneSections = lane
              .map((key: string) => getSection(key))
              .filter((s): s is BedGroupSection => s !== undefined);

            if (laneSections.length === 0) return null;

            return (
              <div key={laneIndex} className="flex gap-3 flex-wrap">
                {laneSections.map((section: BedGroupSection) => (
                  <BedGroupComponent
                    key={section.groupId}
                    section={section}
                    onAssignPlanting={onAssignPlanting}
                    onCropClick={onCropClick}
                    onGroupClick={onGroupClick}
                    selectedPlantingIds={selectedPlantingIds}
                    filterTerms={filterTerms}
                    filterMode={filterMode}
                    reverseBedOrder={activeField.reverseBedOrder}
                    colorByField={colorByField}
                    colorPalettes={colorPalettes}
                    colorByMode={colorByMode}
                  />
                ))}
              </div>
            );
          })}
          {activeField.lanes.every((lane: string[]) => lane.length === 0) && (
            <div className="text-gray-500 text-sm">
              No bed groups assigned to this field. Click Layout to configure.
            </div>
          )}
        </div>
      )}

      {/* Layout Editor Modal */}
      {showEditor && (
        <LayoutEditorModal
          layout={layout}
          availableGroups={availableGroups}
          groupNames={groupNames}
          onSave={handleSaveLayout}
          onClose={() => setShowEditor(false)}
        />
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
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(350);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null);
  // Filter mode for map view: 'highlight' shows all crops but highlights matches, 'filter' hides non-matches
  const [mapFilterMode, setMapFilterMode] = useState<'highlight' | 'filter'>('highlight');
  // Color by categorical field for map view (persisted to localStorage)
  const [colorByField, setColorByFieldState] = useState<ColorByField>('none');
  const [colorByMode, setColorByModeState] = useState<ColorByMode>('border');

  // Load colorByField and colorByMode from localStorage on mount
  useEffect(() => {
    setColorByFieldState(loadColorByFromStorage());
    setColorByModeState(loadColorByModeFromStorage());
  }, []);

  // Wrapper to persist colorByField changes
  const setColorByField = useCallback((value: ColorByField) => {
    setColorByFieldState(value);
    saveColorByToStorage(value);
  }, []);

  // Wrapper to persist colorByMode changes
  const setColorByMode = useCallback((value: ColorByMode) => {
    setColorByModeState(value);
    saveColorByModeToStorage(value);
  }, []);

  // Parse filter terms from search query for map view
  const mapFilterTerms = useMemo(() => {
    const { filterTerms } = parseSearchQuery(searchQuery);
    return filterTerms;
  }, [searchQuery]);

  // Plan store state
  const currentPlan = usePlanStore((state) => state.currentPlan);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);
  const updatePlanting = usePlanStore((state) => state.updatePlanting);
  const bulkUpdatePlantings = usePlanStore((state) => state.bulkUpdatePlantings);
  const bulkDeletePlantings = usePlanStore((state) => state.bulkDeletePlantings);
  const updatePlantingBoxDisplay = usePlanStore((state) => state.updatePlantingBoxDisplay);

  // Centralized computed crops with GDD adjustments
  const { crops: allComputedCrops } = useComputedCrops();

  // UI store - selection state (shared across views)
  const selectedPlantingIds = useUIStore((state) => state.selectedPlantingIds);
  const selectPlanting = useUIStore((state) => state.selectPlanting);
  const togglePlanting = useUIStore((state) => state.togglePlanting);
  const clearSelection = useUIStore((state) => state.clearSelection);
  const setToast = useUIStore((state) => state.setToast);

  // Right panel width state
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [isResizingRightPanel, setIsResizingRightPanel] = useState(false);

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

  // Determine base year from plan data
  const baseYear = useMemo(() => {
    if (!currentPlan?.beds || !currentPlan?.bedGroups) {
      return new Date().getFullYear();
    }

    // Determine the year from actual crop data, not just plan metadata
    // Find the most common year in the crop dates
    const yearCounts = new Map<number, number>();
    for (const crop of allComputedCrops) {
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

    return year;
  }, [currentPlan, allComputedCrops]);

  // Initialize selectedYear when baseYear is determined
  useEffect(() => {
    if (selectedYear === null && baseYear) {
      setSelectedYear(baseYear);
    }
  }, [baseYear, selectedYear]);

  // Build overview data for the selected year
  const overviewData = useMemo(() => {
    if (!currentPlan?.beds || !currentPlan?.bedGroups || selectedYear === null) {
      return [];
    }

    const { nameGroups, bedLengths } = buildBedMappings(currentPlan.beds, currentPlan.bedGroups);

    return buildOverviewData(
      currentPlan.beds,
      currentPlan.bedGroups,
      allComputedCrops,
      selectedYear,
      nameGroups,
      bedLengths,
      currentPlan.specs
    );
  }, [currentPlan, selectedYear, allComputedCrops]);

  // Year for display (use selectedYear or fall back to baseYear)
  const displayYear = selectedYear ?? baseYear;

  // Get unassigned plantings with computed dates for the selected year
  const unassignedPlantings = useMemo(() => {
    if (!currentPlan || selectedYear === null) return [];

    const catalog = currentPlan.specs ?? {};
    const products = currentPlan.products ?? {};

    // Filter to unassigned crops that overlap with the selected year
    return allComputedCrops
      .filter(crop => {
        if (crop.resource) return false; // Skip assigned crops
        if (!crop.startDate || !crop.endDate) return false;

        const start = parseISO(crop.startDate);
        const end = parseISO(crop.endDate);
        const yearStart = new Date(selectedYear, 0, 1);
        const yearEnd = new Date(selectedYear, 11, 31);

        // Check if crop overlaps with selected year
        return start <= yearEnd && end >= yearStart;
      })
      .map(crop => {
        const spec = catalog[crop.specId];
        const revenue = spec ? calculateSpecRevenue(spec, crop.feetNeeded, products) : null;
        return {
          ...crop,
          cropName: spec?.crop ?? crop.name,
          category: spec?.category ?? crop.category ?? '',
          identifier: spec?.identifier ?? crop.specId,
          revenue,
          bgColor: crop.bgColor,
          textColor: crop.textColor,
        };
      });
  }, [currentPlan, selectedYear, allComputedCrops]);

  // Resize handler for sidebar
  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX; // Dragging right increases width for left panel
      const newWidth = Math.max(250, Math.min(600, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  // Handler for assigning a planting to a bed via drag-drop
  const handleAssignPlanting = useCallback(async (plantingId: string, bedId: string) => {
    const result = await updatePlanting(plantingId, { startBed: bedId });
    if (!result.success) {
      setToast({ message: result.error, type: 'error' });
    }
  }, [updatePlanting, setToast]);

  // Handler for external drops on CropTimeline (takes bed name, looks up UUID)
  const handleExternalPlantingDrop = useCallback(async (plantingId: string, bedName: string) => {
    if (!currentPlan?.beds) return;
    // Find bed by name
    const bed = Object.values(currentPlan.beds).find(b => b.name === bedName);
    if (bed) {
      const result = await updatePlanting(plantingId, { startBed: bed.id });
      if (!result.success) {
        setToast({ message: result.error, type: 'error' });
      }
    }
  }, [updatePlanting, currentPlan?.beds, setToast]);

  // Handler for unassigning a planting (drop on sidebar)
  const handleUnassignPlanting = useCallback(async (plantingId: string) => {
    await updatePlanting(plantingId, { startBed: undefined });
  }, [updatePlanting]);

  // State for sidebar drop highlight
  const [isSidebarDragOver, setIsSidebarDragOver] = useState(false);

  // Handler for clicking on a crop box - toggles selection
  const handleCropClick = useCallback((plantingId: string, e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      // Multi-select with modifier keys
      togglePlanting(plantingId);
    } else {
      // Single select - clear others and select this one
      clearSelection();
      selectPlanting(plantingId);
    }
  }, [togglePlanting, clearSelection, selectPlanting]);

  // Convert selected planting IDs to TimelineCrop[] for the inspector panel
  const selectedCropsData = useMemo(() => {
    if (selectedPlantingIds.size === 0) return [];
    return allComputedCrops.filter(crop =>
      crop.plantingId && selectedPlantingIds.has(crop.plantingId)
    );
  }, [selectedPlantingIds, allComputedCrops]);

  // Build color palette for categories (auto-generate from unique values)
  const categoryColorPalette = useMemo(() => {
    const uniqueCategories = [...new Set(allComputedCrops.map(c => c.category).filter(Boolean))].sort();
    const palette: Record<string, string> = {};
    uniqueCategories.forEach((cat, i) => {
      palette[cat as string] = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
    });
    return palette;
  }, [allComputedCrops]);

  // Build dynamic palettes for irrigation and trellisType from specs
  // Only show values that actually exist in the data
  const irrigationColorPalette = useMemo(() => {
    if (!currentPlan?.specs) return {};
    const uniqueValues = [...new Set(
      Object.values(currentPlan.specs)
        .map(c => c.irrigation)
        .filter(Boolean)
    )].sort();
    const palette: Record<string, string> = {};
    uniqueValues.forEach((val) => {
      // Use predefined colors or auto-generate
      palette[val as string] = COLOR_BY_PALETTES.irrigation?.[val as string] ?? CATEGORY_COLORS[Object.keys(palette).length % CATEGORY_COLORS.length];
    });
    return palette;
  }, [currentPlan?.specs]);

  const trellisTypeColorPalette = useMemo(() => {
    if (!currentPlan?.specs) return {};
    const uniqueValues = [...new Set(
      Object.values(currentPlan.specs)
        .map(c => c.trellisType)
        .filter(Boolean)
    )].sort();
    const palette: Record<string, string> = {};
    uniqueValues.forEach((val) => {
      // Use predefined colors or auto-generate
      palette[val as string] = COLOR_BY_PALETTES.trellisType?.[val as string] ?? CATEGORY_COLORS[Object.keys(palette).length % CATEGORY_COLORS.length];
    });
    return palette;
  }, [currentPlan?.specs]);

  // Combined color palettes including dynamic category colors
  const colorPalettes = useMemo((): Record<string, Record<string, string>> => ({
    ...COLOR_BY_PALETTES,
    category: categoryColorPalette,
    irrigation: irrigationColorPalette,
    trellisType: trellisTypeColorPalette,
  }), [categoryColorPalette, irrigationColorPalette, trellisTypeColorPalette]);

  // Right panel resize handler
  const handleRightPanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingRightPanel(true);
    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(280, Math.min(500, startWidth + delta));
      setRightPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingRightPanel(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [rightPanelWidth]);

  // Calculate stats
  const stats = useMemo(() => {
    if (!currentPlan) return { beds: 0, plantings: 0, groups: 0 };
    return {
      beds: Object.keys(currentPlan.beds ?? {}).length,
      plantings: currentPlan.plantings?.length ?? 0,
      groups: Object.keys(currentPlan.bedGroups ?? {}).length,
    };
  }, [currentPlan]);

  // Data for viewing group in CropTimeline
  const viewingGroupData = useMemo(() => {
    if (!viewingGroupId || !currentPlan) return null;

    const group = currentPlan.bedGroups?.[viewingGroupId];
    if (!group) return null;

    // Get beds in this group, sorted by displayOrder
    const bedsInGroup = Object.values(currentPlan.beds ?? {})
      .filter(bed => bed.groupId === viewingGroupId)
      .sort((a, b) => a.displayOrder - b.displayOrder);

    // Resources: bed names in this group
    const resources = bedsInGroup.map(b => b.name);

    // Groups for CropTimeline: just this one group
    const groups: ResourceGroup[] = [{
      name: group.name,
      beds: resources,
    }];

    // Bed lengths for this group
    const bedLengths: Record<string, number> = {};
    for (const bed of bedsInGroup) {
      bedLengths[bed.name] = bed.lengthFt ?? 50;
    }

    // Filter crops to only those assigned to this group's beds (no unassigned section)
    const bedNamesSet = new Set(resources);
    const cropsForGroup = allComputedCrops.filter(
      crop => crop.resource && crop.resource !== 'Unassigned' && bedNamesSet.has(crop.resource)
    );

    return { group, beds: bedsInGroup, resources, groups, bedLengths, crops: cropsForGroup };
  }, [viewingGroupId, currentPlan, allComputedCrops]);

  // Handler for clicking on a group header
  const handleGroupClick = useCallback((groupId: string) => {
    setViewingGroupId(groupId);
  }, []);

  // Build bed mappings for CropTimeline (used for drag operations)
  const bedMappings = useMemo(() => {
    if (!currentPlan?.beds || !currentPlan?.bedGroups) return { nameGroups: {}, bedLengths: {} };
    return buildBedMappings(currentPlan.beds, currentPlan.bedGroups);
  }, [currentPlan]);

  // Use shared drag preview hook for the focused group timeline
  const {
    previewCrops,
    handleBulkCropMove,
    handleBulkCropDateChange,
    handleDragEnd,
  } = useDragPreview({
    crops: viewingGroupData?.crops ?? [],
    plantings: currentPlan?.plantings,
    beds: currentPlan?.beds,
    nameGroups: bedMappings.nameGroups,
    bedLengths: bedMappings.bedLengths,
    bulkUpdatePlantings,
  });

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
    <>
      <AppHeader />
      <div className="h-[calc(100vh-51px)] flex flex-col bg-gray-100">
        {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-gray-200">
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

      {/* Content - flex layout with left sidebar, map, and right panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Unassigned plantings - drop zone for unassigning */}
        {sidebarCollapsed ? (
          /* Collapsed sidebar - just a narrow strip with expand button */
          <aside
            className={`flex-shrink-0 border-r border-gray-200 flex flex-col items-center py-2 transition-colors ${
              isSidebarDragOver ? 'bg-red-50 border-red-300' : 'bg-white'
            }`}
            style={{ width: 40 }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setIsSidebarDragOver(true);
            }}
            onDragLeave={() => setIsSidebarDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsSidebarDragOver(false);
              try {
                const data = JSON.parse(e.dataTransfer.getData('application/json'));
                if (data.type === 'assigned-planting' && data.plantingId) {
                  handleUnassignPlanting(data.plantingId);
                }
              } catch {
                // Invalid drop data, ignore
              }
            }}
          >
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
              title={`Show unassigned (${unassignedPlantings.length})`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {unassignedPlantings.length > 0 && (
              <span className="text-xs text-gray-500 mt-1">{unassignedPlantings.length}</span>
            )}
          </aside>
        ) : (
          /* Expanded sidebar */
          <aside
            className={`flex-shrink-0 border-r border-gray-200 overflow-hidden flex flex-col transition-colors ${
              isSidebarDragOver ? 'bg-red-50 border-red-300' : 'bg-white'
            }`}
            style={{ width: sidebarWidth }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setIsSidebarDragOver(true);
            }}
            onDragLeave={() => setIsSidebarDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsSidebarDragOver(false);
              try {
                const data = JSON.parse(e.dataTransfer.getData('application/json'));
                if (data.type === 'assigned-planting' && data.plantingId) {
                  handleUnassignPlanting(data.plantingId);
                }
              } catch {
                // Invalid drop data, ignore
              }
            }}
          >
            {/* Sidebar header */}
            <div className="p-3 border-b border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-700">
                  Unassigned ({unassignedPlantings.length})
                </h2>
                <div className="flex items-center gap-1">
                  {isSidebarDragOver && (
                    <span className="text-xs text-red-600">Drop to unassign</span>
                  )}
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                    title="Collapse sidebar"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                </div>
              </div>
            {/* Search input */}
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search crops..."
              sortFields={['crop', 'category', 'start', 'end', 'config', 'revenue']}
              width="w-full"
            />
            {/* Map filter mode toggle */}
            {mapFilterTerms.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">Map:</span>
                <button
                  onClick={() => setMapFilterMode(mapFilterMode === 'highlight' ? 'filter' : 'highlight')}
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                    mapFilterMode === 'highlight'
                      ? 'bg-blue-100 border-blue-400 text-blue-800'
                      : 'bg-yellow-100 border-yellow-400 text-yellow-800'
                  }`}
                  title={mapFilterMode === 'highlight'
                    ? 'Fading non-matches. Click to hide them instead.'
                    : 'Hiding non-matches. Click to show all (faded).'
                  }
                >
                  {mapFilterMode === 'filter' ? 'Filtering' : 'Highlight on map'}
                </button>
              </div>
            )}
            {/* Color by categorical field */}
            <div className="mt-2 flex items-center gap-2">
              <label className="text-xs text-gray-500">Color by:</label>
              <select
                value={colorByField}
                onChange={(e) => setColorByField(e.target.value as ColorByField)}
                className="px-2 py-1 text-xs border border-gray-300 rounded bg-white"
              >
                <option value="none">None</option>
                <option value="growingStructure">Growing Structure</option>
                <option value="plantingMethod">Planting Method</option>
                <option value="category">Category</option>
                <option value="irrigation">Irrigation</option>
                <option value="trellisType">Trellis Type</option>
                <option value="gddTiming">GDD Timing</option>
              </select>
            </div>
            {/* Style toggle (border vs background) - only show when color by is active */}
            {colorByField !== 'none' && (
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs text-gray-500">Style:</label>
                <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded">
                  <button
                    onClick={() => setColorByMode('border')}
                    className={`px-2 py-0.5 text-xs rounded transition-colors ${
                      colorByMode === 'border'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Border
                  </button>
                  <button
                    onClick={() => setColorByMode('background')}
                    className={`px-2 py-0.5 text-xs rounded transition-colors ${
                      colorByMode === 'background'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Background
                  </button>
                </div>
              </div>
            )}
            {/* Color legend */}
            {colorByField !== 'none' && colorPalettes[colorByField] && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(colorPalettes[colorByField]).map(([value, color]) => (
                  <div key={value} className="flex items-center gap-1 text-xs">
                    <div
                      className="w-3 h-3 rounded border border-gray-300"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-gray-600">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Unassigned plantings table */}
          <div className="flex-1 overflow-auto">
            <UnassignedPlantingsPanel
              plantings={unassignedPlantings}
              searchQuery={searchQuery}
              onDelete={(plantingId) => bulkDeletePlantings([plantingId])}
            />
          </div>
        </aside>
        )}

        {/* Left resize handle - only when sidebar is expanded */}
        {!sidebarCollapsed && (
          <div
            className={`w-2 bg-gray-200 hover:bg-gray-300 cursor-col-resize flex-shrink-0 ${
              isResizingSidebar ? 'bg-gray-400' : ''
            }`}
            onMouseDown={handleSidebarResizeStart}
          >
            <div className="h-full flex items-center justify-center">
              <div className="w-0.5 h-8 bg-gray-400 rounded" />
            </div>
          </div>
        )}

        {/* Main content area - either FarmGrid or CropTimeline for focused group */}
        {viewingGroupData ? (
          <main className="flex-1 flex flex-col overflow-hidden">
            {/* Back button header */}
            <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3">
              <button
                onClick={() => setViewingGroupId(null)}
                className="flex items-center gap-1 text-gray-600 hover:text-gray-900"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Map
              </button>
              <span className="text-gray-300">|</span>
              <h2 className="text-lg font-semibold text-gray-900">{viewingGroupData.group.name}</h2>
              <span className="text-sm text-gray-500">
                {viewingGroupData.beds.length} bed{viewingGroupData.beds.length !== 1 ? 's' : ''}
              </span>
            </div>
            {/* CropTimeline for this group */}
            <div className="flex-1 overflow-hidden">
              <CropTimeline
                crops={previewCrops}
                resources={viewingGroupData.resources}
                groups={viewingGroupData.groups}
                bedLengths={viewingGroupData.bedLengths}
                onBulkCropMove={handleBulkCropMove}
                onBulkCropDateChange={handleBulkCropDateChange}
                onDragEnd={handleDragEnd}
                specs={currentPlan.specs}
                planYear={currentPlan.metadata.year}
                products={currentPlan.products}
                plantingBoxDisplay={currentPlan.plantingBoxDisplay}
                onUpdatePlantingBoxDisplay={updatePlantingBoxDisplay}
                hideUnassigned
                hideInspector
                onExternalPlantingDrop={handleExternalPlantingDrop}
              />
            </div>
          </main>
        ) : (
          <main className="flex-1 overflow-auto px-4 sm:px-6 lg:px-8 py-6" onClick={() => clearSelection()}>
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
              <FarmGrid
                sections={overviewData}
                year={displayYear}
                baseYear={baseYear}
                onYearChange={setSelectedYear}
                onAssignPlanting={handleAssignPlanting}
                onCropClick={handleCropClick}
                onGroupClick={handleGroupClick}
                selectedPlantingIds={selectedPlantingIds}
                filterTerms={mapFilterTerms}
                filterMode={mapFilterMode}
                colorByField={colorByField}
                colorPalettes={colorPalettes}
                colorByMode={colorByMode}
              />
            )}
          </main>
        )}

        {/* Right panel - Planting Inspector (shown when crops selected) */}
        {selectedCropsData.length > 0 && (
          <>
            {/* Right resize handle */}
            <div
              className={`w-2 bg-gray-200 hover:bg-gray-300 cursor-col-resize flex-shrink-0 ${
                isResizingRightPanel ? 'bg-gray-400' : ''
              }`}
              onMouseDown={handleRightPanelResizeStart}
            >
              <div className="h-full flex items-center justify-center">
                <div className="w-0.5 h-8 bg-gray-400 rounded" />
              </div>
            </div>

            <aside
              className="flex-shrink-0 border-l border-gray-200 bg-white overflow-auto"
              style={{ width: rightPanelWidth }}
            >
              <ConnectedPlantingInspector />
            </aside>
          </>
        )}
      </div>
    </div>

    </>
  );
}
