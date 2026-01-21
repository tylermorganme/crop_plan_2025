'use client';

import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useVirtualizer } from '@tanstack/react-virtual';
import { format } from 'date-fns';
import type { Crop } from '@/lib/crops';
import type { Planting } from '@/lib/plan-types';
import { createPlanting } from '@/lib/entities/planting';
import { usePlanStore, type PlanSummary } from '@/lib/plan-store';
import { type CropConfig, calculatePlantingMethod } from '@/lib/entities/crop-config';
import { calculateConfigRevenue, STANDARD_BED_LENGTH } from '@/lib/revenue';
import { getMarketSplitTotal } from '@/lib/entities/market';
import CropConfigCreator from './CropConfigCreator';
import CropConfigEditor from './CropConfigEditor';
import columnAnalysis from '@/data/column-analysis.json';
import { Z_INDEX } from '@/lib/z-index';

// =============================================================================
// CONFIG VALIDATION
// =============================================================================

interface ConfigValidation {
  /** 'error' = missing required data, 'warning' = potentially misconfigured, 'ok' = all good */
  status: 'error' | 'warning' | 'ok';
  /** Human-readable issues */
  issues: string[];
}

/**
 * Validate a crop config and return status + issues.
 * Used to show visual indicators in the explorer.
 */
function validateCropConfig(crop: CropConfig): ConfigValidation {
  const issues: string[] = [];

  // Errors - missing required data
  if (!crop.identifier?.trim()) {
    issues.push('Missing identifier');
  }
  if (!crop.crop?.trim()) {
    issues.push('Missing crop name');
  }
  if (!crop.productYields || crop.productYields.length === 0) {
    issues.push('No products configured (required for timing)');
  }

  // If we have errors, return early
  if (issues.length > 0) {
    return { status: 'error', issues };
  }

  // Warnings - potentially misconfigured
  const plantingMethod = calculatePlantingMethod(crop);
  if (plantingMethod !== 'perennial' && !crop.normalMethod) {
    issues.push('DTM measurement basis not set');
  }

  if (crop.defaultMarketSplit) {
    const total = getMarketSplitTotal(crop.defaultMarketSplit);
    if (Math.abs(total - 100) >= 0.01) {
      issues.push(`Market split totals ${total}%, not 100%`);
    }
  }

  // Check for products with zero DTM
  if (crop.productYields) {
    const zeroDtm = crop.productYields.filter(py => py.dtm === 0);
    if (zeroDtm.length > 0) {
      issues.push(`${zeroDtm.length} product(s) with DTM = 0`);
    }
    // Check for products with no yield formula
    const noYield = crop.productYields.filter(py => !py.yieldFormula);
    if (noYield.length > 0) {
      issues.push(`${noYield.length} product(s) missing yield formula`);
    }
  }

  if (issues.length > 0) {
    return { status: 'warning', issues };
  }

  return { status: 'ok', issues: [] };
}

// Build a map of column header -> source type
const columnSourceTypes: Record<string, 'static' | 'calculated' | 'mixed' | 'empty'> = {};
columnAnalysis.columns.forEach((col: { header: string; type: string }) => {
  columnSourceTypes[col.header] = col.type as 'static' | 'calculated' | 'mixed' | 'empty';
});

// Get background color class based on column source type
function getColumnBgClass(col: string, isHeader: boolean = false): string {
  const type = columnSourceTypes[col];
  if (isHeader) {
    switch (type) {
      case 'static': return 'bg-blue-100';
      case 'calculated': return 'bg-green-100';
      case 'mixed': return 'bg-amber-100';
      case 'empty': return 'bg-gray-200';
      default: return 'bg-gray-50';
    }
  }
  // Lighter colors for cells
  switch (type) {
    case 'static': return 'bg-blue-50/50';
    case 'calculated': return 'bg-green-50/50';
    case 'mixed': return 'bg-amber-50/50';
    case 'empty': return 'bg-gray-100/50';
    default: return '';
  }
}

interface CropExplorerProps {
  filterOptions?: {
    crops: string[];
    categories: string[];
    growingStructures: string[];
    plantingMethods?: string[];
  };
  allHeaders?: string[];
}

// Default visible columns - using new camelCase field names from crop config
const DEFAULT_VISIBLE = [
  'identifier', 'crop', 'variant', 'product', 'category', 'growingStructure', 'normalMethod',
  'dtm', 'daysToGermination', 'daysBetweenHarvest', 'numberOfHarvests',
  'harvestBufferDays', 'yieldPerHarvest', 'yieldUnit', 'deprecated'
];

const STORAGE_KEY = 'crop-explorer-state-v5'; // Bumped for frozen columns

type SortDirection = 'asc' | 'desc' | null;
type FilterValue = string | { min?: number; max?: number } | boolean | null;

interface PersistedState {
  visibleColumns: string[];
  columnOrder: string[];
  columnWidths: Record<string, number>;
  sortColumn: string | null;
  sortDirection: SortDirection;
  filterPaneOpen: boolean;
  filterPaneWidth: number;
  scrollTop?: number;
  frozenColumnCount?: number;
  showDeprecated?: boolean;
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

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 40;
const MIN_COL_WIDTH = 50;
const DEFAULT_COL_WIDTH = 120;
const DEFAULT_FILTER_PANE_WIDTH = 280;

function getDefaultColumnWidth(col: string): number {
  if (col === 'id') return 120;
  if (col === 'identifier') return 300;
  if (['deprecated'].includes(col)) return 80;
  if (col.toLowerCase().includes('date')) return 110;
  if (col.includes('yield') || col.includes('harvest')) return 140;
  return DEFAULT_COL_WIDTH;
}

// Determine the type of a column based on its values
function getColumnType(crops: Crop[], col: string): 'boolean' | 'number' | 'categorical' | 'text' {
  const values = crops.map(c => c[col as keyof Crop]).filter(v => v !== null && v !== undefined);
  if (values.length === 0) return 'text';

  const sample = values[0];
  if (typeof sample === 'boolean') return 'boolean';
  if (typeof sample === 'number') return 'number';

  // Check if categorical (< 30 unique string values)
  const uniqueStrings = new Set(values.map(v => String(v)));
  if (uniqueStrings.size <= 30) return 'categorical';

  return 'text';
}

// Get unique values for categorical columns
function getUniqueValuesForColumn(crops: Crop[], col: string): string[] {
  const values = new Set<string>();
  crops.forEach(c => {
    const v = c[col as keyof Crop];
    if (v !== null && v !== undefined && v !== '') {
      values.add(String(v));
    }
  });
  return Array.from(values).sort();
}

// Get min/max for numeric columns
function getNumericRange(crops: Crop[], col: string): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  crops.forEach(c => {
    const v = c[col as keyof Crop];
    if (typeof v === 'number' && !isNaN(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  });
  return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 100 : max };
}

// Helper to create a Planting from a Crop config using CRUD function
function createPlantingFromConfig(crop: Crop): Planting {
  const startDate = format(new Date(), 'yyyy-MM-dd');

  return createPlanting({
    configId: crop.identifier,
    fieldStartDate: startDate,
    startBed: null, // Unassigned
    bedFeet: 50, // Default 1 bed
  });
}

export default function CropExplorer({ allHeaders }: CropExplorerProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCropId, setSelectedCropId] = useState<string | null>(null);

  // Multi-select state
  const [selectedCropIds, setSelectedCropIds] = useState<Set<string>>(new Set());

