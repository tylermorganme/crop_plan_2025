'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

interface TimelineCrop {
  id: string;
  name: string;
  startDate: string; // ISO date
  endDate: string;   // ISO date
  resource: string;  // Bed/location assignment (empty = unassigned)
  category?: string;
  bgColor?: string;
  textColor?: string;
  /** Beds needed in 50ft units */
  bedsNeeded?: number;
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
  /** The planting identifier from the source data */
  plantingId?: string;
}

interface ResourceGroup {
  name: string | null;
  beds: string[];
}

type EditMode = 'move' | 'timing';

interface CropTimelineProps {
  crops: TimelineCrop[];
  resources: string[];
  groups?: ResourceGroup[] | null;
  onCropMove?: (cropId: string, newResource: string, groupId?: string, bedsNeeded?: number) => void;
  onCropDateChange?: (groupId: string, startDate: string, endDate: string) => void;
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
const UI_STATE_KEY = 'crop-timeline-ui-state';

interface UIState {
  viewMode: 'overlap' | 'stacked';
  zoomIndex: number;
  collapsedGroups: string[];
  unassignedHeight: number;
  scrollLeft: number;
  editMode: EditMode;
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

/** Bed size in feet - F and J rows are 20ft, all others are 50ft */
const SHORT_ROWS = ['F', 'J'];
const STANDARD_BED_FT = 50;
const SHORT_BED_FT = 20;

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

function getBedSizeFt(bed: string): number {
  const row = getBedRow(bed);
  return SHORT_ROWS.includes(row) ? SHORT_BED_FT : STANDARD_BED_FT;
}

// =============================================================================
// Component
// =============================================================================

export default function CropTimeline({
  crops,
  resources,
  groups,
  onCropMove,
  onCropDateChange
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
  const [editMode, setEditMode] = useState<EditMode>(
    savedState.current.editMode ?? 'move'
  );
  const [draggedCropId, setDraggedCropId] = useState<string | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverResource, setDragOverResource] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [unassignedHeight, setUnassignedHeight] = useState(
    savedState.current.unassignedHeight ?? 150
  );
  const [isResizing, setIsResizing] = useState(false);

  // For timing mode: track drag start position and original dates
  const dragStartX = useRef<number | null>(null);
  const dragOriginalDates = useRef<{ start: string; end: string } | null>(null);

  // For drag preview - track position during drag
  const [dragPreview, setDragPreview] = useState<{
    groupId: string;
    deltaX: number;
    deltaDays: number;
    targetResource: string | null;
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
        timelineStart: new Date(now.getFullYear(), 0, 1),
        timelineEnd: new Date(now.getFullYear(), 11, 31),
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
      timelineStart: new Date(minDate.getFullYear(), minDate.getMonth() - TIMELINE_PADDING_MONTHS, 1),
      timelineEnd: new Date(maxDate.getFullYear(), maxDate.getMonth() + TIMELINE_PADDING_MONTHS + 1, 0),
    };
  }, [crops]);

  // Calculate pixels per day based on zoom level
  const pixelsPerDay = useMemo(() => {
    const viewportWidth = plannerScrollRef.current?.clientWidth || 800;
    const targetDays = ZOOM_LEVELS[zoomIndex].days;
    return Math.max(1, viewportWidth / targetDays);
  }, [zoomIndex]);

  // Calculate timeline width
  const timelineWidth = useMemo(() => {
    const days = Math.ceil((timelineEnd.getTime() - timelineStart.getTime()) / (1000 * 60 * 60 * 24));
    return days * pixelsPerDay;
  }, [timelineStart, timelineEnd, pixelsPerDay]);

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

