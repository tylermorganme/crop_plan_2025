/**
 * Portion Report Module
 *
 * Calculates portion data from production data.
 * Portions are used for CSA share planning - how many shares of each product
 * can be distributed based on production yields and portion sizes.
 */

import type { PlanProductionReport, ProductProductionSummary, HarvestEvent } from './production';
import type { Product } from './entities/product';

/**
 * A harvest event converted to portions.
 */
export interface PortionHarvestEvent {
  /** ISO date string of harvest */
  date: string;
  /** Total portions for this harvest */
  portions: number;
  /** Portions broken down by market (marketId -> portions) */
  portionsByMarket: Record<string, number>;
  /** Planting ID this harvest belongs to */
  plantingId: string;
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Portion data for a single product.
 * Derived from production data by dividing yields by portion sizes.
 */
export interface PortionData {
  /** Product UUID */
  productId: string;
  /** Crop name (e.g., "Tomato") */
  crop: string;
  /** Product name (e.g., "cherry", "slicing") */
  productName: string;
  /** Unit for this product (e.g., "lb", "bunch") */
  unit: string;
  /** Portion size used for calculation */
  portionSize: number;
  /** Maximum portions per week (maxYieldPerWeek / portionSize) */
  maxPortionsPerWeek: number;
  /** Minimum portions per week (minYieldPerWeek / portionSize) */
  minPortionsPerWeek: number;
  /** Total portions (totalYield / portionSize) */
  totalPortions: number;
  /** Number of plantings producing this product */
  plantingCount: number;
  /** Portions allocated by market (marketId -> portions) */
  marketBreakdown: Record<string, number>;
  /** Harvest events converted to portions (for time-series charts) */
  harvestEvents: PortionHarvestEvent[];
  /** First harvest date (ISO string) */
  harvestStartDate: string | null;
  /** Last harvest date (ISO string) */
  harvestEndDate: string | null;
}

/**
 * Complete portion report for a plan.
 */
export interface PortionReport {
  /** Portion data for each product */
  items: PortionData[];
  /** Sum of all maxPortionsPerWeek across products */
  totalMaxPortionsPerWeek: number;
  /** Number of products in the report */
  productCount: number;
  /** Product names that are missing portionSize configuration */
  productsWithoutPortionSize: string[];
}

// =============================================================================
// CALCULATION
// =============================================================================

/**
 * Calculate portion report from production data.
 *
 * @param productionReport - Production report from calculatePlanProduction()
 * @param products - Product catalog (Record<productId, Product>)
 * @param defaultPortionSize - Default portion size when product doesn't specify one (default: 1)
 * @returns PortionReport with calculated portion data
 */
export function calculatePortionReport(
  productionReport: PlanProductionReport,
  products: Record<string, Product>,
  defaultPortionSize: number = 1
): PortionReport {
  const items: PortionData[] = [];
  const productsWithoutPortionSize: string[] = [];
  let totalMaxPortionsPerWeek = 0;

  for (const summary of productionReport.byProduct) {
    const product = products[summary.productId];
    const portionSize = product?.portionSize ?? defaultPortionSize;

    // Track products missing portion size
    if (!product?.portionSize) {
      const displayName = `${summary.crop} - ${summary.productName}`;
      productsWithoutPortionSize.push(displayName);
    }

    // Calculate portions by dividing yields by portion size
    const maxPortionsPerWeek = summary.maxYieldPerWeek / portionSize;
    const minPortionsPerWeek = summary.minYieldPerWeek / portionSize;
    const totalPortions = summary.totalYield / portionSize;

    // Calculate market breakdown from harvest events
    const marketBreakdown = calculateMarketBreakdown(summary, portionSize);

    // Convert harvest events to portion events
    const harvestEvents = convertHarvestEventsToPortions(summary.harvestEvents, portionSize);

    // Get harvest date range
    const harvestStartDate = summary.plantings.length > 0
      ? summary.plantings.reduce((earliest, p) => {
          if (!p.harvestStartDate) return earliest;
          if (!earliest) return p.harvestStartDate;
          return p.harvestStartDate < earliest ? p.harvestStartDate : earliest;
        }, null as string | null)
      : null;
    const harvestEndDate = summary.plantings.length > 0
      ? summary.plantings.reduce((latest, p) => {
          if (!p.harvestEndDate) return latest;
          if (!latest) return p.harvestEndDate;
          return p.harvestEndDate > latest ? p.harvestEndDate : latest;
        }, null as string | null)
      : null;

    const portionData: PortionData = {
      productId: summary.productId,
      crop: summary.crop,
      productName: summary.productName,
      unit: summary.unit,
      portionSize,
      maxPortionsPerWeek,
      minPortionsPerWeek,
      totalPortions,
      plantingCount: summary.plantingCount,
      marketBreakdown,
      harvestEvents,
      harvestStartDate,
      harvestEndDate,
    };

    items.push(portionData);
    totalMaxPortionsPerWeek += maxPortionsPerWeek;
  }

  return {
    items,
    totalMaxPortionsPerWeek,
    productCount: items.length,
    productsWithoutPortionSize,
  };
}

/**
 * Calculate market breakdown for a product from its harvest events.
 * Sums up yield by market from all harvest events and converts to portions.
 */
function calculateMarketBreakdown(
  summary: ProductProductionSummary,
  portionSize: number
): Record<string, number> {
  const yieldByMarket: Record<string, number> = {};

  // Sum yield by market from all harvest events
  for (const event of summary.harvestEvents) {
    for (const [marketId, yieldAmount] of Object.entries(event.yieldByMarket)) {
      yieldByMarket[marketId] = (yieldByMarket[marketId] ?? 0) + yieldAmount;
    }
  }

  // Convert yields to portions
  const portionsByMarket: Record<string, number> = {};
  for (const [marketId, totalYield] of Object.entries(yieldByMarket)) {
    portionsByMarket[marketId] = totalYield / portionSize;
  }

  return portionsByMarket;
}

/**
 * Convert harvest events to portion events.
 * Each harvest event's yield is divided by the portion size.
 */
function convertHarvestEventsToPortions(
  harvestEvents: HarvestEvent[],
  portionSize: number
): PortionHarvestEvent[] {
  return harvestEvents.map((event) => {
    const portionsByMarket: Record<string, number> = {};
    for (const [marketId, yieldAmount] of Object.entries(event.yieldByMarket)) {
      portionsByMarket[marketId] = yieldAmount / portionSize;
    }

    return {
      date: event.date,
      portions: event.yield / portionSize,
      portionsByMarket,
      plantingId: event.plantingId,
    };
  });
}
