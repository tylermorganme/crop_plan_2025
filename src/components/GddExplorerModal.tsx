'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  CartesianGrid,
} from 'recharts';
import type { PlantingSpec } from '@/lib/entities/planting-specs';
import { calculateDaysInCells, calculateProductSeedToHarvest } from '@/lib/entities/planting-specs';
import type { TemperatureHistory } from '@/lib/gdd';
import { calculateDailyGdd, NON_FIELD_STRUCTURE_OFFSET } from '@/lib/gdd';
import { Z_INDEX } from '@/lib/z-index';

// =============================================================================
// TYPES
// =============================================================================

interface GddExplorerModalProps {
  spec: PlantingSpec;
  products: Record<string, { product: string }>;
  baseTemp: number;
  upperTemp?: number;
  growingStructure?: 'field' | 'greenhouse' | 'high-tunnel';
  tempData: TemperatureHistory;
  planYear: number;
  onClose: () => void;
}

interface ChartDataPoint {
  dayOfYear: number;
  dateLabel: string;
  month: number;
  [key: string]: number | string; // Product DTMs stored by productId
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Test dates: 1st, 7th, 14th, 21st, 28th of each month
const TEST_DAYS = [1, 7, 14, 21, 28];

// Colors for product lines
const PRODUCT_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f97316', // orange
  '#8b5cf6', // violet
  '#ef4444', // red
  '#14b8a6', // teal
];

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Calculate the average GDD per day-of-year from historical data.
 * Returns a map from dayOfYear (1-366) to average GDD for that day.
 */
