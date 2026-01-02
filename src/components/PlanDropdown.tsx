'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getPlanList, type PlanSummary } from '@/lib/plan-store';

const ACTIVE_PLAN_KEY = 'crop-explorer-active-plan';

export default function PlanDropdown() {
  const router = useRouter();
  const pathname = usePathname();
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<PlanSummary | null>(null);
  const [planList, setPlanList] = useState<PlanSummary[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Listen for plan list updates (when plans are created/deleted)
  useEffect(() => {
    const handlePlanListUpdate = () => {
      getPlanList().then(plans => {
        setPlanList(plans);
        if (activePlanId) {
          const plan = plans.find(p => p.id === activePlanId);
          setActivePlan(plan || null);
        }
      }).catch(console.error);
    };

    window.addEventListener('plan-list-updated', handlePlanListUpdate);
    return () => window.removeEventListener('plan-list-updated', handlePlanListUpdate);
  }, [activePlanId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSetActivePlan = useCallback((planId: string) => {
    setActivePlanId(planId);
    localStorage.setItem(ACTIVE_PLAN_KEY, planId);
    const plan = planList.find(p => p.id === planId);
    if (plan) {
      setActivePlan(plan);
    }
    setIsOpen(false);

    // If we're on a timeline page, navigate to the new plan's timeline
    if (pathname.startsWith('/timeline/')) {
      router.push(`/timeline/${planId}`);
    }
  }, [planList, pathname, router]);

  const handleAllPlans = useCallback(() => {
    setIsOpen(false);
    router.push('/plans');
  }, [router]);

  const handleNewPlan = useCallback(() => {
    setIsOpen(false);
    router.push('/plans');
  }, [router]);

  const handleLoadFromFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { importPlanFromFile } = await import('@/lib/plan-store');
      const plan = await importPlanFromFile(file);
      // Set as active plan
      localStorage.setItem(ACTIVE_PLAN_KEY, plan.id);
      setActivePlanId(plan.id);
      setIsOpen(false);
      // Navigate to the new plan
      router.push(`/timeline/${plan.id}`);
      // Trigger plan list refresh
      window.dispatchEvent(new CustomEvent('plan-list-updated'));
    } catch (err) {
      console.error('Failed to import plan:', err);
      alert(`Load failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [router]);

  // Get recent plans (up to 5, excluding current)
  const recentPlans = planList
    .filter(p => p.id !== activePlanId)
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, 5);

  return (
    <div className="relative" ref={dropdownRef}>
      {activePlan ? (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
        >
          <span className="text-sm font-medium text-gray-900">{activePlan.name}</span>
          <span className="text-xs text-gray-600">({activePlan.year})</span>
          <svg
            className={`w-4 h-4 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      ) : (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Select Plan
        </button>
      )}

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          {/* Current Plan */}
          {activePlan && (
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="text-xs text-gray-600 uppercase tracking-wide mb-1">Current Plan</div>
              <div className="font-medium text-gray-900">{activePlan.name}</div>
              <div className="text-xs text-gray-600">{activePlan.year} &middot; {activePlan.cropCount} crops</div>
            </div>
          )}

          {/* Recent Plans */}
          {recentPlans.length > 0 && (
            <div className="py-2 border-b border-gray-100">
              <div className="px-4 py-1 text-xs text-gray-600 uppercase tracking-wide">Switch Plan</div>
              {recentPlans.map(plan => (
                <button
                  key={plan.id}
                  onClick={() => handleSetActivePlan(plan.id)}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="text-sm font-medium text-gray-900">{plan.name}</div>
                  <div className="text-xs text-gray-600">{plan.year} &middot; {plan.cropCount} crops</div>
                </button>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="py-2">
            <button
              onClick={handleAllPlans}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              All Plans...
            </button>
            <button
              onClick={handleNewPlan}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              New Plan...
            </button>
            <button
              onClick={handleLoadFromFile}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Load from File...
            </button>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".crop-plan.gz,.gz"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}
    </div>
  );
}

// Export the key for use in other components
export { ACTIVE_PLAN_KEY };
