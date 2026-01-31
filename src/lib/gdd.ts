/**
 * Growing Degree Days (GDD) Calculations
 *
 * GDD is a measure of heat accumulation used to predict plant development.
 * Plants respond to accumulated heat rather than calendar time, so GDD
 * provides more accurate timing predictions across different planting dates.
 *
 * Uses the Baskerville-Emin (1972) sine wave method for days that cross
 * the base temperature. This properly accounts for partial-day heat
 * accumulation instead of zeroing out days where avg < base.
 *
 * Three cases:
 * - All day above base: GDD = tavg - tbase (simple average)
 * - All day below base: GDD = 0
 * - Crossing case: Sine wave integration
 *
 * Different crops have different base and ceiling temperatures:
 * - Cool season (brassicas, lettuce, peas): base ~40°F, ceiling ~65-75°F
 * - Warm season (tomatoes, peppers, squash): base ~50°F, ceiling ~86-95°F
 */

// =============================================================================
// TYPES
// =============================================================================

/** Daily temperature record */
export interface DailyTemperature {
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Maximum temperature in °F */
  tmax: number;
  /** Minimum temperature in °F */
  tmin: number;
}

/** Extended daily weather record including precipitation and soil temp */
export interface DailyWeather extends DailyTemperature {
  /** Precipitation in mm */
  precipitation?: number;
  /** Soil temperature at 0-7cm depth in °F */
  soilTemp?: number;
}

/** Weather history for a location */
export interface TemperatureHistory {
  /** Location requested by user */
  location: {
    lat: number;
    lon: number;
    name?: string;
  };
  /** Actual data source location (may differ from requested) */
  dataSource?: {
    lat: number;
    lon: number;
    elevation?: number;
    timezone?: string;
  };
  /** When this data was fetched */
  fetchedAt: string;
  /** Daily weather records (temperature + optional precipitation) */
  daily: DailyWeather[];
}

/** Location coordinates */
export interface GeoLocation {
  lat: number;
  lon: number;
  name?: string;
}

/** GDD calculation result */
export interface GddResult {
  /** Total GDD accumulated */
  totalGdd: number;
  /** Number of days in the calculation */
  days: number;
  /** Daily GDD values (for debugging/charting) */
  dailyGdd?: { date: string; gdd: number }[];
}

