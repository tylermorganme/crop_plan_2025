/**
 * Revenue Calculation Module
 *
 * Calculates revenue from plantings based on:
 * - Product yields (from CropConfig.productYields)
 * - Product prices (from Product.prices[marketId])
 * - Planting bed feet
 *
 * Supports aggregation by crop, month, and total.
 */

import { parseISO, addDays } from 'date-fns';
import type { Plan } from './plan-types';
import type { Planting } from './entities/planting';
import type { CropConfig, ProductYield } from './entities/crop-config';
import type { Product } from './entities/product';
import type { Market, MarketSplit } from './entities/market';
import { DEFAULT_MARKET_IDS, getDefaultMarket } from './entities/market';
import { evaluateYieldFormula, buildYieldContext, calculateFieldOccupationDays } from './entities/crop-config';
import { formatDateOnly } from './date-utils';

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
  /** Price used (weighted avg if split across markets) */
  price: number;
  revenue: number;
  /** Revenue broken down by market (if market split applied) */
  revenueByMarket?: Record<string, number>;
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
  /** Revenue broken down by market */
  revenueByMarket: Record<string, number>;
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
  /** Revenue broken down by market */
  revenueByMarket: Record<string, number>;
  plantingCount: number;
  byCrop: CropRevenueResult[];
  byMonth: MonthlyRevenueResult[];
  plantings: PlantingRevenueResult[];
}

// =============================================================================
// PRICE HELPERS
// =============================================================================

/**
 * Get the price for a product at a specific market.
 * Falls back to direct market price if the requested market has no price.
 */
export function getPrice(product: Product, marketId: string): number {
  return product.prices[marketId] ?? product.prices[DEFAULT_MARKET_IDS.DIRECT] ?? 0;
}

/**
 * Get the direct market price for a product.
 * This is the default price used when no market is specified.
 */
export function getDirectPrice(product: Product): number {
  return product.prices[DEFAULT_MARKET_IDS.DIRECT] ?? 0;
}

// =============================================================================
// REVENUE CALCULATION FUNCTIONS
// =============================================================================

/**
 * Calculate revenue for a single ProductYield.
 * Uses direct market price by default.
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

  const price = getDirectPrice(product);
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
 * Uses market splits to calculate proper revenue by market.
 *
 * @param planting - The planting to calculate
 * @param config - The CropConfig for this planting
 * @param products - All products (to look up pricing)
 * @param markets - All markets for the plan (for market split calculations)
 * @returns Revenue result for the planting with market breakdown
 */
