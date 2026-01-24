'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { addMonths, subMonths, startOfMonth, endOfMonth, startOfYear, endOfYear, parseISO } from 'date-fns';
import type { CropConfig } from '@/lib/entities/crop-config';
import { calculateCropFields } from '@/lib/entities/crop-config';
import { Z_INDEX } from '@/lib/z-index';
import { useUIStore } from '@/lib/ui-store';
import { calculateRowSpan } from '@/lib/timeline-data';
import { getBedGroup } from '@/lib/plan-types';
import { calculateConfigRevenue } from '@/lib/revenue';
import type { CropBoxDisplayConfig } from '@/lib/entities/plan';
import AddToBedPanel from './AddToBedPanel';
import { PlantingInspectorPanel } from './PlantingInspectorPanel';
import CropBoxDisplayEditor, {
  resolveTemplate,
  DEFAULT_HEADER_TEMPLATE,
  DEFAULT_DESCRIPTION_TEMPLATE,
  type CropForDisplay,
} from './CropBoxDisplayEditor';

// =============================================================================
// Types
// =============================================================================

interface PlantingOverrides {
  additionalDaysOfHarvest?: number;
  additionalDaysInField?: number;
  additionalDaysInCells?: number;
}

/** Reference to a seed variety or mix */
interface SeedSource {
  type: 'variety' | 'mix';
  id: string;
}

/** Actuals tracking for a planting */
interface PlantingActuals {
  greenhouseDate?: string;
  fieldDate?: string;
  failed?: boolean;
}

interface TimelineCrop {
  id: string;
  name: string;
  startDate: string; // ISO date
  endDate: string;   // ISO date
  resource: string;  // Bed/location assignment (empty = unassigned)
  category?: string;
  bgColor?: string;
  textColor?: string;
  /** Total feet needed for this planting */
  feetNeeded?: number;
  /** Total number of beds this crop occupies */
  totalBeds: number;
  /** Which bed number this is (1-indexed) in the sequence */
  bedIndex: number;
  /** The base planting ID for grouping related bed entries */
  groupId: string;
  /** Feet of this bed actually used by the crop */
  feetUsed?: number;
  /** Total feet capacity of this bed */
  bedCapacityFt?: number;
  /** Short planting ID from bed plan (e.g., "PEP004") */
  plantingId?: string;
  /** Crop config identifier matching the plan's crop catalog */
  cropConfigId?: string;
  /** Harvest start date (ISO date) - when harvest window begins */
  harvestStartDate?: string;
  /** Planting method: direct-seed, transplant, or perennial */
  plantingMethod?: 'direct-seed' | 'transplant' | 'perennial';
  /** Preview ghost - not a real crop, just for hover preview */
  isPreview?: boolean;
  /** Planting-level timing overrides (for editing in inspector) */
  overrides?: PlantingOverrides;
  /** User notes about this planting */
  notes?: string;
  /** Reference to the seed variety or mix used */
  seedSource?: SeedSource;
  /** Whether planting uses config's default seed source */
  useDefaultSeedSource?: boolean;
  /** Crop name (for filtering varieties/mixes) */
  crop?: string;
  /** Actuals tracking data (actual dates, failed status) */
  actuals?: PlantingActuals;
  /** Sequence ID if planting is part of a succession sequence */
  sequenceId?: string;
  /** Position in sequence (0 = anchor, 1+ = follower) */
  sequenceSlot?: number;
  /** Whether this planting is locked due to actual dates being set */
  isLocked?: boolean;
}

interface ResourceGroup {
  name: string | null;
  beds: string[];
}

// When true, horizontal dragging changes dates; vertical dragging always moves between beds

interface CropTimelineProps {
  crops: TimelineCrop[];
  resources: string[];
  groups?: ResourceGroup[] | null;
  /** Bed lengths from plan data (bed name -> length in feet) */
  bedLengths: Record<string, number>;
  onCropMove?: (cropId: string, newResource: string, groupId?: string, feetNeeded?: number) => void;
  onCropDateChange?: (groupId: string, startDate: string, endDate: string) => void;
  /** Bulk move multiple crops to a new bed (single API call) - preferred over onCropMove for multi-select */
  onBulkCropMove?: (moves: { groupId: string; newResource: string; feetNeeded: number }[]) => void;
  /** Bulk update dates for multiple crops (single API call) - preferred over onCropDateChange for multi-select */
  onBulkCropDateChange?: (updates: { groupId: string; startDate: string }[]) => void;
  /** Called when drag operation ends - committed=true on drop, false on cancel */
  onDragEnd?: (committed: boolean) => void;
  onDuplicateCrop?: (groupId: string) => Promise<string | void>;
  onDeleteCrop?: (groupIds: string[]) => void;
  /** Callback when user wants to edit the crop config. Receives the planting identifier. */
  onEditCropConfig?: (identifier: string) => void;
  /** Crop catalog for adding new plantings */
  cropCatalog?: Record<string, CropConfig>;
  /** Plan year for computing target dates */
  planYear?: number;
  /** Callback when user adds a planting from timeline */
  onAddPlanting?: (configId: string, fieldStartDate: string, bedId: string) => Promise<string | void>;
  /** Callback when user updates planting fields (bedFeet, overrides, notes, seedSource, useDefaultSeedSource, actuals) */
  onUpdatePlanting?: (plantingId: string, updates: {
    bedFeet?: number;
    overrides?: PlantingOverrides;
    notes?: string;
    seedSource?: SeedSource | null;
    useDefaultSeedSource?: boolean;
    actuals?: PlantingActuals;
  }) => Promise<void>;
  /** Varieties available in the plan (for seed source picker) */
  varieties?: Record<string, { id: string; crop: string; name: string; supplier?: string }>;
  /** Seed mixes available in the plan (for seed source picker) */
  seedMixes?: Record<string, { id: string; crop: string; name: string }>;
  /** Products available in the plan (for revenue calculation) */
  products?: Record<string, import('@/lib/entities/product').Product>;
  /** Initial state for no-variety filter (set via URL param) */
  initialNoVarietyFilter?: boolean;
  /** Callback when user wants to create a sequence from a planting */
  onCreateSequence?: (plantingId: string, cropName: string, fieldStartDate: string) => void;
  /** Callback when user wants to unlink a planting from its sequence */
  onUnlinkFromSequence?: (plantingId: string) => void;
  /** Callback when user wants to edit a sequence's properties */
  onEditSequence?: (sequenceId: string) => void;
  /** Crop box display configuration */
  cropBoxDisplay?: CropBoxDisplayConfig;
  /** Callback when user updates crop box display settings */
  onUpdateCropBoxDisplay?: (config: CropBoxDisplayConfig) => void;
}

// =============================================================================
// Seed Source Picker Component
// =============================================================================
// Constants
// =============================================================================

const ZOOM_LEVELS = [
  { label: '2 Yr', days: 730 },
  { label: '1 Yr', days: 365 },
  { label: '6 Mon', days: 180 },
  { label: '3 Mon', days: 90 },
  { label: '1 Mon', days: 30 },
];

const CROP_HEIGHT = 34;
const CROP_SPACING = 4;
const CROP_TOP_PADDING = 8;
const TIMELINE_PADDING_MONTHS = 3;
const DEFAULT_SCROLL_OFFSET_DAYS = 30;
const LANE_LABEL_WIDTH = 180;
const HEADER_HEIGHT = 38;
const UI_STATE_KEY = 'crop-timeline-ui-state';

interface UIState {
  viewMode: 'overlap' | 'stacked';
  zoomIndex: number;
  collapsedGroups: string[];
  unassignedHeight: number;
  scrollLeft: number;
  timingEditEnabled: boolean;
}

function loadUIState(): Partial<UIState> {
  if (typeof window === 'undefined') return {};
  try {
    const saved = localStorage.getItem(UI_STATE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // Ignore parse errors
  }
  return {};
}

function saveUIState(state: UIState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

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

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Lighten or darken a hex color by a percentage
 * @param hex - Hex color string (e.g., '#ff7043')
 * @param percent - Positive to lighten, negative to darken (-100 to 100)
 */
function adjustColor(hex: string, percent: number): string {
  // Remove # if present
  const h = hex.replace('#', '');
  const num = parseInt(h, 16);

  const r = Math.min(255, Math.max(0, (num >> 16) + Math.round(2.55 * percent)));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + Math.round(2.55 * percent)));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + Math.round(2.55 * percent)));

  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Get contrasting text color (black or white) based on background luminance
 */
function getContrastingText(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substr(0, 2), 16);
  const g = parseInt(h.substr(2, 2), 16);
  const b = parseInt(h.substr(4, 2), 16);
  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}

