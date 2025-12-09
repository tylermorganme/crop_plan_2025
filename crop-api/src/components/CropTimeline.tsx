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
}

interface ResourceGroup {
  name: string | null;
  beds: string[];
}

interface CropTimelineProps {
  crops: TimelineCrop[];
  resources: string[];
  groups?: ResourceGroup[] | null;
  onCropMove?: (cropId: string, newResource: string, groupId?: string, bedsNeeded?: number) => void;
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

// =============================================================================
// Component
// =============================================================================

export default function CropTimeline({
  crops,
  resources,
  groups,
  onCropMove
}: CropTimelineProps) {
  // State
  const [viewMode, setViewMode] = useState<'overlap' | 'stacked'>('stacked');
  const [zoomIndex, setZoomIndex] = useState(2); // Start at 6 months
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [draggedCropId, setDraggedCropId] = useState<string | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverResource, setDragOverResource] = useState<string | null>(null);

  // Refs
  const plannerScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);

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

  // Initial scroll to today
  useEffect(() => {
    if (initialScrollDone.current || !plannerScrollRef.current) return;
    initialScrollDone.current = true;

    const scrollToDate = new Date(Date.now() - DEFAULT_SCROLL_OFFSET_DAYS * 24 * 60 * 60 * 1000);
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysFromStart = (scrollToDate.getTime() - timelineStart.getTime()) / msPerDay;
    plannerScrollRef.current.scrollLeft = Math.max(0, daysFromStart * pixelsPerDay);
  }, [timelineStart, pixelsPerDay]);

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

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, crop: TimelineCrop) => {
    // Encode crop info for the drop handler
    e.dataTransfer.setData('application/json', JSON.stringify({
      cropId: crop.id,
      groupId: crop.groupId,
      bedsNeeded: crop.bedsNeeded || 1,
    }));
    setDraggedCropId(crop.id);
    setDraggedGroupId(crop.groupId);
  };

  const handleDragEnd = () => {
    setDraggedCropId(null);
    setDraggedGroupId(null);
    setDragOverResource(null);
  };

  const handleDragOver = (e: React.DragEvent, resource: string) => {
    e.preventDefault();
    setDragOverResource(resource);
  };

  const handleDragLeave = () => {
    setDragOverResource(null);
  };

  const handleDrop = (e: React.DragEvent, resource: string) => {
    e.preventDefault();
    setDragOverResource(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.cropId && onCropMove) {
        onCropMove(
          data.cropId,
          resource === 'Unassigned' ? '' : resource,
          data.groupId,
          data.bedsNeeded
        );
      }
    } catch {
      // Fallback for simple drag data
      const cropId = e.dataTransfer.getData('text/plain');
      if (cropId && onCropMove) {
        onCropMove(cropId, resource === 'Unassigned' ? '' : resource);
      }
    }
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
    const canDrag = !isMultiBed || isFirstBed; // Only first bed of multi-bed crops is draggable

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

    return (
      <div
        key={crop.id}
        draggable={canDrag}
        onDragStart={canDrag ? (e) => handleDragStart(e, crop) : undefined}
        onDragEnd={canDrag ? handleDragEnd : undefined}
        className={`absolute rounded select-none overflow-hidden hover:z-10 ${
          canDrag ? 'cursor-grab' : 'cursor-default'
        } ${isDragging ? 'opacity-50 cursor-grabbing' : ''} ${
          isGroupBeingDragged && !isDragging ? 'opacity-60 ring-2 ring-blue-400' : ''
        } ${isOverlapping ? 'bg-transparent border-2' : ''}`}
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
        <div className="px-2 py-1 flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-xs truncate">{crop.name}</div>
            <div className="text-[9px] opacity-90">
              {formatDate(crop.startDate)} - {formatDate(crop.endDate)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5 ml-1 flex-shrink-0">
            {isMultiBed && (
              <div className="text-[9px] opacity-75 bg-black/20 px-1 rounded">
                {crop.bedIndex}/{crop.totalBeds}
              </div>
            )}
            {isPartialBed && (
              <div className="text-[9px] opacity-75 bg-black/20 px-1 rounded">
                {crop.feetUsed}&apos; of {crop.bedCapacityFt}&apos;
              </div>
            )}
          </div>
        </div>
      </div>
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

  return (
    <div className="flex flex-col h-full bg-gray-100">
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

        <span className="text-xs text-gray-500 ml-auto">
          {crops.length} crops · {resources.length - 1} resources
        </span>
      </div>

      {/* Unassigned section */}
      {unassignedCrops.length > 0 && (
        <div className="border-b bg-amber-50">
          <div className="flex items-center px-3 py-2 border-b border-amber-200 bg-amber-100">
            <span className="text-xs font-medium text-amber-800">
              Unassigned ({unassignedCrops.length})
            </span>
          </div>
          <div
            className="relative overflow-x-auto"
            style={{ height: 60 }}
            onDragOver={(e) => handleDragOver(e, 'Unassigned')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'Unassigned')}
          >
            <div className="relative" style={{ width: timelineWidth, height: '100%' }}>
              {todayPosition !== null && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-5"
                  style={{ left: todayPosition }}
                />
              )}
              {unassignedCrops.map((crop, i) => renderCropBox(crop, 0))}
            </div>
          </div>
        </div>
      )}

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
                    </div>
                  </td>
                  {/* Timeline lane - spans all month columns */}
                  <td
                    colSpan={monthHeaders.length}
                    className={`relative border-b border-gray-100 p-0 ${isDragOver ? 'bg-blue-100' : ''}`}
                    style={{
                      height: laneHeight,
                      backgroundColor: isDragOver ? undefined : (isEvenGroup ? 'rgba(239,246,255,0.3)' : undefined),
                    }}
                    onDragOver={(e) => handleDragOver(e, resource)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, resource)}
                  >
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
  );
}
