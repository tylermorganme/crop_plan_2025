'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import CropTimeline from '@/components/CropTimeline';
import PlantingSpecEditor from '@/components/PlantingSpecEditor';
import { PageLayout } from '@/components/PageLayout';
import AppHeader from '@/components/AppHeader';
import { type PlantingSpec, calculateDaysInCells, getPrimarySeedToHarvest } from '@/lib/entities/planting-specs';
// useSnapshotScheduler removed - SQLite storage handles persistence directly
import { calculateRowSpan, buildBedMappings, getTimelineCropsFromPlan } from '@/lib/timeline-data';
import { getResources, getGroups } from '@/lib/plan-types';
import { createPlanting } from '@/lib/entities/planting';
import { useComputedCrops } from '@/lib/use-computed-crops';
import { findHarvestDate, findPlantDate, makeCacheKey, getGddForDays } from '@/lib/gdd-cache';
import {
  usePlanStore,
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
  const selectPlanting = useUIStore((state) => state.selectPlanting);
  const [editingSpec, setEditingSpec] = useState<PlantingSpec | null>(null);

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

  // Update planting spec action from store
  const updatePlantingSpec = usePlanStore((state) => state.updatePlantingSpec);
  const addPlanting = usePlanStore((state) => state.addPlanting);
  const updatePlantingBoxDisplay = usePlanStore((state) => state.updatePlantingBoxDisplay);

  // Helper to get planting spec from plan's catalog by spec ID
  const getSpecById = useCallback((specId: string) => {
    if (currentPlan?.specs?.[specId]) {
      return currentPlan.specs[specId];
    }
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

  // Get computed crops from centralized hook (includes GDD adjustments)
  const { crops: baseCrops, gddLoading, hasGddCalculator, gddCalculator } = useComputedCrops();

  // Load the specific plan by ID
  useEffect(() => {
    if (!planId) {
      setError('No plan ID provided');
      setLoading(false);
      return;
    }

    loadPlanById(planId)
      .then(() => {
        localStorage.setItem('spec-explorer-active-plan', planId);
        setLoading(false);
      })
      .catch((e) => {
        setError(`Failed to load plan: ${e instanceof Error ? e.message : 'Unknown error'}`);
        setLoading(false);
      });
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
  // When ANY sequence member is dragged, recalculate and commit ALL members' dates
  const handleDragEnd = useCallback((committed: boolean) => {
    if (!committed || pendingDragChanges.size === 0) {
      setPendingDragChanges(new Map());
      return;
    }

    // Build a map of recalculated dates for ALL sequence members when any member moves
    // Key: planting ID, Value: new field start date
    const recalculatedDates = new Map<string, string>();

    // Check each pending date change to see if it belongs to a sequence
    for (const [plantingId, changes] of pendingDragChanges) {
      if (!changes.fieldStartDate) continue;

      const draggedPlanting = currentPlan?.plantings?.find(p => p.id === plantingId);
      if (!draggedPlanting?.sequenceId) continue;

      const sequence = currentPlan?.sequences?.[draggedPlanting.sequenceId];
      if (!sequence) continue;

      // Get all plantings in this sequence
      const sequenceMembers = currentPlan?.plantings?.filter(
        p => p.sequenceId === draggedPlanting.sequenceId
      ) ?? [];

      // Get spec for GDD calculations
      const spec = currentPlan?.specs?.[draggedPlanting.specId];
      if (!spec) continue;

      // For GDD-staggered sequences with a GDD calculator, do proper harvest-date-based recalculation
      if (sequence.useGddStagger && gddCalculator && spec.cropId) {
        const cropEntity = currentPlan?.crops?.[spec.cropId];
        const baseTemp = cropEntity?.gddBaseTemp;

        if (baseTemp !== undefined) {
          const daysInCells = calculateDaysInCells(spec);
          const seedToHarvest = getPrimarySeedToHarvest(spec);
          const fieldDaysToHarvest = seedToHarvest - daysInCells;
          const structureOffset = spec.growingStructure && spec.growingStructure !== 'field' ? 20 : 0;
          const cacheKey = makeCacheKey(baseTemp, cropEntity?.gddUpperTemp, structureOffset);
          const gddCache = gddCalculator.getCache();

          // Calculate FIXED GDD requirement from spec's reference date
          // This is the biological constant - how much heat the crop needs to mature
          // Using targetFieldDate (not the drag position) ensures consistent GDD across seasons
          let gddNeeded: number;
          let referenceDate: string;
          if (spec.targetFieldDate) {
            const planYear = currentPlan?.metadata?.year ?? new Date().getFullYear();
            const [month, day] = spec.targetFieldDate.split('-').map(Number);
            referenceDate = `${planYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          } else {
            // Fall back to anchor's field start date (consistent with render path)
            const anchor = sequenceMembers.find(p => p.sequenceSlot === 0);
            referenceDate = anchor?.fieldStartDate ?? changes.fieldStartDate;
          }
          gddNeeded = getGddForDays(gddCache, referenceDate, fieldDaysToHarvest, cacheKey)
            ?? fieldDaysToHarvest * 15;

          // Calculate dragged planting's new harvest date
          const draggedHarvestDate = findHarvestDate(
            gddCache,
            changes.fieldStartDate,
            gddNeeded,
            cacheKey
          );

          if (draggedHarvestDate) {
            const draggedSlot = draggedPlanting.sequenceSlot ?? 0;

            // Recalculate all members' dates based on the dragged member's harvest
            for (const member of sequenceMembers) {
              const memberSlot = member.sequenceSlot ?? 0;
              const slotDiff = memberSlot - draggedSlot;
              const additionalDays = member.overrides?.additionalDaysInField ?? 0;

              // Calculate target harvest date for this member
              // target = dragged_harvest + (slot_diff × offsetDays) + additionalDays
              const targetHarvestMs = new Date(draggedHarvestDate).getTime() +
                (slotDiff * sequence.offsetDays + additionalDays) * 24 * 60 * 60 * 1000;
              const targetHarvestDate = new Date(targetHarvestMs).toISOString().split('T')[0];

              // Back-calculate plant date from target harvest
              const plantDate = findPlantDate(
                gddCache,
                targetHarvestDate,
                gddNeeded,
                cacheKey
              );

              if (plantDate) {
                recalculatedDates.set(member.id, plantDate);
              }
            }
          }
        }
      } else {
        // Non-GDD sequence: simple calendar offset from dragged member
        const draggedSlot = draggedPlanting.sequenceSlot ?? 0;

        for (const member of sequenceMembers) {
          const memberSlot = member.sequenceSlot ?? 0;
          const slotDiff = memberSlot - draggedSlot;
          const additionalDays = member.overrides?.additionalDaysInField ?? 0;

          // Calculate new date: dragged_date + (slot_diff × offsetDays) + additionalDays
          const newDateMs = new Date(changes.fieldStartDate).getTime() +
            (slotDiff * sequence.offsetDays + additionalDays) * 24 * 60 * 60 * 1000;
          const newDate = new Date(newDateMs).toISOString().split('T')[0];

          recalculatedDates.set(member.id, newDate);
        }
      }
    }

    // Commit all pending changes in a single bulk update
    const updates: { id: string; changes: { startBed?: string | null; bedFeet?: number; fieldStartDate?: string } }[] = [];

    // First, handle directly changed plantings (bed moves and non-sequence date changes)
    for (const [groupId, changes] of pendingDragChanges) {
      const planting = currentPlan?.plantings?.find(p => p.id === groupId);
      if (!planting) {
        console.error(`handleDragEnd: planting not found for groupId ${groupId}`);
        continue;
      }

      const updateChanges: { startBed?: string | null; bedFeet?: number; fieldStartDate?: string } = {};

      // Handle bed change (always applies)
      if (changes.startBed !== undefined) {
        if (changes.startBed === null) {
          updateChanges.startBed = null;
        } else {
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

      // Handle date change - use recalculated date if available (for sequence members)
      const recalcDate = recalculatedDates.get(groupId);
      if (recalcDate) {
        updateChanges.fieldStartDate = recalcDate;
      } else if (changes.fieldStartDate !== undefined) {
        // Non-sequence planting - use direct date change
        updateChanges.fieldStartDate = changes.fieldStartDate;
      }

      if (Object.keys(updateChanges).length > 0) {
        updates.push({ id: groupId, changes: updateChanges });
      }
    }

    // Add updates for sequence members that weren't directly dragged but need date recalculation
    for (const [memberId, newDate] of recalculatedDates) {
      // Skip if already handled above
      if (pendingDragChanges.has(memberId)) continue;

      updates.push({ id: memberId, changes: { fieldStartDate: newDate } });
    }

    if (updates.length > 0) {
      bulkUpdatePlantings(updates);
    }

    setPendingDragChanges(new Map());
  }, [pendingDragChanges, bulkUpdatePlantings, bedMappings, currentPlan?.beds, currentPlan?.plantings, currentPlan?.sequences, currentPlan?.specs, currentPlan?.crops, gddCalculator]);

  const handleAddPlanting = useCallback(async (specId: string, fieldStartDate: string, bedId: string): Promise<string> => {
    const newPlanting = createPlanting({
      specId,
      fieldStartDate,
      startBed: bedId,
      bedFeet: 50, // Default to standard bed length
    });

    try {
      await addPlanting(newPlanting);
      selectPlanting(newPlanting.id);
      setToast({ message: `Added ${specId} to ${bedId}`, type: 'success' });
      return newPlanting.id;
    } catch (e) {
      setToast({ message: `Failed to add: ${e instanceof Error ? e.message : 'Unknown error'}`, type: 'error' });
      throw e;
    }
  }, [addPlanting, selectPlanting]);

  const handleEditPlantingSpec = useCallback((plantingId: string) => {
    // Find the planting to get the specId
    const planting = currentPlan?.plantings?.find(p => p.id === plantingId);

    if (!planting) {
      setToast({ message: `Planting not found: ${plantingId}`, type: 'error' });
      return;
    }

    const spec = getSpecById(planting.specId);
    if (!spec) {
      setToast({ message: `Spec not found: ${planting.specId}`, type: 'error' });
      return;
    }

    setEditingSpec(spec);
    setConfigEditorOpen(true);
  }, [currentPlan?.plantings, getSpecById, setToast]);

  const handleSavePlantingSpec = useCallback(async (updated: PlantingSpec) => {
    try {
      // Update the spec in the plan's catalog (not the template)
      const affectedCount = await updatePlantingSpec(updated);

      setConfigEditorOpen(false);
      setEditingSpec(null);

      if (affectedCount > 0) {
        setToast({ message: `Saved "${updated.name}" - updated ${affectedCount} planting(s)`, type: 'success' });
      } else {
        setToast({ message: `Saved "${updated.name}"`, type: 'success' });
      }
    } catch (e) {
      setToast({
        message: `Failed to save: ${e instanceof Error ? e.message : 'Unknown error'}`,
        type: 'error',
      });
    }
  }, [updatePlantingSpec, setToast]);

  // Compute preview crops using data-driven approach:
  // Apply pending changes to create a virtual plan, then use the same
  // getTimelineCropsFromPlan() function that renders use.
  //
  // Key insight: When ANY sequence member is dragged, recalculate ALL members' dates.
  // The dragged member's new harvest date becomes the reference point for calculating
  // all other members' target harvest dates (offset by slot × offsetDays).
  const previewCrops = useMemo(() => {
    // No pending changes - return computed crops as-is
    if (pendingDragChanges.size === 0 || !currentPlan) {
      return baseCrops;
    }

    // Build a map of recalculated dates for ALL sequence members when any member moves
    // Key: planting ID, Value: new field start date
    const recalculatedDates = new Map<string, string>();

    // Check each pending date change to see if it belongs to a sequence
    for (const [plantingId, changes] of pendingDragChanges) {
      if (!changes.fieldStartDate) continue;

      const draggedPlanting = currentPlan.plantings?.find(p => p.id === plantingId);
      if (!draggedPlanting?.sequenceId) continue;

      const sequence = currentPlan.sequences?.[draggedPlanting.sequenceId];
      if (!sequence) continue;

      // Get all plantings in this sequence
      const sequenceMembers = currentPlan.plantings?.filter(
        p => p.sequenceId === draggedPlanting.sequenceId
      ) ?? [];

      // Get spec for GDD calculations
      const spec = currentPlan.specs?.[draggedPlanting.specId];
      if (!spec) continue;

      // For GDD-staggered sequences with a GDD calculator, do proper harvest-date-based recalculation
      if (sequence.useGddStagger && gddCalculator && spec.cropId) {
        const cropEntity = currentPlan.crops?.[spec.cropId];
        const baseTemp = cropEntity?.gddBaseTemp;

        if (baseTemp !== undefined) {
          const daysInCells = calculateDaysInCells(spec);
          const seedToHarvest = getPrimarySeedToHarvest(spec);
          const fieldDaysToHarvest = seedToHarvest - daysInCells;
          const structureOffset = spec.growingStructure && spec.growingStructure !== 'field' ? 20 : 0;
          const cacheKey = makeCacheKey(baseTemp, cropEntity?.gddUpperTemp, structureOffset);
          const gddCache = gddCalculator.getCache();

          // Calculate FIXED GDD requirement from spec's reference date
          // This is the biological constant - how much heat the crop needs to mature
          // Using targetFieldDate (not the drag position) ensures consistent GDD across seasons
          let gddNeeded: number;
          let referenceDate: string;
          if (spec.targetFieldDate) {
            const planYear = currentPlan.metadata?.year ?? new Date().getFullYear();
            const [month, day] = spec.targetFieldDate.split('-').map(Number);
            referenceDate = `${planYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          } else {
            // Fall back to anchor's field start date (consistent with render path)
            const anchor = sequenceMembers.find(p => p.sequenceSlot === 0);
            referenceDate = anchor?.fieldStartDate ?? changes.fieldStartDate;
          }
          gddNeeded = getGddForDays(gddCache, referenceDate, fieldDaysToHarvest, cacheKey)
            ?? fieldDaysToHarvest * 15;

          // Calculate dragged planting's new harvest date
          const draggedHarvestDate = findHarvestDate(
            gddCache,
            changes.fieldStartDate,
            gddNeeded,
            cacheKey
          );

          if (draggedHarvestDate) {
            const draggedSlot = draggedPlanting.sequenceSlot ?? 0;

            // Recalculate all members' dates based on the dragged member's harvest
            for (const member of sequenceMembers) {
              const memberSlot = member.sequenceSlot ?? 0;
              const slotDiff = memberSlot - draggedSlot;
              const additionalDays = member.overrides?.additionalDaysInField ?? 0;

              // Calculate target harvest date for this member
              // target = dragged_harvest + (slot_diff × offsetDays) + additionalDays
              const targetHarvestMs = new Date(draggedHarvestDate).getTime() +
                (slotDiff * sequence.offsetDays + additionalDays) * 24 * 60 * 60 * 1000;
              const targetHarvestDate = new Date(targetHarvestMs).toISOString().split('T')[0];

              // Back-calculate plant date from target harvest
              const plantDate = findPlantDate(
                gddCache,
                targetHarvestDate,
                gddNeeded,
                cacheKey
              );

              if (plantDate) {
                recalculatedDates.set(member.id, plantDate);
              }
            }
          }
        }
      } else {
        // Non-GDD sequence: simple calendar offset from dragged member
        const draggedSlot = draggedPlanting.sequenceSlot ?? 0;

        for (const member of sequenceMembers) {
          const memberSlot = member.sequenceSlot ?? 0;
          const slotDiff = memberSlot - draggedSlot;
          const additionalDays = member.overrides?.additionalDaysInField ?? 0;

          // Calculate new date: dragged_date + (slot_diff × offsetDays) + additionalDays
          const newDateMs = new Date(changes.fieldStartDate).getTime() +
            (slotDiff * sequence.offsetDays + additionalDays) * 24 * 60 * 60 * 1000;
          const newDate = new Date(newDateMs).toISOString().split('T')[0];

          recalculatedDates.set(member.id, newDate);
        }
      }
    }

    // Create modified plantings with all changes applied
    const modifiedPlantings = currentPlan.plantings?.map(planting => {
      const directChanges = pendingDragChanges.get(planting.id);
      const recalcDate = recalculatedDates.get(planting.id);

      // No changes for this planting
      if (!directChanges && !recalcDate) return planting;

      let modified = { ...planting };

      // Apply bed change
      if (directChanges?.startBed !== undefined) {
        if (directChanges.startBed === null) {
          modified.startBed = null;
        } else {
          const bed = currentPlan.beds ? Object.values(currentPlan.beds).find(b => b.name === directChanges.startBed) : null;
          if (bed) {
            modified.startBed = bed.id;
          }
        }
      }

      // Apply date change - prefer recalculated (for sequence members) over direct
      if (recalcDate) {
        modified.fieldStartDate = recalcDate;
      } else if (directChanges?.fieldStartDate !== undefined) {
        modified.fieldStartDate = directChanges.fieldStartDate;
      }

      return modified;
    }) ?? [];

    // Create virtual plan with modified plantings
    const virtualPlan = {
      ...currentPlan,
      plantings: modifiedPlantings,
    };

    // Use the same function that render uses - this ensures preview matches committed result
    return getTimelineCropsFromPlan(virtualPlan, gddCalculator);
  }, [baseCrops, pendingDragChanges, currentPlan, gddCalculator]);

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
        specs={currentPlan.specs}
        planYear={currentPlan.metadata.year}
        onAddPlanting={handleAddPlanting}
        products={currentPlan.products}
        initialNoVarietyFilter={initialNoVarietyFilter}
        plantingBoxDisplay={currentPlan.plantingBoxDisplay}
        onUpdatePlantingBoxDisplay={updatePlantingBoxDisplay}
      />

      {/* Toast notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Planting spec editor modal */}
      <PlantingSpecEditor
        isOpen={configEditorOpen}
        spec={editingSpec}
        onClose={() => {
          setConfigEditorOpen(false);
          setEditingSpec(null);
        }}
        onSave={handleSavePlantingSpec}
        varieties={currentPlan?.varieties}
        seedMixes={currentPlan?.seedMixes}
        products={currentPlan?.products}
        markets={currentPlan?.markets}
        crops={currentPlan?.crops}
        lastFrostDate={currentPlan?.metadata.lastFrostDate}
        timingSettings={{
          transplantShockDays: currentPlan?.metadata.transplantShockDays,
          defaultTransplantAge: currentPlan?.metadata.defaultTransplantAge,
        }}
      />
    </PageLayout>
  );
}
