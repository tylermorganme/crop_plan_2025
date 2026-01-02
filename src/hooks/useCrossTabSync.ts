'use client';

import { useEffect } from 'react';
import { usePlanStore } from '@/lib/plan-store';
import { getPlanStorageKey } from '@/lib/storage-adapter';

/**
 * Syncs plan state across browser tabs/windows and within the same tab.
 *
 * Listens for:
 * - Storage events (fires in OTHER tabs when localStorage changes)
 * - Custom 'plan-updated' events (fires in SAME tab when CropExplorer adds crops)
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

    // Handle changes from same tab (e.g., CropExplorer adding crops)
    const handlePlanUpdate = (e: CustomEvent<{ planId: string }>) => {
      if (e.detail.planId === planId) {
        loadPlanById(planId);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('plan-updated', handlePlanUpdate as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('plan-updated', handlePlanUpdate as EventListener);
    };
  }, [planId, loadPlanById]);
}
