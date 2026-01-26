import { useState, useMemo, useCallback } from 'react';
import type { TimelineCrop } from '@/lib/entities/plan';
import type { Planting, Bed } from '@/lib/entities';
import { calculateRowSpan } from '@/lib/timeline-data';

/**
 * Pending drag changes - queued during drag, committed on drop.
 * Key is groupId (plantingId), value contains pending changes.
 */
interface PendingDragChanges {
  startBed?: string | null; // null = unassigned, undefined = unchanged
  fieldStartDate?: string;  // undefined = unchanged
}

interface UseDragPreviewOptions {
  crops: TimelineCrop[];
  plantings?: Planting[];
  beds?: Record<string, Bed>;
  /** Group name -> bed names (for row span calculation) */
  nameGroups?: Record<string, string[]>;
  bedLengths?: Record<string, number>;
  bulkUpdatePlantings: (updates: { id: string; changes: { startBed?: string | null; bedFeet?: number; fieldStartDate?: string } }[]) => void;
}

/**
 * Hook for managing drag preview state and committing changes.
 * Used by timeline page and overview page's focused group view.
 */
export function useDragPreview({
  crops,
  plantings,
  beds,
  nameGroups,
  bedLengths,
  bulkUpdatePlantings,
}: UseDragPreviewOptions) {
  const [pendingDragChanges, setPendingDragChanges] = useState<Map<string, PendingDragChanges>>(new Map());

  // Queue bulk crop moves for preview
  const handleBulkCropMove = useCallback((moves: { groupId: string; newResource: string; feetNeeded: number }[]) => {
    if (moves.length === 0) return;

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

  // Queue bulk date changes for preview
  const handleBulkCropDateChange = useCallback((dateUpdates: { groupId: string; startDate: string }[]) => {
    if (dateUpdates.length === 0) return;

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

  // Commit or discard pending changes
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
        } else if (nameGroups && bedLengths && beds) {
          // Moving to a real bed - resolve name to UUID
          const planting = plantings?.find(p => p.id === groupId);
          if (!planting) {
            console.error(`handleDragEnd: planting not found for groupId ${groupId}`);
            continue;
          }

          const { bedSpanInfo, isComplete } = calculateRowSpan(
            planting.bedFeet,
            changes.startBed,
            nameGroups,
            bedLengths
          );

          if (isComplete) {
            const bed = Object.values(beds).find(b => b.name === changes.startBed);
            if (bed) {
              updateChanges.startBed = bed.id;
              updateChanges.bedFeet = bedSpanInfo?.reduce((sum, b) => sum + b.feetUsed, 0) ?? planting.bedFeet;
            }
          }
        } else {
          // No bed mappings available, just use the bed name as-is
          // This is a fallback for simpler use cases
          updateChanges.startBed = changes.startBed;
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
  }, [pendingDragChanges, bulkUpdatePlantings, beds, nameGroups, bedLengths, plantings]);

  // Compute preview crops with pending changes applied
  const previewCrops = useMemo(() => {
    if (pendingDragChanges.size === 0) {
      return crops;
    }

    return crops.map(crop => {
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
          const planting = plantings?.find(p => p.id === crop.groupId);
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
  }, [crops, pendingDragChanges, plantings]);

  return {
    previewCrops,
    handleBulkCropMove,
    handleBulkCropDateChange,
    handleDragEnd,
    hasPendingChanges: pendingDragChanges.size > 0,
  };
}
