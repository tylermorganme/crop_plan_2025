'use client';

import { useMemo, useState, useCallback } from 'react';
import { usePlanStore } from '@/lib/plan-store';
import { useUIStore } from '@/lib/ui-store';
import { getTimelineCropsFromPlan } from '@/lib/timeline-data';
import { PlantingInspectorPanel } from './PlantingInspectorPanel';
import CreateSequenceModal, { CreateSequenceOptions } from './CreateSequenceModal';
import SequenceEditorModal from './SequenceEditorModal';

interface ConnectedPlantingInspectorProps {
  /** Show timing edit controls (default: true) */
  showTimingEdits?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Connected wrapper for PlantingInspectorPanel.
 *
 * Reads selection state from ui-store and plan data from plan-store,
 * wiring up all callbacks internally. This ensures consistent behavior
 * across all views (Timeline, Plantings, Overview).
 *
 * Includes sequence modals internally - no prop wiring needed from parent views.
 */
export function ConnectedPlantingInspector({
  showTimingEdits = true,
  className = '',
}: ConnectedPlantingInspectorProps) {
  // Plan store
  const currentPlan = usePlanStore((s) => s.currentPlan);
  const updatePlanting = usePlanStore((s) => s.updatePlanting);
  const bulkDeletePlantings = usePlanStore((s) => s.bulkDeletePlantings);
  const duplicatePlanting = usePlanStore((s) => s.duplicatePlanting);

  // Date operations from store
  const updateCropDates = usePlanStore((s) => s.updateCropDates);

  // Sequence operations from store
  const createSequenceFromPlanting = usePlanStore((s) => s.createSequenceFromPlanting);
  const updateSequenceOffset = usePlanStore((s) => s.updateSequenceOffset);
  const updateSequenceName = usePlanStore((s) => s.updateSequenceName);
  const reorderSequenceSlots = usePlanStore((s) => s.reorderSequenceSlots);
  const unlinkFromSequence = usePlanStore((s) => s.unlinkFromSequence);
  const getSequence = usePlanStore((s) => s.getSequence);
  const getSequencePlantings = usePlanStore((s) => s.getSequencePlantings);

  // UI store - shared selection state
  const selectedPlantingIds = useUIStore((s) => s.selectedPlantingIds);
  const togglePlanting = useUIStore((s) => s.togglePlanting);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const selectPlanting = useUIStore((s) => s.selectPlanting);

  // Modal state for sequences
  const [sequenceModalData, setSequenceModalData] = useState<{
    plantingId: string;
    cropName: string;
    fieldStartDate: string;
  } | null>(null);
  const [editingSequenceId, setEditingSequenceId] = useState<string | null>(null);

  // Convert selected IDs to TimelineCrop[]
  const allTimelineCrops = useMemo(() => {
    if (!currentPlan) return [];
    return getTimelineCropsFromPlan(currentPlan);
  }, [currentPlan]);

  const selectedCrops = useMemo(() => {
    if (selectedPlantingIds.size === 0) return [];
    return allTimelineCrops.filter(
      (crop) => crop.plantingId && selectedPlantingIds.has(crop.plantingId)
    );
  }, [selectedPlantingIds, allTimelineCrops]);

  // Sequence callbacks
  const handleCreateSequence = useCallback(
    (plantingId: string, cropName: string, fieldStartDate: string) => {
      setSequenceModalData({ plantingId, cropName, fieldStartDate });
    },
    []
  );

  const handleCreateSequenceSubmit = useCallback(
    async (options: CreateSequenceOptions) => {
      if (!sequenceModalData) return;
      await createSequenceFromPlanting(sequenceModalData.plantingId, options);
      setSequenceModalData(null);
    },
    [sequenceModalData, createSequenceFromPlanting]
  );

  const handleEditSequence = useCallback((sequenceId: string) => {
    setEditingSequenceId(sequenceId);
  }, []);

  const handleUnlinkFromSequence = useCallback(
    async (plantingId: string) => {
      await unlinkFromSequence(plantingId);
    },
    [unlinkFromSequence]
  );

  // For date changes in the inspector, use updateCropDates
  const handleCropDateChange = useCallback(
    async (groupId: string, startDate: string, endDate: string) => {
      await updateCropDates(groupId, startDate, endDate);
    },
    [updateCropDates]
  );

  // Editing sequence data
  const editingSequence = editingSequenceId ? getSequence(editingSequenceId) : undefined;
  const editingSequencePlantings = editingSequenceId
    ? getSequencePlantings(editingSequenceId)
    : [];

  // Don't render if nothing selected or no plan
  if (!currentPlan || selectedCrops.length === 0) {
    return null;
  }

  return (
    <>
      <PlantingInspectorPanel
        selectedCrops={selectedCrops}
        onDeselect={(id) => togglePlanting(id)}
        onClearSelection={() => clearSelection()}
        onUpdatePlanting={async (id, updates) => {
          await updatePlanting(id, updates);
        }}
        onDeleteCrop={async (groupIds) => {
          await bulkDeletePlantings(groupIds);
          clearSelection();
        }}
        onDuplicateCrop={async (id) => {
          const newId = await duplicatePlanting(id);
          clearSelection();
          selectPlanting(newId);
          return newId;
        }}
        onCropDateChange={(groupId, startDate, endDate) => {
          handleCropDateChange(groupId, startDate, endDate);
        }}
        onCreateSequence={handleCreateSequence}
        onEditSequence={handleEditSequence}
        onUnlinkFromSequence={handleUnlinkFromSequence}
        cropCatalog={currentPlan.cropCatalog}
        varieties={currentPlan.varieties}
        seedMixes={currentPlan.seedMixes}
        products={currentPlan.products}
        showTimingEdits={showTimingEdits}
        className={className}
      />

      {/* Create Sequence Modal */}
      {sequenceModalData && (
        <CreateSequenceModal
          isOpen={true}
          anchorFieldStartDate={sequenceModalData.fieldStartDate}
          cropName={sequenceModalData.cropName}
          onClose={() => setSequenceModalData(null)}
          onCreate={handleCreateSequenceSubmit}
        />
      )}

      {/* Sequence Editor Modal */}
      {editingSequence && currentPlan.cropCatalog && currentPlan.beds && (
        <SequenceEditorModal
          isOpen={true}
          sequence={editingSequence}
          plantings={editingSequencePlantings}
          cropCatalog={currentPlan.cropCatalog}
          beds={currentPlan.beds}
          onClose={() => setEditingSequenceId(null)}
          onUpdateOffset={async (newOffsetDays) => {
            await updateSequenceOffset(editingSequenceId!, newOffsetDays);
          }}
          onUpdateName={async (newName) => {
            await updateSequenceName(editingSequenceId!, newName);
          }}
          onUnlinkPlanting={async (plantingId) => {
            await unlinkFromSequence(plantingId);
          }}
          onReorderSlots={async (newSlotAssignments) => {
            await reorderSequenceSlots(editingSequenceId!, newSlotAssignments);
          }}
        />
      )}
    </>
  );
}
