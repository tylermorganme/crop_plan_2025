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
import { getTimelineCrops, getResources } from '@/lib/timeline-data';

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

export default function TimelineListPage() {
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

  const handleCreateNew = useCallback(async () => {
    const timelineCrops = getTimelineCrops();
    const { resources, groups } = getResources();
    await createNewPlan('Crop Plan 2025', timelineCrops, resources, groups);

    // Get the newly created plan ID
    const newPlan = usePlanStore.getState().currentPlan;
    if (newPlan) {
      router.push(`/timeline/${newPlan.id}`);
    }
  }, [createNewPlan, router]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const plan = await importPlanFromFile(file);
      setToast({ message: `Loaded "${plan.metadata.name}"`, type: 'success' });
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
    const planList = await getPlanList();
    setPlans(planList);
    setToast({ message: `Deleted "${planName}"`, type: 'info' });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading plans...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm font-medium text-blue-600 hover:text-blue-800">
              ← Back
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Crop Plans</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleImportClick}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Load from File
            </button>
            <button
              onClick={handleCreateNew}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              + New Plan
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
            <p className="text-gray-500 mb-6">Create a new plan or load one from a file.</p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleImportClick}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Load from File
              </button>
              <button
                onClick={handleCreateNew}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                + New Plan
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
                  <Link
                    href={`/timeline/${plan.id}`}
                    className="flex-1 min-w-0"
                  >
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-gray-900 truncate">
                        {plan.name}
                        {plan.version && (
                          <span className="text-sm font-normal text-gray-500 ml-2">
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
                    <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                      <span>{plan.cropCount} crops</span>
                      <span>Modified {formatDate(plan.lastModified)}</span>
                    </div>
                  </Link>
                  <div className="flex items-center gap-2 ml-4">
                    <Link
                      href={`/timeline/${plan.id}`}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                    >
                      Open
                    </Link>
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
