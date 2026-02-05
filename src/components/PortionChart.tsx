'use client';

import { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import type { PortionHarvestEvent } from '@/lib/portion-report';

export interface PortionChartProps {
  crop: string;
  productName: string;
  unit: string;
  maxPortionsPerWeek: number;
  targetPortions?: number;
  portionSize: number;
  harvestEvents: PortionHarvestEvent[];
  harvestStartDate: string | null;
  harvestEndDate: string | null;
  planYear: number;
  width?: number;
  height?: number;
  /** Product ID for deep linking */
  productId?: string;
  /** Callback when user wants to dive into production details */
  onDiveInto?: (productId: string) => void;
}

interface PlantingRange {
  plantingId: string;
  startDoy: number;
  endDoy: number;
  portionsPerWeek: number;
}

/** Get day of year (1-365) from ISO date string */
function getDayOfYear(dateStr: string): number {
  const date = new Date(dateStr + 'T00:00:00');
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/** Format day of year as month abbreviation */
function formatDoy(doy: number): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Approximate month from day of year
  const monthIndex = Math.min(11, Math.floor((doy - 1) / 30.44));
  return months[monthIndex];
}

export function PortionChart({
  crop,
  productName,
  maxPortionsPerWeek,
  targetPortions,
  portionSize,
  harvestEvents,
  unit,
  width = 200,
  height = 140,
  productId,
  onDiveInto,
}: PortionChartProps) {
  // Group events by planting to calculate per-planting ranges
  const plantingRanges = useMemo((): PlantingRange[] => {
    if (harvestEvents.length === 0) return [];

    // Group events by planting
    const byPlanting = new Map<string, { dates: string[]; totalPortions: number }>();
    for (const event of harvestEvents) {
      const existing = byPlanting.get(event.plantingId);
      if (existing) {
        existing.dates.push(event.date);
        existing.totalPortions += event.portions;
      } else {
        byPlanting.set(event.plantingId, {
          dates: [event.date],
          totalPortions: event.portions,
        });
      }
    }

    // Convert to ranges with portions per week
    const ranges: PlantingRange[] = [];
    for (const [plantingId, data] of byPlanting) {
      const sortedDates = data.dates.sort();
      const startDoy = getDayOfYear(sortedDates[0]);
      const endDoy = getDayOfYear(sortedDates[sortedDates.length - 1]);
      const daysSpan = Math.max(1, endDoy - startDoy + 1);
      const portionsPerWeek = (data.totalPortions / daysSpan) * 7;

      ranges.push({ plantingId, startDoy, endDoy, portionsPerWeek });
    }

    return ranges;
  }, [harvestEvents]);

  // Calculate weekly capacity at each day of year (stepped line data)
  const chartData = useMemo(() => {
    if (plantingRanges.length === 0) return [];

    // Get overall range
    const minDoy = Math.min(...plantingRanges.map(r => r.startDoy));
    const maxDoy = Math.max(...plantingRanges.map(r => r.endDoy));

    // Build data points - sample weekly
    const data: { doy: number; capacity: number }[] = [];
    for (let doy = minDoy; doy <= maxDoy; doy += 7) {
      // Sum capacity from all plantings active on this day
      let capacity = 0;
      for (const range of plantingRanges) {
        if (doy >= range.startDoy && doy <= range.endDoy) {
          capacity += range.portionsPerWeek;
        }
      }
      data.push({ doy, capacity });
    }

    // Add final point
    const lastDoy = maxDoy;
    let finalCapacity = 0;
    for (const range of plantingRanges) {
      if (lastDoy >= range.startDoy && lastDoy <= range.endDoy) {
        finalCapacity += range.portionsPerWeek;
      }
    }
    if (data.length === 0 || data[data.length - 1].doy !== lastDoy) {
      data.push({ doy: lastDoy, capacity: finalCapacity });
    }

    return data;
  }, [plantingRanges]);

  // Determine color based on max vs target
  const meetsTarget = !targetPortions || maxPortionsPerWeek >= targetPortions;
  const lineColor = meetsTarget ? '#22c55e' : '#f59e0b';

  // Handle empty data
  if (chartData.length === 0) {
    return (
      <div
        className="bg-white border border-gray-200 rounded-lg p-2 flex flex-col"
        style={{ width, height }}
      >
        <div className="text-xs font-medium text-gray-700 truncate" title={`${crop} - ${productName}`}>
          {crop} - {productName}
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-400 text-xs">
          No harvest data
        </div>
        <div className="text-[10px] text-gray-400 text-center">
          {portionSize} {unit} portions
        </div>
      </div>
    );
  }

  const maxCapacity = Math.max(...chartData.map(d => d.capacity));
  // Y-axis is 2x the target (if target exists), otherwise 1.2x the max capacity
  const yAxisMax = targetPortions && targetPortions > 0
    ? Math.ceil(targetPortions * 2)
    : Math.ceil(maxCapacity * 1.2);

  return (
    <div
      className="bg-white border border-gray-200 rounded-lg p-2 flex flex-col"
      style={{ width, height }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="text-xs font-medium text-gray-700 truncate flex-1" title={`${crop} - ${productName}`}>
          {crop} - {productName}
        </div>
        {onDiveInto && productId && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDiveInto(productId);
            }}
            className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600"
            title="View in Production Report"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
          >
            <XAxis
              dataKey="doy"
              tick={{ fontSize: 9, fill: '#9ca3af' }}
              tickFormatter={formatDoy}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, yAxisMax]}
              tick={{ fontSize: 8, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              width={28}
              tickFormatter={(v) => Math.round(v).toString()}
            />
            <Tooltip
              formatter={(value) => [`${Math.round(value as number ?? 0)} portions/wk`, 'Capacity']}
              labelFormatter={(doy) => formatDoy(doy as number)}
              contentStyle={{ fontSize: 11, padding: '4px 8px' }}
              isAnimationActive={false}
            />
            {/* Target reference line */}
            {targetPortions !== undefined && targetPortions > 0 && (
              <ReferenceLine
                y={targetPortions}
                stroke="#ef4444"
                strokeDasharray="4 2"
                strokeWidth={1.5}
              />
            )}
            {/* Capacity line (stepped) */}
            <Line
              type="stepAfter"
              dataKey="capacity"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between items-center text-[10px] text-gray-500">
        <span>{Math.round(maxPortionsPerWeek)} max/wk</span>
        <span>{portionSize} {unit}</span>
      </div>
    </div>
  );
}

export default PortionChart;