  // Save UI state when it changes
  useEffect(() => {
    const saveState = () => {
      saveUIState({
        viewMode,
        zoomIndex,
        collapsedGroups: Array.from(collapsedGroups),
        unassignedHeight,
        scrollLeft: plannerScrollRef.current?.scrollLeft ?? 0,
        editMode,
      });
    };

    // Save on state changes
    saveState();

    // Also save scroll position on scroll (debounced)
    const scrollEl = plannerScrollRef.current;
    if (!scrollEl) return;

    let scrollTimeout: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(saveState, 200);
    };

    scrollEl.addEventListener('scroll', handleScroll);
    return () => {
      scrollEl.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [viewMode, zoomIndex, collapsedGroups, unassignedHeight, editMode]);

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
    // Encode crop info for the drop handler
    e.dataTransfer.setData('application/json', JSON.stringify({
      cropId: crop.id,
      groupId: crop.groupId,
      bedsNeeded: crop.bedsNeeded || 1,
      startDate: crop.startDate,
      endDate: crop.endDate,
    }));
    setDraggedCropId(crop.id);
    setDraggedGroupId(crop.groupId);

    // For timing mode, track start position
    if (editMode === 'timing') {
      dragStartX.current = e.clientX;
      dragOriginalDates.current = { start: crop.startDate, end: crop.endDate };
    }

    // Initialize drag preview
    setDragPreview({
      groupId: crop.groupId,
      deltaX: 0,
      deltaDays: 0,
      targetResource: crop.resource,
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

    if (editMode === 'move') {
      setDragOverResource(resource);
      // Update preview target resource
      if (dragPreview && draggedGroupId) {
        setDragPreview(prev => prev ? { ...prev, targetResource: resource } : null);
      }
    } else if (editMode === 'timing' && dragStartX.current !== null && draggedGroupId) {
      // Calculate time offset for preview
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

      if (editMode === 'timing' && dragStartX.current !== null && dragOriginalDates.current) {
        // Timing mode: calculate date offset from horizontal drag
        const deltaX = e.clientX - dragStartX.current;
        const deltaDays = pixelsToDays(deltaX);

        if (deltaDays !== 0 && onCropDateChange) {
          const newStart = offsetDate(dragOriginalDates.current.start, deltaDays);
          const newEnd = offsetDate(dragOriginalDates.current.end, deltaDays);
          onCropDateChange(data.groupId, newStart, newEnd);
        }
      } else if (editMode === 'move') {
        // Move mode: change resource assignment
        if (data.cropId && onCropMove) {
          onCropMove(
            data.cropId,
            resource === 'Unassigned' ? '' : resource,
            data.groupId,
            data.bedsNeeded
          );
        }
      }
    } catch {
      // Fallback for simple drag data
      if (editMode === 'move') {
        const cropId = e.dataTransfer.getData('text/plain');
        if (cropId && onCropMove) {
          onCropMove(cropId, resource === 'Unassigned' ? '' : resource);
        }
      }
    }

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
    const isOverlapping = viewMode === 'overlap' && overlappingIds.has(crop.id);
    const isMultiBed = crop.totalBeds > 1;
    const isFirstBed = crop.bedIndex === 1;
    const isDragging = draggedCropId === crop.id;
    // Highlight all beds in the group being dragged
    const isGroupBeingDragged = draggedGroupId === crop.groupId && draggedGroupId !== null;
    const isSelected = selectedGroupId === crop.groupId;
    const canDrag = !isMultiBed || isFirstBed; // Only first bed of multi-bed crops is draggable

    // Check if this crop group has an active drag preview
    const hasTimingPreview = editMode === 'timing' &&
                              dragPreview?.groupId === crop.groupId &&
                              dragPreview.deltaDays !== 0;

    // Check if this is a partial bed (doesn't use full capacity)
    const isPartialBed = crop.feetUsed !== undefined &&
                         crop.bedCapacityFt !== undefined &&
                         crop.feetUsed < crop.bedCapacityFt;

    const colors = crop.bgColor
      ? { bg: crop.bgColor, text: crop.textColor || '#fff' }
      : getColorForCategory(crop.category);

    const topPos = viewMode === 'stacked'
      ? CROP_TOP_PADDING + stackRow * (CROP_HEIGHT + CROP_SPACING)
      : 8;

    // Build tooltip
    let tooltip = `${crop.name}\n${formatDate(crop.startDate)} - ${formatDate(crop.endDate)}`;
    if (isMultiBed) {
      tooltip += `\nBed ${crop.bedIndex} of ${crop.totalBeds}${isFirstBed ? ' (drag to move all)' : ' (drag first bed to move)'}`;
    }
    if (isPartialBed) {
      tooltip += `\n${crop.feetUsed}' of ${crop.bedCapacityFt}' used`;
    }

    // Calculate preview dates if in timing mode
    const previewDates = hasTimingPreview ? {
      start: offsetDate(crop.startDate, dragPreview!.deltaDays),
      end: offsetDate(crop.endDate, dragPreview!.deltaDays),
    } : null;
    const previewPos = previewDates ? getTimelinePosition(previewDates.start, previewDates.end) : null;

    return (
      <React.Fragment key={crop.id}>
        {/* Ghost preview for timing mode - shows where crop will move to */}
        {hasTimingPreview && previewPos && (
          <div
            className="absolute rounded border-2 border-dashed pointer-events-none"
            style={{
              left: previewPos.left,
              width: previewPos.width,
              top: topPos,
              height: CROP_HEIGHT,
              borderColor: colors.bg,
              backgroundColor: `${colors.bg}33`, // 20% opacity
              zIndex: 50,
            }}
          >
            {/* Date offset badge */}
            <div
              className="absolute -top-6 left-1/2 transform -translate-x-1/2 px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap"
              style={{
                backgroundColor: dragPreview!.deltaDays > 0 ? '#22c55e' : '#ef4444',
                color: 'white',
              }}
            >
              {dragPreview!.deltaDays > 0 ? '+' : ''}{dragPreview!.deltaDays} days
            </div>
            {/* New dates preview */}
            <div className="px-2 py-1 text-xs" style={{ color: colors.bg }}>
              <div className="font-semibold">{formatDate(previewDates!.start)} - {formatDate(previewDates!.end)}</div>
            </div>
          </div>
        )}

        {/* Actual crop box */}
        <div
          draggable={canDrag}
          onDragStart={canDrag ? (e) => handleDragStart(e, crop) : undefined}
          onDragEnd={canDrag ? handleDragEnd : undefined}
          onClick={(e) => handleCropClick(e, crop)}
          className={`absolute rounded select-none overflow-hidden hover:z-10 cursor-pointer ${
            canDrag ? 'cursor-grab' : ''
          } ${isDragging ? 'opacity-50 cursor-grabbing' : ''} ${
            isGroupBeingDragged && !isDragging ? 'opacity-60 ring-2 ring-blue-400' : ''
          } ${isSelected ? 'ring-2 ring-yellow-400 ring-offset-1 z-20' : ''} ${
            isOverlapping ? 'bg-transparent border-2' : ''
          }`}
          style={{
            left: pos.left,
            width: pos.width,
            top: topPos,
            height: CROP_HEIGHT,
            backgroundColor: isOverlapping ? 'transparent' : colors.bg,
            borderColor: colors.bg,
            color: isOverlapping ? '#333' : colors.text,
            boxShadow: isOverlapping ? 'none' : '0 2px 4px rgba(0,0,0,0.2)',
          }}
          title={tooltip}
        >
          <div className="px-1 py-1 flex items-start gap-1">
            {/* Fixed-width left badge area */}
            <div className="flex flex-col items-start gap-0.5 flex-shrink-0" style={{ width: 24 }}>
              {isMultiBed && (
                <div className="text-[9px] opacity-75 bg-black/20 px-1 rounded">
                  {crop.bedIndex}/{crop.totalBeds}
                </div>
              )}
              {isPartialBed && (
                <div className="text-[9px] opacity-75 bg-black/20 px-1 rounded">
                  {crop.feetUsed}&apos;
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
      </React.Fragment>
    );
  };

  // Render resource lane
  const renderResourceLane = (
    resource: string,
    groupName: string | null,
    groupIndex: number
  ) => {
    const laneCrops = cropsByResource[resource] || [];
    const stacking = calculateStacking(laneCrops);
    const laneHeight = viewMode === 'stacked' && laneCrops.length > 0
      ? CROP_TOP_PADDING * 2 + stacking.maxRow * CROP_HEIGHT + (stacking.maxRow - 1) * CROP_SPACING
      : 50;

    const isEvenGroup = groupIndex % 2 === 1;
    const isDragOver = dragOverResource === resource;

    return (
      <div key={resource} className="flex">
        {/* Lane label */}
        <div
          className={`flex-shrink-0 border-r border-b border-gray-200 px-2 flex items-center text-xs font-medium ${
            isEvenGroup ? 'bg-blue-50' : 'bg-gray-50'
          }`}
          style={{ width: LANE_LABEL_WIDTH, minWidth: LANE_LABEL_WIDTH, height: laneHeight }}
        >
          {groupName && (
            <span
              className="text-[9px] text-gray-500 mr-1 cursor-pointer hover:text-gray-700"
              onClick={() => toggleGroup(groupName)}
            >
              <span className="mr-1">▲</span>
              {groupName}:
            </span>
          )}
          <span className="truncate">{resource}</span>
        </div>

        {/* Lane timeline */}
        <div
          className={`relative border-b border-gray-100 flex-1 ${
            isEvenGroup ? 'bg-blue-50/30' : ''
          } ${isDragOver ? 'bg-blue-100' : ''}`}
          style={{ height: laneHeight, width: timelineWidth }}
          onDragOver={(e) => handleDragOver(e, resource)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, resource)}
        >
          {/* Today line */}
          {todayPosition !== null && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-5"
              style={{ left: todayPosition }}
            />
          )}

          {/* Crop boxes */}
          {laneCrops.map(crop => renderCropBox(crop, stacking.rows[crop.id] || 0))}
        </div>
      </div>
    );
  };

  // Unassigned crops
  const unassignedCrops = cropsByResource['Unassigned'] || [];

  // Get selected crop group info for inspector
  const selectedCrops = useMemo(() => {
    if (!selectedGroupId) return null;
    const groupCrops = crops.filter(c => c.groupId === selectedGroupId);
    if (groupCrops.length === 0) return null;
    return groupCrops;
  }, [crops, selectedGroupId]);

  // Click handler for crop selection
  const handleCropClick = useCallback((e: React.MouseEvent, crop: TimelineCrop) => {
    e.stopPropagation();
    setSelectedGroupId(prev => prev === crop.groupId ? null : crop.groupId);
  }, []);

  // Clear selection when clicking outside
  const handleBackgroundClick = useCallback(() => {
    setSelectedGroupId(null);
  }, []);

  // Calculate duration in days
  const getDuration = (start: string, end: string) => {
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  return (
    <div className="flex h-full bg-gray-100">
      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
      {/* Controls */}
      <div className="flex items-center gap-3 p-2 bg-white border-b">
        <div className="flex border rounded">
          <button
            onClick={() => setViewMode('overlap')}
            className={`px-3 py-1.5 text-xs ${viewMode === 'overlap' ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}
          >
            Overlap
          </button>
          <button
            onClick={() => setViewMode('stacked')}
            className={`px-3 py-1.5 text-xs ${viewMode === 'stacked' ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}
          >
            Stacked
          </button>
        </div>

        <div className="flex border rounded">
          <button onClick={zoomOut} className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200">−</button>
          <span className="px-3 py-1.5 text-xs min-w-[60px] text-center border-x">{ZOOM_LEVELS[zoomIndex].label}</span>
          <button onClick={zoomIn} className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200">+</button>
        </div>

        <button
          onClick={goToToday}
          className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Today
        </button>

        {/* Edit mode toggle */}
        <div className="flex border rounded ml-2">
          <button
            onClick={() => setEditMode('move')}
            className={`px-3 py-1.5 text-xs ${editMode === 'move' ? 'bg-green-500 text-white' : 'bg-gray-100'}`}
            title="Drag crops between beds"
          >
            Move Beds
          </button>
          <button
            onClick={() => setEditMode('timing')}
            className={`px-3 py-1.5 text-xs ${editMode === 'timing' ? 'bg-orange-500 text-white' : 'bg-gray-100'}`}
            title="Drag crops to change dates"
          >
            Edit Timing
          </button>
        </div>

        <span className="text-xs text-gray-500 ml-auto">
          {crops.length} crops · {resources.length - 1} resources
          {editMode === 'timing' && (
            <span className="ml-2 text-orange-600 font-medium">Timing edit mode</span>
          )}
        </span>
      </div>

      {/* Main timeline area - single scrollable container */}
      <div className="flex-1 min-h-0 overflow-auto bg-white border rounded-b" ref={plannerScrollRef}>
        {/* Using HTML table for reliable dual-axis sticky positioning */}
        <table style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              {/* Corner cell - sticky both directions */}
              <th
                className="px-3 py-2 text-xs font-medium text-gray-600 border-r border-b text-left"
                style={{
                  position: 'sticky',
                  top: 0,
                  left: 0,
                  zIndex: 40,
                  backgroundColor: '#f9fafb',
                  width: LANE_LABEL_WIDTH,
                  minWidth: LANE_LABEL_WIDTH,
                }}
              >
                Resource
              </th>
              {/* Month header cells - each sticky to top */}
              {monthHeaders.map((h, i) => (
                <th
                  key={i}
                  className="text-center text-[10px] text-gray-600 border-r border-b border-gray-200 py-1 font-normal"
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 30,
                    backgroundColor: '#f9fafb',
                    width: h.width,
                    minWidth: h.width,
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
              // Use user-set height, but ensure minimum based on content
              const minContentHeight = unassignedCrops.length > 0
                ? CROP_TOP_PADDING * 2 + unassignedStacking.maxRow * CROP_HEIGHT + (unassignedStacking.maxRow - 1) * CROP_SPACING
                : 80;
              const effectiveHeight = Math.max(unassignedHeight, minContentHeight);
              const isDragOverUnassigned = dragOverResource === 'Unassigned';
              const bgColor = unassignedCrops.length > 0 ? '#fffbeb' : '#f9fafb';
              // Header row height (approx 42px for the month headers)
              const headerHeight = 42;

              return (
                <tr key="Unassigned">
                  {/* Sticky unassigned label - sticks below header */}
                  <td
                    className="px-2 text-xs font-medium border-r align-top"
                    style={{
                      position: 'sticky',
                      top: headerHeight,
                      left: 0,
                      zIndex: 25, // Above regular sticky labels but below header
                      backgroundColor: unassignedCrops.length > 0 ? '#fef3c7' : '#e5e7eb',
                      height: effectiveHeight,
                      borderBottom: 'none',
                    }}
                  >
                    <div className="flex flex-col pt-2">
                      <span className={`font-bold ${unassignedCrops.length > 0 ? 'text-amber-800' : 'text-gray-600'}`}>
                        Unassigned
                      </span>
                      <span className={`text-[10px] ${unassignedCrops.length > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
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
                      top: headerHeight,
                      zIndex: 24,
                      height: effectiveHeight,
                      backgroundColor: isDragOverUnassigned ? '#fef3c7' : bgColor,
                      boxShadow: isDragOverUnassigned ? 'inset 0 0 0 3px #f59e0b' : undefined,
                      borderBottom: 'none',
                    }}
                    onDragOver={(e) => handleDragOver(e, 'Unassigned')}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, 'Unassigned')}
                  >
                    {/* Drop zone indicator for move mode */}
                    {isDragOverUnassigned && editMode === 'move' && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
                        <div className="bg-amber-600 text-white px-4 py-2 rounded-lg shadow-lg font-semibold text-sm">
                          Drop to unassign from bed
                        </div>
                      </div>
                    )}
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
                  top: 42 + unassignedHeight, // Header + unassigned height
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
                      className="px-2 py-1 text-xs text-gray-500 italic border-b border-r cursor-pointer hover:bg-gray-200"
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

              const laneCrops = cropsByResource[resource] || [];
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
                    className="px-2 text-xs font-medium border-b border-r align-middle"
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
                          className="text-[9px] text-gray-500 mr-1 cursor-pointer hover:text-gray-700 flex-shrink-0"
                          onClick={() => toggleGroup(groupName)}
                        >
                          <span className="mr-1">▲</span>
                          {groupName}:
                        </span>
                      )}
                      <span className="truncate">{resource}</span>
                      <span className="text-[9px] text-gray-400 ml-1">({getBedSizeFt(resource)}&apos;)</span>
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
                    {/* Drop zone indicator for move mode */}
                    {isDragOver && editMode === 'move' && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
                        <div className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg font-semibold text-sm">
                          Drop to move to {resource}
                        </div>
                      </div>
                    )}
                    {/* Today line */}
                    {todayPosition !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                        style={{ left: todayPosition, zIndex: 5 }}
                      />
                    )}
                    {/* Crop boxes */}
                    {laneCrops.map(crop => renderCropBox(crop, stacking.rows[crop.id] || 0))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>

      {/* Inspector Panel */}
      {selectedCrops && selectedCrops.length > 0 && (
        <div className="w-80 bg-white border-l flex flex-col flex-shrink-0">
          {/* Inspector Header */}
          <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
            <h3 className="font-semibold text-sm">Crop Details</h3>
            <button
              onClick={() => setSelectedGroupId(null)}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            >
              &times;
            </button>
          </div>

          {/* Inspector Content */}
          <div className="flex-1 overflow-auto p-3">
            {(() => {
              const crop = selectedCrops[0];
              const colors = crop.bgColor
                ? { bg: crop.bgColor, text: crop.textColor || '#fff' }
                : getColorForCategory(crop.category);
              const duration = getDuration(crop.startDate, crop.endDate);
              const totalFeet = selectedCrops.reduce((sum, c) => sum + (c.feetUsed || c.bedCapacityFt || 50), 0);

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
                      <div className="text-xs text-gray-500 mb-1">Category</div>
                      <div className="text-sm">{crop.category}</div>
                    </div>
                  )}

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Start Date</div>
                      <div className="text-sm">{new Date(crop.startDate).toLocaleDateString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">End Date</div>
                      <div className="text-sm">{new Date(crop.endDate).toLocaleDateString()}</div>
                    </div>
                  </div>

                  {/* Duration */}
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Duration</div>
                    <div className="text-sm">{duration} days</div>
                  </div>

                  {/* Bed Assignment */}
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Bed Assignment</div>
                    {crop.resource ? (
                      <div className="text-sm">
                        {selectedCrops.length === 1 ? (
                          <span>{crop.resource}</span>
                        ) : (
                          <span>{selectedCrops.map(c => c.resource).join(', ')}</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-amber-600">Unassigned</div>
                    )}
                  </div>

                  {/* Beds Needed */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Beds Needed</div>
                      <div className="text-sm">{crop.bedsNeeded || 1} (50&apos; units)</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Total Feet</div>
                      <div className="text-sm">{totalFeet}&apos;</div>
                    </div>
                  </div>

                  {/* Multi-bed info */}
                  {selectedCrops.length > 1 && (
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Bed Details</div>
                      <div className="text-xs space-y-1">
                        {selectedCrops.map((c) => (
                          <div key={c.id} className="flex justify-between py-1 border-b border-gray-100">
                            <span>{c.resource}</span>
                            <span className="text-gray-500">
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

                  {/* Planting ID */}
                  {crop.plantingId && (
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Planting ID</div>
                      <div className="text-sm font-mono text-xs">{crop.plantingId}</div>
                    </div>
                  )}

                  {/* Group ID */}
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Group ID</div>
                    <div className="text-sm font-mono text-xs">{crop.groupId}</div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
