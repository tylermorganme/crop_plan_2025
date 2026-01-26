'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import CropTimeline from '@/components/CropTimeline';
import CropConfigEditor from '@/components/CropConfigEditor';
import { PageLayout } from '@/components/PageLayout';
import AppHeader from '@/components/AppHeader';
import { type CropConfig } from '@/lib/entities/crop-config';
// useSnapshotScheduler removed - SQLite storage handles persistence directly
import { calculateRowSpan, getTimelineCropsFromPlan, buildBedMappings } from '@/lib/timeline-data';
import { getResources, getGroups } from '@/lib/plan-types';
import { createPlanting } from '@/lib/entities/planting';
import {
  usePlanStore,
  loadPlanFromLibrary,
} from '@/lib/plan-store';
import { useUIStore } from '@/lib/ui-store';
import { Z_INDEX } from '@/lib/z-index';

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
  const [configEditorOpen, setConfigEditorOpen] = useState(false);

  // Toast notifications - shared across views via UI store
  const toast = useUIStore((state) => state.toast);
  const setToast = useUIStore((state) => state.setToast);
  const [editingCrop, setEditingCrop] = useState<CropConfig | null>(null);

  // Pending drag changes - queued during drag, committed on drop
  // Key is groupId (plantingId), value contains pending changes
  const [pendingDragChanges, setPendingDragChanges] = useState<Map<string, {
    startBed?: string | null; // null = unassigned, undefined = unchanged
    fieldStartDate?: string;  // undefined = unchanged
  }>>(new Map());

  // Plan store state
  const currentPlan = usePlanStore((state) => state.currentPlan);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);
  const moveCrop = usePlanStore((state) => state.moveCrop);
  const updateCropDates = usePlanStore((state) => state.updateCropDates);
  const bulkUpdatePlantings = usePlanStore((state) => state.bulkUpdatePlantings);

  // Note: Cross-tab sync is handled centrally by PlanStoreProvider

  // Update crop config action from store
  const updateCropConfig = usePlanStore((state) => state.updateCropConfig);
  const addPlanting = usePlanStore((state) => state.addPlanting);
  const updateCropBoxDisplay = usePlanStore((state) => state.updateCropBoxDisplay);

  // Helper to get crop config from plan's catalog (falls back to master)
  const getCropByIdentifier = useCallback((identifier: string) => {
    // First try plan's catalog
    if (currentPlan?.cropCatalog?.[identifier]) {
      return currentPlan.cropCatalog[identifier];
    }
    // Fall back to master catalog (shouldn't happen for new plans)
    return null;
  }, [currentPlan]);

  // Derive bed mappings from plan data
  const bedMappings = useMemo(() => {
    if (!currentPlan?.beds || !currentPlan?.bedGroups) {
      return { nameGroups: {}, bedLengths: {} };
    }
    const mappings = buildBedMappings(currentPlan.beds, currentPlan.bedGroups);
    return { nameGroups: mappings.nameGroups, bedLengths: mappings.bedLengths };
  }, [currentPlan?.beds, currentPlan?.bedGroups]);

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

  // Note: Snapshot scheduler removed - SQLite storage handles persistence directly

  // Keyboard shortcuts for undo/redo are now handled in AppHeader

  const handleCropMove = useCallback((cropId: string, newResource: string, groupId: string | undefined, feetNeeded: number) => {
    const targetGroupId = groupId || cropId;

    // Moving to Unassigned - no capacity check needed
    if (newResource === '') {
      moveCrop(targetGroupId, '');
      return;
    }

    // Moving to a real bed - calculate span based on feetNeeded and target row's bed size
    const { bedSpanInfo, isComplete, feetNeeded: neededFeet, feetAvailable } = calculateRowSpan(
      feetNeeded,
      newResource,
      bedMappings.nameGroups,
      bedMappings.bedLengths
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
  }, [moveCrop, bedMappings]);

  const handleDateChange = useCallback((groupId: string, startDate: string, endDate: string) => {
    updateCropDates(groupId, startDate, endDate);
  }, [updateCropDates]);

  // Bulk handlers for multi-planting drag operations
  // During drag: queue changes for preview. On drop: commit all at once.
  const handleBulkCropMove = useCallback((moves: { groupId: string; newResource: string; feetNeeded: number }[]) => {
    if (moves.length === 0) return;

    // Queue changes for preview (commit happens in handleDragEnd)
    setPendingDragChanges(prev => {
      const next = new Map(prev);
      for (const move of moves) {
        const existing = next.get(move.groupId) || {};
        // Store bed name for preview, will resolve to UUID on commit
        // Empty string = unassigned, store as null
        next.set(move.groupId, {
          ...existing,
          startBed: move.newResource === '' ? null : move.newResource,
        });
      }
      return next;
    });
  }, []);

  const handleBulkCropDateChange = useCallback((dateUpdates: { groupId: string; startDate: string }[]) => {
    if (dateUpdates.length === 0) return;

    // Queue changes for preview (commit happens in handleDragEnd)
    setPendingDragChanges(prev => {
      const next = new Map(prev);
      for (const update of dateUpdates) {
        const existing = next.get(update.groupId) || {};
        next.set(update.groupId, {
          ...existing,
          fieldStartDate: update.startDate,
        });
      }
      return next;
    });
  }, []);

  // Handle drag end - commit or discard pending changes
  const handleDragEnd = useCallback((committed: boolean) => {
    if (!committed || pendingDragChanges.size === 0) {
      // Drag cancelled or no changes - just clear pending state
      setPendingDragChanges(new Map());
      return;
    }

    // Commit all pending changes in a single bulk update
    const updates: { id: string; changes: { startBed?: string | null; bedFeet?: number; fieldStartDate?: string } }[] = [];

    for (const [groupId, changes] of pendingDragChanges) {
      const updateChanges: { startBed?: string | null; bedFeet?: number; fieldStartDate?: string } = {};

      // Handle bed change
      if (changes.startBed !== undefined) {
        if (changes.startBed === null) {
          // Moving to unassigned
          updateChanges.startBed = null;
        } else {
          // Moving to a real bed - resolve name to UUID
          const planting = currentPlan?.plantings?.find(p => p.id === groupId);
          if (!planting) {
            console.error(`handleDragEnd: planting not found for groupId ${groupId}`);
            continue;
          }

          const { bedSpanInfo, isComplete } = calculateRowSpan(
            planting.bedFeet,
            changes.startBed,
            bedMappings.nameGroups,
            bedMappings.bedLengths
          );

          if (isComplete) {
            const bed = currentPlan?.beds ? Object.values(currentPlan.beds).find(b => b.name === changes.startBed) : null;
            if (bed) {
              updateChanges.startBed = bed.id;
              updateChanges.bedFeet = bedSpanInfo?.reduce((sum, b) => sum + b.feetUsed, 0) ?? planting.bedFeet;
            }
          }
        }
      }

      // Handle date change
      if (changes.fieldStartDate !== undefined) {
        updateChanges.fieldStartDate = changes.fieldStartDate;
      }

      if (Object.keys(updateChanges).length > 0) {
        updates.push({ id: groupId, changes: updateChanges });
      }
    }

    if (updates.length > 0) {
      bulkUpdatePlantings(updates);
    }

    // Clear pending state
    setPendingDragChanges(new Map());
  }, [pendingDragChanges, bulkUpdatePlantings, bedMappings, currentPlan?.beds, currentPlan?.plantings]);

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
      // Update the config in the plan's catalog (not the template)
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

  // Compute preview crops: just update resource/dates on 1:1 crop entries
  // Bed spanning is computed at render time in CropTimeline's cropsByResource
  const previewCrops = useMemo(() => {
    if (!currentPlan) return [];

    const baseCrops = getTimelineCropsFromPlan(currentPlan);

    // No pending changes - return as-is
    if (pendingDragChanges.size === 0) {
      return baseCrops;
    }

    // Apply pending changes directly to crop entries (1:1 with plantings)
    return baseCrops.map(crop => {
      const changes = pendingDragChanges.get(crop.groupId);
      if (!changes) return crop;

      return {
        ...crop,
        // Update resource (bed name) - null becomes '' for unassigned
        resource: changes.startBed !== undefined
          ? (changes.startBed || '')
          : crop.resource,
        // Update start/end dates if fieldStartDate changed
        ...(changes.fieldStartDate !== undefined ? (() => {
          // Find the planting to compute date delta
          const planting = currentPlan.plantings?.find(p => p.id === crop.groupId);
          if (!planting) return {};

          const originalFieldDate = new Date(planting.fieldStartDate);
          const newFieldDate = new Date(changes.fieldStartDate);
          const deltaDays = Math.round((newFieldDate.getTime() - originalFieldDate.getTime()) / (1000 * 60 * 60 * 24));

          const newStart = new Date(crop.startDate);
          const newEnd = new Date(crop.endDate);
          newStart.setDate(newStart.getDate() + deltaDays);
          newEnd.setDate(newEnd.getDate() + deltaDays);

          return {
            startDate: newStart.toISOString().split('T')[0],
            endDate: newEnd.toISOString().split('T')[0],
          };
        })() : {}),
      };
    });
  }, [currentPlan, pendingDragChanges]);

  if (loading) {
    return (
      <PageLayout header={<AppHeader />}>
        <div className="flex items-center justify-center h-full">
          <div className="text-gray-600">Loading plan...</div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout header={<AppHeader />}>
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <div className="text-red-600 font-medium">{error}</div>
          <Link href="/plans" className="text-blue-600 hover:text-blue-800">
            ← Back to plan list
          </Link>
        </div>
      </PageLayout>
    );
  }

  if (!currentPlan) {
    return (
      <PageLayout header={<AppHeader />}>
        <div className="flex items-center justify-center h-full">
          <div className="text-gray-600">No plan loaded</div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout header={<AppHeader />}>
      <CropTimeline
        crops={previewCrops}
        resources={getResources(currentPlan)}
        groups={getGroups(currentPlan)}
        bedLengths={bedMappings.bedLengths}
        onCropMove={handleCropMove}
        onCropDateChange={handleDateChange}
        onBulkCropMove={handleBulkCropMove}
        onBulkCropDateChange={handleBulkCropDateChange}
        onDragEnd={handleDragEnd}
        cropCatalog={currentPlan.cropCatalog}
        planYear={currentPlan.metadata.year}
        onAddPlanting={handleAddPlanting}
        products={currentPlan.products}
        initialNoVarietyFilter={initialNoVarietyFilter}
        cropBoxDisplay={currentPlan.cropBoxDisplay}
        onUpdateCropBoxDisplay={updateCropBoxDisplay}
      />

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
        markets={currentPlan?.markets}
        lastFrostDate={currentPlan?.metadata.lastFrostDate}
      />
    </PageLayout>
  );
}
