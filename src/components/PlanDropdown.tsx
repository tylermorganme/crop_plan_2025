'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { usePlanStore, ACTIVE_PLAN_KEY } from '@/lib/plan-store';

export default function PlanDropdown() {
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Use centralized store state - automatically syncs across tabs
  const planList = usePlanStore((state) => state.planList);
  const activePlanId = usePlanStore((state) => state.activePlanId);
  const setActivePlanId = usePlanStore((state) => state.setActivePlanId);
  const refreshPlanList = usePlanStore((state) => state.refreshPlanList);

  // Find active plan from list
  const activePlan = useMemo(() => {
    if (!activePlanId) return null;
    return planList.find(p => p.id === activePlanId) ?? null;
  }, [planList, activePlanId]);

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
    setIsOpen(false);

    // If we're on a timeline page, navigate to the new plan's timeline
    if (pathname.startsWith('/timeline/')) {
      router.push(`/timeline/${planId}`);
    }
  }, [pathname, router, setActivePlanId]);

  const handleAllPlans = useCallback(() => {
    setIsOpen(false);
    router.push('/plans');
  }, [router]);

  const handleNewPlan = useCallback(() => {
    setIsOpen(false);
    router.push('/plans');
  }, [router]);

  // Get recent plans (up to 5, excluding current)
  const recentPlans = useMemo(() => {
    return planList
      .filter(p => p.id !== activePlanId)
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, 5);
  }, [planList, activePlanId]);

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
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export the key for use in other components
export { ACTIVE_PLAN_KEY };
