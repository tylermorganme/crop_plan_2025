/**
 * Date Utilities
 *
 * Centralized date handling for the crop planner.
 * All dates in the system are "local dates" representing days in the farm's timezone.
 * We store dates as ISO strings without timezone (e.g., "2025-12-14" or "2025-12-14T00:00:00")
 * and interpret them as local midnight in the configured timezone.
 *
 * IMPORTANT: Always use parseLocalDate() instead of new Date() when parsing stored dates.
 * This prevents timezone shift bugs where "2025-12-14" becomes Dec 13 in Pacific time.
 */

import { parseISO, format, addDays, subDays, differenceInDays } from 'date-fns';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default timezone for new plans */
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

// =============================================================================
// DATE PARSING
// =============================================================================

/**
 * Parse a date string as a local date (midnight in local timezone).
 *
 * This is the ONLY function that should be used to parse stored date strings.
 * It handles both date-only strings ("2025-12-14") and ISO strings ("2025-12-14T00:00:00").
 *
 * Uses date-fns parseISO which interprets date-only strings as local time,
 * avoiding the UTC interpretation bug with new Date().
 *
 * @param dateStr - Date string in ISO format
 * @returns Date object representing local midnight
 */
export function parseLocalDate(dateStr: string): Date {
  if (!dateStr) {
    throw new Error('parseLocalDate: dateStr is required');
  }
  return parseISO(dateStr);
}

/**
 * Safely parse a date string, returning null for invalid/empty input.
 *
 * @param dateStr - Date string in ISO format, or null/undefined
 * @returns Date object or null if invalid
 */
export function parseLocalDateOrNull(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  try {
    const date = parseISO(dateStr);
    // parseISO returns Invalid Date for malformed strings, check with isNaN
    if (isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch {
    return null;
  }
}

// =============================================================================
// DATE FORMATTING
// =============================================================================

/**
 * Format a date as an ISO date string (YYYY-MM-DD) for storage.
 *
 * @param date - Date object
 * @returns ISO date string without time component
 */
export function formatDateOnly(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Format a date as an ISO datetime string for storage.
 * Does NOT include timezone offset - represents local time.
 *
 * @param date - Date object
 * @returns ISO datetime string (e.g., "2025-12-14T00:00:00")
 */
export function formatDateTime(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * Format a date for display (M/D format).
 *
 * @param dateStr - ISO date string
 * @returns Short display format (e.g., "12/14")
 */
export function formatDateShort(dateStr: string): string {
  if (!dateStr) return '?';
  const d = parseISO(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Format a date for display with full locale formatting.
 *
 * @param dateStr - ISO date string
 * @returns Locale-formatted date string
 */
export function formatDateLocale(dateStr: string): string {
  if (!dateStr) return '?';
  const d = parseISO(dateStr);
  return d.toLocaleDateString();
}

// =============================================================================
// DATE ARITHMETIC
// =============================================================================

/**
 * Add days to a date.
 *
 * @param date - Starting date
 * @param days - Number of days to add (can be negative)
 * @returns New date
 */
export function addDaysToDate(date: Date, days: number): Date {
  return addDays(date, days);
}

/**
 * Subtract days from a date.
 *
 * @param date - Starting date
 * @param days - Number of days to subtract
 * @returns New date
 */
export function subtractDaysFromDate(date: Date, days: number): Date {
  return subDays(date, days);
}

/**
 * Calculate the difference in days between two dates.
 *
 * @param dateLeft - First date
 * @param dateRight - Second date
 * @returns Number of days (positive if dateLeft > dateRight)
 */
export function daysBetween(dateLeft: Date, dateRight: Date): number {
  return differenceInDays(dateLeft, dateRight);
}

// =============================================================================
// TIMEZONE UTILITIES
// =============================================================================

/**
 * Get the timezone string for a plan, falling back to default.
 *
 * @param planTimezone - Timezone from plan metadata (may be undefined)
 * @returns IANA timezone identifier
 */
export function getTimezone(planTimezone?: string): string {
  return planTimezone || DEFAULT_TIMEZONE;
}

/**
 * Get a list of common US timezone options for UI selection.
 */
export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
] as const;
