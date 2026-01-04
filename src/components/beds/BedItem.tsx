'use client';

import { useRef, useEffect } from 'react';
import type { Bed } from '@/lib/entities';

interface BedItemProps {
  bed: Bed;
  plantingCount: number;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

export default function BedItem({
  bed,
  plantingCount,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: BedItemProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.select();
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 bg-blue-50 rounded-lg">
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={e => onEditValueChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onSaveEdit();
            if (e.key === 'Escape') onCancelEdit();
          }}
          className="px-2 py-1 border rounded text-sm flex-1"
        />
        <button
          onClick={onSaveEdit}
          className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
        >
          Save
        </button>
        <button
          onClick={onCancelEdit}
          className="px-3 py-1 text-gray-500 hover:text-gray-700 text-sm"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50 group cursor-grab active:cursor-grabbing">
      {/* Drag handle indicator */}
      <div className="text-gray-300 group-hover:text-gray-400">
        <svg width="12" height="20" viewBox="0 0 12 20" fill="currentColor">
          <circle cx="3" cy="4" r="1.5" />
          <circle cx="9" cy="4" r="1.5" />
          <circle cx="3" cy="10" r="1.5" />
          <circle cx="9" cy="10" r="1.5" />
          <circle cx="3" cy="16" r="1.5" />
          <circle cx="9" cy="16" r="1.5" />
        </svg>
      </div>

      {/* Bed info */}
      <div className="flex-1 min-w-0">
        <span className="font-medium text-gray-900">{bed.name}</span>
        <span className="text-gray-400 text-sm ml-2">{bed.lengthFt} ft</span>
      </div>

      {/* Planting count */}
      <div className="text-sm text-gray-500">
        {plantingCount === 0 ? (
          <span className="text-gray-400 italic">no plantings</span>
        ) : (
          <span>{plantingCount} planting{plantingCount !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStartEdit();
          }}
          className="p-1.5 text-gray-400 hover:text-blue-600 rounded"
          title="Rename bed"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1.5 text-gray-400 hover:text-red-600 rounded"
          title="Delete bed"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3,6 5,6 21,6" />
            <path d="M19,6v14a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6m3,0V4a2,2 0 0,1,2-2h4a2,2 0 0,1,2,2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
