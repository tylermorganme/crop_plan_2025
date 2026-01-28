'use client';

import { useMemo, useState, useCallback } from 'react';
import { usePlanStore } from '@/lib/plan-store';
import { useUIStore } from '@/lib/ui-store';
import { getTimelineCropsFromPlan } from '@/lib/timeline-data';
import { PlantingInspectorPanel } from './PlantingInspectorPanel';
import CreateSequenceModal, { CreateSequenceOptions } from './CreateSequenceModal';
import SequenceEditorModal from './SequenceEditorModal';
import CropConfigEditor from './CropConfigEditor';
import CropConfigCreator from './CropConfigCreator';
import type { CropConfig } from '@/lib/entities/crop-config';

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
  const updateCropConfig = usePlanStore((s) => s.updateCropConfig);
  const addCropConfig = usePlanStore((s) => s.addCropConfig);

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

  // Modal state for crop config editor
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);

  // Modal state for clone config
  const [cloningForPlantingId, setCloningForPlantingId] = useState<string | null>(null);
  const [cloneSourceConfig, setCloneSourceConfig] = useState<CropConfig | null>(null);

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

  // Edit crop config handler
  const handleEditCropConfig = useCallback((configId: string) => {
    setEditingConfigId(configId);
  }, []);

  // Save edited crop config
  const handleSaveConfig = useCallback(
    async (config: CropConfig) => {
      await updateCropConfig(config);
      setEditingConfigId(null);
    },
    [updateCropConfig]
  );

  // Clone config handler - opens CropConfigCreator
  const handleCloneConfig = useCallback(
    (plantingId: string, configId: string) => {
      const config = currentPlan?.cropCatalog?.[configId];
      if (!config) return;
      setCloningForPlantingId(plantingId);
      setCloneSourceConfig(config);
    },
    [currentPlan?.cropCatalog]
  );

  // Save cloned config - adds to catalog AND updates planting
  const handleCloneSave = useCallback(
    async (config: CropConfig) => {
      if (!cloningForPlantingId) return;
      // Add the new config to the catalog
      await addCropConfig(config);
      // Update the planting to use the new config
      const result = await updatePlanting(cloningForPlantingId, { configId: config.identifier });
      if (!result.success) {
        setToast({ message: result.error, type: 'error' });
      }
      // Clear clone state
      setCloningForPlantingId(null);
      setCloneSourceConfig(null);
    },
    [cloningForPlantingId, addCropConfig, updatePlanting, setToast]
  );

  // For date changes in the inspector, use updateCropDates
  const handleCropDateChange = useCallback(
    async (groupId: string, startDate: string, endDate: string) => {
      await updateCropDates(groupId, startDate, endDate);
    },
    [updateCropDates]
  );

  // Refresh planting to use config defaults (reset to "fresh from config" state)
  const handleRefreshFromConfig = useCallback(
    async (plantingId: string) => {
      // Find the planting to get its configId
      const planting = currentPlan?.plantings?.find(p => p.id === plantingId);
      if (!planting) return;

      // Look up the config to get targetFieldDate
      const config = planting.configId ? currentPlan?.cropCatalog?.[planting.configId] : null;

      // Build updates - reset to "fresh from config" state
      const updates: Parameters<typeof updatePlanting>[1] = {
        overrides: undefined,
        useDefaultSeedSource: true,
        seedSource: undefined,
        marketSplit: undefined,
      };

      // If config has a target field date, reset fieldStartDate to it
      if (config?.targetFieldDate && currentPlan?.metadata?.year) {
        // targetFieldDate is MM-DD format, combine with plan year
        updates.fieldStartDate = `${currentPlan.metadata.year}-${config.targetFieldDate}`;
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

  // Bulk refresh plantings from config (reset to "fresh from config" state)
  const handleBulkRefreshFromConfig = useCallback(
    async (plantingIds: string[]) => {
      if (!currentPlan?.plantings || !currentPlan?.cropCatalog) return;

      // Use bulk update to reset all plantings in single undo step
      const updates = plantingIds.map((id) => {
        const planting = currentPlan.plantings!.find(p => p.id === id);
        const config = planting?.configId ? currentPlan.cropCatalog![planting.configId] : null;

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

        // If config has a target field date, reset fieldStartDate to it
        if (config?.targetFieldDate && currentPlan.metadata?.year) {
          changes.fieldStartDate = `${currentPlan.metadata.year}-${config.targetFieldDate}`;
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
        onBulkRefreshFromConfig={handleBulkRefreshFromConfig}
        onCropDateChange={(groupId, startDate, endDate) => {
          handleCropDateChange(groupId, startDate, endDate);
        }}
        onCreateSequence={handleCreateSequence}
        onEditSequence={handleEditSequence}
        onUnlinkFromSequence={handleUnlinkFromSequence}
        onEditCropConfig={handleEditCropConfig}
        onCloneConfig={handleCloneConfig}
        onRefreshFromConfig={handleRefreshFromConfig}
        cropCatalog={currentPlan.cropCatalog}
        crops={currentPlan.crops}
        varieties={currentPlan.varieties}
        seedMixes={currentPlan.seedMixes}
        products={currentPlan.products}
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

      {/* Crop Config Editor Modal */}
      {editingConfigId && currentPlan.cropCatalog?.[editingConfigId] && (
        <CropConfigEditor
          isOpen={true}
          crop={currentPlan.cropCatalog[editingConfigId]}
          onClose={() => setEditingConfigId(null)}
          onSave={handleSaveConfig}
          varieties={currentPlan.varieties}
          seedMixes={currentPlan.seedMixes}
          products={currentPlan.products}
          markets={currentPlan.markets}
        />
      )}

      {/* Clone Config Modal - creates new config and assigns to planting */}
      {cloneSourceConfig && currentPlan.cropCatalog && (
        <CropConfigCreator
          isOpen={true}
          onClose={() => {
            setCloningForPlantingId(null);
            setCloneSourceConfig(null);
          }}
          onSave={handleCloneSave}
          availableCrops={Object.values(currentPlan.cropCatalog)}
          existingIdentifiers={Object.keys(currentPlan.cropCatalog)}
          initialSourceConfig={cloneSourceConfig}
          varieties={currentPlan.varieties}
          seedMixes={currentPlan.seedMixes}
          products={currentPlan.products}
          markets={currentPlan.markets}
        />
      )}
    </>
  );
}
