'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import CropTimeline from '@/components/CropTimeline';
import HistoryPanel from '@/components/HistoryPanel';
import CopyPlanModal, { type CopyPlanOptions } from '@/components/CopyPlanModal';
import { getTimelineCrops, getResources, calculateRowSpan } from '@/lib/timeline-data';
import {
  usePlanStore,
  useUndoRedo,
  useSaveState,
  startAutoSave,
  stopAutoSave,
  exportPlanToFile,
  importPlanFromFile,
  loadPlanFromLibrary,
  savePlanToLibrary,
  getPlanList,
  copyPlan,
} from '@/lib/plan-store';
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

export default function TimelinePlanPage() {
  const params = useParams();
  const router = useRouter();
  const planId = params.planId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Plan store state
  const currentPlan = usePlanStore((state) => state.currentPlan);
  const isDirty = usePlanStore((state) => state.isDirty);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);
  const renamePlan = usePlanStore((state) => state.renamePlan);
  const moveCrop = usePlanStore((state) => state.moveCrop);
  const updateCropDates = usePlanStore((state) => state.updateCropDates);
  const markSaved = usePlanStore((state) => state.markSaved);

  // Undo/redo
  const { canUndo, canRedo, undo, redo, undoCount, redoCount } = useUndoRedo();

  // Save state (for saving indicator and error handling)
  const { isSaving, saveError, clearSaveError } = useSaveState();

  // Load the specific plan by ID
  useEffect(() => {
    if (!planId) {
      setError('No plan ID provided');
      setLoading(false);
      return;
    }

    // Try to load the plan from library
    async function loadPlan() {
      try {
        const planData = await loadPlanFromLibrary(planId);
        if (planData) {
          await loadPlanById(planId);
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

  // Start auto-save timer (saves snapshot every 15 minutes)
  useEffect(() => {
    startAutoSave();
    return () => stopAutoSave();
  }, []);

  // Show save errors as toasts
  useEffect(() => {
    if (saveError) {
      setToast({ message: `Save failed: ${saveError}`, type: 'error' });
      clearSaveError();
    }
  }, [saveError, clearSaveError]);

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

  const handleSave = useCallback(async () => {
    // Save to library is automatic now, but mark as saved
    if (currentPlan) {
      await savePlanToLibrary(currentPlan);
    }
    markSaved();
  }, [currentPlan, markSaved]);

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
      // Navigate to the new plan's URL
      router.push(`/timeline/${plan.id}`);
    } catch (err) {
      setToast({ message: `Load failed: ${err instanceof Error ? err.message : 'Unknown error'}`, type: 'error' });
    }

    // Reset file input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [router]);

  const startEditingName = useCallback(() => {
    if (currentPlan) {
      setEditedName(currentPlan.metadata.name);
      setIsEditingName(true);
      // Focus input after render
      setTimeout(() => nameInputRef.current?.select(), 0);
    }
  }, [currentPlan]);

  const saveEditedName = useCallback(async () => {
    const trimmedName = editedName.trim();
    if (trimmedName && trimmedName !== currentPlan?.metadata.name) {
      await renamePlan(trimmedName);
      setToast({ message: 'Plan renamed', type: 'success' });
    }
    setIsEditingName(false);
  }, [editedName, currentPlan, renamePlan]);

  const cancelEditingName = useCallback(() => {
    setIsEditingName(false);
    setEditedName('');
  }, []);

  const handleCopyPlan = useCallback(async (options: CopyPlanOptions) => {
    setIsCopying(true);
    try {
      const newPlanId = await copyPlan(options);
      setCopyModalOpen(false);
      setToast({ message: `Created "${options.newName}"`, type: 'success' });
      // Navigate to the new plan
      router.push(`/timeline/${newPlanId}`);
    } catch (e) {
      setToast({
        message: `Failed to copy plan: ${e instanceof Error ? e.message : 'Unknown error'}`,
        type: 'error',
      });
    }
    setIsCopying(false);
  }, [router]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEditedName();
    } else if (e.key === 'Escape') {
      cancelEditingName();
    }
  }, [saveEditedName, cancelEditingName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading plan...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <div className="text-red-600 font-medium">{error}</div>
        <Link href="/timeline" className="text-blue-600 hover:text-blue-800">
          ← Back to plan list
        </Link>
      </div>
    );
  }

  if (!currentPlan) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">No plan loaded</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-4">
        <Link href="/timeline" className="text-sm font-medium text-blue-600 hover:text-blue-800">
          ← Plans
        </Link>
        {isEditingName ? (
          <div className="flex items-center gap-2">
            <input
              ref={nameInputRef}
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onKeyDown={handleNameKeyDown}
              onBlur={saveEditedName}
              className="text-xl font-bold text-gray-900 border border-blue-500 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ width: Math.max(200, editedName.length * 12) }}
            />
            {currentPlan.metadata.version && (
              <span className="text-sm font-normal text-gray-500">v{currentPlan.metadata.version}</span>
            )}
          </div>
        ) : (
          <h1
            className="text-xl font-bold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors"
            onClick={startEditingName}
            title="Click to rename"
          >
            {currentPlan.metadata.name}
            {currentPlan.metadata.version && (
              <span className="text-sm font-normal text-gray-500 ml-2">v{currentPlan.metadata.version}</span>
            )}
          </h1>
        )}
        <span className="text-sm font-medium text-gray-700">
          {currentPlan.crops.length} crops
        </span>

        {/* Save status indicator */}
        {isSaving ? (
          <span className="text-sm text-blue-600 font-medium flex items-center gap-1">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Saving...
          </span>
        ) : isDirty ? (
          <span className="text-sm text-amber-600 font-medium">
            &bull; Unsaved changes
          </span>
        ) : null}

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

        {/* Copy Plan button */}
        <div className="border-l pl-4 ml-2">
          <button
            onClick={() => setCopyModalOpen(true)}
            disabled={isCopying}
            className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Copy plan for next year"
          >
            {isCopying ? 'Copying...' : 'Copy Plan'}
          </button>
        </div>

        {/* History button */}
        <div className="border-l pl-4 ml-2">
          <button
            onClick={() => setHistoryPanelOpen(true)}
            className="px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200"
            title="View history and checkpoints"
          >
            History
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

      {/* History panel */}
      <HistoryPanel
        planId={planId}
        isOpen={historyPanelOpen}
        onClose={() => setHistoryPanelOpen(false)}
        onRestore={(message) => setToast({ message, type: 'success' })}
        onError={(message) => setToast({ message, type: 'error' })}
      />

      {/* Copy plan modal */}
      <CopyPlanModal
        isOpen={copyModalOpen}
        currentPlanName={currentPlan?.metadata.name || ''}
        onClose={() => setCopyModalOpen(false)}
        onCopy={handleCopyPlan}
      />
    </div>
  );
}
