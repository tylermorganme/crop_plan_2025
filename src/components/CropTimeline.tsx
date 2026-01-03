'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { addMonths, subMonths, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';
import { getBedGroup, getBedNumber, getBedLengthFromId } from '@/lib/plan-types';
import type { CropConfig } from '@/lib/entities/crop-config';
import { calculateCropFields, calculateDaysInCells, calculateSTH, calculateHarvestWindow } from '@/lib/entities/crop-config';
import { resolveEffectiveTiming } from '@/lib/slim-planting';
import AddToBedPanel from './AddToBedPanel';

// =============================================================================
// Types
// =============================================================================

interface PlantingOverrides {
  additionalDaysOfHarvest?: number;
  additionalDaysInField?: number;
  additionalDaysInCells?: number;
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
  /** Crop config identifier matching crops.json */
  cropConfigId?: string;
  /** Harvest start date (ISO date) - when harvest window begins */
  harvestStartDate?: string;
  /** Planting method: DS (Direct Seed), TP (Transplant), PE (Perennial) */
  plantingMethod?: 'DS' | 'TP' | 'PE';
  /** Preview ghost - not a real crop, just for hover preview */
  isPreview?: boolean;
  /** Planting-level timing overrides (for editing in inspector) */
  overrides?: PlantingOverrides;
  /** User notes about this planting */
  notes?: string;
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
  /** Callback when user updates planting fields (bedFeet, overrides, notes) */
  onUpdatePlanting?: (plantingId: string, updates: {
    bedFeet?: number;
    overrides?: PlantingOverrides;
    notes?: string;
  }) => Promise<void>;
}

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
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function parseDate(dateStr: string): Date {
  return new Date(dateStr);
}


/** Info about each bed in a span, including how much is used */
interface BedSpanInfoLocal {
  bed: string;
  feetUsed: number;
  bedCapacityFt: number;
}

/**
 * Calculate which beds a crop would span if placed at startBed
 * Works with actual feet to handle rows with different bed sizes
 *
 * @param feetNeeded - Total feet needed for the planting
 * @param startBed - The starting bed (e.g., "J2")
 * @param groups - Resource groups containing bed lists
 */
function calculateBedSpan(
  feetNeeded: number,
  startBed: string,
  groups: ResourceGroup[] | null | undefined
): {
  spanBeds: string[];
  bedSpanInfo: BedSpanInfoLocal[];
  isComplete: boolean;
  feetNeeded: number;
  feetAvailable: number;
} {
  const bedSize = getBedLengthFromId(startBed);

  // Default to one bed if no feet specified
  if (!groups || !feetNeeded || feetNeeded <= 0) {
    return {
      spanBeds: [startBed],
      bedSpanInfo: [{ bed: startBed, feetUsed: bedSize, bedCapacityFt: bedSize }],
      isComplete: true,
      feetNeeded: bedSize,
      feetAvailable: bedSize,
    };
  }

  const row = getBedGroup(startBed);

  // Find the group containing this bed
  const group = groups.find(g => g.beds.includes(startBed));
  if (!group) {
    return {
      spanBeds: [startBed],
      bedSpanInfo: [{ bed: startBed, feetUsed: Math.min(feetNeeded, bedSize), bedCapacityFt: bedSize }],
      isComplete: feetNeeded <= bedSize,
      feetNeeded,
      feetAvailable: bedSize,
    };
  }

  // Get beds in this row, sorted numerically
  const rowBeds = group.beds
    .filter(b => getBedGroup(b) === row)
    .sort((a, b) => getBedNumber(a) - getBedNumber(b));

  // Find beds starting from startBed
  const startIndex = rowBeds.findIndex(b => b === startBed);
  if (startIndex === -1) {
    return {
      spanBeds: [startBed],
      bedSpanInfo: [{ bed: startBed, feetUsed: Math.min(feetNeeded, bedSize), bedCapacityFt: bedSize }],
      isComplete: feetNeeded <= bedSize,
      feetNeeded,
      feetAvailable: bedSize,
    };
  }

  // Collect consecutive beds until we have enough footage
  const spanBeds: string[] = [];
  const bedSpanInfo: BedSpanInfoLocal[] = [];
  let feetAvailable = 0;
  let remainingFeet = feetNeeded;

  for (let i = startIndex; i < rowBeds.length && remainingFeet > 0; i++) {
    const bed = rowBeds[i];
    const thisBedCapacity = getBedLengthFromId(bed);
    const feetUsed = Math.min(remainingFeet, thisBedCapacity);

    spanBeds.push(bed);
    bedSpanInfo.push({
      bed,
      feetUsed,
      bedCapacityFt: thisBedCapacity,
    });

    feetAvailable += thisBedCapacity;
    remainingFeet -= feetUsed;
  }

  if (spanBeds.length === 0) {
    spanBeds.push(startBed);
    bedSpanInfo.push({
      bed: startBed,
      feetUsed: Math.min(feetNeeded, bedSize),
      bedCapacityFt: bedSize,
    });
    feetAvailable = bedSize;
  }

  return {
    spanBeds,
    bedSpanInfo,
    isComplete: feetAvailable >= feetNeeded,
    feetNeeded,
    feetAvailable,
  };
}

