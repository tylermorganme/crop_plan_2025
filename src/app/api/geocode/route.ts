import { NextRequest, NextResponse } from 'next/server';

/** Result from geocoding search */
export interface GeocodingResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string; // State/Province
  admin2?: string; // County
  elevation?: number;
}

/**
 * GET /api/geocode?q=search+query
 *
 * Search for locations by name using Open-Meteo's geocoding API.
 * Returns up to 10 matching locations.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');

    if (!query || query.trim().length < 2) {
      return NextResponse.json(
        { error: 'Query parameter "q" must be at least 2 characters' },
        { status: 400 }
      );
    }

    // Open-Meteo Geocoding API (free, no API key required)
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', query.trim());
    url.searchParams.set('count', '10');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');

    console.log(`[geocode] Searching for: ${query}`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Geocoding API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Open-Meteo returns:
    // {
    //   results: [
    //     { name: "Woodinville", latitude: 47.75, longitude: -122.15, country: "United States", admin1: "Washington", ... }
    //   ]
    // }

    if (!data.results || !Array.isArray(data.results)) {
      return NextResponse.json({ results: [] });
    }

    const results: GeocodingResult[] = data.results.map((r: {
      name: string;
      latitude: number;
      longitude: number;
      country: string;
      admin1?: string;
      admin2?: string;
      elevation?: number;
    }) => ({
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      country: r.country,
      admin1: r.admin1,
      admin2: r.admin2,
      elevation: r.elevation,
    }));

    console.log(`[geocode] Found ${results.length} results for "${query}"`);

    return NextResponse.json({ results });
  } catch (e) {
    console.error('[geocode] Error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Geocoding failed' },
      { status: 500 }
    );
  }
}
