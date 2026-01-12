'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import CropTimeline from '@/components/CropTimeline';
import CropConfigEditor from '@/components/CropConfigEditor';
import { type CropConfig } from '@/lib/entities/crop-config';
import { useSnapshotScheduler } from '@/hooks/useSnapshotScheduler';
import { calculateRowSpan, getTimelineCropsFromPlan } from '@/lib/timeline-data';
import { getResources, getGroups } from '@/lib/plan-types';
import { createPlanting } from '@/lib/entities/planting';
import {
  usePlanStore,
  loadPlanFromLibrary,
} from '@/lib/plan-store';
import { Z_INDEX } from '@/lib/z-index';
import bedPlanData from '@/data/bed-plan.json';

// Toast notification component
function Toast({ message, type, onClose }: { message: string; type: 'error' | 'success' | 'info'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-green-600' : 'bg-blue-600';

  return (
    <div
      className={`fixed bottom-4 right-4 ${bgColor} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up`}
      style={{ zIndex: Z_INDEX.TOAST }}
    >
      <span>{message}</span>
      <button onClick={onClose} className="text-white/80 hover:text-white text-lg leading-none">&times;</button>
    </div>
  );
}

export default function TimelinePlanPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const planId = params.planId as string;

  // Check for filter param (e.g., ?filter=no-variety)
  const filterParam = searchParams.get('filter');
  const initialNoVarietyFilter = filterParam === 'no-variety';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [configEditorOpen, setConfigEditorOpen] = useState(false);
  const [editingCrop, setEditingCrop] = useState<CropConfig | null>(null);

  // Plan store state
  const currentPlan = usePlanStore((state) => state.currentPlan);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);
  const moveCrop = usePlanStore((state) => state.moveCrop);
  const updateCropDates = usePlanStore((state) => state.updateCropDates);

  // Note: Cross-tab sync is handled centrally by PlanStoreProvider

  // Update crop config action from store
  const updateCropConfig = usePlanStore((state) => state.updateCropConfig);
  const addPlanting = usePlanStore((state) => state.addPlanting);
  const updatePlanting = usePlanStore((state) => state.updatePlanting);

  // Helper to get crop config from plan's catalog (falls back to master)
  const getCropByIdentifier = useCallback((identifier: string) => {
    // First try plan's catalog
    if (currentPlan?.cropCatalog?.[identifier]) {
      return currentPlan.cropCatalog[identifier];
    }
    // Fall back to master catalog (shouldn't happen for new plans)
    return null;
  }, [currentPlan]);

  // Load the specific plan by ID
  useEffect(() => {
    // Try to load the plan from library
    async function loadPlan() {
      if (!planId) {
        setError('No plan ID provided');
        setLoading(false);
        return;
      }

      try {
        const planData = await loadPlanFromLibrary(planId);
        if (planData) {
          await loadPlanById(planId);
          // Set this as the active plan for Crop Explorer
          localStorage.setItem('crop-explorer-active-plan', planId);
          setLoading(false);
        } else {
          setError(`Plan not found: ${planId}`);
          setLoading(false);
        }
      } catch (e) {
        setError(`Failed to load plan: ${e instanceof Error ? e.message : 'Unknown error'}`);
        setLoading(false);
      }
    }
    loadPlan();
  }, [planId, loadPlanById]);

  // Snapshot scheduler - creates tiered snapshots to file storage (every 15 min)
  useSnapshotScheduler({
    plan: currentPlan,
    enabled: !loading && !error,
  });

  // Keyboard shortcuts for undo/redo are now handled in AppHeader

  const handleCropMove = useCallback((cropId: string, newResource: string, groupId?: string, feetNeeded?: number) => {
    const feet = feetNeeded || 50;
    const targetGroupId = groupId || cropId;

    // Moving to Unassigned - no capacity check needed
    if (newResource === '') {
      moveCrop(targetGroupId, '');
      return;
    }

    // Moving to a real bed - calculate span based on feetNeeded and target row's bed size
    const { bedSpanInfo, isComplete, feetNeeded: neededFeet, feetAvailable } = calculateRowSpan(
      feet,
      newResource,
      (bedPlanData as { bedGroups: Record<string, string[]> }).bedGroups
    );

    // Don't allow the move if there isn't enough room
    if (!isComplete) {
      setToast({
        message: `Not enough room: need ${neededFeet}' but only ${feetAvailable}' available from ${newResource}`,
        type: 'error'
      });
      return;
    }

    // Use the plan store's moveCrop which handles undo
    // Pass full bedSpanInfo so feetUsed/bedCapacityFt are preserved
    moveCrop(targetGroupId, newResource, bedSpanInfo);
  }, [moveCrop]);

  const handleDateChange = useCallback((groupId: string, startDate: string, endDate: string) => {
    updateCropDates(groupId, startDate, endDate);
  }, [updateCropDates]);

  const duplicatePlanting = usePlanStore((state) => state.duplicatePlanting);
  const deleteCrop = usePlanStore((state) => state.deleteCrop);

  const handleDuplicateCrop = useCallback(async (groupId: string): Promise<string | void> => {
    try {
      const newId = await duplicatePlanting(groupId);
      setToast({ message: 'Planting duplicated - find it in Unassigned', type: 'success' });
      return newId;
    } catch (e) {
      setToast({ message: `Failed to duplicate: ${e instanceof Error ? e.message : 'Unknown error'}`, type: 'error' });
    }
  }, [duplicatePlanting]);

  const handleDeleteCrop = useCallback(async (groupIds: string[]) => {
    try {
      for (const groupId of groupIds) {
        await deleteCrop(groupId);
      }
      const count = groupIds.length;
      setToast({ message: `Deleted ${count} planting${count > 1 ? 's' : ''}`, type: 'success' });
    } catch (e) {
      setToast({ message: `Failed to delete: ${e instanceof Error ? e.message : 'Unknown error'}`, type: 'error' });
    }
  }, [deleteCrop]);

  const handleAddPlanting = useCallback(async (configId: string, fieldStartDate: string, bedId: string): Promise<string> => {
    const newPlanting = createPlanting({
      configId,
      fieldStartDate,
      startBed: bedId,
      bedFeet: 50, // Default to standard bed length
    });

    try {
      await addPlanting(newPlanting);
      setToast({ message: `Added ${configId} to ${bedId}`, type: 'success' });
      return newPlanting.id; // Return the ID so timeline can select it
    } catch (e) {
      setToast({ message: `Failed to add: ${e instanceof Error ? e.message : 'Unknown error'}`, type: 'error' });
      throw e;
    }
  }, [addPlanting]);

  const handleUpdatePlanting = useCallback(async (plantingId: string, updates: {
    bedFeet?: number;
    overrides?: { additionalDaysOfHarvest?: number; additionalDaysInField?: number; additionalDaysInCells?: number };
    notes?: string;
    seedSource?: { type: 'variety' | 'mix'; id: string } | null;
  }) => {
    try {
      // Convert null to undefined for store compatibility
      const storeUpdates = {
        ...updates,
        seedSource: updates.seedSource === null ? undefined : updates.seedSource,
      };
      await updatePlanting(plantingId, storeUpdates);
      // Silent success - the UI updates immediately via state
    } catch (e) {
      setToast({ message: `Failed to update: ${e instanceof Error ? e.message : 'Unknown error'}`, type: 'error' });
    }
  }, [updatePlanting]);

  const handleEditCropConfig = useCallback((plantingId: string) => {
    // Find the planting to get the configId
    const planting = currentPlan?.plantings?.find(p => p.id === plantingId);

    if (!planting) {
      setToast({ message: `Planting not found: ${plantingId}`, type: 'error' });
      return;
    }

    const crop = getCropByIdentifier(planting.configId);
    if (!crop) {
      setToast({ message: `Config not found: ${planting.configId}`, type: 'error' });
      return;
    }

    setEditingCrop(crop);
    setConfigEditorOpen(true);
  }, [currentPlan?.plantings, getCropByIdentifier]);

  const handleSaveCropConfig = useCallback(async (updated: CropConfig) => {
    try {
      // Update the config in the plan's catalog (not global crops.json)
      const affectedCount = await updateCropConfig(updated);

      setConfigEditorOpen(false);
      setEditingCrop(null);

      if (affectedCount > 0) {
        setToast({ message: `Saved "${updated.identifier}" - updated ${affectedCount} planting(s)`, type: 'success' });
      } else {
        setToast({ message: `Saved "${updated.identifier}"`, type: 'success' });
      }
    } catch (e) {
      setToast({
        message: `Failed to save: ${e instanceof Error ? e.message : 'Unknown error'}`,
        type: 'error',
      });
    }
  }, [updateCropConfig]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-51px)]">
        <div className="text-gray-600">Loading plan...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-51px)] gap-4">
        <div className="text-red-600 font-medium">{error}</div>
        <Link href="/plans" className="text-blue-600 hover:text-blue-800">
          ← Back to plan list
        </Link>
      </div>
    );
  }

  if (!currentPlan) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-51px)]">
        <div className="text-gray-600">No plan loaded</div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-51px)] flex flex-col">
      {/* Timeline */}
      <div className="flex-1 min-h-0">
        <CropTimeline
          crops={getTimelineCropsFromPlan(currentPlan)}
          resources={getResources(currentPlan)}
          groups={getGroups(currentPlan)}
          onCropMove={handleCropMove}
          onCropDateChange={handleDateChange}
          onDuplicateCrop={handleDuplicateCrop}
          onDeleteCrop={handleDeleteCrop}
          onEditCropConfig={handleEditCropConfig}
          cropCatalog={currentPlan.cropCatalog}
          planYear={currentPlan.metadata.year}
          onAddPlanting={handleAddPlanting}
          onUpdatePlanting={handleUpdatePlanting}
          varieties={currentPlan.varieties}
          seedMixes={currentPlan.seedMixes}
          initialNoVarietyFilter={initialNoVarietyFilter}
        />
      </div>

      {/* Toast notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Crop config editor modal */}
      <CropConfigEditor
        isOpen={configEditorOpen}
        crop={editingCrop}
        onClose={() => {
          setConfigEditorOpen(false);
          setEditingCrop(null);
        }}
        onSave={handleSaveCropConfig}
        varieties={currentPlan?.varieties}
        seedMixes={currentPlan?.seedMixes}
        products={currentPlan?.products}
      />
    </div>
  );
}
