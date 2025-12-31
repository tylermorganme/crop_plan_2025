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
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>DAG Reconciliation</h1>
        <span className={`status-indicator ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Live' : 'Offline'}
        </span>
      </div>

      {/* Table selector */}
      <div className="table-select">
        <button
          className={`table-btn ${currentTable === 'crops' ? 'active' : ''}`}
          onClick={() => dispatch({ type: 'SET_TABLE', payload: 'crops' })}
        >
          Crops
        </button>
        <button
          className={`table-btn ${currentTable === 'bedplan' ? 'active' : ''}`}
          onClick={() => dispatch({ type: 'SET_TABLE', payload: 'bedplan' })}
        >
          BedPlan
        </button>
      </div>

      {/* Progress */}
      <section>
        <h2>Progress</h2>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="stats">
          <div className="stat verified">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat pending">
            <div className="stat-value">{stats.pending}</div>
            <div className="stat-label">Pending</div>
          </div>
          <div className="stat issues">
            <div className="stat-value">{stats.issues}</div>
            <div className="stat-label">Issues</div>
          </div>
          <div className="stat removed">
            <div className="stat-value">{stats.removed}</div>
            <div className="stat-label">Remove</div>
          </div>
        </div>
      </section>

      {/* Status filter */}
      <section>
        <h2>Filter by Status</h2>
        <div className="filter-group">
          {(['all', 'pending', 'verified', 'unverified', 'issues', 'skip', 'remove'] as StatusFilter[]).map(f => (
            <button
              key={f}
              className={`filter-btn ${statusFilter === f ? 'active' : ''}`}
              onClick={() => dispatch({ type: 'SET_STATUS_FILTER', payload: f })}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {/* Type filter */}
      <section>
        <h2>Filter by Type</h2>
        <div className="filter-group">
          {(['INPUT', 'CALCULATED', 'MIXED', 'variance'] as (TypeFilter)[]).map(t => (
            <button
              key={t}
              className={`filter-btn ${typeFilter === t ? 'active' : ''}`}
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
      <section>
        <h2>Filter by Level</h2>
        <div className="filter-group">
          {levels.map(level => (
            <button
              key={level}
              className={`filter-btn ${levelFilter === level ? 'active' : ''}`}
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

      {/* Legend */}
      <section className="legend">
        <h2>Node Classification</h2>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#2d8659' }} />
          <span>INPUT - static data</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#3b82c4' }} />
          <span>CALCULATED - formula</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#c97a3a' }} />
          <span>MIXED - needs review</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#6b7280' }} />
          <span>EMPTY - unused</span>
        </div>
      </section>

      <section className="legend">
        <h2>Border Status</h2>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#3b82c4', border: '2px dashed #00ff88' }} />
          <span>Verified</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#3b82c4', border: '2px dashed #ff3366' }} />
          <span>Has Issue</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#3b82c4', border: '2px dashed #ffee00' }} />
          <span>Has Variance</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ background: '#3b82c4', border: '2px dashed #a855f7' }} />
          <span>Skip for now</span>
        </div>
      </section>
    </div>
  );
}
