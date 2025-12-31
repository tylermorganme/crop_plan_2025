'use client';

/**
 * Sidebar with stats, filters, and controls.
 * All state changes go through dispatch - fully reactive.
 */

import { useAppState, useDispatch, useLevels } from '../store';
import type { StatusFilter, TypeFilter } from '../store';

export function Sidebar() {
  const dispatch = useDispatch();
  const { stats, currentTable, statusFilter, typeFilter, levelFilter, connected } = useAppState();
  const levels = useLevels();

  const progress = stats.total > 0
    ? ((stats.verified + stats.removed) / stats.total) * 100
    : 0;

  return (
    <div className="w-[220px] min-w-[220px] shrink-0 bg-[#14141e] text-white p-3 overflow-y-auto flex flex-col gap-3 border-r border-[#2a2a38]">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-sm font-semibold tracking-tight">DAG Reconciliation</h1>
        <span className={`px-3 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wide ${
          connected
            ? 'bg-cyan-400 text-[#0c0c12]'
            : 'bg-rose-500 text-white'
        }`}>
          {connected ? 'Live' : 'Offline'}
        </span>
      </div>

      {/* Table selector */}
      <div className="flex gap-2">
        <button
          className={`flex-1 p-2 border rounded-md text-xs font-medium cursor-pointer transition-all ${
            currentTable === 'crops'
              ? 'border-cyan-400 text-cyan-400 bg-cyan-400/10'
              : 'border-[#2a2a38] text-white bg-transparent hover:bg-[#252532]'
          }`}
          onClick={() => dispatch({ type: 'SET_TABLE', payload: 'crops' })}
        >
          Crops
        </button>
        <button
          className={`flex-1 p-2 border rounded-md text-xs font-medium cursor-pointer transition-all ${
            currentTable === 'bedplan'
              ? 'border-cyan-400 text-cyan-400 bg-cyan-400/10'
              : 'border-[#2a2a38] text-white bg-transparent hover:bg-[#252532]'
          }`}
          onClick={() => dispatch({ type: 'SET_TABLE', payload: 'bedplan' })}
        >
          BedPlan
        </button>
      </div>

      {/* Progress */}
      <section className="mb-2">
        <h2 className="text-xs font-semibold text-[#b8b8c8] uppercase tracking-wider mb-2.5">Progress</h2>
        <div className="h-1.5 bg-[#1c1c28] rounded-sm overflow-hidden mb-2">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 to-cyan-700 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="grid grid-cols-4 gap-1">
          <div className="bg-[#1c1c28] py-1.5 px-1 rounded-md text-center border border-[#2a2a38]">
            <div className="font-mono text-base font-semibold text-cyan-400">{stats.verified}</div>
            <div className="text-[9px] text-[#b8b8c8] uppercase tracking-tight mt-0.5">Verified</div>
          </div>
          <div className="bg-[#1c1c28] py-1.5 px-1 rounded-md text-center border border-[#2a2a38]">
            <div className="font-mono text-base font-semibold text-amber-400">{stats.pending}</div>
            <div className="text-[9px] text-[#b8b8c8] uppercase tracking-tight mt-0.5">Pending</div>
          </div>
          <div className="bg-[#1c1c28] py-1.5 px-1 rounded-md text-center border border-[#2a2a38]">
            <div className="font-mono text-base font-semibold text-rose-500">{stats.issues}</div>
            <div className="text-[9px] text-[#b8b8c8] uppercase tracking-tight mt-0.5">Issues</div>
          </div>
          <div className="bg-[#1c1c28] py-1.5 px-1 rounded-md text-center border border-[#2a2a38]">
            <div className="font-mono text-base font-semibold text-gray-500">{stats.removed}</div>
            <div className="text-[9px] text-[#b8b8c8] uppercase tracking-tight mt-0.5">Remove</div>
          </div>
        </div>
      </section>

      {/* Status filter */}
      <section className="mb-2">
        <h2 className="text-xs font-semibold text-[#b8b8c8] uppercase tracking-wider mb-2.5">Filter by Status</h2>
        <div className="flex gap-1.5 flex-wrap">
          {(['all', 'pending', 'verified', 'unverified', 'issues', 'skip', 'remove'] as StatusFilter[]).map(f => (
            <button
              key={f}
              className={`py-1 px-2 border rounded text-[11px] font-medium cursor-pointer transition-all ${
                statusFilter === f
                  ? 'bg-cyan-400 border-cyan-400 text-[#0c0c12]'
                  : 'bg-transparent border-[#2a2a38] text-white hover:bg-[#252532] hover:border-[#8888a0]'
              }`}
              onClick={() => dispatch({ type: 'SET_STATUS_FILTER', payload: f })}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {/* Type filter */}
      <section className="mb-2">
        <h2 className="text-xs font-semibold text-[#b8b8c8] uppercase tracking-wider mb-2.5">Filter by Type</h2>
        <div className="flex gap-1.5 flex-wrap">
          {(['INPUT', 'CALCULATED', 'MIXED', 'variance'] as (TypeFilter)[]).map(t => (
            <button
              key={t}
              className={`py-1 px-2 border rounded text-[11px] font-medium cursor-pointer transition-all ${
                typeFilter === t
                  ? 'bg-cyan-400 border-cyan-400 text-[#0c0c12]'
                  : 'bg-transparent border-[#2a2a38] text-white hover:bg-[#252532] hover:border-[#8888a0]'
              }`}
              onClick={() => dispatch({
                type: 'SET_TYPE_FILTER',
                payload: typeFilter === t ? null : t,
              })}
            >
              {t === 'variance' ? 'Has Variance' : t}
            </button>
          ))}
        </div>
      </section>

      {/* Level filter */}
      <section className="mb-2">
        <h2 className="text-xs font-semibold text-[#b8b8c8] uppercase tracking-wider mb-2.5">Filter by Level</h2>
        <div className="flex gap-1.5 flex-wrap">
          {levels.map(level => (
            <button
              key={level}
              className={`py-1 px-2 border rounded text-[11px] font-medium cursor-pointer transition-all ${
                levelFilter === level
                  ? 'bg-cyan-400 border-cyan-400 text-[#0c0c12]'
                  : 'bg-transparent border-[#2a2a38] text-white hover:bg-[#252532] hover:border-[#8888a0]'
              }`}
              onClick={() => dispatch({
                type: 'SET_LEVEL_FILTER',
                payload: levelFilter === level ? null : level,
              })}
            >
              L{level}
            </button>
          ))}
        </div>
      </section>

      {/* Legend - Node Classification */}
      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-semibold text-[#b8b8c8] uppercase tracking-wider mb-2.5">Node Classification</h2>
        <div className="flex items-center gap-2 text-[11px] py-0.5">
          <div className="w-3.5 h-3.5 rounded-sm shrink-0 bg-[#2d8659]" />
          <span>INPUT - static data</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] py-0.5">
          <div className="w-3.5 h-3.5 rounded-sm shrink-0 bg-[#3b82c4]" />
          <span>CALCULATED - formula</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] py-0.5">
          <div className="w-3.5 h-3.5 rounded-sm shrink-0 bg-[#c97a3a]" />
          <span>MIXED - needs review</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] py-0.5">
          <div className="w-3.5 h-3.5 rounded-sm shrink-0 bg-gray-500" />
          <span>EMPTY - unused</span>
        </div>
      </section>

      {/* Legend - Status Icons */}
      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-semibold text-[#b8b8c8] uppercase tracking-wider mb-2.5">Status Icons</h2>
        <div className="flex items-center gap-2 text-[11px] py-0.5">
          <div className="w-3.5 h-3.5 rounded-full shrink-0 bg-[#22c55e] flex items-center justify-center text-white text-[8px]">✓</div>
          <span>Verified (top-left)</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] py-0.5">
          <div className="w-3.5 h-3.5 rounded-full shrink-0 bg-[#ef4444] flex items-center justify-center text-white text-[8px]">✕</div>
          <span>Removed (top-right)</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] py-0.5">
          <div className="w-3.5 h-3.5 rounded-full shrink-0 bg-[#eab308] flex items-center justify-center text-white text-[8px]">▸</div>
          <span>Skip (top-right)</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] py-0.5">
          <div className="w-0 h-0 shrink-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-b-[12px] border-b-[#f97316] relative">
            <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-white text-[7px] font-bold">!</span>
          </div>
          <span>Has Issue (bottom-left)</span>
        </div>
      </section>

      {/* Legend - Borders */}
      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-semibold text-[#b8b8c8] uppercase tracking-wider mb-2.5">Borders</h2>
        <div className="flex items-center gap-2 text-[11px] py-0.5">
          <div className="w-3.5 h-3.5 rounded-sm shrink-0 bg-[#3b82c4] border-2 border-[#eab308]" />
          <span>Has Variance</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] py-0.5">
          <div className="w-3.5 h-3.5 rounded-sm shrink-0 bg-[#3b82c4]" style={{
            background: `repeating-linear-gradient(90deg, #22c55e 0px, #22c55e 2px, white 2px, white 4px)`,
            backgroundSize: '4px 100%'
          }} />
          <span>Implemented</span>
        </div>
      </section>
    </div>
  );
}
