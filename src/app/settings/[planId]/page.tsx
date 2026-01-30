'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import { usePlanStore } from '@/lib/plan-store';
import { TIMEZONE_OPTIONS, DEFAULT_TIMEZONE, parseMonthDay, formatMonthDay } from '@/lib/date-utils';
import AppHeader from '@/components/AppHeader';
import type { TemperatureHistory } from '@/lib/gdd';
import { DEFAULT_TRANSPLANT_SHOCK_DAYS, DEFAULT_ASSUMED_TRANSPLANT_AGE } from '@/lib/entities/planting-specs';
import { calculateDayLength, getDayOfYearFromDate } from '@/lib/gdd';
import { Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, ComposedChart, ReferenceLine } from 'recharts';

/** Data type options for the weather chart */
type ChartDataType = 'temperature' | 'precipitation' | 'dayLength' | 'soilTemp';

/**
 * Generate a distinct color for an index using HSL.
 * Uses golden angle to spread hues for maximum distinction regardless of count.
 */
function getYearColor(index: number): string {
  // Golden angle (~137.5°) provides optimal hue spacing for any number of items
  const hue = (index * 137.508) % 360;
  const saturation = 65 + (index % 3) * 10; // Vary saturation slightly
  const lightness = 45 + (index % 2) * 10; // Vary lightness slightly
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export default function SettingsPage() {
  const params = useParams();
  const planId = params.planId as string;

  const {
    currentPlan,
    loadPlanById,
    updatePlanMetadata,
  } = usePlanStore();

  const [isLoading, setIsLoading] = useState(true);
  const [tempDataStatus, setTempDataStatus] = useState<'none' | 'loading' | 'loaded' | 'error'>('none');
  const [tempData, setTempData] = useState<TemperatureHistory | null>(null);
  const [locationSearch, setLocationSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{
    name: string;
    latitude: number;
    longitude: number;
    country: string;
    admin1?: string;
  }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [showTempChart, setShowTempChart] = useState(false);
  const [selectedYears, setSelectedYears] = useState<Set<number> | null>(null); // null = not initialized
  const [chartDataType, setChartDataType] = useState<ChartDataType>('temperature');
  const chartHasAnimated = useRef(false); // Track if initial animation has played

  // Fetch temperature data when location changes (with browser cache)
  // TODO: localStorage cache is temporary - move to persistent storage if we keep this feature
  const fetchTemperatureData = useCallback(async (lat: number, lon: number, year: number, forceRefresh = false) => {
    // Check browser cache first (unless forcing refresh)
    const cacheKey = `temp_${lat.toFixed(2)}_${lon.toFixed(2)}_${year}`;
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed: TemperatureHistory = JSON.parse(cached);
          // Cache valid for 7 days
          const cacheAge = (Date.now() - new Date(parsed.fetchedAt).getTime()) / (1000 * 60 * 60 * 24);
          if (cacheAge < 7) {
            setTempData(parsed);
            setTempDataStatus('loaded');
            return;
          }
        }
      } catch {
        // Cache read failed, will fetch
      }
    }

    setTempDataStatus('loading');
    try {
      // Pass refresh=true to bypass server-side cache too
      const refreshParam = forceRefresh ? '&refresh=true' : '';
      const response = await fetch(`/api/temperature?lat=${lat}&lon=${lon}&year=${year}${refreshParam}`);
      if (!response.ok) {
        throw new Error('Failed to fetch temperature data');
      }
      const data: TemperatureHistory = await response.json();
      setTempData(data);
      setTempDataStatus('loaded');

      // Save to browser cache
      try {
        localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch {
        // localStorage full or unavailable, ignore
      }
    } catch (error) {
      console.error('Failed to fetch temperature data:', error);
      setTempDataStatus('error');
    }
  }, []);

  // Transform weather data for the chart - group by day-of-year, overlay years
  // Computes temperature, precipitation, soil temp, and day length data
  const chartData = useMemo((): {
    temperature: Array<Record<string, number | string | [number, number]>>;
    precipitation: Array<Record<string, number | string | [number, number]>>;
    soilTemp: Array<Record<string, number | string | [number, number]>>;
    dayLength: Array<Record<string, number | string>>;
    years: number[];
  } | null => {
    if (!tempData?.daily?.length) return null;

    // Group data by year
    const byYear: Record<number, Record<number, { tmax: number; tmin: number; precip?: number; soilTemp?: number }>> = {};
    for (const day of tempData.daily) {
      const date = new Date(day.date);
      const year = date.getFullYear();
      const dayOfYear = getDayOfYearFromDate(date);

      if (!byYear[year]) byYear[year] = {};
      byYear[year][dayOfYear] = {
        tmax: day.tmax,
        tmin: day.tmin,
        precip: day.precipitation,
        soilTemp: day.soilTemp,
      };
    }

    const years = Object.keys(byYear).map(Number).sort();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const latitude = tempData.location.lat;

    // Create data points for each day of year (1-365)
    const tempResult: Array<Record<string, number | string | [number, number]>> = [];
    const precipResult: Array<Record<string, number | string | [number, number]>> = [];
    const soilTempResult: Array<Record<string, number | string | [number, number]>> = [];
    const dayLengthResult: Array<Record<string, number | string>> = [];

    for (let doy = 1; doy <= 365; doy += 7) { // Sample every 7 days for performance
      const sampleDate = new Date(2024, 0, doy); // Use 2024 as reference (leap year)
      const month = monthNames[sampleDate.getMonth()];

      // Temperature data
      const tempPoint: Record<string, number | string | [number, number]> = { dayOfYear: doy, month };
      const temps: number[] = [];
      for (const year of years) {
        const dayData = byYear[year][doy];
        if (dayData) {
          const avg = Math.round((dayData.tmax + dayData.tmin) / 2);
          tempPoint[`avg_${year}`] = avg;
          temps.push(avg);
        }
      }
      if (temps.length > 0) {
        const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
        tempPoint.mean = Math.round(mean);
        tempPoint.range = [Math.min(...temps), Math.max(...temps)];
      }
      tempResult.push(tempPoint);

      // Precipitation data
      const precipPoint: Record<string, number | string | [number, number]> = { dayOfYear: doy, month };
      const precips: number[] = [];
      for (const year of years) {
        const dayData = byYear[year][doy];
        if (dayData?.precip !== undefined) {
          // Convert mm to inches for display
          const precipIn = Math.round(dayData.precip * 0.0394 * 100) / 100;
          precipPoint[`precip_${year}`] = precipIn;
          precips.push(precipIn);
        }
      }
      if (precips.length > 0) {
        const mean = precips.reduce((a, b) => a + b, 0) / precips.length;
        precipPoint.mean = Math.round(mean * 100) / 100;
        precipPoint.range = [Math.min(...precips), Math.max(...precips)];
      }
      precipResult.push(precipPoint);

      // Soil temperature data
      const soilPoint: Record<string, number | string | [number, number]> = { dayOfYear: doy, month };
      const soilTemps: number[] = [];
      for (const year of years) {
        const dayData = byYear[year][doy];
        if (dayData?.soilTemp !== undefined) {
          const soilTempF = Math.round(dayData.soilTemp);
          soilPoint[`soil_${year}`] = soilTempF;
          soilTemps.push(soilTempF);
        }
      }
      if (soilTemps.length > 0) {
        const mean = soilTemps.reduce((a, b) => a + b, 0) / soilTemps.length;
        soilPoint.mean = Math.round(mean);
        soilPoint.range = [Math.min(...soilTemps), Math.max(...soilTemps)];
      }
      soilTempResult.push(soilPoint);

      // Day length data (same for all years, just depends on latitude)
      const dayLength = calculateDayLength(latitude, doy);
      dayLengthResult.push({
        dayOfYear: doy,
        month,
        hours: Math.round(dayLength * 10) / 10, // 1 decimal place
      });
    }

    return {
      temperature: tempResult,
      precipitation: precipResult,
      soilTemp: soilTempResult,
      dayLength: dayLengthResult,
      years,
    };
  }, [tempData]);

  // Mark animation as complete after first render with visible chart
  useEffect(() => {
    if (showTempChart && chartData && !chartHasAnimated.current) {
      // Set a timeout slightly longer than animation duration to mark complete
      const timer = setTimeout(() => {
        chartHasAnimated.current = true;
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [showTempChart, chartData]);

  // Search for locations by name
  const searchLocations = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      setSearchResults(data.results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Use browser geolocation
  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        updatePlanMetadata({ location: { lat: latitude, lon: longitude, name: 'My Location' } });
        fetchTemperatureData(latitude, longitude, currentPlan?.metadata.year || new Date().getFullYear());
        setGettingLocation(false);
      },
      (error) => {
        alert(`Could not get location: ${error.message}`);
        setGettingLocation(false);
      },
      { enableHighAccuracy: true }
    );
  }, [updatePlanMetadata, fetchTemperatureData, currentPlan?.metadata.year]);

  // Select a location from search results
  const selectLocation = useCallback((result: typeof searchResults[0]) => {
    const locationName = result.admin1
      ? `${result.name}, ${result.admin1}`
      : `${result.name}, ${result.country}`;
    updatePlanMetadata({
      location: {
        lat: result.latitude,
        lon: result.longitude,
        name: locationName
      }
    });
    fetchTemperatureData(result.latitude, result.longitude, currentPlan?.metadata.year || new Date().getFullYear());
    setSearchResults([]);
    setLocationSearch('');
  }, [updatePlanMetadata, fetchTemperatureData, currentPlan?.metadata.year]);

  // Load plan on mount
  useEffect(() => {
    if (planId) {
      loadPlanById(planId).then(() => setIsLoading(false));
    }
  }, [planId, loadPlanById]);

  // Auto-fetch temperature data when plan loads with a location
  useEffect(() => {
    if (currentPlan?.metadata?.location && tempDataStatus === 'none') {
      const { lat, lon } = currentPlan.metadata.location;
      fetchTemperatureData(lat, lon, currentPlan.metadata.year);
    }
  }, [currentPlan?.metadata?.location, currentPlan?.metadata?.year, tempDataStatus, fetchTemperatureData]);

  // Initialize selected years when chart data loads (none by default - show just average/CI)
  useEffect(() => {
    if (chartData?.years && selectedYears === null) {
      setSelectedYears(new Set()); // Empty = show only average + confidence interval
    }
  }, [chartData?.years, selectedYears]);

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-51px)] flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }

  if (!currentPlan) {
    return (
      <div className="h-[calc(100vh-51px)] flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Plan not found</div>
      </div>
    );
  }

  const metadata = currentPlan.metadata;

  return (
    <>
      <AppHeader />
      <div className="h-[calc(100vh-51px)] overflow-auto bg-gray-50">
        <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Plan Settings</h1>

        {/* Plan Info Section */}
        <section className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Plan Information</h2>

          <div className="space-y-4">
            {/* Plan Name */}
            <div>
              <label htmlFor="planName" className="block text-sm font-medium text-gray-700 mb-1">
                Plan Name
              </label>
              <input
                id="planName"
                type="text"
                value={metadata.name}
                onChange={(e) => updatePlanMetadata({ name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                id="description"
                value={metadata.description || ''}
                onChange={(e) => updatePlanMetadata({ description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Optional description for this plan..."
              />
            </div>

            {/* Plan Year */}
            <div>
              <label htmlFor="year" className="block text-sm font-medium text-gray-700 mb-1">
                Plan Year
              </label>
              <input
                id="year"
                type="number"
                value={metadata.year}
                onChange={(e) => updatePlanMetadata({ year: parseInt(e.target.value) || new Date().getFullYear() })}
                min={2020}
                max={2100}
                className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </section>

        {/* Regional Settings Section */}
        <section className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Regional Settings</h2>

          <div className="space-y-4">
            {/* Timezone */}
            <div>
              <label htmlFor="timezone" className="block text-sm font-medium text-gray-700 mb-1">
                Timezone
              </label>
              <select
                id="timezone"
                value={metadata.timezone || DEFAULT_TIMEZONE}
                onChange={(e) => updatePlanMetadata({ timezone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-sm text-gray-500">
                Used for date calculations and display. All dates are interpreted in this timezone.
              </p>
            </div>

            {/* Location for GDD */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Location (for GDD Calculations)
              </label>
              <div className="space-y-3">
                {/* Current location display */}
                {metadata.location ? (
                  <div className="bg-green-50 border border-green-200 rounded-md p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-green-600 text-lg">✓</span>
                        <div>
                          <div className="text-sm font-medium text-green-900">
                            {metadata.location.name || 'Custom Location'}
                          </div>
                          {/* Temperature data status - inline */}
                          <div className="text-xs text-green-700">
                            {tempDataStatus === 'loading' && 'Loading weather data...'}
                            {tempDataStatus === 'loaded' && tempData && (
                              <>
                                {Math.round(tempData.daily.length / 365)} years of weather data
                                {tempData.dataSource && (
                                  <>
                                    {' · '}
                                    <a
                                      href={`https://www.openstreetmap.org/?mlat=${tempData.dataSource.lat}&mlon=${tempData.dataSource.lon}#map=12/${tempData.dataSource.lat}/${tempData.dataSource.lon}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 hover:text-blue-800 underline"
                                    >
                                      View data source on map
                                    </a>
                                  </>
                                )}
                                {' · '}
                                <button
                                  onClick={() => fetchTemperatureData(
                                    metadata.location!.lat,
                                    metadata.location!.lon,
                                    metadata.year,
                                    true // force refresh
                                  )}
                                  className="text-blue-600 hover:text-blue-800 underline"
                                >
                                  Refresh data
                                </button>
                              </>
                            )}
                            {tempDataStatus === 'error' && (
                              <span className="text-red-600">Failed to load weather data</span>
                            )}
                            {tempDataStatus === 'none' && 'Weather data not loaded'}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          updatePlanMetadata({ location: undefined });
                          setTempDataStatus('none');
                          setTempData(null);
                        }}
                        className="text-xs text-red-600 hover:text-red-800 font-medium"
                      >
                        Clear
                      </button>
                    </div>

                    {/* Expandable temperature chart */}
                    {tempDataStatus === 'loaded' && tempData && chartData && (
                      <div className="mt-3">
                        <button
                          onClick={() => setShowTempChart(!showTempChart)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                        >
                          <span className={`transform transition-transform ${showTempChart ? 'rotate-90' : ''}`}>▶</span>
                          {showTempChart ? 'Hide' : 'Show'} temperature history
                        </button>

                        <div className={`mt-3 bg-white rounded border border-gray-200 p-3 ${showTempChart ? '' : 'hidden'}`}>
                            {/* Data type selector tabs */}
                            <div className="flex gap-1 mb-3 border-b border-gray-200 pb-2">
                              {(['temperature', 'soilTemp', 'precipitation', 'dayLength'] as const).map((type) => (
                                <button
                                  key={type}
                                  onClick={() => setChartDataType(type)}
                                  className={`px-3 py-1 text-xs font-medium rounded-t transition-colors ${
                                    chartDataType === type
                                      ? 'bg-blue-100 text-blue-700 border-b-2 border-blue-600'
                                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                                  }`}
                                >
                                  {type === 'temperature' && 'Air Temp'}
                                  {type === 'soilTemp' && 'Soil Temp'}
                                  {type === 'precipitation' && 'Precipitation'}
                                  {type === 'dayLength' && 'Day Length'}
                                </button>
                              ))}
                            </div>

                            <div className="flex gap-3">
                              {/* Year selector on left (not for day length) */}
                              {chartDataType !== 'dayLength' && (
                                <div className="flex flex-col gap-1 border-r border-gray-200 pr-3 min-w-[70px]">
                                  <div className="text-xs text-gray-500 mb-1">Years</div>
                                  {[...chartData.years].reverse().map((year: number) => {
                                    const originalIndex = chartData.years.indexOf(year);
                                    const color = getYearColor(originalIndex);
                                    const isSelected = selectedYears?.has(year) ?? false;
                                    return (
                                      <label
                                        key={year}
                                        className="flex items-center gap-1.5 cursor-pointer text-xs hover:bg-gray-50 rounded px-1 py-0.5"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={() => {
                                            const newSet = new Set(selectedYears ?? []);
                                            if (isSelected) {
                                              newSet.delete(year);
                                            } else {
                                              newSet.add(year);
                                            }
                                            setSelectedYears(newSet);
                                          }}
                                          className="w-3 h-3 rounded"
                                          style={{ accentColor: color }}
                                        />
                                        <span
                                          className="font-medium"
                                          style={{ color: isSelected ? color : '#9ca3af' }}
                                        >
                                          {year}
                                        </span>
                                      </label>
                                    );
                                  })}
                                  <button
                                    type="button"
                                    onClick={() => setSelectedYears(new Set(chartData!.years))}
                                    className="text-xs text-blue-600 hover:text-blue-800 mt-1"
                                  >
                                    All
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedYears(new Set())}
                                    className="text-xs text-gray-500 hover:text-gray-700"
                                  >
                                    None
                                  </button>
                                </div>
                              )}

                              {/* Chart */}
                              <div className="flex-1 h-52">
                                <ResponsiveContainer width="100%" height="100%">
                                  {chartDataType === 'temperature' ? (
                                    <ComposedChart data={chartData.temperature} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
                                      <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={6} height={25} />
                                      <YAxis
                                        tick={{ fontSize: 10 }}
                                        domain={['dataMin - 5', 'dataMax + 5']}
                                        tickFormatter={(v) => `${v}°`}
                                        width={35}
                                      />
                                      <Tooltip
                                        contentStyle={{ fontSize: 11, backgroundColor: 'white', border: '1px solid #e5e7eb' }}
                                        formatter={(value, name) => {
                                          if (name === 'range') return null;
                                          if (name === 'mean') return [`${value}°F`, 'Average'];
                                          return [`${value}°F`, ''];
                                        }}
                                        labelFormatter={(label) => String(label)}
                                      />
                                      {/* Reference lines for key temperatures */}
                                      <ReferenceLine y={32} stroke="#60a5fa" strokeDasharray="3 3" label={{ value: 'Frost 32°', fontSize: 9, fill: '#60a5fa', position: 'insideTopLeft' }} />
                                      <ReferenceLine y={40} stroke="#22c55e" strokeDasharray="3 3" label={{ value: 'Cool GDD 40°', fontSize: 9, fill: '#22c55e', position: 'insideTopLeft' }} />
                                      <ReferenceLine y={50} stroke="#f97316" strokeDasharray="3 3" label={{ value: 'Warm GDD 50°', fontSize: 9, fill: '#f97316', position: 'insideTopLeft' }} />
                                      <Area type="monotone" dataKey="range" fill="#94a3b8" fillOpacity={0.2} stroke="none" name="range" isAnimationActive={!chartHasAnimated.current} animationDuration={300} />
                                      <Line type="monotone" dataKey="mean" name="mean" stroke="#475569" strokeWidth={2} strokeDasharray="4 2" dot={false} connectNulls isAnimationActive={!chartHasAnimated.current} animationDuration={300} />
                                      {chartData.years.filter((year: number) => selectedYears?.has(year)).map((year: number) => {
                                        const color = getYearColor(chartData.years.indexOf(year));
                                        return <Line key={year} type="monotone" dataKey={`avg_${year}`} name={String(year)} stroke={color} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={!chartHasAnimated.current} animationDuration={300} />;
                                      })}
                                    </ComposedChart>
                                  ) : chartDataType === 'precipitation' ? (
                                    <ComposedChart data={chartData.precipitation} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
                                      <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={6} height={25} />
                                      <YAxis
                                        tick={{ fontSize: 10 }}
                                        domain={[0, 'dataMax + 0.1']}
                                        tickFormatter={(v) => `${v}"`}
                                        width={35}
                                      />
                                      <Tooltip
                                        contentStyle={{ fontSize: 11, backgroundColor: 'white', border: '1px solid #e5e7eb' }}
                                        formatter={(value, name) => {
                                          if (name === 'range') return null;
                                          if (name === 'mean') return [`${value}"`, 'Average'];
                                          return [`${value}"`, ''];
                                        }}
                                        labelFormatter={(label) => String(label)}
                                      />
                                      <Area type="monotone" dataKey="range" fill="#3b82f6" fillOpacity={0.2} stroke="none" name="range" isAnimationActive={!chartHasAnimated.current} animationDuration={300} />
                                      <Line type="monotone" dataKey="mean" name="mean" stroke="#1d4ed8" strokeWidth={2} strokeDasharray="4 2" dot={false} connectNulls isAnimationActive={!chartHasAnimated.current} animationDuration={300} />
                                      {chartData.years.filter((year: number) => selectedYears?.has(year)).map((year: number) => {
                                        const color = getYearColor(chartData.years.indexOf(year));
                                        return <Line key={year} type="monotone" dataKey={`precip_${year}`} name={String(year)} stroke={color} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={!chartHasAnimated.current} animationDuration={300} />;
                                      })}
                                    </ComposedChart>
                                  ) : chartDataType === 'soilTemp' ? (
                                    <ComposedChart data={chartData.soilTemp} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
                                      <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={6} height={25} />
                                      <YAxis
                                        tick={{ fontSize: 10 }}
                                        domain={['dataMin - 5', 'dataMax + 5']}
                                        tickFormatter={(v) => `${v}°`}
                                        width={35}
                                      />
                                      <Tooltip
                                        contentStyle={{ fontSize: 11, backgroundColor: 'white', border: '1px solid #e5e7eb' }}
                                        formatter={(value, name) => {
                                          if (name === 'range') return null;
                                          if (name === 'mean') return [`${value}°F`, 'Average'];
                                          return [`${value}°F`, ''];
                                        }}
                                        labelFormatter={(label) => String(label)}
                                      />
                                      {/* Reference lines */}
                                      <ReferenceLine y={40} stroke="#22c55e" strokeDasharray="3 3" label={{ value: '40°', fontSize: 9, fill: '#22c55e', position: 'insideTopLeft' }} />
                                      <ReferenceLine y={50} stroke="#84cc16" strokeDasharray="3 3" label={{ value: '50°', fontSize: 9, fill: '#84cc16', position: 'insideTopLeft' }} />
                                      <ReferenceLine y={65} stroke="#f97316" strokeDasharray="3 3" label={{ value: '65°', fontSize: 9, fill: '#f97316', position: 'insideTopLeft' }} />
                                      <Area type="monotone" dataKey="range" fill="#92400e" fillOpacity={0.2} stroke="none" name="range" isAnimationActive={!chartHasAnimated.current} animationDuration={300} />
                                      <Line type="monotone" dataKey="mean" name="mean" stroke="#78350f" strokeWidth={2} strokeDasharray="4 2" dot={false} connectNulls isAnimationActive={!chartHasAnimated.current} animationDuration={300} />
                                      {chartData.years.filter((year: number) => selectedYears?.has(year)).map((year: number) => {
                                        const color = getYearColor(chartData.years.indexOf(year));
                                        return <Line key={year} type="monotone" dataKey={`soil_${year}`} name={String(year)} stroke={color} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={!chartHasAnimated.current} animationDuration={300} />;
                                      })}
                                    </ComposedChart>
                                  ) : (
                                    /* Day Length chart - single line, no year variation */
                                    <ComposedChart data={chartData.dayLength} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
                                      <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={6} height={25} />
                                      <YAxis
                                        tick={{ fontSize: 10 }}
                                        domain={[6, 18]}
                                        tickFormatter={(v) => `${v}h`}
                                        width={35}
                                      />
                                      <Tooltip
                                        contentStyle={{ fontSize: 11, backgroundColor: 'white', border: '1px solid #e5e7eb' }}
                                        formatter={(value) => [`${value} hours`, 'Day Length']}
                                        labelFormatter={(label) => String(label)}
                                      />
                                      <Line type="monotone" dataKey="hours" name="hours" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={!chartHasAnimated.current} animationDuration={300} />
                                    </ComposedChart>
                                  )}
                                </ResponsiveContainer>
                              </div>
                            </div>
                            <div className="text-xs text-gray-500 mt-2 text-center">
                              {chartDataType === 'temperature' && `Daily average air temperature (°F) — ${selectedYears?.size ?? 0} of ${chartData.years.length} years shown`}
                              {chartDataType === 'soilTemp' && `Soil temperature at 0-7cm depth (°F) — ${selectedYears?.size ?? 0} of ${chartData.years.length} years shown`}
                              {chartDataType === 'precipitation' && `Daily precipitation (inches) — ${selectedYears?.size ?? 0} of ${chartData.years.length} years shown`}
                              {chartDataType === 'dayLength' && `Hours of daylight at ${Math.abs(tempData?.location.lat ?? 0).toFixed(1)}° ${(tempData?.location.lat ?? 0) >= 0 ? 'N' : 'S'}`}
                            </div>
                          </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">No location set</div>
                )}

                {/* Location search */}
                <div className="relative">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={locationSearch}
                      onChange={(e) => {
                        setLocationSearch(e.target.value);
                        searchLocations(e.target.value);
                      }}
                      placeholder="Search for a city or town..."
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      onClick={useMyLocation}
                      disabled={gettingLocation}
                      className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
                      title="Use my current location"
                    >
                      {gettingLocation ? '...' : '📍'}
                    </button>
                  </div>

                  {/* Search results dropdown */}
                  {searchResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                      {searchResults.map((result, i) => (
                        <button
                          key={i}
                          onClick={() => selectLocation(result)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                        >
                          <div className="font-medium text-gray-900">{result.name}</div>
                          <div className="text-xs text-gray-500">
                            {result.admin1 && <>{result.admin1}, </>}
                            {result.country}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {isSearching && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg p-3 text-sm text-gray-500">
                      Searching...
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Adjusts maturity timing based on your local weather. Warmer = faster maturity, cooler = slower.
              </p>
            </div>

            {/* Last Frost Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Last Frost Date
              </label>
              <div className="flex gap-2 items-center">
                {(() => {
                  const parsed = parseMonthDay(metadata.lastFrostDate);
                  const monthStr = parsed ? String(parsed.month).padStart(2, '0') : '';
                  const dayStr = parsed ? String(parsed.day).padStart(2, '0') : '';
                  return (
                    <>
                      <select
                        value={monthStr}
                        onChange={(e) => {
                          const month = e.target.value;
                          const currentDay = parsed?.day ?? 1;
                          updatePlanMetadata({
                            lastFrostDate: month ? formatMonthDay(parseInt(month), currentDay) : undefined
                          });
                        }}
                        className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Month</option>
                        <option value="01">January</option>
                        <option value="02">February</option>
                        <option value="03">March</option>
                        <option value="04">April</option>
                        <option value="05">May</option>
                        <option value="06">June</option>
                        <option value="07">July</option>
                        <option value="08">August</option>
                        <option value="09">September</option>
                        <option value="10">October</option>
                        <option value="11">November</option>
                        <option value="12">December</option>
                      </select>
                      <select
                        value={dayStr}
                        onChange={(e) => {
                          const day = e.target.value;
                          const currentMonth = parsed?.month ?? 4;
                          updatePlanMetadata({
                            lastFrostDate: day ? formatMonthDay(currentMonth, parseInt(day)) : undefined
                          });
                        }}
                        className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Day</option>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={String(d).padStart(2, '0')}>{d}</option>
                        ))}
                      </select>
                    </>
                  );
                })()}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Average last frost date for your area. Used to calculate weeks-from-frost for crop scheduling.
              </p>
            </div>
          </div>
        </section>

        {/* Calculation Settings Section */}
        <section className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Calculation Settings</h2>

          <div className="space-y-4">
            {/* Transplant Shock Days */}
            <div>
              <label htmlFor="transplantShockDays" className="block text-sm font-medium text-gray-700 mb-1">
                Transplant Shock Adjustment
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="transplantShockDays"
                  type="number"
                  value={metadata.transplantShockDays ?? DEFAULT_TRANSPLANT_SHOCK_DAYS}
                  onChange={(e) => updatePlanMetadata({ transplantShockDays: parseInt(e.target.value) || DEFAULT_TRANSPLANT_SHOCK_DAYS })}
                  min={0}
                  max={30}
                  className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-sm text-gray-600">days</span>
                {metadata.transplantShockDays !== undefined && metadata.transplantShockDays !== DEFAULT_TRANSPLANT_SHOCK_DAYS && (
                  <button
                    type="button"
                    onClick={() => updatePlanMetadata({ transplantShockDays: undefined })}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Reset to default ({DEFAULT_TRANSPLANT_SHOCK_DAYS})
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Transplants take longer overall than direct-seeded crops due to root disturbance and establishment.
                This adjustment compensates when converting timing between methods. Default: {DEFAULT_TRANSPLANT_SHOCK_DAYS} days.
              </p>
            </div>

            {/* Default Assumed Transplant Age */}
            <div>
              <label htmlFor="defaultTransplantAge" className="block text-sm font-medium text-gray-700 mb-1">
                Default Assumed Transplant Age
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="defaultTransplantAge"
                  type="number"
                  value={metadata.defaultTransplantAge ?? DEFAULT_ASSUMED_TRANSPLANT_AGE}
                  onChange={(e) => updatePlanMetadata({ defaultTransplantAge: parseInt(e.target.value) || DEFAULT_ASSUMED_TRANSPLANT_AGE })}
                  min={7}
                  max={90}
                  className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-sm text-gray-600">days</span>
                {metadata.defaultTransplantAge !== undefined && metadata.defaultTransplantAge !== DEFAULT_ASSUMED_TRANSPLANT_AGE && (
                  <button
                    type="button"
                    onClick={() => updatePlanMetadata({ defaultTransplantAge: undefined })}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Reset to default ({DEFAULT_ASSUMED_TRANSPLANT_AGE})
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                When DTM is measured &quot;from transplant,&quot; we need to know how old the transplant was assumed to be.
                This default is used when a spec doesn&apos;t specify its own value. Default: {DEFAULT_ASSUMED_TRANSPLANT_AGE} days.
              </p>
            </div>
          </div>
        </section>

        {/* Plan Details Section (read-only) */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Plan Details</h2>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Plan ID:</span>
              <span className="ml-2 font-mono text-gray-700">{metadata.id}</span>
            </div>
            <div>
              <span className="text-gray-500">Version:</span>
              <span className="ml-2 text-gray-700">{metadata.version || 1}</span>
            </div>
            <div>
              <span className="text-gray-500">Created:</span>
              <span className="ml-2 text-gray-700">
                {new Date(metadata.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Last Modified:</span>
              <span className="ml-2 text-gray-700">
                {new Date(metadata.lastModified).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            </div>
            {metadata.parentPlanId && (
              <>
                <div>
                  <span className="text-gray-500">Copied From:</span>
                  <span className="ml-2 font-mono text-gray-700">{metadata.parentPlanId}</span>
                </div>
                {metadata.parentVersion && (
                  <div>
                    <span className="text-gray-500">Parent Version:</span>
                    <span className="ml-2 text-gray-700">{metadata.parentVersion}</span>
                  </div>
                )}
              </>
            )}
            <div>
              <span className="text-gray-500">Plantings:</span>
              <span className="ml-2 text-gray-700">{currentPlan.plantings?.length || 0}</span>
            </div>
            <div>
              <span className="text-gray-500">Beds:</span>
              <span className="ml-2 text-gray-700">{Object.keys(currentPlan.beds || {}).length}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
    </>
  );
}
