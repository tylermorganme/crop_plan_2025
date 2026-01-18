'use client';

import { useRef, useEffect, useCallback } from 'react';
import type { BedGroup } from '@/lib/entities';
import { useDragHandle } from './SortableGroupItem';

interface GroupHeaderProps {
  group: BedGroup;
  bedCount: number;
  isEditing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onAddBed: () => void;
  onDelete: () => void;
}

export default function GroupHeader({
  group,
  bedCount,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onAddBed,
  onDelete,
}: GroupHeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragHandle = useDragHandle();

  // Combine ref setter for drag handle
  const handleRef = useCallback((node: HTMLDivElement | null) => {
    if (dragHandle?.setActivatorNodeRef) {
      dragHandle.setActivatorNodeRef(node);
    }
  }, [dragHandle]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.select();
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-100 rounded-t-lg">
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
    <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-t-lg border-b">
      {/* Drag handle - only this element triggers group dragging */}
      <div
        ref={handleRef}
        {...(dragHandle?.attributes ?? {})}
        {...(dragHandle?.listeners ?? {})}
        className="text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing p-1 -m-1 rounded hover:bg-gray-200"
        title="Drag to reorder group"
      >
        <svg width="14" height="22" viewBox="0 0 12 20" fill="currentColor">
          <circle cx="3" cy="4" r="1.5" />
          <circle cx="9" cy="4" r="1.5" />
          <circle cx="3" cy="10" r="1.5" />
          <circle cx="9" cy="10" r="1.5" />
          <circle cx="3" cy="16" r="1.5" />
          <circle cx="9" cy="16" r="1.5" />
        </svg>
      </div>

      {/* Group name */}
      <div className="flex-1">
        <span className="font-semibold text-gray-800">{group.name}</span>
        <span className="text-sm text-gray-500 ml-2">
          ({bedCount} bed{bedCount !== 1 ? 's' : ''})
        </span>
      </div>

      {/* Actions - always visible */}
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddBed();
          }}
          className="px-2.5 py-1 text-blue-600 hover:bg-blue-50 rounded text-sm font-medium"
          title="Add bed to this group"
        >
          + Add Bed
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStartEdit();
          }}
          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-gray-100 rounded"
          title="Rename group"
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
          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 rounded"
          title="Delete group"
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