/** GDD-adjusted timing result */
export interface GddAdjustedTiming {
  /** Original DTM (calendar days) */
  originalDtm: number;
  /** Reference GDD (heat units the crop needs) */
  referenceGdd: number;
  /** Adjusted DTM based on new planting date */
  adjustedDtm: number;
  /** Difference in days (positive = takes longer) */
  daysDifference: number;
  /** Whether we had enough data to calculate */
  hasEnoughData: boolean;
  /** Warning message if data was insufficient */
  warning?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum days to look ahead when calculating GDD-to-days */
const MAX_DAYS_LOOKAHEAD = 365;

/**
 * HACK: Flat temperature offset for non-field structures.
 * Tunnels/greenhouses are warmer than outdoor weather data.
 * This is a rough approximation - actual temps vary by management.
 */
export const NON_FIELD_STRUCTURE_OFFSET = 20;  // °F

// =============================================================================
// CORE CALCULATIONS
// =============================================================================

/**
 * Baskerville-Emin sine wave integration for partial-day heat accumulation.
 * Returns GDD accumulated above the cutoff temperature.
 *
 * When temperature crosses the base during the day (tmin < tbase < tmax),
 * this integrates the area under a sine wave above the base, properly
 * crediting the hours when temp was above base.
 */
function sineIntegrationAbove(tavg: number, amplitude: number, cutoff: number): number {
  // Edge case: no temperature variation (tmax == tmin)
  if (amplitude === 0) {
    return tavg >= cutoff ? tavg - cutoff : 0;
  }
  const theta = Math.acos((cutoff - tavg) / amplitude);
  return (1 / Math.PI) * (amplitude * Math.sin(theta) - (cutoff - tavg) * theta);
}

/**
 * Calculate GDD for a single day using Baskerville-Emin sine wave method.
 *
 * This method models temperature as a sine wave between tmin and tmax,
 * then integrates the area above base (and below ceiling if set).
 * This properly credits partial-day heat accumulation for days that
 * cross the base temperature.
 *
 * @param tmax - Maximum temperature (°F)
 * @param tmin - Minimum temperature (°F)
 * @param tbase - Base temperature (°F)
 * @param tupper - Ceiling temperature (°F) - temps above this are capped
 * @param structureOffset - Temperature offset for non-field structures (°F)
 * @returns GDD for that day (always >= 0)
 */
export function calculateDailyGdd(
  tmax: number,
  tmin: number,
  tbase: number,
  tupper?: number,
  structureOffset: number = 0
): number {
  // Apply structure offset to both temps
  const adjMax = tmax + structureOffset;
  const adjMin = tmin + structureOffset;

  // Apply ceiling cap if set
  const cappedMax = tupper !== undefined ? Math.min(adjMax, tupper) : adjMax;
  const cappedMin = tupper !== undefined ? Math.min(adjMin, tupper) : adjMin;

  const tavg = (cappedMax + cappedMin) / 2;
  const amplitude = (cappedMax - cappedMin) / 2;

  // Case 1: All day below base
  if (cappedMax <= tbase) {
    return 0;
  }

  // Case 2: All day above base (simple average)
  if (cappedMin >= tbase) {
    return tavg - tbase;
  }

  // Case 3: Crosses base - Baskerville-Emin sine integration
  return sineIntegrationAbove(tavg, amplitude, tbase);
}

/**
 * Calculate accumulated GDD over a date range.
 *
 * @param tempData - Temperature history
 * @param startDate - Start date (YYYY-MM-DD)
 * @param days - Number of days to accumulate
 * @param tbase - Base temperature (°F)
 * @param tupper - Ceiling temperature (°F) - temps above this are capped
 * @param structureOffset - Temperature offset for non-field structures (°F)
 * @returns GDD result with total and daily breakdown
 */
export function calculateGdd(
  tempData: TemperatureHistory,
  startDate: string,
  days: number,
  tbase: number,
  tupper?: number,
  structureOffset: number = 0
): GddResult {
  // Build a date-indexed lookup for temperatures
  const tempByDate = new Map<string, DailyTemperature>();
  for (const t of tempData.daily) {
    tempByDate.set(t.date, t);
  }

  let totalGdd = 0;
  const dailyGdd: { date: string; gdd: number }[] = [];
  let actualDays = 0;

  const start = new Date(startDate);

  for (let i = 0; i < days; i++) {
    const currentDate = new Date(start);
    currentDate.setDate(start.getDate() + i);
    const dateStr = currentDate.toISOString().split('T')[0];

    const temp = tempByDate.get(dateStr);
    if (temp) {
      const gdd = calculateDailyGdd(temp.tmax, temp.tmin, tbase, tupper, structureOffset);
      totalGdd += gdd;
      dailyGdd.push({ date: dateStr, gdd });
      actualDays++;
    } else {
      // No data for this date - use average from surrounding dates or skip
      // For now, we'll use an interpolated/average value
      const avgGdd = estimateGddForMissingDate(tempData, dateStr, tbase, tupper, structureOffset);
      totalGdd += avgGdd;
      dailyGdd.push({ date: dateStr, gdd: avgGdd });
      actualDays++;
    }
  }

  return {
    totalGdd,
    days: actualDays,
    dailyGdd,
  };
}

/**
 * Estimate GDD for a date with missing data.
 * Uses historical average for that day-of-year.
 */
function estimateGddForMissingDate(
  tempData: TemperatureHistory,
  targetDate: string,
  tbase: number,
  tupper?: number,
  structureOffset: number = 0
): number {
  const target = new Date(targetDate);
  const targetDayOfYear = getDayOfYear(target);

  // Find all records with the same day-of-year
  const sameDay = tempData.daily.filter(t => {
    const d = new Date(t.date);
    return getDayOfYear(d) === targetDayOfYear;
  });

  if (sameDay.length === 0) {
    // No historical data - return a conservative estimate
    return 10; // ~10 GDD/day is a reasonable average
  }

  // Calculate average GDD for this day-of-year
  const avgGdd = sameDay.reduce((sum, t) => {
    return sum + calculateDailyGdd(t.tmax, t.tmin, tbase, tupper, structureOffset);
  }, 0) / sameDay.length;

  return avgGdd;
}

/**
 * Get day of year (1-366) for a date.
 */
function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Calculate how many days it takes to accumulate a target GDD amount.
 *
 * @param tempData - Temperature history
 * @param startDate - Start date (YYYY-MM-DD)
 * @param targetGdd - Target GDD to accumulate
 * @param tbase - Base temperature (°F)
 * @param tupper - Ceiling temperature (°F) - temps above this are capped
 * @param structureOffset - Temperature offset for non-field structures (°F)
 * @returns Number of days needed, or null if not enough data
 */
export function daysToAccumulateGdd(
  tempData: TemperatureHistory,
  startDate: string,
  targetGdd: number,
  tbase: number,
  tupper?: number,
  structureOffset: number = 0
): number | null {
  // Build a date-indexed lookup for temperatures
  const tempByDate = new Map<string, DailyTemperature>();
  for (const t of tempData.daily) {
    tempByDate.set(t.date, t);
  }

  let accumulatedGdd = 0;
  const start = new Date(startDate);

  for (let i = 0; i < MAX_DAYS_LOOKAHEAD; i++) {
    const currentDate = new Date(start);
    currentDate.setDate(start.getDate() + i);
    const dateStr = currentDate.toISOString().split('T')[0];

    const temp = tempByDate.get(dateStr);
    const gdd = temp
      ? calculateDailyGdd(temp.tmax, temp.tmin, tbase, tupper, structureOffset)
      : estimateGddForMissingDate(tempData, dateStr, tbase, tupper, structureOffset);

    accumulatedGdd += gdd;

    if (accumulatedGdd >= targetGdd) {
      return i + 1; // +1 because we count from day 1, not day 0
    }
  }

  // Couldn't reach target in MAX_DAYS_LOOKAHEAD
  return null;
}

// =============================================================================
// HIGH-LEVEL API
// =============================================================================

/**
 * Calculate GDD-adjusted timing for a crop.
 *
 * This is the main function for GDD adjustments:
 * 1. Calculates "reference GDD" from the original targetFieldDate + DTM
 * 2. Calculates how many days from the new planting date to reach that GDD
 *
 * @param tempData - Temperature history
 * @param originalDtm - Original days to maturity
 * @param targetFieldDate - Original assumed planting date (MM-DD format)
 * @param actualFieldDate - Actual planting date (YYYY-MM-DD format)
 * @param tbase - Base temperature (°F)
 * @param planYear - Year to use for calculating dates
 * @param tupper - Ceiling temperature (°F) - temps above this are capped
 * @param structureOffset - Temperature offset for non-field structures (°F)
 */
export function calculateGddAdjustedTiming(
  tempData: TemperatureHistory,
  originalDtm: number,
  targetFieldDate: string,
  actualFieldDate: string,
  tbase: number,
  planYear: number,
  tupper?: number,
  structureOffset: number = 0
): GddAdjustedTiming {
  // Parse target field date (MM-DD) to full date
  const [month, day] = targetFieldDate.split('-').map(Number);
  const referenceStartDate = `${planYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Calculate reference GDD (how much heat the crop needs)
  const referenceResult = calculateGdd(tempData, referenceStartDate, originalDtm, tbase, tupper, structureOffset);
  const referenceGdd = referenceResult.totalGdd;

  // Calculate adjusted days from actual planting date
  const adjustedDtm = daysToAccumulateGdd(tempData, actualFieldDate, referenceGdd, tbase, tupper, structureOffset);

  if (adjustedDtm === null) {
    return {
      originalDtm,
      referenceGdd,
      adjustedDtm: originalDtm, // Fall back to original
      daysDifference: 0,
      hasEnoughData: false,
      warning: 'Insufficient temperature data to calculate GDD adjustment',
    };
  }

  return {
    originalDtm,
    referenceGdd,
    adjustedDtm,
    daysDifference: adjustedDtm - originalDtm,
    hasEnoughData: true,
  };
}

// =============================================================================
// TEMPERATURE DATA UTILITIES
// =============================================================================

/**
 * Convert Celsius to Fahrenheit.
 */
export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9/5) + 32;
}

/**
 * Convert Fahrenheit to Celsius.
 */
export function fahrenheitToCelsius(fahrenheit: number): number {
  return (fahrenheit - 32) * 5/9;
}

/**
 * Get date range for temperature data request.
 * Returns a range that covers typical planning needs.
 *
 * Open-Meteo's archive API only has historical data (typically up to ~5 days ago),
 * so we cap the end date at a few days before today.
 *
 * @param planYear - The year of the crop plan
 * @returns Start and end dates for temperature data
 */
export function getTemperatureDataRange(planYear: number): { startDate: string; endDate: string } {
  // Get 10 years of historical data for better trend analysis
  const startYear = planYear - 9;

  // Cap end date at 5 days ago (archive API has a lag)
  const today = new Date();
  const fiveDaysAgo = new Date(today);
  fiveDaysAgo.setDate(today.getDate() - 5);

  // End date is the earlier of: end of plan year, or 5 days ago
  const planYearEnd = new Date(planYear, 11, 31); // Dec 31 of plan year
  const endDate = fiveDaysAgo < planYearEnd ? fiveDaysAgo : planYearEnd;

  return {
    startDate: `${startYear}-01-01`,
    endDate: endDate.toISOString().split('T')[0],
  };
}

/**
 * Create an empty temperature history (for when no data is available).
 */
export function createEmptyTemperatureHistory(location: GeoLocation): TemperatureHistory {
  return {
    location,
    fetchedAt: new Date().toISOString(),
    daily: [],
  };
}

// =============================================================================
// DAY LENGTH CALCULATIONS
// =============================================================================

/**
 * Calculate day length (hours of daylight) for a given latitude and day of year.
 * Uses the NOAA Solar Calculator approximation.
 *
 * @param latitude - Latitude in degrees (-90 to 90)
 * @param dayOfYear - Day of year (1-366)
 * @returns Day length in hours
 */
export function calculateDayLength(latitude: number, dayOfYear: number): number {
  // Convert latitude to radians
  const latRad = latitude * (Math.PI / 180);

  // Calculate solar declination (approximation)
  // The declination varies from -23.45° to +23.45° throughout the year
  const declination = 23.45 * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81)) * (Math.PI / 180);

  // Calculate hour angle at sunrise/sunset
  // cos(ω) = -tan(φ) × tan(δ)
  // where φ = latitude, δ = declination, ω = hour angle
  const cosHourAngle = -Math.tan(latRad) * Math.tan(declination);

  // Handle polar day (24h sun) and polar night (0h sun)
  if (cosHourAngle < -1) {
    return 24; // Polar day - sun never sets
  }
  if (cosHourAngle > 1) {
    return 0; // Polar night - sun never rises
  }

  // Hour angle in radians
  const hourAngle = Math.acos(cosHourAngle);

  // Day length in hours (hour angle is half the day length)
  // Convert from radians to hours: hours = radians × (12/π)
  const dayLength = 2 * hourAngle * (12 / Math.PI);

  return dayLength;
}

/**
 * Get day of year from a date string (YYYY-MM-DD) or Date object.
 */
export function getDayOfYearFromDate(date: string | Date): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}
