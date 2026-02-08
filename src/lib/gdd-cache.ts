/**
 * GDD Caching Layer
 *
 * Provides efficient GDD calculations by pre-computing daily GDD values
 * and building cumulative lookup tables. This enables:
 *
 * 1. **O(1) daily GDD lookups** - no repeated trig function calls
 * 2. **O(log n) date-to-GDD lookups** - via binary search on cumulative table
 * 3. **O(log n) reverse lookups** - find plant date for target harvest date
 *
 * The cache is keyed by (baseTemp, upperTemp, structureOffset) so different
 * crop configurations can share pre-computed data where possible.
 *
 * Architecture:
 * - `buildGddCache()` computes daily GDD values for all temperature records
 * - `buildCumulativeTable()` creates a cumulative sum indexed by day-of-year
 * - `findDateForGdd()` binary searches for target harvest date
 * - `findPlantDateForHarvest()` reverse binary searches for plant date
 */

import type { TemperatureHistory } from './gdd';
import { calculateDailyGdd } from './gdd';

// =============================================================================
// TYPES
// =============================================================================

/** Cache key for GDD calculations */
export interface GddCacheKey {
  baseTemp: number;
  upperTemp: number | undefined;
  structureOffset: number;
}

/** Pre-computed daily GDD values */
export interface DailyGddCache {
  /** Map from date string (YYYY-MM-DD) to GDD value */
  byDate: Map<string, number>;
  /** Map from (year * 366 + dayOfYear) to GDD value for quick lookup */
  byYearDay: Map<number, number>;
  /** Pre-computed historical average GDD by day-of-year (index 1-366) for estimating missing days */
  avgByDoy: number[];
}

/** Cumulative GDD lookup table for a specific year */
export interface CumulativeGddTable {
  year: number;
  /** Day of year (1-366) → cumulative GDD from Jan 1 */
  cumulativeGdd: number[];
  /** Day of year (1-366) → daily GDD for that day */
  dailyGdd: number[];
}

/** Full GDD cache with multiple temperature configurations */
export interface GddCache {
  /** The temperature data this cache was built from */
  tempData: TemperatureHistory;
  /** Cache of daily GDD values, keyed by cache key string */
  dailyCaches: Map<string, DailyGddCache>;
  /** Cumulative tables by year, keyed by `${year}-${cacheKeyStr}` */
  cumulativeTables: Map<string, CumulativeGddTable>;
}

// =============================================================================
// CACHE KEY UTILITIES
// =============================================================================

/**
 * Convert cache key to string for Map indexing.
 */
export function cacheKeyToString(key: GddCacheKey): string {
  return `${key.baseTemp}-${key.upperTemp ?? 'none'}-${key.structureOffset}`;
}

/**
 * Create a cache key from parameters.
 */
export function makeCacheKey(
  baseTemp: number,
  upperTemp?: number,
  structureOffset: number = 0
): GddCacheKey {
  return { baseTemp, upperTemp, structureOffset };
}

// =============================================================================
// CACHE BUILDING
// =============================================================================

/**
 * Create an empty GDD cache.
 */
export function createGddCache(tempData: TemperatureHistory): GddCache {
  return {
    tempData,
    dailyCaches: new Map(),
    cumulativeTables: new Map(),
  };
}

/**
 * Build or retrieve a daily GDD cache for specific temperature parameters.
 *
 * This pre-computes GDD for every day in the temperature history,
 * avoiding repeated trig function calls.
 */
export function getDailyCache(
  cache: GddCache,
  key: GddCacheKey
): DailyGddCache {
  const keyStr = cacheKeyToString(key);

  // Return existing cache if available
  const existing = cache.dailyCaches.get(keyStr);
  if (existing) return existing;

  // Build new cache
  const byDate = new Map<string, number>();
  const byYearDay = new Map<number, number>();
  // Accumulators for per-DOY historical average
  const doySum = new Float64Array(367);  // index 1-366
  const doyCount = new Uint16Array(367);

  for (const day of cache.tempData.daily) {
    const gdd = calculateDailyGdd(
      day.tmax,
      day.tmin,
      key.baseTemp,
      key.upperTemp,
      key.structureOffset
    );

    byDate.set(day.date, gdd);

    // Parse date parts directly from string (avoids Date object allocation)
    const m = parseInt(day.date.substring(5, 7), 10);
    const d = parseInt(day.date.substring(8, 10), 10);
    const y = parseInt(day.date.substring(0, 4), 10);
    const doy = dayOfYearFromParts(m, d, y);

    const yearDayKey = y * 366 + doy;
    byYearDay.set(yearDayKey, gdd);

    // Accumulate for historical average
    doySum[doy] += gdd;
    doyCount[doy]++;
  }

  // Build avgByDoy lookup (index 1-366)
  const avgByDoy: number[] = new Array(367).fill(10); // default ~10 GDD/day
  for (let i = 1; i <= 366; i++) {
    if (doyCount[i] > 0) {
      avgByDoy[i] = doySum[i] / doyCount[i];
    }
  }

  const dailyCache: DailyGddCache = { byDate, byYearDay, avgByDoy };
  cache.dailyCaches.set(keyStr, dailyCache);

  return dailyCache;
}

