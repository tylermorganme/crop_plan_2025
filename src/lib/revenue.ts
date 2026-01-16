/**
 * Revenue Calculation Module
 *
 * Calculates revenue from plantings based on:
 * - Product yields (from CropConfig.productYields)
 * - Product prices (from Product.directPrice/wholesalePrice)
 * - Planting bed feet
 *
 * Supports aggregation by crop, month, and total.
 */

import type { Plan } from './plan-types';
import type { Planting } from './entities/planting';
import type { CropConfig, ProductYield } from './entities/crop-config';
import type { Product } from './entities/product';
import { evaluateYieldFormula, buildYieldContext, calculateFieldOccupationDays } from './entities/crop-config';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Standard bed length for revenue and yield comparisons (feet) */
export const STANDARD_BED_LENGTH = 50;

// =============================================================================
// HARVEST WINDOW HELPERS
// =============================================================================

/**
 * Calculate how many days of a date range fall within a given month.
 */
function daysInMonth(startDate: Date, endDate: Date, year: number, month: number): number {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0); // Last day of month

  // No overlap if range is entirely before or after month
  if (endDate < monthStart || startDate > monthEnd) {
    return 0;
  }

  // Calculate overlap
  const overlapStart = startDate > monthStart ? startDate : monthStart;
  const overlapEnd = endDate < monthEnd ? endDate : monthEnd;

  return Math.max(0, Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

/**
 * Distribute revenue across months based on a harvest window.
 * Returns a map of month (YYYY-MM) to revenue amount.
 */
function distributeRevenueAcrossWindow(
  revenue: number,
  harvestStart: Date,
  harvestEnd: Date
): Map<string, number> {
  const result = new Map<string, number>();

  // Calculate total days in harvest window
  const totalDays = Math.max(1, Math.floor((harvestEnd.getTime() - harvestStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  // Iterate through each month in the range
  let year = harvestStart.getFullYear();
  let month = harvestStart.getMonth();
  const endYear = harvestEnd.getFullYear();
  const endMonth = harvestEnd.getMonth();

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const days = daysInMonth(harvestStart, harvestEnd, year, month);
    if (days > 0) {
      const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
      const monthRevenue = (days / totalDays) * revenue;
      result.set(monthKey, monthRevenue);
    }

    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }

  return result;
}

// =============================================================================
// TYPES
// =============================================================================

/** Revenue breakdown for a single product yield */
export interface ProductRevenueResult {
  productId: string;
  productName: string;
  unit: string;
  yield: number;
  price: number;
  revenue: number;
}

/** Revenue breakdown for a single planting */
export interface PlantingRevenueResult {
  plantingId: string;
  configId: string;
  crop: string;
  bedFeet: number;
  /** Days this planting occupies the field */
  daysInField: number;
  products: ProductRevenueResult[];
  totalRevenue: number;
  /** First harvest date (ISO string) */
  harvestStartDate: string | null;
}

/** Revenue aggregated by crop */
export interface CropRevenueResult {
  crop: string;
  totalRevenue: number;
  totalBedFeet: number;
  /** Total bed-foot-days (bedFeet × daysInField for each planting) */
  totalBedFootDays: number;
  plantingCount: number;
  /** Percentage of total plan revenue */
  percentOfTotal: number;
}

/** Revenue aggregated by month */
export interface MonthlyRevenueResult {
  /** Month in format YYYY-MM */
  month: string;
  revenue: number;
  /** Cumulative revenue up to and including this month */
  cumulative: number;
  /** Revenue breakdown by crop for this month */
  byCrop: Record<string, number>;
}

/** Complete revenue report for a plan */
export interface PlanRevenueReport {
  totalRevenue: number;
  plantingCount: number;
  byCrop: CropRevenueResult[];
  byMonth: MonthlyRevenueResult[];
  plantings: PlantingRevenueResult[];
}

// =============================================================================
// REVENUE CALCULATION FUNCTIONS
// =============================================================================

/**
 * Calculate revenue for a single ProductYield.
 *
 * @param py - The ProductYield to calculate
 * @param config - The CropConfig (for spacing/rows context)
 * @param bedFeet - The planting's bed feet
 * @param product - The Product entity (for pricing)
 * @returns Revenue result or null if can't calculate
 */
export function calculateProductYieldRevenue(
  py: ProductYield,
  config: CropConfig,
  bedFeet: number,
  product: Product | undefined
): ProductRevenueResult | null {
  if (!py.yieldFormula || !product) {
    return null;
  }

  // Build context for formula evaluation
  // Use the ProductYield's harvests, not the legacy config harvests
  const context = buildYieldContext(config, bedFeet);
  // Override harvests with this ProductYield's value
  context.harvests = py.numberOfHarvests ?? 1;
  context.daysBetweenHarvest = py.daysBetweenHarvest ?? 7;

  const result = evaluateYieldFormula(py.yieldFormula, context);
  if (result.value === null) {
    return null;
  }

  const price = product.directPrice ?? 0;
  const revenue = result.value * price;

  return {
    productId: py.productId,
    productName: product.product,
    unit: product.unit,
    yield: result.value,
    price,
    revenue,
  };
}

/**
 * Calculate total revenue for a CropConfig at a given bed length.
 *
 * This is the core revenue calculation used by both:
 * - CropExplorer (with STANDARD_BED_LENGTH for comparison)
 * - Planting reports (with actual planting.bedFeet)
 *
 * @param config - The CropConfig to calculate
 * @param bedFeet - Bed length in feet
 * @param products - Product catalog for pricing lookup
 * @returns Total revenue, or null if no valid product yields
 */
export function calculateConfigRevenue(
  config: CropConfig,
  bedFeet: number,
  products: Record<string, Product>
): number | null {
  if (!config.productYields?.length) {
    return null;
  }

  let totalRevenue = 0;
  let hasValidProduct = false;

  for (const py of config.productYields) {
    const product = products[py.productId];
    const result = calculateProductYieldRevenue(py, config, bedFeet, product);
    if (result) {
      totalRevenue += result.revenue;
      hasValidProduct = true;
    }
  }

  return hasValidProduct ? totalRevenue : null;
}

/**
 * Calculate total revenue for a planting across all its products.
 *
 * @param planting - The planting to calculate
 * @param config - The CropConfig for this planting
 * @param products - All products (to look up pricing)
 * @returns Revenue result for the planting
 */
export function calculatePlantingRevenue(
  planting: Planting,
  config: CropConfig,
  products: Record<string, Product>
): PlantingRevenueResult {
  const productResults: ProductRevenueResult[] = [];

  // Calculate revenue for each ProductYield
  for (const py of config.productYields ?? []) {
    const product = products[py.productId];
    const result = calculateProductYieldRevenue(py, config, planting.bedFeet, product);
    if (result) {
      productResults.push(result);
    }
  }

  const totalRevenue = productResults.reduce((sum, r) => sum + r.revenue, 0);

  // Calculate days in field (bed occupation time, excludes greenhouse days)
  const daysInField = calculateFieldOccupationDays(config);

  // Calculate harvest start date from field start + DTM
  let harvestStartDate: string | null = null;
  if (planting.fieldStartDate && config.productYields?.length) {
    // Use the earliest product's DTM
    const minDtm = Math.min(...config.productYields.map(py => py.dtm));
    const fieldStart = new Date(planting.fieldStartDate);
    fieldStart.setDate(fieldStart.getDate() + minDtm);
    harvestStartDate = fieldStart.toISOString().slice(0, 10);
  }

  return {
    plantingId: planting.id,
    configId: planting.configId,
    crop: config.crop,
    bedFeet: planting.bedFeet,
    daysInField,
    products: productResults,
    totalRevenue,
    harvestStartDate,
  };
}

/**
 * Generate a complete revenue report for a plan.
 *
 * @param plan - The plan to analyze
 * @returns Complete revenue breakdown
 */
export function calculatePlanRevenue(plan: Plan): PlanRevenueReport {
  const plantingResults: PlantingRevenueResult[] = [];
  const cropTotals = new Map<string, { revenue: number; bedFeet: number; bedFootDays: number; count: number }>();
  const monthlyTotals = new Map<string, number>();
  const monthByCrop = new Map<string, Record<string, number>>();

  const plantings = plan.plantings ?? [];
  const cropCatalog = plan.cropCatalog ?? {};
  const products = plan.products ?? {};

  // Calculate revenue for each planting
  for (const planting of plantings) {
    const config = cropCatalog[planting.configId];
    if (!config) continue;

    const result = calculatePlantingRevenue(planting, config, products);
    plantingResults.push(result);

    // Calculate bed-foot-days for this planting
    const bedFootDays = planting.bedFeet * result.daysInField;

    // Aggregate by crop
    const cropKey = config.crop;
    const existing = cropTotals.get(cropKey) ?? { revenue: 0, bedFeet: 0, bedFootDays: 0, count: 0 };
    cropTotals.set(cropKey, {
      revenue: existing.revenue + result.totalRevenue,
      bedFeet: existing.bedFeet + planting.bedFeet,
      bedFootDays: existing.bedFootDays + bedFootDays,
      count: existing.count + 1,
    });

    // Distribute revenue across harvest windows for each product
    if (planting.fieldStartDate) {
      const fieldStart = new Date(planting.fieldStartDate);

      for (const py of config.productYields ?? []) {
        const product = products[py.productId];
        const productResult = calculateProductYieldRevenue(py, config, planting.bedFeet, product);
        if (!productResult || productResult.revenue <= 0) continue;

        // Calculate harvest window for this product
        const harvestStart = new Date(fieldStart);
        harvestStart.setDate(harvestStart.getDate() + py.dtm);

        const harvestEnd = new Date(harvestStart);
        const numHarvests = py.numberOfHarvests ?? 1;
        const daysBetween = py.daysBetweenHarvest ?? 7;
        harvestEnd.setDate(harvestEnd.getDate() + (numHarvests - 1) * daysBetween);

        // Distribute this product's revenue across the harvest window
        const monthlyRevenue = distributeRevenueAcrossWindow(
          productResult.revenue,
          harvestStart,
          harvestEnd
        );

        // Add to totals
        for (const [month, revenue] of monthlyRevenue) {
          monthlyTotals.set(month, (monthlyTotals.get(month) ?? 0) + revenue);

          // Track per-crop revenue by month for stacked chart
          const cropMonthData = monthByCrop.get(month) ?? {};
          cropMonthData[cropKey] = (cropMonthData[cropKey] ?? 0) + revenue;
          monthByCrop.set(month, cropMonthData);
        }
      }
    }
  }

  // Calculate totals
  const totalRevenue = plantingResults.reduce((sum, r) => sum + r.totalRevenue, 0);

  // Build crop results sorted by revenue descending
  const byCrop: CropRevenueResult[] = Array.from(cropTotals.entries())
    .map(([crop, data]) => ({
      crop,
      totalRevenue: data.revenue,
      totalBedFeet: data.bedFeet,
      totalBedFootDays: data.bedFootDays,
      plantingCount: data.count,
      percentOfTotal: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  // Build monthly results sorted chronologically
  // Only include months with actual revenue data (no filling empty months)
  const sortedMonths = Array.from(monthlyTotals.keys()).sort();

  let cumulative = 0;
  const byMonth: MonthlyRevenueResult[] = sortedMonths.map(month => {
    const revenue = monthlyTotals.get(month) ?? 0;
    const byCrop = monthByCrop.get(month) ?? {};
    cumulative += revenue;
    return { month, revenue, cumulative, byCrop };
  });

  return {
    totalRevenue,
    plantingCount: plantings.length,
    byCrop,
    byMonth,
    plantings: plantingResults,
  };
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

/**
 * Format a number as currency.
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format a month string (YYYY-MM) for display.
 */
export function formatMonth(month: string): string {
  const [year, monthNum] = month.split('-');
  const date = new Date(parseInt(year), parseInt(monthNum) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
