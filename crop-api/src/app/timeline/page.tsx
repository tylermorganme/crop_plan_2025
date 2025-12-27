'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import CropTimeline from '@/components/CropTimeline';
import { getTimelineCrops, getResources, calculateRowSpan } from '@/lib/timeline-data';
import { usePlanStore, useUndoRedo, startAutoSave, stopAutoSave, exportPlanToFile, importPlanFromFile } from '@/lib/plan-store';
import type { TimelineCrop } from '@/lib/plan-types';
import bedPlanData from '@/data/bed-plan.json';

// Toast notification component
function Toast({ message, type, onClose }: { message: string; type: 'error' | 'success' | 'info'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-green-600' : 'bg-blue-600';

  return (
    <div className={`fixed bottom-4 right-4 ${bgColor} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50 animate-slide-up`}>
      <span>{message}</span>
      <button onClick={onClose} className="text-white/80 hover:text-white text-lg leading-none">&times;</button>
    </div>
  );
}

export default function TimelinePage() {
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Plan store state
  const currentPlan = usePlanStore((state) => state.currentPlan);
  const isDirty = usePlanStore((state) => state.isDirty);
  const createNewPlan = usePlanStore((state) => state.createNewPlan);
  const moveCrop = usePlanStore((state) => state.moveCrop);
  const updateCropDates = usePlanStore((state) => state.updateCropDates);
  const markSaved = usePlanStore((state) => state.markSaved);

  // Undo/redo
  const { canUndo, canRedo, undo, redo, undoCount, redoCount } = useUndoRedo();

  // Initialize plan from data if not already loaded (runs once on mount)
  useEffect(() => {
    // If already hydrated, check immediately
    if (usePlanStore.persist.hasHydrated()) {
      const state = usePlanStore.getState();
      if (state.currentPlan) {
        setLoading(false);
      } else {
        const timelineCrops = getTimelineCrops();
        const { resources, groups } = getResources();
        createNewPlan('Crop Plan 2025', timelineCrops, resources, groups);
        setLoading(false);
      }
      return;
    }

    // Wait for zustand to finish hydrating from localStorage
    const unsubscribe = usePlanStore.persist.onFinishHydration(() => {
      const state = usePlanStore.getState();
      if (state.currentPlan) {
        setLoading(false);
        return;
      }

      // No persisted plan - load initial data and create a new plan
      const timelineCrops = getTimelineCrops();
      const { resources, groups } = getResources();

      createNewPlan('Crop Plan 2025', timelineCrops, resources, groups);
      setLoading(false);
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start auto-save timer (saves snapshot every 15 minutes)
  useEffect(() => {
    startAutoSave();
    return () => stopAutoSave();
  }, []);

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

  const handleExport = useCallback(() => {
    try {
      exportPlanToFile();
      setToast({ message: 'Plan saved to file', type: 'success' });
    } catch (e) {
      setToast({ message: `Save failed: ${e instanceof Error ? e.message : 'Unknown error'}`, type: 'error' });
    }
  }, []);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const plan = await importPlanFromFile(file);
      setToast({ message: `Loaded "${plan.metadata.name}"`, type: 'success' });
    } catch (err) {
      setToast({ message: `Load failed: ${err instanceof Error ? err.message : 'Unknown error'}`, type: 'error' });
    }

    // Reset file input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

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
        <Link href="/" className="text-sm font-medium text-blue-600 hover:text-blue-800">
          ← Back
        </Link>
        <h1 className="text-xl font-bold text-gray-900">{currentPlan.metadata.name}</h1>
        <span className="text-sm font-medium text-gray-700">
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
            className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 disabled:text-gray-400 disabled:bg-gray-50 disabled:border-gray-200 disabled:cursor-not-allowed"
            title={`Undo (${undoCount} available) - Ctrl+Z`}
          >
            ↶ Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 disabled:text-gray-400 disabled:bg-gray-50 disabled:border-gray-200 disabled:cursor-not-allowed"
            title={`Redo (${redoCount} available) - Ctrl+Shift+Z`}
          >
            Redo ↷
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
            className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200"
          >
            Reset
          </button>
        </div>

        {/* Save/Load to file buttons */}
        <div className="flex items-center gap-2 border-l pl-4 ml-2">
          <button
            onClick={handleExport}
            className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200"
            title="Save plan to file"
          >
            Save to File
          </button>
          <button
            onClick={handleImportClick}
            className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200"
            title="Load plan from file"
          >
            Load
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".crop-plan.gz,.gz"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 min-h-0">
        <CropTimeline
          crops={currentPlan.crops}
          resources={currentPlan.resources}
          groups={currentPlan.groups}
          onCropMove={handleCropMove}
          onCropDateChange={handleDateChange}
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
    </div>
  );
}
