/**
 * Hook for dynamically fetching and caching crop data.
 *
 * Unlike the static import in lib/crops.ts, this hook fetches data
 * from the API and can be refreshed when crop configs are updated.
 */

import { useState, useEffect, useCallback } from 'react';
import type { CropConfig } from '@/lib/entities/crop-config';

interface CropsState {
  crops: CropConfig[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

let cachedCrops: CropConfig[] | null = null;
let cacheTimestamp: number | null = null;
let refreshPromise: Promise<CropConfig[]> | null = null;

/**
 * Fetch crops from API with caching.
 * Multiple concurrent calls will share the same promise.
 */
async function fetchCrops(force = false): Promise<CropConfig[]> {
  // Return cached data if available and not forcing refresh
  if (!force && cachedCrops) {
    return cachedCrops;
  }

  // If already fetching, return the in-flight promise
  if (refreshPromise) {
    return refreshPromise;
  }

  // Start new fetch
  refreshPromise = fetch('/api/crops')
    .then(async (res) => {
      if (!res.ok) {
        throw new Error('Failed to fetch crops');
      }
      const data = await res.json();
      cachedCrops = data.crops;
      cacheTimestamp = Date.now();
      return data.crops;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

/**
 * Hook for accessing crop data with auto-refresh capability.
 */
export function useCrops() {
  const [state, setState] = useState<CropsState>({
    crops: cachedCrops || [],
    isLoading: !cachedCrops,
    error: null,
    lastUpdated: cacheTimestamp,
  });

  const refresh = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      const crops = await fetchCrops(true);
      setState({
        crops,
        isLoading: false,
        error: null,
        lastUpdated: Date.now(),
      });
      return crops;
    } catch (e) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      }));
      throw e;
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!cachedCrops) {
      fetchCrops()
        .then(crops => {
          setState({
            crops,
            isLoading: false,
            error: null,
            lastUpdated: cacheTimestamp,
          });
        })
        .catch(e => {
          setState(prev => ({
            ...prev,
            isLoading: false,
            error: e instanceof Error ? e.message : 'Unknown error',
          }));
        });
    }
  }, []);

  const getCropByIdentifier = useCallback((identifier: string) => {
    return state.crops.find(c => c.identifier === identifier);
  }, [state.crops]);

  const getCropById = useCallback((id: string) => {
    return state.crops.find(c => c.id === id);
  }, [state.crops]);

  return {
    ...state,
    refresh,
    getCropByIdentifier,
    getCropById,
  };
}

/**
 * Invalidate the crop cache.
 * Call this after saving a crop config to force refresh on next access.
 */
export function invalidateCropsCache() {
  cachedCrops = null;
  cacheTimestamp = null;
}

/**
 * Get crops synchronously from cache (for use in non-hook contexts).
 * Returns null if not yet loaded.
 */
export function getCachedCrops(): CropConfig[] | null {
  return cachedCrops;
}
