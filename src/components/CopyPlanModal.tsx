'use client';

import { useState, useEffect, useRef } from 'react';
import { addYears, addMonths, format, parseISO, isValid } from 'date-fns';
import { Z_INDEX } from '@/lib/z-index';

interface CopyPlanModalProps {
  isOpen: boolean;
  currentPlanName: string;
  onClose: () => void;
  onCopy: (options: CopyPlanOptions) => void;
}

export interface CopyPlanOptions {
  newName: string;
  shiftDates: boolean;
  shiftAmount: number;
  shiftUnit: 'years' | 'months';
  unassignAll: boolean;
}

/**
 * Shift a date string (ISO format) by the specified amount.
 * Handles edge cases like Feb 29 -> Feb 28 for non-leap years.
 * Handles both 'yyyy-MM-dd' and 'yyyy-MM-ddTHH:mm:ss' formats.
 */
export function shiftDate(
  dateStr: string,
  amount: number,
  unit: 'years' | 'months'
): string {
  const date = parseISO(dateStr);
  if (!isValid(date)) {
    return dateStr; // Return original if parse fails
  }

  const shifted = unit === 'years' ? addYears(date, amount) : addMonths(date, amount);

  // Preserve the original format
  if (dateStr.includes('T')) {
    return format(shifted, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return format(shifted, 'yyyy-MM-dd');
}

export default function CopyPlanModal({
  isOpen,
  currentPlanName,
  onClose,
  onCopy,
}: CopyPlanModalProps) {
  const [newName, setNewName] = useState('');
  const [shiftDates, setShiftDates] = useState(true);
  const [shiftAmount, setShiftAmount] = useState(1);
  const [shiftUnit, setShiftUnit] = useState<'years' | 'months'>('years');
  const [unassignAll, setUnassignAll] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Suggest a name with incremented year
  useEffect(() => {
    if (isOpen) {
      // Try to detect year in name and increment it
      const yearMatch = currentPlanName.match(/(\d{4})/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        const suggestedName = currentPlanName.replace(
          yearMatch[1],
          String(year + 1)
        );
        setNewName(suggestedName);
      } else {
        setNewName(`${currentPlanName} (Copy)`);
      }
      // Focus input after render
      setTimeout(() => nameInputRef.current?.select(), 0);
    }
  }, [isOpen, currentPlanName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    onCopy({
      newName: newName.trim(),
      shiftDates,
      shiftAmount: shiftDates ? shiftAmount : 0,
      shiftUnit,
      unassignAll,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Copy Plan</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-4">
            {/* Name input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                New plan name
              </label>
              <input
                ref={nameInputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter plan name"
              />
            </div>

            {/* Shift dates option */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shiftDates}
                  onChange={(e) => setShiftDates(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">
                  Shift all dates forward
                </span>
              </label>

              {shiftDates && (
                <div className="ml-6 flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={shiftAmount}
                    onChange={(e) => setShiftAmount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-16 px-2 py-1 text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={shiftUnit}
                    onChange={(e) => setShiftUnit(e.target.value as 'years' | 'months')}
                    className="px-2 py-1 text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="years">year(s)</option>
                    <option value="months">month(s)</option>
                  </select>
                </div>
              )}
            </div>

            {/* Unassign all option */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={unassignAll}
                  onChange={(e) => setUnassignAll(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">
                  Unassign all crops
                </span>
              </label>
              <p className="ml-6 text-xs text-gray-600 mt-1">
                Move all crops to the Unassigned section for fresh bed planning
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3 rounded-b-lg">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newName.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Copy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
