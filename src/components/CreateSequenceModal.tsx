'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { addDays, format, parseISO, isValid } from 'date-fns';
import { Z_INDEX } from '@/lib/z-index';

export interface CreateSequenceOptions {
  count: number;
  offsetDays: number;
  name?: string;
  bedAssignment: 'same' | 'unassigned';
}

interface CreateSequenceModalProps {
  isOpen: boolean;
  anchorFieldStartDate: string;
  cropName: string;
  onClose: () => void;
  onCreate: (options: CreateSequenceOptions) => void;
}

export default function CreateSequenceModal({
  isOpen,
  anchorFieldStartDate,
  cropName,
  onClose,
  onCreate,
}: CreateSequenceModalProps) {
  const [count, setCount] = useState(5);
  const [offsetDays, setOffsetDays] = useState(7);
  const [name, setName] = useState('');
  const [bedAssignment, setBedAssignment] = useState<'same' | 'unassigned'>('unassigned');
  const countInputRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setCount(5);
      setOffsetDays(7);
      setName('');
      setBedAssignment('unassigned');
      setTimeout(() => countInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Calculate preview dates
  const previewDates = useMemo(() => {
    const anchorDate = parseISO(anchorFieldStartDate);
    if (!isValid(anchorDate)) return [];

    const dates: string[] = [];
    for (let i = 0; i < Math.min(count, 10); i++) {
      const date = addDays(anchorDate, i * offsetDays);
      dates.push(format(date, 'MMM d'));
    }
    return dates;
  }, [anchorFieldStartDate, count, offsetDays]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (count < 2 || count > 20) return;
    if (offsetDays < 1 || offsetDays > 90) return;

    onCreate({
      count,
      offsetDays,
      name: name.trim() || undefined,
      bedAssignment,
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
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Create Succession Planting</h2>
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
            {/* Crop info */}
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-3">{cropName}</h3>
            </div>

            {/* Count and offset on one line */}
            <div className="flex items-start gap-6">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">
                  Number of plantings
                </label>
                <div className="flex items-center gap-1">
                  <input
                    ref={countInputRef}
                    type="number"
                    min="2"
                    max="20"
                    value={count}
                    onChange={(e) => setCount(Math.max(2, Math.min(20, parseInt(e.target.value, 10) || 2)))}
                    className="w-16 px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => setCount(Math.min(20, count + 1))}
                      className="px-2 py-0.5 text-xs leading-none text-gray-600 hover:bg-gray-100 rounded border border-gray-300"
                      title="Increase"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => setCount(Math.max(2, count - 1))}
                      className="px-2 py-0.5 text-xs leading-none text-gray-600 hover:bg-gray-100 rounded border border-gray-300"
                      title="Decrease"
                    >
                      ▼
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">
                  Days between each planting
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={offsetDays}
                    onChange={(e) => setOffsetDays(Math.max(1, Math.min(90, parseInt(e.target.value, 10) || 7)))}
                    className="w-16 px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => setOffsetDays(Math.min(90, offsetDays + 1))}
                      className="px-2 py-0.5 text-xs leading-none text-gray-600 hover:bg-gray-100 rounded border border-gray-300"
                      title="Increase"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => setOffsetDays(Math.max(1, offsetDays - 1))}
                      className="px-2 py-0.5 text-xs leading-none text-gray-600 hover:bg-gray-100 rounded border border-gray-300"
                      title="Decrease"
                    >
                      ▼
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Bed assignment */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Bed assignment for new plantings
              </label>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="bedAssignment"
                    value="unassigned"
                    checked={bedAssignment === 'unassigned'}
                    onChange={() => setBedAssignment('unassigned')}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Unassigned</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="bedAssignment"
                    value="same"
                    checked={bedAssignment === 'same'}
                    onChange={() => setBedAssignment('same')}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Original</span>
                </label>
              </div>
            </div>

            {/* Name (optional) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sequence name <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Spring Cilantro"
                className="w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Preview */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Preview
              </label>
              <div className="bg-gray-50 rounded-md p-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  {previewDates.map((date, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center px-2 py-1 rounded ${
                        i === 0
                          ? 'bg-purple-100 text-purple-800 font-medium'
                          : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      #{i + 1}: {date}
                    </span>
                  ))}
                  {count > 10 && (
                    <span className="text-gray-500">...and {count - 10} more</span>
                  )}
                </div>
              </div>
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
              disabled={count < 2 || count > 20 || offsetDays < 1 || offsetDays > 90}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Sequence
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
