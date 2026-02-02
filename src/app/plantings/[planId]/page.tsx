'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'next/navigation';
import { parseISO, format } from 'date-fns';
import { usePlanStore } from '@/lib/plan-store';
import { useUIStore } from '@/lib/ui-store';
import { Z_INDEX } from '@/lib/z-index';
import { DateInputWithButtons } from '@/components/DateInputWithButtons';
import { ConnectedPlantingInspector } from '@/components/ConnectedPlantingInspector';
import { PageLayout } from '@/components/PageLayout';
import AppHeader from '@/components/AppHeader';
import {
  getPrimarySeedToHarvest,
  calculateAggregateHarvestWindow,
  calculateDaysInCells,
  calculateFieldOccupationDays,
  calculateYieldPerWeek,
} from '@/lib/entities/planting-specs';
import { useComputedCrops } from '@/lib/use-computed-crops';
import { calculateSpecRevenue, formatCurrency } from '@/lib/revenue';
import { parseSearchQuery, matchesFilter } from '@/lib/search-dsl';
import { enrichedPlantingSearchConfig } from '@/lib/search-configs';
import { SearchInput } from '@/components/SearchInput';
import type { PlantingSpec } from '@/lib/entities/planting-specs';
import type { Planting } from '@/lib/entities/planting';
import type { TimelineCrop } from '@/lib/plan-types';

// =============================================================================
// Constants
// =============================================================================

const ROW_HEIGHT = 36;
const STORAGE_KEY = 'plantings-explorer-state-v2';
const MIN_COL_WIDTH = 60;

// Frozen columns (always visible and sticky on left, in order)
// These are rendered separately and cannot be hidden or reordered
const FROZEN_COLUMNS: Set<ColumnId> = new Set(['crop', 'id', 'bed']);

// All available columns (frozen columns first, then the rest)
const ALL_COLUMNS = [
  'crop',
  'id',
  'bed',
  'beds',
  'category',
  'identifier',
  'fieldStartDate',
  'ghDate',
  'harvestStart',
  'harvestEnd',
  'bedFeet',
  'rows',
  'spacing',
  'plants',
  'dtm',
  'harvestWindow',
  'daysInField',
  'daysInCells',
  'revenue',
  'revenuePerFt',
  'maxYieldPerWeek',
  'minYieldPerWeek',
  'method',
  'growingStructure',
  'seedSource',
  'sequence',
  'seqNum',
  'notes',
  'failed',
  'actualGhDate',
  'actualFieldDate',
  'addlDaysHarvest',
  'addlDaysField',
  'addlDaysCells',
  'gddTiming',
  'yieldFactor',
  'specId',
  'lastModified',
] as const;

type ColumnId = (typeof ALL_COLUMNS)[number];

// Default visible columns (frozen columns always included)
const DEFAULT_VISIBLE: ColumnId[] = [
  'crop',
  'id',
  'bed',
  'category',
  'fieldStartDate',
  'ghDate',
  'bedFeet',
  'method',
  'sequence',
  'notes',
  'failed',
];

// Default column widths
const DEFAULT_WIDTHS: Partial<Record<ColumnId, number>> = {
  crop: 180,
  category: 100,
  identifier: 200,
  fieldStartDate: 110,
  ghDate: 110,
  harvestStart: 110,
  harvestEnd: 110,
  bed: 90,
  beds: 120,
  bedFeet: 70,
  rows: 60,
  spacing: 70,
  plants: 70,
  dtm: 60,
  harvestWindow: 80,
  daysInField: 80,
  daysInCells: 80,
  revenue: 90,
  revenuePerFt: 80,
  maxYieldPerWeek: 140,
  minYieldPerWeek: 140,
  method: 100,
  growingStructure: 100,
  seedSource: 150,
  sequence: 80,
  seqNum: 60,
  notes: 200,
  failed: 60,
  actualGhDate: 110,
  actualFieldDate: 110,
  addlDaysHarvest: 80,
  addlDaysField: 80,
  addlDaysCells: 80,
  gddTiming: 70,
  yieldFactor: 70,
  id: 80,
  specId: 200,
  lastModified: 140,
};

// Column headers
const COLUMN_HEADERS: Record<ColumnId, string> = {
  crop: 'Crop',
  category: 'Category',
  identifier: 'Identifier',
  fieldStartDate: 'Field Date',
  ghDate: 'GH Date',
  harvestStart: 'Harvest Start',
  harvestEnd: 'Harvest End',
  bed: 'Bed',
  beds: 'Beds',
  bedFeet: 'Feet',
  rows: 'Rows',
  spacing: 'Spacing',
  plants: 'Plants',
  dtm: 'DTM',
  harvestWindow: 'Harvest Days',
  daysInField: 'Field Days',
  daysInCells: 'Cell Days',
  revenue: 'Revenue',
  revenuePerFt: '$/Ft',
  maxYieldPerWeek: 'Max Yield/Wk',
  minYieldPerWeek: 'Min Yield/Wk',
  method: 'Method',
  growingStructure: 'Structure',
  seedSource: 'Seed Source',
  sequence: 'Sequence',
  seqNum: 'Seq #',
  notes: 'Notes',
  failed: 'Failed',
  actualGhDate: 'Actual GH',
  actualFieldDate: 'Actual Field',
  addlDaysHarvest: '+Harvest',
  addlDaysField: '+Field',
  addlDaysCells: '+Cells',
  gddTiming: 'GDD',
  yieldFactor: 'Yield %',
  id: 'ID',
  specId: 'Config ID',
  lastModified: 'Modified',
};

// Sortable columns
const SORTABLE_COLUMNS: Set<ColumnId> = new Set([
  'crop', 'category', 'identifier', 'fieldStartDate', 'ghDate',
  'harvestStart', 'harvestEnd', 'bed', 'bedFeet', 'dtm',
  'harvestWindow', 'daysInField', 'daysInCells', 'revenue', 'revenuePerFt',
  'method', 'growingStructure', 'id', 'specId', 'lastModified',
]);

// Editable columns (have inline editing or interactive controls)
const EDITABLE_COLUMNS: Set<ColumnId> = new Set([
  'fieldStartDate', 'bed', 'bedFeet', 'notes', 'failed',
  'actualGhDate', 'actualFieldDate',
  'addlDaysHarvest', 'addlDaysField', 'addlDaysCells',
]);

type SortDirection = 'asc' | 'desc';

type AssignmentFilter = 'all' | 'assigned' | 'unassigned';

interface PersistedState {
  sortColumn: ColumnId;
  sortDirection: SortDirection;
  searchQuery?: string; // Optional - moved to UI store for cross-view sharing
  assignmentFilter: AssignmentFilter;
  showFailed: boolean;
  columnOrder: ColumnId[];
  columnWidths: Partial<Record<ColumnId, number>>;
  visibleColumns: ColumnId[];
}

function loadPersistedState(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return null;
}

