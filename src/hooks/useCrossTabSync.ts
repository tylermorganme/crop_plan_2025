'use client';

import { useEffect } from 'react';
import { usePlanStore } from '@/lib/plan-store';
import { getPlanStorageKey } from '@/lib/storage-adapter';

/**
 * Syncs plan state across browser tabs/windows.
 *
 * Listens for storage events which fire in OTHER tabs when localStorage changes.
 * Same-tab sync is handled automatically by Zustand reactivity - all components
 * using the store will re-render when state changes.
 */
export function useCrossTabSync(planId: string) {
  const loadPlanById = usePlanStore((state) => state.loadPlanById);

  useEffect(() => {
    // Handle changes from other tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === getPlanStorageKey(planId)) {
        loadPlanById(planId);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [planId, loadPlanById]);
}
