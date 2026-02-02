'use client';

import { useMemo, useState, useCallback } from 'react';
import { usePlanStore } from '@/lib/plan-store';
import { useUIStore } from '@/lib/ui-store';
import { useComputedCrops } from '@/lib/use-computed-crops';
import { PlantingInspectorPanel } from './PlantingInspectorPanel';
import CreateSequenceModal, { CreateSequenceOptions } from './CreateSequenceModal';
import SequenceEditorModal from './SequenceEditorModal';
import PlantingSpecEditor from './PlantingSpecEditor';
import PlantingSpecCreator from './PlantingSpecCreator';
import type { PlantingSpec } from '@/lib/entities/planting-specs';

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
  const bulkDuplicatePlantings = usePlanStore((s) => s.bulkDuplicatePlantings);
  const bulkUpdatePlantings = usePlanStore((s) => s.bulkUpdatePlantings);
  const updatePlantingSpec = usePlanStore((s) => s.updatePlantingSpec);
  const addPlantingSpec = usePlanStore((s) => s.addPlantingSpec);

  // Toast for validation errors
  const setToast = useUIStore((s) => s.setToast);

  // Date operations from store
  const updateCropDates = usePlanStore((s) => s.updateCropDates);

  // Sequence operations from store
  const createSequenceFromPlanting = usePlanStore((s) => s.createSequenceFromPlanting);
  const updateSequenceOffset = usePlanStore((s) => s.updateSequenceOffset);
  const updateSequenceName = usePlanStore((s) => s.updateSequenceName);
  const reorderSequenceSlots = usePlanStore((s) => s.reorderSequenceSlots);
  const unlinkFromSequence = usePlanStore((s) => s.unlinkFromSequence);
  const addPlantingToSequence = usePlanStore((s) => s.addPlantingToSequence);
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

  // Modal state for planting spec editor
  const [editingSpecId, setEditingSpecId] = useState<string | null>(null);

  // Modal state for clone spec
  const [cloningForPlantingId, setCloningForPlantingId] = useState<string | null>(null);
  const [cloneSourceSpec, setCloneSourceSpec] = useState<PlantingSpec | null>(null);

  // Get computed crops from centralized hook (includes GDD adjustments)
  const { crops: allTimelineCrops } = useComputedCrops();

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

  // Edit planting spec handler
  const handleEditPlantingSpec = useCallback((specId: string) => {
    setEditingSpecId(specId);
  }, []);

  // Save edited planting spec
  const handleSaveSpec = useCallback(
    async (spec: PlantingSpec) => {
      // Pass original identifier to handle renames correctly
      await updatePlantingSpec(spec, editingSpecId ?? undefined);
      setEditingSpecId(null);
    },
    [updatePlantingSpec, editingSpecId]
  );

  // Clone spec handler - opens PlantingSpecCreator
  const handleCloneSpec = useCallback(
    (plantingId: string, specId: string) => {
      const spec = currentPlan?.specs?.[specId];
      if (!spec) return;
      setCloningForPlantingId(plantingId);
      setCloneSourceSpec(spec);
    },
    [currentPlan?.specs]
  );

  // Save cloned spec - adds to catalog AND updates planting
  const handleCloneSave = useCallback(
    async (spec: PlantingSpec) => {
      if (!cloningForPlantingId) return;
      // Add the new spec to the catalog
      await addPlantingSpec(spec);
      // Update the planting to use the new spec
      const result = await updatePlanting(cloningForPlantingId, { specId: spec.identifier });
      if (!result.success) {
        setToast({ message: result.error, type: 'error' });
      }
      // Clear clone state
      setCloningForPlantingId(null);
      setCloneSourceSpec(null);
    },
    [cloningForPlantingId, addPlantingSpec, updatePlanting, setToast]
  );

  // For date changes in the inspector, use updateCropDates
  const handleCropDateChange = useCallback(
    async (groupId: string, startDate: string, endDate: string) => {
      await updateCropDates(groupId, startDate, endDate);
    },
    [updateCropDates]
  );

  // Refresh planting to use spec defaults (reset to "fresh from spec" state)
  const handleRefreshFromSpec = useCallback(
    async (plantingId: string) => {
      // Find the planting to get its specId
      const planting = currentPlan?.plantings?.find(p => p.id === plantingId);
      if (!planting) return;

      // Look up the spec to get targetFieldDate
      const spec = planting.specId ? currentPlan?.specs?.[planting.specId] : null;

      // Build updates - reset to "fresh from spec" state
      const updates: Parameters<typeof updatePlanting>[1] = {
        overrides: undefined,
        useDefaultSeedSource: true,
        seedSource: undefined,
        marketSplit: undefined,
      };

      // If spec has a target field date, reset fieldStartDate to it
      if (spec?.targetFieldDate && currentPlan?.metadata?.year) {
        // targetFieldDate is MM-DD format, combine with plan year
        updates.fieldStartDate = `${currentPlan.metadata.year}-${spec.targetFieldDate}`;
      }

      const result = await updatePlanting(plantingId, updates);
      if (!result.success) {
        setToast({ message: result.error, type: 'error' });
      }
    },
    [updatePlanting, currentPlan, setToast]
  );

  // Bulk duplicate plantings
  const handleBulkDuplicate = useCallback(
    async (plantingIds: string[]) => {
      const newIds = await bulkDuplicatePlantings(plantingIds);
      clearSelection();
      // Select all the new plantings
      newIds.forEach((id) => selectPlanting(id));
      return newIds;
    },
    [bulkDuplicatePlantings, clearSelection, selectPlanting]
  );

  // Bulk refresh plantings from spec (reset to "fresh from spec" state)
  const handleBulkRefreshFromSpec = useCallback(
    async (plantingIds: string[]) => {
      if (!currentPlan?.plantings || !currentPlan?.specs) return;

      // Use bulk update to reset all plantings in single undo step
      const updates = plantingIds.map((id) => {
        const planting = currentPlan.plantings!.find(p => p.id === id);
        const spec = planting?.specId ? currentPlan.specs![planting.specId] : null;

        const changes: {
          overrides: undefined;
          useDefaultSeedSource: true;
          seedSource: undefined;
          marketSplit: undefined;
          fieldStartDate?: string;
        } = {
          overrides: undefined,
          useDefaultSeedSource: true,
          seedSource: undefined,
          marketSplit: undefined,
        };

        // If spec has a target field date, reset fieldStartDate to it
        if (spec?.targetFieldDate && currentPlan.metadata?.year) {
          changes.fieldStartDate = `${currentPlan.metadata.year}-${spec.targetFieldDate}`;
        }

        return { id, changes };
      });
      const result = await bulkUpdatePlantings(updates);
      if (!result.success) {
        setToast({ message: result.error, type: 'error' });
      }
    },
    [bulkUpdatePlantings, currentPlan, setToast]
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
          const result = await updatePlanting(id, updates);
          if (!result.success) {
            setToast({ message: result.error, type: 'error' });
          }
          return result;
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
        onBulkDuplicatePlantings={handleBulkDuplicate}
        onBulkRefreshFromSpec={handleBulkRefreshFromSpec}
        onCropDateChange={(groupId, startDate, endDate) => {
          handleCropDateChange(groupId, startDate, endDate);
        }}
        onCreateSequence={handleCreateSequence}
        onEditSequence={handleEditSequence}
        onUnlinkFromSequence={handleUnlinkFromSequence}
        onEditPlantingSpec={handleEditPlantingSpec}
        onCloneSpec={handleCloneSpec}
        onRefreshFromSpec={handleRefreshFromSpec}
        specs={currentPlan.specs}
        crops={currentPlan.crops}
        varieties={currentPlan.varieties}
        seedMixes={currentPlan.seedMixes}
        products={currentPlan.products}
        markets={currentPlan.markets}
        showTimingEdits={showTimingEdits}
        className={className}
        location={currentPlan.metadata.location}
        planYear={currentPlan.metadata.year}
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
      {editingSequence && currentPlan.specs && currentPlan.beds && (
        <SequenceEditorModal
          isOpen={true}
          sequence={editingSequence}
          plantings={editingSequencePlantings}
          specs={currentPlan.specs}
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
          onAddSlot={async () => {
            await addPlantingToSequence(editingSequenceId!);
          }}
        />
      )}

      {/* Planting Spec Editor Modal */}
      {editingSpecId && currentPlan.specs?.[editingSpecId] && (
        <PlantingSpecEditor
          isOpen={true}
          spec={currentPlan.specs[editingSpecId]}
          onClose={() => setEditingSpecId(null)}
          onSave={handleSaveSpec}
          varieties={currentPlan.varieties}
          seedMixes={currentPlan.seedMixes}
          products={currentPlan.products}
          markets={currentPlan.markets}
          timingSettings={{
            transplantShockDays: currentPlan.metadata?.transplantShockDays,
            defaultTransplantAge: currentPlan.metadata?.defaultTransplantAge,
          }}
        />
      )}

      {/* Clone Spec Modal - creates new spec and assigns to planting */}
      {cloneSourceSpec && currentPlan.specs && (
        <PlantingSpecCreator
          isOpen={true}
          onClose={() => {
            setCloningForPlantingId(null);
            setCloneSourceSpec(null);
          }}
          onSave={handleCloneSave}
          availableSpecs={Object.values(currentPlan.specs)}
          existingIdentifiers={Object.keys(currentPlan.specs)}
          initialSourceSpec={cloneSourceSpec}
          varieties={currentPlan.varieties}
          seedMixes={currentPlan.seedMixes}
          products={currentPlan.products}
          markets={currentPlan.markets}
          timingSettings={{
            transplantShockDays: currentPlan.metadata?.transplantShockDays,
            defaultTransplantAge: currentPlan.metadata?.defaultTransplantAge,
          }}
        />
      )}
    </>
  );
}
