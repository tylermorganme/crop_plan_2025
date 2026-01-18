'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  CollisionDetection,
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
import ImportBedsModal from '@/components/beds/ImportBedsModal';

export default function BedsPage() {
  const params = useParams();
  const planId = params.planId as string;

  const {
    currentPlan,
    loadPlanById,
    renameBed,
    addBed,
    upsertBeds,
    deleteBed,
    reorderBed,
    renameBedGroup,
    addBedGroup,
    deleteBedGroup,
    deleteBedGroupWithBeds,
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

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);

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

  // Count plantings referencing any bed in a group
  const getGroupPlantingCount = (groupId: string): number => {
    const bedIdsInGroup = new Set(
      Object.values(beds)
        .filter(b => b.groupId === groupId)
        .map(b => b.id)
    );
    return plantings.filter(p => p.startBed && bedIdsInGroup.has(p.startBed)).length;
  };

  // Stats
  const totalBeds = Object.keys(beds).length;
  const totalPlantings = plantings.filter(p => p.startBed !== null).length;

  // Get all bed IDs for sortable context
  const allBedIds = useMemo(() => Object.keys(beds), [beds]);
  const allGroupIds = useMemo(() => Object.keys(bedGroups), [bedGroups]);

  // Custom collision detection: when dragging a group, only detect collisions with other groups
  const customCollisionDetection: CollisionDetection = (args) => {
    const { active } = args;
    const activeIdStr = active.id as string;

    // If dragging a group, only allow collision with other groups
    if (bedGroups[activeIdStr]) {
      // Filter droppable containers to only groups
      const groupContainers = args.droppableContainers.filter(
        container => bedGroups[container.id as string]
      );
      return closestCenter({ ...args, droppableContainers: groupContainers });
    }

    // For beds, use pointer-based detection (more forgiving)
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    // Fallback to rect intersection
    return rectIntersection(args);
  };

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

  const handleDeleteGroup = async (action: 'cancel' | 'delete' | 'deleteWithBeds') => {
    if (action === 'cancel' || !deletingGroup) {
      setDeletingGroup(null);
      return;
    }

    try {
      if (action === 'deleteWithBeds') {
        await deleteBedGroupWithBeds(deletingGroup.id);
      } else {
        await deleteBedGroup(deletingGroup.id);
      }
      setDeletingGroup(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete group');
    }
  };

  // Build existingBeds for the import modal
  const existingBeds = useMemo(() => {
    return Object.values(beds).map(bed => ({
      id: bed.id,
      name: bed.name,
      groupName: bedGroups[bed.groupId]?.name ?? '',
      lengthFt: bed.lengthFt,
    }));
  }, [beds, bedGroups]);

  const handleImportBeds = async (
    beds: { name: string; group: string; length: number }[]
  ) => {
    // Single atomic operation - all changes saved together
    return upsertBeds(
      beds.map(b => ({ groupName: b.group, bedName: b.name, lengthFt: b.length }))
    );
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
    <div className="h-[calc(100vh-51px)] flex flex-col bg-gray-50 overflow-hidden">
      {/* Page subheader - fixed at top of view area */}
      <div className="bg-white border-b shadow-sm flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Manage Beds</h1>
                <p className="text-xs text-gray-500">
                  {sortedGroups.length} groups, {totalBeds} beds, {totalPlantings} assigned plantings
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Import CSV */}
              <button
                onClick={() => setShowImportModal(true)}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium"
              >
                Import CSV
              </button>

              {/* Add Group */}
              {addingGroup ? (
                <div className="flex items-center gap-2">
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
                    className="px-3 py-1.5 border rounded-md text-sm w-40"
                  />
                  <button
                    onClick={handleAddGroup}
                    className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setAddingGroup(false);
                      setNewGroupName('');
                    }}
                    className="px-2 py-1.5 text-gray-500 hover:text-gray-700 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingGroup(true)}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium"
                >
                  + Add Group
                </button>
              )}

              {/* Add Bed - dropdown to select group */}
              {sortedGroups.length > 0 && !addingBedToGroup && (
                <div className="relative">
                  <select
                    value=""
                    onChange={e => {
                      if (e.target.value) {
                        setAddingBedToGroup(e.target.value);
                      }
                    }}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium cursor-pointer appearance-none pr-8 hover:bg-blue-700"
                  >
                    <option value="" disabled>+ Add Bed</option>
                    {sortedGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-white">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M3 5l3 3 3-3" />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-700 font-medium"
            >
              Dismiss
            </button>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={customCollisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={allGroupIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-4">
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
                      />

                      {/* Inline add bed form */}
                      {addingBedToGroup === group.id && (
                        <div className="mx-4 mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                          <div className="flex items-center gap-3">
                            <input
                              type="text"
                              placeholder="Bed name"
                              value={newBedName}
                              onChange={e => setNewBedName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && newBedName.trim()) handleAddBed();
                                if (e.key === 'Escape') {
                                  setAddingBedToGroup(null);
                                  setNewBedName('');
                                  setNewBedLength(50);
                                }
                              }}
                              autoFocus
                              className="flex-1 px-3 py-1.5 border rounded-md text-sm"
                            />
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                value={newBedLength}
                                onChange={e => setNewBedLength(parseInt(e.target.value) || 50)}
                                className="w-16 px-2 py-1.5 border rounded-md text-sm text-center"
                                min={1}
                              />
                              <span className="text-sm text-gray-500">ft</span>
                            </div>
                            <button
                              onClick={handleAddBed}
                              disabled={!newBedName.trim()}
                              className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
                            >
                              Add Bed
                            </button>
                            <button
                              onClick={() => {
                                setAddingBedToGroup(null);
                                setNewBedName('');
                                setNewBedLength(50);
                              }}
                              className="px-2 py-1.5 text-gray-500 hover:text-gray-700 text-sm"
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

        {/* Empty state */}
        {sortedGroups.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p className="mb-4">No bed groups yet. Create your first group to get started.</p>
          </div>
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
          bedCount={getBedsForGroup(deletingGroup.id).length}
          plantingCount={getGroupPlantingCount(deletingGroup.id)}
          onAction={handleDeleteGroup}
        />
      )}

      {/* Import beds modal */}
      <ImportBedsModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImportBeds}
        existingGroups={sortedGroups.map(g => g.name)}
        existingBeds={existingBeds}
      />
    </div>
  );
}
