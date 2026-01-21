'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { parseISO, format, addDays } from 'date-fns';
import { usePlanStore } from '@/lib/plan-store';
import { Z_INDEX } from '@/lib/z-index';
import {
  calculateDaysInCells,
  calculatePlantingMethod,
  getPrimarySeedToHarvest,
  calculateAggregateHarvestWindow,
} from '@/lib/entities/crop-config';
import type { CropConfig } from '@/lib/entities/crop-config';
import type { Planting } from '@/lib/entities/planting';

// =============================================================================
// Constants
// =============================================================================

const ROW_HEIGHT = 36;
const STORAGE_KEY = 'plantings-explorer-state-v2';
const MIN_COL_WIDTH = 60;

// Frozen columns (always visible and sticky on left, in order)
// These are rendered separately and cannot be hidden or reordered
const FROZEN_COLUMNS: Set<ColumnId> = new Set(['crop', 'id']);

// All available columns (frozen columns first, then the rest)
const ALL_COLUMNS = [
  'crop',
  'id',
  'category',
  'identifier',
  'fieldStartDate',
  'ghDate',
  'harvestStart',
  'harvestEnd',
  'bed',
  'bedFeet',
  'dtm',
  'harvestWindow',
  'method',
  'seedSource',
  'notes',
  'failed',
  'actualGhDate',
  'actualFieldDate',
  'addlDaysHarvest',
  'addlDaysField',
  'addlDaysCells',
  'configId',
  'lastModified',
] as const;

type ColumnId = (typeof ALL_COLUMNS)[number];

// Default visible columns (frozen columns always included)
const DEFAULT_VISIBLE: ColumnId[] = [
  'crop',
  'id',
  'category',
  'fieldStartDate',
  'ghDate',
  'bed',
  'bedFeet',
  'method',
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
  bedFeet: 70,
  dtm: 60,
  harvestWindow: 80,
  method: 100,
  seedSource: 150,
  notes: 200,
  failed: 60,
  actualGhDate: 110,
  actualFieldDate: 110,
  addlDaysHarvest: 80,
  addlDaysField: 80,
  addlDaysCells: 80,
  id: 80,
  configId: 200,
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
  bedFeet: 'Feet',
  dtm: 'DTM',
  harvestWindow: 'Harvest Days',
  method: 'Method',
  seedSource: 'Seed Source',
  notes: 'Notes',
  failed: 'Failed',
  actualGhDate: 'Actual GH',
  actualFieldDate: 'Actual Field',
  addlDaysHarvest: '+Harvest',
  addlDaysField: '+Field',
  addlDaysCells: '+Cells',
  id: 'ID',
  configId: 'Config ID',
  lastModified: 'Modified',
};

// Sortable columns
const SORTABLE_COLUMNS: Set<ColumnId> = new Set([
  'crop', 'category', 'identifier', 'fieldStartDate', 'ghDate',
  'harvestStart', 'harvestEnd', 'bed', 'bedFeet', 'dtm',
  'harvestWindow', 'method', 'id', 'configId', 'lastModified',
]);

type SortDirection = 'asc' | 'desc';

