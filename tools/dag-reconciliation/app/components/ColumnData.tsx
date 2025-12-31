'use client';

/**
 * Column Data panel - shows actual values from the selected column.
 * Displays unique values with counts and all rows.
 */

import { useState, useEffect } from 'react';
import { useSelectedColumn } from '../store';

interface ColumnValues {
  header: string;
  totalRows: number;
  uniqueCount: number;
  uniqueValues: Array<{ value: unknown; count: number }>;
  sampleValues: Array<{ rowNum: number; value: unknown }>;
}

export function ColumnData() {
  const column = useSelectedColumn();
  const [data, setData] = useState<ColumnValues | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'unique' | 'sample'>('sample');

  useEffect(() => {
    if (!column) {
      setData(null);
      return;
    }

    const columnId = column.id;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/column-values/${columnId}`);
        if (!res.ok) {
          throw new Error('Failed to fetch column data');
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [column?.id]);

  if (!column) {
    return (
      <div className="w-[280px] min-w-[280px] shrink-0 bg-[#14141e] p-3 border-l border-[#2a2a38] flex items-center justify-center text-[#b8b8c8] text-sm">
        <span>Select a column to view data</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-[280px] min-w-[280px] shrink-0 bg-[#14141e] p-3 border-l border-[#2a2a38]">
        <div className="text-cyan-400 text-sm font-semibold font-mono">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-[280px] min-w-[280px] shrink-0 bg-[#14141e] p-3 border-l border-[#2a2a38]">
        <div className="text-red-400 text-sm">Error: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-[280px] min-w-[280px] shrink-0 bg-[#14141e] p-3 border-l border-[#2a2a38]">
        <div className="text-[#b8b8c8] text-sm">No data</div>
      </div>
    );
  }

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'string') return value || '(empty string)';
    return JSON.stringify(value);
  };

  return (
    <div className="w-[280px] min-w-[280px] shrink-0 bg-[#14141e] p-3 border-l border-[#2a2a38] flex flex-col gap-2.5 overflow-y-auto">
      {/* Header */}
      <div className="text-cyan-400 text-sm font-semibold font-mono">{data.header}</div>

      {/* Stats */}
      <div className="text-xs text-[#b8b8c8] flex gap-2">
        <span>{data.totalRows} rows</span>
        <span className="text-[#4a4a5a]">•</span>
        <span>{data.uniqueCount} unique</span>
      </div>

      {/* View Toggle */}
      <div className="flex gap-1.5">
        <button
          className={`flex-1 py-1.5 px-2 border rounded text-xs font-medium cursor-pointer transition-all ${
            view === 'sample'
              ? 'bg-cyan-400 border-cyan-400 text-[#0c0c12]'
              : 'bg-transparent border-[#2a2a38] text-white hover:bg-[#252532]'
          }`}
          onClick={() => setView('sample')}
        >
          All Rows
        </button>
        <button
          className={`flex-1 py-1.5 px-2 border rounded text-xs font-medium cursor-pointer transition-all ${
            view === 'unique'
              ? 'bg-cyan-400 border-cyan-400 text-[#0c0c12]'
              : 'bg-transparent border-[#2a2a38] text-white hover:bg-[#252532]'
          }`}
          onClick={() => setView('unique')}
        >
          Unique
        </button>
      </div>

      {/* Data List */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-0.5">
        {view === 'unique' ? (
          data.uniqueValues.map((item, i) => (
            <div key={i} className="flex justify-between items-center py-1.5 px-2 bg-[#1c1c28] rounded text-xs gap-2">
              <span className="flex-1 font-mono text-[11px] text-white overflow-hidden text-ellipsis whitespace-nowrap">
                {formatValue(item.value)}
              </span>
              <span className="font-mono text-[11px] text-cyan-400 min-w-[30px] text-right">
                {item.count}
              </span>
            </div>
          ))
        ) : (
          data.sampleValues.map((item, i) => (
            <div key={i} className="flex items-center py-1.5 px-2 bg-[#1c1c28] rounded text-xs gap-2">
              <span className="text-[10px] text-gray-500 min-w-[50px]">Row {item.rowNum}</span>
              <span className="flex-1 font-mono text-[11px] text-white overflow-hidden text-ellipsis whitespace-nowrap">
                {formatValue(item.value)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