/**
 * Build or retrieve a cumulative GDD table for a specific year.
 *
 * The cumulative table maps day-of-year (1-366) to total GDD accumulated
 * from January 1st. This enables O(log n) lookups via binary search.
 */
export function getCumulativeTable(
  cache: GddCache,
  year: number,
  key: GddCacheKey
): CumulativeGddTable {
  const keyStr = `${year}-${cacheKeyToString(key)}`;

  // Return existing table if available
  const existing = cache.cumulativeTables.get(keyStr);
  if (existing) return existing;

  // Ensure daily cache exists
  const dailyCache = getDailyCache(cache, key);

  // Build cumulative table for this year
  const dailyGdd: number[] = new Array(367).fill(0); // index 0 unused, 1-366
  const cumulativeGdd: number[] = new Array(367).fill(0);

  let cumulative = 0;

  for (let doy = 1; doy <= 366; doy++) {
    const dateStr = dayOfYearToDateStr(doy, year);
    const dayGdd = dailyCache.byDate.get(dateStr) ?? estimateGddForDayOfYear(cache, doy, key);

    dailyGdd[doy] = dayGdd;
    cumulative += dayGdd;
    cumulativeGdd[doy] = cumulative;
  }

  const table: CumulativeGddTable = { year, cumulativeGdd, dailyGdd };
  cache.cumulativeTables.set(keyStr, table);

  return table;
}

/**
 * Estimate GDD for a day-of-year when no data exists.
 * Uses pre-computed historical average from the daily cache (O(1) lookup).
 */
function estimateGddForDayOfYear(
  cache: GddCache,
  targetDoy: number,
  key: GddCacheKey
): number {
  const dailyCache = getDailyCache(cache, key);
  return dailyCache.avgByDoy[targetDoy];
}

// =============================================================================
// LOOKUP FUNCTIONS
// =============================================================================

/**
 * Forward lookup: find harvest date given plant date and GDD requirement.
 *
 * Uses binary search on the cumulative table for O(log n) performance.
 *
 * @param cache - GDD cache
 * @param plantDate - Plant date (YYYY-MM-DD)
 * @param gddNeeded - GDD required to reach harvest
 * @param key - Temperature parameters
 * @returns Harvest date (YYYY-MM-DD) or null if not enough data
 */
export function findHarvestDate(
  cache: GddCache,
  plantDate: string,
  gddNeeded: number,
  key: GddCacheKey
): string | null {
  const plant = new Date(plantDate);
  const year = plant.getFullYear();
  const plantDoy = getDayOfYear(plant);

  // Get cumulative table for this year (and next year if needed)
  const table = getCumulativeTable(cache, year, key);
  const nextYearTable = getCumulativeTable(cache, year + 1, key);

  // GDD at plant date
  const plantGdd = table.cumulativeGdd[plantDoy] ?? 0;
  const targetGdd = plantGdd + gddNeeded;

  // Search within current year
  if (targetGdd <= table.cumulativeGdd[366]) {
    const harvestDoy = binarySearchGdd(table.cumulativeGdd, targetGdd, plantDoy);
    if (harvestDoy !== null) {
      return dayOfYearToDateStr(harvestDoy, year);
    }
  }

  // Need to extend into next year
  const yearEndGdd = table.cumulativeGdd[366];
  const remainingGdd = targetGdd - yearEndGdd;

  const harvestDoy = binarySearchGdd(nextYearTable.cumulativeGdd, remainingGdd, 1);
  if (harvestDoy !== null) {
    return dayOfYearToDateStr(harvestDoy, year + 1);
  }

  return null; // Couldn't find harvest date
}

/**
 * Reverse lookup: find plant date given harvest date and GDD requirement.
 *
 * Uses reverse binary search on cumulative table for O(log n) performance.
 *
 * @param cache - GDD cache
 * @param harvestDate - Target harvest date (YYYY-MM-DD)
 * @param gddNeeded - GDD required from plant to harvest
 * @param key - Temperature parameters
 * @returns Required plant date (YYYY-MM-DD) or null if not enough data
 */
export function findPlantDate(
  cache: GddCache,
  harvestDate: string,
  gddNeeded: number,
  key: GddCacheKey
): string | null {
  const harvest = new Date(harvestDate);
  const year = harvest.getFullYear();
  const harvestDoy = getDayOfYear(harvest);

  // Get cumulative table for this year (and previous year if needed)
  const table = getCumulativeTable(cache, year, key);
  const prevYearTable = getCumulativeTable(cache, year - 1, key);

  // GDD at harvest date
  const harvestGdd = table.cumulativeGdd[harvestDoy] ?? 0;
  const targetGdd = harvestGdd - gddNeeded;

  // Search within current year
  if (targetGdd >= 0) {
    const plantDoy = binarySearchGddReverse(table.cumulativeGdd, targetGdd, 1, harvestDoy);
    if (plantDoy !== null) {
      return dayOfYearToDateStr(plantDoy, year);
    }
  }

  // Need to go to previous year
  const deficitGdd = -targetGdd;
  const prevYearEndGdd = prevYearTable.cumulativeGdd[366];
  const prevYearTargetGdd = prevYearEndGdd - deficitGdd;

  const plantDoy = binarySearchGddReverse(prevYearTable.cumulativeGdd, prevYearTargetGdd, 1, 366);
  if (plantDoy !== null) {
    return dayOfYearToDateStr(plantDoy, year - 1);
  }

  return null; // Couldn't find plant date
}