export function calculatePlantingRevenue(
  planting: Planting,
  config: CropConfig,
  products: Record<string, Product>,
  markets: Record<string, Market> = {}
): PlantingRevenueResult {
  const productResults: ProductRevenueResult[] = [];
  const revenueByMarket: Record<string, number> = {};

  // Get effective market split for this planting
  const marketSplit = getEffectiveMarketSplit(planting, config);

  // Calculate revenue for each ProductYield with market breakdown
  for (const py of config.productYields ?? []) {
    const product = products[py.productId];

    // Use market-aware calculation if we have markets
    if (Object.keys(markets).length > 0) {
      const marketResult = calculateProductYieldRevenueByMarket(
        py,
        config,
        planting.bedFeet,
        product,
        marketSplit,
        markets
      );
      if (marketResult) {
        // Calculate weighted average price for display
        const yieldContext = buildYieldContext(config, planting.bedFeet);
        yieldContext.harvests = py.numberOfHarvests ?? 1;
        const yieldResult = evaluateYieldFormula(py.yieldFormula!, yieldContext);
        const yieldAmount = yieldResult.value ?? 0;
        const avgPrice = yieldAmount > 0 ? marketResult.total / yieldAmount : 0;

        productResults.push({
          productId: py.productId,
          productName: product?.product ?? 'Unknown',
          unit: product?.unit ?? '',
          yield: yieldAmount,
          price: avgPrice,
          revenue: marketResult.total,
          revenueByMarket: marketResult.byMarket,
        });

        // Aggregate market revenue
        for (const [marketId, revenue] of Object.entries(marketResult.byMarket)) {
          revenueByMarket[marketId] = (revenueByMarket[marketId] ?? 0) + revenue;
        }
      }
    } else {
      // Fallback to simple calculation (no markets defined)
      const result = calculateProductYieldRevenue(py, config, planting.bedFeet, product);
      if (result) {
        productResults.push(result);
      }
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
    const fieldStart = parseISO(planting.fieldStartDate);
    const harvestDate = addDays(fieldStart, minDtm);
    harvestStartDate = formatDateOnly(harvestDate);
  }

  return {
    plantingId: planting.id,
    configId: planting.configId,
    crop: config.crop,
    bedFeet: planting.bedFeet,
    daysInField,
    products: productResults,
    totalRevenue,
    revenueByMarket,
    harvestStartDate,
  };
}

/**
 * Generate a complete revenue report for a plan.
 * Uses market splits to calculate revenue by market.
 *
 * @param plan - The plan to analyze
 * @returns Complete revenue breakdown including market breakdown
 */
export function calculatePlanRevenue(plan: Plan): PlanRevenueReport {
  const plantingResults: PlantingRevenueResult[] = [];
  const cropTotals = new Map<string, { revenue: number; bedFeet: number; bedFootDays: number; count: number }>();
  const monthlyTotals = new Map<string, number>();
  const monthByCrop = new Map<string, Record<string, number>>();
  const revenueByMarket: Record<string, number> = {};

  const plantings = plan.plantings ?? [];
  const cropCatalog = plan.cropCatalog ?? {};
  const products = plan.products ?? {};
  const markets = plan.markets ?? {};

  // Calculate revenue for each planting
  for (const planting of plantings) {
    const config = cropCatalog[planting.configId];
    if (!config) continue;

    // Pass markets for market-split-aware calculation
    const result = calculatePlantingRevenue(planting, config, products, markets);
    plantingResults.push(result);

    // Aggregate market revenue
    for (const [marketId, revenue] of Object.entries(result.revenueByMarket)) {
      revenueByMarket[marketId] = (revenueByMarket[marketId] ?? 0) + revenue;
    }

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
      const fieldStart = parseISO(planting.fieldStartDate);

      // Use product revenues from our market-aware result
      for (const productResult of result.products) {
        if (productResult.revenue <= 0) continue;

        // Find the matching ProductYield for timing info
        const py = config.productYields?.find(p => p.productId === productResult.productId);
        if (!py) continue;

        // Calculate harvest window for this product
        const harvestStart = addDays(fieldStart, py.dtm);

        const numHarvests = py.numberOfHarvests ?? 1;
        const daysBetween = py.daysBetweenHarvest ?? 7;
        const harvestEnd = addDays(harvestStart, (numHarvests - 1) * daysBetween);

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
    revenueByMarket,
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

// =============================================================================
// MARKET SPLIT HELPERS
// =============================================================================

/**
 * Get the effective market split for a planting.
 *
 * Resolution order:
 * 1. If useDefaultMarketSplit is explicitly false → use planting's marketSplit (if set)
 * 2. If useDefaultMarketSplit is true/undefined → use config's defaultMarketSplit
 * 3. If neither is set, returns undefined (all revenue goes to first active market)
 *
 * Note: When useDefaultMarketSplit is true/undefined and config has no default,
 * we do NOT fall back to planting.marketSplit - that would defeat the purpose
 * of "use default". The planting's marketSplit is only used when explicitly
 * opted out of using the default.
 *
 * @param planting - The planting to check
 * @param config - The crop config for fallback
 * @returns The effective market split, or undefined if none set
 */
export function getEffectiveMarketSplit(
  planting: Planting,
  config: CropConfig
): MarketSplit | undefined {
  // If explicitly set to NOT use default, use planting's override
  if (planting.useDefaultMarketSplit === false) {
    return planting.marketSplit;
  }

  // Otherwise (useDefaultMarketSplit is true or undefined), use config default
  return config.defaultMarketSplit;
}

/** Revenue broken down by market */
export interface MarketRevenueBreakdown {
  /** Market ID to revenue amount */
  byMarket: Record<string, number>;
  /** Total revenue across all markets */
  total: number;
}

/**
 * Calculate revenue for a product yield, broken down by market.
 *
 * Uses the market split to allocate revenue across markets,
 * and applies the appropriate price for each market.
 *
 * @param py - The ProductYield to calculate
 * @param config - The CropConfig (for spacing/rows context)
 * @param bedFeet - The planting's bed feet
 * @param product - The Product entity (for pricing)
 * @param marketSplit - The market split to apply
 * @param markets - All markets for the plan
 * @returns Revenue breakdown by market
 */
export function calculateProductYieldRevenueByMarket(
  py: ProductYield,
  config: CropConfig,
  bedFeet: number,
  product: Product | undefined,
  marketSplit: MarketSplit | undefined,
  markets: Record<string, Market>
): MarketRevenueBreakdown | null {
  if (!py.yieldFormula || !product) {
    return null;
  }

  // Build context for formula evaluation
  const context = buildYieldContext(config, bedFeet);
  context.harvests = py.numberOfHarvests ?? 1;
  context.daysBetweenHarvest = py.daysBetweenHarvest ?? 7;

  const result = evaluateYieldFormula(py.yieldFormula, context);
  if (result.value === null) {
    return null;
  }

  const yieldAmount = result.value;
  const byMarket: Record<string, number> = {};
  let total = 0;

  // If no market split defined, all goes to first active market (usually Direct)
  if (!marketSplit || Object.keys(marketSplit).length === 0) {
    const defaultMarket = getDefaultMarket(markets);
    const price = defaultMarket ? getPrice(product, defaultMarket.id) : getDirectPrice(product);
    const revenue = yieldAmount * price;
    if (defaultMarket) {
      byMarket[defaultMarket.id] = revenue;
    }
    return { byMarket, total: revenue };
  }

  // Apply market split
  for (const [marketId, percent] of Object.entries(marketSplit)) {
    const market = markets[marketId];
    if (!market || !market.active) continue;

    // Get price for this market
    const price = getPrice(product, marketId);

    // Calculate revenue for this market's share
    const marketYield = yieldAmount * (percent / 100);
    const revenue = marketYield * price;

    byMarket[marketId] = revenue;
    total += revenue;
  }

  return { byMarket, total };
}
