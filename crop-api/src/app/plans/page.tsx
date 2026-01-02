'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  usePlanStore,
  getPlanList,
  importPlanFromFile,
  deletePlanFromLibrary,
  migrateOldStorageFormat,
  type PlanSummary,
} from '@/lib/plan-store';
import { getTimelineCrops, collapseToPlantings } from '@/lib/timeline-data';

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
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createNewPlan = usePlanStore((state) => state.createNewPlan);
  const currentPlan = usePlanStore((state) => state.currentPlan);

  // Migrate old storage format and load plan list
  useEffect(() => {
    async function init() {
      await migrateOldStorageFormat();
      const planList = await getPlanList();
      setPlans(planList);
      setLoading(false);
    }
    init();
  }, []);

  // Calculate default year: closest April (if May or later, next year)
  const getDefaultYear = useCallback(() => {
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    return currentMonth >= 4 ? currentYear + 1 : currentYear;
  }, []);

  const handleCreateFromTemplate = useCallback(async () => {
    const timelineCrops = getTimelineCrops();
    const plantings = collapseToPlantings(timelineCrops);
    const defaultYear = getDefaultYear();
    await createNewPlan(`Crop Plan ${defaultYear}`, plantings);

    // Get the newly created plan ID
    const newPlan = usePlanStore.getState().currentPlan;
    if (newPlan) {
      // Set as active plan for Crop Explorer
      localStorage.setItem('crop-explorer-active-plan', newPlan.id);
      // Notify other components
      window.dispatchEvent(new CustomEvent('plan-list-updated'));
      router.push(`/timeline/${newPlan.id}`);
    }
  }, [createNewPlan, router, getDefaultYear]);

  const handleCreateBlank = useCallback(async () => {
    const defaultYear = getDefaultYear();
    // Create with empty plantings
    await createNewPlan(`Crop Plan ${defaultYear}`);

    // Get the newly created plan ID
    const newPlan = usePlanStore.getState().currentPlan;
    if (newPlan) {
      // Set as active plan for Crop Explorer
      localStorage.setItem('crop-explorer-active-plan', newPlan.id);
      // Notify other components
      window.dispatchEvent(new CustomEvent('plan-list-updated'));
      router.push(`/timeline/${newPlan.id}`);
    }
  }, [createNewPlan, router, getDefaultYear]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const plan = await importPlanFromFile(file);
      setToast({ message: `Loaded "${plan.metadata.name}"`, type: 'success' });
      // Set as active plan for Crop Explorer
      localStorage.setItem('crop-explorer-active-plan', plan.id);
      // Refresh plan list
      const planList = await getPlanList();
      setPlans(planList);
      // Notify other components
      window.dispatchEvent(new CustomEvent('plan-list-updated'));
      // Navigate to the new plan
      router.push(`/timeline/${plan.id}`);
    } catch (err) {
      setToast({ message: `Load failed: ${err instanceof Error ? err.message : 'Unknown error'}`, type: 'error' });
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [router]);

  const handleDelete = useCallback(async (planId: string, planName: string) => {
    if (!confirm(`Delete "${planName}"? This cannot be undone.`)) return;

    await deletePlanFromLibrary(planId);

    // If deleting the active plan, clear it
    const activePlanId = localStorage.getItem('crop-explorer-active-plan');
    if (activePlanId === planId) {
      localStorage.removeItem('crop-explorer-active-plan');
    }

    const planList = await getPlanList();
    setPlans(planList);
    setToast({ message: `Deleted "${planName}"`, type: 'info' });
    // Notify other components
    window.dispatchEvent(new CustomEvent('plan-list-updated'));
  }, []);

  const handleOpenPlan = useCallback((planId: string) => {
    // Set as active plan
    localStorage.setItem('crop-explorer-active-plan', planId);
    window.dispatchEvent(new CustomEvent('plan-list-updated'));
    router.push(`/timeline/${planId}`);
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-60px)]">
        <div className="text-gray-600">Loading plans...</div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-60px)] bg-gray-50">
      {/* Toolbar */}
      <div className="bg-white border-b px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">All Plans</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={handleImportClick}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Load from File
            </button>
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
            <input
              ref={fileInputRef}
              type="file"
              accept=".crop-plan.gz,.gz"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        </div>
      </div>

      {/* Plan List */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {plans.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-gray-400 text-6xl mb-4">📋</div>
            <h2 className="text-xl font-medium text-gray-700 mb-2">No plans yet</h2>
            <p className="text-gray-600 mb-6">Create a new plan or load one from a file.</p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleImportClick}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Load from File
              </button>
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
    </div>
  );
}
