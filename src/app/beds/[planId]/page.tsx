'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { usePlanStore } from '@/lib/plan-store';
import type { Bed, BedGroup } from '@/lib/entities';
import SortableBedItem from '@/components/beds/SortableBedItem';
import SortableGroupItem from '@/components/beds/SortableGroupItem';
import BedItem from '@/components/beds/BedItem';
import GroupHeader from '@/components/beds/GroupHeader';
import DeleteBedModal from '@/components/beds/DeleteBedModal';
import DeleteGroupModal from '@/components/beds/DeleteGroupModal';

export default function BedsPage() {
  const params = useParams();
  const router = useRouter();
  const planId = params.planId as string;

  const {
    currentPlan,
    loadPlanById,
    renameBed,
    addBed,
    deleteBed,
    reorderBed,
    renameBedGroup,
    addBedGroup,
    deleteBedGroup,
    reorderBedGroup,
    moveBedToGroup,
    deleteBedWithPlantings,
  } = usePlanStore();

  const [isLoading, setIsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<'bed' | 'group' | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Editing state
  const [editingBedId, setEditingBedId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Add forms
  const [addingBedToGroup, setAddingBedToGroup] = useState<string | null>(null);
  const [newBedName, setNewBedName] = useState('');
  const [newBedLength, setNewBedLength] = useState(50);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // Delete modals
  const [deletingBed, setDeletingBed] = useState<Bed | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<BedGroup | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Load plan on mount
  useEffect(() => {
    if (planId) {
      loadPlanById(planId).finally(() => setIsLoading(false));
    }
  }, [planId, loadPlanById]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const beds = currentPlan?.beds ?? {};
  const bedGroups = currentPlan?.bedGroups ?? {};
  const plantings = currentPlan?.plantings ?? [];

  // Sort groups by displayOrder
  const sortedGroups = useMemo(
    () => Object.values(bedGroups).sort((a, b) => a.displayOrder - b.displayOrder),
    [bedGroups]
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

  // Get all bed IDs for sortable context
  const allBedIds = useMemo(() => Object.keys(beds), [beds]);
  const allGroupIds = useMemo(() => Object.keys(bedGroups), [bedGroups]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const id = active.id as string;

    if (beds[id]) {
      setActiveId(id);
      setActiveType('bed');
    } else if (bedGroups[id]) {
      setActiveId(id);
      setActiveType('group');
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    setOverId(over?.id as string || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveType(null);
    setOverId(null);

    if (!over) return;

    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;

    if (activeIdStr === overIdStr) return;

    try {
      if (activeType === 'bed') {
        const activeBed = beds[activeIdStr];
        if (!activeBed) return;

        // Dropping on another bed
        if (beds[overIdStr]) {
          const overBed = beds[overIdStr];
          if (activeBed.groupId === overBed.groupId) {
            // Same group: reorder
            await reorderBed(activeIdStr, overBed.displayOrder);
          } else {
            // Different group: move to that group
            await moveBedToGroup(activeIdStr, overBed.groupId, overBed.displayOrder);
          }
        }
        // Dropping on a group header
        else if (bedGroups[overIdStr]) {
          if (activeBed.groupId !== overIdStr) {
            // Move to end of that group
            const bedsInGroup = getBedsForGroup(overIdStr);
            const maxOrder = bedsInGroup.length > 0
              ? Math.max(...bedsInGroup.map(b => b.displayOrder))
              : -1;
            await moveBedToGroup(activeIdStr, overIdStr, maxOrder + 1);
          }
        }
      } else if (activeType === 'group') {
        // Reorder groups
        if (bedGroups[overIdStr]) {
          const overGroup = bedGroups[overIdStr];
          await reorderBedGroup(activeIdStr, overGroup.displayOrder);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to move');
    }
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

  const handleDeleteBed = async (bed: Bed, action: 'cancel' | 'delete' | 'unassign') => {
    if (action === 'cancel') {
      setDeletingBed(null);
      return;
    }

    try {
      if (action === 'unassign') {
        await deleteBedWithPlantings(bed.id, 'unassign');
      } else {
        await deleteBed(bed.id);
      }
      setDeletingBed(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete bed');
    }
  };

  const handleDeleteGroup = async (action: 'cancel' | 'delete') => {
    if (action === 'cancel' || !deletingGroup) {
      setDeletingGroup(null);
      return;
    }

    try {
      await deleteBedGroup(deletingGroup.id);
      setDeletingGroup(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete group');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  if (!currentPlan) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Plan not found</div>
        </div>
      </div>
    );
  }

  const activeBed = activeId && activeType === 'bed' ? beds[activeId] : null;
  const activeGroup = activeId && activeType === 'group' ? bedGroups[activeId] : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manage Beds</h1>
            <p className="text-sm text-gray-500 mt-1">
              Drag beds to reorder within or between groups. Drag groups to reorder.
            </p>
          </div>
          <button
            onClick={() => router.push(`/timeline/${planId}`)}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
          >
            Back to Timeline
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-red-500 hover:text-red-700"
            >
              Dismiss
            </button>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={allGroupIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-6">
              {sortedGroups.map((group) => {
                const bedsInGroup = getBedsForGroup(group.id);
                const bedIds = bedsInGroup.map(b => b.id);

                return (
                  <SortableGroupItem key={group.id} id={group.id}>
                    <div className={`bg-white rounded-lg shadow-sm border ${
                      overId === group.id && activeType === 'bed' ? 'ring-2 ring-blue-400' : ''
                    }`}>
                      {/* Group header */}
                      <GroupHeader
                        group={group}
                        bedCount={bedsInGroup.length}
                        isEditing={editingGroupId === group.id}
                        editValue={editValue}
                        onEditValueChange={setEditValue}
                        onStartEdit={() => handleStartEditGroup(group)}
                        onSaveEdit={handleSaveEdit}
                        onCancelEdit={handleCancelEdit}
                        onAddBed={() => setAddingBedToGroup(group.id)}
                        onDelete={() => setDeletingGroup(group)}
                        canDelete={bedsInGroup.length === 0}
                      />

                      {/* Add bed form */}
                      {addingBedToGroup === group.id && (
                        <div className="mx-4 mb-4 p-3 bg-blue-50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <input
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
                              autoFocus
                              className="px-3 py-2 border rounded-md text-sm flex-1"
                            />
                            <select
                              value={newBedLength}
                              onChange={e => setNewBedLength(Number(e.target.value))}
                              className="px-3 py-2 border rounded-md text-sm"
                            >
                              <option value={20}>20 ft</option>
                              <option value={50}>50 ft</option>
                              <option value={80}>80 ft</option>
                            </select>
                            <button
                              onClick={handleAddBed}
                              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                            >
                              Add
                            </button>
                            <button
                              onClick={() => {
                                setAddingBedToGroup(null);
                                setNewBedName('');
                              }}
                              className="px-3 py-2 text-gray-500 hover:text-gray-700 text-sm"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Beds list */}
                      <SortableContext items={bedIds} strategy={verticalListSortingStrategy}>
                        <div className="px-4 pb-4">
                          {bedsInGroup.length === 0 ? (
                            <div className="text-sm text-gray-400 italic py-3 text-center">
                              No beds in this group. Add one or drag beds here.
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {bedsInGroup.map(bed => {
                                const plantingCount = getPlantingCount(bed.id);
                                return (
                                  <SortableBedItem key={bed.id} id={bed.id}>
                                    <BedItem
                                      bed={bed}
                                      plantingCount={plantingCount}
                                      isEditing={editingBedId === bed.id}
                                      editValue={editValue}
                                      onEditValueChange={setEditValue}
                                      onStartEdit={() => handleStartEditBed(bed)}
                                      onSaveEdit={handleSaveEdit}
                                      onCancelEdit={handleCancelEdit}
                                      onDelete={() => setDeletingBed(bed)}
                                    />
                                  </SortableBedItem>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </SortableContext>
                    </div>
                  </SortableGroupItem>
                );
              })}
            </div>
          </SortableContext>

          {/* Drag overlay */}
          <DragOverlay>
            {activeBed && (
              <div className="bg-white shadow-lg rounded-lg p-3 border-2 border-blue-400 opacity-90">
                <span className="font-medium">{activeBed.name}</span>
                <span className="text-gray-400 text-sm ml-2">{activeBed.lengthFt}ft</span>
              </div>
            )}
            {activeGroup && (
              <div className="bg-gray-100 shadow-lg rounded-lg px-4 py-3 border-2 border-blue-400 opacity-90">
                <span className="font-semibold text-gray-700">{activeGroup.name}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {/* Add group button */}
        <div className="mt-6">
          {addingGroup ? (
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center gap-3">
                <input
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
                  autoFocus
                  className="px-3 py-2 border rounded-md text-sm flex-1"
                />
                <button
                  onClick={handleAddGroup}
                  className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
                >
                  Add Group
                </button>
                <button
                  onClick={() => {
                    setAddingGroup(false);
                    setNewGroupName('');
                  }}
                  className="px-3 py-2 text-gray-500 hover:text-gray-700 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingGroup(true)}
              className="px-4 py-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              + Add Group
            </button>
          )}
        </div>
      </main>

      {/* Delete bed modal */}
      {deletingBed && (
        <DeleteBedModal
          bed={deletingBed}
          plantingCount={getPlantingCount(deletingBed.id)}
          onAction={(action) => handleDeleteBed(deletingBed, action)}
        />
      )}

      {/* Delete group modal */}
      {deletingGroup && (
        <DeleteGroupModal
          group={deletingGroup}
          onAction={handleDeleteGroup}
        />
      )}
    </div>
  );
}
