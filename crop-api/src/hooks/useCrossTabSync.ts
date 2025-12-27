'use client';

import { useEffect } from 'react';
import { usePlanStore } from '@/lib/plan-store';
import { getPlanStorageKey } from '@/lib/storage-adapter';

/**
 * Syncs plan state across browser tabs/windows.
 *
 * When another tab saves to localStorage, this tab reloads the plan.
 * The storage event only fires in OTHER tabs, not the one that wrote,
 * so the active editing tab is never interrupted.
 */
export function useCrossTabSync(planId: string) {
  const loadPlanById = usePlanStore((state) => state.loadPlanById);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Only react to changes in this plan's storage key
      if (e.key === getPlanStorageKey(planId)) {
        loadPlanById(planId);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [planId, loadPlanById]);
}
