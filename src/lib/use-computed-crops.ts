/**
 * useComputedCrops - Single source of truth for computed timeline crops
 *
 * This hook provides the fully-computed TimelineCrop[] with all timing adjustments
 * (GDD, actuals, overrides) applied. ALL UIs that need crop timing data should
 * use this hook instead of calling getTimelineCropsFromPlan directly.
 *
 * Architecture:
 * - Plan data (plantings, specs, etc.) comes from the plan store
 * - GDD calculator (when location is set) adjusts field days for temperature
 * - The result is a single computed array that all views consume
 * - When plan changes OR GDD data loads, the computed crops update
 *
 * This ensures consistency: timeline, beds, overview, inspector, reports
 * all see the same calculated dates.
 */

import { useMemo } from 'react';
import { usePlanStore } from './plan-store';
import { useGdd } from './gdd-client';
import { createGddCalculator } from './gdd';
import { getTimelineCropsFromPlan } from './timeline-data';
import type { TimelineCrop } from './plan-types';
import type { GddCalculator } from './gdd';

export interface UseComputedCropsResult {
  /** Fully computed timeline crops with all timing adjustments */
  crops: TimelineCrop[];
  /** Whether GDD data is still loading */
  gddLoading: boolean;
  /** Whether GDD calculator is available (location set + data loaded) */
  hasGddCalculator: boolean;
  /** The GDD calculator instance (for components that need direct access) */
  gddCalculator: GddCalculator | undefined;
}

/**
 * Hook providing the single source of computed crop data.
 *
 * All UIs should use this instead of directly calling getTimelineCropsFromPlan.
 */
export function useComputedCrops(): UseComputedCropsResult {
  const currentPlan = usePlanStore((state) => state.currentPlan);

  // GDD calculator setup
  const gddLocation = currentPlan?.metadata?.location;
  const planYear = currentPlan?.metadata?.year ?? new Date().getFullYear();
  const { tempData, isLoaded: gddLoaded, isLoading: gddLoading } = useGdd(
    gddLocation?.lat,
    gddLocation?.lon,
    planYear
  );

  // Create GDD calculator when data is available
  const gddCalculator = useMemo(() => {
    if (!gddLoaded || !tempData) return undefined;
    return createGddCalculator(tempData, planYear);
  }, [gddLoaded, tempData, planYear]);

  // Compute crops with all timing adjustments applied
  const crops = useMemo(() => {
    if (!currentPlan) return [];
    return getTimelineCropsFromPlan(currentPlan, gddCalculator);
  }, [currentPlan, gddCalculator]);

  return {
    crops,
    gddLoading,
    hasGddCalculator: !!gddCalculator,
    gddCalculator,
  };
}

/**
 * Get a single crop by planting ID from the computed crops.
 */
export function useCropByPlantingId(plantingId: string | null): TimelineCrop | null {
  const { crops } = useComputedCrops();

  return useMemo(() => {
    if (!plantingId) return null;
    return crops.find((c) => c.plantingId === plantingId) ?? null;
  }, [crops, plantingId]);
}

/**
 * Get crops filtered by a predicate.
 */
export function useFilteredCrops(
  predicate: (crop: TimelineCrop) => boolean
): TimelineCrop[] {
  const { crops } = useComputedCrops();

  return useMemo(() => {
    return crops.filter(predicate);
  }, [crops, predicate]);
}
