'use client';

import { useState, useEffect, useRef } from 'react';
import { usePlanStore } from '@/lib/plan-store';
import type { Bed, BedGroup } from '@/lib/plan-types';

interface BedManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BedManager({ isOpen, onClose }: BedManagerProps) {
  const {
    currentPlan,
    renameBed,
    addBed,
    deleteBed,
    reorderBed,
    renameBedGroup,
    addBedGroup,
    deleteBedGroup,
    reorderBedGroup,
  } = usePlanStore();

  const [editingBedId, setEditingBedId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [addingBedToGroup, setAddingBedToGroup] = useState<string | null>(null);
  const [newBedName, setNewBedName] = useState('');
  const [newBedLength, setNewBedLength] = useState(50);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const editInputRef = useRef<HTMLInputElement>(null);
  const addBedInputRef = useRef<HTMLInputElement>(null);
  const addGroupInputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingBedId || editingGroupId) {
      editInputRef.current?.select();
    }
  }, [editingBedId, editingGroupId]);

  useEffect(() => {
    if (addingBedToGroup) {
      addBedInputRef.current?.focus();
    }
  }, [addingBedToGroup]);

  useEffect(() => {
    if (addingGroup) {
      addGroupInputRef.current?.focus();
    }
  }, [addingGroup]);

  if (!isOpen) return null;

  const beds = currentPlan?.beds ?? {};
  const bedGroups = currentPlan?.bedGroups ?? {};
  const plantings = currentPlan?.plantings ?? [];

  // Sort groups by displayOrder
  const sortedGroups = Object.values(bedGroups).sort(
    (a, b) => a.displayOrder - b.displayOrder
  );

  // Get beds for a group, sorted by displayOrder
  const getBedsForGroup = (groupId: string): Bed[] => {
    return Object.values(beds)
      .filter(b => b.groupId === groupId)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  };

  // Count plantings referencing a bed
  const getPlantingCount = (bedId: string): number => {
    return plantings.filter(p => p.startBed === bedId).length;
  };

  const handleStartEditBed = (bed: Bed) => {
    setEditingBedId(bed.id);
    setEditingGroupId(null);
    setEditValue(bed.name);
    setError(null);
  };

  const handleStartEditGroup = (group: BedGroup) => {
    setEditingGroupId(group.id);
    setEditingBedId(null);
    setEditValue(group.name);
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (!editValue.trim()) {
      setError('Name cannot be empty');
      return;
    }

    try {
      if (editingBedId) {
        await renameBed(editingBedId, editValue.trim());
      } else if (editingGroupId) {
        await renameBedGroup(editingGroupId, editValue.trim());
      }
      setEditingBedId(null);
      setEditingGroupId(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
  };

  const handleCancelEdit = () => {
    setEditingBedId(null);
    setEditingGroupId(null);
    setError(null);
  };

  const handleDeleteBed = async (bedId: string) => {
    try {
      await deleteBed(bedId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await deleteBedGroup(groupId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const handleMoveBed = async (bedId: string, direction: 'up' | 'down') => {
    const bed = beds[bedId];
    if (!bed) return;

    const bedsInGroup = getBedsForGroup(bed.groupId);
    const currentIndex = bedsInGroup.findIndex(b => b.id === bedId);

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= bedsInGroup.length) return;

    try {
      await reorderBed(bedId, bedsInGroup[newIndex].displayOrder);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reorder');
    }
  };

  const handleMoveGroup = async (groupId: string, direction: 'up' | 'down') => {
    const group = bedGroups[groupId];
    if (!group) return;

    const currentIndex = sortedGroups.findIndex(g => g.id === groupId);
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= sortedGroups.length) return;

    try {
      await reorderBedGroup(groupId, sortedGroups[newIndex].displayOrder);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reorder');
    }
  };

  const handleAddBed = async () => {
    if (!addingBedToGroup || !newBedName.trim()) return;

    try {
      await addBed(addingBedToGroup, newBedName.trim(), newBedLength);
      setAddingBedToGroup(null);
      setNewBedName('');
      setNewBedLength(50);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add bed');
    }
  };

  const handleAddGroup = async () => {
    if (!newGroupName.trim()) return;

    try {
      await addBedGroup(newGroupName.trim());
      setAddingGroup(false);
      setNewGroupName('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add group');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Manage Beds</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl"
          >
            ×
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {sortedGroups.map((group, groupIndex) => {
            const bedsInGroup = getBedsForGroup(group.id);

            return (
              <div key={group.id} className="mb-6">
                {/* Group header */}
                <div className="flex items-center gap-2 mb-2">
                  {editingGroupId === group.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveEdit();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        className="px-2 py-1 border rounded text-sm flex-1"
                      />
                      <button
                        onClick={handleSaveEdit}
                        className="text-green-600 hover:text-green-800 text-sm"
                      >
                        ✓
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="text-gray-400 hover:text-gray-600 text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      <span
                        className="font-medium text-gray-700 cursor-pointer hover:text-blue-600"
                        onClick={() => handleStartEditGroup(group)}
                        title="Click to rename"
                      >
                        {group.name}
                      </span>
                      <span className="text-xs text-gray-400">
                        ({bedsInGroup.length} beds)
                      </span>
                      <div className="flex-1" />
                      <button
                        onClick={() => handleMoveGroup(group.id, 'up')}
                        disabled={groupIndex === 0}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm px-1"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => handleMoveGroup(group.id, 'down')}
                        disabled={groupIndex === sortedGroups.length - 1}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm px-1"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => setAddingBedToGroup(group.id)}
                        className="text-blue-500 hover:text-blue-700 text-sm px-2"
                        title="Add bed to this group"
                      >
                        + Bed
                      </button>
                      <button
                        onClick={() => handleDeleteGroup(group.id)}
                        disabled={bedsInGroup.length > 0}
                        className="text-red-400 hover:text-red-600 disabled:opacity-30 text-sm px-1"
                        title={bedsInGroup.length > 0 ? 'Remove all beds first' : 'Delete group'}
                      >
                        🗑
                      </button>
                    </>
                  )}
                </div>

                {/* Add bed form */}
                {addingBedToGroup === group.id && (
                  <div className="flex items-center gap-2 ml-4 mb-2 p-2 bg-blue-50 rounded">
                    <input
                      ref={addBedInputRef}
                      type="text"
                      placeholder="Bed name"
                      value={newBedName}
                      onChange={e => setNewBedName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleAddBed();
                        if (e.key === 'Escape') {
                          setAddingBedToGroup(null);
                          setNewBedName('');
                        }
                      }}
                      className="px-2 py-1 border rounded text-sm w-32"
                    />
                    <select
                      value={newBedLength}
                      onChange={e => setNewBedLength(Number(e.target.value))}
                      className="px-2 py-1 border rounded text-sm"
                    >
                      <option value={20}>20 ft</option>
                      <option value={50}>50 ft</option>
                      <option value={80}>80 ft</option>
                    </select>
                    <button
                      onClick={handleAddBed}
                      className="text-green-600 hover:text-green-800 text-sm px-2"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setAddingBedToGroup(null);
                        setNewBedName('');
                      }}
                      className="text-gray-400 hover:text-gray-600 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Beds list */}
                <div className="ml-4 space-y-1">
                  {bedsInGroup.map((bed, bedIndex) => {
                    const plantingCount = getPlantingCount(bed.id);

                    return (
                      <div
                        key={bed.id}
                        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-50"
                      >
                        {editingBedId === bed.id ? (
                          <div className="flex items-center gap-2 flex-1">
                            <input
                              ref={editInputRef}
                              type="text"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveEdit();
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              className="px-2 py-1 border rounded text-sm flex-1"
                            />
                            <button
                              onClick={handleSaveEdit}
                              className="text-green-600 hover:text-green-800 text-sm"
                            >
                              ✓
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="text-gray-400 hover:text-gray-600 text-sm"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <>
                            <span
                              className="text-sm cursor-pointer hover:text-blue-600"
                              onClick={() => handleStartEditBed(bed)}
                              title="Click to rename"
                            >
                              {bed.name}
                            </span>
                            <span className="text-xs text-gray-400">
                              {bed.lengthFt}ft
                            </span>
                            {plantingCount > 0 && (
                              <span className="text-xs text-gray-400">
                                ({plantingCount} plantings)
                              </span>
                            )}
                            <div className="flex-1" />
                            <button
                              onClick={() => handleMoveBed(bed.id, 'up')}
                              disabled={bedIndex === 0}
                              className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-xs px-1"
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => handleMoveBed(bed.id, 'down')}
                              disabled={bedIndex === bedsInGroup.length - 1}
                              className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-xs px-1"
                              title="Move down"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => handleDeleteBed(bed.id)}
                              disabled={plantingCount > 0}
                              className="text-red-400 hover:text-red-600 disabled:opacity-30 text-xs px-1"
                              title={plantingCount > 0 ? 'Unassign plantings first' : 'Delete bed'}
                            >
                              🗑
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}

                  {bedsInGroup.length === 0 && (
                    <div className="text-sm text-gray-400 italic py-1">
                      No beds in this group
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add group form */}
          {addingGroup ? (
            <div className="flex items-center gap-2 p-2 bg-green-50 rounded">
              <input
                ref={addGroupInputRef}
                type="text"
                placeholder="Group name"
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddGroup();
                  if (e.key === 'Escape') {
                    setAddingGroup(false);
                    setNewGroupName('');
                  }
                }}
                className="px-2 py-1 border rounded text-sm flex-1"
              />
              <button
                onClick={handleAddGroup}
                className="text-green-600 hover:text-green-800 text-sm px-2"
              >
                Add Group
              </button>
              <button
                onClick={() => {
                  setAddingGroup(false);
                  setNewGroupName('');
                }}
                className="text-gray-400 hover:text-gray-600 text-sm"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingGroup(true)}
              className="text-blue-500 hover:text-blue-700 text-sm"
            >
              + Add Group
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
