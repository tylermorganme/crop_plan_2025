'use client';

import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  ReferenceLine,
  CartesianGrid,
  LabelList,
} from 'recharts';
import {
  usePlanStore,
  loadPlanFromLibrary,
} from '@/lib/plan-store';
import {
  calculatePlanRevenue,
  formatCurrency,
  formatMonth,
  type PlanRevenueReport,
  type CropRevenueResult,
} from '@/lib/revenue';
import {
  calculatePlanSeeds,
  formatSeeds,
  formatOunces,
  formatWeight,
  type PlanSeedReport,
  type SupplierSeedResult,
  type VarietySeedResult,
} from '@/lib/seeds';
import { createSeedOrder, type SeedOrder, type ProductUnit } from '@/lib/entities/seed-order';
import type { Variety, DensityUnit } from '@/lib/entities/variety';
import type { Market } from '@/lib/entities/market';
import { getActiveMarkets } from '@/lib/entities/market';
import { Z_INDEX } from '@/lib/z-index';
import { useUIStore } from '@/lib/ui-store';
import AppHeader from '@/components/AppHeader';
import { PageLayout } from '@/components/PageLayout';
import { ConnectedPlantingInspector } from '@/components/ConnectedPlantingInspector';
import {
  calculatePlanProduction,
  formatYield,
  getHarvestEventMarkets,
  type PlanProductionReport,
  type ProductProductionSummary,
  type HarvestEvent,
} from '@/lib/production';
import { useComputedCrops } from '@/lib/use-computed-crops';

// =============================================================================
// TAB TYPES
// =============================================================================

type ReportTab = 'revenue' | 'seeds' | 'production';

// =============================================================================
// SEED ORDER DEFAULTS
// =============================================================================

/**
 * Default unit for ordering seeds.
 * TODO: Make this a user-configurable setting in the future.
 */
const DEFAULT_ORDER_UNIT: ProductUnit = 'oz';

/**
 * Default unit for inventory (what you have on hand).
 * Grams is convenient for weighing small amounts on a scale.
 * TODO: Make this a user-configurable setting in the future.
 */
const DEFAULT_HAVE_UNIT: ProductUnit = 'g';

// =============================================================================
// WEIGHT CONVERSION
// =============================================================================

/** Convert weight between units for comparison */
/** Format ISO date string as "Mon Day, Year" (e.g., "Jan 15, 2025") */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function convertWeight(value: number, fromUnit: ProductUnit, toUnit: ProductUnit): number {
  if (fromUnit === toUnit) return value;

  // Convert to grams first (our base unit)
  const toGrams: Record<ProductUnit, number> = {
    g: 1,
    oz: 28.3495,
    lb: 453.592,
    ct: 0, // Can't convert count to weight
  };

  // Can't convert between count and weight
  if (fromUnit === 'ct' || toUnit === 'ct') {
    return fromUnit === toUnit ? value : 0;
  }

  const grams = value * toGrams[fromUnit];
  return grams / toGrams[toUnit];
}

// =============================================================================
// CHART COMPONENTS
// =============================================================================

/** Pie chart using Recharts */
function PieChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) {
    return (
      <div className="w-64 h-64 rounded-full bg-gray-100 flex items-center justify-center">
        <span className="text-gray-400">No data</span>
      </div>
    );
  }

  return (
    <div className="w-64 h-64">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsPieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            outerRadius={100}
            innerRadius={0}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.8} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => formatCurrency(value as number)}
            contentStyle={{ fontSize: 12 }}
          />
        </RechartsPieChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Stacked area chart for monthly revenue by crop using Recharts */