// =============================================================================
// Component
// =============================================================================

export default function CropTimeline({
  crops,
  resources,
  groups,
  onCropMove,
  onCropDateChange,
  onDuplicateCrop,
  onDeleteCrop,
  onEditCropConfig,
  cropCatalog,
  planYear,
  onAddPlanting,
  onUpdatePlanting,
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
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  // State for "Add to Bed" panel - which bed's + button was clicked
  const [addToBedId, setAddToBedId] = useState<string | null>(null);
  const addToBedPanelRef = useRef<HTMLDivElement>(null);
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
  } | null>(null);

  // Refs
  const plannerScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
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

  // Group crops by resource
  const cropsByResource = useMemo(() => {
    const result: Record<string, TimelineCrop[]> = {};
    for (const crop of crops) {
      const resource = crop.resource || 'Unassigned';
      if (!result[resource]) result[resource] = [];
      result[resource].push(crop);
    }
    return result;
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
      const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
      const startMs = monthStart.getTime() - timelineStart.getTime();
      const endMs = Math.min(monthEnd.getTime(), timelineEnd.getTime()) - timelineStart.getTime();
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

  // Get resources that a crop group occupies
  const getGroupResources = useCallback((groupId: string) => {
    return crops.filter(c => c.groupId === groupId).map(c => c.resource);
  }, [crops]);

  // Helper to convert pixel offset to date offset
  const pixelsToDays = useCallback((pixels: number) => {
    return Math.round(pixels / pixelsPerDay);
  }, [pixelsPerDay]);

  // Helper to offset a date by days
  const offsetDate = useCallback((dateStr: string, days: number): string => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }, []);

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, crop: TimelineCrop) => {
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

    // For timing editing, track start position
    if (timingEditEnabled) {
      dragStartX.current = e.clientX;
      dragOriginalDates.current = { start: effectiveCrop.startDate, end: effectiveCrop.endDate };
    }

    // Get original crop position for preview (use first bed's resource)
    const originalPos = getTimelinePosition(effectiveCrop.startDate, effectiveCrop.endDate);

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

    // Always allow moving between beds (vertical)
    setDragOverResource(resource);
    if (dragPreview && draggedGroupId) {
      // Calculate bed span for the target resource
      let targetSpanBeds: string[] | undefined;
      let targetBedSpanInfo: BedSpanInfoLocal[] | undefined;
      let targetIsComplete: boolean | undefined;
      let targetFeetNeeded: number | undefined;
      let targetFeetAvailable: number | undefined;

      if (resource !== 'Unassigned' && resource !== '') {
        const spanInfo = calculateBedSpan(dragPreview.feetNeeded, resource, groups);
        targetSpanBeds = spanInfo.spanBeds;
        targetBedSpanInfo = spanInfo.bedSpanInfo;
        targetIsComplete = spanInfo.isComplete;
        targetFeetNeeded = spanInfo.feetNeeded;
        targetFeetAvailable = spanInfo.feetAvailable;
      }

      setDragPreview(prev => prev ? {
        ...prev,
        targetResource: resource,
        targetSpanBeds,
        targetBedSpanInfo,
        targetIsComplete,
        targetFeetNeeded,
        targetFeetAvailable,
        laneOffsetY,
      } : null);
    }

    // Also track timing offset when timing edit is enabled (horizontal)
    if (timingEditEnabled && dragStartX.current !== null && draggedGroupId) {
      const deltaX = e.clientX - dragStartX.current;
      const deltaDays = pixelsToDays(deltaX);
      setDragPreview(prev => prev ? {
        ...prev,
        deltaX,
        deltaDays,
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
      const groupsToMove = selectedGroupIds.has(data.groupId)
        ? Array.from(selectedGroupIds)
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

  // Build resources list for rendering
  const resourcesForRendering = useMemo(() => {
    if (groups && groups.length > 0) {
      const result: { resource: string; groupName: string | null; groupIndex: number; resourceIndex: number }[] = [];
      let groupIndex = 0;
      let resourceIndex = 0;

      for (const group of groups) {
        const isCollapsed = group.name && collapsedGroups.has(group.name);
        if (isCollapsed) {
          // Show collapsed placeholder
          result.push({ resource: `__collapsed__${group.name}`, groupName: group.name, groupIndex, resourceIndex });
          resourceIndex++;
        } else {
          for (const bed of group.beds) {
            if (bed !== 'Unassigned') {
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
      .map((r, i) => ({ resource: r, groupName: null, groupIndex: 0, resourceIndex: i }));
  }, [resources, groups, collapsedGroups]);

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
          className="absolute rounded border-2 border-dashed pointer-events-none z-40"
          style={{
            left: pos.left,
            width: pos.width,
            top: topPos,
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
    const isSelected = selectedGroupIds.has(crop.groupId);
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
      const methodNames = { DS: 'Direct Seed', TP: 'Transplant', PE: 'Perennial' };
      tooltip += `\n${methodNames[crop.plantingMethod] || crop.plantingMethod}`;
    }

    return (
      <React.Fragment key={crop.id}>
        {/* Animated gradient border for selected items - rendered as sibling to avoid overflow clip */}
        {isSelected && (
          <div
            className="absolute pointer-events-none rounded-md animate-border"
            style={{
              left: pos.left - 3,
              width: pos.width + 6,
              top: topPos - 3,
              height: CROP_HEIGHT + 6,
              zIndex: 20,
              background: `conic-gradient(from var(--border-angle), #f59e0b, #ef4444, #ec4899, #8b5cf6, #3b82f6, #10b981, #f59e0b)`,
            }}
          />
        )}

        {/* Actual crop box */}
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, crop)}
          onDragEnd={handleDragEnd}
          onClick={(e) => handleCropClick(e, crop)}
          className={`absolute rounded select-none overflow-hidden cursor-grab ${
            isDragging ? 'opacity-50 cursor-grabbing' : ''
          } ${isGroupBeingDragged && !isDragging ? 'opacity-60 ring-2 ring-blue-400' : ''
          } ${isSelected ? 'z-[21]' : 'hover:z-10'} ${
            isOverlapping ? 'bg-transparent border-2' : ''
          }`}
          style={{
            left: pos.left,
            width: pos.width,
            top: topPos,
            boxShadow: isOverlapping ? 'none' : '0 2px 4px rgba(0,0,0,0.2)',
            height: CROP_HEIGHT,
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
              DS: { bg: '#854d0e', text: '#fef3c7', label: 'DS' }, // Warm brown - seeds go in soil
              TP: { bg: '#166534', text: '#dcfce7', label: 'TP' }, // Green - transplants
              PE: { bg: '#7e22ce', text: '#f3e8ff', label: 'PE' }, // Purple - perennials
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
                    title={crop.plantingMethod === 'DS' ? 'Direct Seed' : crop.plantingMethod === 'TP' ? 'Transplant' : 'Perennial'}
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
    if (selectedGroupIds.size === 0) return null;
    // Get crops for all selected groups
    const allSelected = crops.filter(c => selectedGroupIds.has(c.groupId));
    if (allSelected.length === 0) return null;
    return allSelected;
  }, [crops, selectedGroupIds]);

  // Click handler for crop selection with multi-select support
  const handleCropClick = useCallback((e: React.MouseEvent, crop: TimelineCrop) => {
    e.stopPropagation();

    // Cmd/Ctrl+Click toggles the crop in selection
    if (e.metaKey || e.ctrlKey) {
      setSelectedGroupIds(prev => {
        const next = new Set(prev);
        if (next.has(crop.groupId)) {
          next.delete(crop.groupId);
        } else {
          next.add(crop.groupId);
        }
        return next;
      });
    } else {
      // Regular click: if already selected as only item, deselect; otherwise select only this
      setSelectedGroupIds(prev => {
        if (prev.size === 1 && prev.has(crop.groupId)) {
          return new Set();
        }
        return new Set([crop.groupId]);
      });
    }
  }, []);

  // Clear selection when clicking outside
  const handleBackgroundClick = useCallback(() => {
    setSelectedGroupIds(new Set());
  }, []);

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
    endDate.setDate(endDate.getDate() + calculated.sth + calculated.harvestWindow - calculated.daysInCells);

    // Build display name
    const name = config.product && config.product !== 'General'
      ? `${config.crop} (${config.product})`
      : config.crop;

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
    <div className="flex h-full bg-gray-100">
      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
      {/* Controls */}
      <div className="flex items-center gap-3 p-2 bg-white border-b">
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

      </div>

      {/* Main timeline area - single scrollable container */}
      <div className="flex-1 min-h-0 overflow-auto bg-white border rounded-b" ref={plannerScrollRef}>
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
                  zIndex: 40,
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
                    zIndex: 30,
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
                      zIndex: 25, // Above regular sticky labels but below header
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
                      zIndex: 24,
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
                    {/* Unified ghost preview for Unassigned - shows for cross-resource moves OR when timing edit enabled */}
                    {isDragOverUnassigned && dragPreview && (dragPreview.originalResource !== 'Unassigned' || timingEditEnabled) && (() => {
                      const isMovingToUnassigned = dragPreview.originalResource !== 'Unassigned' && dragPreview.originalResource !== '';

                      // Get crop colors (same logic as renderCropBox)
                      const colors = dragPreview.bgColor
                        ? { bg: dragPreview.bgColor, text: dragPreview.textColor || '#fff' }
                        : getColorForCategory(dragPreview.category);

                      // Calculate position - use adjusted dates if timing edit is enabled
                      const hasTimeOffset = timingEditEnabled && dragPreview.deltaDays !== 0;
                      const displayStartDate = hasTimeOffset
                        ? offsetDate(dragPreview.startDate, dragPreview.deltaDays)
                        : dragPreview.startDate;
                      const displayEndDate = hasTimeOffset
                        ? offsetDate(dragPreview.endDate, dragPreview.deltaDays)
                        : dragPreview.endDate;
                      const adjustedPos = hasTimeOffset
                        ? getTimelinePosition(displayStartDate, displayEndDate)
                        : { left: dragPreview.originalLeft, width: dragPreview.originalWidth };

                      // Calculate vertical position based on cursor Y position
                      let topPos = CROP_TOP_PADDING;
                      if (dragPreview.laneOffsetY !== undefined) {
                        if (viewMode === 'stacked') {
                          // Snap to nearest row slot
                          const rowHeight = CROP_HEIGHT + CROP_SPACING;
                          const row = Math.max(0, Math.floor((dragPreview.laneOffsetY - CROP_TOP_PADDING) / rowHeight));
                          topPos = CROP_TOP_PADDING + row * rowHeight;
                          // Clamp to lane bounds
                          topPos = Math.max(CROP_TOP_PADDING, Math.min(topPos, effectiveHeight - CROP_HEIGHT - CROP_TOP_PADDING));
                        } else {
                          // In overlap mode, center on cursor with some constraints
                          topPos = Math.max(CROP_TOP_PADDING, Math.min(dragPreview.laneOffsetY - CROP_HEIGHT / 2, effectiveHeight - CROP_HEIGHT - CROP_TOP_PADDING));
                        }
                      }

                      // Build label parts
                      const bedPart = isMovingToUnassigned ? '→ Unassigned' : 'Unassigned';
                      const timePart = hasTimeOffset
                        ? ` ${dragPreview.deltaDays > 0 ? '+' : ''}${dragPreview.deltaDays}d`
                        : '';

                      // Badge color: green if positive time, red if negative, crop color otherwise
                      const badgeColor = hasTimeOffset
                        ? (dragPreview.deltaDays > 0 ? '#22c55e' : '#ef4444')
                        : colors.bg;

                      return (
                        <div
                          className="absolute rounded border-2 border-dashed pointer-events-none"
                          style={{
                            left: adjustedPos.left,
                            width: adjustedPos.width,
                            top: topPos,
                            height: CROP_HEIGHT,
                            borderColor: colors.bg,
                            backgroundColor: `${colors.bg}33`,
                            zIndex: 50,
                          }}
                        >
                          {/* Badge showing destination + timing */}
                          <div
                            className="absolute -top-6 left-1/2 transform -translate-x-1/2 px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap text-white"
                            style={{ backgroundColor: badgeColor }}
                          >
                            {bedPart}{timePart}
                          </div>
                          {/* Crop name and dates */}
                          <div className="px-2 py-1 text-xs" style={{ color: colors.bg }}>
                            <div className="font-semibold truncate">{dragPreview.cropName}</div>
                            <div className="text-[10px] opacity-80">{formatDate(displayStartDate)} - {formatDate(displayEndDate)}</div>
                          </div>
                        </div>
                      );
                    })()}
                    {/* Today line */}
                    {todayPosition !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                        style={{ left: todayPosition, zIndex: 5 }}
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
                  zIndex: 23,
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
                        zIndex: 20,
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
                      zIndex: 20,
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
                      <span className="text-xs text-gray-600 ml-1">({getBedLengthFromId(resource)}&apos;)</span>
                      {/* Add planting button */}
                      {onAddPlanting && cropCatalog && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddToBedId(resource);
                            setSelectedGroupIds(new Set()); // Clear selection to hide inspector
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
                    {/* Unified ghost preview for all drags - shows target position with bed + timing info */}
                    {/* Show when: hovering over this lane OR this is the original lane and timing mode is on */}
                    {(isDragOver || (dragPreview?.originalResource === resource && timingEditEnabled)) && dragPreview && (() => {
                      const isMovingToNewResource = dragPreview.targetResource !== dragPreview.originalResource;
                      const isComplete = dragPreview.targetIsComplete !== false;
                      const spanBeds = dragPreview.targetSpanBeds || [resource];
                      const feetNeeded = dragPreview.targetFeetNeeded || 50;
                      const feetAvailable = dragPreview.targetFeetAvailable || 50;

                      // Get crop colors (same logic as renderCropBox)
                      const colors = dragPreview.bgColor
                        ? { bg: dragPreview.bgColor, text: dragPreview.textColor || '#fff' }
                        : getColorForCategory(dragPreview.category);

                      // Calculate position - use adjusted dates if timing edit is enabled
                      const hasTimeOffset = timingEditEnabled && dragPreview.deltaDays !== 0;
                      const displayStartDate = hasTimeOffset
                        ? offsetDate(dragPreview.startDate, dragPreview.deltaDays)
                        : dragPreview.startDate;
                      const displayEndDate = hasTimeOffset
                        ? offsetDate(dragPreview.endDate, dragPreview.deltaDays)
                        : dragPreview.endDate;
                      const adjustedPos = hasTimeOffset
                        ? getTimelinePosition(displayStartDate, displayEndDate)
                        : { left: dragPreview.originalLeft, width: dragPreview.originalWidth };

                      // Calculate vertical position based on cursor Y position
                      // In stacked mode, snap to row positions; in overlap mode, follow cursor more freely
                      let topPos = CROP_TOP_PADDING;
                      if (dragPreview.laneOffsetY !== undefined) {
                        if (viewMode === 'stacked') {
                          // Snap to nearest row slot
                          const rowHeight = CROP_HEIGHT + CROP_SPACING;
                          const row = Math.max(0, Math.floor((dragPreview.laneOffsetY - CROP_TOP_PADDING) / rowHeight));
                          topPos = CROP_TOP_PADDING + row * rowHeight;
                          // Clamp to lane bounds
                          topPos = Math.max(CROP_TOP_PADDING, Math.min(topPos, laneHeight - CROP_HEIGHT - CROP_TOP_PADDING));
                        } else {
                          // In overlap mode, center on cursor with some constraints
                          topPos = Math.max(CROP_TOP_PADDING, Math.min(dragPreview.laneOffsetY - CROP_HEIGHT / 2, laneHeight - CROP_HEIGHT - CROP_TOP_PADDING));
                        }
                      }

                      // Build the label parts
                      // 1. Bed destination (always show)
                      let bedPart: string;
                      if (!isComplete) {
                        bedPart = `Need ${feetNeeded}' but only ${feetAvailable}' available`;
                      } else if (isMovingToNewResource) {
                        bedPart = spanBeds.length === 1 ? `→ ${spanBeds[0]}` : `→ ${spanBeds[0]} - ${spanBeds[spanBeds.length - 1]}`;
                      } else {
                        // Same resource - just show the bed name
                        bedPart = spanBeds.length === 1 ? spanBeds[0] : `${spanBeds[0]} - ${spanBeds[spanBeds.length - 1]}`;
                      }

                      // 2. Time offset (if any)
                      const timePart = hasTimeOffset
                        ? ` ${dragPreview.deltaDays > 0 ? '+' : ''}${dragPreview.deltaDays}d`
                        : '';

                      // Check if the last bed is partial (uses less than full capacity)
                      const bedSpanInfoArr = dragPreview.targetBedSpanInfo || [];
                      const lastBed = bedSpanInfoArr[bedSpanInfoArr.length - 1];
                      const isPartialBed = lastBed && lastBed.feetUsed < lastBed.bedCapacityFt;

                      // Badge color: red if incomplete/negative time, green if positive time, crop color otherwise
                      const badgeColor = !isComplete ? '#ef4444'
                        : hasTimeOffset ? (dragPreview.deltaDays > 0 ? '#22c55e' : '#ef4444')
                        : colors.bg;

                      return (
                        <div
                          className="absolute rounded border-2 border-dashed pointer-events-none"
                          style={{
                            left: adjustedPos.left,
                            width: adjustedPos.width,
                            top: topPos,
                            height: CROP_HEIGHT,
                            borderColor: isComplete ? colors.bg : '#ef4444',
                            backgroundColor: isComplete ? `${colors.bg}33` : 'rgba(239, 68, 68, 0.2)',
                            zIndex: 50,
                          }}
                        >
                          {/* Badge showing destination bed + timing */}
                          <div
                            className="absolute -top-6 left-1/2 transform -translate-x-1/2 px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap text-white"
                            style={{ backgroundColor: badgeColor }}
                          >
                            {bedPart}{timePart}
                            {isPartialBed && ` (${lastBed.feetUsed}')`}
                          </div>
                          {/* Crop name and dates */}
                          <div className="px-2 py-1 text-xs" style={{ color: isComplete ? colors.bg : '#ef4444' }}>
                            <div className="font-semibold truncate">{dragPreview.cropName}</div>
                            <div className="text-[10px] opacity-80">{formatDate(displayStartDate)} - {formatDate(displayEndDate)}</div>
                          </div>
                        </div>
                      );
                    })()}
                    {/* Today line */}
                    {todayPosition !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                        style={{ left: todayPosition, zIndex: 5 }}
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
              // If the callback returns a groupId, select it to show inspector
              if (result) {
                setSelectedGroupIds(new Set([result]));
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
        <div className="w-80 bg-white border-l flex flex-col shrink-0">
          {/* Inspector Header */}
          <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
            <h3 className="font-semibold text-sm">
              {selectedGroupIds.size === 1 ? 'Planting Details' : `${selectedGroupIds.size} Plantings Selected`}
            </h3>
            <button
              onClick={() => setSelectedGroupIds(new Set())}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            >
              &times;
            </button>
          </div>

          {/* Inspector Content */}
          <div className="flex-1 overflow-auto p-3">
            {(() => {
              // Multi-select: show summary view
              if (selectedGroupIds.size > 1) {
                // Group crops by groupId to get unique plantings
                const uniqueGroups = new Map<string, TimelineCrop>();
                selectedCropsData.forEach(c => {
                  if (!uniqueGroups.has(c.groupId)) {
                    uniqueGroups.set(c.groupId, c);
                  }
                });
                const plantings = Array.from(uniqueGroups.values());

                return (
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="text-sm text-gray-600">
                      {plantings.length} planting{plantings.length > 1 ? 's' : ''} selected
                    </div>

                    {/* List of selected plantings */}
                    <div className="space-y-2 max-h-60 overflow-auto">
                      {plantings.map((crop) => {
                        const colors = crop.bgColor
                          ? { bg: crop.bgColor, text: crop.textColor || '#fff' }
                          : getColorForCategory(crop.category);
                        return (
                          <div
                            key={crop.groupId}
                            className="flex items-center gap-2 p-2 rounded border border-gray-100"
                          >
                            <div
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: colors.bg }}
                            />
                            <span className="text-sm text-gray-900 truncate flex-1">{crop.name}</span>
                            <button
                              onClick={() => {
                                setSelectedGroupIds(prev => {
                                  const next = new Set(prev);
                                  next.delete(crop.groupId);
                                  return next;
                                });
                              }}
                              className="text-gray-400 hover:text-gray-600 text-xs"
                              title="Remove from selection"
                            >
                              &times;
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Bulk Actions */}
                    <div className="pt-3 border-t space-y-2">
                      <div className="text-xs text-gray-600 mb-2">
                        Tip: {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Click to add/remove from selection
                      </div>
                      {onDeleteCrop && (
                        <button
                          onClick={() => {
                            onDeleteCrop(Array.from(selectedGroupIds));
                            setSelectedGroupIds(new Set());
                          }}
                          className="w-full px-3 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                        >
                          Delete {plantings.length} Planting{plantings.length > 1 ? 's' : ''}
                        </button>
                      )}
                    </div>
                  </div>
                );
              }

              // Single selection: show detailed view
              const crop = selectedCropsData[0];
              const colors = crop.bgColor
                ? { bg: crop.bgColor, text: crop.textColor || '#fff' }
                : getColorForCategory(crop.category);
              const duration = getDuration(crop.startDate, crop.endDate);
              // Get all bed entries for this single group
              const groupCrops = selectedCropsData.filter(c => c.groupId === crop.groupId);

              // Get base config for calculating effective values
              const configId = crop.cropConfigId;
              const baseConfig = configId && cropCatalog ? cropCatalog[configId] : undefined;
              const baseValues = baseConfig ? {
                dtm: calculateSTH(baseConfig, calculateDaysInCells(baseConfig)),
                harvestWindow: calculateHarvestWindow(baseConfig),
                daysInCells: calculateDaysInCells(baseConfig),
              } : null;

              // Calculate effective values (with overrides applied and clamped)
              const effectiveValues = baseValues
                ? resolveEffectiveTiming(baseValues, crop.overrides)
                : null;

              // Calculate minimum allowed adjustments (to not go below clamped minimums)
              // DTM: effective min is 1, so adjustment min is 1 - baseDTM
              // Others: effective min is 0, so adjustment min is -baseValue
              const minAdjustments = baseValues ? {
                dtm: 1 - baseValues.dtm,
                harvestWindow: -baseValues.harvestWindow,
                daysInCells: -baseValues.daysInCells,
              } : { dtm: -999, harvestWindow: -999, daysInCells: -999 };

              return (
                <div className="space-y-4">
                  {/* Crop Name with Color */}
                  <div>
                    <div
                      className="inline-block px-2 py-1 rounded text-sm font-semibold"
                      style={{ backgroundColor: colors.bg, color: colors.text }}
                    >
                      {crop.name}
                    </div>
                  </div>

                  {/* Category */}
                  {crop.category && (
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Category</div>
                      <div className="text-sm text-gray-900">{crop.category}</div>
                    </div>
                  )}

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Start Date</div>
                      <div className="text-sm text-gray-900">{new Date(crop.startDate).toLocaleDateString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">End Date</div>
                      <div className="text-sm text-gray-900">{new Date(crop.endDate).toLocaleDateString()}</div>
                    </div>
                  </div>

                  {/* Duration */}
                  <div>
                    <div className="text-xs text-gray-600 mb-1">Duration</div>
                    <div className="text-sm text-gray-900">{duration} days</div>
                  </div>

                  {/* Bed Assignment */}
                  <div>
                    <div className="text-xs text-gray-600 mb-1">Bed Assignment</div>
                    {crop.resource ? (
                      <div className="text-sm text-gray-900">
                        {groupCrops.length === 1 ? (
                          <span>{crop.resource}</span>
                        ) : (
                          <span>{groupCrops.map(c => c.resource).join(', ')}</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-amber-600">Unassigned</div>
                    )}
                  </div>

                  {/* Bed Feet - Editable */}
                  <div>
                    <div className="text-xs text-gray-600 mb-1">Bed Feet</div>
                    {onUpdatePlanting ? (
                      <input
                        type="number"
                        min={1}
                        step={25}
                        defaultValue={crop.feetNeeded || 50}
                        onBlur={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val) && val > 0 && val !== (crop.feetNeeded || 50)) {
                            onUpdatePlanting(crop.groupId, { bedFeet: val });
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    ) : (
                      <div className="text-sm text-gray-900">{crop.feetNeeded || 50}&apos;</div>
                    )}
                  </div>

                  {/* Multi-bed info */}
                  {groupCrops.length > 1 && (
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Bed Details</div>
                      <div className="text-xs text-gray-900 space-y-1">
                        {groupCrops.map((c) => (
                          <div key={c.id} className="flex justify-between py-1 border-b border-gray-100">
                            <span>{c.resource}</span>
                            <span className="text-gray-700">
                              {c.feetUsed || c.bedCapacityFt || 50}&apos;
                              {c.feetUsed && c.bedCapacityFt && c.feetUsed < c.bedCapacityFt && (
                                <span className="text-amber-600"> of {c.bedCapacityFt}&apos;</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Timing Adjustments - Editable with effective values */}
                  {onUpdatePlanting && (
                    <div className="pt-3 border-t">
                      <div className="text-xs font-semibold text-gray-600 mb-2">Timing Adjustments</div>
                      <div className="space-y-3">
                        {/* Days to Maturity */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-600">Days to Maturity</span>
                            <div className="flex items-center gap-1">
                              <input
                                key={`dtm-${crop.groupId}-${crop.overrides?.additionalDaysInField || 0}`}
                                type="number"
                                defaultValue={crop.overrides?.additionalDaysInField || 0}
                                onBlur={(e) => {
                                  let val = parseInt(e.target.value, 10);
                                  if (!isNaN(val)) {
                                    val = Math.max(minAdjustments.dtm, val);
                                    e.target.value = val.toString();
                                    onUpdatePlanting(crop.groupId, {
                                      overrides: { additionalDaysInField: val }
                                    });
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                }}
                                className="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
                              />
                              <button
                                onClick={() => onUpdatePlanting(crop.groupId, { overrides: { additionalDaysInField: 0 } })}
                                className={`w-5 h-5 flex items-center justify-center rounded ${
                                  (crop.overrides?.additionalDaysInField || 0) !== 0
                                    ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                    : 'invisible'
                                }`}
                                title="Reset to 0"
                                tabIndex={-1}
                              >
                                ×
                              </button>
                            </div>
                          </div>
                          {effectiveValues && (
                            <div className="text-xs text-gray-500 text-right">
                              = {effectiveValues.dtm} days total
                              {baseValues && effectiveValues.dtm !== baseValues.dtm && (
                                <span className="text-gray-400"> (base: {baseValues.dtm})</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Harvest Window */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-600">Harvest Window</span>
                            <div className="flex items-center gap-1">
                              <input
                                key={`harvest-${crop.groupId}-${crop.overrides?.additionalDaysOfHarvest || 0}`}
                                type="number"
                                defaultValue={crop.overrides?.additionalDaysOfHarvest || 0}
                                onBlur={(e) => {
                                  let val = parseInt(e.target.value, 10);
                                  if (!isNaN(val)) {
                                    val = Math.max(minAdjustments.harvestWindow, val);
                                    e.target.value = val.toString();
                                    onUpdatePlanting(crop.groupId, {
                                      overrides: { additionalDaysOfHarvest: val }
                                    });
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                }}
                                className="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
                              />
                              <button
                                onClick={() => onUpdatePlanting(crop.groupId, { overrides: { additionalDaysOfHarvest: 0 } })}
                                className={`w-5 h-5 flex items-center justify-center rounded ${
                                  (crop.overrides?.additionalDaysOfHarvest || 0) !== 0
                                    ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                    : 'invisible'
                                }`}
                                title="Reset to 0"
                                tabIndex={-1}
                              >
                                ×
                              </button>
                            </div>
                          </div>
                          {effectiveValues && (
                            <div className="text-xs text-gray-500 text-right">
                              = {effectiveValues.harvestWindow} days total
                              {baseValues && effectiveValues.harvestWindow !== baseValues.harvestWindow && (
                                <span className="text-gray-400"> (base: {baseValues.harvestWindow})</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Greenhouse Days - only show if crop uses greenhouse */}
                        {baseValues && baseValues.daysInCells > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-gray-600">Greenhouse Days</span>
                              <div className="flex items-center gap-1">
                                <input
                                  key={`gh-${crop.groupId}-${crop.overrides?.additionalDaysInCells || 0}`}
                                  type="number"
                                  defaultValue={crop.overrides?.additionalDaysInCells || 0}
                                  onBlur={(e) => {
                                    let val = parseInt(e.target.value, 10);
                                    if (!isNaN(val)) {
                                      val = Math.max(minAdjustments.daysInCells, val);
                                      e.target.value = val.toString();
                                      onUpdatePlanting(crop.groupId, {
                                        overrides: { additionalDaysInCells: val }
                                      });
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  }}
                                  className="w-16 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
                                />
                                <button
                                  onClick={() => onUpdatePlanting(crop.groupId, { overrides: { additionalDaysInCells: 0 } })}
                                  className={`w-5 h-5 flex items-center justify-center rounded ${
                                    (crop.overrides?.additionalDaysInCells || 0) !== 0
                                      ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                      : 'invisible'
                                  }`}
                                  title="Reset to 0"
                                  tabIndex={-1}
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                            {effectiveValues && (
                              <div className="text-xs text-gray-500 text-right">
                                = {effectiveValues.daysInCells} days total
                                {baseValues && effectiveValues.daysInCells !== baseValues.daysInCells && (
                                  <span className="text-gray-400"> (base: {baseValues.daysInCells})</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Notes - Editable */}
                  {onUpdatePlanting && (
                    <div className="pt-3 border-t">
                      <div className="text-xs text-gray-600 mb-1">Notes</div>
                      <textarea
                        defaultValue={crop.notes || ''}
                        placeholder="Add notes..."
                        rows={2}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== (crop.notes || '')) {
                            onUpdatePlanting(crop.groupId, { notes: val });
                          }
                        }}
                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                      />
                    </div>
                  )}

                  {/* Notes Display (read-only mode) */}
                  {!onUpdatePlanting && crop.notes && (
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Notes</div>
                      <div className="text-sm text-gray-900 whitespace-pre-wrap">{crop.notes}</div>
                    </div>
                  )}

                  {/* Planting ID */}
                  {crop.plantingId && (
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Planting ID</div>
                      <div className="font-mono text-xs text-gray-900">{crop.plantingId}</div>
                    </div>
                  )}

                  {/* Group ID */}
                  <div>
                    <div className="text-xs text-gray-600 mb-1">Group ID</div>
                    <div className="font-mono text-xs text-gray-900">{crop.groupId}</div>
                  </div>

                  {/* Actions */}
                  <div className="pt-3 border-t space-y-2">
                    {onEditCropConfig && crop.plantingId && (
                      <button
                        onClick={() => {
                          onEditCropConfig(crop.plantingId!);
                        }}
                        className="w-full px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        Edit Crop Config
                      </button>
                    )}
                    {onDuplicateCrop && (
                      <button
                        onClick={async () => {
                          const newId = await onDuplicateCrop(crop.groupId);
                          if (newId) {
                            // Select the new planting so user can duplicate again
                            setSelectedGroupIds(new Set([newId]));
                          }
                        }}
                        className="w-full px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        Duplicate Planting
                      </button>
                    )}
                    {onDeleteCrop && (
                      <button
                        onClick={() => {
                          onDeleteCrop([crop.groupId]);
                          setSelectedGroupIds(new Set());
                        }}
                        className="w-full px-3 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                      >
                        Delete Planting
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}
    </div>
  );
}
