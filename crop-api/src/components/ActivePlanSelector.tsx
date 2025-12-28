'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getPlanList, type PlanSummary } from '@/lib/plan-store';

const ACTIVE_PLAN_KEY = 'crop-explorer-active-plan';

export default function ActivePlanSelector() {
  const router = useRouter();
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<PlanSummary | null>(null);
  const [planList, setPlanList] = useState<PlanSummary[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  // Load active plan ID from localStorage on mount
  useEffect(() => {
    const storedId = localStorage.getItem(ACTIVE_PLAN_KEY);
    if (storedId) {
      setActivePlanId(storedId);
    }
  }, []);

  // Load plan list and update active plan info
  useEffect(() => {
    getPlanList().then(plans => {
      setPlanList(plans);
      if (activePlanId) {
        const plan = plans.find(p => p.id === activePlanId);
        if (plan) {
          setActivePlan(plan);
        } else {
          // Active plan was deleted, clear it
          setActivePlanId(null);
          setActivePlan(null);
          localStorage.removeItem(ACTIVE_PLAN_KEY);
        }
      }
    }).catch(console.error);
  }, [activePlanId]);

  // Listen for storage changes (cross-tab sync)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === ACTIVE_PLAN_KEY) {
        const newId = e.newValue;
        setActivePlanId(newId);
        if (newId) {
          const plan = planList.find(p => p.id === newId);
          setActivePlan(plan || null);
        } else {
          setActivePlan(null);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [planList]);

  const handleSetActivePlan = useCallback((planId: string) => {
    setActivePlanId(planId);
    localStorage.setItem(ACTIVE_PLAN_KEY, planId);
    const plan = planList.find(p => p.id === planId);
    if (plan) {
      setActivePlan(plan);
    }
    setShowPicker(false);
  }, [planList]);

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">Plan:</span>
        {activePlan ? (
          <button
            onClick={() => setShowPicker(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <span className="text-sm font-medium text-gray-900">{activePlan.name}</span>
            <span className="text-xs text-gray-500">({activePlan.year})</span>
            <span className="text-xs text-gray-400">▼</span>
          </button>
        ) : (
          <button
            onClick={() => setShowPicker(true)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Select Plan
          </button>
        )}
        {activePlan && (
          <button
            onClick={() => router.push(`/timeline/${activePlanId}`)}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Open Timeline →
          </button>
        )}
      </div>

      {/* Plan Picker Modal */}
      {showPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[400px] max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Select Active Plan</h2>
              <button
                onClick={() => setShowPicker(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-4">
              <p className="text-sm text-gray-600 mb-4">
                Crops you add will go to your active plan.
              </p>

              {planList.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-4">No plans found.</p>
                  <button
                    onClick={() => {
                      setShowPicker(false);
                      router.push('/timeline');
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    Create a Plan
                  </button>
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {planList.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => handleSetActivePlan(plan.id)}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                        plan.id === activePlanId
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{plan.name}</span>
                        <span className="text-xs text-gray-500">({plan.year})</span>
                        {plan.id === activePlanId && (
                          <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">Active</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{plan.cropCount} crops</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowPicker(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
