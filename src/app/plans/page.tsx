'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { parseISO } from 'date-fns';
import {
  usePlanStore,
  deletePlanFromLibrary,
  copyPlan,
} from '@/lib/plan-store';
import { getTimelineCrops, collapseToPlantings } from '@/lib/timeline-data';
import { Z_INDEX } from '@/lib/z-index';
import CopyPlanModal from '@/components/CopyPlanModal';
import type { CopyPlanOptions } from '@/components/CopyPlanModal';

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

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function PlansPage() {
  const router = useRouter();
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [copyModalPlan, setCopyModalPlan] = useState<{ id: string; name: string } | null>(null);

  // Use centralized store state - automatically syncs across tabs
  const plans = usePlanStore((state) => state.planList);
  const currentPlan = usePlanStore((state) => state.currentPlan);
  const createNewPlan = usePlanStore((state) => state.createNewPlan);
  const setActivePlanId = usePlanStore((state) => state.setActivePlanId);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);
  const refreshPlanList = usePlanStore((state) => state.refreshPlanList);

  // Ensure plan list is loaded (may already be from PlanStoreProvider)
  useEffect(() => {
    if (plans.length === 0) {
      refreshPlanList();
    }
  }, [plans.length, refreshPlanList]);

  // Calculate default year: closest April (if May or later, next year)
  const getDefaultYear = useCallback(() => {
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    return currentMonth >= 4 ? currentYear + 1 : currentYear;
  }, []);

  const handleCreateFromTemplate = useCallback(async () => {
    const timelineCrops = getTimelineCrops();
    const plantings = collapseToPlantings(timelineCrops);

    // Detect year from the planting dates (most common year)
    const yearCounts = new Map<number, number>();
    for (const crop of timelineCrops) {
      if (crop.startDate) {
        const year = parseISO(crop.startDate).getFullYear();
        yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
      }
    }
    let detectedYear = getDefaultYear();
    let maxCount = 0;
    for (const [year, count] of yearCounts) {
      if (count > maxCount) {
        maxCount = count;
        detectedYear = year;
      }
    }

    await createNewPlan(`Crop Plan ${detectedYear}`, plantings);

    // Get the newly created plan ID and set as active
    const newPlan = usePlanStore.getState().currentPlan;
    if (newPlan) {
      setActivePlanId(newPlan.id);
      await refreshPlanList();
      router.push(`/timeline/${newPlan.id}`);
    }
  }, [createNewPlan, router, getDefaultYear, setActivePlanId, refreshPlanList]);

  const handleCreateBlank = useCallback(async () => {
    const defaultYear = getDefaultYear();
    await createNewPlan(`Crop Plan ${defaultYear}`);

    // Get the newly created plan ID and set as active
    const newPlan = usePlanStore.getState().currentPlan;
    if (newPlan) {
      setActivePlanId(newPlan.id);
      await refreshPlanList();
      router.push(`/timeline/${newPlan.id}`);
    }
  }, [createNewPlan, router, getDefaultYear, setActivePlanId, refreshPlanList]);

  const handleDelete = useCallback(async (planId: string, planName: string) => {
    if (!confirm(`Delete "${planName}"? This cannot be undone.`)) return;

    await deletePlanFromLibrary(planId);
    await refreshPlanList(); // This also clears activePlanId if deleted
    setToast({ message: `Deleted "${planName}"`, type: 'info' });
  }, [refreshPlanList]);

  const handleOpenPlan = useCallback((planId: string) => {
    setActivePlanId(planId);
    router.push(`/timeline/${planId}`);
  }, [router, setActivePlanId]);

  const handleCopyPlan = useCallback(async (planId: string, planName: string) => {
    // Load the plan first so copyPlan has it as currentPlan
    await loadPlanById(planId);
    setCopyModalPlan({ id: planId, name: planName });
  }, [loadPlanById]);

  const handleCopyConfirm = useCallback(async (options: CopyPlanOptions) => {
    await copyPlan(options);
    await refreshPlanList();
    setCopyModalPlan(null);
    setToast({ message: `Copied to "${options.newName}"`, type: 'success' });
  }, [refreshPlanList]);

  return (
    <div className="h-[calc(100vh-51px)] overflow-auto bg-gray-50">
      {/* Toolbar */}
      <div className="bg-white border-b px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">All Plans</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCreateBlank}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              + Blank Plan
            </button>
            <button
              onClick={handleCreateFromTemplate}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              title="Create from current Excel import"
            >
              + From Template
            </button>
          </div>
        </div>
      </div>

      {/* Plan List */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {plans.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-gray-400 text-6xl mb-4">📋</div>
            <h2 className="text-xl font-medium text-gray-700 mb-2">No plans yet</h2>
            <p className="text-gray-600 mb-6">Create a new plan to get started.</p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleCreateBlank}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                + Blank Plan
              </button>
              <button
                onClick={handleCreateFromTemplate}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                title="Create from current Excel import"
              >
                + From Template
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between p-4">
                  <button
                    onClick={() => handleOpenPlan(plan.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-gray-900 truncate">
                        {plan.name}
                        <span className="text-sm font-normal text-gray-600 ml-2">
                          ({plan.year})
                        </span>
                        {plan.version && (
                          <span className="text-sm font-normal text-gray-600 ml-1">
                            v{plan.version}
                          </span>
                        )}
                      </h3>
                      {currentPlan?.id === plan.id && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                      <span>{plan.cropCount} crops</span>
                      <span>Created {formatDate(plan.createdAt)}</span>
                      <span>Modified {formatDate(plan.lastModified)}</span>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => handleOpenPlan(plan.id)}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => handleCopyPlan(plan.id, plan.name)}
                      className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-100 rounded"
                      title="Copy plan"
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => handleDelete(plan.id, plan.name)}
                      className="px-3 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded"
                      title="Delete plan"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Copy Plan Modal */}
      {copyModalPlan && (
        <CopyPlanModal
          isOpen={true}
          currentPlanName={copyModalPlan.name}
          onClose={() => setCopyModalPlan(null)}
          onCopy={handleCopyConfirm}
        />
      )}
    </div>
  );
}
