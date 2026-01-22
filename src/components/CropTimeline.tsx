'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { addMonths, subMonths, startOfMonth, endOfMonth, startOfYear, endOfYear, parseISO } from 'date-fns';
import type { CropConfig } from '@/lib/entities/crop-config';
import { calculateCropFields } from '@/lib/entities/crop-config';
import { Z_INDEX } from '@/lib/z-index';
import { useUIStore } from '@/lib/ui-store';
import AddToBedPanel from './AddToBedPanel';
import { PlantingInspectorPanel } from './PlantingInspectorPanel';

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
  /** Initial state for no-variety filter (set via URL param) */
  initialNoVarietyFilter?: boolean;
  /** Callback when user wants to create a sequence from a planting */
  onCreateSequence?: (plantingId: string, cropName: string, fieldStartDate: string) => void;
  /** Callback when user wants to unlink a planting from its sequence */
  onUnlinkFromSequence?: (plantingId: string) => void;
  /** Callback when user wants to edit a sequence's properties */
  onEditSequence?: (sequenceId: string) => void;
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
  onDuplicateCrop,
  onDeleteCrop,
  onEditCropConfig,
  cropCatalog,
  planYear,
  onAddPlanting,
  onUpdatePlanting,
  varieties,
  seedMixes,
  initialNoVarietyFilter,
  onCreateSequence,
  onUnlinkFromSequence,
  onEditSequence,
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
  const dragDeltaRef = useRef<{
    deltaX: number;
    deltaDays: number;
    targetResource: string | null;
    laneOffsetY: number;
    // Cursor position for fixed ghost positioning
    cursorX: number;
    cursorY: number;
    // Target lane bounding rect (for positioning ghost relative to lane)
    laneRect: DOMRect | null;
  }>({ deltaX: 0, deltaDays: 0, targetResource: null, laneOffsetY: 0, cursorX: 0, cursorY: 0, laneRect: null });


  // Linked crop info for drag preview (multi-bed and sequence members)
  interface LinkedCropPreview {
    id: string;
    groupId: string;
    resource: string;
    startDate: string;
    endDate: string;
    cropName: string;
    category?: string;
    bgColor?: string;
    textColor?: string;
    feetNeeded: number;
    bedIndex: number;
    totalBeds: number;
    sequenceId?: string;
    sequenceSlot?: number;
    // Offset from the dragged crop (in days) - for sequence members
    dayOffset: number;
    // Offset from the dragged crop (in beds) - for multi-bed
    bedOffset: number;
  }

  // For drag preview - track position during drag
  const [dragPreview, setDragPreview] = useState<{
    groupId: string;
    deltaX: number;
    deltaDays: number;
    targetResource: string | null;
    // Original position for vertical move preview
    originalLeft: number;
    originalWidth: number;
    originalResource: string;
    cropName: string;
    feetNeeded: number;
    // Crop styling info
    category?: string;
    bgColor?: string;
    textColor?: string;
    startDate: string;
    endDate: string;
    // Calculated span info for target resource
    targetSpanBeds?: string[];
    targetBedSpanInfo?: BedSpanInfoLocal[];
    targetIsComplete?: boolean;
    targetFeetNeeded?: number;
    targetFeetAvailable?: number;
    // Y position within the lane for ghost placement
    laneOffsetY?: number;
    // All linked crops (multi-bed + sequence members) for ghost preview
    linkedCrops: LinkedCropPreview[];
  } | null>(null);

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

  // Filter crops by search query and no-variety filter
  const filteredCrops = useMemo(() => {
    let result = crops;

    // Apply no-variety filter first
    if (showNoVarietyOnly) {
      result = result.filter(crop => !crop.seedSource);
    }

    // Then apply search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(crop =>
        crop.name.toLowerCase().includes(query) ||
        crop.category?.toLowerCase().includes(query) ||
        crop.cropConfigId?.toLowerCase().includes(query) ||
        crop.resource?.toLowerCase().includes(query)
      );
    }

    return result;
  }, [crops, searchQuery, showNoVarietyOnly]);

  // During drag: move all linked crops (groupings + sequences) to preview positions
  const effectiveCrops = useMemo(() => {
    if (!dragPreview?.targetResource) return filteredCrops;

    const { targetResource, deltaDays, groupId, linkedCrops } = dragPreview;

    // Build set of all linked crop IDs for fast lookup
    const linkedCropIds = new Set(linkedCrops.map(c => c.id));

    // Inline date offset (can't use offsetDate callback - defined later)
    const applyOffset = (dateStr: string, days: number): string => {
      if (days === 0) return dateStr;
      const d = parseISO(dateStr);
      d.setDate(d.getDate() + days);
      return d.toISOString().split('T')[0];
    };

    return filteredCrops.map(crop => {
      // Not a linked crop - keep as-is
      if (!linkedCropIds.has(crop.id)) return crop;

      // Data model for dates:
      // - planned (fieldStartDate): what dragging changes
      // - actual (actuals.fieldDate): immutable during drag
      // - realized = actual ?? planned: determines visual position
      //
      // During drag, delta applies to ALL linked crops' planned dates.
      // Visual position is the realized date: actual if it exists, else planned.
      //
      // Crops with actual dates: planned shifts but realized (visual) stays put
      // Crops without actual dates: planned shifts so realized shifts too

      // The timeline already computes startDate/endDate using actual dates when present.
      // So for crops WITH actuals, the current startDate/endDate are already pinned.
      // We only shift crops WITHOUT actual field dates.
      // Check for non-empty string (empty string is falsy but means "cleared")
      const hasActualFieldDate = crop.actuals?.fieldDate && crop.actuals.fieldDate.length > 0;
      const hasActualGreenhouseDate = crop.actuals?.greenhouseDate && crop.actuals.greenhouseDate.length > 0;
      if (hasActualFieldDate || hasActualGreenhouseDate) {
        // realized = actual (exists), so visual position unchanged
        return crop;
      }

      // realized = planned (no actual), so shift visual position
      const updatedCrop: typeof crop = {
        ...crop,
        startDate: applyOffset(crop.startDate, deltaDays),
        endDate: applyOffset(crop.endDate, deltaDays),
        // Also shift harvestStartDate so the harvest indicator moves with the crop
        harvestStartDate: crop.harvestStartDate ? applyOffset(crop.harvestStartDate, deltaDays) : undefined,
      };

      // Only change resource for the dragged groupId (not sequence members)
      if (crop.groupId === groupId) {
        updatedCrop.resource = targetResource === 'Unassigned' ? '' : targetResource;
      }

      return updatedCrop;
    });
  }, [filteredCrops, dragPreview]);

  // Set of resources that have matching crops (for filtering rows)
  const matchingResources = useMemo(() => {
    if (!searchQuery.trim() && !showNoVarietyOnly) return null; // null means show all
    const resources = new Set<string>();
    for (const crop of effectiveCrops) {
      resources.add(crop.resource || 'Unassigned');
    }
    return resources;
  }, [effectiveCrops, searchQuery, showNoVarietyOnly]);

  // Group crops by resource (using effective crops with drag applied)
  const cropsByResource = useMemo(() => {
    const result: Record<string, TimelineCrop[]> = {};
    for (const crop of effectiveCrops) {
      const resource = crop.resource || 'Unassigned';
      if (!result[resource]) result[resource] = [];
      result[resource].push(crop);
    }
    return result;
  }, [effectiveCrops]);

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
  const calculateStacking = useCallback((laneCrops: TimelineCrop[]) => {
    if (laneCrops.length === 0) return { rows: {} as Record<string, number>, maxRow: 1 };

    const sorted = [...laneCrops].sort((a, b) =>
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
  }, []);

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

    // Collect all linked crops:
    // 1. All beds of this multi-bed planting (same groupId)
    // 2. All sequence members (same sequenceId) and their beds
    const linkedCrops: LinkedCropPreview[] = [];
    const effectiveStartDate = parseISO(effectiveCrop.startDate);
    const effectiveResourceIndex = resources.indexOf(effectiveCrop.resource);

    // Find all related groupIds (this planting + sequence members)
    const relatedGroupIds = new Set<string>([effectiveCrop.groupId]);
    if (effectiveCrop.sequenceId) {
      // Find all plantings in this sequence
      crops.forEach(c => {
        if (c.sequenceId === effectiveCrop.sequenceId) {
          relatedGroupIds.add(c.groupId);
        }
      });
    }

    // Collect all crops from related groupIds
    for (const c of crops) {
      if (relatedGroupIds.has(c.groupId)) {
        const cropStartDate = parseISO(c.startDate);
        const dayOffset = Math.round((cropStartDate.getTime() - effectiveStartDate.getTime()) / (1000 * 60 * 60 * 24));
        const resourceIndex = resources.indexOf(c.resource);
        const bedOffset = resourceIndex >= 0 && effectiveResourceIndex >= 0
          ? resourceIndex - effectiveResourceIndex
          : 0;

        linkedCrops.push({
          id: c.id,
          groupId: c.groupId,
          resource: c.resource,
          startDate: c.startDate,
          endDate: c.endDate,
          cropName: c.name,
          category: c.category,
          bgColor: c.bgColor,
          textColor: c.textColor,
          feetNeeded: c.feetNeeded || 50,
          bedIndex: c.bedIndex,
          totalBeds: c.totalBeds,
          sequenceId: c.sequenceId,
          sequenceSlot: c.sequenceSlot,
          dayOffset,
          bedOffset,
        });
      }
    }

    // Initialize drag preview with original position
    // Normalize empty resource to 'Unassigned' so it matches how handleDragOver sets targetResource
    const normalizedResource = effectiveCrop.resource || 'Unassigned';
    setDragPreview({
      groupId: effectiveCrop.groupId,
      deltaX: 0,
      deltaDays: 0,
      targetResource: normalizedResource,
      originalLeft: originalPos.left,
      originalWidth: originalPos.width,
      originalResource: normalizedResource,
      cropName: effectiveCrop.name,
      feetNeeded: effectiveCrop.feetNeeded || 50,
      category: effectiveCrop.category,
      bgColor: effectiveCrop.bgColor,
      textColor: effectiveCrop.textColor,
      startDate: effectiveCrop.startDate,
      endDate: effectiveCrop.endDate,
      linkedCrops,
    });
  };

  const handleDragEnd = () => {
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

    // Update drag-over highlight (this is fast, just a string comparison)
    if (dragOverResource !== resource) {
      setDragOverResource(resource);
    }

    // Update live drag state in ref (NO re-render)
    // Always calculate deltaX for header indicator, but only calculate deltaDays when timing edit enabled
    let deltaX = 0;
    let deltaDays = 0;
    if (dragStartX.current !== null) {
      deltaX = e.clientX - dragStartX.current;
      if (timingEditEnabled) {
        deltaDays = pixelsToDays(deltaX);
      }
    }

    // Store in ref for drop handler
    dragDeltaRef.current = {
      deltaX,
      deltaDays,
      targetResource: resource,
      laneOffsetY,
      cursorX: e.clientX,
      cursorY: e.clientY,
      laneRect: rect,
    };

    // Update dragPreview state so the ghost renders at the correct position
    // This is a local state update (not store), so it's fast
    if (dragPreview) {
      setDragPreview(prev => prev ? {
        ...prev,
        deltaX,
        deltaDays,
        targetResource: resource,
        laneOffsetY,
      } : null);
    }
  };

  const handleDragLeave = () => {
    setDragOverResource(null);
  };

  const handleDrop = (e: React.DragEvent, resource: string) => {
    e.preventDefault();
    setDragOverResource(null);

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));

      // Determine which groups to move: if dragged item is in selection, move all selected
      // Otherwise just move the dragged item
      const groupsToMove = selectedPlantingIds.has(data.groupId)
        ? Array.from(selectedPlantingIds)
        : [data.groupId];

      // Apply timing changes if enabled and there was horizontal movement
      if (timingEditEnabled && dragStartX.current !== null && dragOriginalDates.current) {
        const deltaX = e.clientX - dragStartX.current;
        const deltaDays = pixelsToDays(deltaX);

        if (deltaDays !== 0 && onCropDateChange) {
          // Apply date offset to all selected/dragged groups
          for (const groupId of groupsToMove) {
            const groupCrop = crops.find(c => c.groupId === groupId && c.bedIndex === 1);
            if (groupCrop) {
              const newStart = offsetDate(groupCrop.startDate, deltaDays);
              const newEnd = offsetDate(groupCrop.endDate, deltaDays);
              onCropDateChange(groupId, newStart, newEnd);
            }
          }
        }
      }

      // Only call onCropMove if the resource actually changed
      // (avoid double undo entry when only dates changed)
      const targetResource = resource === 'Unassigned' ? '' : resource;
      const resourceChanged = data.originalResource !== targetResource;
      if (data.cropId && onCropMove && resourceChanged) {
        // For multi-select moves, move each selected item
        // Note: currently onCropMove only handles one at a time
        // For now, just move the dragged one (multi-move is complex with bed spans)
        onCropMove(
          data.cropId,
          targetResource,
          data.groupId,
          data.feetNeeded
        );
      }
    } catch {
      // Fallback for simple drag data
      const cropId = e.dataTransfer.getData('text/plain');
      if (cropId && onCropMove) {
        onCropMove(cropId, resource === 'Unassigned' ? '' : resource);
      }
    }

    // Clear drag state (handleDragEnd may not fire reliably after drop)
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

  // Build resources list for rendering (filtered by search when active)
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
          for (const bed of group.beds) {
            if (bed !== 'Unassigned') {
              // When filtering, only show beds with matching crops
              if (matchingResources && !matchingResources.has(bed)) {
                continue;
              }
              result.push({ resource: bed, groupName: group.name, groupIndex, resourceIndex });
              resourceIndex++;
            }
          }
        }
        groupIndex++;
      }

      return result;
    }

    return resources
      .filter(r => r !== 'Unassigned')
      .filter(r => !matchingResources || matchingResources.has(r))
      .map((r, i) => ({ resource: r, groupName: null, groupIndex: 0, resourceIndex: i }));
  }, [resources, groups, collapsedGroups, matchingResources]);

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
                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-xs truncate">{crop.name}</div>
                    <div className="text-[9px] opacity-90">
                      {formatDate(crop.startDate)} - {formatDate(crop.endDate)}
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

        {/* Search filter */}
        <div className="relative">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter crops..."
            className={`w-48 px-3 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              searchQuery
                ? 'border-blue-400 bg-blue-50 text-gray-900'
                : 'border-gray-300 text-gray-900'
            }`}
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {/* Filter status */}
        {(searchQuery || showNoVarietyOnly) && (
          <span className="text-xs text-blue-600">
            {filteredCrops.length} of {crops.length} crops
          </span>
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
        {/* Header indicators during drag */}
        {dragPreview && (
          <>
            {/* Original time bounds - dashed gray outline */}
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
            {/* Preview time bounds - dashed outline, green if later, red if earlier */}
            {Math.abs(dragPreview.deltaX) >= 1 && (() => {
              const deltaDays = pixelsToDays(dragPreview.deltaX);
              const isLater = dragPreview.deltaX > 0;
              return (
                <div
                  className={`rounded border-2 border-dashed pointer-events-none ${
                    isLater ? 'border-green-500' : 'border-red-500'
                  }`}
                  style={{
                    position: 'sticky',
                    top: (HEADER_HEIGHT - CROP_HEIGHT) / 2,
                    zIndex: Z_INDEX.TIMELINE_HEADER + 2,
                    marginLeft: LANE_LABEL_WIDTH + dragPreview.originalLeft + dragPreview.deltaX,
                    width: Math.round(dragPreview.originalWidth),
                    height: CROP_HEIGHT,
                    marginBottom: -CROP_HEIGHT,
                  }}
                >
                  {/* Delta days badges - circles on left and right walls */}
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 -left-3 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                      isLater ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  >
                    {deltaDays}
                  </div>
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 -right-3 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                      isLater ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  >
                    {deltaDays}
                  </div>
                </div>
              );
            })()}
          </>
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
                  >
                    {/* Today line */}
                    {todayPosition !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                        style={{ left: todayPosition, zIndex: Z_INDEX.BASE + 5 }}
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
                  >
                    {/* Today line */}
                    {todayPosition !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                        style={{ left: todayPosition, zIndex: Z_INDEX.BASE + 5 }}
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
          showTimingEdits={true}
          className="w-80 bg-white border-l flex flex-col shrink-0 h-full overflow-hidden"
        />
      ) : null}
      </div>
    </div>
  );
}
