'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import CropTimeline from '@/components/CropTimeline';
import HistoryPanel from '@/components/HistoryPanel';
import CopyPlanModal, { type CopyPlanOptions } from '@/components/CopyPlanModal';
import CropConfigEditor from '@/components/CropConfigEditor';
import { type CropConfig } from '@/lib/entities/crop-config';
import { calculateRowSpan, getTimelineCropsFromPlan } from '@/lib/timeline-data';
import { getResources, getGroups } from '@/lib/plan-types';
import { createPlanting } from '@/lib/entities/planting';
import {
  usePlanStore,
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
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [configEditorOpen, setConfigEditorOpen] = useState(false);
  const [editingCrop, setEditingCrop] = useState<CropConfig | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Plan store state
  const currentPlan = usePlanStore((state) => state.currentPlan);
  const isDirty = usePlanStore((state) => state.isDirty);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);
  const moveCrop = usePlanStore((state) => state.moveCrop);
  const updateCropDates = usePlanStore((state) => state.updateCropDates);
  const markSaved = usePlanStore((state) => state.markSaved);

  // Save state (for saving indicator and error handling)
  const { isSaving, saveError, clearSaveError } = useSaveState();

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
  }, [currentPlan?.cropCatalog]);

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

  const handleDuplicateCrop = useCallback(async (groupId: string) => {
    try {
      await duplicatePlanting(groupId);
      setToast({ message: 'Planting duplicated - find it in Unassigned', type: 'success' });
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
  }) => {
    try {
      await updatePlanting(plantingId, updates);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]">
        <div className="text-gray-600">Loading plan...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-48px)] gap-4">
        <div className="text-red-600 font-medium">{error}</div>
        <Link href="/plans" className="text-blue-600 hover:text-blue-800">
          ← Back to plan list
        </Link>
      </div>
    );
  }

  if (!currentPlan) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]">
        <div className="text-gray-600">No plan loaded</div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col">
      {/* Toolbar */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-4">
        {/* Save status indicator */}
        {isSaving ? (
          <span className="text-sm text-gray-600 flex items-center gap-1">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Saving...
          </span>
        ) : (
          <span className="text-sm text-gray-600">Saved</span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Undo/Redo buttons are now in AppHeader */}

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

      {/* Crop config editor modal */}
      <CropConfigEditor
        isOpen={configEditorOpen}
        crop={editingCrop}
        onClose={() => {
          setConfigEditorOpen(false);
          setEditingCrop(null);
        }}
        onSave={handleSaveCropConfig}
      />
    </div>
  );
}