/**
 * Calculate days between two dates using GDD-adjusted timing.
 *
 * This is the core function for sequence GDD staggering:
 * given a plant date, returns the actual days to harvest based on
 * accumulated GDD rather than fixed calendar days.
 */
export function getGddAdjustedDays(
  cache: GddCache,
  plantDate: string,
  calendarDays: number,
  key: GddCacheKey
): number | null {
  // Calculate reference GDD (what would accumulate in calendarDays from a reference date)
  // For simplicity, calculate GDD over the given plant date range
  const harvestDate = findHarvestDate(cache, plantDate, getGddForDays(cache, plantDate, calendarDays, key) ?? 0, key);

  if (!harvestDate) return null;

  // Return actual days difference
  const plant = new Date(plantDate);
  const harvest = new Date(harvestDate);
  return Math.round((harvest.getTime() - plant.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate total GDD over a specific number of days from a start date.
 */
export function getGddForDays(
  cache: GddCache,
  startDate: string,
  days: number,
  key: GddCacheKey
): number | null {
  const start = new Date(startDate);
  const year = start.getFullYear();
  const startDoy = getDayOfYear(start);

  const table = getCumulativeTable(cache, year, key);
  const nextYearTable = getCumulativeTable(cache, year + 1, key);

  const startGdd = startDoy > 1 ? table.cumulativeGdd[startDoy - 1] : 0;
  const endDoy = startDoy + days - 1;

  if (endDoy <= 366) {
    return table.cumulativeGdd[endDoy] - startGdd;
  }

  // Spans into next year
  const thisYearGdd = table.cumulativeGdd[366] - startGdd;
  const nextYearDoy = endDoy - 366;
  const nextYearGdd = nextYearTable.cumulativeGdd[nextYearDoy];

  return thisYearGdd + nextYearGdd;
}

// =============================================================================
// BINARY SEARCH HELPERS
// =============================================================================

/**
 * Binary search for the first day-of-year where cumulative GDD >= target.
 */
function binarySearchGdd(
  cumulativeGdd: number[],
  targetGdd: number,
  minDoy: number
): number | null {
  let low = minDoy;
  let high = 366;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (cumulativeGdd[mid] < targetGdd) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  if (low <= 366 && cumulativeGdd[low] >= targetGdd) {
    return low;
  }

  return null;
}

/**
 * Reverse binary search for the last day-of-year where cumulative GDD <= target.
 */
function binarySearchGddReverse(
  cumulativeGdd: number[],
  targetGdd: number,
  minDoy: number,
  maxDoy: number
): number | null {
  let low = minDoy;
  let high = maxDoy;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (cumulativeGdd[mid] <= targetGdd) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  if (low >= minDoy && cumulativeGdd[low] <= targetGdd) {
    return low;
  }

  return null;
}

// =============================================================================
// DATE UTILITIES
// =============================================================================

/** Cumulative days before each month (non-leap year). Month 1=Jan. */
const DAYS_BEFORE_MONTH = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/**
 * Get day of year (1-366) from month, day, year integers.
 * Avoids Date object allocation for hot-path usage.
 */
function dayOfYearFromParts(month: number, day: number, year: number): number {
  let doy = DAYS_BEFORE_MONTH[month] + day;
  // Leap year adjustment for months after February
  if (month > 2 && (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) {
    doy++;
  }
  return doy;
}

/**
 * Get day of year (1-366) from a Date object.
 * Uses UTC to avoid timezone-related off-by-one errors.
 */
function getDayOfYear(date: Date): number {
  // Use UTC methods to avoid timezone issues
  // When parsing "2025-05-01", JS interprets as UTC midnight,
  // so we must use UTC getters consistently
  const year = date.getUTCFullYear();
  const startOfYear = Date.UTC(year, 0, 1); // Jan 1 00:00 UTC
  const current = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor((current - startOfYear) / oneDay) + 1; // +1 because Jan 1 is DOY 1
}

/**
 * Convert day of year to date string (YYYY-MM-DD).
 * Uses UTC to match getDayOfYear's UTC-based calculation.
 */
function dayOfYearToDateStr(doy: number, year: number): string {
  // Create date in UTC: Jan 1 + (doy - 1) days
  const ms = Date.UTC(year, 0, 1) + (doy - 1) * 24 * 60 * 60 * 1000;
  const date = new Date(ms);
  return date.toISOString().split('T')[0];
}