function savePersistedState(state: PersistedState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

// =============================================================================
// Toast Component
// =============================================================================

function Toast({ message, type, onClose }: { message: string; type: 'error' | 'success' | 'info'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-green-600' : 'bg-blue-600';

  return (
    <div
      className={`fixed bottom-4 right-4 ${bgColor} text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up text-sm`}
      style={{ zIndex: Z_INDEX.TOAST }}
    >
      <span>{message}</span>
      <button onClick={onClose} className="text-white/80 hover:text-white">&times;</button>
    </div>
  );
}

// =============================================================================
// Inline Editable Cell
// =============================================================================

interface InlineCellProps {
  value: string;
  displayValue?: string;
  onSave: (newValue: string) => void;
  type?: 'text' | 'date' | 'number';
  className?: string;
  inputClassName?: string;
  min?: number;
  step?: number;
  placeholder?: string;
}

function InlineCell({
  value,
  displayValue,
  onSave,
  type = 'text',
  className = '',
  inputClassName = '',
  min,
  step,
  placeholder,
}: InlineCellProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleBlur = () => {
    setEditing(false);
    if (editValue !== value) {
      onSave(editValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setEditValue(value);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        min={min}
        step={step}
        placeholder={placeholder}
        className={`w-full px-1 py-0.5 text-sm border border-blue-500 rounded focus:outline-none ${inputClassName}`}
      />
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className={`cursor-text hover:bg-blue-50 rounded truncate ${className}`}
    >
      {displayValue || value || <span className="text-gray-400">{placeholder || '—'}</span>}
    </div>
  );
}

// =============================================================================
// Bed Selector Dropdown
// =============================================================================

interface BedSelectorProps {
  value: string | null;
  beds: Record<string, { id: string; name: string; groupId: string }>;
  bedGroups: Record<string, { id: string; name: string; displayOrder: number }>;
  onSelect: (bedId: string | null) => void;
}

function BedSelector({ value, beds, bedGroups, onSelect }: BedSelectorProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setFilter('');
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClick);
      // Focus input when opening
      setTimeout(() => inputRef.current?.focus(), 0);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  const handleOpen = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(!open);
    if (open) setFilter('');
  };

  const handleSelect = (bedId: string | null) => {
    onSelect(bedId);
    setOpen(false);
    setFilter('');
  };

  const currentBed = value ? beds[value] : null;

  // Filter beds by search term (case-insensitive)
  const filterLower = filter.toLowerCase();

  const groupedBeds = useMemo(() => {
    const groups: Record<string, { name: string; order: number; beds: { id: string; name: string }[] }> = {};
    for (const bed of Object.values(beds)) {
      const group = bedGroups[bed.groupId];
      if (!group) continue;
      if (!groups[bed.groupId]) {
        groups[bed.groupId] = { name: group.name, order: group.displayOrder, beds: [] };
      }
      groups[bed.groupId].beds.push({ id: bed.id, name: bed.name });
    }
    return Object.values(groups)
      .sort((a, b) => a.order - b.order)
      .map(g => ({ ...g, beds: g.beds.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }));
  }, [beds, bedGroups]);

  // Apply filter to grouped beds
  const filteredGroupedBeds = useMemo(() => {
    if (!filterLower) return groupedBeds;
    return groupedBeds
      .map(group => ({
        ...group,
        beds: group.beds.filter(bed => bed.name.toLowerCase().includes(filterLower)),
      }))
      .filter(group => group.beds.length > 0);
  }, [groupedBeds, filterLower]);

  // Check if "unassigned" matches filter
  const showUnassigned = !filterLower || 'unassigned'.includes(filterLower);

  return (
    <>
      <div ref={triggerRef} onClick={handleOpen} className="cursor-pointer hover:bg-blue-50 rounded truncate">
        {currentBed ? currentBed.name : <span className="text-amber-600 italic">Unassigned</span>}
      </div>
      {open && dropdownPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px]"
          style={{ zIndex: Z_INDEX.DROPDOWN, top: dropdownPos.top, left: dropdownPos.left }}
        >
          {/* Search input */}
          <div className="px-2 pb-1">
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search beds..."
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                  setFilter('');
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  // Select first match (unassigned if shown, otherwise first bed)
                  if (showUnassigned && filteredGroupedBeds.length === 0) {
                    handleSelect(null);
                  } else if (filteredGroupedBeds.length > 0 && filteredGroupedBeds[0].beds.length > 0) {
                    handleSelect(filteredGroupedBeds[0].beds[0].id);
                  } else if (showUnassigned) {
                    handleSelect(null);
                  }
                }
              }}
            />
          </div>
          {/* Options */}
          <div className="max-h-56 overflow-auto">
            {showUnassigned && (
              <button onClick={() => handleSelect(null)} className={`w-full text-left px-3 py-1 text-sm hover:bg-gray-100 ${!value ? 'bg-blue-50 text-blue-700' : 'text-amber-600 italic'}`}>
                Unassigned
              </button>
            )}
            {showUnassigned && filteredGroupedBeds.length > 0 && (
              <div className="border-t border-gray-100 my-1" />
            )}
            {filteredGroupedBeds.map((group) => (
              <div key={group.name}>
                <div className="px-3 py-0.5 text-xs font-medium text-gray-500 uppercase">{group.name}</div>
                {group.beds.map((bed) => (
                  <button key={bed.id} onClick={() => handleSelect(bed.id)} className={`w-full text-left px-3 py-0.5 text-sm hover:bg-gray-100 ${value === bed.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}>
                    {bed.name}
                  </button>
                ))}
              </div>
            ))}
            {!showUnassigned && filteredGroupedBeds.length === 0 && (
              <div className="px-3 py-2 text-sm text-gray-500 italic">No matches</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// =============================================================================
// Column Manager Modal
// =============================================================================

interface ColumnManagerProps {
  visibleColumns: Set<ColumnId>;
  onToggle: (col: ColumnId) => void;
  onClose: () => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

function ColumnManager({ visibleColumns, onToggle, onClose, onShowAll, onHideAll }: ColumnManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Non-frozen columns that can be toggled, sorted alphabetically by display name
  const toggleableColumns = ALL_COLUMNS
    .filter(col => !FROZEN_COLUMNS.has(col))
    .sort((a, b) => COLUMN_HEADERS[a].localeCompare(COLUMN_HEADERS[b]));

  // Filter columns based on search query
  const filteredColumns = toggleableColumns.filter((col) => {
    const header = COLUMN_HEADERS[col].toLowerCase();
    const query = searchQuery.toLowerCase();
    return header.includes(query);
  });

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }} onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-4 w-80 max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-900">Manage Columns</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
        </div>

        {/* Search bar */}
        <div className="mb-3">
          <input
            type="text"
            placeholder="Search columns..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-2 mb-3">
          <button onClick={onShowAll} className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded">Show All</button>
          <button onClick={onHideAll} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded">Hide All</button>
        </div>

        {/* Frozen columns - always visible */}
        <div className="mb-2 pb-2 border-b border-gray-100">
          <div className="text-xs text-gray-500 uppercase mb-1">Always Visible</div>
          {Array.from(FROZEN_COLUMNS).map((col) => (
            <div key={col} className="flex items-center gap-2 px-2 py-1 text-gray-400">
              <input type="checkbox" checked disabled className="rounded border-gray-300" />
              <span className="text-sm">{COLUMN_HEADERS[col]}</span>
            </div>
          ))}
        </div>

        {/* Toggleable columns */}
        <div className="space-y-1">
          {filteredColumns.length > 0 ? (
            filteredColumns.map((col) => (
              <label key={col} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={visibleColumns.has(col)}
                  onChange={() => onToggle(col)}
                  className="rounded border-gray-300 text-blue-600"
                />
                <span className="text-sm text-gray-700">{COLUMN_HEADERS[col]}</span>
              </label>
            ))
          ) : (
            <div className="px-2 py-3 text-sm text-gray-500 text-center">
              No columns found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Enriched Planting Type
// =============================================================================

interface EnrichedPlanting extends Planting {
  cropName: string;
  category: string;
  identifier: string;
  bedName: string;
  bedsDisplay: string;  // All beds spanned, e.g. "A1, A2, A3 (12')"
  isUnassigned: boolean;
  isFailed: boolean;
  dtm: number;
  harvestWindow: number;
  method: string;
  rows: number | null;
  spacing: number | null;
  plants: number | null;
  seedSourceDisplay: string;
  sequenceDisplay: string;  // Sequence ID (e.g. "S1") or empty
  seqNum: number | null;    // Position in sequence (1-based) or null
  ghDate: string | null;
  harvestStart: string | null;
  harvestEnd: string | null;
  growingStructure: string;  // field, greenhouse, high-tunnel
  daysInField: number;       // Days the crop occupies the field
  daysInCells: number;       // Days in greenhouse cells (transplants)
  revenue: number | null;    // Expected revenue for this planting
  revenuePerFt: number | null; // Revenue per bed foot
  maxYieldPerWeek: string;   // Max yield/week display string (e.g. "2.5 lb/wk")
  minYieldPerWeek: string;   // Min yield/week display string (e.g. "1.8 lb/wk")
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract date strings from a TimelineCrop for grid display.
 * Converts ISO datetime → date string, handles null crops gracefully.
 */
function extractDatesFromTimelineCrop(crop: TimelineCrop | undefined): {
  fieldStartDate: string;
  ghDate: string | null;
  harvestStart: string | null;
  harvestEnd: string | null;
  method: string;
} {
  if (!crop) {
    return {
      fieldStartDate: '',
      ghDate: null,
      harvestStart: null,
      harvestEnd: null,
      method: 'DS',
    };
  }

  // Extract date from ISO datetime (yyyy-MM-ddTHH:mm:ss → yyyy-MM-dd)
  const extractDate = (isoDateTime: string | undefined): string | null => {
    if (!isoDateTime) return null;
    return isoDateTime.split('T')[0];
  };

  // IMPORTANT: TimelineCrop.startDate is the FIELD date (tpOrDsDate from timing calculator)
  // This is the effective field date, accounting for sequences and actuals
  const fieldStartDate = extractDate(crop.startDate) || '';

  // GH date is not directly on TimelineCrop - it needs to be computed from timing
  // For now we'll set to null and rely on raw planting data for actuals
  const ghDate = null;

  const harvestStart = extractDate(crop.harvestStartDate);
  const harvestEnd = extractDate(crop.endDate);

  // Map plantingMethod to display format
  const methodMap = {
    'transplant': 'TP',
    'direct-seed': 'DS',
    'perennial': 'P',
  };
  const method = methodMap[crop.plantingMethod || 'direct-seed'] || 'DS';

  return { fieldStartDate, ghDate, harvestStart, harvestEnd, method };
}

/**
 * Format bed span from TimelineCrop[] (one per bed).
 * Returns "A1, A2, A3 (12')" format where last bed shows feet if partial.
 */
function formatBedSpan(crops: TimelineCrop[]): string {
  if (crops.length === 0) return '';

  const sorted = [...crops].sort((a, b) => a.bedIndex - b.bedIndex);

  const parts = sorted.map((crop, idx) => {
    const bedLength = crop.bedCapacityFt || 50;
    const isPartial = (crop.feetUsed || bedLength) < bedLength;
    const isLast = idx === sorted.length - 1;

    if (isLast && isPartial) {
      return `${crop.resource} (${crop.feetUsed}')`;
    }
    return crop.resource;
  });

  return parts.join(', ');
}

/**
 * Calculate plant count: (bedFeet * 12 / spacing) * rows
 */
function calculatePlantCount(
  bedFeet: number,
  rows: number | undefined,
  spacing: number | undefined
): number | null {
  if (!rows || !spacing || spacing === 0) return null;
  return Math.round((bedFeet * 12 / spacing) * rows);
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function PlantingsPage() {
  const params = useParams();
  const planId = params.planId as string;

  const {
    currentPlan,
    loadPlanById,
    updatePlanting,
    updateCropDates,
    bulkDeletePlantings,
  } = usePlanStore();

  const [isLoading, setIsLoading] = useState(true);
  const [showColumnManager, setShowColumnManager] = useState(false);

  // Toast notifications - shared across views via UI store
  const toast = useUIStore((state) => state.toast);
  const setToast = useUIStore((state) => state.setToast);

  // Column state
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>([...ALL_COLUMNS]);
  const [columnWidths, setColumnWidths] = useState<Partial<Record<ColumnId, number>>>({});
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(new Set(DEFAULT_VISIBLE));

  // Sorting and filtering state
  const [sortColumn, setSortColumn] = useState<ColumnId>('fieldStartDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('all');
  const [showFailed, setShowFailed] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  // Search state - shared across views via UI store
  const searchQuery = useUIStore((state) => state.searchQuery);
  const setSearchQuery = useUIStore((state) => state.setSearchQuery);

  // Selection state - shared across Timeline and Plantings views via UI store
  const selectedIds = useUIStore((state) => state.selectedPlantingIds);
  const togglePlanting = useUIStore((state) => state.togglePlanting);
  const clearSelectionStore = useUIStore((state) => state.clearSelection);
  const selectAll = useUIStore((state) => state.selectMultiple);

  // Drag state for column reordering
  const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);
  const dragOverColumnRef = useRef<ColumnId | null>(null); // Track current value to avoid redundant state updates
  const dragPreviewRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Resize state
  const [resizingColumn, setResizingColumn] = useState<ColumnId | null>(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(0);

  // Load persisted state
  useEffect(() => {
    const persisted = loadPersistedState();
    if (persisted) {
      setSortColumn(persisted.sortColumn);
      setSortDirection(persisted.sortDirection);
      // searchQuery removed - now in UI store (shared across views)
      // Handle migration from old showUnassigned boolean to new assignmentFilter
      if ('assignmentFilter' in persisted) {
        setAssignmentFilter(persisted.assignmentFilter);
      } else if ('showUnassigned' in persisted) {
        // Migrate old format: showUnassigned=true -> 'all', showUnassigned=false -> 'assigned'
        setAssignmentFilter((persisted as { showUnassigned: boolean }).showUnassigned ? 'all' : 'assigned');
      }
      setShowFailed(persisted.showFailed);
      if (persisted.columnOrder) {
        const validOrder = persisted.columnOrder.filter((c): c is ColumnId => ALL_COLUMNS.includes(c as ColumnId));
        ALL_COLUMNS.forEach(c => { if (!validOrder.includes(c)) validOrder.push(c); });
        setColumnOrder(validOrder);
      }
      if (persisted.columnWidths) setColumnWidths(persisted.columnWidths);
      if (persisted.visibleColumns) setVisibleColumns(new Set(persisted.visibleColumns));
    }
    setHydrated(true);
  }, []);

  // Save state changes
  useEffect(() => {
    if (!hydrated) return;
    savePersistedState({
      sortColumn,
      sortDirection,
      // searchQuery removed - now in UI store (shared across views)
      assignmentFilter,
      showFailed,
      columnOrder,
      columnWidths,
      visibleColumns: Array.from(visibleColumns) as ColumnId[],
    });
  }, [hydrated, sortColumn, sortDirection, assignmentFilter, showFailed, columnOrder, columnWidths, visibleColumns]);

  // Load plan on mount
  useEffect(() => {
    if (planId) {
      loadPlanById(planId).finally(() => setIsLoading(false));
    }
  }, [planId, loadPlanById]);


  // Lookups
  const bedsLookup = useMemo(() => currentPlan?.beds ?? {}, [currentPlan?.beds]);
  const bedGroupsLookup = useMemo(() => currentPlan?.bedGroups ?? {}, [currentPlan?.bedGroups]);
  const catalogLookup = useMemo(() => currentPlan?.specs ?? {}, [currentPlan?.specs]);
  const varietiesLookup = useMemo(() => currentPlan?.varieties ?? {}, [currentPlan?.varieties]);
  const seedMixesLookup = useMemo(() => currentPlan?.seedMixes ?? {}, [currentPlan?.seedMixes]);
  const productsLookup = useMemo(() => currentPlan?.products ?? {}, [currentPlan?.products]);

  // Get column width
  const getColumnWidth = useCallback((col: ColumnId) => {
    return columnWidths[col] ?? DEFAULT_WIDTHS[col] ?? 100;
  }, [columnWidths]);

  // Get computed crops from centralized hook (includes GDD adjustments)
  const { crops: timelineCrops } = useComputedCrops();

  // Group TimelineCrop[] by planting ID (groupId)
  const cropsByPlanting = useMemo(() => {
    const groups = new Map<string, TimelineCrop[]>();
    for (const crop of timelineCrops) {
      if (!groups.has(crop.groupId)) {
        groups.set(crop.groupId, []);
      }
      groups.get(crop.groupId)!.push(crop);
    }
    return groups;
  }, [timelineCrops]);

  // Enrich plantings with computed data
  const enrichedPlantings = useMemo((): EnrichedPlanting[] => {
    if (!currentPlan?.plantings) return [];

    return currentPlan.plantings.map((p) => {
      // Get all TimelineCrop entries for this planting (one per bed)
      const cropsForPlanting = cropsByPlanting.get(p.id) || [];
      const firstCrop = cropsForPlanting[0]; // Dates same across all beds

      // Get spec for lookup fields
      const spec = catalogLookup[p.specId] as PlantingSpec | undefined;
      const bed = p.startBed ? bedsLookup[p.startBed] : null;

      // Extract pre-computed dates from TimelineCrop
      const dates = extractDatesFromTimelineCrop(firstCrop);

      // Lookup spec timing values (for display columns, not for date calculation)
      const dtm = spec ? getPrimarySeedToHarvest(spec) : 0;
      const harvestWindow = spec ? calculateAggregateHarvestWindow(spec) : 0;

      // Seed source display
      let seedSourceDisplay = '';
      if (p.seedSource) {
        if (p.seedSource.type === 'variety') {
          const variety = varietiesLookup[p.seedSource.id];
          seedSourceDisplay = variety?.name ?? p.seedSource.id;
        } else if (p.seedSource.type === 'mix') {
          const mix = seedMixesLookup[p.seedSource.id];
          seedSourceDisplay = mix?.name ?? p.seedSource.id;
        }
      } else if (spec?.defaultSeedSource) {
        if (spec.defaultSeedSource.type === 'variety') {
          const variety = varietiesLookup[spec.defaultSeedSource.id];
          seedSourceDisplay = variety?.name ?? spec.defaultSeedSource.id;
        } else if (spec.defaultSeedSource.type === 'mix') {
          const mix = seedMixesLookup[spec.defaultSeedSource.id];
          seedSourceDisplay = mix?.name ?? spec.defaultSeedSource.id;
        }
      }

      // Plant count calculation
      const plants = calculatePlantCount(p.bedFeet, spec?.rows, spec?.spacing);

      // Beds display (formatted from TimelineCrop span)
      const bedsDisplay = formatBedSpan(cropsForPlanting);

      // Sequence display: show clean sequence ID (S1, S2, etc.)
      // seqNum: 1-based slot number in sequence (sparse - can have gaps)
      let sequenceDisplay = '';
      let seqNum: number | null = null;
      if (p.sequenceId !== undefined) {
        sequenceDisplay = p.sequenceId;
        if (p.sequenceSlot !== undefined) {
          seqNum = p.sequenceSlot + 1;
        }
      }

      // Calculate timing and revenue fields
      const daysInField = spec ? calculateFieldOccupationDays(spec) : 0;
      const daysInCells = spec ? calculateDaysInCells(spec) : 0;
      const revenue = spec ? calculateSpecRevenue(spec, p.bedFeet, productsLookup) : null;
      const revenuePerFt = revenue !== null && p.bedFeet > 0 ? revenue / p.bedFeet : null;

      // Calculate yield per week (uses actual planting bedFeet)
      const yieldPerWeek = spec ? calculateYieldPerWeek(spec, p.bedFeet, productsLookup) : null;

      return {
        ...p,
        // From TimelineCrop (pre-computed dates)
        ...dates,
        dtm,
        harvestWindow,

        // From spec lookup
        cropName: spec?.crop ?? p.specId,
        category: spec?.category ?? '',
        identifier: spec?.identifier ?? p.specId,
        rows: spec?.rows ?? null,
        spacing: spec?.spacing ?? null,
        growingStructure: spec?.growingStructure ?? 'field',

        // From bed lookup
        bedName: bed?.name ?? '',

        // Computed PlantingsPage-specific fields
        bedsDisplay,
        plants,
        seedSourceDisplay,
        sequenceDisplay,
        seqNum,
        isUnassigned: !p.startBed,
        isFailed: p.actuals?.failed ?? false,

        // Timing and revenue
        daysInField,
        daysInCells,
        revenue,
        revenuePerFt,

        // Yield per week
        maxYieldPerWeek: yieldPerWeek?.displayMax ?? '',
        minYieldPerWeek: yieldPerWeek?.displayMin ?? '',
      };
    });
  }, [currentPlan?.plantings, cropsByPlanting, catalogLookup, bedsLookup, varietiesLookup, seedMixesLookup, productsLookup]);

  // Display columns (visible and ordered)
  const displayColumns = useMemo(() => {
    return columnOrder.filter(col => visibleColumns.has(col));
  }, [columnOrder, visibleColumns]);

  // ==========================================================================
  // SEARCH DSL: Parse search query (matches CropTimeline behavior)
  // Supports: field:value, -field:value (negation), -term (plain negation)
  // Fields: bed, group, category, method, crop, notes, structure
  // Sort: s:column or s:column:desc (matches CropTimeline DSL)
  // ==========================================================================
  const { filterTerms: parsedFilterTerms, sortOverride } = useMemo(() => {
    const parsed = parseSearchQuery<ColumnId>(searchQuery, SORTABLE_COLUMNS);
    const sortOverride = parsed.sortField
      ? { column: parsed.sortField, direction: parsed.sortDir }
      : null;
    return { filterTerms: parsed.filterTerms, sortOverride };
  }, [searchQuery]);

  // Filter and sort plantings
  const displayPlantings = useMemo(() => {
    let result = enrichedPlantings;

    // Apply assignment filter
    if (assignmentFilter === 'assigned') result = result.filter((p) => !p.isUnassigned);
    else if (assignmentFilter === 'unassigned') result = result.filter((p) => p.isUnassigned);
    // 'all' shows everything

    if (!showFailed) result = result.filter((p) => !p.isFailed);

    // Apply search DSL filter using shared matcher
    if (parsedFilterTerms.length > 0) {
      result = result.filter((p) => matchesFilter(p, parsedFilterTerms, enrichedPlantingSearchConfig));
    }

    // Use sortOverride from search DSL if present, otherwise use state
    const effectiveSortColumn = sortOverride?.column ?? sortColumn;
    const effectiveSortDirection = sortOverride?.direction ?? sortDirection;

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (effectiveSortColumn) {
        case 'crop': cmp = a.cropName.localeCompare(b.cropName); break;
        case 'category': cmp = a.category.localeCompare(b.category); break;
        case 'identifier': cmp = a.identifier.localeCompare(b.identifier); break;
        case 'fieldStartDate': cmp = a.fieldStartDate.localeCompare(b.fieldStartDate); break;
        case 'ghDate': cmp = (a.ghDate ?? '').localeCompare(b.ghDate ?? ''); break;
        case 'harvestStart': cmp = (a.harvestStart ?? '').localeCompare(b.harvestStart ?? ''); break;
        case 'harvestEnd': cmp = (a.harvestEnd ?? '').localeCompare(b.harvestEnd ?? ''); break;
        case 'bed': cmp = (a.bedName || 'zzz').localeCompare(b.bedName || 'zzz'); break;
        case 'bedFeet': cmp = a.bedFeet - b.bedFeet; break;
        case 'dtm': cmp = a.dtm - b.dtm; break;
        case 'harvestWindow': cmp = a.harvestWindow - b.harvestWindow; break;
        case 'daysInField': cmp = a.daysInField - b.daysInField; break;
        case 'daysInCells': cmp = a.daysInCells - b.daysInCells; break;
        case 'revenue': cmp = (a.revenue ?? 0) - (b.revenue ?? 0); break;
        case 'revenuePerFt': cmp = (a.revenuePerFt ?? 0) - (b.revenuePerFt ?? 0); break;
        case 'method': cmp = a.method.localeCompare(b.method); break;
        case 'growingStructure': cmp = a.growingStructure.localeCompare(b.growingStructure); break;
        case 'id': cmp = a.id.localeCompare(b.id); break;
        case 'specId': cmp = a.specId.localeCompare(b.specId); break;
        case 'lastModified': cmp = a.lastModified - b.lastModified; break;
      }
      return effectiveSortDirection === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [enrichedPlantings, assignmentFilter, showFailed, parsedFilterTerms, sortOverride, sortColumn, sortDirection]);

  // Inspector shows all selected plantings (like Timeline)
  const inspectedCrops: TimelineCrop[] = useMemo(() => {
    if (selectedIds.size === 0) return [];

    const allCrops: TimelineCrop[] = [];
    selectedIds.forEach(id => {
      if (cropsByPlanting.has(id)) {
        allCrops.push(...cropsByPlanting.get(id)!);
      }
    });
    return allCrops;
  }, [selectedIds, cropsByPlanting]);

  // Compute used variety and mix IDs for seed source picker
  const { usedVarietyIds, usedMixIds } = useMemo(() => {
    const varietyIds = new Set<string>();
    const mixIds = new Set<string>();

    for (const planting of displayPlantings) {
      if (planting.seedSource) {
        if (planting.seedSource.type === 'variety') {
          varietyIds.add(planting.seedSource.id);
        } else if (planting.seedSource.type === 'mix') {
          mixIds.add(planting.seedSource.id);
        }
      }
    }

    return { usedVarietyIds: varietyIds, usedMixIds: mixIds };
  }, [displayPlantings]);

  // Handlers
  const handleSort = (col: ColumnId) => {
    if (!SORTABLE_COLUMNS.has(col)) return;
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const handleDateChange = useCallback(async (plantingId: string, newDate: string) => {
    try {
      await updateCropDates(plantingId, newDate + 'T00:00:00', '');
    } catch {
      setToast({ message: 'Failed to update date', type: 'error' });
    }
  }, [updateCropDates]);

  const handleBedChange = useCallback(async (plantingId: string, newBedId: string | null) => {
    try {
      await updatePlanting(plantingId, { startBed: newBedId });
    } catch {
      setToast({ message: 'Failed to update bed', type: 'error' });
    }
  }, [updatePlanting]);

  const handleFeetChange = useCallback(async (plantingId: string, newFeet: string) => {
    const feet = parseInt(newFeet, 10);
    if (isNaN(feet) || feet < 1) return;

    const result = await updatePlanting(plantingId, { bedFeet: feet });
    if (!result.success) {
      setToast({ message: result.error, type: 'error' });
    }
  }, [updatePlanting]);

  const handleNotesChange = useCallback(async (plantingId: string, notes: string) => {
    try {
      await updatePlanting(plantingId, { notes: notes || undefined });
    } catch {
      setToast({ message: 'Failed to update notes', type: 'error' });
    }
  }, [updatePlanting]);

  const handleFailedToggle = useCallback(async (plantingId: string, failed: boolean) => {
    try {
      const planting = currentPlan?.plantings?.find(p => p.id === plantingId);
      await updatePlanting(plantingId, { actuals: { ...planting?.actuals, failed } });
    } catch {
      setToast({ message: 'Failed to update', type: 'error' });
    }
  }, [updatePlanting, currentPlan?.plantings]);

  const handleGddTimingToggle = useCallback(async (plantingId: string, useGddTiming: boolean) => {
    try {
      await updatePlanting(plantingId, { useGddTiming });
    } catch {
      setToast({ message: 'Failed to update', type: 'error' });
    }
  }, [updatePlanting]);

  const handleYieldFactorChange = useCallback(async (plantingId: string, yieldFactor: number) => {
    try {
      await updatePlanting(plantingId, { yieldFactor });
    } catch {
      setToast({ message: 'Failed to update', type: 'error' });
    }
  }, [updatePlanting]);

  const handleActualDateChange = useCallback(async (plantingId: string, field: 'greenhouseDate' | 'fieldDate', value: string) => {
    try {
      const planting = currentPlan?.plantings?.find(p => p.id === plantingId);
      await updatePlanting(plantingId, {
        actuals: { ...planting?.actuals, [field]: value || undefined }
      });
    } catch {
      setToast({ message: 'Failed to update', type: 'error' });
    }
  }, [updatePlanting, currentPlan?.plantings]);

  const handleOverrideChange = useCallback(async (
    plantingId: string,
    field: 'additionalDaysOfHarvest' | 'additionalDaysInField' | 'additionalDaysInCells',
    value: string
  ) => {
    try {
      const planting = currentPlan?.plantings?.find(p => p.id === plantingId);
      const numValue = parseInt(value, 10);
      await updatePlanting(plantingId, {
        overrides: { ...planting?.overrides, [field]: isNaN(numValue) ? undefined : numValue }
      });
    } catch {
      setToast({ message: 'Failed to update', type: 'error' });
    }
  }, [updatePlanting, currentPlan?.plantings]);

  const handleRowClick = useCallback((plantingId: string, _event: React.MouseEvent) => {
    // Plantings view: simple toggle behavior (no Ctrl needed for multi-select)
    // Each click just toggles the item in/out of selection
    togglePlanting(plantingId);
  }, [togglePlanting]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} planting(s)?`)) return;
    try {
      const deletedCount = await bulkDeletePlantings(Array.from(selectedIds));
      clearSelectionStore();
      setToast({ message: `Deleted ${deletedCount} planting(s)`, type: 'success' });
    } catch {
      setToast({ message: 'Failed to delete', type: 'error' });
    }
  }, [selectedIds, bulkDeletePlantings, clearSelectionStore]);

  const toggleSelection = useCallback((id: string) => {
    togglePlanting(id);
  }, [togglePlanting]);

  const selectAllPlantings = useCallback(() => {
    selectAll(displayPlantings.map((p) => p.id));
  }, [selectAll, displayPlantings]);

  const clearSelection = useCallback(() => {
    clearSelectionStore();
  }, [clearSelectionStore]);

  // Column visibility
  const toggleColumnVisibility = (col: ColumnId) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  };

  // Auto-scroll while dragging near edges
  const SCROLL_EDGE_SIZE = 200; // pixels from edge to trigger scroll
  const SCROLL_SPEED = 8; // pixels per frame
  const scrollDirectionRef = useRef<'left' | 'right' | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const scrollLoop = useCallback(() => {
    const container = scrollContainerRef.current;
    const direction = scrollDirectionRef.current;
    if (!container || !direction) return;

    container.scrollLeft += direction === 'right' ? SCROLL_SPEED : -SCROLL_SPEED;
    rafIdRef.current = requestAnimationFrame(scrollLoop);
  }, []);

  const stopAutoScroll = useCallback(() => {
    scrollDirectionRef.current = null;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const startAutoScroll = useCallback((direction: 'left' | 'right') => {
    if (scrollDirectionRef.current === direction) return; // Already scrolling this direction
    scrollDirectionRef.current = direction;
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(scrollLoop);
    }
  }, [scrollLoop]);

  // Cleanup auto-scroll on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Column drag handlers
  const handleDragStart = (e: React.DragEvent, col: ColumnId) => {
    setDraggedColumn(col);
    e.dataTransfer.effectAllowed = 'move';
    // Hide default drag image by using a transparent 1x1 pixel
    const emptyImg = new Image();
    emptyImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(emptyImg, 0, 0);
    // Set initial preview position using transform (GPU-accelerated, no reflow)
    if (dragPreviewRef.current) {
      dragPreviewRef.current.style.transform = `translate(${e.clientX + 12}px, ${e.clientY - 16}px) rotate(-2deg)`;
    }
  };

  // Use document dragover for smooth drag preview tracking and edge scrolling
  useEffect(() => {
    if (!draggedColumn) return;
    const handleDocumentDragOver = (e: DragEvent) => {
      // Update drag preview position
      if (dragPreviewRef.current) {
        dragPreviewRef.current.style.transform = `translate(${e.clientX + 12}px, ${e.clientY - 16}px) rotate(-2deg)`;
      }

      // Auto-scroll when near edges
      const container = scrollContainerRef.current;
      if (!container) return;

      const mouseX = e.clientX;
      const viewportWidth = window.innerWidth;

      // Calculate left edge: right edge of frozen columns
      // Frozen columns: checkbox (32px) + crop + id + bed
      const frozenWidth = 32 + getColumnWidth('crop') + getColumnWidth('id') + getColumnWidth('bed');

      // Scroll left when within 200px of the frozen columns edge
      // Scroll right when within 200px of the right edge of the screen
      if (mouseX < frozenWidth + SCROLL_EDGE_SIZE) {
        startAutoScroll('left');
      } else if (mouseX > viewportWidth - SCROLL_EDGE_SIZE) {
        startAutoScroll('right');
      } else {
        stopAutoScroll();
      }
    };
    document.addEventListener('dragover', handleDocumentDragOver);
    return () => {
      document.removeEventListener('dragover', handleDocumentDragOver);
      stopAutoScroll();
    };
  }, [draggedColumn, startAutoScroll, stopAutoScroll, getColumnWidth]);

  const handleDragOver = (e: React.DragEvent, col: ColumnId) => {
    e.preventDefault();
    // Only update state if the value actually changed (avoids redundant re-renders)
    if (draggedColumn && draggedColumn !== col && dragOverColumnRef.current !== col) {
      dragOverColumnRef.current = col;
      setDragOverColumn(col);
    }
    // Auto-scroll is handled by the document-level dragover listener
  };

  const handleDragLeave = () => {
    // Don't clear immediately - let handleDragOver on next column handle it
    // This prevents flicker when moving between columns
  };

  const handleDrop = (e: React.DragEvent, targetCol: ColumnId) => {
    e.preventDefault();
    stopAutoScroll();
    if (draggedColumn && draggedColumn !== targetCol) {
      const newOrder = [...columnOrder];
      const draggedIdx = newOrder.indexOf(draggedColumn);
      const targetIdx = newOrder.indexOf(targetCol);
      if (draggedIdx !== -1 && targetIdx !== -1) {
        newOrder.splice(draggedIdx, 1);
        newOrder.splice(targetIdx, 0, draggedColumn);
        setColumnOrder(newOrder);
      }
    }
    setDraggedColumn(null);
    setDragOverColumn(null);
    dragOverColumnRef.current = null;
  };

  const handleDragEnd = () => {
    stopAutoScroll();
    setDraggedColumn(null);
    setDragOverColumn(null);
    dragOverColumnRef.current = null;
  };

  // Set grabbing cursor on body during drag to prevent browser resize cursor at edges
  useEffect(() => {
    if (draggedColumn) {
      document.body.style.cursor = 'grabbing';
      // Also add !important via a style element to override browser defaults
      const style = document.createElement('style');
      style.id = 'drag-cursor-override';
      style.textContent = '* { cursor: grabbing !important; }';
      document.head.appendChild(style);
      return () => {
        document.body.style.cursor = '';
        const existing = document.getElementById('drag-cursor-override');
        if (existing) existing.remove();
      };
    }
  }, [draggedColumn]);

  // Column resize handlers
  const handleResizeStart = (e: React.MouseEvent, col: ColumnId) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(col);
    setResizeStartX(e.clientX);
    setResizeStartWidth(getColumnWidth(col));
  };

  useEffect(() => {
    if (!resizingColumn) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX;
      const newWidth = Math.max(MIN_COL_WIDTH, resizeStartWidth + delta);
      setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }));
    };
    const handleMouseUp = () => setResizingColumn(null);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn, resizeStartX, resizeStartWidth]);

  // Render cell value
  const renderCellValue = (planting: EnrichedPlanting, col: ColumnId) => {
    switch (col) {
      case 'crop':
        return <span className="font-medium">{planting.cropName}</span>;
      case 'category':
        return <span className="text-gray-600">{planting.category}</span>;
      case 'identifier':
        return <span className="text-gray-600 text-xs">{planting.identifier}</span>;
      case 'fieldStartDate':
        // Use the computed field date from TimelineCrop (accounts for sequences and actuals)
        // planting.fieldStartDate is now the effective field date from ...dates spread
        return planting.fieldStartDate ? (
          <DateInputWithButtons
            value={planting.fieldStartDate.split('T')[0]}
            displayValue={format(parseISO(planting.fieldStartDate), 'MMM d')}
            onSave={(v) => handleDateChange(planting.id, v)}
          />
        ) : <span className="text-gray-300">—</span>;
      case 'ghDate':
        return planting.ghDate ? format(parseISO(planting.ghDate), 'MMM d') : <span className="text-gray-300">—</span>;
      case 'harvestStart':
        return planting.harvestStart ? format(parseISO(planting.harvestStart), 'MMM d') : <span className="text-gray-300">—</span>;
      case 'harvestEnd':
        return planting.harvestEnd ? format(parseISO(planting.harvestEnd), 'MMM d') : <span className="text-gray-300">—</span>;
      case 'bed':
        return (
          <BedSelector
            value={planting.startBed}
            beds={bedsLookup}
            bedGroups={bedGroupsLookup}
            onSelect={(bedId) => handleBedChange(planting.id, bedId)}
          />
        );
      case 'bedFeet':
        return (
          <InlineCell
            value={planting.bedFeet.toString()}
            onSave={(v) => handleFeetChange(planting.id, v)}
            type="number"
            min={1}
            step={25}
            inputClassName="text-right"
            className="text-right"
          />
        );
      case 'beds':
        return <span className="text-gray-600 truncate" title={planting.bedsDisplay}>{planting.bedsDisplay || '—'}</span>;
      case 'dtm':
        return <span className="text-gray-600">{planting.dtm || '—'}</span>;
      case 'harvestWindow':
        return <span className="text-gray-600">{planting.harvestWindow || '—'}</span>;
      case 'daysInField':
        return <span className="text-gray-600">{planting.daysInField || '—'}</span>;
      case 'daysInCells':
        return planting.daysInCells > 0
          ? <span className="text-gray-600">{planting.daysInCells}</span>
          : <span className="text-gray-300">—</span>;
      case 'revenue':
        return planting.revenue !== null
          ? <span className="text-green-700 font-medium">{formatCurrency(planting.revenue)}</span>
          : <span className="text-gray-300">—</span>;
      case 'revenuePerFt':
        return planting.revenuePerFt !== null
          ? <span className="text-green-600">${planting.revenuePerFt.toFixed(2)}</span>
          : <span className="text-gray-300">—</span>;
      case 'maxYieldPerWeek':
        return planting.maxYieldPerWeek
          ? <span className="text-gray-600 truncate" title={planting.maxYieldPerWeek}>{planting.maxYieldPerWeek}</span>
          : <span className="text-gray-300">—</span>;
      case 'minYieldPerWeek':
        return planting.minYieldPerWeek
          ? <span className="text-gray-600 truncate" title={planting.minYieldPerWeek}>{planting.minYieldPerWeek}</span>
          : <span className="text-gray-300">—</span>;
      case 'rows':
        return <span className="text-gray-600 text-right">{planting.rows ?? '—'}</span>;
      case 'spacing':
        return <span className="text-gray-600 text-right">{planting.spacing ? `${planting.spacing}"` : '—'}</span>;
      case 'plants':
        return <span className="text-gray-600 text-right">{planting.plants?.toLocaleString() ?? '—'}</span>;
      case 'method':
        return (
          <span className={`px-1.5 py-0.5 text-xs rounded ${
            planting.method === 'TP' ? 'bg-green-100 text-green-700' :
            planting.method === 'DS' ? 'bg-blue-100 text-blue-700' :
            'bg-purple-100 text-purple-700'
          }`}>
            {planting.method}
          </span>
        );
      case 'growingStructure':
        return (
          <span className={`px-1.5 py-0.5 text-xs rounded ${
            planting.growingStructure === 'greenhouse' ? 'bg-amber-100 text-amber-700' :
            planting.growingStructure === 'high-tunnel' ? 'bg-cyan-100 text-cyan-700' :
            'bg-gray-100 text-gray-600'
          }`}>
            {planting.growingStructure}
          </span>
        );
      case 'seedSource':
        return <span className="text-gray-600 truncate">{planting.seedSourceDisplay || '—'}</span>;
      case 'sequence':
        return planting.sequenceDisplay
          ? <span className="px-1.5 py-0.5 text-xs rounded bg-purple-100 text-purple-700">{planting.sequenceDisplay}</span>
          : <span className="text-gray-300">—</span>;
      case 'seqNum':
        return planting.seqNum !== null
          ? <span className="text-gray-600">#{planting.seqNum}</span>
          : <span className="text-gray-300">—</span>;
      case 'notes':
        return (
          <InlineCell
            value={planting.notes || ''}
            onSave={(v) => handleNotesChange(planting.id, v)}
            placeholder="—"
            className="text-gray-600 truncate"
          />
        );
      case 'failed':
        return (
          <input
            type="checkbox"
            checked={planting.isFailed}
            onChange={(e) => handleFailedToggle(planting.id, e.target.checked)}
            className="rounded border-gray-300 text-red-600"
          />
        );
      case 'actualGhDate':
        return (
          <DateInputWithButtons
            value={planting.actuals?.greenhouseDate?.split('T')[0] || ''}
            displayValue={planting.actuals?.greenhouseDate ? format(parseISO(planting.actuals.greenhouseDate), 'MMM d') : undefined}
            onSave={(v) => handleActualDateChange(planting.id, 'greenhouseDate', v)}
          />
        );
      case 'actualFieldDate':
        return (
          <DateInputWithButtons
            value={planting.actuals?.fieldDate?.split('T')[0] || ''}
            displayValue={planting.actuals?.fieldDate ? format(parseISO(planting.actuals.fieldDate), 'MMM d') : undefined}
            onSave={(v) => handleActualDateChange(planting.id, 'fieldDate', v)}
          />
        );
      case 'addlDaysHarvest':
        return (
          <InlineCell
            value={(planting.overrides?.additionalDaysOfHarvest ?? '').toString()}
            onSave={(v) => handleOverrideChange(planting.id, 'additionalDaysOfHarvest', v)}
            type="number"
            placeholder="—"
            className="text-right"
            inputClassName="text-right"
          />
        );
      case 'addlDaysField':
        return (
          <InlineCell
            value={(planting.overrides?.additionalDaysInField ?? '').toString()}
            onSave={(v) => handleOverrideChange(planting.id, 'additionalDaysInField', v)}
            type="number"
            placeholder="—"
            className="text-right"
            inputClassName="text-right"
          />
        );
      case 'addlDaysCells':
        return (
          <InlineCell
            value={(planting.overrides?.additionalDaysInCells ?? '').toString()}
            onSave={(v) => handleOverrideChange(planting.id, 'additionalDaysInCells', v)}
            type="number"
            placeholder="—"
            className="text-right"
            inputClassName="text-right"
          />
        );
      case 'id':
        return <span className="font-mono text-xs text-gray-400">{planting.id}</span>;
      case 'specId':
        return <span className="font-mono text-xs text-gray-400 truncate">{planting.specId}</span>;
      case 'lastModified':
        return <span className="text-xs text-gray-500">{format(new Date(planting.lastModified), 'MMM d, HH:mm')}</span>;
      case 'gddTiming':
        return (
          <input
            type="checkbox"
            checked={planting.useGddTiming ?? false}
            onChange={(e) => handleGddTimingToggle(planting.id, e.target.checked)}
            className="rounded border-gray-300 text-green-600"
          />
        );
      case 'yieldFactor':
        return (
          <InlineCell
            value={((planting.yieldFactor ?? 1) * 100).toFixed(0)}
            onSave={(v) => {
              const pct = parseFloat(v);
              if (!isNaN(pct) && pct >= 0) {
                handleYieldFactorChange(planting.id, pct / 100);
              }
            }}
            type="number"
            placeholder="100"
            className="text-right"
            inputClassName="text-right"
          />
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-51px)] flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading plantings...</div>
      </div>
    );
  }

  if (!currentPlan) {
    return (
      <div className="h-[calc(100vh-51px)] flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Plan not found</div>
      </div>
    );
  }

  const plantings = currentPlan.plantings ?? [];
  const unassignedCount = enrichedPlantings.filter((p) => p.isUnassigned).length;
  const failedCount = enrichedPlantings.filter((p) => p.isFailed).length;

  return (
    <PageLayout
      header={<AppHeader />}
      toolbar={
        <div className="px-4 py-2 flex items-center gap-4">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search plantings..."
          sortFields={['crop', 'category', 'fieldStartDate', 'ghDate', 'bed', 'bedFeet', 'revenue', 'revenuePerFt', 'method', 'growingStructure', 'id', 'specId', 'lastModified']}
          filterFields={['bed', 'group', 'bedGroup', 'category', 'method', 'crop', 'notes', 'structure']}
          width="w-64"
        />

        <div className="flex items-center gap-1 text-sm">
          <span className="text-gray-500 mr-1">Show:</span>
          <button
            onClick={() => setAssignmentFilter('all')}
            className={`px-2 py-1 rounded ${assignmentFilter === 'all' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            All
          </button>
          <button
            onClick={() => setAssignmentFilter('assigned')}
            className={`px-2 py-1 rounded ${assignmentFilter === 'assigned' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Assigned ({enrichedPlantings.length - unassignedCount})
          </button>
          <button
            onClick={() => setAssignmentFilter('unassigned')}
            className={`px-2 py-1 rounded ${assignmentFilter === 'unassigned' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Unassigned ({unassignedCount})
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showFailed} onChange={(e) => setShowFailed(e.target.checked)} className="rounded border-gray-300 text-blue-600" />
          Failed ({failedCount})
        </label>

        <button
          onClick={() => setShowColumnManager(true)}
          className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Columns ({visibleColumns.size})
        </button>

        <div className="flex-1" />

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">{selectedIds.size} selected</span>
            <button onClick={clearSelection} className="px-2 py-1 text-sm text-gray-600 hover:text-gray-900">Clear</button>
            <button onClick={handleDeleteSelected} className="px-3 py-1 text-sm text-white bg-red-600 rounded hover:bg-red-700">Delete</button>
          </div>
        )}

        <span className="text-sm text-gray-500">{displayPlantings.length} of {plantings.length}</span>
        </div>
      }
      rightPanel={
        <ConnectedPlantingInspector
          className="w-80 bg-white border-l flex flex-col shrink-0"
        />
      }
      contentClassName="bg-gray-50"
    >
      {/* Table */}
      <div ref={scrollContainerRef} className="overflow-auto">
          <table className="border-collapse text-sm" style={{ minWidth: 'max-content' }}>
          <thead className="bg-gray-100 sticky top-0" style={{ zIndex: 20 }}>
            <tr>
              {/* Checkbox - sticky */}
              <th className="w-8 px-2 py-2 border-b border-gray-200 text-center sticky left-0 bg-gray-100" style={{ zIndex: 21 }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size > 0 && selectedIds.size === displayPlantings.length}
                  onChange={(e) => e.target.checked ? selectAllPlantings() : clearSelection()}
                  className="rounded border-gray-300"
                />
              </th>
              {/* Crop column - sticky */}
              <th
                onClick={() => handleSort('crop')}
                style={{ width: getColumnWidth('crop'), minWidth: getColumnWidth('crop'), left: 32, zIndex: 21 }}
                className="px-2 py-2 text-left text-xs font-medium text-gray-600 uppercase border-b border-gray-200 cursor-pointer hover:bg-gray-200 select-none group sticky bg-gray-100"
              >
                <div className="flex items-center gap-1">
                  <span className="truncate flex-1">{COLUMN_HEADERS['crop']}</span>
                  <span className="flex-shrink-0">
                    {sortColumn === 'crop' ? (sortDirection === 'asc' ? '↑' : '↓') : <span className="text-gray-300">↕</span>}
                  </span>
                </div>
                <div
                  onMouseDown={(e) => handleResizeStart(e, 'crop')}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-400 opacity-0 group-hover:opacity-100"
                />
              </th>
              {/* ID column - sticky */}
              <th
                onClick={() => handleSort('id')}
                style={{ width: getColumnWidth('id'), minWidth: getColumnWidth('id'), left: 32 + getColumnWidth('crop'), zIndex: 21 }}
                className="px-2 py-2 text-left text-xs font-medium text-gray-600 uppercase border-b border-gray-200 cursor-pointer hover:bg-gray-200 select-none group sticky bg-gray-100"
              >
                <div className="flex items-center gap-1">
                  <span className="truncate flex-1">{COLUMN_HEADERS['id']}</span>
                  <span className="flex-shrink-0">
                    {sortColumn === 'id' ? (sortDirection === 'asc' ? '↑' : '↓') : <span className="text-gray-300">↕</span>}
                  </span>
                </div>
                <div
                  onMouseDown={(e) => handleResizeStart(e, 'id')}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-400 opacity-0 group-hover:opacity-100"
                />
              </th>
              {/* Bed column - sticky (editable) */}
              <th
                onClick={() => handleSort('bed')}
                style={{ width: getColumnWidth('bed'), minWidth: getColumnWidth('bed'), left: 32 + getColumnWidth('crop') + getColumnWidth('id'), zIndex: 21 }}
                className="px-2 py-2 text-left text-xs font-medium text-gray-300 uppercase border-b border-gray-200 border-r border-r-gray-300 cursor-pointer hover:bg-gray-700 select-none group sticky bg-gray-600"
              >
                <div className="flex items-center gap-1">
                  <span className="truncate flex-1">{COLUMN_HEADERS['bed']}</span>
                  <span className="flex-shrink-0">
                    {sortColumn === 'bed' ? (sortDirection === 'asc' ? '↑' : '↓') : <span className="text-gray-500">↕</span>}
                  </span>
                </div>
                <div
                  onMouseDown={(e) => handleResizeStart(e, 'bed')}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-400 opacity-0 group-hover:opacity-100"
                />
              </th>
              {/* Scrollable columns */}
              {displayColumns.filter(col => !FROZEN_COLUMNS.has(col)).map((col) => {
                const isEditable = EDITABLE_COLUMNS.has(col);
                return (
                  <th
                    key={col}
                    draggable
                    onDragStart={(e) => handleDragStart(e, col)}
                    onDragOver={(e) => handleDragOver(e, col)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, col)}
                    onDragEnd={handleDragEnd}
                    onClick={() => handleSort(col)}
                    style={{ width: getColumnWidth(col), minWidth: getColumnWidth(col) }}
                    className={`relative px-2 py-2 text-left text-xs font-medium uppercase border-b border-gray-200 select-none group ${
                      isEditable ? 'bg-gray-600 text-gray-300' : 'text-gray-600'
                    } ${
                      SORTABLE_COLUMNS.has(col) ? (isEditable ? 'cursor-pointer hover:bg-gray-700' : 'cursor-pointer hover:bg-gray-200') : ''
                    } ${
                      dragOverColumn === col ? 'bg-blue-100 shadow-[inset_2px_0_0_0_#3b82f6]' : ''
                    } ${
                      draggedColumn === col ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="truncate flex-1">{COLUMN_HEADERS[col]}</span>
                      {SORTABLE_COLUMNS.has(col) && (
                        <span className="flex-shrink-0">
                          {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : <span className={isEditable ? 'text-gray-500' : 'text-gray-300'}>↕</span>}
                        </span>
                      )}
                    </div>
                    {/* Resize handle */}
                    <div
                      onMouseDown={(e) => handleResizeStart(e, col)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-400 opacity-0 group-hover:opacity-100"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="bg-white">
            {displayPlantings.map((planting, index) => {
              const isSelected = selectedIds.has(planting.id);
              const rowBg = isSelected ? 'bg-blue-100' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
              return (
                <tr
                  key={planting.id}
                  className={`border-b border-gray-100 hover:bg-blue-50/50 cursor-pointer ${rowBg}`}
                  style={{ height: ROW_HEIGHT }}
                  onClick={(e) => {
                    // Don't trigger row click if clicking checkbox
                    if ((e.target as HTMLElement).closest('input[type="checkbox"]')) {
                      return;
                    }
                    handleRowClick(planting.id, e);
                  }}
                >
                  {/* Checkbox - sticky */}
                  <td className={`px-2 py-1 text-center sticky left-0 ${rowBg}`}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(planting.id)}
                      onChange={() => toggleSelection(planting.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-gray-300"
                    />
                  </td>
                  {/* Crop - sticky */}
                  <td className={`px-2 py-1 sticky ${rowBg}`} style={{ left: 32, width: getColumnWidth('crop'), minWidth: getColumnWidth('crop') }}>
                    {renderCellValue(planting, 'crop')}
                  </td>
                  {/* ID - sticky */}
                  <td className={`px-2 py-1 sticky ${rowBg}`} style={{ left: 32 + getColumnWidth('crop'), width: getColumnWidth('id'), minWidth: getColumnWidth('id') }}>
                    {renderCellValue(planting, 'id')}
                  </td>
                  {/* Bed - sticky */}
                  <td className={`px-2 py-1 sticky ${rowBg} border-r border-r-gray-200`} style={{ left: 32 + getColumnWidth('crop') + getColumnWidth('id'), width: getColumnWidth('bed'), minWidth: getColumnWidth('bed') }}>
                    {renderCellValue(planting, 'bed')}
                  </td>
                  {/* Scrollable columns */}
                  {displayColumns.filter(col => !FROZEN_COLUMNS.has(col)).map((col) => (
                    <td key={col} className="px-2 py-1" style={{ width: getColumnWidth(col), minWidth: getColumnWidth(col) }}>
                      {renderCellValue(planting, col)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {displayPlantings.length === 0 && (
              <tr>
                <td colSpan={displayColumns.length + 1} className="px-4 py-8 text-center text-gray-500">
                  {plantings.length === 0 ? 'No plantings in this plan' : 'No plantings match your filters'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Column Manager Modal */}
      {showColumnManager && (
        <ColumnManager
          visibleColumns={visibleColumns}
          onToggle={toggleColumnVisibility}
          onClose={() => setShowColumnManager(false)}
          onShowAll={() => setVisibleColumns(new Set(ALL_COLUMNS))}
          onHideAll={() => setVisibleColumns(new Set())}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Resize overlay */}
      {resizingColumn && <div className="fixed inset-0 cursor-col-resize" style={{ zIndex: Z_INDEX.RESIZE_OVERLAY ?? 9999 }} />}


      {/* Drag preview - positioned via transform for GPU-accelerated compositing */}
      {draggedColumn && createPortal(
        <div
          ref={dragPreviewRef}
          className="fixed pointer-events-none px-3 py-2 bg-white/90 border border-blue-400 rounded shadow-lg text-xs font-medium text-gray-700 uppercase will-change-transform"
          style={{
            left: 0,
            top: 0,
            zIndex: Z_INDEX.DROPDOWN + 10,
            minWidth: getColumnWidth(draggedColumn),
          }}
        >
          {COLUMN_HEADERS[draggedColumn]}
        </div>,
        document.body
      )}
    </PageLayout>
  );
}
