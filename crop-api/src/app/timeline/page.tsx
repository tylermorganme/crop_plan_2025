'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import CropTimeline from '@/components/CropTimeline';
import { getTimelineCrops, getResources, calculateRowSpan } from '@/lib/timeline-data';
import { usePlanStore, useUndoRedo } from '@/lib/plan-store';
import type { TimelineCrop } from '@/lib/plan-types';
import bedPlanData from '@/data/bed-plan.json';

export default function TimelinePage() {
  const [loading, setLoading] = useState(true);

  // Plan store state
  const currentPlan = usePlanStore((state) => state.currentPlan);
  const isDirty = usePlanStore((state) => state.isDirty);
  const createNewPlan = usePlanStore((state) => state.createNewPlan);
  const moveCrop = usePlanStore((state) => state.moveCrop);
  const markSaved = usePlanStore((state) => state.markSaved);

  // Undo/redo
  const { canUndo, canRedo, undo, redo, undoCount, redoCount } = useUndoRedo();

  // Initialize plan from data if not already loaded
  useEffect(() => {
    // Check if we already have a plan loaded from localStorage
    if (currentPlan) {
      setLoading(false);
      return;
    }

    // Load initial data and create a new plan
    const timelineCrops = getTimelineCrops();
    const { resources, groups } = getResources();

    createNewPlan('Crop Plan 2025', timelineCrops, resources, groups);
    setLoading(false);
  }, [currentPlan, createNewPlan]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) redo();
        } else {
          if (canUndo) undo();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        if (canRedo) redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, undo, redo]);

  const handleCropMove = useCallback((cropId: string, newResource: string, groupId?: string, bedsNeeded?: number) => {
    const beds = bedsNeeded || 1;
    const targetGroupId = groupId || cropId;

    // Moving to Unassigned - no capacity check needed
    if (newResource === '') {
      moveCrop(targetGroupId, '');
      return;
    }

    // Moving to a real bed - calculate span based on bedsNeeded and target row's bed size
    const { bedSpanInfo, isComplete, bedsRequired } = calculateRowSpan(
      beds,
      newResource,
      (bedPlanData as { bedGroups: Record<string, string[]> }).bedGroups
    );

    // Don't allow the move if there isn't enough room
    if (!isComplete) {
      alert(`Not enough room: this crop needs ${bedsRequired} beds but only ${bedSpanInfo.length} available from ${newResource}`);
      return;
    }

    // Use the plan store's moveCrop which handles undo
    const newBeds = bedSpanInfo.map(info => info.bed);
    moveCrop(targetGroupId, newResource, newBeds);
  }, [moveCrop]);

  const handleSave = useCallback(() => {
    // For now, just mark as saved (localStorage already persists automatically)
    markSaved();
  }, [markSaved]);

  const handleReset = useCallback(() => {
    if (!confirm('Reset to original data? This will discard all changes.')) return;

    const timelineCrops = getTimelineCrops();
    const { resources, groups } = getResources();
    createNewPlan('Crop Plan 2025', timelineCrops, resources, groups);
  }, [createNewPlan]);

  if (loading || !currentPlan) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading timeline...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-4">
        <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm">
          &larr; Back to Explorer
        </Link>
        <h1 className="text-lg font-semibold">{currentPlan.metadata.name}</h1>
        <span className="text-sm text-gray-500">
          {currentPlan.crops.length} crops
        </span>

        {/* Dirty indicator */}
        {isDirty && (
          <span className="text-sm text-amber-600 font-medium">
            &bull; Unsaved changes
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Undo/Redo buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="px-2 py-1 text-sm rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
            title={`Undo (${undoCount} available) - Ctrl+Z`}
          >
            &#x21B6; Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="px-2 py-1 text-sm rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
            title={`Redo (${redoCount} available) - Ctrl+Shift+Z`}
          >
            Redo &#x21B7;
          </button>
        </div>

        {/* Save/Reset buttons */}
        <div className="flex items-center gap-2 border-l pl-4 ml-2">
          <button
            onClick={handleSave}
            disabled={!isDirty}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
          <button
            onClick={handleReset}
            className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 min-h-0">
        <CropTimeline
          crops={currentPlan.crops}
          resources={currentPlan.resources}
          groups={currentPlan.groups}
          onCropMove={handleCropMove}
        />
      </div>
    </div>
  );
}
