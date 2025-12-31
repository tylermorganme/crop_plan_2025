'use client';

/**
 * Inspector panel for viewing and editing column details.
 * Updates are sent to API and reflected in state via SSE.
 */

import { useState, useEffect } from 'react';
import { useSelectedColumn, useDispatch } from '../store';
import type { Column } from '../store';
import { updateColumn } from '../api';

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  color?: string;
}

function Toggle({ label, checked, onChange, color = '#22d3ee' }: ToggleProps) {
  return (
    <div className="flag-row">
      <div
        className={`flag-toggle ${checked ? 'active' : ''}`}
        style={{ '--toggle-color': color } as React.CSSProperties}
        onClick={() => onChange(!checked)}
      />
      <span className="flag-label">{label}</span>
    </div>
  );
}

export function Inspector() {
  const dispatch = useDispatch();
  const column = useSelectedColumn();
  const [notes, setNotes] = useState('');
  const [codeField, setCodeField] = useState('');

  // Sync local state with selected column
  useEffect(() => {
    if (column) {
      setNotes(column.notes || '');
      setCodeField(column.code_field || '');
    }
  }, [column?.id, column?.notes, column?.code_field]);

  if (!column) {
    return (
      <div className="inspector empty">
        <span>Click a node to inspect</span>
      </div>
    );
  }

  const handleToggle = async (field: keyof Column, value: boolean) => {
    // Optimistic update
    dispatch({
      type: 'UPDATE_COLUMN',
      payload: { id: column.id, [field]: value },
    });

    try {
      await updateColumn(column.id, { [field]: value });
    } catch (e) {
      console.error('Failed to update column:', e);
      // Revert on error
      dispatch({
        type: 'UPDATE_COLUMN',
        payload: { id: column.id, [field]: !value },
      });
    }
  };

  const handleNotesBlur = async () => {
    if (notes !== column.notes) {
      dispatch({
        type: 'UPDATE_COLUMN',
        payload: { id: column.id, notes },
      });
      try {
        await updateColumn(column.id, { notes });
      } catch (e) {
        console.error('Failed to update notes:', e);
      }
    }
  };

  const handleCodeFieldBlur = async () => {
    if (codeField !== column.code_field) {
      dispatch({
        type: 'UPDATE_COLUMN',
        payload: { id: column.id, code_field: codeField },
      });
      try {
        await updateColumn(column.id, { code_field: codeField });
      } catch (e) {
        console.error('Failed to update code field:', e);
      }
    }
  };

  return (
    <div className="inspector">
      <h3 className="detail-header">{column.header}</h3>

      <div className="detail-row">
        <span className="detail-label">Column</span>
        <span className="detail-value">
          {column.col_letter} ({column.col_num})
        </span>
      </div>

      <div className="detail-row">
        <span className="detail-label">Classification</span>
        <span className="detail-value">{column.classification}</span>
      </div>

      <div className="detail-row">
        <span className="detail-label">Level</span>
        <span className="detail-value">{column.level}</span>
      </div>

      <div className="detail-row">
        <span className="detail-label">Row breakdown</span>
        <span className="detail-value">
          {column.formula_count} formulas, {column.value_count} values
        </span>
      </div>

      <div className="detail-row">
        <span className="detail-label">Variance</span>
        <span className="detail-value">
          {column.variance > 0 ? `${column.variance}%` : '0%'} ({column.unique_formulas} unique formulas)
        </span>
      </div>

      {/* Dependencies */}
      {column.depends_on.length > 0 && (
        <div className="deps-section">
          <div className="deps-title">Depends on:</div>
          <div className="deps-list">
            {column.depends_on.map(dep => (
              <span key={dep} className="dep-tag">{dep}</span>
            ))}
          </div>
        </div>
      )}

      {column.external_deps.length > 0 && (
        <div className="deps-section">
          <div className="deps-title">External deps:</div>
          <div className="deps-list">
            {column.external_deps.map(dep => (
              <span key={dep} className="dep-tag external">{dep}</span>
            ))}
          </div>
        </div>
      )}

      {/* Formula preview */}
      <div className="formula-preview">
        {column.formula || 'No formula (input column)'}
      </div>

      {/* Toggle flags */}
      <div className="flag-toggles">
        <Toggle
          label="Verified"
          checked={column.verified}
          onChange={(v) => handleToggle('verified', v)}
          color="#22d3ee"
        />
        <Toggle
          label="Remove"
          checked={column.remove}
          onChange={(v) => handleToggle('remove', v)}
          color="#6b7280"
        />
        <Toggle
          label="Has Issue"
          checked={column.has_issue}
          onChange={(v) => handleToggle('has_issue', v)}
          color="#f43f5e"
        />
        <Toggle
          label="Implemented"
          checked={column.implemented}
          onChange={(v) => handleToggle('implemented', v)}
          color="#a78bfa"
        />
        <Toggle
          label="Skip for now"
          checked={column.skip}
          onChange={(v) => handleToggle('skip', v)}
          color="#a855f7"
        />
      </div>

      {/* Code field mapping */}
      <div className="input-group">
        <label>Maps to code field:</label>
        <input
          type="text"
          value={codeField}
          onChange={(e) => setCodeField(e.target.value)}
          onBlur={handleCodeFieldBlur}
          placeholder="e.g. crop.identifier"
        />
      </div>

      {/* Notes */}
      <div className="input-group">
        <label>Notes:</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleNotesBlur}
          placeholder="Add notes..."
        />
      </div>
    </div>
  );
}
