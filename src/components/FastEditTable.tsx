'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

// =============================================================================
// Types
// =============================================================================

export interface ColumnDef<T> {
  /** Unique key for this column */
  key: string;
  /** Header text */
  header: string;
  /** Column width in pixels */
  width: number;
  /** Is this column sortable? */
  sortable?: boolean;
  /** Is this column editable? If object, specifies edit config */
  editable?: boolean | {
    type: 'text' | 'number';
    min?: number;
    step?: number;
    placeholder?: string;
  };
  /** Text alignment */
  align?: 'left' | 'right';
  /** Get the raw value for this column from the row data */
  getValue: (row: T) => string | number | undefined | null;
  /** Format value for display (optional, defaults to getValue result) */
  format?: (row: T) => string;
}

export interface FastEditTableProps<T> {
  /** Row data */
  data: T[];
  /** Get unique key for each row */
  rowKey: (row: T) => string;
  /** Column definitions */
  columns: ColumnDef<T>[];
  /** Row height in pixels */
  rowHeight?: number;
  /** Header height in pixels */
  headerHeight?: number;
  /** Current sort column key */
  sortKey?: string | null;
  /** Current sort direction */
  sortDir?: 'asc' | 'desc';
  /** Called when sort changes */
  onSort?: (key: string) => void;
  /** Called when a cell value changes */
  onCellChange?: (rowKey: string, columnKey: string, newValue: string, row: T) => void;
  /** Render custom action buttons for a row */
  renderActions?: (row: T) => React.ReactNode;
  /** Width for actions column (0 to hide) */
  actionsWidth?: number;
  /** Empty state message */
  emptyMessage?: string;
}

// =============================================================================
// InlineCell - Click to edit, blur/enter to save
// =============================================================================

interface InlineCellProps {
  value: string;
  displayValue?: string;
  onSave: (newValue: string) => void;
  type?: 'text' | 'number';
  min?: number;
  step?: number;
  placeholder?: string;
  align?: 'left' | 'right';
}

function InlineCell({
  value,
  displayValue,
  onSave,
  type = 'text',
  min,
  step,
  placeholder = '—',
  align = 'left',
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
        className={`w-full h-full px-2 text-sm border border-blue-500 rounded focus:outline-none bg-white ${
          align === 'right' ? 'text-right' : ''
        }`}
      />
    );
  }

  const display = displayValue ?? value;

  return (
    <div
      onClick={() => setEditing(true)}
      className={`cursor-text hover:bg-blue-50 rounded px-2 h-full flex items-center truncate ${
        align === 'right' ? 'justify-end' : ''
      }`}
    >
      {display || <span className="text-gray-400">{placeholder}</span>}
    </div>
  );
}

// =============================================================================
// SortHeader - Clickable header with sort indicator
// =============================================================================

interface SortHeaderProps {
  label: string;
  sortKey: string;
  currentSortKey?: string | null;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  align?: 'left' | 'right';
}

function SortHeader({ label, sortKey, currentSortKey, sortDir, onSort, align }: SortHeaderProps) {
  const isActive = currentSortKey === sortKey;

  return (
    <button
      onClick={() => onSort?.(sortKey)}
      className={`text-xs font-medium uppercase tracking-wide flex items-center gap-1 hover:text-gray-900 w-full ${
        align === 'right' ? 'justify-end' : ''
      } ${isActive ? 'text-blue-600' : 'text-gray-600'}`}
    >
      {label}
      {isActive && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  );
}

// =============================================================================
// FastEditTable Component
// =============================================================================

export function FastEditTable<T>({
  data,
  rowKey,
  columns,
  rowHeight = 32,
  headerHeight = 36,
  sortKey,
  sortDir,
  onSort,
  onCellChange,
  renderActions,
  actionsWidth = 80,
  emptyMessage = 'No data',
}: FastEditTableProps<T>) {
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Virtualization
  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  // Calculate total content width
  const totalWidth = useMemo(() => {
    return columns.reduce((sum, col) => sum + col.width, 0) + (renderActions ? actionsWidth : 0);
  }, [columns, renderActions, actionsWidth]);

  // Render a cell based on column config
  const renderCell = useCallback(
    (row: T, col: ColumnDef<T>) => {
      const rawValue = col.getValue(row);
      const stringValue = rawValue?.toString() ?? '';
      const displayValue = col.format ? col.format(row) : stringValue;

      // Non-editable cell
      if (!col.editable) {
        return (
          <div
            className={`px-2 text-sm truncate h-full flex items-center ${
              col.align === 'right' ? 'justify-end' : ''
            }`}
            title={displayValue}
          >
            {displayValue || <span className="text-gray-400">—</span>}
          </div>
        );
      }

      // Editable cell
      const editConfig = typeof col.editable === 'object' ? col.editable : null;

      return (
        <InlineCell
          value={stringValue}
          displayValue={displayValue || undefined}
          onSave={(newValue) => onCellChange?.(rowKey(row), col.key, newValue, row)}
          type={editConfig?.type ?? 'text'}
          min={editConfig?.min}
          step={editConfig?.step}
          placeholder={editConfig?.placeholder}
          align={col.align}
        />
      );
    },
    [onCellChange, rowKey]
  );

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="bg-gray-100 border-b flex-shrink-0 overflow-hidden"
        style={{ height: headerHeight }}
      >
        <div className="flex items-center h-full" style={{ minWidth: totalWidth }}>
          {columns.map((col) => (
            <div
              key={col.key}
              className="px-2 flex-shrink-0"
              style={{ width: col.width }}
            >
              {col.sortable && onSort ? (
                <SortHeader
                  label={col.header}
                  sortKey={col.key}
                  currentSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  align={col.align}
                />
              ) : (
                <div
                  className={`text-xs font-medium uppercase tracking-wide text-gray-600 ${
                    col.align === 'right' ? 'text-right' : ''
                  }`}
                >
                  {col.header}
                </div>
              )}
            </div>
          ))}
          {renderActions && (
            <div className="flex-shrink-0" style={{ width: actionsWidth }} />
          )}
        </div>
      </div>

      {/* Body */}
      <div ref={tableContainerRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: rowVirtualizer.getTotalSize(),
            width: totalWidth,
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = data[virtualRow.index];
            const key = rowKey(row);

            return (
              <div
                key={key}
                className="flex items-center border-b border-gray-100 hover:bg-gray-50 group"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: rowHeight,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {columns.map((col) => (
                  <div
                    key={col.key}
                    className="flex-shrink-0 h-full"
                    style={{ width: col.width }}
                  >
                    {renderCell(row, col)}
                  </div>
                ))}
                {renderActions && (
                  <div
                    className="flex-shrink-0 px-2 flex items-center gap-1 opacity-0 group-hover:opacity-100"
                    style={{ width: actionsWidth }}
                  >
                    {renderActions(row)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default FastEditTable;
