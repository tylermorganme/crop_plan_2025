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

    // Aggregate by month (using harvest start date)
    if (result.harvestStartDate) {
      const month = result.harvestStartDate.slice(0, 7); // YYYY-MM
      monthlyTotals.set(month, (monthlyTotals.get(month) ?? 0) + result.totalRevenue);
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
  const sortedMonths = Array.from(monthlyTotals.keys()).sort();
  let cumulative = 0;
  const byMonth: MonthlyRevenueResult[] = sortedMonths.map(month => {
    const revenue = monthlyTotals.get(month) ?? 0;
    cumulative += revenue;
    return { month, revenue, cumulative };
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