interface PersistedState {
  sortColumn: ColumnId;
  sortDirection: SortDirection;
  searchQuery: string;
  showUnassigned: boolean;
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  const currentBed = value ? beds[value] : null;

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

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(!open)} className="cursor-pointer hover:bg-blue-50 rounded truncate">
        {currentBed ? currentBed.name : <span className="text-amber-600 italic">Unassigned</span>}
      </div>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-64 overflow-auto min-w-[140px]" style={{ zIndex: Z_INDEX.DROPDOWN }}>
          <button onClick={() => { onSelect(null); setOpen(false); }} className={`w-full text-left px-3 py-1 text-sm hover:bg-gray-100 ${!value ? 'bg-blue-50 text-blue-700' : 'text-amber-600 italic'}`}>
            Unassigned
          </button>
          <div className="border-t border-gray-100 my-1" />
          {groupedBeds.map((group) => (
            <div key={group.name}>
              <div className="px-3 py-0.5 text-xs font-medium text-gray-500 uppercase">{group.name}</div>
              {group.beds.map((bed) => (
                <button key={bed.id} onClick={() => { onSelect(bed.id); setOpen(false); }} className={`w-full text-left px-3 py-0.5 text-sm hover:bg-gray-100 ${value === bed.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}>
                  {bed.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
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
  // Non-frozen columns that can be toggled
  const toggleableColumns = ALL_COLUMNS.filter(col => !FROZEN_COLUMNS.has(col));

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }} onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-4 w-80 max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-900">Manage Columns</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
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
          {toggleableColumns.map((col) => (
            <label key={col} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
              <input
                type="checkbox"
                checked={visibleColumns.has(col)}
                onChange={() => onToggle(col)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">{COLUMN_HEADERS[col]}</span>
            </label>
          ))}
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
  isUnassigned: boolean;
  isFailed: boolean;
  dtm: number;
  harvestWindow: number;
  method: string;
  seedSourceDisplay: string;
  ghDate: string | null;
  harvestStart: string | null;
  harvestEnd: string | null;
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
    moveCrop,
    deleteCrop,
  } = usePlanStore();

  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [showColumnManager, setShowColumnManager] = useState(false);

  // Column state
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>([...ALL_COLUMNS]);
  const [columnWidths, setColumnWidths] = useState<Partial<Record<ColumnId, number>>>({});
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(new Set(DEFAULT_VISIBLE));

  // Sorting and filtering state
  const [sortColumn, setSortColumn] = useState<ColumnId>('fieldStartDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [showUnassigned, setShowUnassigned] = useState(true);
  const [showFailed, setShowFailed] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Drag state for column reordering
  const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);

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
      setSearchQuery(persisted.searchQuery);
      setShowUnassigned(persisted.showUnassigned);
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
      searchQuery,
      showUnassigned,
      showFailed,
      columnOrder,
      columnWidths,
      visibleColumns: Array.from(visibleColumns) as ColumnId[],
    });
  }, [hydrated, sortColumn, sortDirection, searchQuery, showUnassigned, showFailed, columnOrder, columnWidths, visibleColumns]);

  // Load plan on mount
  useEffect(() => {
    if (planId) {
      loadPlanById(planId).finally(() => setIsLoading(false));
    }
  }, [planId, loadPlanById]);

  // Lookups
  const bedsLookup = useMemo(() => currentPlan?.beds ?? {}, [currentPlan?.beds]);
  const bedGroupsLookup = useMemo(() => currentPlan?.bedGroups ?? {}, [currentPlan?.bedGroups]);
  const catalogLookup = useMemo(() => currentPlan?.cropCatalog ?? {}, [currentPlan?.cropCatalog]);
  const varietiesLookup = useMemo(() => currentPlan?.varieties ?? {}, [currentPlan?.varieties]);
  const seedMixesLookup = useMemo(() => currentPlan?.seedMixes ?? {}, [currentPlan?.seedMixes]);

  // Get column width
  const getColumnWidth = useCallback((col: ColumnId) => {
    return columnWidths[col] ?? DEFAULT_WIDTHS[col] ?? 100;
  }, [columnWidths]);

  // Enrich plantings with computed data
  const enrichedPlantings = useMemo((): EnrichedPlanting[] => {
    if (!currentPlan?.plantings) return [];

    return currentPlan.plantings.map((p) => {
      const config = catalogLookup[p.configId] as CropConfig | undefined;
      const bed = p.startBed ? bedsLookup[p.startBed] : null;

      // Compute timing
      const daysInCells = config ? calculateDaysInCells(config) : 0;
      const method = config ? calculatePlantingMethod(config) : 'direct-seed';
      const dtm = config ? getPrimarySeedToHarvest(config) : 0;
      const harvestWindow = config ? calculateAggregateHarvestWindow(config) : 0;

      // Compute dates
      const fieldDate = parseISO(p.fieldStartDate);
      const ghDate = method === 'transplant' && daysInCells > 0
        ? format(addDays(fieldDate, -daysInCells), 'yyyy-MM-dd')
        : null;
      const harvestStart = dtm > 0 ? format(addDays(fieldDate, dtm - daysInCells), 'yyyy-MM-dd') : null;
      const harvestEnd = harvestStart && harvestWindow > 0
        ? format(addDays(parseISO(harvestStart), harvestWindow), 'yyyy-MM-dd')
        : harvestStart;

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
      } else if (config?.defaultSeedSource) {
        if (config.defaultSeedSource.type === 'variety') {
          const variety = varietiesLookup[config.defaultSeedSource.id];
          seedSourceDisplay = variety?.name ?? config.defaultSeedSource.id;
        } else if (config.defaultSeedSource.type === 'mix') {
          const mix = seedMixesLookup[config.defaultSeedSource.id];
          seedSourceDisplay = mix?.name ?? config.defaultSeedSource.id;
        }
      }

      return {
        ...p,
        cropName: config?.crop ?? p.configId,
        category: config?.category ?? '',
        identifier: config?.identifier ?? p.configId,
        bedName: bed?.name ?? '',
        isUnassigned: !p.startBed,
        isFailed: p.actuals?.failed ?? false,
        dtm,
        harvestWindow,
        method: method === 'transplant' ? 'TP' : method === 'direct-seed' ? 'DS' : 'P',
        seedSourceDisplay,
        ghDate,
        harvestStart,
        harvestEnd,
      };
    });
  }, [currentPlan?.plantings, catalogLookup, bedsLookup, varietiesLookup, seedMixesLookup]);

  // Display columns (visible and ordered)
  const displayColumns = useMemo(() => {
    return columnOrder.filter(col => visibleColumns.has(col));
  }, [columnOrder, visibleColumns]);

  // Filter and sort plantings
  const displayPlantings = useMemo(() => {
    let result = enrichedPlantings;

    if (!showUnassigned) result = result.filter((p) => !p.isUnassigned);
    if (!showFailed) result = result.filter((p) => !p.isFailed);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) =>
        p.cropName.toLowerCase().includes(q) ||
        p.bedName.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.identifier.toLowerCase().includes(q) ||
        (p.notes?.toLowerCase().includes(q) ?? false)
      );
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
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
        case 'method': cmp = a.method.localeCompare(b.method); break;
        case 'id': cmp = a.id.localeCompare(b.id); break;
        case 'configId': cmp = a.configId.localeCompare(b.configId); break;
        case 'lastModified': cmp = a.lastModified - b.lastModified; break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [enrichedPlantings, showUnassigned, showFailed, searchQuery, sortColumn, sortDirection]);

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
      await moveCrop(plantingId, newBedId ?? '');
    } catch {
      setToast({ message: 'Failed to update bed', type: 'error' });
    }
  }, [moveCrop]);

  const handleFeetChange = useCallback(async (plantingId: string, newFeet: string) => {
    const feet = parseInt(newFeet, 10);
    if (isNaN(feet) || feet < 1) return;
    try {
      await updatePlanting(plantingId, { bedFeet: feet });
    } catch {
      setToast({ message: 'Failed to update', type: 'error' });
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

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} planting(s)?`)) return;
    try {
      for (const id of selectedIds) await deleteCrop(id);
      setSelectedIds(new Set());
      setToast({ message: `Deleted ${selectedIds.size} planting(s)`, type: 'success' });
    } catch {
      setToast({ message: 'Failed to delete', type: 'error' });
    }
  }, [selectedIds, deleteCrop]);

  // Selection
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(displayPlantings.map((p) => p.id)));
  const clearSelection = () => setSelectedIds(new Set());

  // Column visibility
  const toggleColumnVisibility = (col: ColumnId) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  };

  // Column drag handlers
  const handleDragStart = (e: React.DragEvent, col: ColumnId) => {
    setDraggedColumn(col);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, col: ColumnId) => {
    e.preventDefault();
    if (draggedColumn && draggedColumn !== col) setDragOverColumn(col);
  };
  const handleDragLeave = () => setDragOverColumn(null);
  const handleDrop = (e: React.DragEvent, targetCol: ColumnId) => {
    e.preventDefault();
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
  };
  const handleDragEnd = () => { setDraggedColumn(null); setDragOverColumn(null); };

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
        return (
          <InlineCell
            value={planting.fieldStartDate.split('T')[0]}
            displayValue={format(parseISO(planting.fieldStartDate), 'MMM d')}
            onSave={(v) => handleDateChange(planting.id, v)}
            type="date"
          />
        );
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
      case 'dtm':
        return <span className="text-gray-600">{planting.dtm || '—'}</span>;
      case 'harvestWindow':
        return <span className="text-gray-600">{planting.harvestWindow || '—'}</span>;
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
      case 'seedSource':
        return <span className="text-gray-600 truncate">{planting.seedSourceDisplay || '—'}</span>;
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
          <InlineCell
            value={planting.actuals?.greenhouseDate?.split('T')[0] || ''}
            displayValue={planting.actuals?.greenhouseDate ? format(parseISO(planting.actuals.greenhouseDate), 'MMM d') : undefined}
            onSave={(v) => handleActualDateChange(planting.id, 'greenhouseDate', v)}
            type="date"
            placeholder="—"
          />
        );
      case 'actualFieldDate':
        return (
          <InlineCell
            value={planting.actuals?.fieldDate?.split('T')[0] || ''}
            displayValue={planting.actuals?.fieldDate ? format(parseISO(planting.actuals.fieldDate), 'MMM d') : undefined}
            onSave={(v) => handleActualDateChange(planting.id, 'fieldDate', v)}
            type="date"
            placeholder="—"
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
      case 'configId':
        return <span className="font-mono text-xs text-gray-400 truncate">{planting.configId}</span>;
      case 'lastModified':
        return <span className="text-xs text-gray-500">{format(new Date(planting.lastModified), 'MMM d, HH:mm')}</span>;
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
    <div className="h-[calc(100vh-51px)] flex flex-col bg-gray-50">
      {/* Toolbar */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-4 flex-shrink-0">
        <input
          type="text"
          placeholder="Search plantings..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-64 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showUnassigned} onChange={(e) => setShowUnassigned(e.target.checked)} className="rounded border-gray-300 text-blue-600" />
          Unassigned ({unassignedCount})
        </label>

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

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-sm" style={{ minWidth: 'max-content' }}>
          <thead className="bg-gray-100 sticky top-0" style={{ zIndex: 20 }}>
            <tr>
              {/* Checkbox - sticky */}
              <th className="w-8 px-2 py-2 border-b border-gray-200 text-center sticky left-0 bg-gray-100" style={{ zIndex: 21 }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size > 0 && selectedIds.size === displayPlantings.length}
                  onChange={(e) => e.target.checked ? selectAll() : clearSelection()}
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
                className="px-2 py-2 text-left text-xs font-medium text-gray-600 uppercase border-b border-gray-200 border-r border-r-gray-300 cursor-pointer hover:bg-gray-200 select-none group sticky bg-gray-100"
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
              {/* Scrollable columns */}
              {displayColumns.filter(col => col !== 'crop' && col !== 'id').map((col) => (
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
                  className={`relative px-2 py-2 text-left text-xs font-medium text-gray-600 uppercase border-b border-gray-200 select-none group ${
                    SORTABLE_COLUMNS.has(col) ? 'cursor-pointer hover:bg-gray-200' : ''
                  } ${dragOverColumn === col ? 'bg-blue-100 border-l-2 border-l-blue-500' : ''} ${draggedColumn === col ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate flex-1">{COLUMN_HEADERS[col]}</span>
                    {SORTABLE_COLUMNS.has(col) && (
                      <span className="flex-shrink-0">
                        {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : <span className="text-gray-300">↕</span>}
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
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {displayPlantings.map((planting, index) => {
              const rowBg = selectedIds.has(planting.id) ? 'bg-blue-100' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
              return (
                <tr key={planting.id} className={`border-b border-gray-100 hover:bg-blue-50/50 ${rowBg}`} style={{ height: ROW_HEIGHT }}>
                  {/* Checkbox - sticky */}
                  <td className={`px-2 py-1 text-center sticky left-0 ${rowBg}`}>
                    <input type="checkbox" checked={selectedIds.has(planting.id)} onChange={() => toggleSelection(planting.id)} className="rounded border-gray-300" />
                  </td>
                  {/* Crop - sticky */}
                  <td className={`px-2 py-1 sticky ${rowBg}`} style={{ left: 32, width: getColumnWidth('crop'), minWidth: getColumnWidth('crop') }}>
                    {renderCellValue(planting, 'crop')}
                  </td>
                  {/* ID - sticky */}
                  <td className={`px-2 py-1 sticky ${rowBg} border-r border-r-gray-200`} style={{ left: 32 + getColumnWidth('crop'), width: getColumnWidth('id'), minWidth: getColumnWidth('id') }}>
                    {renderCellValue(planting, 'id')}
                  </td>
                  {/* Scrollable columns */}
                  {displayColumns.filter(col => col !== 'crop' && col !== 'id').map((col) => (
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
    </div>
  );
}
