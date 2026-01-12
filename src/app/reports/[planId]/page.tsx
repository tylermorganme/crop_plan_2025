'use client';

import { useState, useEffect, useMemo } from 'react';
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
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
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
import { Z_INDEX } from '@/lib/z-index';

// =============================================================================
// TAB TYPES
// =============================================================================

type ReportTab = 'revenue' | 'seeds';

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

function RevenueTab({ report }: { report: PlanRevenueReport }) {
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

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500 mb-1">Total Revenue</div>
          <div className="text-3xl font-bold text-gray-900">
            {formatCurrency(report.totalRevenue)}
          </div>
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
// SEEDS TAB CONTENT - Flat table with inline editing
// =============================================================================

/** Inline editable row for seed orders */
function SeedOrderRow({
  variety,
  savedOrder,
  onSave,
}: {
  variety: VarietySeedResult;
  savedOrder?: SeedOrder;
  onSave: (order: SeedOrder) => void;
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

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/50">
      {/* Crop */}
      <td className="py-1.5 px-2 text-gray-900 whitespace-nowrap">{variety.crop}</td>
      {/* Variety */}
      <td className="py-1.5 px-2">
        <div className="flex items-center gap-1">
          <span className="font-medium text-gray-900">{variety.varietyName}</span>
          {variety.website && (
            <a
              href={variety.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-700 text-xs"
              title="Product page"
            >
              ↗
            </a>
          )}
        </div>
      </td>
      {/* Supplier */}
      <td className="py-1.5 px-2 text-gray-600 whitespace-nowrap">{variety.supplier}</td>
      {/* Organic */}
      <td className="py-1.5 px-2 text-center">
        {variety.organic ? <span className="text-green-600">✓</span> : <span className="text-gray-300">-</span>}
      </td>
      {/* Seeds Needed */}
      <td className="py-1.5 px-2 text-right text-gray-700 whitespace-nowrap">
        {formatSeeds(variety.seedsNeeded)}
      </td>
      {/* Total Need - displayed in Order Unit */}
      <td className="py-1.5 px-2 text-right text-gray-600 whitespace-nowrap">
        {totalNeedInOrderUnit !== undefined
          ? `${totalNeedInOrderUnit.toFixed(2)} ${unit}`
          : <span className="text-gray-300">-</span>}
      </td>
      {/* Have weight input */}
      <td className="py-1.5 px-1">
        <input
          type="number"
          step="any"
          value={haveWeight}
          onChange={e => setHaveWeight(e.target.value)}
          onBlur={() => saveOrder()}
          className="w-14 px-1.5 py-0.5 text-sm border border-blue-200 rounded text-right focus:border-blue-400 focus:ring-1 focus:ring-blue-200 bg-blue-50/30"
          placeholder="-"
          title="Amount already in inventory"
        />
      </td>
      {/* Have unit select */}
      <td className="py-1.5 px-1">
        <select
          value={haveUnit}
          onChange={e => {
            const newUnit = e.target.value as ProductUnit;
            setHaveUnit(newUnit);
            saveOrder({ haveUnit: newUnit });
          }}
          className="w-12 px-0.5 py-0.5 text-sm border border-blue-200 rounded focus:border-blue-400 focus:ring-1 focus:ring-blue-200 bg-blue-50/30"
          title="Unit for inventory amount"
        >
          <option value="g">g</option>
          <option value="oz">oz</option>
          <option value="lb">lb</option>
          <option value="ct">ct</option>
        </select>
      </td>
      {/* Order Need = Total Need - Have (in order unit) */}
      <td className="py-1.5 px-2 text-right text-gray-600 whitespace-nowrap">
        {orderNeed !== undefined
          ? `${orderNeed.toFixed(2)} ${unit}`
          : <span className="text-gray-300">-</span>}
      </td>
      {/* Order weight input */}
      <td className="py-1.5 px-1">
        <input
          type="number"
          step="any"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          onBlur={() => saveOrder()}
          className="w-14 px-1.5 py-0.5 text-sm border border-gray-200 rounded text-right focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
          placeholder="-"
        />
      </td>
      {/* Order unit select */}
      <td className="py-1.5 px-1">
        <select
          value={unit}
          onChange={e => {
            const newUnit = e.target.value as ProductUnit;
            setUnit(newUnit);
            saveOrder({ productUnit: newUnit });
          }}
          className="w-12 px-0.5 py-0.5 text-sm border border-gray-200 rounded focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
        >
          <option value="oz">oz</option>
          <option value="g">g</option>
          <option value="lb">lb</option>
          <option value="ct">ct</option>
        </select>
      </td>
      {/* Qty input */}
      <td className="py-1.5 px-1">
        <input
          type="number"
          min="0"
          value={qty}
          onChange={e => setQty(e.target.value)}
          onBlur={() => saveOrder()}
          className="w-10 px-1 py-0.5 text-sm border border-gray-200 rounded text-right focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
          placeholder="1"
        />
      </td>
      {/* Cost input */}
      <td className="py-1.5 px-1">
        <div className="flex items-center">
          <span className="text-gray-400 text-sm mr-0.5">$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={cost}
            onChange={e => setCost(e.target.value)}
            onBlur={() => saveOrder()}
            className="w-14 px-1.5 py-0.5 text-sm border border-gray-200 rounded text-right focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            placeholder="-"
          />
        </div>
      </td>
      {/* Order Total (weight * qty) */}
      <td className="py-1.5 px-2 text-right text-gray-700 whitespace-nowrap">
        {orderWeight > 0 ? `${orderWeight} ${unit}` : <span className="text-gray-300">-</span>}
      </td>
      {/* Order Cost (cost * qty) */}
      <td className="py-1.5 px-2 text-right text-gray-700 whitespace-nowrap">
        {orderCost > 0 ? `$${orderCost.toFixed(2)}` : <span className="text-gray-300">-</span>}
      </td>
      {/* Status */}
      <td className="py-1.5 px-2 text-center">{statusBadge}</td>
    </tr>
  );
}

function SeedsTab({ report }: { report: PlanSeedReport }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [filterCrop, setFilterCrop] = useState<string>('');
  const [sortKey, setSortKey] = useState<'crop' | 'variety' | 'supplier' | 'needed'>('crop');
  const [sortDesc, setSortDesc] = useState(false);

  // Store hooks for updating orders
  const upsertSeedOrder = usePlanStore((state) => state.upsertSeedOrder);
  const seedOrders = usePlanStore((state) => state.currentPlan?.seedOrders ?? {});

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
  }, [report.byVariety, searchQuery, filterSupplier, filterCrop, sortKey, sortDesc]);

  const hasFilters = searchQuery || filterSupplier || filterCrop;

  const clearFilters = () => {
    setSearchQuery('');
    setFilterSupplier('');
    setFilterCrop('');
  };

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(false);
    }
  };

  const SortHeader = ({ k, children, className = '' }: { k: typeof sortKey; children: React.ReactNode; className?: string }) => (
    <th
      onClick={() => handleSort(k)}
      className={`py-2 px-2 font-medium text-gray-600 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap ${className}`}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        {sortKey === k && (sortDesc ? ' ↓' : ' ↑')}
      </span>
    </th>
  );

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

        {report.plantingsWithoutSeed > 0 && (
          <span className="text-orange-600 font-medium">
            ⚠ {report.plantingsWithoutSeed} unassigned
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {filteredData.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {report.byVariety.length === 0
              ? 'No seed sources assigned to plantings yet.'
              : 'No varieties match the current filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <SortHeader k="crop" className="text-left">Crop</SortHeader>
                  <SortHeader k="variety" className="text-left">Variety</SortHeader>
                  <SortHeader k="supplier" className="text-left">Supplier</SortHeader>
                  <th className="py-2 px-2 font-medium text-gray-600 text-center whitespace-nowrap">Org</th>
                  <SortHeader k="needed" className="text-right">Seeds</SortHeader>
                  <th className="py-2 px-2 font-medium text-gray-600 text-right whitespace-nowrap" title="Total amount needed (in order unit)">Total Need</th>
                  {/* Inventory (Have) columns - blue tint */}
                  <th className="py-2 px-1 font-medium text-blue-700 text-center whitespace-nowrap bg-blue-50/50" title="Inventory on hand">Have</th>
                  <th className="py-2 px-1 font-medium text-blue-700 text-center whitespace-nowrap bg-blue-50/50">Unit</th>
                  {/* Order Need = Total Need - Have */}
                  <th className="py-2 px-2 font-medium text-gray-600 text-right whitespace-nowrap" title="Amount still needed to order (Total Need - Have)">Order Need</th>
                  {/* Order input columns */}
                  <th className="py-2 px-1 font-medium text-gray-600 text-center whitespace-nowrap" title="Product weight per unit">Wt</th>
                  <th className="py-2 px-1 font-medium text-gray-600 text-center whitespace-nowrap">Unit</th>
                  <th className="py-2 px-1 font-medium text-gray-600 text-center whitespace-nowrap">Qty</th>
                  <th className="py-2 px-1 font-medium text-gray-600 text-center whitespace-nowrap">$/ea</th>
                  <th className="py-2 px-2 font-medium text-gray-600 text-right whitespace-nowrap" title="Order Weight × Qty">Order Amt</th>
                  <th className="py-2 px-2 font-medium text-gray-600 text-right whitespace-nowrap" title="Order Cost × Qty">Cost</th>
                  <th className="py-2 px-2 font-medium text-gray-600 text-center whitespace-nowrap" title="(Have + Order) / Total Need">%</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map(v => (
                  <SeedOrderRow
                    key={v.varietyId}
                    variety={v}
                    savedOrder={seedOrders[`SO_${v.varietyId}`]}
                    onSave={upsertSeedOrder}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
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
    return tabParam === 'seeds' ? 'seeds' : 'revenue';
  });

  // Update tab when URL changes
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'seeds' || tabParam === 'revenue') {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Plan store state
  const currentPlan = usePlanStore((state) => state.currentPlan);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);

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

  // Calculate reports when plan is loaded
  const revenueReport = useMemo(() => {
    if (!currentPlan) return null;
    return calculatePlanRevenue(currentPlan);
  }, [currentPlan]);

  const seedReport = useMemo(() => {
    if (!currentPlan) return null;
    return calculatePlanSeeds(currentPlan);
  }, [currentPlan]);

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

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                href={`/timeline/${planId}`}
                className="text-gray-600 hover:text-gray-900"
              >
                ← Timeline
              </Link>
              <h1 className="text-xl font-semibold text-gray-900">
                Reports: {currentPlan.metadata.name}
              </h1>
            </div>
          </div>

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
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'revenue' && revenueReport && (
          <RevenueTab report={revenueReport} />
        )}
        {activeTab === 'seeds' && seedReport && (
          <SeedsTab report={seedReport} />
        )}
      </main>
    </div>
  );
}
