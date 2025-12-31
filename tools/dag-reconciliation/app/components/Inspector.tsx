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
    <div className="flex items-center gap-3">
      <div
        className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors duration-200 border ${
          checked ? 'border-transparent' : 'bg-[#252532] border-[#2a2a38]'
        }`}
        style={{ backgroundColor: checked ? color : undefined }}
        onClick={() => onChange(!checked)}
      >
        <div
          className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] bg-white rounded-full shadow transition-transform duration-200 ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </div>
      <span className="text-sm text-white flex-1">{label}</span>
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
      <div className="w-[260px] min-w-[260px] shrink-0 bg-[#14141e] p-3 border-l border-[#2a2a38] flex items-center justify-center text-[#b8b8c8] text-sm">
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
    <div className="w-[260px] min-w-[260px] shrink-0 bg-[#14141e] text-white p-3 overflow-y-auto flex flex-col gap-2.5 border-l border-[#2a2a38]">
      <h3 className="text-cyan-400 text-sm font-semibold mb-3">{column.header}</h3>

      {/* Detail rows */}
      <div className="flex justify-between text-[13px] py-2 border-b border-[#2a2a38]">
        <span className="text-[#b8b8c8]">Column</span>
        <span className="font-mono text-xs text-white">
          {column.col_letter} ({column.col_num})
        </span>
      </div>

      <div className="flex justify-between text-[13px] py-2 border-b border-[#2a2a38]">
        <span className="text-[#b8b8c8]">Classification</span>
        <span className="font-mono text-xs text-white">{column.classification}</span>
      </div>

      <div className="flex justify-between text-[13px] py-2 border-b border-[#2a2a38]">
        <span className="text-[#b8b8c8]">Level</span>
        <span className="font-mono text-xs text-white">{column.level}</span>
      </div>

      <div className="flex justify-between text-[13px] py-2 border-b border-[#2a2a38]">
        <span className="text-[#b8b8c8]">Row breakdown</span>
        <span className="font-mono text-xs text-white">
          {column.formula_count} formulas, {column.value_count} values
        </span>
      </div>

      <div className="flex justify-between text-[13px] py-2 border-b border-[#2a2a38]">
        <span className="text-[#b8b8c8]">Variance</span>
        <span className="font-mono text-xs text-white">
          {column.variance > 0 ? `${column.variance}%` : '0%'} ({column.unique_formulas} unique formulas)
        </span>
      </div>

      {/* Dependencies */}
      {column.depends_on.length > 0 && (
        <div className="mt-3">
          <div className="text-[13px] text-[#b8b8c8] font-semibold mb-2">Depends on:</div>
          <div className="flex flex-wrap gap-1.5">
            {column.depends_on.map(dep => (
              <span
                key={dep}
                className="inline-block py-1 px-2.5 bg-[#252532] rounded text-white font-mono text-[11px] cursor-pointer transition-colors hover:bg-cyan-400 hover:text-[#0c0c12]"
              >
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}

      {column.external_deps.length > 0 && (
        <div className="mt-3">
          <div className="text-[13px] text-[#b8b8c8] font-semibold mb-2">External deps:</div>
          <div className="flex flex-wrap gap-1.5">
            {column.external_deps.map(dep => (
              <span
                key={dep}
                className="inline-block py-1 px-2.5 bg-purple-500/20 rounded text-purple-400 font-mono text-[11px]"
              >
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Formula preview */}
      <div className="font-mono text-xs bg-[#1c1c28] p-3 rounded-md mt-3 break-all max-h-[100px] overflow-y-auto text-white border border-[#2a2a38]">
        {column.formula || 'No formula (input column)'}
      </div>

      {/* Toggle flags */}
      <div className="mt-4 flex flex-col gap-2.5">
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
      <div className="mt-3">
        <label className="block text-[13px] text-[#b8b8c8] font-medium mb-1.5">
          Maps to code field:
        </label>
        <input
          type="text"
          value={codeField}
          onChange={(e) => setCodeField(e.target.value)}
          onBlur={handleCodeFieldBlur}
          placeholder="e.g. crop.identifier"
          className="w-full py-2.5 px-3 bg-[#1c1c28] border border-[#2a2a38] rounded-md text-white text-sm transition-colors focus:outline-none focus:border-cyan-400"
        />
      </div>

      {/* Notes */}
      <div className="mt-3">
        <label className="block text-[13px] text-[#b8b8c8] font-medium mb-1.5">
          Notes:
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleNotesBlur}
          placeholder="Add notes..."
          className="w-full py-2.5 px-3 bg-[#1c1c28] border border-[#2a2a38] rounded-md text-white text-sm transition-colors focus:outline-none focus:border-cyan-400 resize-y min-h-[60px]"
        />
      </div>
    </div>
  );
}