  // Add to Plan state
  const [showAddToPlan, setShowAddToPlan] = useState(false);
  const [cropsToAdd, setCropsToAdd] = useState<Crop[]>([]); // Crops to add (single or multiple)
  const [addingToPlan, setAddingToPlan] = useState(false);
  const [addToPlanMessage, setAddToPlanMessage] = useState<{ type: 'success' | 'error'; text: string; planId?: string } | null>(null);

  // Create custom config state
  const [showCreateConfig, setShowCreateConfig] = useState(false);
  const [copySourceConfig, setCopySourceConfig] = useState<Crop | null>(null);

  // Edit config state
  const [showEditConfig, setShowEditConfig] = useState(false);
  const [configToEdit, setConfigToEdit] = useState<CropConfig | null>(null);

  // Delete config state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [configsToDelete, setConfigsToDelete] = useState<Crop[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // Use shared store state - automatically syncs across tabs
  // Only subscribe to cropCatalog, not the entire plan (avoids re-renders when plantings change)
  const cropCatalog = usePlanStore((state) => state.currentPlan?.cropCatalog);
  const currentPlanId = usePlanStore((state) => state.currentPlan?.id);
  const varieties = usePlanStore((state) => state.currentPlan?.varieties);
  const seedMixes = usePlanStore((state) => state.currentPlan?.seedMixes);
  const products = usePlanStore((state) => state.currentPlan?.products);
  const markets = usePlanStore((state) => state.currentPlan?.markets);
  const catalogLoading = usePlanStore((state) => state.isLoading);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);
  const addPlanting = usePlanStore((state) => state.addPlanting);
  const updateCropConfig = usePlanStore((state) => state.updateCropConfig);
  const addCropConfig = usePlanStore((state) => state.addCropConfig);
  const deleteCropConfigs = usePlanStore((state) => state.deleteCropConfigs);
  const activePlanId = usePlanStore((state) => state.activePlanId);
  const setActivePlanId = usePlanStore((state) => state.setActivePlanId);
  const planList = usePlanStore((state) => state.planList);

  // Find active plan info from list
  const activePlan = useMemo(() => {
    if (!activePlanId) return null;
    return planList.find(p => p.id === activePlanId) ?? null;
  }, [planList, activePlanId]);

  // Convert catalog object to array for display
  const planCatalog = useMemo(() => {
    if (!cropCatalog) return [];
    return Object.values(cropCatalog) as CropConfig[];
  }, [cropCatalog]);

  // Dynamic filters keyed by column name
  const [columnFilters, setColumnFilters] = useState<Record<string, FilterValue>>({});

  // Check if a plan is properly loaded
  const isPlanLoaded = activePlanId && currentPlanId === activePlanId && planCatalog.length > 0;

  // Only use plan's catalog - never fall back to template data
  const baseCrops = useMemo(() => {
    if (isPlanLoaded) {
      return planCatalog as Crop[];
    }
    // No plan loaded - return empty array
    return [];
  }, [isPlanLoaded, planCatalog]);

  // Extend type to include computed revenue field
  type CropWithRevenue = Crop & { revenuePerBed?: number | null };

  // Enrich crops with computed revenuePerBed (revenue for a standard bed)
  const displayCrops: CropWithRevenue[] = useMemo(() => {
    if (!products || Object.keys(products).length === 0) {
      // No products loaded - return crops without revenue
      return baseCrops;
    }

    return baseCrops.map(crop => {
      const revenue = calculateConfigRevenue(crop as CropConfig, STANDARD_BED_LENGTH, products);
      return {
        ...crop,
        revenuePerBed: revenue,
      };
    });
  }, [baseCrops, products]);

  // All columns - derive from crop keys if allHeaders not provided
  // Include revenuePerBed as a computed column
  const allColumns = useMemo(() => {
    if (allHeaders && allHeaders.length > 0) {
      // Add revenuePerBed to the list if not already present
      const cols = ['id', ...allHeaders];
      if (!cols.includes('revenuePerBed')) {
        cols.push('revenuePerBed');
      }
      return cols;
    }
    // Generate headers from displayCrops fields
    const fields = new Set<string>();
    displayCrops.forEach(crop => {
      Object.keys(crop).forEach(key => fields.add(key));
    });
    // Ensure revenuePerBed is included
    fields.add('revenuePerBed');
    return Array.from(fields);
  }, [allHeaders, displayCrops]);

  // Initialize with defaults (hydration-safe), then load from localStorage
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(DEFAULT_VISIBLE));
  const [columnOrder, setColumnOrder] = useState<string[]>(allColumns);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [sortColumn, setSortColumn] = useState<string | null>('identifier');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [filterPaneOpen, setFilterPaneOpen] = useState(true);
  const [filterPaneWidth, setFilterPaneWidth] = useState(DEFAULT_FILTER_PANE_WIDTH);
  const [frozenColumnCount, setFrozenColumnCount] = useState(1); // Default: freeze first column
  const [hydrated, setHydrated] = useState(false);
  const [pendingScrollTop, setPendingScrollTop] = useState<number | null>(null);
  const scrollRestoredRef = useRef(false);

  // Load persisted state after hydration to avoid SSR mismatch
  useEffect(() => {
    const persisted = loadPersistedState();
    if (persisted) {
      setVisibleColumns(new Set(persisted.visibleColumns ?? DEFAULT_VISIBLE));
      if (persisted.columnOrder) {
        const existing = new Set(allColumns);
        const order = persisted.columnOrder.filter(c => existing.has(c));
        allColumns.forEach(c => { if (!order.includes(c)) order.push(c); });
        setColumnOrder(order);
      }
      setColumnWidths(persisted.columnWidths ?? {});
      setSortColumn(persisted.sortColumn ?? 'identifier');
      setSortDirection(persisted.sortDirection ?? 'asc');
      setFilterPaneOpen(persisted.filterPaneOpen ?? true);
      setFilterPaneWidth(persisted.filterPaneWidth ?? DEFAULT_FILTER_PANE_WIDTH);
      setFrozenColumnCount(persisted.frozenColumnCount ?? 1);
      setShowDeprecated(persisted.showDeprecated ?? false);
      // Queue scroll restoration for after render
      if (persisted.scrollTop != null && persisted.scrollTop > 0) {
        setPendingScrollTop(persisted.scrollTop);
      }
    }
    setHydrated(true);
  }, [allColumns]);

  const [showColumnManager, setShowColumnManager] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const [columnFilter, setColumnFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [sidebarColumnSearch, setSidebarColumnSearch] = useState('');

  // Show/hide deprecated crops toggle (default false, persisted)
  const [showDeprecated, setShowDeprecated] = useState(false);

  // Drag state for column reordering
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Resize state for columns
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(0);

  // Resize state for filter pane
  const [resizingPane, setResizingPane] = useState(false);
  const [paneResizeStartX, setPaneResizeStartX] = useState(0);
  const [paneResizeStartWidth, setPaneResizeStartWidth] = useState(0);

  // Persist state (only after hydration to avoid overwriting with defaults)
  useEffect(() => {
    if (!hydrated) return;
    savePersistedState({
      visibleColumns: Array.from(visibleColumns),
      columnOrder,
      columnWidths,
      sortColumn,
      sortDirection,
      filterPaneOpen,
      filterPaneWidth,
      frozenColumnCount,
      showDeprecated,
    });
  }, [hydrated, visibleColumns, columnOrder, columnWidths, sortColumn, sortDirection, filterPaneOpen, filterPaneWidth, frozenColumnCount, showDeprecated]);

  // Clear filters for hidden columns
  useEffect(() => {
    setColumnFilters(prev => {
      const next: Record<string, FilterValue> = {};
      Object.keys(prev).forEach(col => {
        if (visibleColumns.has(col)) {
          next[col] = prev[col];
        }
      });
      return next;
    });
  }, [visibleColumns]);

  // Count deprecated crops for the toggle label
  const deprecatedCount = useMemo(() => {
    return displayCrops.filter(c => c.deprecated).length;
  }, [displayCrops]);

  // Columns to display (filtered by sidebar search if active)
  const displayColumns = useMemo(() => {
    let cols = columnOrder.filter(col => visibleColumns.has(col));
    if (sidebarColumnSearch) {
      const q = sidebarColumnSearch.toLowerCase();
      cols = cols.filter(col => col.toLowerCase().includes(q));
    }
    return cols;
  }, [columnOrder, visibleColumns, sidebarColumnSearch]);

  // Compute frozen column set and left offsets
  const frozenColumns = useMemo(() => {
    return new Set(displayColumns.slice(0, frozenColumnCount));
  }, [displayColumns, frozenColumnCount]);

  // Get left offset for a frozen column (sum of widths of all frozen columns before it)
  const getFrozenLeftOffset = useCallback((col: string, colIndex: number) => {
    if (!frozenColumns.has(col)) return undefined;
    let offset = 0;
    for (let i = 0; i < colIndex; i++) {
      const c = displayColumns[i];
      if (frozenColumns.has(c)) {
        offset += columnWidths[c] ?? getDefaultColumnWidth(c);
      }
    }
    return offset;
  }, [frozenColumns, displayColumns, columnWidths]);

  // Total width of frozen columns (for non-frozen content offset)
  const frozenColumnsWidth = useMemo(() => {
    let width = 0;
    for (let i = 0; i < frozenColumnCount && i < displayColumns.length; i++) {
      width += columnWidths[displayColumns[i]] ?? getDefaultColumnWidth(displayColumns[i]);
    }
    return width;
  }, [frozenColumnCount, displayColumns, columnWidths]);

  // Column metadata (type, options, range)
  const columnMeta = useMemo(() => {
    const meta: Record<string, { type: 'boolean' | 'number' | 'categorical' | 'text'; options?: string[]; range?: { min: number; max: number } }> = {};
    displayColumns.forEach(col => {
      const type = getColumnType(displayCrops, col);
      meta[col] = { type };
      if (type === 'categorical') {
        meta[col].options = getUniqueValuesForColumn(displayCrops, col);
      } else if (type === 'number') {
        meta[col].range = getNumericRange(displayCrops, col);
      }
    });
    return meta;
  }, [displayCrops, displayColumns]);

  const getColumnWidth = useCallback((col: string) => {
    return columnWidths[col] ?? getDefaultColumnWidth(col);
  }, [columnWidths]);

  // Filter crops
  const filteredCrops = useMemo(() => {
    return displayCrops.filter(crop => {
      // Hide deprecated crops if toggle is off
      if (!showDeprecated && crop.deprecated) return false;

      // Text search - use materialized searchText if available, otherwise key fields
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const searchable = crop.searchText?.toLowerCase() ?? [
          crop.identifier,
          crop.crop,
          crop.category,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!searchable.includes(q)) return false;
      }

      // Column filters
      for (const [col, filterVal] of Object.entries(columnFilters)) {
        if (filterVal === null || filterVal === undefined || filterVal === '') continue;

        const cropVal = crop[col as keyof Crop];
        const meta = columnMeta[col];

        if (!meta) continue;

        if (meta.type === 'boolean') {
          if (filterVal === 'true' && cropVal !== true) return false;
          if (filterVal === 'false' && cropVal !== false) return false;
        } else if (meta.type === 'number' && typeof filterVal === 'object') {
          const numVal = typeof cropVal === 'number' ? cropVal : null;
          if (numVal === null) return false;
          if (filterVal.min !== undefined && numVal < filterVal.min) return false;
          if (filterVal.max !== undefined && numVal > filterVal.max) return false;
        } else if (meta.type === 'categorical') {
          if (String(cropVal) !== String(filterVal)) return false;
        } else if (meta.type === 'text') {
          if (!String(cropVal ?? '').toLowerCase().includes(String(filterVal).toLowerCase())) return false;
        }
      }

      return true;
    });
  }, [displayCrops, searchQuery, columnFilters, columnMeta, showDeprecated]);

  // Sort crops
  const sortedCrops = useMemo(() => {
    if (!sortColumn || !sortDirection) return filteredCrops;

    return [...filteredCrops].sort((a, b) => {
      const aVal = a[sortColumn as keyof Crop];
      const bVal = b[sortColumn as keyof Crop];

      if (aVal === null || aVal === undefined) return sortDirection === 'asc' ? 1 : -1;
      if (bVal === null || bVal === undefined) return sortDirection === 'asc' ? -1 : 1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
        return sortDirection === 'asc'
          ? (aVal === bVal ? 0 : aVal ? -1 : 1)
          : (aVal === bVal ? 0 : aVal ? 1 : -1);
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return sortDirection === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }, [filteredCrops, sortColumn, sortDirection]);

  const selectedCrop = useMemo(() => {
    if (!selectedCropId) return null;
    return displayCrops.find(c => c.id === selectedCropId) || null;
  }, [displayCrops, selectedCropId]);

  // Filtered columns for column manager
  const filteredColumns = useMemo(() => {
    let cols = columnOrder;
    if (columnSearch) {
      const q = columnSearch.toLowerCase();
      cols = cols.filter(col => col.toLowerCase().includes(q));
    }
    if (columnFilter === 'visible') {
      cols = cols.filter(col => visibleColumns.has(col));
    } else if (columnFilter === 'hidden') {
      cols = cols.filter(col => !visibleColumns.has(col));
    }
    return cols;
  }, [columnOrder, columnSearch, columnFilter, visibleColumns]);

  const clearAllFilters = () => {
    setSearchQuery('');
    setColumnFilters({});
  };

  const toggleColumn = (col: string) => {
    const next = new Set(visibleColumns);
    if (next.has(col)) {
      next.delete(col);
    } else {
      next.add(col);
    }
    setVisibleColumns(next);
  };

  const hideColumn = (col: string) => {
    const next = new Set(visibleColumns);
    next.delete(col);
    setVisibleColumns(next);
  };

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else if (sortDirection === 'desc') { setSortColumn(null); setSortDirection(null); }
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const resetColumns = () => {
    setVisibleColumns(new Set(DEFAULT_VISIBLE));
    setColumnOrder(allColumns);
    setColumnWidths({});
    setColumnFilters({});
  };

  const selectAllShown = () => {
    const next = new Set(visibleColumns);
    filteredColumns.forEach(col => next.add(col));
    setVisibleColumns(next);
  };

  const deselectAllShown = () => {
    const next = new Set(visibleColumns);
    filteredColumns.forEach(col => next.delete(col));
    setVisibleColumns(next);
  };

  // Column drag handlers
  const handleDragStart = (e: React.DragEvent, col: string) => {
    setDraggedColumn(col);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', col);
  };

  const handleDragOver = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    if (draggedColumn && draggedColumn !== col) setDragOverColumn(col);
  };

  const handleDragLeave = () => setDragOverColumn(null);

  const handleDrop = (e: React.DragEvent, targetCol: string) => {
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

  const handleDragEnd = () => {
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  // Column resize handlers
  const handleResizeStart = (e: React.MouseEvent, col: string) => {
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

  // Filter pane resize handlers
  const handlePaneResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setResizingPane(true);
    setPaneResizeStartX(e.clientX);
    setPaneResizeStartWidth(filterPaneWidth);
  };

  useEffect(() => {
    if (!resizingPane) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - paneResizeStartX;
      setFilterPaneWidth(Math.max(200, Math.min(500, paneResizeStartWidth + delta)));
    };
    const handleMouseUp = () => setResizingPane(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingPane, paneResizeStartX, paneResizeStartWidth]);

  const activeFilterCount = Object.values(columnFilters).filter(v => v !== null && v !== undefined && v !== '').length + (searchQuery ? 1 : 0);

  // Virtualization
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const headerContainerRef = useRef<HTMLDivElement>(null);

  // Track current scroll position for restoration after data updates
  const lastScrollTopRef = useRef<number>(0);
  const lastScrollLeftRef = useRef<number>(0);

  const rowVirtualizer = useVirtualizer({
    count: sortedCrops.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const totalWidth = useMemo(() => {
    return displayColumns.reduce((sum, col) => sum + getColumnWidth(col), 0);
  }, [displayColumns, getColumnWidth]);

  // Restore scroll position after hydration (once) - use RAF to avoid flushSync during render
  useEffect(() => {
    if (pendingScrollTop !== null && !scrollRestoredRef.current && sortedCrops.length > 0) {
      requestAnimationFrame(() => {
        const container = tableContainerRef.current;
        if (container) {
          container.scrollTop = pendingScrollTop;
        }
        scrollRestoredRef.current = true;
        lastScrollTopRef.current = pendingScrollTop;
        setPendingScrollTop(null);
      });
    }
  }, [pendingScrollTop, sortedCrops.length]);

  // Debounced scroll position save
  const scrollSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const scrollLeft = e.currentTarget.scrollLeft;

    // Don't save scroll position of 0 if we had a real position - this is likely
    // a spurious scroll event from a re-render resetting the container
    if (scrollTop === 0 && lastScrollTopRef.current > 100) {
      return; // Don't update lastScrollTopRef or sync header
    }

    lastScrollTopRef.current = scrollTop;
    lastScrollLeftRef.current = scrollLeft;

    // Mark as "restored" after any user scroll - this enables scroll preservation
    if (!scrollRestoredRef.current && scrollTop > 0) {
      scrollRestoredRef.current = true;
    }

    if (headerContainerRef.current) {
      headerContainerRef.current.scrollLeft = scrollLeft;
    }

    // Save scroll position to localStorage (debounced)
    if (scrollRestoredRef.current) {
      if (scrollSaveTimeoutRef.current) {
        clearTimeout(scrollSaveTimeoutRef.current);
      }
      scrollSaveTimeoutRef.current = setTimeout(() => {
        const persisted = loadPersistedState();
        if (persisted) {
          savePersistedState({ ...persisted, scrollTop });
        }
      }, 150);
    }
  }, []);

  // Update filter for a column
  const updateColumnFilter = useCallback((col: string, value: FilterValue) => {
    setColumnFilters(prev => ({ ...prev, [col]: value }));
  }, []);

  // Load plan into store when activePlanId changes (if not already loaded)
  useEffect(() => {
    if (activePlanId && currentPlanId !== activePlanId) {
      loadPlanById(activePlanId).catch(err => {
        console.error('Failed to load plan:', err);
      });
    }
  }, [activePlanId, currentPlanId, loadPlanById]);

  // Toggle selection for a single crop
  const toggleCropSelection = useCallback((cropId: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    setSelectedCropIds(prev => {
      const next = new Set(prev);
      if (next.has(cropId)) {
        next.delete(cropId);
      } else {
        next.add(cropId);
      }
      return next;
    });
  }, []);

  // Select/deselect all visible crops
  const selectAllVisible = useCallback(() => {
    setSelectedCropIds(new Set(sortedCrops.map(c => c.id)));
  }, [sortedCrops]);

  const deselectAll = useCallback(() => {
    setSelectedCropIds(new Set());
  }, []);

  // Add crops directly to the active plan via store
  const addCropsToActivePlan = useCallback(async (cropsToAddNow: Crop[]) => {
    if (!activePlanId || cropsToAddNow.length === 0) return;

    setAddingToPlan(true);
    setAddToPlanMessage(null);

    try {
      // Ensure the plan is loaded in the store
      if (currentPlanId !== activePlanId) {
        await loadPlanById(activePlanId);
      }

      // Add each crop as a planting via the store (supports undo/redo)
      for (const crop of cropsToAddNow) {
        const newPlanting = createPlantingFromConfig(crop);
        await addPlanting(newPlanting);
      }

      const cropCount = cropsToAddNow.length;
      setAddToPlanMessage({
        type: 'success',
        text: cropCount === 1
          ? `Added "${cropsToAddNow[0].crop}" to "${activePlan?.name}"`
          : `Added ${cropCount} crops to "${activePlan?.name}"`,
        planId: activePlanId,
      });
      setSelectedCropIds(new Set());
    } catch (err) {
      setAddToPlanMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to add crops',
      });
    } finally {
      setAddingToPlan(false);
    }
  }, [activePlanId, activePlan?.name, currentPlanId, loadPlanById, addPlanting]);

  // Quick add single crop to plan (from row button)
  const handleQuickAdd = useCallback((crop: Crop, event: React.MouseEvent) => {
    event.stopPropagation();
    if (activePlanId) {
      // Add directly to active plan
      addCropsToActivePlan([crop]);
    } else {
      // No active plan, show picker
      setCropsToAdd([crop]);
      setShowAddToPlan(true);
    }
  }, [activePlanId, addCropsToActivePlan]);

  // Add selected crops to plan (from floating bar)
  const handleAddSelectedToPlan = useCallback(() => {
    const cropsToAddList = sortedCrops.filter(c => selectedCropIds.has(c.id));
    if (cropsToAddList.length === 0) return;

    if (activePlanId) {
      // Add directly to active plan
      addCropsToActivePlan(cropsToAddList);
    } else {
      // No active plan, show picker
      setCropsToAdd(cropsToAddList);
      setShowAddToPlan(true);
    }
  }, [selectedCropIds, sortedCrops, activePlanId, addCropsToActivePlan]);

  // Handle adding crops to a plan (single or multiple) - also sets as active plan
  const handleAddToPlan = useCallback(async (planId: string) => {
    if (cropsToAdd.length === 0) return;

    setAddingToPlan(true);
    setAddToPlanMessage(null);

    try {
      // Load the plan into the store if not already loaded
      if (currentPlanId !== planId) {
        await loadPlanById(planId);
      }

      // Add each crop as a planting via the store (supports undo/redo)
      for (const crop of cropsToAdd) {
        const newPlanting = createPlantingFromConfig(crop);
        await addPlanting(newPlanting);
      }

      // Set this as the active plan for future adds (store handles localStorage sync)
      setActivePlanId(planId);

      // Get plan name from the store's current plan
      const plan = planList.find(p => p.id === planId);
      const planName = usePlanStore.getState().currentPlan?.metadata.name || plan?.name || 'Plan';
      const cropCount = cropsToAdd.length;
      setAddToPlanMessage({
        type: 'success',
        text: cropCount === 1
          ? `Added "${cropsToAdd[0].crop}" to "${planName}"`
          : `Added ${cropCount} crops to "${planName}"`,
        planId,
      });
      setShowAddToPlan(false);
      setCropsToAdd([]);
      // Clear selection after adding
      setSelectedCropIds(new Set());
    } catch (err) {
      setAddToPlanMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to add crops',
      });
    } finally {
      setAddingToPlan(false);
    }
  }, [cropsToAdd, planList, currentPlanId, loadPlanById, addPlanting, setActivePlanId]);

  // Clear message after a timeout
  useEffect(() => {
    if (addToPlanMessage) {
      const timer = setTimeout(() => setAddToPlanMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [addToPlanMessage]);

  // Get existing identifiers from active plan's catalog
  const existingIdentifiers = useMemo(() => {
    if (!activePlanId || planCatalog.length === 0) return [];
    return planCatalog.map(c => c.identifier);
  }, [activePlanId, planCatalog]);

  // Handle opening the edit config modal
  const handleEditConfig = useCallback((crop: Crop) => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Select an active plan first to edit configs',
      });
      return;
    }
    setConfigToEdit(crop as CropConfig);
    setShowEditConfig(true);
  }, [activePlanId]);

  // Handle saving an edited config via store
  const handleSaveEditedConfig = useCallback(async (config: CropConfig) => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Please select an active plan first',
      });
      return;
    }

    try {
      // Ensure the plan is loaded in the store
      if (currentPlanId !== activePlanId) {
        await loadPlanById(activePlanId);
      }

      // Update the config via the store (supports undo/redo)
      await updateCropConfig(config);

      setAddToPlanMessage({
        type: 'success',
        text: `Updated config "${config.identifier}"`,
        planId: activePlanId,
      });
      setShowEditConfig(false);
      setConfigToEdit(null);
    } catch (err) {
      setAddToPlanMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update config',
      });
    }
  }, [activePlanId, currentPlanId, loadPlanById, updateCropConfig]);

  // Handle saving a new custom config via store
  const handleSaveCustomConfig = useCallback(async (config: CropConfig) => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Please select an active plan first',
      });
      return;
    }

    try {
      // Ensure the plan is loaded in the store
      if (currentPlanId !== activePlanId) {
        await loadPlanById(activePlanId);
      }

      // Add the config via the store (supports undo/redo)
      await addCropConfig(config);

      setAddToPlanMessage({
        type: 'success',
        text: `Created config "${config.identifier}"`,
        planId: activePlanId,
      });
      setShowCreateConfig(false);
    } catch (err) {
      setAddToPlanMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create config',
      });
    }
  }, [activePlanId, currentPlanId, loadPlanById, addCropConfig]);

  // Handle initiating delete for a single config (from inspector)
  const handleDeleteConfig = useCallback((crop: Crop) => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Select an active plan first to delete configs',
      });
      return;
    }
    setConfigsToDelete([crop]);
    setShowDeleteConfirm(true);
  }, [activePlanId]);

  // Handle initiating bulk delete (from selection bar)
  const handleBulkDelete = useCallback(() => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Select an active plan first to delete configs',
      });
      return;
    }
    const cropsToDeleteList = sortedCrops.filter(c => selectedCropIds.has(c.id));
    if (cropsToDeleteList.length === 0) return;
    setConfigsToDelete(cropsToDeleteList);
    setShowDeleteConfirm(true);
  }, [activePlanId, sortedCrops, selectedCropIds]);

  // Handle confirmed deletion (uses store actions from component-level hooks)
  const handleConfirmDelete = useCallback(async () => {
    if (!activePlanId || configsToDelete.length === 0) return;

    setIsDeleting(true);
    try {
      // Ensure the plan is loaded in the store for undo/redo to work
      if (currentPlanId !== activePlanId) {
        await loadPlanById(activePlanId);
      }

      const identifiers = configsToDelete.map(c => c.identifier);
      const deletedCount = await deleteCropConfigs(identifiers);

      if (deletedCount === 0) {
        throw new Error('No configs were found to delete');
      }

      // No event dispatch needed - store update triggers UI refresh via Zustand reactivity

      setAddToPlanMessage({
        type: 'success',
        text: deletedCount === 1
          ? `Deleted "${identifiers[0]}"`
          : `Deleted ${deletedCount} configs`,
        planId: activePlanId,
      });

      // Clear selection if we deleted selected items
      setSelectedCropIds(prev => {
        const next = new Set(prev);
        configsToDelete.forEach(c => next.delete(c.id));
        return next;
      });

      // Clear selected crop if it was deleted
      if (selectedCropId && configsToDelete.some(c => c.id === selectedCropId)) {
        setSelectedCropId(null);
      }

      setShowDeleteConfirm(false);
      setConfigsToDelete([]);
    } catch (err) {
      setAddToPlanMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete configs',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [activePlanId, configsToDelete, selectedCropId, currentPlanId, loadPlanById, deleteCropConfigs]);

  // Handle cancel delete
  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    setConfigsToDelete([]);
  }, []);

  // Handle copy config (from selection bar - single item only)
  const handleCopySelected = useCallback(() => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Select an active plan first to copy configs',
      });
      return;
    }
    if (selectedCropIds.size !== 1) return;
    const cropToCopy = sortedCrops.find(c => selectedCropIds.has(c.id));
    if (!cropToCopy) return;
    setCopySourceConfig(cropToCopy);
    setShowCreateConfig(true);
  }, [activePlanId, selectedCropIds, sortedCrops]);

  return (
    <div className="flex h-full">
      {/* Collapsible Filter Pane */}
      <div
        className={`flex-shrink-0 bg-white border-r border-gray-200 flex flex-col transition-all duration-200 ${
          filterPaneOpen ? '' : 'w-10'
        }`}
        style={{ width: filterPaneOpen ? filterPaneWidth : 40 }}
      >
        {filterPaneOpen ? (
          <>
            {/* Filter pane header */}
            <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700 text-sm">Filters</span>
                {activeFilterCount > 0 && (
                  <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-800 rounded-full">
                    {activeFilterCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className="text-xs text-red-600 hover:text-red-800 px-2 py-1"
                  >
                    Clear all
                  </button>
                )}
                <button
                  onClick={() => setFilterPaneOpen(false)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                  title="Collapse filters"
                >
                  ◀
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="px-3 py-2 border-b border-gray-100">
              <input
                type="text"
                placeholder="Search all fields..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 placeholder:text-gray-600"
              />
            </div>

            {/* Column filter search */}
            <div className="px-3 py-2 border-b border-gray-100">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter columns..."
                  value={sidebarColumnSearch}
                  onChange={(e) => setSidebarColumnSearch(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 pr-7 placeholder:text-gray-600"
                />
                {sidebarColumnSearch && (
                  <button
                    onClick={() => setSidebarColumnSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                  >
                    ×
                  </button>
                )}
              </div>
              {sidebarColumnSearch && (
                <div className="text-xs text-blue-600 mt-1">
                  Showing {displayColumns.length} of {visibleColumns.size} columns
                </div>
              )}
            </div>

            {/* Filter list */}
            <div className="flex-1 overflow-y-auto">
              {displayColumns.map(col => {
                const meta = columnMeta[col];
                if (!meta) return null;

                return (
                  <div key={col} className="px-3 py-2 border-b border-gray-50">
                    <label className="block text-xs font-medium text-gray-600 mb-1 truncate" title={col}>
                      {col}
                    </label>
                    <FilterInput
                      type={meta.type}
                      options={meta.options}
                      range={meta.range}
                      value={columnFilters[col]}
                      onChange={(v) => updateColumnFilter(col, v)}
                    />
                  </div>
                );
              })}
            </div>

            {/* Resize handle */}
            <div
              onMouseDown={handlePaneResizeStart}
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-green-400 bg-transparent"
              style={{ right: 0 }}
            />
          </>
        ) : (
          <button
            onClick={() => setFilterPaneOpen(true)}
            className="flex-1 flex flex-col items-center justify-start pt-4 text-gray-400 hover:text-gray-600 hover:bg-gray-50"
            title="Expand filters"
          >
            <span className="text-lg">▶</span>
            <span className="text-xs mt-2 writing-mode-vertical" style={{ writingMode: 'vertical-rl' }}>
              Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
            </span>
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3">
          <span className="text-sm text-gray-700">
            {sortedCrops.length} of {displayCrops.length}
          </span>
          {addingToPlan && (
            <span className="text-sm text-blue-600 animate-pulse">Adding to plan...</span>
          )}
          {sortColumn && (
            <span className="text-sm text-green-600">
              Sorted by {sortColumn} ({sortDirection})
              <button
                onClick={() => { setSortColumn(null); setSortDirection(null); }}
                className="ml-1 text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </span>
          )}
          {/* Show deprecated toggle */}
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDeprecated}
              onChange={(e) => setShowDeprecated(e.target.checked)}
              className="rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            <span>Show deprecated</span>
            {deprecatedCount > 0 && (
              <span className="text-xs text-gray-400">({deprecatedCount})</span>
            )}
          </label>
          <div className="flex-1" />
          {/* Freeze columns control */}
          <div className="flex items-center gap-1.5 text-sm text-gray-700">
            <span>Freeze:</span>
            <select
              value={frozenColumnCount}
              onChange={(e) => setFrozenColumnCount(Number(e.target.value))}
              className="px-2 py-1 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
            >
              <option value={0}>None</option>
              {[1, 2, 3, 4, 5].map(n => (
                <option key={n} value={n}>{n} col{n > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setShowColumnManager(true)}
            className="px-3 py-1.5 text-sm text-gray-900 bg-gray-100 hover:bg-gray-200 rounded"
          >
            Columns ({visibleColumns.size}/{allColumns.length})
          </button>
          <button
            onClick={resetColumns}
            className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded"
            title="Reset columns to defaults"
          >
            Reset
          </button>
          <button
            onClick={() => {
              if (!activePlanId) {
                setAddToPlanMessage({
                  type: 'error',
                  text: 'Select an active plan first to create custom configs',
                });
                return;
              }
              setShowCreateConfig(true);
            }}
            className="px-3 py-1.5 text-sm text-white bg-green-600 hover:bg-green-700 rounded"
            title="Create a custom crop config for your plan"
          >
            + Custom Config
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 bg-white overflow-hidden">
          {/* Header */}
          <div ref={headerContainerRef} className="overflow-hidden border-b border-gray-200">
            <div style={{ width: totalWidth + 80, minWidth: '100%' }}>
              <div className="flex bg-gray-50" style={{ height: HEADER_HEIGHT }}>
                {/* Checkbox column - always sticky */}
                <div
                  className="w-10 flex-shrink-0 px-2 flex items-center justify-center border-r border-gray-100 bg-gray-50"
                  style={{ position: 'sticky', left: 0, zIndex: 3 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedCropIds.size > 0 && selectedCropIds.size === sortedCrops.length}
                    onChange={(e) => e.target.checked ? selectAllVisible() : deselectAll()}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    title={selectedCropIds.size === sortedCrops.length ? "Deselect all" : "Select all visible"}
                  />
                </div>
                {/* Actions column - always sticky */}
                <div
                  className="w-10 flex-shrink-0 px-2 flex items-center justify-center border-r border-gray-100 bg-gray-50"
                  style={{ position: 'sticky', left: 40, zIndex: 3 }}
                >
                  <span className="text-xs text-gray-600">+</span>
                </div>
                {displayColumns.map((col, colIndex) => {
                  const isFrozen = frozenColumns.has(col);
                  const leftOffset = getFrozenLeftOffset(col, colIndex);
                  const isLastFrozen = isFrozen && colIndex === frozenColumnCount - 1;
                  return (
                    <div
                      key={col}
                      draggable
                      onDragStart={(e) => handleDragStart(e, col)}
                      onDragOver={(e) => handleDragOver(e, col)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, col)}
                      onDragEnd={handleDragEnd}
                      style={{
                        width: getColumnWidth(col),
                        minWidth: getColumnWidth(col),
                        ...(isFrozen && {
                          position: 'sticky',
                          left: 40 + 40 + (leftOffset ?? 0), // checkbox (w-10=40px) + actions (w-10=40px) + offset
                          zIndex: 2,
                        }),
                      }}
                      className={`relative px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider whitespace-nowrap border-r border-gray-100 last:border-r-0 group cursor-grab select-none flex items-center ${
                        dragOverColumn === col ? 'bg-green-100 border-l-2 border-l-green-500' : getColumnBgClass(col, true)
                      } ${draggedColumn === col ? 'opacity-50' : ''} ${isFrozen ? 'bg-gray-100' : ''} ${isLastFrozen ? 'shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]' : ''}`}
                      onClick={() => handleSort(col)}
                    >
                      <span className="flex-1 truncate">{formatColumnHeader(col)}</span>
                      <span className="w-4 text-center flex-shrink-0">
                        {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : (
                          <span className="text-gray-300 opacity-0 group-hover:opacity-100">↕</span>
                        )}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); hideColumn(col); }}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 px-1 flex-shrink-0"
                        title="Hide column"
                      >
                        ×
                      </button>
                      {/* Resize handle */}
                      <div
                        onMouseDown={(e) => handleResizeStart(e, col)}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-green-400 group-hover:bg-gray-300"
                        style={{ marginRight: -1 }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Body */}
          <div
            ref={tableContainerRef}
            className="overflow-auto"
            style={{ height: 'calc(100% - 40px)' }}
            onScroll={handleBodyScroll}
          >
            {catalogLoading ? (
              <div className="flex items-center justify-center text-gray-600 h-full">
                <span className="animate-pulse">Loading catalog...</span>
              </div>
            ) : !isPlanLoaded ? (
              <div className="flex flex-col items-center justify-center text-gray-600 h-full gap-4">
                <p>Select a plan to view crop configurations</p>
                <button
                  onClick={() => router.push('/plans')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Go to Plans
                </button>
              </div>
            ) : sortedCrops.length === 0 ? (
              <div className="flex items-center justify-center text-gray-600 h-full">
                No crops match your filters
              </div>
            ) : (
            <div style={{ width: totalWidth + 80, minWidth: '100%' }}>
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const crop = sortedCrops[virtualRow.index];
                  const isSelected = selectedCropIds.has(crop.id);
                  // Use identifier as key since it's guaranteed unique within a plan's catalog
                  const rowKey = crop.identifier || `row-${virtualRow.index}`;
                  return (
                    <div
                      key={rowKey}
                      onClick={() => setSelectedCropId(crop.id === selectedCropId ? null : crop.id)}
                      className={`flex cursor-pointer hover:bg-gray-50 border-b border-gray-100 group ${
                        selectedCropId === crop.id ? 'bg-green-50' : ''
                      } ${isSelected ? 'bg-blue-50' : ''} ${crop.deprecated ? 'opacity-50' : ''}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: ROW_HEIGHT,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {/* Checkbox - always sticky */}
                      <div
                        className="w-10 shrink-0 px-2 flex items-center justify-center border-r border-gray-50 bg-white"
                        style={{ position: 'sticky', left: 0, zIndex: 2 }}
                        onClick={(e) => toggleCropSelection(crop.id, e)}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </div>
                      {/* Quick add button - always sticky */}
                      <div
                        className="w-10 shrink-0 px-2 flex items-center justify-center border-r border-gray-50 bg-white"
                        style={{ position: 'sticky', left: 40, zIndex: 2 }}
                      >
                        <button
                          onClick={(e) => handleQuickAdd(crop, e)}
                          className="w-6 h-6 flex items-center justify-center rounded bg-blue-100 text-blue-600 opacity-0 group-hover:opacity-100 hover:bg-blue-200 transition-opacity text-sm font-medium"
                          title={`Add ${crop.crop} to plan`}
                        >
                          +
                        </button>
                      </div>
                      {displayColumns.map((col, colIndex) => {
                        const isFrozen = frozenColumns.has(col);
                        const leftOffset = getFrozenLeftOffset(col, colIndex);
                        const isLastFrozen = isFrozen && colIndex === frozenColumnCount - 1;

                        // For identifier column, add validation status indicator
                        const isIdentifierCol = col === 'identifier';
                        const validation = isIdentifierCol ? validateCropConfig(crop as CropConfig) : null;
                        const hasIssues = validation && validation.status !== 'ok';

                        return (
                          <div
                            key={col}
                            style={{
                              width: getColumnWidth(col),
                              minWidth: getColumnWidth(col),
                              ...(isFrozen && {
                                position: 'sticky',
                                left: 40 + 40 + (leftOffset ?? 0), // checkbox (w-10=40px) + actions (w-10=40px) + offset
                                zIndex: 1,
                              }),
                            }}
                            className={`px-3 py-2 text-sm whitespace-nowrap border-r border-gray-50 last:border-r-0 truncate flex items-center gap-1.5 ${getColumnBgClass(col)} ${isFrozen ? 'bg-white' : ''} ${isLastFrozen ? 'shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]' : ''} ${
                              hasIssues
                                ? validation.status === 'error'
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                                : 'text-gray-900'
                            }`}
                            title={hasIssues ? `${crop[col as keyof Crop]}\n\nIssues:\n• ${validation.issues.join('\n• ')}` : String(crop[col as keyof Crop] ?? '')}
                          >
                            {/* Validation indicator for identifier column */}
                            {isIdentifierCol && hasIssues && (
                              <span
                                className={`shrink-0 ${
                                  validation.status === 'error'
                                    ? 'text-red-500'
                                    : 'text-amber-500'
                                }`}
                                title={validation.issues.join('\n')}
                              >
                                {validation.status === 'error' ? (
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </span>
                            )}
                            <span className="truncate">{formatValue(crop[col as keyof Crop], col)}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
            )}
          </div>
        </div>
      </div>

      {/* Column Manager Modal */}
      {showColumnManager && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
          <div className="bg-white rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Manage Columns</h2>
              <button onClick={() => setShowColumnManager(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            <div className="px-4 py-3 border-b border-gray-200 space-y-3">
              <input
                type="text"
                placeholder="Search columns..."
                value={columnSearch}
                onChange={(e) => setColumnSearch(e.target.value)}
                className="w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 placeholder:text-gray-600"
                autoFocus
              />
              <div className="flex gap-2 flex-wrap">
                {(['all', 'visible', 'hidden'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setColumnFilter(f)}
                    className={`px-3 py-1 text-sm rounded-md ${
                      columnFilter === f ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {f === 'all' ? `All (${allColumns.length})` : f === 'visible' ? `Visible (${visibleColumns.size})` : `Hidden (${allColumns.length - visibleColumns.size})`}
                  </button>
                ))}
                <div className="flex-1" />
                <button onClick={resetColumns} className="px-3 py-1 text-sm text-blue-600 hover:underline">Reset all</button>
              </div>

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <span className="text-sm text-gray-700 py-1">{filteredColumns.length} columns:</span>
                <button onClick={selectAllShown} className="px-2 py-1 text-sm bg-green-50 text-green-700 hover:bg-green-100 rounded">Select all shown</button>
                <button onClick={deselectAllShown} className="px-2 py-1 text-sm bg-red-50 text-red-700 hover:bg-red-100 rounded">Deselect all shown</button>
                <div className="flex-1" />
                <button onClick={() => setVisibleColumns(new Set(allColumns))} className="px-2 py-1 text-sm text-gray-600 hover:text-gray-900">Show all</button>
                <button onClick={() => setVisibleColumns(new Set())} className="px-2 py-1 text-sm text-gray-600 hover:text-gray-900">Hide all</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              <div className="grid grid-cols-2 gap-1">
                {filteredColumns.map(col => (
                  <label
                    key={col}
                    className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer ${
                      visibleColumns.has(col) ? 'bg-green-50 hover:bg-green-100' : 'bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(col)}
                      onChange={() => toggleColumn(col)}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className={`text-sm truncate ${visibleColumns.has(col) ? 'text-gray-900' : 'text-gray-600'}`}>{col}</span>
                  </label>
                ))}
              </div>
              {filteredColumns.length === 0 && <div className="text-center text-gray-700 py-8">No columns match</div>}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end">
              <button onClick={() => setShowColumnManager(false)} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedCrop && (
        <div className="fixed right-4 top-20 w-96 max-h-[calc(100vh-100px)] bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden" style={{ zIndex: Z_INDEX.DETAIL_PANEL }}>
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-green-50">
            <div>
              <h2 className="font-semibold text-gray-900">{selectedCrop.crop}</h2>
              <p className="text-xs text-gray-600 font-mono">{selectedCrop.id}</p>
            </div>
            <button onClick={() => setSelectedCropId(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
          </div>
          {/* Action buttons */}
          <div className="px-4 py-2 border-b border-gray-100 flex gap-2">
            <button
              onClick={() => { setCropsToAdd([selectedCrop]); setShowAddToPlan(true); }}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Add to Plan
            </button>
            <button
              onClick={() => handleEditConfig(selectedCrop)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              title="Edit this config in the active plan's catalog"
            >
              Edit
            </button>
          </div>
          <div className="overflow-y-auto max-h-[calc(100vh-300px)]">
            <div className="p-4 space-y-1">
              {allColumns.map(key => {
                const value = selectedCrop[key as keyof Crop];
                return (
                  <div key={key} className="flex py-1 border-b border-gray-50 last:border-0">
                    <span className="text-xs text-gray-600 w-36 flex-shrink-0 truncate" title={key}>{key}</span>
                    <span className="text-sm text-gray-900 break-all">{formatValue(value)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Delete button at bottom */}
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
            <button
              onClick={() => handleDeleteConfig(selectedCrop)}
              className="w-full px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors"
            >
              Delete Config
            </button>
          </div>
        </div>
      )}

      {/* Add to Plan Modal */}
      {showAddToPlan && cropsToAdd.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
          <div className="bg-white rounded-lg shadow-xl w-[400px] max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Add to Plan</h2>
              <button
                onClick={() => { setShowAddToPlan(false); setCropsToAdd([]); }}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-4">
              {cropsToAdd.length === 1 ? (
                <p className="text-sm text-gray-600 mb-4">
                  Add <strong>{cropsToAdd[0].crop}</strong> to a plan. The selected plan will become your active plan.
                </p>
              ) : (
                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-2">
                    Add <strong>{cropsToAdd.length} crops</strong> to a plan. The selected plan will become your active plan.
                  </p>
                  <div className="max-h-24 overflow-y-auto text-xs text-gray-600 bg-gray-50 rounded p-2">
                    {cropsToAdd.map(c => c.crop).join(', ')}
                  </div>
                </div>
              )}

              {planList.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-700 mb-4">No plans found.</p>
                  <button
                    onClick={() => {
                      setShowAddToPlan(false);
                      setCropsToAdd([]);
                      router.push('/plans');
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    Create a Plan
                  </button>
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {planList.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => handleAddToPlan(plan.id)}
                      disabled={addingToPlan}
                      className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-50"
                    >
                      <div className="font-medium text-gray-900">{plan.name}</div>
                      <div className="text-xs text-gray-600">{plan.cropCount} crops</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => { setShowAddToPlan(false); setCropsToAdd([]); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating selection action bar */}
      {selectedCropIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-3 bg-gray-900 text-white rounded-lg shadow-xl flex items-center gap-4" style={{ zIndex: Z_INDEX.FLOATING_ACTION_BAR }}>
          <span className="text-sm">
            <strong>{selectedCropIds.size}</strong> crop{selectedCropIds.size !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handleAddSelectedToPlan}
            className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 rounded transition-colors"
          >
            Add to Plan
          </button>
          {selectedCropIds.size === 1 && (
            <button
              onClick={handleCopySelected}
              className="px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 rounded transition-colors"
            >
              Copy
            </button>
          )}
          <button
            onClick={handleBulkDelete}
            className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 rounded transition-colors"
          >
            Delete
          </button>
          <button
            onClick={deselectAll}
            className="px-3 py-1.5 text-sm font-medium bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Toast notification */}
      {addToPlanMessage && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 ${
            addToPlanMessage.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
          style={{ zIndex: Z_INDEX.TOAST }}
        >
          <span>{addToPlanMessage.text}</span>
          {addToPlanMessage.type === 'success' && addToPlanMessage.planId && (
            <button
              onClick={() => router.push(`/timeline/${addToPlanMessage.planId}`)}
              className="px-2 py-1 text-sm bg-white/20 hover:bg-white/30 rounded"
            >
              View Plan
            </button>
          )}
          <button
            onClick={() => setAddToPlanMessage(null)}
            className="text-white/80 hover:text-white text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}

      {/* Create Custom Config Modal */}
      <CropConfigCreator
        isOpen={showCreateConfig}
        onClose={() => { setShowCreateConfig(false); setCopySourceConfig(null); }}
        onSave={handleSaveCustomConfig}
        availableCrops={displayCrops as CropConfig[]}
        existingIdentifiers={existingIdentifiers}
        varieties={varieties}
        seedMixes={seedMixes}
        products={products}
        markets={markets}
        initialSourceConfig={copySourceConfig as CropConfig | null}
      />

      {/* Edit Config Modal */}
      <CropConfigEditor
        isOpen={showEditConfig}
        crop={configToEdit}
        onClose={() => { setShowEditConfig(false); setConfigToEdit(null); }}
        onSave={handleSaveEditedConfig}
        mode="edit"
        existingIdentifiers={existingIdentifiers}
        varieties={varieties}
        seedMixes={seedMixes}
        products={products}
        markets={markets}
      />

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && configsToDelete.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
          <div className="bg-white rounded-lg shadow-xl w-[400px] max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Confirm Delete</h2>
              <button
                onClick={handleCancelDelete}
                className="text-gray-400 hover:text-gray-600 text-xl"
                disabled={isDeleting}
              >
                ×
              </button>
            </div>

            <div className="p-4">
              {configsToDelete.length === 1 ? (
                <p className="text-sm text-gray-600 mb-4">
                  Are you sure you want to delete <strong>{configsToDelete[0].identifier}</strong>?
                  This cannot be undone.
                </p>
              ) : (
                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-2">
                    Are you sure you want to delete <strong>{configsToDelete.length} configs</strong>?
                    This cannot be undone.
                  </p>
                  <div className="max-h-32 overflow-y-auto text-xs text-gray-600 bg-gray-50 rounded p-2 border border-gray-200">
                    {configsToDelete.map(c => c.identifier).join(', ')}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={handleCancelDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Deleting...
                  </>
                ) : (
                  `Delete ${configsToDelete.length === 1 ? 'Config' : `${configsToDelete.length} Configs`}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resize overlays */}
      {resizingColumn && <div className="fixed inset-0 cursor-col-resize" style={{ zIndex: Z_INDEX.RESIZE_OVERLAY }} />}
      {resizingPane && <div className="fixed inset-0 cursor-col-resize" style={{ zIndex: Z_INDEX.RESIZE_OVERLAY }} />}
    </div>
  );
}

// Filter input component
function FilterInput({
  type,
  options,
  range,
  value,
  onChange,
}: {
  type: 'boolean' | 'number' | 'categorical' | 'text';
  options?: string[];
  range?: { min: number; max: number };
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  if (type === 'boolean') {
    return (
      <select
        value={value === 'true' ? 'true' : value === 'false' ? 'false' : ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
      >
        <option value="">Any</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  if (type === 'categorical' && options) {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
      >
        <option value="">Any</option>
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  if (type === 'number' && range) {
    const rangeVal = typeof value === 'object' && value !== null ? value : {};
    return (
      <div className="flex gap-1 items-center">
        <input
          type="number"
          placeholder={String(range.min)}
          value={rangeVal.min ?? ''}
          onChange={(e) => onChange({ ...rangeVal, min: e.target.value ? Number(e.target.value) : undefined })}
          className="w-full px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 placeholder:text-gray-600"
        />
        <span className="text-gray-600 text-xs">to</span>
        <input
          type="number"
          placeholder={String(range.max)}
          value={rangeVal.max ?? ''}
          onChange={(e) => onChange({ ...rangeVal, max: e.target.value ? Number(e.target.value) : undefined })}
          className="w-full px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 placeholder:text-gray-600"
        />
      </div>
    );
  }

  // Text filter
  return (
    <input
      type="text"
      placeholder="Contains..."
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 placeholder:text-gray-600"
    />
  );
}

function formatValue(value: unknown, columnName?: string): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'boolean') return value ? '✓' : '–';
  if (typeof value === 'number') {
    // Format revenue as currency
    if (columnName === 'revenuePerBed') {
      return '$' + value.toFixed(2);
    }
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
  }
  return String(value);
}

/** Format column headers for display (handle special computed columns) */
function formatColumnHeader(col: string): string {
  // Special display names for computed columns
  if (col === 'revenuePerBed') return 'Rev/Bed';
  return col;
}
