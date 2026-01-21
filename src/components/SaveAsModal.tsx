'use client';

import { useState, useEffect, useRef } from 'react';
import { Z_INDEX } from '@/lib/z-index';

interface SaveAsModalProps {
  isOpen: boolean;
  currentPlanName: string;
  onClose: () => void;
  onSave: (newName: string) => void;
}

export default function SaveAsModal({
  isOpen,
  currentPlanName,
  onClose,
  onSave,
}: SaveAsModalProps) {
  const [newName, setNewName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Generate a smart suggested name
  useEffect(() => {
    if (isOpen) {
      setNewName(generateSuggestedName(currentPlanName));
      // Focus and select input after render
      setTimeout(() => nameInputRef.current?.select(), 0);
    }
  }, [isOpen, currentPlanName]);

  function generateSuggestedName(name: string): string {
    // If name ends with (N), increment it
    const match = name.match(/^(.+?)\s*\((\d+)\)$/);
    if (match) {
      const base = match[1];
      const num = parseInt(match[2], 10);
      return `${base} (${num + 1})`;
    }

    // Otherwise append (1)
    return `${name} (1)`;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onSave(newName.trim());
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
        className="relative bg-white rounded-lg shadow-xl w-full max-w-sm mx-4"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Save As</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4">
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
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
