'use client';

import { useState, useEffect, useRef } from 'react';
import { parseISO, format, addDays } from 'date-fns';

interface DateInputWithButtonsProps {
  value: string;
  displayValue?: string;
  onSave: (newValue: string) => void;
  className?: string;
  /**
   * Mode for the input:
   * - 'inline': Compact version for grid cells (shows display value, click to edit)
   * - 'input': Standard input field (always shows date picker)
   */
  mode?: 'inline' | 'input';
}

/**
 * Date input with +/- buttons to adjust by one day.
 * Can be used in two modes:
 * - inline: For grid cells (click to edit, shows formatted date)
 * - input: For detail panels (always shows date input)
 */
export function DateInputWithButtons({
  value,
  displayValue,
  onSave,
  className = '',
  mode = 'inline',
}: DateInputWithButtonsProps) {
  const [editing, setEditing] = useState(mode === 'input');
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current && mode === 'inline') {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing, mode]);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleBlur = () => {
    if (mode === 'inline') {
      setEditing(false);
    }
    if (editValue !== value) {
      onSave(editValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape' && mode === 'inline') {
      setEditValue(value);
      setEditing(false);
    }
  };

  const adjustDate = (days: number) => {
    if (!value) return;
    const date = parseISO(value);
    const newDate = addDays(date, days);
    const newValue = format(newDate, 'yyyy-MM-dd');
    onSave(newValue);
  };

  // Input mode (always shows date picker with buttons)
  if (mode === 'input' || editing) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            adjustDate(-1);
          }}
          className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded border border-gray-300"
          title="Previous day"
          type="button"
        >
          −
        </button>
        <input
          ref={inputRef}
          type="date"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={`flex-1 min-w-0 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            mode === 'input' ? 'border-gray-300' : 'border-blue-500'
          } ${className}`}
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            adjustDate(1);
          }}
          className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded border border-gray-300"
          title="Next day"
          type="button"
        >
          +
        </button>
      </div>
    );
  }

  // Inline mode (compact for grid)
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          adjustDate(-1);
        }}
        className="px-1 py-0.5 text-xs text-gray-600 hover:bg-gray-100 rounded"
        title="Previous day"
        type="button"
      >
        −
      </button>
      <div
        onClick={() => setEditing(true)}
        className={`flex-1 min-w-0 cursor-text hover:bg-blue-50 rounded truncate ${className}`}
      >
        {displayValue || value || <span className="text-gray-400">—</span>}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          adjustDate(1);
        }}
        className="px-1 py-0.5 text-xs text-gray-600 hover:bg-gray-100 rounded"
        title="Next day"
        type="button"
      >
        +
      </button>
    </div>
  );
}
