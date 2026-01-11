'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
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
  type PlanSeedReport,
  type SupplierSeedResult,
} from '@/lib/seeds';

// =============================================================================
// TAB TYPES
// =============================================================================

type ReportTab = 'revenue' | 'seeds';

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
// SEEDS TAB CONTENT
// =============================================================================

function SeedsTab({ report }: { report: PlanSeedReport }) {
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(
    () => new Set(report.bySupplier.map(s => s.supplier)) // All expanded by default
  );

  const toggleSupplier = (supplier: string) => {
    setExpandedSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(supplier)) {
        next.delete(supplier);
      } else {
        next.add(supplier);
      }
      return next;
    });
  };

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500 mb-1">Total Seeds</div>
          <div className="text-3xl font-bold text-gray-900">
            {formatSeeds(report.totalSeeds)}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500 mb-1">Varieties</div>
          <div className="text-3xl font-bold text-gray-900">
            {report.varietyCount}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500 mb-1">Suppliers</div>
          <div className="text-3xl font-bold text-gray-900">
            {report.supplierCount}
          </div>
        </div>
        <div className={`bg-white rounded-lg border p-6 ${
          report.plantingsWithoutSeed > 0
            ? 'border-orange-300 bg-orange-50'
            : 'border-gray-200'
        }`}>
          <div className="text-sm font-medium text-gray-500 mb-1">Unassigned</div>
          <div className={`text-3xl font-bold ${
            report.plantingsWithoutSeed > 0 ? 'text-orange-600' : 'text-gray-900'
          }`}>
            {report.plantingsWithoutSeed}
          </div>
          {report.plantingsWithoutSeed > 0 && (
            <div className="text-xs text-orange-600 mt-1">
              plantings without seed source
            </div>
          )}
        </div>
      </div>

      {/* Supplier Sections */}
      <div className="space-y-4">
        {report.bySupplier.map(supplier => (
          <div
            key={supplier.supplier}
            className="bg-white rounded-lg border border-gray-200 overflow-hidden"
          >
            {/* Supplier Header */}
            <button
              onClick={() => toggleSupplier(supplier.supplier)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <span className="text-lg font-semibold text-gray-900">
                  {supplier.supplier}
                </span>
                <span className="text-sm text-gray-500">
                  {supplier.varieties.length} varieties
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-gray-700">
                  {formatSeeds(supplier.totalSeeds)} seeds
                </span>
                {supplier.totalOunces !== undefined && (
                  <span className="text-sm text-gray-500">
                    ({formatOunces(supplier.totalOunces)})
                  </span>
                )}
                <span className="text-gray-400">
                  {expandedSuppliers.has(supplier.supplier) ? '▼' : '▶'}
                </span>
              </div>
            </button>

            {/* Varieties Table */}
            {expandedSuppliers.has(supplier.supplier) && (
              <div className="border-t border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-2 px-4 text-left font-medium text-gray-600">Crop</th>
                      <th className="py-2 px-4 text-left font-medium text-gray-600">Variety</th>
                      <th className="py-2 px-4 text-right font-medium text-gray-600">Seeds</th>
                      <th className="py-2 px-4 text-right font-medium text-gray-600">Weight</th>
                      <th className="py-2 px-4 text-center font-medium text-gray-600">Organic</th>
                      <th className="py-2 px-4 text-center font-medium text-gray-600">Have</th>
                      <th className="py-2 px-4 text-right font-medium text-gray-600">Plantings</th>
                      <th className="py-2 px-4 text-left font-medium text-gray-600">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supplier.varieties.map(v => (
                      <tr key={v.varietyId} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-4 text-gray-900">{v.crop}</td>
                        <td className="py-2 px-4 font-medium text-gray-900">{v.varietyName}</td>
                        <td className="py-2 px-4 text-right text-gray-900">
                          {v.seedsNeeded.toLocaleString()}
                        </td>
                        <td className="py-2 px-4 text-right text-gray-600">
                          {v.ouncesNeeded !== undefined ? formatOunces(v.ouncesNeeded) : '-'}
                        </td>
                        <td className="py-2 px-4 text-center">
                          {v.organic ? (
                            <span className="text-green-600">✓</span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        <td className="py-2 px-4 text-center">
                          {v.alreadyOwn ? (
                            <span className="text-blue-600">✓</span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        <td className="py-2 px-4 text-right text-gray-600">
                          {v.plantingCount}
                        </td>
                        <td className="py-2 px-4">
                          {v.website ? (
                            <a
                              href={v.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              Order →
                            </a>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}

        {report.bySupplier.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500">No seed sources assigned to plantings yet.</p>
            <p className="text-sm text-gray-400 mt-2">
              Assign varieties or seed mixes to plantings in the timeline view.
            </p>
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
  const planId = params.planId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>('revenue');

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
