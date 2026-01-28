import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { TemperatureHistory, DailyWeather } from '@/lib/gdd';
import { getTemperatureDataRange } from '@/lib/gdd';

// Cache directory for temperature data
const CACHE_DIR = join(process.cwd(), 'data', 'temperature-cache');

/**
 * Get cache file path for a location
 */
function getCacheFilePath(lat: number, lon: number): string {
  // Round to 2 decimal places for cache key (roughly ~1km precision)
  const latKey = lat.toFixed(2).replace('.', '_');
  const lonKey = lon.toFixed(2).replace('.', '_');
  return join(CACHE_DIR, `temp_${latKey}_${lonKey}.json`);
}

/**
 * Check if cache is still valid (less than 7 days old)
 */
function isCacheValid(cache: TemperatureHistory): boolean {
  const fetchedAt = new Date(cache.fetchedAt);
  const now = new Date();
  const daysSinceFetch = (now.getTime() - fetchedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceFetch < 7;
}

/** Extended response with source metadata */
interface OpenMeteoResult {
  daily: DailyWeather[];
  /** Actual coordinates used by the API (may differ slightly from requested) */
  actualLat: number;
  actualLon: number;
  /** Elevation in meters */
  elevation: number;
  /** Timezone used */
  timezone: string;
}

/**
 * Fetch temperature data from Open-Meteo API
 */
async function fetchFromOpenMeteo(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<OpenMeteoResult> {
  // Open-Meteo Archive API (free, no API key required)
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,soil_temperature_0_to_7cm_mean');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('temperature_unit', 'fahrenheit');

  console.log(`[temperature] Fetching from Open-Meteo: ${url.toString()}`);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Open-Meteo returns data in this format:
  // {
  //   latitude: 47.76,
  //   longitude: -122.08,
  //   elevation: 45.0,
  //   timezone: "America/Los_Angeles",
  //   daily: {
  //     time: ["2024-01-01", "2024-01-02", ...],
  //     temperature_2m_max: [45.2, 48.1, ...],
  //     temperature_2m_min: [32.1, 35.2, ...]
  //   }
  // }

  if (!data.daily?.time || !data.daily?.temperature_2m_max || !data.daily?.temperature_2m_min) {
    throw new Error('Invalid response format from Open-Meteo');
  }

  const daily: DailyWeather[] = [];
  for (let i = 0; i < data.daily.time.length; i++) {
    daily.push({
      date: data.daily.time[i],
      tmax: data.daily.temperature_2m_max[i],
      tmin: data.daily.temperature_2m_min[i],
      precipitation: data.daily.precipitation_sum?.[i] ?? undefined,
      soilTemp: data.daily.soil_temperature_0_to_7cm_mean?.[i] ?? undefined,
    });
  }

  console.log(`[temperature] Received ${daily.length} days of data for ${data.latitude}, ${data.longitude}`);

  return {
    daily,
    actualLat: data.latitude,
    actualLon: data.longitude,
    elevation: data.elevation,
    timezone: data.timezone,
  };
}

/**
 * GET /api/temperature?lat=XX&lon=XX&year=YYYY
 *
 * Fetches historical temperature data for a location.
 * Uses caching to avoid repeated API calls.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = parseFloat(searchParams.get('lat') || '');
    const lon = parseFloat(searchParams.get('lon') || '');
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString(), 10);
    const forceRefresh = searchParams.get('refresh') === 'true';

    // Validate parameters
    if (isNaN(lat) || isNaN(lon)) {
      return NextResponse.json(
        { error: 'Valid lat and lon parameters are required' },
        { status: 400 }
      );
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return NextResponse.json(
        { error: 'lat must be -90 to 90, lon must be -180 to 180' },
        { status: 400 }
      );
    }

    // Ensure cache directory exists
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }

    const cachePath = getCacheFilePath(lat, lon);

    // Check cache first (unless force refresh)
    if (!forceRefresh && existsSync(cachePath)) {
      try {
        const cached: TemperatureHistory = JSON.parse(readFileSync(cachePath, 'utf-8'));
        if (isCacheValid(cached)) {
          console.log(`[temperature] Returning cached data for ${lat}, ${lon}`);
          return NextResponse.json(cached);
        }
      } catch {
        // Cache read failed, will fetch fresh
      }
    }

    // Fetch fresh data from Open-Meteo
    const { startDate, endDate } = getTemperatureDataRange(year);

    const openMeteoResult = await fetchFromOpenMeteo(lat, lon, startDate, endDate);

    const result: TemperatureHistory = {
      location: { lat, lon },
      dataSource: {
        lat: openMeteoResult.actualLat,
        lon: openMeteoResult.actualLon,
        elevation: openMeteoResult.elevation,
        timezone: openMeteoResult.timezone,
      },
      fetchedAt: new Date().toISOString(),
      daily: openMeteoResult.daily,
    };

    // Save to cache
    writeFileSync(cachePath, JSON.stringify(result, null, 2));
    console.log(`[temperature] Cached data for ${lat}, ${lon}`);

    return NextResponse.json(result);
  } catch (e) {
    console.error('[temperature] Error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to fetch temperature data' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/temperature?lat=XX&lon=XX
 *
 * Clears cached temperature data for a location.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = parseFloat(searchParams.get('lat') || '');
    const lon = parseFloat(searchParams.get('lon') || '');

    if (isNaN(lat) || isNaN(lon)) {
      return NextResponse.json(
        { error: 'Valid lat and lon parameters are required' },
        { status: 400 }
      );
    }

    const cachePath = getCacheFilePath(lat, lon);

    if (existsSync(cachePath)) {
      const { unlinkSync } = await import('fs');
      unlinkSync(cachePath);
      return NextResponse.json({ ok: true, message: 'Cache cleared' });
    }

    return NextResponse.json({ ok: true, message: 'No cache to clear' });
  } catch (e) {
    console.error('[temperature] Delete error:', e);
    return NextResponse.json(
      { error: 'Failed to clear cache' },
      { status: 500 }
    );
  }
}
