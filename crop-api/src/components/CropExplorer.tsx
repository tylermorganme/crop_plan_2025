'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Crop } from '@/lib/crops';

interface CropExplorerProps {
  crops: Crop[];
  filterOptions: {
    crops: string[];
    categories: string[];
    growingStructures: string[];
    plantingMethods: string[];
  };
  allHeaders: string[];
}

// Default visible columns
const DEFAULT_VISIBLE = [
  'Crop', 'Variety', 'Product', 'Category', 'Growing Structure', 'Planting Method',
  'Seasons', 'Rows', 'Spacing', 'DTM', 'Days in Cells', 'Harvests',
  'Direct Price', 'Unit', 'Direct Revenue Per Bed', 'In Plan', 'Deprecated'
];

const STORAGE_KEY = 'crop-explorer-state-v3';

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
  if (col === 'Identifier') return 300;
  if (['Sp', 'Su', 'Fa', 'Wi', 'OW'].includes(col)) return 50;
  if (['In Plan', 'Deprecated', 'Audited?', 'Might Grow'].includes(col)) return 80;
  if (col.includes('Date')) return 110;
  if (col.includes('Revenue') || col.includes('Profit') || col.includes('Cost')) return 140;
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

export default function CropExplorer({ crops, allHeaders }: CropExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCropId, setSelectedCropId] = useState<string | null>(null);

  // Dynamic filters keyed by column name
  const [columnFilters, setColumnFilters] = useState<Record<string, FilterValue>>({});

  // All columns including 'id'
  const allColumns = useMemo(() => ['id', ...allHeaders], [allHeaders]);

  // Initialize from localStorage
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    const persisted = loadPersistedState();
    return new Set(persisted?.visibleColumns ?? DEFAULT_VISIBLE);
  });
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const persisted = loadPersistedState();
    if (persisted?.columnOrder) {
      const existing = new Set(allColumns);
      const order = persisted.columnOrder.filter(c => existing.has(c));
      allColumns.forEach(c => { if (!order.includes(c)) order.push(c); });
      return order;
    }
    return allColumns;
  });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const persisted = loadPersistedState();
    return persisted?.columnWidths ?? {};
  });
  const [sortColumn, setSortColumn] = useState<string | null>(() => {
    const persisted = loadPersistedState();
    return persisted?.sortColumn ?? null;
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    const persisted = loadPersistedState();
    return persisted?.sortDirection ?? null;
  });
  const [filterPaneOpen, setFilterPaneOpen] = useState(() => {
    const persisted = loadPersistedState();
    return persisted?.filterPaneOpen ?? true;
  });
  const [filterPaneWidth, setFilterPaneWidth] = useState(() => {
    const persisted = loadPersistedState();
    return persisted?.filterPaneWidth ?? DEFAULT_FILTER_PANE_WIDTH;
  });

  const [showColumnManager, setShowColumnManager] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const [columnFilter, setColumnFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [sidebarColumnSearch, setSidebarColumnSearch] = useState('');

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

  // Persist state
  useEffect(() => {
    savePersistedState({
      visibleColumns: Array.from(visibleColumns),
      columnOrder,
      columnWidths,
      sortColumn,
      sortDirection,
      filterPaneOpen,
      filterPaneWidth,
    });
  }, [visibleColumns, columnOrder, columnWidths, sortColumn, sortDirection, filterPaneOpen, filterPaneWidth]);

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

  // Columns to display (filtered by sidebar search if active)
  const displayColumns = useMemo(() => {
    let cols = columnOrder.filter(col => visibleColumns.has(col));
    if (sidebarColumnSearch) {
      const q = sidebarColumnSearch.toLowerCase();
      cols = cols.filter(col => col.toLowerCase().includes(q));
    }
    return cols;
  }, [columnOrder, visibleColumns, sidebarColumnSearch]);

  // Column metadata (type, options, range)
  const columnMeta = useMemo(() => {
    const meta: Record<string, { type: 'boolean' | 'number' | 'categorical' | 'text'; options?: string[]; range?: { min: number; max: number } }> = {};
    displayColumns.forEach(col => {
      const type = getColumnType(crops, col);
      meta[col] = { type };
      if (type === 'categorical') {
        meta[col].options = getUniqueValuesForColumn(crops, col);
      } else if (type === 'number') {
        meta[col].range = getNumericRange(crops, col);
      }
    });
    return meta;
  }, [crops, displayColumns]);

  const getColumnWidth = useCallback((col: string) => {
    return columnWidths[col] ?? getDefaultColumnWidth(col);
  }, [columnWidths]);

  // Filter crops
  const filteredCrops = useMemo(() => {
    return crops.filter(crop => {
      // Text search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const searchable = [
          crop.Identifier,
          crop.Crop,
          crop.Variety,
          crop['Common Name'],
          crop.Category,
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
  }, [crops, searchQuery, columnFilters, columnMeta]);

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
    return crops.find(c => c.id === selectedCropId) || null;
  }, [crops, selectedCropId]);

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

  const rowVirtualizer = useVirtualizer({
    count: sortedCrops.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const totalWidth = useMemo(() => {
    return displayColumns.reduce((sum, col) => sum + getColumnWidth(col), 0);
  }, [displayColumns, getColumnWidth]);

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (headerContainerRef.current) {
      headerContainerRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }, []);

  // Update filter for a column
  const updateColumnFilter = useCallback((col: string, value: FilterValue) => {
    setColumnFilters(prev => ({ ...prev, [col]: value }));
  }, []);

  return (
    <div className="flex h-[calc(100vh-140px)]">
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
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
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
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 pr-7"
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
          <span className="text-sm text-gray-500">
            {sortedCrops.length} of {crops.length} · {displayColumns.length} columns
          </span>
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
          <span className="text-xs text-gray-400">Drag headers to reorder · Drag edges to resize</span>
          <div className="flex-1" />
          <button
            onClick={() => setShowColumnManager(true)}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          >
            Columns ({visibleColumns.size}/{allColumns.length})
          </button>
          <button
            onClick={resetColumns}
            className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
            title="Reset columns to defaults"
          >
            Reset
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 bg-white overflow-hidden">
          {/* Header */}
          <div ref={headerContainerRef} className="overflow-hidden border-b border-gray-200">
            <div style={{ width: totalWidth, minWidth: '100%' }}>
              <div className="flex bg-gray-50" style={{ height: HEADER_HEIGHT }}>
                {displayColumns.map(col => (
                  <div
                    key={col}
                    draggable
                    onDragStart={(e) => handleDragStart(e, col)}
                    onDragOver={(e) => handleDragOver(e, col)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, col)}
                    onDragEnd={handleDragEnd}
                    style={{ width: getColumnWidth(col), minWidth: getColumnWidth(col) }}
                    className={`relative px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap border-r border-gray-100 last:border-r-0 group cursor-grab select-none flex items-center ${
                      dragOverColumn === col ? 'bg-green-100 border-l-2 border-l-green-500' : 'hover:bg-gray-100'
                    } ${draggedColumn === col ? 'opacity-50' : ''}`}
                    onClick={() => handleSort(col)}
                  >
                    <span className="flex-1 truncate">{col}</span>
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
                    <div
                      onMouseDown={(e) => handleResizeStart(e, col)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-green-400 group-hover:bg-gray-300"
                      style={{ marginRight: -1 }}
                    />
                  </div>
                ))}
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
            <div style={{ width: totalWidth, minWidth: '100%' }}>
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const crop = sortedCrops[virtualRow.index];
                  return (
                    <div
                      key={crop.id}
                      onClick={() => setSelectedCropId(crop.id === selectedCropId ? null : crop.id)}
                      className={`flex cursor-pointer hover:bg-gray-50 border-b border-gray-100 ${
                        selectedCropId === crop.id ? 'bg-green-50' : ''
                      } ${crop.Deprecated ? 'opacity-50' : ''}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: ROW_HEIGHT,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {displayColumns.map(col => (
                        <div
                          key={col}
                          style={{ width: getColumnWidth(col), minWidth: getColumnWidth(col) }}
                          className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap border-r border-gray-50 last:border-r-0 truncate flex items-center"
                          title={String(crop[col as keyof Crop] ?? '')}
                        >
                          {formatValue(crop[col as keyof Crop])}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {sortedCrops.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500">
              No crops match your filters
            </div>
          )}
        </div>
      </div>

      {/* Column Manager Modal */}
      {showColumnManager && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
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
                <span className="text-sm text-gray-500 py-1">{filteredColumns.length} columns:</span>
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
                    <span className={`text-sm truncate ${visibleColumns.has(col) ? 'text-gray-900' : 'text-gray-500'}`}>{col}</span>
                  </label>
                ))}
              </div>
              {filteredColumns.length === 0 && <div className="text-center text-gray-500 py-8">No columns match</div>}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end">
              <button onClick={() => setShowColumnManager(false)} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedCrop && (
        <div className="fixed right-4 top-20 w-96 max-h-[calc(100vh-100px)] bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden z-40">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-green-50">
            <div>
              <h2 className="font-semibold text-gray-900">{selectedCrop.Crop}</h2>
              <p className="text-xs text-gray-500 font-mono">{selectedCrop.id}</p>
            </div>
            <button onClick={() => setSelectedCropId(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
          </div>
          <div className="overflow-y-auto max-h-[calc(100vh-200px)]">
            <div className="p-4 space-y-1">
              {allColumns.map(key => {
                const value = selectedCrop[key as keyof Crop];
                return (
                  <div key={key} className="flex py-1 border-b border-gray-50 last:border-0">
                    <span className="text-xs text-gray-500 w-36 flex-shrink-0 truncate" title={key}>{key}</span>
                    <span className="text-sm text-gray-900 break-all">{formatValue(value)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Resize overlays */}
      {(resizingColumn || resizingPane) && <div className="fixed inset-0 cursor-col-resize z-50" />}
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
        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
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
        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
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
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <span className="text-gray-400 text-xs">to</span>
        <input
          type="number"
          placeholder={String(range.max)}
          value={rangeVal.max ?? ''}
          onChange={(e) => onChange({ ...rangeVal, max: e.target.value ? Number(e.target.value) : undefined })}
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
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
      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
    />
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'boolean') return value ? '✓' : '–';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
  }
  return String(value);
}