function getColorForCategory(category?: string): { bg: string; text: string } {
  if (!category) return DEFAULT_COLOR;
  return CATEGORY_COLORS[category] || DEFAULT_COLOR;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '?';
  const d = parseISO(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function parseDate(dateStr: string): Date {
  return parseISO(dateStr);
}


/** Info about each bed in a span, including how much is used */
interface BedSpanInfoLocal {
  bed: string;
  feetUsed: number;
  bedCapacityFt: number;
}

// =============================================================================
// Component
// =============================================================================

export default function CropTimeline({
  crops,
  resources,
  groups,
  bedLengths,
  onCropMove,
  onCropDateChange,
  onBulkCropMove,
  onBulkCropDateChange,
  onDragEnd,
  onDuplicateCrop,
  onDeleteCrop,
  onEditCropConfig,
  cropCatalog,
  planYear,
  onAddPlanting,
  onUpdatePlanting,
  varieties,
  seedMixes,
  products,
  initialNoVarietyFilter,
  onCreateSequence,
  onUnlinkFromSequence,
  onEditSequence,
  cropBoxDisplay,
  onUpdateCropBoxDisplay,
}: CropTimelineProps) {
  // Load saved UI state on initial render
  const savedState = useRef<Partial<UIState> | null>(null);
  if (savedState.current === null) {
    savedState.current = loadUIState();
  }

  // State - initialized from saved values
  const [viewMode, setViewMode] = useState<'overlap' | 'stacked'>(
    savedState.current.viewMode ?? 'stacked'
  );
  const [zoomIndex, setZoomIndex] = useState(savedState.current.zoomIndex ?? 2);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(savedState.current.collapsedGroups ?? [])
  );
  const [timingEditEnabled, setTimingEditEnabled] = useState(
    savedState.current.timingEditEnabled ?? false
  );
  const [draggedCropId, setDraggedCropId] = useState<string | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverResource, setDragOverResource] = useState<string | null>(null);

  // Selection state - shared across Timeline and Plantings views via UI store
  // selectedGroupIds tracks planting IDs (groupId = plantingId in TimelineCrop)
  const selectedPlantingIds = useUIStore((state) => state.selectedPlantingIds);
  const togglePlanting = useUIStore((state) => state.togglePlanting);
  const clearSelection = useUIStore((state) => state.clearSelection);
  const selectPlanting = useUIStore((state) => state.selectPlanting);

  // State for "Add to Bed" panel - which bed's + button was clicked
  const [addToBedId, setAddToBedId] = useState<string | null>(null);
  const addToBedPanelRef = useRef<HTMLDivElement>(null);

  // Search filter - shared across views via UI store
  const searchQuery = useUIStore((state) => state.searchQuery);
  const setSearchQuery = useUIStore((state) => state.setSearchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Filter to show only plantings without seed source
  // Initialize from URL param if provided
  const [showNoVarietyOnly, setShowNoVarietyOnly] = useState(initialNoVarietyFilter ?? false);
  // When true, show all bed rows even when filtering (for drag-to-assign workflow)
  const [showAllBeds, setShowAllBeds] = useState(false);
  // When true, sort bed rows by aggregate values; when false only sort crops within beds
  const [sortBedRows, setSortBedRows] = useState(true);
  // State for search help modal
  const [showSearchHelp, setShowSearchHelp] = useState(false);
  // State for crop box display editor
  const [showDisplayEditor, setShowDisplayEditor] = useState(false);
  // State for search autocomplete
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  // State for hover preview when browsing crops in AddToBedPanel
  const [hoverPreview, setHoverPreview] = useState<{
    config: CropConfig;
    fieldStartDate: string;
  } | null>(null);
  const [unassignedHeight, setUnassignedHeight] = useState(
    savedState.current.unassignedHeight ?? 150
  );
  const [isResizing, setIsResizing] = useState(false);
  const [scrollLeft, setScrollLeft] = useState(0);

  // For timing mode: track drag start position and original dates
  const dragStartX = useRef<number | null>(null);
  const dragOriginalDates = useRef<{ start: string; end: string } | null>(null);

  // Live drag state - updated during drag WITHOUT triggering re-renders
  // These values drive the ghost preview via direct DOM updates
  // Removed dragDeltaRef - not needed with direct state updates


  // Drag state: track dragged items and cache for rollback
  const [dragPreview, setDragPreview] = useState<{
    // Which groups are being moved
    draggedGroupIds: Set<string>;
    // Primary crop info for ghost display
    primaryCropName: string;
    primaryGroupId: string;
    // Original position for visual feedback
    originalLeft: number;
    originalWidth: number;
    // Y position within lane for ghost placement
    laneOffsetY?: number;
  } | null>(null);

  // Cache original planting state for rollback on drag failure
  const dragCache = useRef<Map<string, { startBed: string | null; fieldStartDate: string }>>(new Map());

  // Refs
  const plannerScrollRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
  const savedScrollLeft = useRef(savedState.current.scrollLeft ?? null);

  // Calculate timeline range
  const { timelineStart, timelineEnd } = useMemo(() => {
    const now = new Date();

    if (crops.length === 0) {
      return {
        timelineStart: startOfYear(now),
        timelineEnd: endOfYear(now),
      };
    }

    let minDate = new Date(now);
    let maxDate = new Date(now);

    for (const crop of crops) {
      const start = parseDate(crop.startDate);
      const end = parseDate(crop.endDate);
      if (start < minDate) minDate = start;
      if (end > maxDate) maxDate = end;
    }

    return {
      timelineStart: startOfMonth(subMonths(minDate, TIMELINE_PADDING_MONTHS)),
      timelineEnd: endOfMonth(addMonths(maxDate, TIMELINE_PADDING_MONTHS)),
    };
  }, [crops]);

  // Calculate pixels per day based on zoom level
  const pixelsPerDay = useMemo(() => {
    const viewportWidth = plannerScrollRef.current?.clientWidth || 800;
    const targetDays = ZOOM_LEVELS[zoomIndex].days;
    return Math.max(1, viewportWidth / targetDays);
  }, [zoomIndex]);

  // Get position for a crop on the timeline
  const getTimelinePosition = useCallback((startDate: string, endDate: string) => {
    const startMs = parseDate(startDate).getTime() - timelineStart.getTime();
    const endDateObj = parseDate(endDate);
    endDateObj.setDate(endDateObj.getDate() + 1); // Include full last day
    const endMs = endDateObj.getTime() - timelineStart.getTime();

    const msPerDay = 1000 * 60 * 60 * 24;
    const left = (startMs / msPerDay) * pixelsPerDay;
    const width = ((endMs - startMs) / msPerDay) * pixelsPerDay;

    return { left: Math.max(0, left), width: Math.max(30, width) };
  }, [timelineStart, pixelsPerDay]);

  // Autocomplete suggestions for search DSL
  const SORT_FIELDS = ['revenue', 'date', 'end', 'name', 'bed', 'category', 'feet', 'size'];
  const SORT_DIRS = ['asc', 'desc'];
  const FILTER_FIELDS = ['bed', 'group', 'bedGroup', 'category', 'method', 'crop', 'notes'];

  const autocompleteSuggestions = useMemo(() => {
    if (!searchQuery) return [];

    // Get the last word being typed
    const words = searchQuery.split(/\s+/);
    const lastWord = words[words.length - 1].toLowerCase();

    // Check if typing a sort directive (sort: or s: shorthand)
    const isSortPrefix = lastWord.startsWith('sort:') || lastWord.startsWith('s:');
    if (isSortPrefix) {
      const prefixLen = lastWord.startsWith('sort:') ? 5 : 2;
      const afterSort = lastWord.slice(prefixLen);

      // Check if we have a field and are typing direction
      const colonIndex = afterSort.indexOf(':');
      if (colonIndex > 0) {
        // Typing direction (e.g., "s:revenue:")
        const dirPrefix = afterSort.slice(colonIndex + 1);
        return SORT_DIRS
          .filter(d => d.startsWith(dirPrefix))
          .map(d => ({ type: 'sortDir', value: d, display: d, full: `s:${afterSort.slice(0, colonIndex)}:${d}` }));
      } else {
        // Typing field (e.g., "s:" or "s:r")
        return SORT_FIELDS
          .filter(f => f.startsWith(afterSort))
          .map(f => ({ type: 'sortField', value: f, display: f, full: `s:${f}` }));
      }
    }

    // Check if typing a filter field
    const colonIndex = lastWord.indexOf(':');
    if (colonIndex === -1 && lastWord.length > 0) {
      // Might be starting a field filter
      const fieldMatches = FILTER_FIELDS
        .filter(f => f.toLowerCase().startsWith(lastWord))
        .map(f => ({ type: 'filterField', value: f, display: `${f}:`, full: `${f}:` }));

      // Also suggest "sort:" (or "s:") if it matches
      if ('sort'.startsWith(lastWord) || lastWord === 's') {
        fieldMatches.unshift({ type: 'sort', value: 's', display: 's:', full: 's:' });
      }

      return fieldMatches;
    }

    return [];
  }, [searchQuery]);

  // Reset autocomplete index when suggestions change
  useEffect(() => {
    setAutocompleteIndex(0);
  }, [autocompleteSuggestions.length]);

  // ==========================================================================
  // SEARCH DSL: Parse sort directive from search query
  // ==========================================================================
  const { sortField, sortDir, filterTerms: parsedFilterTerms } = useMemo(() => {
    let field: string | null = null;
    let dir: 'asc' | 'desc' = 'asc';
    const terms: string[] = [];

    if (searchQuery.trim()) {
      const allTerms = searchQuery.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);
      const sortPattern = /^(?:sort|s):(\w+)(?::(asc|desc))?$/i;

      for (const term of allTerms) {
        const sortMatch = term.match(sortPattern);
        if (sortMatch) {
          field = sortMatch[1].toLowerCase();
          dir = (sortMatch[2]?.toLowerCase() as 'asc' | 'desc') || 'asc';
        } else {
          terms.push(term);
        }
      }
    }

    return { sortField: field, sortDir: dir, filterTerms: terms };
  }, [searchQuery]);

  // ==========================================================================
  // SEARCH DSL: Revenue calculator for sorting
  // ==========================================================================
  const getRevenue = useCallback((crop: TimelineCrop): number => {
    if (!cropCatalog || !products || !crop.cropConfigId) return 0;
    const config = cropCatalog[crop.cropConfigId];
    if (!config) return 0;
    return calculateConfigRevenue(config, crop.feetNeeded || 50, products) ?? 0;
  }, [cropCatalog, products]);

  // ==========================================================================
  // SEARCH DSL: Crop comparator for sorting
  // ==========================================================================
  const compareCrops = useCallback((a: TimelineCrop, b: TimelineCrop): number => {
    if (!sortField) return 0;

    let aVal: number | string = 0;
    let bVal: number | string = 0;

    switch (sortField) {
      case 'revenue':
        aVal = getRevenue(a);
        bVal = getRevenue(b);
        break;
      case 'date':
      case 'start':
        aVal = a.startDate || '';
        bVal = b.startDate || '';
        break;
      case 'end':
        aVal = a.endDate || '';
        bVal = b.endDate || '';
        break;
      case 'name':
        aVal = a.name?.toLowerCase() || '';
        bVal = b.name?.toLowerCase() || '';
        break;
      case 'bed':
        aVal = a.resource || '';
        bVal = b.resource || '';
        break;
      case 'category':
        aVal = a.category?.toLowerCase() || '';
        bVal = b.category?.toLowerCase() || '';
        break;
      case 'feet':
      case 'size':
        aVal = a.feetNeeded || 0;
        bVal = b.feetNeeded || 0;
        break;
    }

    // Compare values
    let cmp: number;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      cmp = aVal.localeCompare(bVal);
    } else {
      cmp = (aVal as number) - (bVal as number);
    }
    return sortDir === 'desc' ? -cmp : cmp;
  }, [sortField, sortDir, getRevenue]);

  // ==========================================================================
  // SEARCH DSL: Filter crops by search terms
  // ==========================================================================
  const filteredCrops = useMemo(() => {
    let result = crops;

    // Apply no-variety filter first
    if (showNoVarietyOnly) {
      result = result.filter(crop => !crop.seedSource);
    }

    // Apply search filter terms
    if (parsedFilterTerms.length > 0) {
      const fieldPattern = /^(bed|group|bedGroup|category|method|crop|notes):(.+)$/i;

      result = result.filter(crop => {
        const searchText = [
          crop.name,
          crop.category,
          crop.cropConfigId,
          crop.resource,
          crop.crop,
          crop.notes,
          crop.plantingMethod,
          crop.groupId,
        ].filter(Boolean).join(' ').toLowerCase();

        return parsedFilterTerms.every(term => {
          const fieldMatch = term.match(fieldPattern);
          if (fieldMatch) {
            const [, field, value] = fieldMatch;
            switch (field.toLowerCase()) {
              case 'bed':
                return crop.resource?.toLowerCase().includes(value);
              case 'group':
              case 'bedgroup':
                return getBedGroup(crop.resource || '').toLowerCase().includes(value);
              case 'category':
                return crop.category?.toLowerCase().includes(value);
              case 'method':
                return crop.plantingMethod?.toLowerCase().includes(value);
              case 'crop':
                return crop.crop?.toLowerCase().includes(value) || crop.name?.toLowerCase().includes(value);
              case 'notes':
                return crop.notes?.toLowerCase().includes(value);
              default:
                return searchText.includes(term);
            }
          }
          return searchText.includes(term);
        });
      });
    }

    // Sort filtered crops
    if (sortField) {
      result = [...result].sort(compareCrops);
    }

    return result;
  }, [crops, showNoVarietyOnly, parsedFilterTerms, sortField, compareCrops]);

  // During drag: parent applies pending changes to crops prop for preview
  // CropTimeline just renders what it's given
  const effectiveCrops = filteredCrops;

  // Build nameGroups lookup: group key → ordered list of beds in that group
  // Key is derived from bed names using getBedGroup (e.g., "H" from "H1")
  // Format matches what calculateRowSpan expects: { "H": ["H1", "H2"], "A": ["A1", "A2"] }
  const nameGroups = useMemo(() => {
    const result: Record<string, string[]> = {};
    if (groups) {
      for (const group of groups) {
        // Derive group key from first bed name (e.g., "H" from "H1")
        const firstBed = group.beds[0];
        const groupKey = firstBed ? getBedGroup(firstBed) : group.name || '';
        if (groupKey && group.beds.length > 0) {
          result[groupKey] = group.beds;
        }
      }
    }
    return result;
  }, [groups]);

  // Group crops by resource with render-time bed spanning
  // Each crop is 1:1 with a planting; we expand to per-bed entries here
  // Also sort within each bed when sort is active
  const cropsByResource = useMemo(() => {
    const result: Record<string, TimelineCrop[]> = {};

    for (const crop of effectiveCrops) {
      // Unassigned crops - single entry
      if (!crop.resource) {
        if (!result['Unassigned']) result['Unassigned'] = [];
        result['Unassigned'].push({
          ...crop,
          totalBeds: 1,
          bedIndex: 1,
        });
        continue;
      }

      // Compute bed span at render time
      const feetNeeded = crop.feetNeeded || 50;
      const span = calculateRowSpan(feetNeeded, crop.resource, nameGroups, bedLengths);

      // Create entry for each bed in span
      for (let i = 0; i < span.bedSpanInfo.length; i++) {
        const info = span.bedSpanInfo[i];
        if (!result[info.bed]) result[info.bed] = [];
        result[info.bed].push({
          ...crop,
          id: `${crop.groupId}_bed${i}`,
          resource: info.bed,
          totalBeds: span.bedSpanInfo.length,
          bedIndex: i + 1,
          feetUsed: info.feetUsed,
          bedCapacityFt: info.bedCapacityFt,
        });
      }
    }

    // Sort within each bed when sort is active
    if (sortField) {
      for (const bedCrops of Object.values(result)) {
        bedCrops.sort(compareCrops);
      }
    }

    return result;
  }, [effectiveCrops, nameGroups, bedLengths, sortField, compareCrops]);

  // Set of resources that have matching crops (for filtering rows)
  const matchingResources = useMemo(() => {
    if (!searchQuery.trim() && !showNoVarietyOnly) return null; // null means show all
    if (showAllBeds) return null; // Show all beds when toggle is on (for drag-to-assign workflow)
    // Use cropsByResource keys since that's what determines which rows have crops
    return new Set(Object.keys(cropsByResource));
  }, [cropsByResource, searchQuery, showNoVarietyOnly, showAllBeds]);

  // Compute variety/mix IDs used in the plan (for sorting in picker)
  const { usedVarietyIds, usedMixIds } = useMemo(() => {
    const varietyIds = new Set<string>();
    const mixIds = new Set<string>();
    for (const crop of crops) {
      if (crop.seedSource) {
        if (crop.seedSource.type === 'variety') {
          varietyIds.add(crop.seedSource.id);
        } else {
          mixIds.add(crop.seedSource.id);
        }
      }
    }
    return { usedVarietyIds: varietyIds, usedMixIds: mixIds };
  }, [crops]);

  // Count plantings without seed source (by groupId to avoid counting per-bed)
  const noVarietyCount = useMemo(() => {
    const seenGroupIds = new Set<string>();
    let count = 0;
    for (const crop of crops) {
      if (!seenGroupIds.has(crop.groupId)) {
        seenGroupIds.add(crop.groupId);
        if (!crop.seedSource) {
          count++;
        }
      }
    }
    return count;
  }, [crops]);

  // Calculate stacking for crops in a lane
  // When sortField is active (non-date), use the input order (already sorted by revenue, etc.)
  // This gives priority row assignment to higher-ranked crops in the sort
  const calculateStacking = useCallback((laneCrops: TimelineCrop[]) => {
    if (laneCrops.length === 0) return { rows: {} as Record<string, number>, maxRow: 1 };

    // When sorting by a non-date field, preserve the input order (already sorted)
    // Otherwise sort by date for traditional timeline stacking
    const sorted = sortField && sortField !== 'date' && sortField !== 'start' && sortField !== 'end'
      ? laneCrops  // Already sorted by revenue/name/etc - preserve order
      : [...laneCrops].sort((a, b) =>
          parseDate(a.startDate).getTime() - parseDate(b.startDate).getTime()
        );

    const rows: Record<string, number> = {};
    const rowEndTimes: number[] = [];

    for (const crop of sorted) {
      const startTime = parseDate(crop.startDate).getTime();
      const endTime = parseDate(crop.endDate).getTime();

      let assignedRow = -1;
      for (let r = 0; r < rowEndTimes.length; r++) {
        if (startTime > rowEndTimes[r]) {
          assignedRow = r;
          break;
        }
      }

      if (assignedRow === -1) {
        assignedRow = rowEndTimes.length;
        rowEndTimes.push(endTime);
      } else {
        rowEndTimes[assignedRow] = endTime;
      }

      rows[crop.id] = assignedRow;
    }

    return { rows, maxRow: Math.max(1, rowEndTimes.length) };
  }, [sortField]);

  // Find overlapping crops - checks each resource for time overlaps
  const overlappingIds = useMemo(() => {
    const overlapping = new Set<string>();

    for (const resource in cropsByResource) {
      const laneCrops = cropsByResource[resource];
      for (let i = 0; i < laneCrops.length; i++) {
        for (let j = i + 1; j < laneCrops.length; j++) {
          const a = laneCrops[i];
          const b = laneCrops[j];
          // Don't count same crop group as overlapping with itself
          if (a.groupId === b.groupId) continue;

          const aStart = parseDate(a.startDate).getTime();
          const aEnd = parseDate(a.endDate).getTime();
          const bStart = parseDate(b.startDate).getTime();
          const bEnd = parseDate(b.endDate).getTime();

          if (aStart <= bEnd && bStart <= aEnd) {
            overlapping.add(a.id);
            overlapping.add(b.id);
          }
        }
      }
    }

    return overlapping;
  }, [cropsByResource]);

  // Calculate over-capacity time ranges for each bed
  // Returns { [bedName]: Array<{ start: string; end: string }> }
  const overCapacityRanges = useMemo(() => {
    const result: Record<string, Array<{ start: Date; end: Date }>> = {};

    for (const [bed, crops] of Object.entries(cropsByResource)) {
      if (bed === 'Unassigned' || crops.length < 2) continue;

      const bedCapacity = bedLengths[bed] ?? 50;

      // Build events: +feet at start, -feet at end
      type Event = { date: Date; delta: number };
      const events: Event[] = [];

      for (const crop of crops) {
        const feet = crop.feetUsed ?? crop.feetNeeded ?? 50;
        const start = parseDate(crop.startDate);
        const end = parseDate(crop.endDate);
        events.push({ date: start, delta: feet });
        // End is exclusive (crop leaves the day after endDate)
        const endNext = new Date(end);
        endNext.setDate(endNext.getDate() + 1);
        events.push({ date: endNext, delta: -feet });
      }

      // Sort events by date
      events.sort((a, b) => a.date.getTime() - b.date.getTime());

      // Walk through events tracking cumulative feet
      let cumulative = 0;
      let overStart: Date | null = null;
      const ranges: Array<{ start: Date; end: Date }> = [];

      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const prevCumulative = cumulative;
        cumulative += event.delta;

        // Started being over capacity
        if (prevCumulative <= bedCapacity && cumulative > bedCapacity) {
          overStart = event.date;
        }
        // Stopped being over capacity
        if (prevCumulative > bedCapacity && cumulative <= bedCapacity && overStart) {
          ranges.push({ start: overStart, end: event.date });
          overStart = null;
        }
      }

      // Handle case where still over capacity at end
      if (overStart) {
        const lastEvent = events[events.length - 1];
        ranges.push({ start: overStart, end: lastEvent.date });
      }

      if (ranges.length > 0) {
        result[bed] = ranges;
      }
    }

    return result;
  }, [cropsByResource, bedLengths]);

  // Generate month headers
  const monthHeaders = useMemo(() => {
    const headers: { month: string; year: number; width: number }[] = [];
    const current = new Date(timelineStart);
    const msPerDay = 1000 * 60 * 60 * 24;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    while (current <= timelineEnd) {
      const monthStart = new Date(current);
      // Get midnight of the first day of NEXT month (end boundary, exclusive)
      const nextMonthStart = new Date(current.getFullYear(), current.getMonth() + 1, 1);
      const startMs = monthStart.getTime() - timelineStart.getTime();
      // Include the full last day by using nextMonthStart as the end boundary
      const endMs = Math.min(nextMonthStart.getTime(), timelineEnd.getTime() + msPerDay) - timelineStart.getTime();
      const days = (endMs - startMs) / msPerDay;

      headers.push({
        month: monthNames[current.getMonth()],
        year: current.getFullYear(),
        width: days * pixelsPerDay,
      });

      current.setMonth(current.getMonth() + 1);
    }

    return headers;
  }, [timelineStart, timelineEnd, pixelsPerDay]);

  // Today line position
  const todayPosition = useMemo(() => {
    const today = new Date();
    if (today < timelineStart || today > timelineEnd) return null;
    const pos = getTimelinePosition(today.toISOString(), today.toISOString());
    return pos.left;
  }, [timelineStart, timelineEnd, getTimelinePosition]);

  // Scroll sync is handled by CSS sticky positioning

  // Initial scroll - restore saved position or go to today
  useEffect(() => {
    if (initialScrollDone.current || !plannerScrollRef.current) return;
    initialScrollDone.current = true;

    if (savedScrollLeft.current !== null) {
      // Restore saved scroll position
      plannerScrollRef.current.scrollLeft = savedScrollLeft.current;
    } else {
      // Default: scroll to today
      const scrollToDate = new Date(Date.now() - DEFAULT_SCROLL_OFFSET_DAYS * 24 * 60 * 60 * 1000);
      const msPerDay = 1000 * 60 * 60 * 24;
      const daysFromStart = (scrollToDate.getTime() - timelineStart.getTime()) / msPerDay;
      plannerScrollRef.current.scrollLeft = Math.max(0, daysFromStart * pixelsPerDay);
    }
  }, [timelineStart, pixelsPerDay]);

  // Close "Add to Bed" panel when clicking outside
  useEffect(() => {
    if (!addToBedId) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (addToBedPanelRef.current && !addToBedPanelRef.current.contains(e.target as Node)) {
        setAddToBedId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [addToBedId]);

  // Keyboard shortcuts for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+F to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      // Escape to clear search (when search input is focused)
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearchQuery('');
        searchInputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Save UI state when it changes
  useEffect(() => {
    const saveState = () => {
      saveUIState({
        viewMode,
        zoomIndex,
        collapsedGroups: Array.from(collapsedGroups),
        unassignedHeight,
        scrollLeft: plannerScrollRef.current?.scrollLeft ?? 0,
        timingEditEnabled,
      });
    };

    // Save on state changes
    saveState();

    // Also save scroll position on scroll (debounced)
    const scrollEl = plannerScrollRef.current;
    if (!scrollEl) return;

    let scrollTimeout: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      // Update scroll position for sticky text positioning
      setScrollLeft(scrollEl.scrollLeft);
      // Debounce saving state
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(saveState, 200);
    };

    // Initialize scroll position
    setScrollLeft(scrollEl.scrollLeft);

    scrollEl.addEventListener('scroll', handleScroll);
    return () => {
      scrollEl.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [viewMode, zoomIndex, collapsedGroups, unassignedHeight, timingEditEnabled]);

  // Zoom handlers
  const zoomIn = () => {
    if (zoomIndex < ZOOM_LEVELS.length - 1) setZoomIndex(zoomIndex + 1);
  };

  const zoomOut = () => {
    if (zoomIndex > 0) setZoomIndex(zoomIndex - 1);
  };

  const goToToday = () => {
    if (!plannerScrollRef.current) return;
    const scrollToDate = new Date(Date.now() - DEFAULT_SCROLL_OFFSET_DAYS * 24 * 60 * 60 * 1000);
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysFromStart = (scrollToDate.getTime() - timelineStart.getTime()) / msPerDay;
    plannerScrollRef.current.scrollLeft = Math.max(0, daysFromStart * pixelsPerDay);
  };

  // Helper to convert pixel offset to date offset
  const pixelsToDays = useCallback((pixels: number) => {
    return Math.round(pixels / pixelsPerDay);
  }, [pixelsPerDay]);

  // Helper to offset a date by days
  const offsetDate = useCallback((dateStr: string, days: number): string => {
    const date = parseISO(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }, []);

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, crop: TimelineCrop) => {
    // Prevent dragging locked plantings (have actual dates set)
    if (crop.isLocked) {
      e.preventDefault();
      return;
    }

    // If this is a secondary bed of a multi-bed crop, find and use the first bed instead
    // This allows dragging from any bed while treating it as if the first bed was grabbed
    let effectiveCrop = crop;
    if (crop.totalBeds > 1 && crop.bedIndex !== 1) {
      const firstBed = crops.find(c => c.groupId === crop.groupId && c.bedIndex === 1);
      if (firstBed) {
        effectiveCrop = firstBed;
      }
    }

    // Encode crop info for the drop handler (always use the first bed's info)
    const dragData = JSON.stringify({
      cropId: effectiveCrop.id,
      groupId: effectiveCrop.groupId,
      feetNeeded: effectiveCrop.feetNeeded || 50,
      startDate: effectiveCrop.startDate,
      endDate: effectiveCrop.endDate,
      originalResource: effectiveCrop.resource,
    });
    e.dataTransfer.setData('application/json', dragData);
    e.dataTransfer.setData('text/plain', effectiveCrop.id); // Fallback for compatibility
    e.dataTransfer.effectAllowed = 'move';

    // Hide the default browser drag image (we show our own ghost preview)
    const emptyImg = new Image();
    emptyImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(emptyImg, 0, 0);

    setDraggedCropId(effectiveCrop.id);
    setDraggedGroupId(effectiveCrop.groupId);

    // Track start position for header indicator (always) and timing edit (when enabled)
    dragStartX.current = e.clientX;
    if (timingEditEnabled) {
      dragOriginalDates.current = { start: effectiveCrop.startDate, end: effectiveCrop.endDate };
    }

    // Get original crop position for preview (use first bed's resource)
    const originalPos = getTimelinePosition(effectiveCrop.startDate, effectiveCrop.endDate);

    // Find all related groupIds (this planting + sequence members + selected crops)
    const draggedGroupIds = new Set<string>([effectiveCrop.groupId]);

    // If dragged crop is selected, include all selected crops
    if (selectedPlantingIds.has(effectiveCrop.groupId)) {
      selectedPlantingIds.forEach(id => draggedGroupIds.add(id));
    }

    // Add sequence members for all related crops
    const groupsToExpand = Array.from(draggedGroupIds);
    for (const groupId of groupsToExpand) {
      const groupCrop = crops.find(c => c.groupId === groupId);
      if (groupCrop?.sequenceId) {
        crops.forEach(c => {
          if (c.sequenceId === groupCrop.sequenceId) {
            draggedGroupIds.add(c.groupId);
          }
        });
      }
    }

    // Cache original state for all dragged plantings (for rollback on failure)
    dragCache.current.clear();
    for (const groupId of draggedGroupIds) {
      const groupCrop = crops.find(c => c.groupId === groupId && c.bedIndex === 1);
      if (groupCrop) {
        dragCache.current.set(groupId, {
          startBed: groupCrop.resource || null,
          fieldStartDate: groupCrop.startDate,
        });
      }
    }

    // Initialize drag preview state (for visual styling and ghost)
    setDragPreview({
      draggedGroupIds,
      primaryCropName: effectiveCrop.name,
      primaryGroupId: effectiveCrop.groupId,
      originalLeft: originalPos.left,
      originalWidth: originalPos.width,
    });
  };

  const handleDragEnd = () => {
    // Drag was cancelled (not dropped) - notify parent to discard pending changes
    onDragEnd?.(false);
    dragCache.current.clear();

    // Clear drag state
    setDraggedCropId(null);
    setDraggedGroupId(null);
    setDragOverResource(null);
    setDragPreview(null);
    dragStartX.current = null;
    dragOriginalDates.current = null;
  };

  const handleDragOver = (e: React.DragEvent, resource: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Calculate Y offset within the lane element
    const laneElement = e.currentTarget as HTMLElement;
    const rect = laneElement.getBoundingClientRect();
    const laneOffsetY = e.clientY - rect.top;

    // Update drag-over highlight
    if (dragOverResource !== resource) {
      setDragOverResource(resource);

      // Directly update planting state when bed changes
      if (dragPreview) {
        const targetBed = resource === 'Unassigned' ? '' : resource;

        // Collect all moves that need to happen
        const moves: { groupId: string; newResource: string; feetNeeded: number }[] = [];
        for (const groupId of dragPreview.draggedGroupIds) {
          const groupCrop = crops.find(c => c.groupId === groupId && c.bedIndex === 1);
          if (groupCrop && groupCrop.resource !== targetBed) {
            moves.push({ groupId, newResource: targetBed, feetNeeded: groupCrop.feetNeeded || 50 });
          }
        }

        // Use bulk callback if available, otherwise fall back to individual calls
        if (moves.length > 0) {
          if (onBulkCropMove) {
            onBulkCropMove(moves);
          } else if (onCropMove) {
            for (const move of moves) {
              const groupCrop = crops.find(c => c.groupId === move.groupId && c.bedIndex === 1);
              if (groupCrop) {
                onCropMove(groupCrop.id, move.newResource, move.groupId, move.feetNeeded);
              }
            }
          }
        }
      }
    }

    // Calculate date changes if timing edit enabled
    if (timingEditEnabled && dragStartX.current !== null && dragPreview) {
      const deltaX = e.clientX - dragStartX.current;
      const deltaDays = pixelsToDays(deltaX);

      if (deltaDays !== 0) {
        // Collect all date updates that need to happen
        const dateUpdates: { groupId: string; startDate: string }[] = [];
        for (const groupId of dragPreview.draggedGroupIds) {
          const groupCrop = crops.find(c => c.groupId === groupId && c.bedIndex === 1);
          if (groupCrop) {
            const cachedOriginal = dragCache.current.get(groupId);
            if (cachedOriginal) {
              const newStart = offsetDate(cachedOriginal.fieldStartDate, deltaDays);
              if (groupCrop.startDate !== newStart) {
                dateUpdates.push({ groupId, startDate: newStart });
              }
            }
          }
        }

        // Use bulk callback if available, otherwise fall back to individual calls
        if (dateUpdates.length > 0) {
          if (onBulkCropDateChange) {
            onBulkCropDateChange(dateUpdates);
          } else if (onCropDateChange) {
            for (const update of dateUpdates) {
              const groupCrop = crops.find(c => c.groupId === update.groupId && c.bedIndex === 1);
              if (groupCrop) {
                onCropDateChange(update.groupId, update.startDate, groupCrop.endDate);
              }
            }
          }
        }
      }
    }

    // Update laneOffsetY for ghost positioning
    if (dragPreview) {
      setDragPreview(prev => prev ? {
        ...prev,
        laneOffsetY,
      } : null);
    }
  };

  const handleDragLeave = () => {
    setDragOverResource(null);
  };

  const handleDrop = (e: React.DragEvent, _resource: string) => {
    e.preventDefault();
    setDragOverResource(null);

    // Drop succeeded - notify parent to commit pending changes
    onDragEnd?.(true);
    dragCache.current.clear();
    setDraggedCropId(null);
    setDraggedGroupId(null);
    setDragPreview(null);
    dragStartX.current = null;
    dragOriginalDates.current = null;
  };

  // Toggle group collapse
  const toggleGroup = (groupName: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  // Resize handlers for Unassigned section
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = unassignedHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const newHeight = Math.max(80, Math.min(500, startHeight + delta));
      setUnassignedHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [unassignedHeight]);

  // ==========================================================================
  // SEARCH DSL: Compute bed aggregates for sorting
  // ==========================================================================
  const bedAggregates = useMemo(() => {
    const agg: Record<string, { revenue: number; count: number; totalFeet: number }> = {};

    for (const [bed, crops] of Object.entries(cropsByResource)) {
      if (bed === 'Unassigned') continue;
      let revenue = 0;
      let totalFeet = 0;
      // Use unique groupIds to avoid counting multi-bed plantings multiple times
      const countedGroups = new Set<string>();

      for (const crop of crops) {
        // Only count primary bed entry (bedIndex === 1) for aggregates
        if (crop.bedIndex === 1 || crop.totalBeds === 1) {
          revenue += getRevenue(crop);
          totalFeet += crop.feetNeeded || 0;
        }
        countedGroups.add(crop.groupId);
      }

      agg[bed] = { revenue, count: countedGroups.size, totalFeet };
    }

    return agg;
  }, [cropsByResource, getRevenue]);

  // ==========================================================================
  // SEARCH DSL: Bed comparator for sorting bed rows
  // ==========================================================================
  const compareBeds = useCallback((a: string, b: string): number => {
    if (!sortField) return 0;

    const aAgg = bedAggregates[a] || { revenue: 0, count: 0, totalFeet: 0 };
    const bAgg = bedAggregates[b] || { revenue: 0, count: 0, totalFeet: 0 };

    let aVal: number | string = 0;
    let bVal: number | string = 0;

    switch (sortField) {
      case 'revenue':
        aVal = aAgg.revenue;
        bVal = bAgg.revenue;
        break;
      case 'count':
        aVal = aAgg.count;
        bVal = bAgg.count;
        break;
      case 'feet':
      case 'size':
        aVal = aAgg.totalFeet;
        bVal = bAgg.totalFeet;
        break;
      case 'bed':
      case 'name':
        aVal = a;
        bVal = b;
        break;
      default:
        // For other sort fields (date, category), use first crop's value
        const aCrops = cropsByResource[a] || [];
        const bCrops = cropsByResource[b] || [];
        const aCrop = aCrops[0];
        const bCrop = bCrops[0];
        if (aCrop && bCrop) {
          return compareCrops(aCrop, bCrop);
        }
        return 0;
    }

    const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal as string) : (aVal - (bVal as number));
    return sortDir === 'desc' ? -cmp : cmp;
  }, [sortField, sortDir, bedAggregates, cropsByResource, compareCrops]);

  // Build resources list for rendering (filtered by search when active)
  // Sorts beds within groups when sort is active
  const resourcesForRendering = useMemo(() => {
    if (groups && groups.length > 0) {
      const result: { resource: string; groupName: string | null; groupIndex: number; resourceIndex: number }[] = [];
      let groupIndex = 0;
      let resourceIndex = 0;

      for (const group of groups) {
        const isCollapsed = group.name && collapsedGroups.has(group.name);
        if (isCollapsed) {
          // When filtering, only show collapsed group if it has matching beds
          if (matchingResources) {
            const hasMatch = group.beds.some(bed => matchingResources.has(bed));
            if (!hasMatch) {
              groupIndex++;
              continue;
            }
          }
          // Show collapsed placeholder
          result.push({ resource: `__collapsed__${group.name}`, groupName: group.name, groupIndex, resourceIndex });
          resourceIndex++;
        } else {
          // Get beds for this group, optionally sorted
          let beds = group.beds.filter(bed => bed !== 'Unassigned');
          if (matchingResources) {
            beds = beds.filter(bed => matchingResources.has(bed));
          }

          // Sort beds within group when sort is active (but not during drag, and only if sortBedRows is enabled)
          if (sortField && !draggedCropId && sortBedRows) {
            beds = [...beds].sort(compareBeds);
          }

          for (const bed of beds) {
            result.push({ resource: bed, groupName: group.name, groupIndex, resourceIndex });
            resourceIndex++;
          }
        }
        groupIndex++;
      }

      return result;
    }

    // No groups - just flat list of resources
    let flatResources = resources
      .filter(r => r !== 'Unassigned')
      .filter(r => !matchingResources || matchingResources.has(r));

    // Sort when sort is active (but not during drag, and only if sortBedRows is enabled)
    if (sortField && !draggedCropId && sortBedRows) {
      flatResources = [...flatResources].sort(compareBeds);
    }

    return flatResources.map((r, i) => ({ resource: r, groupName: null, groupIndex: 0, resourceIndex: i }));
  }, [resources, groups, collapsedGroups, matchingResources, sortField, compareBeds, draggedCropId, sortBedRows]);

  // Render a crop box
  const renderCropBox = (crop: TimelineCrop, stackRow: number = 0) => {
    const pos = getTimelinePosition(crop.startDate, crop.endDate);
    const colors = crop.bgColor
      ? { bg: crop.bgColor, text: crop.textColor || '#fff' }
      : getColorForCategory(crop.category);

    const topPos = viewMode === 'stacked'
      ? CROP_TOP_PADDING + stackRow * (CROP_HEIGHT + CROP_SPACING)
      : 8;

    // Preview ghost - simplified rendering with dashed border
    if (crop.isPreview) {
      return (
        <div
          key={crop.id}
          className="absolute rounded border-2 border-dashed pointer-events-none"
          style={{
            zIndex: Z_INDEX.TIMELINE_DRAG_PREVIEW,
            left: 0,
            top: 0,
            transform: `translate3d(${Math.round(pos.left)}px, ${Math.round(topPos)}px, 0)`,
            width: Math.round(pos.width),
            height: CROP_HEIGHT,
            borderColor: colors.bg,
            backgroundColor: `${colors.bg}40`, // 25% opacity
          }}
        >
          <div className="px-2 py-1 flex items-center h-full">
            <span
              className="text-xs font-semibold truncate"
              style={{ color: colors.bg }}
            >
              {crop.name}
            </span>
          </div>
        </div>
      );
    }

    const isOverlapping = viewMode === 'overlap' && overlappingIds.has(crop.id);
    const isMultiBed = crop.totalBeds > 1;
    const isFirstBed = crop.bedIndex === 1;
    const isDragging = draggedCropId === crop.id;
    // Highlight all beds in the group being dragged
    const isGroupBeingDragged = draggedGroupId === crop.groupId && draggedGroupId !== null;
    const isSelected = selectedPlantingIds.has(crop.groupId);
    // All beds are draggable - dragging a secondary bed acts like dragging the first bed

    // Check if this is a partial bed (doesn't use full capacity)
    const isPartialBed = crop.feetUsed !== undefined &&
                         crop.bedCapacityFt !== undefined &&
                         crop.feetUsed < crop.bedCapacityFt;

    // Build tooltip
    let tooltip = `${crop.name}\n${formatDate(crop.startDate)} - ${formatDate(crop.endDate)}`;
    if (isMultiBed) {
      tooltip += `\nBed ${crop.bedIndex} of ${crop.totalBeds}`;
    }
    if (isPartialBed) {
      tooltip += `\n${crop.feetUsed}' of ${crop.bedCapacityFt}' used`;
    }
    if (crop.plantingMethod) {
      const methodNames: Record<string, string> = {
        'direct-seed': 'Direct Seed', 'transplant': 'Transplant', 'perennial': 'Perennial'
      };
      tooltip += `\n${methodNames[crop.plantingMethod] || crop.plantingMethod}`;
    }
    if (crop.sequenceId !== undefined && crop.sequenceSlot !== undefined) {
      tooltip += `\nSequence #${crop.sequenceSlot + 1}`;
    }

    return (
      <React.Fragment key={crop.id}>
        {/* Animated gradient border for selected items - rendered as sibling to avoid overflow clip */}
        {isSelected && (
          <div
            className="absolute rounded-md animate-border cursor-pointer"
            onClick={(e) => handleCropClick(e, crop)}
            style={{
              left: 0,
              top: 0,
              transform: `translate3d(${Math.round(pos.left) - 3}px, ${Math.round(topPos) - 3}px, 0)`,
              width: Math.round(pos.width) + 6,
              height: CROP_HEIGHT + 6,
              zIndex: Z_INDEX.TIMELINE_CROP_SELECTED,
              background: `conic-gradient(from var(--border-angle), #f59e0b, #ef4444, #ec4899, #8b5cf6, #3b82f6, #10b981, #f59e0b)`,
            }}
          />
        )}

        {/* Actual crop box */}
        <div
          draggable={!crop.isLocked}
          onDragStart={(e) => handleDragStart(e, crop)}
          onDragEnd={handleDragEnd}
          onClick={(e) => handleCropClick(e, crop)}
          className={`absolute rounded select-none overflow-hidden ${
            crop.isLocked ? 'cursor-not-allowed' : 'cursor-grab'
          } ${isDragging ? 'opacity-50 cursor-grabbing' : ''
          } ${isGroupBeingDragged && !isDragging ? 'opacity-60 ring-2 ring-blue-400' : ''
          } ${isOverlapping ? 'bg-transparent border-2' : ''
          }`}
          style={{
            zIndex: isSelected ? Z_INDEX.TIMELINE_CROP_SELECTED : Z_INDEX.TIMELINE_CROP,
            // Base position at origin, then transform for GPU-accelerated movement
            // Round to integers to prevent fuzzy text from subpixel rendering
            left: 0,
            top: 0,
            transform: `translate3d(${Math.round(pos.left)}px, ${Math.round(topPos)}px, 0)`,
            width: Math.round(pos.width),
            height: CROP_HEIGHT,
            boxShadow: isOverlapping ? 'none' : '0 2px 4px rgba(0,0,0,0.2)',
            backgroundColor: isOverlapping ? 'transparent' : colors.bg,
            borderColor: colors.bg,
            color: isOverlapping ? '#333' : colors.text,
            // Add left border accent for secondary beds to show they're linked
            borderLeftWidth: isMultiBed && !isFirstBed ? 3 : undefined,
            borderLeftColor: isMultiBed && !isFirstBed ? `${colors.text}60` : undefined,
            borderLeftStyle: isMultiBed && !isFirstBed ? 'dashed' : undefined,
          }}
          title={tooltip}
        >
          {/* Harvest window indicator - diagonal stripes overlay on harvest period */}
          {crop.harvestStartDate && (() => {
            const totalMs = parseDate(crop.endDate).getTime() - parseDate(crop.startDate).getTime();
            const harvestStartMs = parseDate(crop.harvestStartDate).getTime() - parseDate(crop.startDate).getTime();
            if (totalMs > 0 && harvestStartMs > 0 && harvestStartMs < totalMs) {
              const harvestStartPercent = (harvestStartMs / totalMs) * 100;
              return (
                <div
                  className="absolute inset-y-0 pointer-events-none"
                  style={{
                    left: `${harvestStartPercent}%`,
                    right: 0,
                    backgroundImage: `repeating-linear-gradient(
                      -45deg,
                      transparent,
                      transparent 3px,
                      rgba(255,255,255,0.3) 3px,
                      rgba(255,255,255,0.3) 6px
                    )`,
                    borderLeft: `2px solid ${colors.text}40`,
                  }}
                />
              );
            }
            return null;
          })()}
          {/* Sticky text content - shifts right as crop scrolls off left edge */}
          {(() => {
            // Calculate how much to offset the text to keep it visible
            // scrollLeft is the scroll position of the timeline container
            // pos.left is the crop's left edge position
            const minTextWidth = 60; // Minimum space needed for text

            // Only apply sticky behavior if crop extends past the left edge of viewport
            let stickyOffset = 0;
            if (scrollLeft > pos.left) {
              // Shift text right by how much the crop is scrolled off
              stickyOffset = scrollLeft - pos.left;
              // But clamp so text doesn't go past the right edge (leave room for text)
              const maxOffset = pos.width - minTextWidth;
              if (stickyOffset > maxOffset) {
                stickyOffset = Math.max(0, maxOffset);
              }
            }

            // Planting method colors - defined outside JSX for cleaner code
            const methodStyles: Record<string, { bg: string; text: string; label: string }> = {
              'direct-seed': { bg: '#854d0e', text: '#fef3c7', label: 'DS' }, // Warm brown - seeds go in soil
              'transplant': { bg: '#166534', text: '#dcfce7', label: 'TP' }, // Green - transplants
              'perennial': { bg: '#7e22ce', text: '#f3e8ff', label: 'PE' }, // Purple - perennials
            };
            const methodStyle = crop.plantingMethod ? methodStyles[crop.plantingMethod] : null;

            return (
              <div
                className="flex items-stretch absolute inset-y-0 pointer-events-none"
                style={{
                  left: stickyOffset,
                  right: 0,
                }}
              >
                {/* Planting method indicator - thin vertical strip on far left */}
                {methodStyle && (
                  <div
                    className="shrink-0 flex items-center justify-center text-[8px] font-bold"
                    style={{
                      width: 14,
                      backgroundColor: methodStyle.bg,
                      color: methodStyle.text,
                      writingMode: 'vertical-rl',
                      textOrientation: 'mixed',
                      transform: 'rotate(180deg)',
                    }}
                    title={crop.plantingMethod === 'direct-seed' ? 'Direct Seed' : crop.plantingMethod === 'transplant' ? 'Transplant' : 'Perennial'}
                  >
                    {methodStyle.label}
                  </div>
                )}
                {/* Main content area with badges */}
                <div className="flex-1 px-1 py-1 flex items-start gap-1 min-w-0">
                  {/* Fixed-width badge area for bed/feet info */}
                  <div className="flex flex-col items-start gap-0.5 shrink-0" style={{ width: 24 }}>
                    {isMultiBed && (() => {
                      // Create lighter/darker variants of the crop color for badges
                      const badgeBg = isFirstBed
                        ? adjustColor(colors.bg, -25) // Darker for first bed
                        : adjustColor(colors.bg, 35);  // Lighter for secondary beds
                      const badgeText = getContrastingText(badgeBg);
                      return (
                        <div
                          className="text-[9px] px-1 rounded font-medium"
                          style={{ backgroundColor: badgeBg, color: badgeText }}
                        >
                          {crop.bedIndex}/{crop.totalBeds}
                        </div>
                      );
                    })()}
                    {isPartialBed && (() => {
                      // Use a lighter shade of the crop color for feet badge
                      const feetBadgeBg = adjustColor(colors.bg, 45);
                      const feetBadgeText = getContrastingText(feetBadgeBg);
                      return (
                        <div
                          className="text-[9px] px-1 rounded font-medium"
                          style={{ backgroundColor: feetBadgeBg, color: feetBadgeText }}
                        >
                          {crop.feetUsed}&apos;
                        </div>
                      );
                    })()}
                    {/* Sequence indicator badge */}
                    {crop.sequenceId !== undefined && crop.sequenceSlot !== undefined && (
                      <div
                        className="text-[9px] px-1 rounded font-bold"
                        style={{
                          backgroundColor: '#7c3aed', // Purple for sequences
                          color: '#ffffff',
                        }}
                        title={`Sequence ${crop.sequenceSlot + 1}`}
                      >
                        S{crop.sequenceSlot + 1}
                      </div>
                    )}
                    {/* Lock indicator for plantings with actual dates */}
                    {crop.isLocked && (
                      <div
                        className="text-[9px] px-1 rounded"
                        style={{
                          backgroundColor: '#6b7280', // Gray
                          color: '#ffffff',
                        }}
                        title={`Locked: ${crop.actuals?.fieldDate ? 'Actual field date set' : 'Actual greenhouse date set'}`}
                      >
                        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                  {/* Main content - uses configurable templates */}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-xs truncate">
                      {resolveTemplate(
                        cropBoxDisplay?.headerTemplate ?? DEFAULT_HEADER_TEMPLATE,
                        crop as CropForDisplay,
                        { cropCatalog, products }
                      )}
                    </div>
                    <div className="text-[9px] opacity-90 truncate">
                      {resolveTemplate(
                        cropBoxDisplay?.descriptionTemplate ?? DEFAULT_DESCRIPTION_TEMPLATE,
                        crop as CropForDisplay,
                        { cropCatalog, products }
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </React.Fragment>
    );
  };

  // Unassigned crops
  const unassignedCrops = cropsByResource['Unassigned'] || [];

  // Get selected crop groups info for inspector
  const selectedCropsData = useMemo(() => {
    if (selectedPlantingIds.size === 0) return null;
    // Get crops for all selected groups (groupId = plantingId)
    const allSelected = crops.filter(c => selectedPlantingIds.has(c.groupId));
    if (allSelected.length === 0) return null;
    return allSelected;
  }, [crops, selectedPlantingIds]);

  // Click handler for crop selection with multi-select support
  const handleCropClick = useCallback((e: React.MouseEvent, crop: TimelineCrop) => {
    e.stopPropagation();

    // Cmd/Ctrl+Click toggles the crop in selection
    if (e.metaKey || e.ctrlKey) {
      togglePlanting(crop.groupId);
    } else {
      // Regular click: if already selected as only item, deselect; otherwise select only this
      if (selectedPlantingIds.size === 1 && selectedPlantingIds.has(crop.groupId)) {
        clearSelection();
      } else {
        clearSelection();
        selectPlanting(crop.groupId);
      }
    }
  }, [selectedPlantingIds, togglePlanting, clearSelection, selectPlanting]);

  // Click handler for timeline cells - deselects when clicking empty space
  // Crops call stopPropagation(), decorations have pointer-events: none
  const handleTimelineCellClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // Calculate duration in days
  const getDuration = (start: string, end: string) => {
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  // Handle hover changes from AddToBedPanel for preview
  const handleHoverChange = useCallback((config: CropConfig | null, fieldStartDate: string | null) => {
    if (config && fieldStartDate) {
      setHoverPreview({ config, fieldStartDate });
    } else {
      setHoverPreview(null);
    }
  }, []);

  // Compute preview crop as a proper TimelineCrop for stacking integration
  const previewCrop: TimelineCrop | null = useMemo(() => {
    if (!hoverPreview || !addToBedId) return null;

    const { config, fieldStartDate } = hoverPreview;
    const calculated = calculateCropFields(config);

    // Calculate dates
    const fieldStart = parseDate(fieldStartDate);
    const endDate = new Date(fieldStart);
    endDate.setDate(endDate.getDate() + calculated.seedToHarvest + calculated.harvestWindow - calculated.daysInCells);

    // Build display name for preview - use crop name only since we don't have products in scope
    // The actual timeline display will show product from ProductYields lookup
    const name = config.crop;

    return {
      id: '__preview__',
      name,
      startDate: fieldStartDate,
      endDate: endDate.toISOString().slice(0, 10),
      resource: addToBedId,
      category: config.category,
      totalBeds: 1,
      bedIndex: 1,
      groupId: '__preview__',
      plantingMethod: calculated.plantingMethod,
      isPreview: true,
    };
  }, [hoverPreview, addToBedId]);

  return (
    <div className="h-full flex flex-col bg-gray-100 overflow-hidden">
      {/* Controls */}
      <div className="flex items-center gap-3 p-2 bg-white border-b flex-shrink-0">
        {/* View mode toggle */}
        <div className="flex rounded overflow-hidden border border-gray-300">
          <button
            onClick={() => setViewMode('overlap')}
            className={`px-3 py-1 text-sm font-medium ${
              viewMode === 'overlap'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Overlap
          </button>
          <button
            onClick={() => setViewMode('stacked')}
            className={`px-3 py-1 text-sm font-medium border-l border-gray-300 ${
              viewMode === 'stacked'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Stacked
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center rounded overflow-hidden border border-gray-300">
          <button
            onClick={zoomOut}
            className="px-3 py-1 text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            −
          </button>
          <span className="px-3 py-1 text-sm font-medium min-w-[70px] text-center bg-white text-gray-700 border-x border-gray-300">
            {ZOOM_LEVELS[zoomIndex].label}
          </span>
          <button
            onClick={zoomIn}
            className="px-3 py-1 text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            +
          </button>
        </div>

        <button
          onClick={goToToday}
          className="px-3 py-1 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Today
        </button>

        {/* Timing edit toggle */}
        <button
          onClick={() => setTimingEditEnabled(!timingEditEnabled)}
          className={`px-3 py-1 text-sm font-medium rounded border ${
            timingEditEnabled
              ? 'bg-orange-500 text-white border-orange-500 hover:bg-orange-600'
              : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
          }`}
          title="When enabled, horizontal dragging changes crop dates"
        >
          Timing Edit: {timingEditEnabled ? 'ON' : 'OFF'}
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Crop count */}
        <span className={`text-xs ${(searchQuery || showNoVarietyOnly) ? 'text-blue-600' : 'text-gray-500'}`}>
          {filteredCrops.length}/{crops.length} crops
        </span>

        {/* Search filter with autocomplete */}
        <div className="relative">
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (autocompleteSuggestions.length > 0) {
                  if (e.key === 'Tab' || e.key === 'Enter') {
                    e.preventDefault();
                    // Apply the selected suggestion
                    const suggestion = autocompleteSuggestions[autocompleteIndex];
                    if (suggestion) {
                      const words = searchQuery.split(/\s+/);
                      words[words.length - 1] = suggestion.full;
                      setSearchQuery(words.join(' ') + (suggestion.type === 'sortField' ? ':' : ' '));
                    }
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setAutocompleteIndex(i => Math.min(i + 1, autocompleteSuggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setAutocompleteIndex(i => Math.max(i - 1, 0));
                  } else if (e.key === 'Escape') {
                    searchInputRef.current?.blur();
                  }
                }
              }}
              placeholder="Filter crops..."
              className={`w-48 px-3 py-1 pr-6 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                searchQuery
                  ? 'border-blue-400 bg-blue-50 text-gray-900'
                  : 'border-gray-300 text-gray-900'
              }`}
            />
            {/* Ghost preview of autocomplete */}
            {autocompleteSuggestions.length > 0 && searchQuery && (
              <div className="absolute inset-0 pointer-events-none px-3 py-1 text-sm text-gray-400 overflow-hidden">
                <span className="invisible">{searchQuery}</span>
                <span>{autocompleteSuggestions[autocompleteIndex]?.full.slice(
                  searchQuery.split(/\s+/).pop()?.length || 0
                )}</span>
              </div>
            )}
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 z-10"
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>
          {/* Autocomplete dropdown */}
          {autocompleteSuggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded shadow-lg z-50 max-h-48 overflow-auto">
              {autocompleteSuggestions.map((suggestion, i) => (
                <button
                  key={suggestion.full}
                  className={`w-full text-left px-3 py-1.5 text-sm ${
                    i === autocompleteIndex
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  onMouseEnter={() => setAutocompleteIndex(i)}
                  onClick={() => {
                    const words = searchQuery.split(/\s+/);
                    words[words.length - 1] = suggestion.full;
                    setSearchQuery(words.join(' ') + (suggestion.type === 'sortField' ? ':' : ' '));
                    searchInputRef.current?.focus();
                  }}
                >
                  <span className="font-mono">{suggestion.display}</span>
                  {suggestion.type === 'sortField' && (
                    <span className="text-gray-400 text-xs ml-2">sort field</span>
                  )}
                  {suggestion.type === 'sortDir' && (
                    <span className="text-gray-400 text-xs ml-2">direction</span>
                  )}
                  {suggestion.type === 'filterField' && (
                    <span className="text-gray-400 text-xs ml-2">filter</span>
                  )}
                </button>
              ))}
              <div className="px-3 py-1 text-xs text-gray-400 border-t">
                Tab to complete · ↑↓ to navigate
              </div>
            </div>
          )}
        </div>

        {/* Search help button */}
        <button
          onClick={() => setShowSearchHelp(true)}
          className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
          title="Search help"
        >
          ?
        </button>

        {/* Crop box display settings */}
        <button
          onClick={() => setShowDisplayEditor(true)}
          className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-300 rounded hover:bg-gray-100"
          title="Configure crop box display"
        >
          Display
        </button>

        {/* Show all beds toggle */}
        <button
          onClick={() => setShowAllBeds(!showAllBeds)}
          className={`px-2 py-1 text-xs font-medium rounded border ${
            showAllBeds
              ? 'bg-blue-500 text-white border-blue-500 hover:bg-blue-600'
              : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'
          }`}
          title={showAllBeds ? 'Only show beds with matching crops' : 'Show all beds (for dragging crops to assign)'}
        >
          All beds
        </button>

        {/* Sort bed rows toggle - only show when sort is active */}
        {sortField && (
          <button
            onClick={() => setSortBedRows(!sortBedRows)}
            className={`px-2 py-1 text-xs font-medium rounded border ${
              sortBedRows
                ? 'bg-blue-500 text-white border-blue-500 hover:bg-blue-600'
                : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'
            }`}
            title={sortBedRows ? 'Stop sorting bed rows (only sort crops within beds)' : 'Sort bed rows by aggregate values'}
          >
            Sort beds
          </button>
        )}

        {/* No Variety filter button */}
        {noVarietyCount > 0 && (
          <button
            onClick={() => setShowNoVarietyOnly(!showNoVarietyOnly)}
            className={`px-2 py-1 text-xs font-medium rounded border flex items-center gap-1 ${
              showNoVarietyOnly
                ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
                : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
            }`}
            title={showNoVarietyOnly ? 'Show all plantings' : 'Show only plantings without variety'}
          >
            <span className="text-amber-500">⚠</span>
            {noVarietyCount} no variety
          </button>
        )}

      </div>

      {/* Main timeline area - single scrollable container */}
      {/* Main content area with timeline + panels */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-auto bg-white border rounded-b" ref={plannerScrollRef}>
        {/* Header indicator during drag - shows original position */}
        {dragPreview && (
          <div
            className="rounded border-2 border-dashed border-gray-400 pointer-events-none"
            style={{
              position: 'sticky',
              top: (HEADER_HEIGHT - CROP_HEIGHT) / 2,
              zIndex: Z_INDEX.TIMELINE_HEADER + 2,
              marginLeft: LANE_LABEL_WIDTH + dragPreview.originalLeft,
              width: Math.round(dragPreview.originalWidth),
              height: CROP_HEIGHT,
              marginBottom: -CROP_HEIGHT,
            }}
          />
        )}
        {/* Using HTML table for reliable dual-axis sticky positioning */}
        <table style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              {/* Corner cell - sticky both directions */}
              <th
                className="px-3 text-xs font-medium text-gray-600 border-r border-b text-left"
                style={{
                  position: 'sticky',
                  top: 0,
                  left: 0,
                  zIndex: Z_INDEX.TIMELINE_HEADER + 1, // Corner cell above header
                  backgroundColor: '#f9fafb',
                  width: LANE_LABEL_WIDTH,
                  minWidth: LANE_LABEL_WIDTH,
                  height: HEADER_HEIGHT,
                }}
              >
                Resource
              </th>
              {/* Month header cells - each sticky to top */}
              {monthHeaders.map((h, i) => (
                <th
                  key={i}
                  className="text-center text-[10px] text-gray-600 border-r border-b border-gray-200 font-normal"
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: Z_INDEX.TIMELINE_HEADER,
                    backgroundColor: '#f9fafb',
                    width: h.width,
                    minWidth: h.width,
                    height: HEADER_HEIGHT,
                  }}
                >
                  <div className="font-bold">{h.month}</div>
                  <div>{h.year}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Unassigned row - sticky below header, always visible as drop target */}
            {(() => {
              const unassignedStacking = calculateStacking(unassignedCrops);
              // Use user-set height with a minimum, allowing overflow scroll when content exceeds
              const effectiveHeight = Math.max(unassignedHeight, 80);
              const isDragOverUnassigned = dragOverResource === 'Unassigned';
              const bgColor = unassignedCrops.length > 0 ? '#fffbeb' : '#f9fafb';
              // Use the constant header height for consistent positioning

              return (
                <tr key="Unassigned">
                  {/* Sticky unassigned label - sticks below header */}
                  <td
                    className="px-2 text-sm font-medium border-r align-top"
                    style={{
                      position: 'sticky',
                      top: HEADER_HEIGHT,
                      left: 0,
                      zIndex: Z_INDEX.TIMELINE_UNASSIGNED_LABEL,
                      backgroundColor: unassignedCrops.length > 0 ? '#fef3c7' : '#e5e7eb',
                      height: effectiveHeight,
                      borderBottom: 'none',
                    }}
                  >
                    <div className="flex flex-col pt-2">
                      <span className={`font-bold ${unassignedCrops.length > 0 ? 'text-amber-800' : 'text-gray-700'}`}>
                        Unassigned
                      </span>
                      <span className={`text-xs ${unassignedCrops.length > 0 ? 'text-amber-600' : 'text-gray-600'}`}>
                        {unassignedCrops.length > 0 ? `${unassignedCrops.length} crops` : 'Drop here to unassign'}
                      </span>
                    </div>
                  </td>
                  {/* Unassigned timeline lane - also sticky */}
                  <td
                    colSpan={monthHeaders.length}
                    className={`relative p-0 transition-all duration-150`}
                    style={{
                      position: 'sticky',
                      top: HEADER_HEIGHT,
                      zIndex: Z_INDEX.TIMELINE_UNASSIGNED_LANE,
                      height: effectiveHeight,
                      overflowY: 'auto',
                      backgroundColor: isDragOverUnassigned ? '#fef3c7' : bgColor,
                      boxShadow: isDragOverUnassigned ? 'inset 0 0 0 3px #f59e0b' : undefined,
                      borderBottom: 'none',
                    }}
                    onDragOver={(e) => handleDragOver(e, 'Unassigned')}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, 'Unassigned')}
                    onClick={handleTimelineCellClick}
                  >
                    {/* Today line */}
                    {todayPosition !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                        style={{
                          left: todayPosition,
                          zIndex: Z_INDEX.BASE + 5,
                          pointerEvents: 'none', // Make click-through for deselection
                        }}
                      />
                    )}
                    {/* Unassigned crop boxes */}
                    {unassignedCrops.map(crop => renderCropBox(crop, unassignedStacking.rows[crop.id] || 0))}
                  </td>
                </tr>
              );
            })()}
            {/* Resize handle row for Unassigned section */}
            <tr>
              <td
                colSpan={monthHeaders.length + 1}
                className="p-0 select-none"
                style={{
                  position: 'sticky',
                  top: HEADER_HEIGHT + unassignedHeight, // Header + unassigned height
                  zIndex: Z_INDEX.TIMELINE_RESIZE_HANDLE,
                  height: 8,
                  backgroundColor: '#9ca3af',
                  cursor: 'ns-resize',
                }}
                onMouseDown={handleResizeStart}
              >
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-12 h-1 bg-gray-500 rounded" />
                </div>
              </td>
            </tr>
            {resourcesForRendering.map(({ resource, groupName, groupIndex }) => {
              if (resource.startsWith('__collapsed__')) {
                const collapsedGroupName = resource.replace('__collapsed__', '');
                const group = groups?.find(g => g.name === collapsedGroupName);
                return (
                  <tr key={resource}>
                    {/* Sticky collapsed label */}
                    <td
                      className="px-2 py-1 text-xs text-gray-600 italic border-b border-r cursor-pointer hover:bg-gray-200"
                      style={{
                        position: 'sticky',
                        left: 0,
                        zIndex: Z_INDEX.TIMELINE_STICKY_LABEL,
                        backgroundColor: '#e5e7eb',
                        height: 28,
                      }}
                      onClick={() => toggleGroup(collapsedGroupName)}
                    >
                      <span className="mr-1 transform rotate-90 inline-block">▲</span>
                      {collapsedGroupName} ({group?.beds.length || 0} beds)
                    </td>
                    {/* Empty timeline cells */}
                    {monthHeaders.map((_, i) => (
                      <td
                        key={i}
                        className="border-b"
                        style={{ height: 28, backgroundColor: '#e5e7eb' }}
                      />
                    ))}
                  </tr>
                );
              }

              // Include preview crop in lane if it matches this resource
              const baseLaneCrops = cropsByResource[resource] || [];
              const laneCrops = previewCrop && previewCrop.resource === resource
                ? [...baseLaneCrops, previewCrop]
                : baseLaneCrops;
              const stacking = calculateStacking(laneCrops);
              const laneHeight = viewMode === 'stacked' && laneCrops.length > 0
                ? CROP_TOP_PADDING * 2 + stacking.maxRow * CROP_HEIGHT + (stacking.maxRow - 1) * CROP_SPACING
                : 50;
              const isEvenGroup = groupIndex % 2 === 1;
              const isDragOver = dragOverResource === resource;
              const bgColor = isEvenGroup ? '#eff6ff' : '#f9fafb';

              return (
                <tr key={resource}>
                  {/* Sticky lane label */}
                  <td
                    className="px-2 text-sm font-medium border-b border-r align-middle"
                    style={{
                      position: 'sticky',
                      left: 0,
                      zIndex: Z_INDEX.TIMELINE_STICKY_LABEL,
                      backgroundColor: bgColor,
                      height: laneHeight,
                    }}
                  >
                    <div className="flex items-center">
                      {groupName && (
                        <span
                          className="text-xs text-gray-600 mr-1 cursor-pointer hover:text-gray-800 shrink-0"
                          onClick={() => toggleGroup(groupName)}
                        >
                          <span className="mr-1">▲</span>
                          {groupName}:
                        </span>
                      )}
                      <span className="truncate text-gray-900">{resource}</span>
                      <span className="text-xs text-gray-600 ml-1">({bedLengths[resource] ?? 50}&apos;)</span>
                      {/* Add planting button */}
                      {onAddPlanting && cropCatalog && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddToBedId(resource);
                            clearSelection(); // Clear selection to hide inspector
                          }}
                          className="ml-auto p-1 text-gray-300 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                          title={`Add planting to ${resource}`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                  {/* Timeline lane - spans all month columns */}
                  <td
                    colSpan={monthHeaders.length}
                    className={`relative border-b border-gray-100 p-0 transition-all duration-150`}
                    style={{
                      height: laneHeight,
                      backgroundColor: isDragOver ? '#dbeafe' : (isEvenGroup ? 'rgba(239,246,255,0.3)' : undefined),
                      boxShadow: isDragOver ? 'inset 0 0 0 3px #3b82f6' : undefined,
                    }}
                    onDragOver={(e) => handleDragOver(e, resource)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, resource)}
                    onClick={handleTimelineCellClick}
                  >
                    {/* Over-capacity warning backgrounds */}
                    {overCapacityRanges[resource]?.map((range, idx) => {
                      const startStr = range.start.toISOString().split('T')[0];
                      const endStr = range.end.toISOString().split('T')[0];
                      const pos = getTimelinePosition(startStr, endStr);
                      if (!pos) return null;
                      return (
                        <div
                          key={`overcap-${idx}`}
                          className="absolute top-0 bottom-0"
                          style={{
                            left: pos.left,
                            width: pos.width,
                            backgroundColor: 'rgba(251, 191, 36, 0.3)', // amber-400 with opacity
                            zIndex: Z_INDEX.BASE,
                            pointerEvents: 'none',
                          }}
                          title={`Over capacity: ${startStr} to ${endStr}`}
                        />
                      );
                    })}
                    {/* Today line */}
                    {todayPosition !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                        style={{
                          left: todayPosition,
                          zIndex: Z_INDEX.BASE + 5,
                          pointerEvents: 'none', // Make click-through for deselection
                        }}
                      />
                    )}
                    {/* Crop boxes (includes preview ghost if present) */}
                    {laneCrops.map(crop => renderCropBox(crop, stacking.rows[crop.id] || 0))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Right Panel - AddToBed or Inspector */}
      {addToBedId && cropCatalog && onAddPlanting ? (
        <div ref={addToBedPanelRef}>
          <AddToBedPanel
            bedId={addToBedId}
            cropCatalog={cropCatalog}
            planYear={planYear || new Date().getFullYear()}
            onAddPlanting={async (configId, fieldStartDate, bedId) => {
              const result = await onAddPlanting(configId, fieldStartDate, bedId);
              setAddToBedId(null);
              setHoverPreview(null);
              // If the callback returns a groupId (plantingId), select it to show inspector
              if (result) {
                clearSelection();
                selectPlanting(result);
              }
            }}
            onClose={() => {
              setAddToBedId(null);
              setHoverPreview(null);
            }}
            onHoverChange={handleHoverChange}
          />
        </div>
      ) : selectedCropsData && selectedCropsData.length > 0 ? (
        <PlantingInspectorPanel
          selectedCrops={selectedCropsData as import('@/lib/plan-types').TimelineCrop[]}
          onDeselect={(groupId) => {
            // groupId is actually a plantingId in the context of TimelineCrop
            togglePlanting(groupId);
          }}
          onClearSelection={() => clearSelection()}
          onUpdatePlanting={onUpdatePlanting}
          onCropDateChange={onCropDateChange}
          onDeleteCrop={onDeleteCrop}
          onDuplicateCrop={async (groupId) => {
            if (onDuplicateCrop) {
              const newId = await onDuplicateCrop(groupId);
              if (newId) {
                clearSelection();
                selectPlanting(newId);
              }
              return newId;
            }
          }}
          onCreateSequence={onCreateSequence}
          onEditSequence={onEditSequence}
          onUnlinkFromSequence={onUnlinkFromSequence}
          onEditCropConfig={onEditCropConfig}
          cropCatalog={cropCatalog}
          varieties={varieties}
          seedMixes={seedMixes}
          usedVarietyIds={usedVarietyIds}
          usedMixIds={usedMixIds}
          bedLengths={bedLengths}
          products={products}
          showTimingEdits={true}
          className="w-80 bg-white border-l flex flex-col shrink-0 h-full overflow-hidden"
        />
      ) : null}
      </div>

      {/* Search Help Modal */}
      {showSearchHelp && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setShowSearchHelp(false)}
          />

          {/* Modal */}
          <div
            className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4"
            onKeyDown={(e) => e.key === 'Escape' && setShowSearchHelp(false)}
            tabIndex={-1}
            ref={(el) => el?.focus()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Search Help</h2>
              <button
                onClick={() => setShowSearchHelp(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
              >
                &times;
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-4 space-y-4">
              <div>
                <h3 className="font-medium text-gray-900 mb-2">Multi-term Search</h3>
                <p className="text-sm text-gray-600 mb-2">
                  Separate words with spaces. All terms must match (AND logic).
                </p>
                <div className="bg-gray-50 rounded p-3 space-y-2 text-sm">
                  <div><code className="bg-gray-200 px-1 rounded">tom cherry</code> → tomatoes with &quot;cherry&quot; in name</div>
                  <div><code className="bg-gray-200 px-1 rounded">lettuce direct</code> → lettuce that is direct-seeded</div>
                </div>
              </div>

              <div>
                <h3 className="font-medium text-gray-900 mb-2">Field-specific Search</h3>
                <p className="text-sm text-gray-600 mb-2">
                  Use <code className="bg-gray-200 px-1 rounded">field:value</code> to search specific fields.
                </p>
                <div className="bg-gray-50 rounded p-3 space-y-2 text-sm">
                  <div><code className="bg-gray-200 px-1 rounded">bed:A1</code> → crops in bed A1</div>
                  <div><code className="bg-gray-200 px-1 rounded">group:H</code> → crops in bed group H (H1, H2, etc.)</div>
                  <div><code className="bg-gray-200 px-1 rounded">category:greens</code> → crops in Greens category</div>
                  <div><code className="bg-gray-200 px-1 rounded">method:direct</code> → direct-seeded crops</div>
                  <div><code className="bg-gray-200 px-1 rounded">cab group:A</code> → cabbage in bed group A</div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Fields: bed, group (or bedGroup), category, method, crop, notes
                </p>
              </div>

              <div>
                <h3 className="font-medium text-gray-900 mb-2">Sorting</h3>
                <p className="text-sm text-gray-600 mb-2">
                  Use <code className="bg-gray-200 px-1 rounded">s:field</code> or <code className="bg-gray-200 px-1 rounded">s:field:desc</code> to sort. Sorts both bed rows (by aggregate) and crops within beds.
                </p>
                <div className="bg-gray-50 rounded p-3 space-y-2 text-sm">
                  <div><code className="bg-gray-200 px-1 rounded">s:revenue:desc</code> → highest revenue beds first</div>
                  <div><code className="bg-gray-200 px-1 rounded">s:date</code> → beds with earliest crops first</div>
                  <div><code className="bg-gray-200 px-1 rounded">greens s:revenue:desc</code> → greens beds by revenue</div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Fields: revenue, date, end, name, bed, category, feet, count
                </p>
              </div>

              <div>
                <h3 className="font-medium text-gray-900 mb-2">Tips</h3>
                <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
                  <li>Use <strong>All beds</strong> toggle to show empty beds when assigning</li>
                  <li>Partial matches work: <code className="bg-gray-200 px-1 rounded">cabb</code> matches &quot;Cabbage&quot;</li>
                  <li>Search is case-insensitive</li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t bg-gray-50 flex justify-end rounded-b-lg">
              <button
                onClick={() => setShowSearchHelp(false)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Crop Box Display Editor */}
      <CropBoxDisplayEditor
        isOpen={showDisplayEditor}
        onClose={() => setShowDisplayEditor(false)}
        config={cropBoxDisplay}
        onSave={(config) => onUpdateCropBoxDisplay?.(config)}
        sampleCrops={crops.slice(0, 20)}
        cropCatalog={cropCatalog}
        products={products}
      />
    </div>
  );
}