function buildAverageDailyGdd(
  tempData: TemperatureHistory,
  baseTemp: number,
  upperTemp?: number,
  structureOffset: number = 0
): Map<number, number> {
  // Group temperatures by day-of-year
  const byDayOfYear = new Map<number, number[]>();

  for (const day of tempData.daily) {
    const date = new Date(day.date + 'T00:00:00');
    const doy = getDayOfYear(date);
    const gdd = calculateDailyGdd(day.tmax, day.tmin, baseTemp, upperTemp, structureOffset);

    if (!byDayOfYear.has(doy)) {
      byDayOfYear.set(doy, []);
    }
    byDayOfYear.get(doy)!.push(gdd);
  }

  // Calculate averages
  const avgGdd = new Map<number, number>();
  for (const [doy, values] of byDayOfYear) {
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    avgGdd.set(doy, avg);
  }

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
 * Calculate how many days from a given start day-of-year to accumulate target GDD.
 * Uses average GDD per day-of-year.
 */
function daysToAccumulateGdd(
  startDoy: number,
  targetGdd: number,
  avgGddByDay: Map<number, number>,
  maxDays: number = 365
): number {
  let accumulated = 0;
  let days = 0;

  while (accumulated < targetGdd && days < maxDays) {
    const doy = ((startDoy + days - 1) % 365) + 1; // Wrap around year
    const dailyGdd = avgGddByDay.get(doy) ?? 10; // Fallback to ~10 GDD/day
    accumulated += dailyGdd;
    days++;
  }

  // Interpolate fractional day to avoid step discontinuities
  // When we exit, 'days' full days were added but we may have overshot targetGdd
  if (days > 0 && accumulated > targetGdd) {
    const lastDoy = ((startDoy + days - 2) % 365) + 1;
    const lastDayGdd = avgGddByDay.get(lastDoy) ?? 10;
    if (lastDayGdd > 0) {
      const overshoot = accumulated - targetGdd;
      return days - (overshoot / lastDayGdd);
    }
  }

  return days;
}

/**
 * Calculate reference GDD for a product's FIELD TIME only.
 *
 * The reference GDD is calculated from the targetFieldDate (when the plant
 * enters the field) for the specified number of field days.
 * Greenhouse time is fixed and doesn't accumulate outdoor GDD.
 *
 * @param fieldDays - Days the plant spends in the field (from field entry to first harvest)
 * @param targetFieldDate - Field entry date (MM-DD format) - when plant goes into the field
 * @param avgGddByDay - Average GDD per day-of-year
 * @param planYear - Plan year for date calculations
 */
function calculateReferenceFieldGdd(
  fieldDays: number,
  targetFieldDate: string | undefined,
  avgGddByDay: Map<number, number>,
  planYear: number
): number {
  // Parse targetFieldDate (MM-DD) - this IS the field entry date
  let fieldEntryDoy: number;
  if (targetFieldDate) {
    const [month, day] = targetFieldDate.split('-').map(Number);
    const date = new Date(planYear, month - 1, day);
    fieldEntryDoy = getDayOfYear(date);
  } else {
    // Default to April 15
    fieldEntryDoy = getDayOfYear(new Date(planYear, 3, 15));
  }

  // Accumulate GDD for field days (starting from field entry date)
  let totalGdd = 0;
  for (let i = 0; i < fieldDays; i++) {
    const doy = ((fieldEntryDoy + i - 1) % 365) + 1;
    totalGdd += avgGddByDay.get(doy) ?? 10;
  }

  return totalGdd;
}

// =============================================================================
// COMPONENT
// =============================================================================

export default function GddExplorerModal({
  spec,
  products,
  baseTemp,
  upperTemp,
  growingStructure,
  tempData,
  planYear,
  onClose,
}: GddExplorerModalProps) {

  // Track hovered data point for field span visualization
  const [hoveredPoint, setHoveredPoint] = useState<ChartDataPoint | null>(null);
  const tooltipDataRef = useRef<ChartDataPoint | null>(null);

  // Sync tooltip active data to hoveredPoint state
  useEffect(() => {
    const interval = setInterval(() => {
      if (tooltipDataRef.current !== hoveredPoint) {
        setHoveredPoint(tooltipDataRef.current);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [hoveredPoint]);

  // HACK: Flat +20°F offset for non-field structures
  const structureOffset = growingStructure && growingStructure !== 'field'
    ? NON_FIELD_STRUCTURE_OFFSET
    : 0;

  // Pre-compute average GDD by day-of-year (with ceiling and structure offset)
  const avgGddByDay = useMemo(
    () => buildAverageDailyGdd(tempData, baseTemp, upperTemp, structureOffset),
    [tempData, baseTemp, upperTemp, structureOffset]
  );

  // Get products from the spec
  const productYields = spec.productYields ?? [];

  // Calculate days in cells (greenhouse time) - fixed, not GDD-adjusted
  const daysInCells = useMemo(() => calculateDaysInCells(spec), [spec]);

  // Calculate chart data
  // X-axis = field start date (when plant enters the field)
  // Y-axis = field days until harvest
  const chartData = useMemo(() => {
    const data: ChartDataPoint[] = [];

    // For each test date across the year (this is the FIELD START date)
    for (let month = 1; month <= 12; month++) {
      for (const day of TEST_DAYS) {
        // Skip invalid dates (e.g., Feb 30)
        const date = new Date(planYear, month - 1, day);
        if (date.getMonth() !== month - 1) continue;

        const fieldStartDoy = getDayOfYear(date);
        const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        const point: ChartDataPoint = {
          dayOfYear: fieldStartDoy,
          dateLabel,
          month,
        };

        // Calculate adjusted field days for each product
        for (const py of productYields) {
          // Use the calibrated seedToHarvest calculation (accounts for dtmBasis × plantingMethod)
          const seedToHarvest = calculateProductSeedToHarvest(py, spec, daysInCells);
          // Field days = seedToHarvest minus greenhouse time
          const baseFieldDays = seedToHarvest - daysInCells;

          // Reference GDD = heat units accumulated during the original field period
          // Starting from targetFieldDate (when plant enters field)
          const referenceGdd = calculateReferenceFieldGdd(
            baseFieldDays,
            spec.targetFieldDate,
            avgGddByDay,
            planYear
          );

          // How many field days to accumulate that reference GDD starting from this field start date?
          const adjustedFieldDays = daysToAccumulateGdd(fieldStartDoy, referenceGdd, avgGddByDay);

          // Store values for chart and tooltip
          point[`${py.productId}_field`] = adjustedFieldDays;
          point[`${py.productId}_baseField`] = baseFieldDays;
          point[`${py.productId}_refGdd`] = Math.round(referenceGdd);
        }

        data.push(point);
      }
    }

    return data;
  }, [productYields, spec, daysInCells, avgGddByDay, planYear]);

  // Calculate Y-axis domain for field days
  const yDomain = useMemo(() => {
    let min = Infinity;
    let max = 0;
    for (const point of chartData) {
      for (const py of productYields) {
        const val = point[`${py.productId}_field`] as number;
        if (val !== undefined) {
          min = Math.min(min, val);
          max = Math.max(max, val);
        }
      }
    }
    // Add some padding
    const padding = Math.ceil((max - min) * 0.1);
    return [Math.max(0, Math.floor(min - padding)), Math.ceil(max + padding)];
  }, [chartData, productYields]);

  // Compute growing span for hover highlight
  // X-axis represents field start dates - the hovered day IS when the plant enters the field
  const fieldSpan = useMemo(() => {
    if (!hoveredPoint || productYields.length === 0) return null;

    const py = productYields[0];
    const adjustedFieldDays = hoveredPoint[`${py.productId}_field`] as number;
    if (!adjustedFieldDays || isNaN(adjustedFieldDays)) return null;

    // The hovered dayOfYear IS the field entry date
    const fieldStartDoy = hoveredPoint.dayOfYear;
    const harvestDoy = fieldStartDoy + Math.round(adjustedFieldDays);

    return harvestDoy <= 365
      ? { x1: fieldStartDoy, x2: harvestDoy, wrap: null }
      : { x1: fieldStartDoy, x2: 365, wrap: { x1: 1, x2: harvestDoy - 365 } };
  }, [hoveredPoint, productYields]);

  // Get product name helper
  const getProductName = (productId: string): string => {
    return products[productId]?.product ?? productId;
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: Z_INDEX.MODAL }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              GDD Explorer: {spec.cropName ?? spec.crop}
            </h2>
            <p className="text-sm text-gray-500">
              Field days by field start date
              (base: {baseTemp}°F{upperTemp ? `, ceiling: ${upperTemp}°F` : ''})
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Structure offset warning */}
        {structureOffset > 0 && (
          <div className="mx-6 mt-4 text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
            <strong>⚠️ Structure offset applied (+{structureOffset}°F)</strong>
            <p className="mt-1 text-xs">
              This is a HACK: Adding flat +20°F to temps for non-field structures.
              In reality, tunnel temps vary by season and management. This rough
              approximation helps account for spring tunnels being warmer than
              outdoor weather data shows.
            </p>
          </div>
        )}

        {/* Chart */}
        <div className="flex-1 p-6 min-h-0">
          {productYields.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400">
              No products configured for this spec
            </div>
          ) : (
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 20, right: 30, bottom: 20, left: 40 }}
                  onMouseLeave={() => setHoveredPoint(null)}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  {/* Field span highlight on hover */}
                  {fieldSpan && (
                    <ReferenceArea
                      x1={fieldSpan.x1}
                      x2={fieldSpan.x2}
                      fill={PRODUCT_COLORS[0]}
                      fillOpacity={0.2}
                    />
                  )}
                  {fieldSpan?.wrap && (
                    <ReferenceArea
                      x1={fieldSpan.wrap.x1}
                      x2={fieldSpan.wrap.x2}
                      fill={PRODUCT_COLORS[0]}
                      fillOpacity={0.2}
                    />
                  )}
                  {/* Month boundaries */}
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => {
                    const doy = getDayOfYear(new Date(planYear, month - 1, 1));
                    return (
                      <ReferenceLine
                        key={`month-${month}`}
                        x={doy}
                        stroke="#d1d5db"
                        strokeDasharray="3 3"
                      />
                    );
                  })}
                  {/* Target field date reference line */}
                  {spec.targetFieldDate && (() => {
                    const [month, day] = spec.targetFieldDate.split('-').map(Number);
                    const targetDoy = getDayOfYear(new Date(planYear, month - 1, day));
                    return (
                      <ReferenceLine
                        x={targetDoy}
                        stroke="#059669"
                        strokeWidth={2}
                        label={{
                          value: `Target: ${spec.targetFieldDate}`,
                          position: 'top',
                          fill: '#059669',
                          fontSize: 11,
                        }}
                      />
                    );
                  })()}
                  <XAxis
                    dataKey="dayOfYear"
                    type="number"
                    domain={[1, 365]}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(doy) => {
                      const date = new Date(planYear, 0, doy);
                      return date.toLocaleDateString('en-US', { month: 'short' });
                    }}
                    ticks={[15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349]} // Mid-month
                  />
                  <YAxis
                    domain={yDomain}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(val) => `${val}d`}
                    label={{
                      value: 'Field Days',
                      angle: -90,
                      position: 'insideLeft',
                      style: { textAnchor: 'middle', fontSize: 12, fill: '#6b7280' },
                    }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) {
                        tooltipDataRef.current = null;
                        return null;
                      }
                      const data = payload[0].payload as ChartDataPoint;
                      tooltipDataRef.current = data;
                      return (
                        <div className="bg-white border border-gray-200 rounded shadow-lg p-3 text-sm">
                          <div className="font-semibold mb-2">{data.dateLabel} (field start)</div>
                          {productYields.map((py, i) => {
                            const fieldDays = data[`${py.productId}_field`] as number;
                            const baseFieldDays = data[`${py.productId}_baseField`] as number;
                            const refGdd = data[`${py.productId}_refGdd`] as number;
                            return (
                              <div key={py.productId} className="flex items-center gap-2">
                                <span
                                  className="w-3 h-3 rounded-sm"
                                  style={{ backgroundColor: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }}
                                />
                                <span className="text-gray-600">{getProductName(py.productId)}:</span>
                                <span className="font-medium">
                                  {typeof fieldDays === 'number' ? fieldDays.toFixed(1) : fieldDays}d
                                </span>
                                <span className="text-gray-400 text-xs">
                                  (base: {baseFieldDays}d = {refGdd} GDD)
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }}
                  />
                  {/* Product lines */}
                  {productYields.map((py, i) => (
                    <Line
                      key={py.productId}
                      type="monotone"
                      dataKey={`${py.productId}_field`}
                      stroke={PRODUCT_COLORS[i % PRODUCT_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5 }}
                      name={getProductName(py.productId)}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Legend */}
        {productYields.length > 0 && (
          <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
            <div className="flex flex-wrap gap-4">
              {productYields.map((py, i) => {
                // Use same calculation as chart for consistency
                const seedToHarvest = calculateProductSeedToHarvest(py, spec, daysInCells);
                const baseFieldDays = seedToHarvest - daysInCells;
                const refGdd = Math.round(calculateReferenceFieldGdd(
                  baseFieldDays,
                  spec.targetFieldDate,
                  avgGddByDay,
                  planYear
                ));
                return (
                  <div key={py.productId} className="flex items-center gap-2 text-sm">
                    <span
                      className="w-4 h-1 rounded"
                      style={{ backgroundColor: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }}
                    />
                    <span className="text-gray-700">{getProductName(py.productId)}</span>
                    <span className="text-gray-400">
                      (base: {baseFieldDays}d = {refGdd} GDD)
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              GDD-adjusted field days based on {tempData.daily.length.toLocaleString()} days of historical temperature data.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
