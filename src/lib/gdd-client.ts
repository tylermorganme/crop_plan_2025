/**
 * Client-side GDD utilities
 *
 * Provides hooks and functions for accessing GDD calculations in React components.
 */

import { useState, useEffect, useCallback } from 'react';
import type { TemperatureHistory } from './gdd';
import { calculateGddAdjustedTiming } from './gdd';

// =============================================================================
// TYPES
// =============================================================================

export interface GddPreviewData {
  /** Original DTM (calendar days) */
  originalDtm: number;
  /** GDD-adjusted DTM */
  adjustedDtm: number;
  /** Difference in days (positive = takes longer, negative = faster) */
  daysDifference: number;
  /** Reference GDD (heat units needed) */
  referenceGdd: number;
  /** Whether calculation was successful */
  success: boolean;
  /** Error or warning message */
  message?: string;
}

export interface UseGddResult {
  /** Whether temperature data is loaded */
  isLoaded: boolean;
  /** Whether temperature data is currently loading */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Number of days of temperature data */
  dayCount: number;
  /** Calculate GDD-adjusted timing for a specific planting */
  calculateAdjustedTiming: (
    dtm: number,
    targetFieldDate: string,
    actualFieldDate: string,
    category: string,
    baseTemp?: number
  ) => GddPreviewData | null;
  /** Refresh temperature data from API */
  refresh: () => Promise<void>;
}

// =============================================================================
// LOCAL STORAGE CACHE
// =============================================================================

const CACHE_KEY = 'gdd-temperature-data';

function getCachedData(): TemperatureHistory | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

function setCachedData(data: TemperatureHistory): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable
  }
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook for accessing GDD calculations.
 *
 * @param lat - Latitude
 * @param lon - Longitude
 * @param year - Plan year for temperature data range
 */
export function useGdd(
  lat: number | undefined,
  lon: number | undefined,
  year: number
): UseGddResult {
  const [tempData, setTempData] = useState<TemperatureHistory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load temperature data
  const loadData = useCallback(async () => {
    if (lat === undefined || lon === undefined) {
      setTempData(null);
      return;
    }

    // Check local cache first
    const cached = getCachedData();
    if (cached &&
        Math.abs(cached.location.lat - lat) < 0.01 &&
        Math.abs(cached.location.lon - lon) < 0.01) {
      setTempData(cached);
      return;
    }

    // Fetch from API
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/temperature?lat=${lat}&lon=${lon}&year=${year}`);
      if (!response.ok) {
        throw new Error('Failed to fetch temperature data');
      }
      const data: TemperatureHistory = await response.json();
      setTempData(data);
      setCachedData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setTempData(null);
    } finally {
      setIsLoading(false);
    }
  }, [lat, lon, year]);

  // Load data on mount and when location changes
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Calculate adjusted timing
  const calculateAdjustedTiming = useCallback((
    dtm: number,
    targetFieldDate: string,
    actualFieldDate: string,
    _category: string,
    baseTemp?: number
  ): GddPreviewData | null => {
    // Require baseTemp - no category-based guessing
    if (!tempData || !targetFieldDate || !actualFieldDate || baseTemp === undefined) {
      return null;
    }

    try {
      const result = calculateGddAdjustedTiming(
        tempData,
        dtm,
        targetFieldDate,
        actualFieldDate,
        baseTemp,
        year
      );

      return {
        originalDtm: result.originalDtm,
        adjustedDtm: result.adjustedDtm,
        daysDifference: result.daysDifference,
        referenceGdd: Math.round(result.referenceGdd),
        success: result.hasEnoughData,
        message: result.warning,
      };
    } catch (e) {
      return {
        originalDtm: dtm,
        adjustedDtm: dtm,
        daysDifference: 0,
        referenceGdd: 0,
        success: false,
        message: e instanceof Error ? e.message : 'Calculation error',
      };
    }
  }, [tempData, year]);

  return {
    isLoaded: tempData !== null,
    isLoading,
    error,
    dayCount: tempData?.daily.length ?? 0,
    calculateAdjustedTiming,
    refresh: loadData,
  };
}

/**
 * Format GDD difference for display.
 * e.g., "+5 days slower" or "-3 days faster"
 */
export function formatGddDifference(daysDiff: number): string {
  if (daysDiff === 0) {
    return 'no change';
  }
  const direction = daysDiff > 0 ? 'slower' : 'faster';
  return `${daysDiff > 0 ? '+' : ''}${daysDiff}d (${direction})`;
}

/**
 * Get a simple description of why timing differs.
 */
export function getGddExplanation(daysDiff: number): string {
  if (daysDiff > 5) {
    return 'Earlier planting = cooler temps = slower growth';
  }
  if (daysDiff < -5) {
    return 'Later planting = warmer temps = faster growth';
  }
  if (daysDiff > 0) {
    return 'Slightly cooler conditions';
  }
  if (daysDiff < 0) {
    return 'Slightly warmer conditions';
  }
  return 'Similar conditions to target date';
}