function StackedAreaChart({
  data,
  crops,
  cropColors,
}: {
  data: { month: string; revenue: number; byCrop: Record<string, number> }[];
  crops: string[];
  cropColors: Record<string, string>;
}) {
  if (data.length === 0) {
    return (
      <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
        <span className="text-gray-400">No revenue data</span>
      </div>
    );
  }

  // Only show top 8 crops in the chart to avoid clutter
  const topCrops = crops.slice(0, 8);

  // Filter out months with negligible revenue (< 1% of max month)
  // This removes noise from perennial crops spreading tiny amounts across many months
  const maxMonthRevenue = Math.max(...data.map(d => d.revenue));
  const threshold = maxMonthRevenue * 0.01; // 1% threshold
  const filteredData = data.filter(d => d.revenue >= threshold);

  // Transform data for Recharts - flatten byCrop into top-level keys
  // Ensure all crops have a value for every month (default to 0)
  const chartData = filteredData.map(d => {
    // Format as "Apr '25" to keep year context while staying compact
    const [year, monthNum] = d.month.split('-');
    const date = new Date(parseInt(year), parseInt(monthNum) - 1);
    const monthLabel = date.toLocaleDateString('en-US', { month: 'short' }) + " '" + year.slice(2);

    const row: Record<string, string | number> = {
      month: monthLabel,
      _totalRevenue: d.revenue, // Store actual total for tooltip
    };
    // Initialize all top crops to 0, then override with actual values
    let topCropsTotal = 0;
    for (const crop of topCrops) {
      const cropRevenue = d.byCrop[crop] ?? 0;
      row[crop] = cropRevenue;
      topCropsTotal += cropRevenue;
    }
    // Add "Other" for crops not in top 8
    row['Other'] = Math.max(0, d.revenue - topCropsTotal);
    return row;
  });

  return (
    <div className="h-64 bg-gray-50 rounded-lg p-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#e5e7eb' }}
            interval="preserveStartEnd"
            padding={{ left: 20, right: 20 }}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              // Get the actual total revenue from the data (includes all crops, not just top 8)
              const dataPoint = payload[0]?.payload as Record<string, number> | undefined;
              const actualTotal = dataPoint?._totalRevenue ?? 0;
              // Sum of top 8 crops shown in chart
              const shownTotal = payload.reduce((sum, entry) => sum + (entry.value as number || 0), 0);
              const otherTotal = actualTotal - shownTotal;

              return (
                <div className="bg-white border border-gray-200 rounded shadow-lg p-2 text-xs">
                  <div className="font-semibold mb-1">{label}</div>
                  {payload.map((entry, i) => (
                    entry.value as number > 0 && (
                      <div key={i} className="flex justify-between gap-4">
                        <span style={{ color: entry.color }}>{entry.name}</span>
                        <span>{formatCurrency(entry.value as number)}</span>
                      </div>
                    )
                  ))}
                  {otherTotal > 0 && (
                    <div className="flex justify-between gap-4 text-gray-500">
                      <span>Other</span>
                      <span>{formatCurrency(otherTotal)}</span>
                    </div>
                  )}
                  <div className="border-t border-gray-200 mt-1 pt-1 font-semibold flex justify-between gap-4">
                    <span>Total</span>
                    <span>{formatCurrency(actualTotal)}</span>
                  </div>
                </div>
              );
            }}
          />
          {/* "Other" category at the bottom of the stack */}
          <Area
            key="Other"
            type="step"
            dataKey="Other"
            stackId="1"
            stroke="#9ca3af"
            fill="#9ca3af"
            fillOpacity={0.8}
          />
          {/* Render crop areas in reverse order so first crops appear on top */}
          {[...topCrops].reverse().map((crop) => (
            <Area
              key={crop}
              type="step"
              dataKey={crop}
              stackId="1"
              stroke={cropColors[crop]}
              fill={cropColors[crop]}
              fillOpacity={0.8}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// =============================================================================
// PRODUCTION HARVEST CHART
// =============================================================================

/** LocalStorage key for production chart settings */
const PRODUCTION_CHART_STORAGE_KEY = 'crop-plan-production-chart-settings';

interface ProductionChartSettings {
  yearOffset: number; // -1, 0, or 1 relative to plan year
  startMonth: number; // 1-12
  endMonth: number; // 1-12
  selectedMarkets: string[]; // Array of market IDs to show (empty = all markets)
  showBars: boolean; // Show harvest event bars
  showWeeklyAvg: boolean; // Show weekly average lines
  rollingWindowDays: number; // Rolling window size in days (7, 14, 21, 28)
}

const DEFAULT_CHART_SETTINGS: ProductionChartSettings = {
  yearOffset: 0,
  startMonth: 1,
  endMonth: 12,
  selectedMarkets: [], // Empty = show all markets
  showBars: true,
  showWeeklyAvg: true,
  rollingWindowDays: 21, // 3-week window by default
};

function loadChartSettings(): ProductionChartSettings {
  if (typeof window === 'undefined') return DEFAULT_CHART_SETTINGS;
  try {
    const stored = localStorage.getItem(PRODUCTION_CHART_STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_CHART_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_CHART_SETTINGS;
}

function saveChartSettings(settings: ProductionChartSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PRODUCTION_CHART_STORAGE_KEY, JSON.stringify(settings));
}

/** Colors for market bars in stacked chart */
const MARKET_COLORS: Record<string, string> = {
  'market-direct': '#22c55e', // green - Direct sales
  'market-wholesale': '#3b82f6', // blue - Wholesale
  'market-upick': '#f97316', // orange - U-Pick
  'market-farmers-market': '#8b5cf6', // violet - Farmers Market
};

/** Fallback colors for markets without predefined colors */
const FALLBACK_MARKET_COLORS = ['#ef4444', '#eab308', '#14b8a6', '#ec4899', '#6b7280'];

/** Get color for a market ID */
function getMarketColor(marketId: string, index: number): string {
  return MARKET_COLORS[marketId] ?? FALLBACK_MARKET_COLORS[index % FALLBACK_MARKET_COLORS.length];
}

/** Planting info needed for weekly capacity calculation */
interface PlantingForCapacity {
  harvestStartDate: string | null;
  harvestEndDate: string | null;
  maxYieldPerWeek: number;
}

/** Harvest timeline chart showing individual harvest events as bars */
function ProductionChart({
  harvestEvents,
  plantings,
  unit,
  planYear,
  planId,
  productName,
  cropName,
  markets,
  onReset,
}: {
  harvestEvents: HarvestEvent[];
  plantings: PlantingForCapacity[];
  unit: string;
  planYear: number;
  planId: string;
  productName: string;
  cropName: string;
  markets: Record<string, Market>;
  onReset?: () => void;
}) {
  const [settings, setSettings] = useState<ProductionChartSettings>(loadChartSettings);

  // Calculate the display year
  const displayYear = planYear + settings.yearOffset;

  // Get all unique markets from harvest events
  const availableMarkets = useMemo(() => {
    const marketIds = getHarvestEventMarkets(harvestEvents);
    return marketIds.map(id => ({
      id,
      name: markets[id]?.name ?? id.replace('market-', ''),
      color: getMarketColor(id, marketIds.indexOf(id)),
    }));
  }, [harvestEvents, markets]);

  // Effective selected markets (empty = all selected)
  const effectiveSelectedMarkets = useMemo(() => {
    if (settings.selectedMarkets.length === 0) {
      return availableMarkets.map(m => m.id);
    }
    return settings.selectedMarkets.filter(id => availableMarkets.some(m => m.id === id));
  }, [settings.selectedMarkets, availableMarkets]);

  // Filter events to the selected year and month range
  const filteredEvents = useMemo(() => {
    return harvestEvents.filter(event => {
      const date = new Date(event.date + 'T00:00:00');
      if (date.getFullYear() !== displayYear) return false;
      const month = date.getMonth() + 1;
      return month >= settings.startMonth && month <= settings.endMonth;
    });
  }, [harvestEvents, displayYear, settings.startMonth, settings.endMonth]);

  // Calculate day of year for temporal positioning
  const getDayOfYear = useCallback((dateStr: string): number => {
    const date = new Date(dateStr + 'T00:00:00');
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }, []);

  // Aggregate events by date for the bar chart with temporal positioning
  // Now includes yield breakdown by market for stacked bars
  const chartData = useMemo(() => {
    const byDate = new Map<string, {
      date: string;
      dayOfYear: number;
      totalYield: number;
      events: HarvestEvent[];
      [key: string]: unknown; // Market IDs will be added here
    }>();

    for (const event of filteredEvents) {
      const existing = byDate.get(event.date);
      if (existing) {
        existing.totalYield += event.yield;
        existing.events.push(event);
        // Add market yields
        for (const [marketId, marketYield] of Object.entries(event.yieldByMarket)) {
          if (effectiveSelectedMarkets.includes(marketId)) {
            existing[marketId] = ((existing[marketId] as number) || 0) + marketYield;
          }
        }
      } else {
        const entry: {
          date: string;
          dayOfYear: number;
          totalYield: number;
          events: HarvestEvent[];
          [key: string]: unknown;
        } = {
          date: event.date,
          dayOfYear: getDayOfYear(event.date),
          totalYield: event.yield,
          events: [event],
        };
        // Initialize market yields
        for (const [marketId, marketYield] of Object.entries(event.yieldByMarket)) {
          if (effectiveSelectedMarkets.includes(marketId)) {
            entry[marketId] = marketYield;
          }
        }
        byDate.set(event.date, entry);
      }
    }

    // Sort by date and create array
    const sorted = Array.from(byDate.values()).sort((a, b) => a.dayOfYear - b.dayOfYear);

    // Calculate the visible yield for each entry (sum of selected markets)
    for (const entry of sorted) {
      let visibleYield = 0;
      for (const marketId of effectiveSelectedMarkets) {
        visibleYield += (entry[marketId] as number) || 0;
      }
      entry.visibleYield = visibleYield;
    }

    return sorted;
  }, [filteredEvents, getDayOfYear, effectiveSelectedMarkets]);

  // Compute weekly capacity for each day by summing maxYieldPerWeek from all
  // plantings whose harvest window overlaps that day.
  // This shows "production capacity" - what your peak weekly output could be
  // at any point based on which plantings are in their harvest window.
  const chartDataWithCapacity = useMemo(() => {
    if (chartData.length === 0) return chartData;

    // Filter plantings to those with valid harvest windows in display year
    const validPlantings = plantings.filter(p => {
      if (!p.harvestStartDate || !p.harvestEndDate || p.maxYieldPerWeek <= 0) return false;
      const startYear = new Date(p.harvestStartDate + 'T00:00:00').getFullYear();
      const endYear = new Date(p.harvestEndDate + 'T00:00:00').getFullYear();
      return startYear === displayYear || endYear === displayYear;
    });

    // Pre-compute day-of-year ranges for each planting
    const plantingRanges = validPlantings.map(p => ({
      startDoy: getDayOfYear(p.harvestStartDate!),
      // Add 1 to include the end day in the range
      endDoy: getDayOfYear(p.harvestEndDate!) + 1,
      maxYieldPerWeek: p.maxYieldPerWeek,
    }));

    // For each chart data point, sum capacity from all active plantings
    return chartData.map(entry => {
      let weeklyCapacity = 0;
      for (const range of plantingRanges) {
        // Check if this day falls within the planting's harvest window
        if (entry.dayOfYear >= range.startDoy && entry.dayOfYear < range.endDoy) {
          weeklyCapacity += range.maxYieldPerWeek;
        }
      }

      return { ...entry, weeklyCapacity };
    });
  }, [chartData, plantings, displayYear, getDayOfYear]);

  // Calculate axis domain based on month range
  const axisDomain = useMemo(() => {
    // Start of selected range
    const startDate = new Date(displayYear, settings.startMonth - 1, 1);
    const endDate = new Date(displayYear, settings.endMonth, 0); // Last day of end month
    return [getDayOfYear(startDate.toISOString().split('T')[0]), getDayOfYear(endDate.toISOString().split('T')[0])];
  }, [displayYear, settings.startMonth, settings.endMonth, getDayOfYear]);

  // Calculate nice Y-axis tick values for consistent grid lines and center labels
  const yAxisTicks = useMemo(() => {
    if (chartDataWithCapacity.length === 0) return [0];

    // Find max value across all bars and the weekly capacity line
    let maxVal = 0;
    for (const entry of chartDataWithCapacity) {
      const entryRecord = entry as Record<string, unknown>;

      // Sum up all selected market yields for bars
      if (settings.showBars) {
        let barTotal = 0;
        for (const marketId of effectiveSelectedMarkets) {
          barTotal += (entryRecord[marketId] as number) || 0;
        }
        maxVal = Math.max(maxVal, barTotal);
      }

      // Weekly capacity line
      if (settings.showWeeklyAvg && (entry as { weeklyCapacity?: number }).weeklyCapacity) {
        maxVal = Math.max(maxVal, (entry as { weeklyCapacity?: number }).weeklyCapacity ?? 0);
      }
    }

    if (maxVal === 0) return [0];

    // Calculate nice tick interval (aim for 4-6 ticks)
    const roughInterval = maxVal / 5;
    // Round to nice number (1, 2, 5, 10, 20, 50, 100, etc.)
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughInterval)));
    const normalized = roughInterval / magnitude;
    let niceInterval: number;
    if (normalized <= 1) niceInterval = 1 * magnitude;
    else if (normalized <= 2) niceInterval = 2 * magnitude;
    else if (normalized <= 5) niceInterval = 5 * magnitude;
    else niceInterval = 10 * magnitude;

    // Generate ticks from 0 to just above max
    const ticks: number[] = [];
    for (let t = 0; t <= maxVal + niceInterval * 0.1; t += niceInterval) {
      ticks.push(Math.round(t));
    }
    return ticks;
  }, [chartDataWithCapacity, effectiveSelectedMarkets, settings.showBars, settings.showWeeklyAvg]);

  // Update settings and save to localStorage
  const updateSettings = useCallback((updates: Partial<ProductionChartSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      saveChartSettings(next);
      return next;
    });
  }, []);

  // Toggle a market selection
  const toggleMarket = useCallback((marketId: string) => {
    setSettings(prev => {
      let newSelected: string[];
      if (prev.selectedMarkets.length === 0) {
        // Currently "all selected" - switching to explicit selection minus this one
        newSelected = availableMarkets.map(m => m.id).filter(id => id !== marketId);
      } else if (prev.selectedMarkets.includes(marketId)) {
        // Already selected - remove it
        newSelected = prev.selectedMarkets.filter(id => id !== marketId);
        // If removing would leave empty, switch to "none" (show at least one)
        if (newSelected.length === 0) {
          newSelected = availableMarkets.map(m => m.id).filter(id => id !== marketId);
          if (newSelected.length === 0) newSelected = [marketId]; // Can't deselect the only market
        }
      } else {
        // Not selected - add it
        newSelected = [...prev.selectedMarkets, marketId];
        // If now all are selected, switch back to empty (meaning "all")
        if (newSelected.length === availableMarkets.length) {
          newSelected = [];
        }
      }
      const next = { ...prev, selectedMarkets: newSelected };
      saveChartSettings(next);
      return next;
    });
  }, [availableMarkets]);

  // Reset to defaults
  const handleReset = useCallback(() => {
    setSettings(DEFAULT_CHART_SETTINGS);
    saveChartSettings(DEFAULT_CHART_SETTINGS);
    onReset?.();
  }, [onReset]);

  // Total yield in filtered range (only for selected markets)
  const totalYield = useMemo(() => {
    let sum = 0;
    for (const event of filteredEvents) {
      for (const [marketId, marketYield] of Object.entries(event.yieldByMarket)) {
        if (effectiveSelectedMarkets.includes(marketId)) {
          sum += marketYield;
        }
      }
    }
    return sum;
  }, [filteredEvents, effectiveSelectedMarkets]);

  // Month names for display
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Get market info for rendering (only selected ones)
  const selectedMarketInfo = useMemo(() => {
    return availableMarkets.filter(m => effectiveSelectedMarkets.includes(m.id));
  }, [availableMarkets, effectiveSelectedMarkets]);

  if (harvestEvents.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="h-48 flex items-center justify-center text-gray-400">
          No harvest data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      {/* Header with controls */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {cropName} - {productName}
          </h3>
          <div className="text-sm text-gray-500">
            {formatYield(totalYield, unit)} across {filteredEvents.length} harvest events
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Year navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => updateSettings({ yearOffset: settings.yearOffset - 1 })}
              disabled={settings.yearOffset <= -1}
              className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ←
            </button>
            <span className="text-sm font-medium w-12 text-center">{displayYear}</span>
            <button
              onClick={() => updateSettings({ yearOffset: settings.yearOffset + 1 })}
              disabled={settings.yearOffset >= 1}
              className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              →
            </button>
          </div>

          {/* Month range */}
          <div className="flex items-center gap-2 text-sm">
            <select
              value={settings.startMonth}
              onChange={(e) => updateSettings({ startMonth: parseInt(e.target.value) })}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            >
              {monthNames.map((name, i) => (
                <option key={i} value={i + 1}>{name}</option>
              ))}
            </select>
            <span className="text-gray-400">to</span>
            <select
              value={settings.endMonth}
              onChange={(e) => updateSettings({ endMonth: parseInt(e.target.value) })}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            >
              {monthNames.map((name, i) => (
                <option key={i} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>

          {/* Show bars toggle */}
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showBars}
              onChange={(e) => updateSettings({ showBars: e.target.checked })}
              className="w-3.5 h-3.5 text-blue-500 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="text-gray-700">Bars</span>
          </label>

          {/* Weekly capacity toggle */}
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showWeeklyAvg}
              onChange={(e) => updateSettings({ showWeeklyAvg: e.target.checked })}
              className="w-3.5 h-3.5 text-orange-500 border-gray-300 rounded focus:ring-orange-500"
            />
            <span className="text-gray-700">Max/wk</span>
          </label>

          {/* Reset button */}
          <button
            onClick={handleReset}
            className="px-2 py-1 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded hover:bg-gray-50"
            title="Reset to defaults"
          >
            Reset
          </button>

          {/* Debug button */}
          <button
            onClick={() => {
              const debugInfo = {
                timestamp: new Date().toISOString(),
                url: typeof window !== 'undefined' ? window.location.href : '',
                planId,
                crop: cropName,
                product: productName,
                unit,
                settings,
                harvestEvents: harvestEvents.length,
                filteredEvents: filteredEvents.length,
                chartData: chartDataWithCapacity.map((d: { date: string; dayOfYear: number; visibleYield?: number; weeklyCapacity?: number }) => ({
                  date: d.date,
                  dayOfYear: d.dayOfYear,
                  visibleYield: d.visibleYield,
                  weeklyCapacity: d.weeklyCapacity,
                })),
              };
              navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
              // Brief visual feedback
              const btn = document.activeElement as HTMLButtonElement;
              const original = btn?.textContent;
              if (btn) {
                btn.textContent = '✓';
                setTimeout(() => { btn.textContent = original; }, 500);
              }
            }}
            className="px-2 py-1 text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded hover:bg-gray-50"
            title="Copy debug info"
          >
            🐛
          </button>
        </div>
      </div>

      {/* Market filter */}
      {availableMarkets.length > 1 && (
        <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-100">
          <span className="text-sm text-gray-600">Markets:</span>
          {availableMarkets.map((market) => {
            const isSelected = effectiveSelectedMarkets.includes(market.id);
            return (
              <label
                key={market.id}
                className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-sm ${
                  isSelected ? 'bg-gray-100' : 'hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleMarket(market.id)}
                  className="sr-only"
                />
                <span
                  className="w-3 h-3 rounded-sm border"
                  style={{
                    backgroundColor: isSelected ? market.color : 'transparent',
                    borderColor: market.color,
                  }}
                />
                <span className={isSelected ? 'text-gray-900' : 'text-gray-400'}>
                  {market.name}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {/* Chart */}
      {chartData.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-400">
          No harvests in selected range
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartDataWithCapacity} margin={{ top: 20, right: 40, bottom: 20, left: 40 }}>
              {/* Horizontal grid lines */}
              <CartesianGrid
                horizontal={true}
                vertical={false}
                stroke="#9ca3af"
                strokeDasharray="3 3"
                yAxisId="left"
              />
              {/* Month boundary vertical lines */}
              {(() => {
                const lines = [];
                for (let m = settings.startMonth; m <= settings.endMonth + 1; m++) {
                  const d = new Date(displayYear, m - 1, 1);
                  const doy = Math.floor((d.getTime() - new Date(displayYear, 0, 0).getTime()) / 86400000);
                  lines.push(
                    <ReferenceLine
                      key={`month-${m}`}
                      x={doy}
                      yAxisId="left"
                      stroke="#9ca3af"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                  );
                }
                return lines;
              })()}
              {/* Centered labels on horizontal grid lines - rendered early so they're behind data */}
              {yAxisTicks.slice(1).map((yVal) => (
                <ReferenceLine
                  key={`y-label-${yVal}`}
                  y={yVal}
                  yAxisId="left"
                  stroke="transparent"
                  label={{
                    value: yVal.toFixed(0),
                    position: 'center',
                    fill: '#6b7280',
                    fontSize: 10,
                  }}
                />
              ))}
              {/* Single clean axis with month names */}
              <XAxis
                dataKey="dayOfYear"
                type="number"
                domain={axisDomain}
                tick={{ fontSize: 11, fill: '#374151' }}
                ticks={(() => {
                  const ticks: number[] = [];
                  for (let m = settings.startMonth; m <= settings.endMonth; m++) {
                    // Middle of month for centered label
                    const mid = new Date(displayYear, m - 1, 15);
                    const doy = Math.floor((mid.getTime() - new Date(displayYear, 0, 0).getTime()) / 86400000);
                    ticks.push(doy);
                  }
                  return ticks;
                })()}
                tickFormatter={(dayOfYear) => {
                  const d = new Date(displayYear, 0, dayOfYear);
                  return d.toLocaleDateString('en-US', { month: 'short' });
                }}
                tickLine={false}
                axisLine={{ stroke: '#d1d5db' }}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 10, fill: '#6b7280' }}
                tickFormatter={(value) => value.toFixed(0)}
                width={35}
                ticks={yAxisTicks}
                domain={[0, yAxisTicks[yAxisTicks.length - 1] || 'auto']}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 10, fill: '#6b7280' }}
                tickFormatter={(value) => value.toFixed(0)}
                width={35}
                ticks={yAxisTicks}
                domain={[0, yAxisTicks[yAxisTicks.length - 1] || 'auto']}
                axisLine={{ stroke: '#9ca3af' }}
                tickLine={{ stroke: '#9ca3af' }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload as {
                    date: string;
                    totalYield: number;
                    weeklyCapacity: number;
                    events: HarvestEvent[];
                    [key: string]: unknown;
                  };
                  const d = new Date(data.date + 'T00:00:00');
                  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

                  // Calculate yield by market for this date
                  const marketBreakdown = selectedMarketInfo.map(m => ({
                    name: m.name,
                    color: m.color,
                    yield: (data[m.id] as number) || 0,
                  })).filter(m => m.yield > 0);

                  const visibleTotal = marketBreakdown.reduce((sum, m) => sum + m.yield, 0);

                  return (
                    <div className="bg-white border border-gray-200 rounded shadow-lg p-2 text-xs max-w-xs">
                      <div className="font-semibold mb-1">{dateStr}</div>
                      {/* Market breakdown */}
                      {marketBreakdown.length > 1 ? (
                        <div className="mb-1 space-y-0.5">
                          {marketBreakdown.map((m, i) => (
                            <div key={i} className="flex items-center justify-between gap-3">
                              <span className="flex items-center gap-1">
                                <span
                                  className="w-2 h-2 rounded-sm"
                                  style={{ backgroundColor: m.color }}
                                />
                                {m.name}
                              </span>
                              <span>{formatYield(m.yield, unit)}</span>
                            </div>
                          ))}
                          <div className="border-t border-gray-200 pt-0.5 flex justify-between font-medium">
                            <span>Total</span>
                            <span>{formatYield(visibleTotal, unit)}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="mb-1">{formatYield(visibleTotal, unit)}</div>
                      )}
                      {/* Weekly capacity */}
                      {settings.showWeeklyAvg && data.weeklyCapacity > 0 && (
                        <div className="flex items-center justify-between gap-3 text-gray-600 border-t border-gray-100 pt-1 mt-1">
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-0.5 bg-orange-500 rounded" />
                            Max/wk
                          </span>
                          <span>{formatYield(data.weeklyCapacity, unit)}/wk</span>
                        </div>
                      )}
                      <div className="text-gray-500 text-xs mt-1">
                        {data.events.length} planting{data.events.length > 1 ? 's' : ''}:
                        <div className="max-h-24 overflow-y-auto mt-1">
                          {data.events.slice(0, 5).map((e, i) => (
                            <div key={i} className="truncate">
                              {e.bedName || 'Unassigned'}: {formatYield(e.yield, unit)}
                            </div>
                          ))}
                          {data.events.length > 5 && (
                            <div className="text-gray-400">+{data.events.length - 5} more</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
              {/* Stacked bars for each selected market */}
              {settings.showBars && selectedMarketInfo.map((market, index) => (
                <Bar
                  key={market.id}
                  dataKey={market.id}
                  yAxisId="left"
                  stackId="markets"
                  fill={market.color}
                  radius={index === selectedMarketInfo.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                  barSize={8}
                />
              ))}
              {/* Weekly capacity line - shows sum of max/wk for all plantings with active harvest windows */}
              {settings.showWeeklyAvg && (
                <Line
                  type="monotone"
                  dataKey="weeklyCapacity"
                  yAxisId="left"
                  stroke="#374151"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#374151' }}
                  strokeDasharray="4 2"
                >
                  <LabelList
                    dataKey="weeklyCapacity"
                    position="top"
                    content={({ x, y, value, index }) => {
                      // Only show label at the maximum weekly capacity point
                      if (!value || (value as number) <= 0) return null;

                      // Find the index of the maximum weeklyCapacity
                      let maxIndex = 0;
                      let maxVal = 0;
                      for (let i = 0; i < chartDataWithCapacity.length; i++) {
                        const cap = (chartDataWithCapacity[i] as { weeklyCapacity?: number }).weeklyCapacity ?? 0;
                        if (cap > maxVal) {
                          maxVal = cap;
                          maxIndex = i;
                        }
                      }

                      if (index !== maxIndex) return null;

                      return (
                        <text
                          x={x}
                          y={(y as number) - 8}
                          fill="#374151"
                          fontSize={10}
                          fontWeight={500}
                          textAnchor="middle"
                        >
                          {Math.round(value as number)}
                        </text>
                      );
                    }}
                  />
                </Line>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// REVENUE TAB CONTENT
// =============================================================================

/** Color palette for pie chart segments */
const CROP_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#6b7280', // gray
  '#78716c', // stone
];

function RevenueTab({ report, markets }: { report: PlanRevenueReport; markets: Record<string, Market> }) {
  // Build crop color mapping (consistent across pie and area chart)
  const cropColors = useMemo(() => {
    const colors: Record<string, string> = {};
    report.byCrop.forEach((c, i) => {
      colors[c.crop] = CROP_COLORS[i % CROP_COLORS.length];
    });
    return colors;
  }, [report.byCrop]);

  // Get ordered list of crops for stacked chart (by revenue)
  const orderedCrops = useMemo(() => {
    return report.byCrop.map(c => c.crop);
  }, [report.byCrop]);

  // Prepare pie chart data - top 8 crops + "Other"
  const pieData = useMemo(() => {
    const topCrops = report.byCrop.slice(0, 8);
    const otherCrops = report.byCrop.slice(8);
    const otherTotal = otherCrops.reduce((sum, c) => sum + c.totalRevenue, 0);

    const data = topCrops.map((c) => ({
      label: c.crop,
      value: c.totalRevenue,
      color: cropColors[c.crop],
    }));

    if (otherTotal > 0) {
      data.push({
        label: 'Other',
        value: otherTotal,
        color: '#9ca3af',
      });
    }

    return data;
  }, [report.byCrop, cropColors]);

  // Get sorted market list for consistent display order
  const activeMarkets = useMemo(() => getActiveMarkets(markets), [markets]);
  const hasMarketData = Object.keys(report.revenueByMarket).length > 0;

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500 mb-1">Total Revenue</div>
          <div className="text-3xl font-bold text-gray-900">
            {formatCurrency(report.totalRevenue)}
          </div>
          {/* Market breakdown */}
          {hasMarketData && activeMarkets.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
              {activeMarkets.map((market) => {
                const revenue = report.revenueByMarket[market.id] ?? 0;
                const percent = report.totalRevenue > 0 ? (revenue / report.totalRevenue) * 100 : 0;
                return (
                  <div key={market.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{market.name}</span>
                    <span className="text-gray-900 font-medium">
                      {formatCurrency(revenue)}
                      <span className="text-gray-400 text-xs ml-1">({percent.toFixed(0)}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500 mb-1">Plantings</div>
          <div className="text-3xl font-bold text-gray-900">
            {report.plantingCount}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500 mb-1">Crops</div>
          <div className="text-3xl font-bold text-gray-900">
            {report.byCrop.length}
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Crop */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue by Crop</h3>
          <div className="flex gap-6">
            <PieChart data={pieData} />
            <div className="flex-1 space-y-2">
              {pieData.map((d) => (
                <div key={d.label} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: d.color, opacity: 0.8 }}
                  />
                  <span className="text-sm text-gray-700 flex-1">{d.label}</span>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrency(d.value)}
                  </span>
                  <span className="text-xs text-gray-500 w-12 text-right">
                    {report.totalRevenue > 0
                      ? `${((d.value / report.totalRevenue) * 100).toFixed(1)}%`
                      : '0%'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Revenue Over Time */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue Over Time</h3>
          <StackedAreaChart
            data={report.byMonth}
            crops={orderedCrops}
            cropColors={cropColors}
          />
          {report.byMonth.length > 0 && (
            <div className="mt-4 flex justify-between text-sm text-gray-600">
              <span>
                Peak: {formatMonth(report.byMonth.reduce((max, d) => d.revenue > max.revenue ? d : max, report.byMonth[0]).month)}
                {' '}({formatCurrency(Math.max(...report.byMonth.map(d => d.revenue)))})
              </span>
              <span>
                Cumulative: {formatCurrency(report.byMonth[report.byMonth.length - 1]?.cumulative ?? 0)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Crops Table */}
      <CropRevenueTable data={report.byCrop} />
    </div>
  );
}

// =============================================================================
// CROP REVENUE TABLE (TanStack Table)
// =============================================================================

function CropRevenueTable({ data }: { data: CropRevenueResult[] }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'totalRevenue', desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState('');

  const columns = useMemo<ColumnDef<CropRevenueResult>[]>(
    () => [
      {
        accessorKey: 'crop',
        header: 'Crop',
        cell: info => <span className="font-medium">{info.getValue() as string}</span>,
      },
      {
        accessorKey: 'totalRevenue',
        header: 'Revenue',
        cell: info => formatCurrency(info.getValue() as number),
        meta: { align: 'right' },
      },
      {
        accessorKey: 'percentOfTotal',
        header: '% of Total',
        cell: info => `${(info.getValue() as number).toFixed(1)}%`,
        meta: { align: 'right' },
      },
      {
        accessorKey: 'totalBedFeet',
        header: 'Bed Feet',
        cell: info => (info.getValue() as number).toLocaleString(),
        meta: { align: 'right' },
      },
      {
        id: 'revenuePerFoot',
        header: '$/ft',
        accessorFn: row => row.totalBedFeet > 0 ? row.totalRevenue / row.totalBedFeet : 0,
        cell: info => {
          const value = info.getValue() as number;
          return value > 0 ? `$${value.toFixed(2)}` : '-';
        },
        meta: { align: 'right' },
      },
      {
        id: 'revenuePerDayPer100ft',
        header: '$/day/100ft',
        accessorFn: row => row.totalBedFootDays > 0 ? (row.totalRevenue / row.totalBedFootDays) * 100 : 0,
        cell: info => {
          const value = info.getValue() as number;
          return value > 0 ? `$${value.toFixed(2)}` : '-';
        },
        meta: { align: 'right' },
      },
      {
        accessorKey: 'plantingCount',
        header: 'Plantings',
        meta: { align: 'right' },
      },
    ],
    []
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Crops by Revenue</h3>
        <input
          type="text"
          value={globalFilter}
          onChange={e => setGlobalFilter(e.target.value)}
          placeholder="Filter crops..."
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id} className="border-b border-gray-200">
                {headerGroup.headers.map(header => {
                  const align = (header.column.columnDef.meta as { align?: string })?.align;
                  return (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className={`py-2 px-3 font-medium text-gray-600 cursor-pointer hover:bg-gray-50 select-none ${
                        align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{
                          asc: ' ↑',
                          desc: ' ↓',
                        }[header.column.getIsSorted() as string] ?? ''}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
                {row.getVisibleCells().map(cell => {
                  const align = (cell.column.columnDef.meta as { align?: string })?.align;
                  return (
                    <td
                      key={cell.id}
                      className={`py-2 px-3 ${align === 'right' ? 'text-right' : ''}`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-sm text-gray-500">
        {table.getFilteredRowModel().rows.length} crops
      </div>
    </div>
  );
}

// =============================================================================
// DENSITY EDIT MODAL
// =============================================================================

interface DensityEditModalProps {
  varietyId: string;
  varieties: Record<string, Variety>;
  onSave: (variety: Variety) => Promise<void>;
  onClose: () => void;
}

function DensityEditModal({ varietyId, varieties, onSave, onClose }: DensityEditModalProps) {
  const variety = varieties[varietyId];
  const [density, setDensity] = useState(variety?.density?.toString() ?? '');
  const [densityUnit, setDensityUnit] = useState<DensityUnit>(variety?.densityUnit ?? 'oz');
  const [saving, setSaving] = useState(false);

  if (!variety) {
    return null;
  }

  // Find similar varieties with density data
  const similarVarieties = useMemo(() => {
    const results: Array<{ variety: Variety; matchType: 'exact-name' | 'same-crop' }> = [];
    const seen = new Set<string>();

    for (const v of Object.values(varieties)) {
      if (v.id === varietyId) continue;
      if (v.density === undefined) continue;
      if (seen.has(v.id)) continue;

      // Same variety name, different supplier (highest priority)
      if (v.name.toLowerCase() === variety.name.toLowerCase()) {
        results.unshift({ variety: v, matchType: 'exact-name' });
        seen.add(v.id);
      }
      // Same crop (lower priority)
      else if (v.crop.toLowerCase() === variety.crop.toLowerCase()) {
        results.push({ variety: v, matchType: 'same-crop' });
        seen.add(v.id);
      }
    }

    // Sort: exact name matches first, then by crop
    results.sort((a, b) => {
      if (a.matchType === 'exact-name' && b.matchType !== 'exact-name') return -1;
      if (b.matchType === 'exact-name' && a.matchType !== 'exact-name') return 1;
      return a.variety.name.localeCompare(b.variety.name);
    });

    return results.slice(0, 10); // Limit to 10
  }, [varieties, varietyId, variety.name, variety.crop]);

  const handleSave = async () => {
    if (!density) return;
    setSaving(true);
    try {
      await onSave({
        ...variety,
        density: parseFloat(density),
        densityUnit,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const applyFromSimilar = (v: Variety) => {
    if (v.density !== undefined) {
      setDensity(v.density.toString());
    }
    if (v.densityUnit) {
      setDensityUnit(v.densityUnit);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Edit Density</h2>
          <p className="text-sm text-gray-600 mt-1">
            {variety.crop} &bull; {variety.name} &bull; {variety.supplier}
          </p>
        </div>

        {/* Form */}
        <div className="px-4 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Seeds per unit
              </label>
              <input
                type="number"
                value={density}
                onChange={e => setDensity(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., 6000"
                autoFocus
              />
            </div>
            <div className="w-24">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Unit
              </label>
              <select
                value={densityUnit}
                onChange={e => setDensityUnit(e.target.value as DensityUnit)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="oz">oz</option>
                <option value="g">g</option>
                <option value="lb">lb</option>
              </select>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Enter the number of seeds per {densityUnit}
          </p>
        </div>

        {/* Similar varieties */}
        <div className="flex-1 overflow-auto px-4 py-3">
          <h3 className="text-sm font-medium text-gray-700 mb-2">
            Similar varieties with density data
          </h3>
          {similarVarieties.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No similar varieties found with density data</p>
          ) : (
            <div className="space-y-1">
              {similarVarieties.map(({ variety: v, matchType }) => (
                <button
                  key={v.id}
                  onClick={() => applyFromSimilar(v)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-gray-100 transition-colors ${
                    matchType === 'exact-name' ? 'bg-green-50 border border-green-200' : 'bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">{v.name}</span>
                      <span className="text-gray-500"> &bull; {v.supplier}</span>
                      {matchType === 'exact-name' && (
                        <span className="ml-2 text-xs text-green-600 font-medium">Same variety</span>
                      )}
                    </div>
                    <span className="text-gray-600 font-mono text-xs">
                      {v.density?.toLocaleString()} / {v.densityUnit}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!density || saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SEEDS TAB CONTENT - Flat table with inline editing
// =============================================================================

/** Inline editable row for seed orders */
function SeedOrderRow({
  variety,
  savedOrder,
  onSave,
  onEditDensity,
  colWidths,
}: {
  variety: VarietySeedResult;
  savedOrder?: SeedOrder;
  onSave: (order: SeedOrder) => void;
  onEditDensity: (varietyId: string) => void;
  colWidths: Record<string, number>;
}) {
  // Local form state - initialize from saved order if exists, otherwise use defaults
  // "Have" fields - inventory on hand (defaults to grams for scale weighing)
  const [haveWeight, setHaveWeight] = useState(() =>
    savedOrder?.haveWeight ? String(savedOrder.haveWeight) : ''
  );
  const [haveUnit, setHaveUnit] = useState<ProductUnit>(() =>
    savedOrder?.haveUnit ?? DEFAULT_HAVE_UNIT
  );
  // "Order" fields - what to purchase (defaults to oz)
  const [weight, setWeight] = useState(() =>
    savedOrder?.productWeight ? String(savedOrder.productWeight) : ''
  );
  const [unit, setUnit] = useState<ProductUnit>(() =>
    savedOrder?.productUnit ?? DEFAULT_ORDER_UNIT
  );
  const [qty, setQty] = useState(() =>
    savedOrder?.quantity ? String(savedOrder.quantity) : '1'
  );
  const [cost, setCost] = useState(() =>
    savedOrder?.productCost ? String(savedOrder.productCost) : ''
  );

  // Save order with optional field overrides (for immediate save on select change)
  const saveOrder = (overrides?: { haveUnit?: ProductUnit; productUnit?: ProductUnit }) => {
    const effectiveHaveUnit = overrides?.haveUnit ?? haveUnit;
    const effectiveProductUnit = overrides?.productUnit ?? unit;
    const order = createSeedOrder({
      varietyId: variety.varietyId,
      haveWeight: haveWeight ? parseFloat(haveWeight) : undefined,
      haveUnit: haveWeight ? effectiveHaveUnit : undefined,
      productWeight: weight ? parseFloat(weight) : undefined,
      productUnit: effectiveProductUnit,
      productCost: cost ? parseFloat(cost) : undefined,
      quantity: qty ? parseInt(qty, 10) : 0,
      productLink: variety.order?.productLink ?? variety.website,
    });
    onSave(order);
  };

  // Calculate order totals
  const orderWeight = weight && qty ? parseFloat(weight) * parseInt(qty, 10) : 0;
  const orderCost = cost && qty ? parseFloat(cost) * parseInt(qty, 10) : 0;
  const haveWeightNum = haveWeight ? parseFloat(haveWeight) : 0;

  // Calculate "Total Need" in Order Unit (so Need and Order are in same unit)
  const totalNeedInOrderUnit = variety.weightNeeded && variety.weightUnit
    ? convertWeight(variety.weightNeeded, variety.weightUnit, unit)
    : undefined;

  // Calculate "Have" in Order Unit for Order Need calculation
  const haveInOrderUnit = haveWeightNum > 0 ? convertWeight(haveWeightNum, haveUnit, unit) : 0;

  // Calculate "Order Need" = Total Need - Have (what you still need to order)
  const orderNeed = totalNeedInOrderUnit !== undefined
    ? Math.max(0, totalNeedInOrderUnit - haveInOrderUnit)
    : undefined;

  // Status badge - compare (have + order) to total need
  const getStatusBadge = () => {
    if (totalNeedInOrderUnit === undefined) {
      const hasAnyData = haveWeightNum > 0 || orderWeight > 0;
      if (!hasAnyData) {
        return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">-</span>;
      }
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">?</span>;
    }

    const totalCoverage = haveInOrderUnit + orderWeight;

    if (totalCoverage === 0) {
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">-</span>;
    }

    const pct = Math.round((totalCoverage / totalNeedInOrderUnit) * 100);

    if (pct >= 100) {
      // Green: have + order covers need
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">{pct}%</span>;
    } else {
      // Yellow: still short
      return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">{pct}%</span>;
    }
  };

  const statusBadge = getStatusBadge();

  // Helper to get cell style with width
  const cellStyle = (colKey: string) => ({
    width: colWidths[colKey],
    minWidth: colWidths[colKey],
  });

  return (
    <div className="flex border-b border-gray-100 hover:bg-gray-50/50 text-sm">
      {/* Crop */}
      <div style={cellStyle('crop')} className="py-1.5 px-2 text-gray-900 whitespace-nowrap truncate flex items-center">
        {variety.crop}
      </div>
      {/* Variety */}
      <div style={cellStyle('variety')} className="py-1.5 px-2 flex items-center gap-1">
        <span className="font-medium text-gray-900 truncate">{variety.varietyName}</span>
        {variety.website && (
          <a
            href={variety.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-700 text-xs flex-shrink-0"
            title="Product page"
          >
            ↗
          </a>
        )}
      </div>
      {/* Supplier */}
      <div style={cellStyle('supplier')} className="py-1.5 px-2 text-gray-600 whitespace-nowrap truncate flex items-center">
        {variety.supplier}
      </div>
      {/* Organic */}
      <div style={cellStyle('organic')} className="py-1.5 px-2 text-center flex items-center justify-center">
        {variety.organic ? <span className="text-green-600">✓</span> : <span className="text-gray-300">-</span>}
      </div>
      {/* Seeds Needed */}
      <div style={cellStyle('seedsNeeded')} className="py-1.5 px-2 text-right text-gray-700 whitespace-nowrap flex items-center justify-end">
        {formatSeeds(variety.seedsNeeded)}
      </div>
      {/* Total Need - displayed in Order Unit */}
      <div style={cellStyle('weightNeeded')} className="py-1.5 px-2 text-right whitespace-nowrap flex items-center justify-end">
        {totalNeedInOrderUnit !== undefined ? (
          <span className="text-gray-600">{totalNeedInOrderUnit.toFixed(2)} {unit}</span>
        ) : (
          <button
            onClick={() => onEditDensity(variety.varietyId)}
            className="text-orange-500 hover:text-orange-700 hover:underline cursor-pointer text-xs font-medium"
            title="Click to add density data for this variety"
          >
            No density
          </button>
        )}
      </div>
      {/* Have weight input */}
      <div style={cellStyle('inStock')} className="py-1.5 px-1 flex items-center">
        <input
          type="number"
          step="any"
          value={haveWeight}
          onChange={e => setHaveWeight(e.target.value)}
          onBlur={() => saveOrder()}
          className="w-full px-1.5 py-0.5 text-sm border border-blue-200 rounded text-right focus:border-blue-400 focus:ring-1 focus:ring-blue-200 bg-blue-50/30"
          placeholder="-"
          title="Amount already in inventory"
        />
      </div>
      {/* Have unit select */}
      <div style={cellStyle('stockUnit')} className="py-1.5 px-1 flex items-center">
        <select
          value={haveUnit}
          onChange={e => {
            const newUnit = e.target.value as ProductUnit;
            setHaveUnit(newUnit);
            saveOrder({ haveUnit: newUnit });
          }}
          className="w-full px-0.5 py-0.5 text-sm border border-blue-200 rounded focus:border-blue-400 focus:ring-1 focus:ring-blue-200 bg-blue-50/30"
          title="Unit for inventory amount"
        >
          <option value="g">g</option>
          <option value="oz">oz</option>
          <option value="lb">lb</option>
          <option value="ct">ct</option>
        </select>
      </div>
      {/* Order Need = Total Need - Have (in order unit) */}
      <div style={cellStyle('additionalNeeded')} className="py-1.5 px-2 text-right text-gray-600 whitespace-nowrap flex items-center justify-end">
        {orderNeed !== undefined
          ? `${orderNeed.toFixed(2)} ${unit}`
          : <span className="text-gray-300">-</span>}
      </div>
      {/* Order weight input */}
      <div style={cellStyle('productWeight')} className="py-1.5 px-1 flex items-center">
        <input
          type="number"
          step="any"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          onBlur={() => saveOrder()}
          className="w-full px-1.5 py-0.5 text-sm border border-gray-200 rounded text-right focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
          placeholder="-"
        />
      </div>
      {/* Order unit select */}
      <div style={cellStyle('productUnit')} className="py-1.5 px-1 flex items-center">
        <select
          value={unit}
          onChange={e => {
            const newUnit = e.target.value as ProductUnit;
            setUnit(newUnit);
            saveOrder({ productUnit: newUnit });
          }}
          className="w-full px-0.5 py-0.5 text-sm border border-gray-200 rounded focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
        >
          <option value="oz">oz</option>
          <option value="g">g</option>
          <option value="lb">lb</option>
          <option value="ct">ct</option>
        </select>
      </div>
      {/* Qty input */}
      <div style={cellStyle('productQty')} className="py-1.5 px-1 flex items-center">
        <input
          type="number"
          min="0"
          value={qty}
          onChange={e => setQty(e.target.value)}
          onBlur={() => saveOrder()}
          className="w-full px-1 py-0.5 text-sm border border-gray-200 rounded text-right focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
          placeholder="1"
        />
      </div>
      {/* Cost input */}
      <div style={cellStyle('productPrice')} className="py-1.5 px-1 flex items-center">
        <span className="text-gray-400 text-sm mr-0.5">$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={cost}
          onChange={e => setCost(e.target.value)}
          onBlur={() => saveOrder()}
          className="w-full px-1.5 py-0.5 text-sm border border-gray-200 rounded text-right focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
          placeholder="-"
        />
      </div>
      {/* Order Total (weight * qty) */}
      <div style={cellStyle('orderWeight')} className="py-1.5 px-2 text-right text-gray-700 whitespace-nowrap flex items-center justify-end">
        {orderWeight > 0 ? `${orderWeight} ${unit}` : <span className="text-gray-300">-</span>}
      </div>
      {/* Order Cost (cost * qty) */}
      <div style={cellStyle('orderCost')} className="py-1.5 px-2 text-right text-gray-700 whitespace-nowrap flex items-center justify-end">
        {orderCost > 0 ? `$${orderCost.toFixed(2)}` : <span className="text-gray-300">-</span>}
      </div>
      {/* Status */}
      <div style={cellStyle('status')} className="py-1.5 px-2 text-center flex items-center justify-center">
        {statusBadge}
      </div>
    </div>
  );
}

// Default column widths in pixels
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  crop: 80,
  variety: 140,
  supplier: 100,
  organic: 50,
  seedsNeeded: 80,
  weightNeeded: 80,
  inStock: 60,
  stockUnit: 50,
  additionalNeeded: 80,
  productWeight: 70,
  productUnit: 50,
  productQty: 50,
  productPrice: 70,
  orderWeight: 80,
  orderCost: 80,
  status: 55,
};

// Column order for iteration
const COL_ORDER = [
  'crop', 'variety', 'supplier', 'organic', 'seedsNeeded', 'weightNeeded',
  'inStock', 'stockUnit', 'additionalNeeded', 'productWeight', 'productUnit',
  'productQty', 'productPrice', 'orderWeight', 'orderCost', 'status',
];

// localStorage key for persisting column widths
const SEEDS_TAB_STORAGE_KEY = 'seeds-tab-state';

interface SeedsTabPersistedState {
  colWidths: Record<string, number>;
}

function loadSeedsTabState(): SeedsTabPersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(SEEDS_TAB_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return null;
}

function saveSeedsTabState(state: SeedsTabPersistedState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SEEDS_TAB_STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

function SeedsTab({ report, planId }: { report: PlanSeedReport; planId: string }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [filterCrop, setFilterCrop] = useState<string>('');
  const [filterMissingDensity, setFilterMissingDensity] = useState(false);
  const [sortKey, setSortKey] = useState<'crop' | 'variety' | 'supplier' | 'needed'>('crop');
  const [sortDesc, setSortDesc] = useState(false);

  // Column widths state - start with defaults, hydrate from localStorage
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
  const [resizing, setResizing] = useState<string | null>(null);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);

  // Container ref for measuring available width
  const containerRef = useRef<HTMLDivElement>(null);

  // Store hooks for updating orders
  const upsertSeedOrder = usePlanStore((state) => state.upsertSeedOrder);
  const seedOrders = usePlanStore((state) => state.currentPlan?.seedOrders ?? {});
  const varieties = usePlanStore((state) => state.currentPlan?.varieties ?? {});
  const updateVariety = usePlanStore((state) => state.updateVariety);

  // Density edit modal state
  const [editingVarietyId, setEditingVarietyId] = useState<string | null>(null);

  // Calculate missing density info
  const missingDensityVarieties = useMemo(() => {
    return report.byVariety.filter(v => v.weightNeeded === undefined);
  }, [report.byVariety]);

  // Load persisted state on mount
  useEffect(() => {
    const saved = loadSeedsTabState();
    if (saved?.colWidths) {
      setColWidths(saved.colWidths);
    }
  }, []);

  // Save column widths when they change (debounced via resizing check)
  useEffect(() => {
    // Only save after resize ends (resizing is null)
    if (resizing === null) {
      saveSeedsTabState({ colWidths });
    }
  }, [colWidths, resizing]);

  // Reset columns to fill available width proportionally
  const resetColumnWidths = useCallback(() => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const defaultTotal = Object.values(DEFAULT_COL_WIDTHS).reduce((s, w) => s + w, 0);
    const scale = containerWidth / defaultTotal;

    const newWidths: Record<string, number> = {};
    for (const col of COL_ORDER) {
      newWidths[col] = Math.max(40, Math.round(DEFAULT_COL_WIDTHS[col] * scale));
    }
    setColWidths(newWidths);
  }, []);

  // Handle column resize
  const handleMouseDown = (colKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent click from triggering sort
    setResizing(colKey);
    setStartX(e.clientX);
    setStartWidth(colWidths[colKey] || 80);
  };

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(40, startWidth + delta); // minimum 40px
      setColWidths(prev => ({ ...prev, [resizing]: newWidth }));
    };

    const handleMouseUp = () => {
      setResizing(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, startX, startWidth]);

  // Resizable header component - uses div like SpecExplorer
  const ResizableHeader = ({
    colKey,
    children,
    className = '',
    sortable,
    sortKeyName,
  }: {
    colKey: string;
    children: React.ReactNode;
    className?: string;
    sortable?: boolean;
    sortKeyName?: typeof sortKey;
  }) => (
    <div
      style={{ width: colWidths[colKey], minWidth: colWidths[colKey] }}
      className={`relative py-2 px-2 text-xs font-medium text-gray-600 select-none flex items-center ${className} ${
        sortable ? 'cursor-pointer hover:text-gray-900' : ''
      }`}
      onClick={sortable && sortKeyName ? () => handleSort(sortKeyName) : undefined}
    >
      <span className="truncate">{children}</span>
      {sortable && sortKeyName && sortKey === sortKeyName && (
        <span className="ml-1 flex-shrink-0">{sortDesc ? '↓' : '↑'}</span>
      )}
      <div
        onMouseDown={(e) => handleMouseDown(colKey, e)}
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-400"
        style={{ marginRight: -1 }}
      />
    </div>
  );

  // Get unique values for filters
  const uniqueSuppliers = useMemo(() => {
    const suppliers = new Set(report.byVariety.map(v => v.supplier));
    return Array.from(suppliers).sort();
  }, [report.byVariety]);

  const uniqueCrops = useMemo(() => {
    const crops = new Set(report.byVariety.map(v => v.crop));
    return Array.from(crops).sort();
  }, [report.byVariety]);

  // Filter and sort data
  const filteredData = useMemo(() => {
    let result = report.byVariety;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(v =>
        v.varietyName.toLowerCase().includes(q) ||
        v.crop.toLowerCase().includes(q) ||
        v.supplier.toLowerCase().includes(q)
      );
    }

    if (filterSupplier) {
      result = result.filter(v => v.supplier === filterSupplier);
    }

    if (filterCrop) {
      result = result.filter(v => v.crop === filterCrop);
    }

    if (filterMissingDensity) {
      result = result.filter(v => v.weightNeeded === undefined);
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'crop':
          cmp = a.crop.localeCompare(b.crop) || a.varietyName.localeCompare(b.varietyName);
          break;
        case 'variety':
          cmp = a.varietyName.localeCompare(b.varietyName);
          break;
        case 'supplier':
          cmp = a.supplier.localeCompare(b.supplier) || a.crop.localeCompare(b.crop);
          break;
        case 'needed':
          cmp = (b.seedsNeeded ?? 0) - (a.seedsNeeded ?? 0);
          break;
      }
      return sortDesc ? -cmp : cmp;
    });

    return result;
  }, [report.byVariety, searchQuery, filterSupplier, filterCrop, filterMissingDensity, sortKey, sortDesc]);

  const hasFilters = searchQuery || filterSupplier || filterCrop || filterMissingDensity;

  const clearFilters = () => {
    setSearchQuery('');
    setFilterSupplier('');
    setFilterCrop('');
    setFilterMissingDensity(false);
  };

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(false);
    }
  };

  // Calculate total width from all columns
  // Used to ensure table expands when columns are widened
  const totalWidth = useMemo(() => {
    return Object.values(colWidths).reduce((sum, w) => sum + w, 0);
  }, [colWidths]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 flex items-center gap-2 flex-wrap text-sm">
        <span className="font-medium text-gray-700">
          {filteredData.length} / {report.byVariety.length}
        </span>

        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search..."
          className="px-2 py-1 border rounded text-sm w-32"
        />

        <select
          value={filterSupplier}
          onChange={e => setFilterSupplier(e.target.value)}
          className="px-2 py-1 border rounded text-sm"
        >
          <option value="">All Suppliers</option>
          {uniqueSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={filterCrop}
          onChange={e => setFilterCrop(e.target.value)}
          className="px-2 py-1 border rounded text-sm"
        >
          <option value="">All Crops</option>
          {uniqueCrops.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-700">
            Clear
          </button>
        )}

        <div className="flex-1" />

        {/* Warning indicators - clickable toggles */}
        <div className="flex items-center gap-2">
          {/* Missing density filter toggle */}
          {missingDensityVarieties.length > 0 && (
            <button
              onClick={() => setFilterMissingDensity(!filterMissingDensity)}
              className={`px-2 py-1 text-xs font-medium rounded border flex items-center gap-1 ${
                filterMissingDensity
                  ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
                  : 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
              }`}
              title={filterMissingDensity ? 'Show all varieties' : 'Show only varieties missing density'}
            >
              ⚠ {missingDensityVarieties.length} missing density
            </button>
          )}

          {/* Unassigned plantings - links to timeline with filter */}
          {report.plantingsWithoutSeed > 0 && (
            <Link
              href={`/timeline/${planId}?filter=no-variety`}
              className="px-2 py-1 text-xs font-medium rounded border bg-orange-50 text-orange-700 border-orange-300 hover:bg-orange-100 flex items-center gap-1"
              title="Click to view unassigned plantings in Timeline"
            >
              ⚠ {report.plantingsWithoutSeed} unassigned
            </Link>
          )}
        </div>

        <button
          onClick={resetColumnWidths}
          className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-300 rounded hover:bg-gray-50"
          title="Reset column widths to fill available space"
        >
          Reset Columns
        </button>
      </div>

      {/* Table with internal scroll */}
      <div
        ref={containerRef}
        className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col max-h-[600px]"
      >
        {filteredData.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {report.byVariety.length === 0
              ? 'No seed sources assigned to plantings yet.'
              : 'No varieties match the current filters.'}
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            {/* Header - sticky */}
            <div className="sticky top-0 z-10 flex bg-gray-50 border-b border-gray-200" style={{ width: totalWidth }}>
              <ResizableHeader colKey="crop" sortable sortKeyName="crop">Crop</ResizableHeader>
              <ResizableHeader colKey="variety" sortable sortKeyName="variety">Variety</ResizableHeader>
              <ResizableHeader colKey="supplier" sortable sortKeyName="supplier">Supplier</ResizableHeader>
              <ResizableHeader colKey="organic" className="justify-center">Organic</ResizableHeader>
              <ResizableHeader colKey="seedsNeeded" sortable sortKeyName="needed" className="justify-end">Seeds Needed</ResizableHeader>
              <ResizableHeader colKey="weightNeeded" className="justify-end">Weight Needed</ResizableHeader>
              {/* Inventory columns - blue tint */}
              <ResizableHeader colKey="inStock" className="justify-center text-blue-700 bg-blue-50/50">In Stock</ResizableHeader>
              <ResizableHeader colKey="stockUnit" className="justify-center text-blue-700 bg-blue-50/50">Stock Unit</ResizableHeader>
              {/* Additional needed */}
              <ResizableHeader colKey="additionalNeeded" className="justify-end">Additional Needed</ResizableHeader>
              {/* Product/order input columns */}
              <ResizableHeader colKey="productWeight" className="justify-center">Product Weight</ResizableHeader>
              <ResizableHeader colKey="productUnit" className="justify-center">Product Unit</ResizableHeader>
              <ResizableHeader colKey="productQty" className="justify-center">Product Qty</ResizableHeader>
              <ResizableHeader colKey="productPrice" className="justify-center">Product Price</ResizableHeader>
              <ResizableHeader colKey="orderWeight" className="justify-end">Order Weight</ResizableHeader>
              <ResizableHeader colKey="orderCost" className="justify-end">Order Cost</ResizableHeader>
              <ResizableHeader colKey="status" className="justify-center">Status</ResizableHeader>
            </div>
            {/* Body */}
            <div style={{ width: totalWidth }}>
              {filteredData.map(v => (
                <SeedOrderRow
                  key={v.varietyId}
                  variety={v}
                  savedOrder={seedOrders[`SO_${v.varietyId}`]}
                  onSave={upsertSeedOrder}
                  onEditDensity={setEditingVarietyId}
                  colWidths={colWidths}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Resize overlay - captures mouse events during column resize */}
      {resizing && (
        <div
          className="fixed inset-0 cursor-col-resize"
          style={{ zIndex: Z_INDEX.RESIZE_OVERLAY }}
        />
      )}

      {/* Density Edit Modal */}
      {editingVarietyId && (
        <DensityEditModal
          varietyId={editingVarietyId}
          varieties={varieties}
          onSave={updateVariety}
          onClose={() => setEditingVarietyId(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// PRODUCTION TAB
// =============================================================================

interface ProductionTabProps {
  report: PlanProductionReport;
  initialProduct?: string;
  globalFilter: string;
  planYear: number;
  planId: string;
  markets: Record<string, Market>;
}

function ProductionTab({ report, initialProduct, globalFilter, planYear, planId, markets }: ProductionTabProps) {
  const [expandedProductId, setExpandedProductId] = useState<string | null>(() => {
    // Initialize from URL param if it matches a valid product
    if (initialProduct && report.byProduct.some(p => p.productId === initialProduct)) {
      return initialProduct;
    }
    return null;
  });
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'totalYield', desc: true },
  ]);

  // Planting selection for inspector panel
  const selectedPlantingIds = useUIStore((state) => state.selectedPlantingIds);
  const selectPlanting = useUIStore((state) => state.selectPlanting);

  // Table columns - each row is a product (crop + product type)
  const columns = useMemo<ColumnDef<ProductProductionSummary>[]>(
    () => [
      {
        id: 'expand',
        header: '',
        cell: ({ row }) => (
          <span className="text-gray-400">
            {expandedProductId === row.original.productId ? '▼' : '▶'}
          </span>
        ),
        size: 30,
      },
      {
        accessorKey: 'crop',
        header: 'Crop',
        cell: info => <span className="font-medium">{info.getValue() as string}</span>,
      },
      {
        accessorKey: 'productName',
        header: 'Product',
        cell: info => <span className="text-gray-700">{info.getValue() as string}</span>,
      },
      {
        accessorKey: 'totalYield',
        header: 'Total Yield',
        cell: ({ row }) => formatYield(row.original.totalYield, row.original.unit),
        meta: { align: 'right' },
      },
      {
        accessorKey: 'yieldPerFoot',
        header: 'Yield/ft',
        cell: ({ row }) => {
          const value = row.original.yieldPerFoot;
          return value > 0
            ? `${value.toFixed(2)} ${row.original.unit}`
            : <span className="text-gray-300">-</span>;
        },
        meta: { align: 'right' },
      },
      {
        accessorKey: 'maxYieldPerWeek',
        header: 'Max/Wk',
        cell: ({ row }) => {
          const value = row.original.maxYieldPerWeek;
          return value > 0
            ? `${value.toFixed(1)} ${row.original.unit}`
            : <span className="text-gray-300">-</span>;
        },
        meta: { align: 'right' },
      },
      {
        accessorKey: 'totalBedFeet',
        header: 'Bed Feet',
        cell: info => (info.getValue() as number).toLocaleString(),
        meta: { align: 'right' },
      },
      {
        accessorKey: 'plantingCount',
        header: 'Plantings',
        meta: { align: 'right' },
      },
    ],
    [expandedProductId]
  );

  const table = useReactTable({
    data: report.byProduct,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const colCount = columns.length;

  // Get selected product for chart
  const selectedProduct = expandedProductId
    ? report.byProduct.find(p => p.productId === expandedProductId)
    : null;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {/* Harvest Chart - shows when a product is selected */}
      {selectedProduct && (
        <div className="flex-shrink-0">
          <ProductionChart
            key={`${selectedProduct.productId}-${selectedProduct.totalYield}-${selectedProduct.totalBedFeet}`}
            harvestEvents={selectedProduct.harvestEvents}
            plantings={selectedProduct.plantings}
            unit={selectedProduct.unit}
            planYear={planYear}
            planId={planId}
            productName={selectedProduct.productName}
            cropName={selectedProduct.crop}
            markets={markets}
          />
        </div>
      )}

      {/* Products Table */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex-1 min-h-0 flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-gray-200">
                  {headerGroup.headers.map((header) => {
                    const align = (header.column.columnDef.meta as { align?: string })?.align;
                    const isExpandCol = header.id === 'expand';
                    return (
                      <th
                        key={header.id}
                        onClick={isExpandCol ? undefined : header.column.getToggleSortingHandler()}
                        className={`py-2 px-3 font-medium text-gray-600 select-none bg-white ${
                          isExpandCol ? 'w-8' : 'cursor-pointer hover:bg-gray-50'
                        } ${align === 'right' ? 'text-right' : 'text-left'}`}
                      >
                        <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {!isExpandCol && {
                            asc: ' ↑',
                            desc: ' ↓',
                          }[header.column.getIsSorted() as string]}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const isExpanded = expandedProductId === row.original.productId;
                return (
                  <Fragment key={row.id}>
                    {/* Product row */}
                    <tr
                      onClick={() => setExpandedProductId(isExpanded ? null : row.original.productId)}
                      className={`border-b border-gray-100 cursor-pointer ${
                        isExpanded ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const align = (cell.column.columnDef.meta as { align?: string })?.align;
                        return (
                          <td
                            key={cell.id}
                            className={`py-2 px-3 ${align === 'right' ? 'text-right' : ''}`}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                    {/* Expanded plantings */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={colCount} className="bg-gray-50 p-0">
                          <div className="p-4">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-gray-500">
                                  <th className="py-1 px-2 text-left font-medium">Planting ID</th>
                                  <th className="py-1 px-2 text-left font-medium">Bed</th>
                                  <th className="py-1 px-2 text-right font-medium">Yield</th>
                                  <th className="py-1 px-2 text-left font-medium">Field Date</th>
                                  <th className="py-1 px-2 text-left font-medium">Harvest Start</th>
                                  <th className="py-1 px-2 text-left font-medium">Harvest End</th>
                                  <th className="py-1 px-2 text-right font-medium">Feet</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.original.plantings.map((p) => (
                                  <tr
                                    key={p.plantingId}
                                    className={`border-t border-gray-200 cursor-pointer hover:bg-blue-50 ${
                                      selectedPlantingIds.has(p.plantingId) ? 'bg-blue-100' : ''
                                    }`}
                                    onClick={() => selectPlanting(p.plantingId)}
                                  >
                                    <td className="py-1.5 px-2 font-medium text-gray-900">{p.plantingId}</td>
                                    <td className="py-1.5 px-2 text-gray-600">{p.bedName || '-'}</td>
                                    <td className="py-1.5 px-2 text-right text-gray-900">{formatYield(p.totalYield, row.original.unit)}</td>
                                    <td className="py-1.5 px-2 text-gray-600">{formatDate(p.fieldStartDate)}</td>
                                    <td className="py-1.5 px-2 text-gray-600">{formatDate(p.harvestStartDate)}</td>
                                    <td className="py-1.5 px-2 text-gray-600">{formatDate(p.harvestEndDate)}</td>
                                    <td className="py-1.5 px-2 text-right text-gray-600">{p.bedFeet}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-sm text-gray-500">
          {table.getFilteredRowModel().rows.length} products
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function ReportsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const planId = params.planId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'seeds' || tabParam === 'production') return tabParam;
    return 'revenue';
  });
  const [productionFilter, setProductionFilter] = useState('');

  // Update tab when URL changes
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'seeds' || tabParam === 'revenue' || tabParam === 'production') {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Plan store state
  const currentPlan = usePlanStore((state) => state.currentPlan);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);

  // Selection state for inspector panel
  const hasSelection = useUIStore((state) => state.selectedPlantingIds.size > 0);

  // Load the specific plan by ID
  useEffect(() => {
    async function loadPlan() {
      if (!planId) {
        setError('No plan ID provided');
        setLoading(false);
        return;
      }

      try {
        // Check if plan is already loaded in store
        if (currentPlan?.id === planId) {
          setLoading(false);
          return;
        }

        // Try to load from library
        const loaded = await loadPlanFromLibrary(planId);
        if (loaded) {
          loadPlanById(planId);
          setLoading(false);
        } else {
          setError(`Plan "${planId}" not found`);
          setLoading(false);
        }
      } catch (err) {
        console.error('Error loading plan:', err);
        setError('Failed to load plan');
        setLoading(false);
      }
    }

    loadPlan();
  }, [planId, currentPlan?.id, loadPlanById]);

  // Get GDD-adjusted timeline crops - single source of truth for dates
  const { crops: timelineCrops } = useComputedCrops();

  // Calculate reports when plan is loaded
  const revenueReport = useMemo(() => {
    if (!currentPlan) return null;
    return calculatePlanRevenue(currentPlan);
  }, [currentPlan]);

  const seedReport = useMemo(() => {
    if (!currentPlan) return null;
    return calculatePlanSeeds(currentPlan);
  }, [currentPlan]);

  // Production uses TimelineCrop[] directly - dates are authoritative from timeline
  const productionReport = useMemo(() => {
    if (!currentPlan) return null;
    return calculatePlanProduction(timelineCrops, currentPlan);
  }, [timelineCrops, currentPlan]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">Loading plan...</div>
      </div>
    );
  }

  if (error || !currentPlan) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-sm p-8 max-w-md">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Error</h1>
          <p className="text-gray-600 mb-4">{error || 'Plan not found'}</p>
          <Link
            href="/plans"
            className="text-blue-600 hover:text-blue-800"
          >
            ← Back to Plans
          </Link>
        </div>
      </div>
    );
  }

  // Toolbar with tabs
  const toolbar = (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          {/* Tabs */}
          <div className="flex gap-4 -mb-px">
            <button
              onClick={() => setActiveTab('revenue')}
              className={`py-3 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'revenue'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Revenue
            </button>
            <button
              onClick={() => setActiveTab('seeds')}
              className={`py-3 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'seeds'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Seeds
            </button>
            <button
              onClick={() => setActiveTab('production')}
              className={`py-3 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'production'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Production
            </button>
          </div>
          {/* Filter (production tab only) */}
          {activeTab === 'production' && (
            <input
              type="text"
              value={productionFilter}
              onChange={(e) => setProductionFilter(e.target.value)}
              placeholder="Filter..."
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>
      </div>
    </div>
  );

  return (
    <PageLayout
      header={<AppHeader />}
      toolbar={toolbar}
      contentClassName="bg-gray-100"
      rightPanel={
        activeTab === 'production' && hasSelection ? (
          <ConnectedPlantingInspector
            className="w-80 bg-white border-l flex flex-col shrink-0"
            showTimingEdits={false}
          />
        ) : undefined
      }
    >
      <div className="h-full flex flex-col max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {activeTab === 'revenue' && revenueReport && (
          <RevenueTab report={revenueReport} markets={currentPlan.markets ?? {}} />
        )}
        {activeTab === 'seeds' && seedReport && (
          <SeedsTab report={seedReport} planId={planId} />
        )}
        {activeTab === 'production' && productionReport && (
          <ProductionTab
            report={productionReport}
            initialProduct={searchParams.get('product') ?? undefined}
            globalFilter={productionFilter}
            planYear={currentPlan.metadata.year}
            planId={planId}
            markets={currentPlan.markets ?? {}}
          />
        )}
      </div>
    </PageLayout>
  );
}
