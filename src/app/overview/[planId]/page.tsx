'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
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
import AppHeader from '@/components/AppHeader';

// =============================================================================
// FIELD LAYOUT CONFIGURATION (UI-level, stored in localStorage)
// =============================================================================

/** A field/area of the farm (e.g., "Old Field", "Reed Canary Island") */
interface FieldConfig {
  id: string;
  name: string;
  /** Grid layout: lanes of bed group letters. Each inner array is one visual lane (horizontal strip). */
  lanes: string[][];
}

/** Complete layout configuration */
interface FieldLayoutConfig {
  fields: FieldConfig[];
  /** Which field is currently active/visible */
  activeFieldId: string;
}

const LAYOUT_STORAGE_KEY = 'farm-map-layout-v1';

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
 * Acts as a drop target for unassigned plantings.
 */
function BedRowComponent({
  row,
  isEven,
  onAssignPlanting,
}: {
  row: BedRow;
  isEven: boolean;
  onAssignPlanting?: (plantingId: string, bedId: string) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Calculate stacking for overlapping crops
  const stacks: StackResult = useMemo(() => calculateStacking(row.crops), [row.crops]);

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
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.type === 'unassigned-planting' && data.plantingId && onAssignPlanting) {
        onAssignPlanting(data.plantingId, row.bedId);
      }
    } catch {
      // Invalid drop data, ignore
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
      <div className="flex-1 relative overflow-hidden pointer-events-none">
        {/* Month grid lines */}
        {MONTH_LABELS.map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-gray-100"
            style={{ left: `${(i / 12) * 100}%` }}
          />
        ))}
        {/* Crop blocks */}
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
}: {
  section: BedGroupSection;
  onAssignPlanting?: (plantingId: string, bedId: string) => void;
}) {
  return (
    <div style={{ width: GROUP_WIDTH }}>
      {/* Group header */}
      <div className="bg-gray-200 px-2 py-1 font-semibold text-gray-700 text-sm rounded-t text-center">
        {section.groupName}
      </div>

      {/* Month headers + Beds */}
      <div className="bg-white border border-t-0 border-gray-200 rounded-b">
        <MonthHeaderRow />
        {section.beds.map((bed, index) => (
          <BedRowComponent
            key={bed.bedId}
            row={bed}
            isEven={index % 2 === 0}
            onAssignPlanting={onAssignPlanting}
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

/**
 * Extract the row letter from a group name like "Row A" or "A Block".
 * Returns the single letter identifier.
 */
function getRowLetter(groupName: string): string {
  // Try patterns like "Row A", "A Block", "Block A", or just "A"
  const match = groupName.match(/\b([A-Z])\b/i);
  return match ? match[1].toUpperCase() : groupName.charAt(0).toUpperCase();
}

// =============================================================================
// UNASSIGNED PLANTINGS PANEL (Sidebar Gantt Chart)
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
}

/**
 * Gantt chart panel showing unassigned plantings for the selected year.
 * Supports search filtering and displays crops as colored boxes.
 */
function UnassignedPlantingsPanel({
  plantings,
  year,
  searchQuery,
}: {
  plantings: EnrichedUnassignedCrop[];
  year: number;
  searchQuery: string;
}) {
  // Filter plantings based on search query
  const filteredPlantings = useMemo(() => {
    if (!searchQuery.trim()) return plantings;

    const terms = searchQuery.toLowerCase().trim().split(/\s+/);

    return plantings.filter(p => {
      const searchText = [
        p.cropName,
        p.category,
        p.identifier,
        p.name,
      ].filter(Boolean).join(' ').toLowerCase();

      return terms.every(term => {
        if (term.startsWith('-') && term.length > 1) {
          return !searchText.includes(term.slice(1));
        }
        return searchText.includes(term);
      });
    });
  }, [plantings, searchQuery]);

  // Sort by start date
  const sortedPlantings = useMemo(() => {
    return [...filteredPlantings].sort((a, b) =>
      a.startDate.localeCompare(b.startDate)
    );
  }, [filteredPlantings]);

  if (sortedPlantings.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        {searchQuery ? 'No matching unassigned plantings' : 'No unassigned plantings for this year'}
      </div>
    );
  }

  return (
    <div className="text-xs">
      {/* Month headers */}
      <div className="sticky top-0 bg-white border-b border-gray-200 flex" style={{ height: 20 }}>
        <div className="w-24 flex-shrink-0 px-1 text-gray-500 font-medium flex items-center">
          Crop
        </div>
        <div className="flex-1 flex">
          {MONTH_LABELS.map((label, i) => (
            <div
              key={i}
              className="text-[9px] text-gray-400 text-center border-l border-gray-100 first:border-l-0 flex items-center justify-center"
              style={{ width: `${100 / 12}%` }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Planting rows */}
      {sortedPlantings.map((planting, index) => {
        const startPercent = dateToYearPercent(planting.startDate, year);
        const endPercent = dateToYearPercent(planting.endDate, year);
        const widthPercent = Math.max(2, endPercent - startPercent);
        const colors = getColorForCategory(planting.category);
        const isEven = index % 2 === 0;

        return (
          <div
            key={planting.id}
            className={`flex items-center border-b border-gray-100 ${isEven ? 'bg-gray-50' : 'bg-white'}`}
            style={{ height: 28 }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/json', JSON.stringify({
                type: 'unassigned-planting',
                plantingId: planting.plantingId || planting.id,
              }));
              e.dataTransfer.effectAllowed = 'move';
            }}
          >
            {/* Crop label */}
            <div
              className="w-24 flex-shrink-0 px-1 truncate text-gray-700 cursor-grab"
              title={`${planting.cropName} - ${planting.identifier}`}
            >
              {planting.cropName}
            </div>

            {/* Timeline area */}
            <div className="flex-1 relative">
              {/* Month grid lines */}
              {MONTH_LABELS.map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-gray-100"
                  style={{ left: `${(i / 12) * 100}%` }}
                />
              ))}
              {/* Crop box */}
              <div
                className="absolute top-1 bottom-1 rounded-sm overflow-hidden cursor-grab"
                style={{
                  left: `${Math.max(0, startPercent)}%`,
                  width: `${widthPercent}%`,
                  backgroundColor: colors.bg,
                  minWidth: 4,
                }}
                title={`${planting.identifier}: ${planting.startDate} to ${planting.endDate} (${planting.feetNeeded}ft)`}
              >
                <span
                  className="text-[9px] px-0.5 truncate block whitespace-nowrap"
                  style={{ color: colors.text }}
                >
                  {planting.identifier}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Layout Editor Modal - allows configuring field layout
 */
function LayoutEditorModal({
  layout,
  availableGroups,
  onSave,
  onClose,
}: {
  layout: FieldLayoutConfig;
  availableGroups: string[]; // Available bed group letters
  onSave: (layout: FieldLayoutConfig) => void;
  onClose: () => void;
}) {
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
                {/* Field name */}
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={selectedField.name}
                    onChange={e => updateFieldName(selectedField.id, e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded text-lg font-medium w-64"
                  />
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
                        {lane.map((letter: string) => (
                          <span
                            key={letter}
                            className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm flex items-center gap-1"
                          >
                            {letter}
                            <button
                              onClick={() => removeGroupFromLane(selectedField.id, laneIndex, letter)}
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
                              <option key={g} value={g}>{g}</option>
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
                          {g}
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
}: {
  sections: BedGroupSection[];
  year: number;
  baseYear: number;
  onYearChange: (year: number) => void;
  onAssignPlanting?: (plantingId: string, bedId: string) => void;
}) {
  const [layout, setLayout] = useState<FieldLayoutConfig>(DEFAULT_LAYOUT);
  const [showEditor, setShowEditor] = useState(false);

  // Load layout from localStorage on mount
  useEffect(() => {
    setLayout(loadLayoutFromStorage());
  }, []);

  // Create a map for quick lookup by row letter (e.g., "Row A" -> "A")
  const sectionsByLetter = useMemo(() => {
    const map = new Map<string, BedGroupSection>();
    for (const section of sections) {
      const letter = getRowLetter(section.groupName);
      map.set(letter, section);
    }
    return map;
  }, [sections]);

  // Get all available group letters from sections
  const availableGroups = useMemo(() => {
    return Array.from(sectionsByLetter.keys()).sort();
  }, [sectionsByLetter]);

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
          ⚙️ Layout
        </button>
      </div>

      {/* Field layout */}
      {activeField && (
        <div className="flex flex-col gap-3">
          {activeField.lanes.map((lane: string[], laneIndex: number) => {
            const laneSections = lane
              .map((letter: string) => sectionsByLetter.get(letter))
              .filter((s): s is BedGroupSection => s !== undefined);

            if (laneSections.length === 0) return null;

            return (
              <div key={laneIndex} className="flex gap-3 flex-wrap">
                {laneSections.map((section: BedGroupSection) => (
                  <BedGroupComponent
                    key={section.groupId}
                    section={section}
                    onAssignPlanting={onAssignPlanting}
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
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Plan store state
  const currentPlan = usePlanStore((state) => state.currentPlan);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);
  const updatePlanting = usePlanStore((state) => state.updatePlanting);

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

    return year;
  }, [currentPlan]);

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

    const crops = getTimelineCropsFromPlan(currentPlan);

    return buildOverviewData(
      currentPlan.beds,
      currentPlan.bedGroups,
      crops,
      selectedYear
    );
  }, [currentPlan, selectedYear]);

  // Year for display (use selectedYear or fall back to baseYear)
  const displayYear = selectedYear ?? baseYear;

  // Get unassigned plantings with computed dates for the selected year
  const unassignedPlantings = useMemo(() => {
    if (!currentPlan || selectedYear === null) return [];

    const crops = getTimelineCropsFromPlan(currentPlan);
    const catalog = currentPlan.cropCatalog ?? {};

    // Filter to unassigned crops that overlap with the selected year
    return crops
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
        const config = catalog[crop.cropConfigId];
        return {
          ...crop,
          cropName: config?.crop ?? crop.name,
          category: config?.category ?? crop.category ?? '',
          identifier: config?.identifier ?? crop.cropConfigId,
        };
      });
  }, [currentPlan, selectedYear]);

  // Resize handler for sidebar
  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX; // Reversed because dragging left increases width
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
  const handleAssignPlanting = useCallback((plantingId: string, bedId: string) => {
    updatePlanting(plantingId, { startBed: bedId });
  }, [updatePlanting]);

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
    <>
      <AppHeader />
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

      {/* Content - flex layout with map and sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main map area */}
        <main className="flex-1 overflow-auto px-4 sm:px-6 lg:px-8 py-6">
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
            />
          )}
        </main>

        {/* Resize handle */}
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

        {/* Unassigned plantings sidebar */}
        <aside
          className="flex-shrink-0 bg-white border-l border-gray-200 overflow-hidden flex flex-col"
          style={{ width: sidebarWidth }}
        >
          {/* Sidebar header */}
          <div className="p-3 border-b border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-700">
                Unassigned ({unassignedPlantings.length})
              </h2>
            </div>
            {/* Search input */}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search crops..."
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Unassigned plantings gantt */}
          <div className="flex-1 overflow-auto">
            <UnassignedPlantingsPanel
              plantings={unassignedPlantings}
              year={displayYear}
              searchQuery={searchQuery}
            />
          </div>
        </aside>
      </div>
    </div>
    </>
  );
}
