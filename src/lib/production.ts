/**
 * Production Calculation Module
 *
 * Calculates production metrics from plantings based on:
 * - Product yields (from PlantingSpec.productYields)
 * - Planting bed feet
 * - Harvest timing
 *
 * Supports aggregation by crop, month, and total.
 * Unlike revenue (single currency), production tracks yields by unit (lb, bunch, etc.).
 */

import { parseISO, addDays } from 'date-fns';
import type { Plan } from './plan-types';
import type { Planting } from './entities/planting';
import type { PlantingSpec, ProductYield } from './entities/planting-specs';
import type { Product } from './entities/product';
import type { MarketSplit } from './entities/market';
import {
  evaluateYieldFormula,
  buildYieldContext,
  calculateFieldOccupationDays,
  calculateDaysInCells,
  calculateProductSeedToHarvest,
  calculateProductHarvestWindow,
} from './entities/planting-specs';

// =============================================================================
// TYPES
// =============================================================================

/** A single harvest event (one bar on the timeline chart) */
export interface HarvestEvent {
  /** ISO date string of harvest */
  date: string;
  /** Total yield amount for this harvest */
  yield: number;
  /** Yield broken down by market (marketId -> yield) */
  yieldByMarket: Record<string, number>;
  /** Planting ID this harvest belongs to */
  plantingId: string;
  /** Spec identifier for display */
  identifier: string;
  /** Bed name for tooltip */
  bedName: string | null;
}

/** Production metrics for a single product in a planting */
export interface ProductProductionResult {
  productId: string;
  productName: string;
  unit: string;
  totalYield: number;
  /** Days from first to last harvest */
  harvestWindowDays: number;
  /** Number of individual harvests */
  numberOfHarvests: number;
  /** Days between harvests */
  daysBetweenHarvest: number;
  /** Max yield per week (concentrated in harvest window) */
  maxYieldPerWeek: number;
  /** Min yield per week (spread over harvest + holding window) */
  minYieldPerWeek: number;
  /** First harvest date (ISO string) */
  harvestStartDate: string | null;
  /** Last harvest date (ISO string) */
  harvestEndDate: string | null;
}

/** Production metrics for a single planting */
export interface PlantingProductionResult {
  plantingId: string;
  specId: string;
  crop: string;
  identifier: string;
  bedFeet: number;
  daysInField: number;
  products: ProductProductionResult[];
  /** Total yield by unit (e.g., { "lb": 45, "bunch": 20 }) */
  totalYieldByUnit: Record<string, number>;
  /** First harvest date (ISO string) */
  harvestStartDate: string | null;
  /** Last harvest date (ISO string) */
  harvestEndDate: string | null;
  /** Bed location */
  startBed: string | null;
  fieldStartDate: string;
}

/** Production metrics aggregated by crop */
export interface CropProductionResult {
  crop: string;
  cropId?: string;
  totalBedFeet: number;
  /** Total bed-foot-days (bedFeet x daysInField for each planting) */
  totalBedFootDays: number;
  plantingCount: number;
  /** Total yield by unit (e.g., { "lb": 450, "bunch": 200 }) */
  totalYieldByUnit: Record<string, number>;
  /** Yield efficiency: totalYield / totalBedFeet per unit */
  yieldPerFootByUnit: Record<string, number>;
  /** Max yield per week summed across all plantings, by unit */
  maxYieldPerWeekByUnit: Record<string, number>;
  /** Min yield per week summed across all plantings, by unit */
  minYieldPerWeekByUnit: Record<string, number>;
  /** Individual plantings for this crop (for detail view) */
  plantings: PlantingProductionResult[];
}

/** Production metrics aggregated by month */
export interface MonthlyProductionResult {
  /** Month in YYYY-MM format */
  month: string;
  /** Total yield by unit for this month */
  yieldByUnit: Record<string, number>;
  /** Cumulative yield by unit up to and including this month */
  cumulativeByUnit: Record<string, number>;
  /** Breakdown by crop: crop name -> unit -> yield */
  byCrop: Record<string, Record<string, number>>;
}

/** Production metrics aggregated by product (crop + product type) */
export interface ProductProductionSummary {
  /** Product UUID */
  productId: string;
  /** Crop name (e.g., "Tomato") */
  crop: string;
  /** Crop ID for linking */
  cropId?: string;
  /** Product name (e.g., "cherry", "slicing") */
  productName: string;
  /** Unit for this product (e.g., "lb", "bunch") */
  unit: string;
  /** Total yield for this product across all plantings */
  totalYield: number;
  /** Total bed feet producing this product */
  totalBedFeet: number;
  /** Number of plantings producing this product */
  plantingCount: number;
  /** Yield per foot efficiency */
  yieldPerFoot: number;
  /** Max yield per week (sum across all plantings) */
  maxYieldPerWeek: number;
  /** Min yield per week (sum across all plantings) */
  minYieldPerWeek: number;
  /** Individual planting details for this product */
  plantings: Array<{
    plantingId: string;
    identifier: string;
    bedFeet: number;
    totalYield: number;
    harvestStartDate: string | null;
    harvestEndDate: string | null;
    fieldStartDate: string;
    startBed: string | null;
    bedName: string | null;
    numberOfHarvests: number;
    daysBetweenHarvest: number;
    /** Max yield per week for this planting (used for overlap calculation) */
    maxYieldPerWeek: number;
  }>;
  /** Expanded harvest events for timeline chart */
  harvestEvents: HarvestEvent[];
}

/** Complete production report for a plan */
export interface PlanProductionReport {
  /** Total yield by unit across entire plan */
  totalYieldByUnit: Record<string, number>;
  plantingCount: number;
  cropCount: number;
  /** Aggregated by crop, sorted by total yield */
  byCrop: CropProductionResult[];
  /** Aggregated by product (crop + product type), for the main table view */
  byProduct: ProductProductionSummary[];
  /** Monthly breakdown for timeline charts */
  byMonth: MonthlyProductionResult[];
  /** All plantings with production metrics */
  plantings: PlantingProductionResult[];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Add a value to a Record<string, number>, creating the key if needed.
 */
function addToRecord(record: Record<string, number>, key: string, value: number): void {
  record[key] = (record[key] ?? 0) + value;
}

/**
 * Merge one yield record into another.
 */
function mergeYieldRecords(
  target: Record<string, number>,
  source: Record<string, number>
): void {
  for (const [unit, value] of Object.entries(source)) {
    addToRecord(target, unit, value);
  }
}

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
 * Distribute yield across months based on a harvest window.
 * Returns a map of month (YYYY-MM) to yield amount.
 */
function distributeYieldAcrossWindow(
  totalYield: number,
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
      const monthYield = (days / totalDays) * totalYield;
      result.set(monthKey, monthYield);
    }

    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }

  return result;
}

/**
 * Calculate the true maximum yield per week based on overlapping harvest windows.
 *
 * Instead of naively summing all per-planting maxYieldPerWeek values (which assumes
 * all plantings harvest simultaneously), this uses an interval sweep algorithm to find
 * the actual peak week based on when harvest windows overlap.
 *
 * Algorithm:
 * 1. Create "start" and "end" events for each harvest window
 * 2. Sort events chronologically (ends before starts on same day)
 * 3. Walk through events, tracking active yield/week
 * 4. Return the maximum sum encountered
 */
function calculatePeakOverlapYieldPerWeek(
  plantings: Array<{
    harvestStartDate: string | null;
    harvestEndDate: string | null;
    maxYieldPerWeek: number;
  }>
): number {
  // Build events: +yieldPerWeek at start, -yieldPerWeek at end
  type IntervalEvent = { date: string; delta: number };
  const events: IntervalEvent[] = [];

  for (const p of plantings) {
    if (!p.harvestStartDate || !p.harvestEndDate || p.maxYieldPerWeek <= 0) continue;

    events.push({ date: p.harvestStartDate, delta: p.maxYieldPerWeek });
    // End is exclusive - yield stops after the last harvest day
    // Add 1 day to end date for the "stop" event
    const endDate = new Date(p.harvestEndDate + 'T00:00:00');
    endDate.setDate(endDate.getDate() + 1);
    events.push({ date: endDate.toISOString().split('T')[0], delta: -p.maxYieldPerWeek });
  }

  if (events.length === 0) return 0;

  // Sort by date, with ends (-delta) before starts (+delta) on same day
  // This ensures we process "stop" before "start" when both occur on the same day
  events.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    // On same day, negative deltas (ends) come before positive deltas (starts)
    return a.delta - b.delta;
  });

  // Sweep through events tracking active yield
  let currentYield = 0;
  let maxYield = 0;

  for (const event of events) {
    currentYield += event.delta;
    if (currentYield > maxYield) {
      maxYield = currentYield;
    }
  }

  return maxYield;
}

// =============================================================================
// CORE CALCULATION FUNCTIONS
// =============================================================================

/**
 * Calculate production metrics for a single product yield.
 */
function calculateProductProduction(
  py: ProductYield,
  spec: PlantingSpec,
  bedFeet: number,
  fieldStartDate: Date,
  product: Product | undefined
): ProductProductionResult | null {
  if (!py.yieldFormula || !product) {
    return null;
  }

  // Build context for formula evaluation
  const context = buildYieldContext(spec, bedFeet);
  context.harvests = py.numberOfHarvests ?? 1;
  context.daysBetweenHarvest = py.daysBetweenHarvest ?? 7;

  const result = evaluateYieldFormula(py.yieldFormula, context);
  if (result.value === null) {
    return null;
  }

  const totalYield = result.value;

  // Calculate harvest dates
  const daysInCells = calculateDaysInCells(spec);
  const seedToHarvest = calculateProductSeedToHarvest(py, spec, daysInCells);
  const harvestWindowDays = calculateProductHarvestWindow(py);

  const harvestStart = addDays(fieldStartDate, seedToHarvest);
  const harvestEnd = addDays(harvestStart, Math.max(0, harvestWindowDays - 1));

  // Calculate yield per week
  const holdingWindowDays = product.holdingWindow ?? 0;
  const effectiveHarvestDays = Math.max(harvestWindowDays, 1);
  const maxYieldPerWeek = (totalYield / effectiveHarvestDays) * 7;

  const effectiveTotalDays = Math.max(harvestWindowDays + holdingWindowDays, 1);
  const minYieldPerWeek = (totalYield / effectiveTotalDays) * 7;

  return {
    productId: py.productId,
    productName: product.product,
    unit: product.unit,
    totalYield,
    harvestWindowDays,
    numberOfHarvests: py.numberOfHarvests ?? 1,
    daysBetweenHarvest: py.daysBetweenHarvest ?? 7,
    maxYieldPerWeek,
    minYieldPerWeek,
    harvestStartDate: harvestStart.toISOString().split('T')[0],
    harvestEndDate: harvestEnd.toISOString().split('T')[0],
  };
}

/**
 * Calculate production metrics for a single planting.
 */
export function calculatePlantingProduction(
  planting: Planting,
  spec: PlantingSpec,
  products: Record<string, Product>
): PlantingProductionResult {
  const productResults: ProductProductionResult[] = [];
  const totalYieldByUnit: Record<string, number> = {};
  let earliestHarvestStart: string | null = null;
  let latestHarvestEnd: string | null = null;

  const fieldStartDate = parseISO(planting.fieldStartDate);

  // Calculate production for each product yield
  for (const py of spec.productYields ?? []) {
    const product = products[py.productId];
    const result = calculateProductProduction(py, spec, planting.bedFeet, fieldStartDate, product);

    if (result) {
      productResults.push(result);
      addToRecord(totalYieldByUnit, result.unit, result.totalYield);

      // Track harvest date range
      if (result.harvestStartDate) {
        if (!earliestHarvestStart || result.harvestStartDate < earliestHarvestStart) {
          earliestHarvestStart = result.harvestStartDate;
        }
      }
      if (result.harvestEndDate) {
        if (!latestHarvestEnd || result.harvestEndDate > latestHarvestEnd) {
          latestHarvestEnd = result.harvestEndDate;
        }
      }
    }
  }

  return {
    plantingId: planting.id,
    specId: planting.specId,
    crop: spec.crop,
    identifier: spec.identifier,
    bedFeet: planting.bedFeet,
    daysInField: calculateFieldOccupationDays(spec),
    products: productResults,
    totalYieldByUnit,
    harvestStartDate: earliestHarvestStart,
    harvestEndDate: latestHarvestEnd,
    startBed: planting.startBed ?? null,
    fieldStartDate: planting.fieldStartDate,
  };
}

/**
 * Calculate complete production report for a plan.
 */
export function calculatePlanProduction(plan: Plan): PlanProductionReport {
  const plantingResults: PlantingProductionResult[] = [];
  const totalYieldByUnit: Record<string, number> = {};
  const cropMap = new Map<string, CropProductionResult>();
  const productMap = new Map<string, ProductProductionSummary>();

  // Monthly aggregation: month -> unit -> yield
  const monthlyYieldByUnit = new Map<string, Record<string, number>>();
  // Monthly by crop: month -> crop -> unit -> yield
  const monthlyByCrop = new Map<string, Record<string, Record<string, number>>>();

  const specs = plan.specs ?? {};
  const products = plan.products ?? {};
  const markets = plan.markets ?? {};

  // Process each planting
  for (const planting of plan.plantings ?? []) {
    const spec = specs[planting.specId];
    if (!spec) continue;

    // Skip failed plantings
    if (planting.actuals?.failed) continue;

    const plantingProduction = calculatePlantingProduction(planting, spec, products);
    plantingResults.push(plantingProduction);

    // Add to totals
    mergeYieldRecords(totalYieldByUnit, plantingProduction.totalYieldByUnit);

    // Aggregate by crop
    let cropResult = cropMap.get(spec.crop);
    if (!cropResult) {
      cropResult = {
        crop: spec.crop,
        cropId: spec.cropId,
        totalBedFeet: 0,
        totalBedFootDays: 0,
        plantingCount: 0,
        totalYieldByUnit: {},
        yieldPerFootByUnit: {},
        maxYieldPerWeekByUnit: {},
        minYieldPerWeekByUnit: {},
        plantings: [],
      };
      cropMap.set(spec.crop, cropResult);
    }

    cropResult.totalBedFeet += planting.bedFeet;
    cropResult.totalBedFootDays += planting.bedFeet * plantingProduction.daysInField;
    cropResult.plantingCount += 1;
    mergeYieldRecords(cropResult.totalYieldByUnit, plantingProduction.totalYieldByUnit);
    cropResult.plantings.push(plantingProduction);

    // Add yield per week metrics
    for (const product of plantingProduction.products) {
      addToRecord(cropResult.maxYieldPerWeekByUnit, product.unit, product.maxYieldPerWeek);
      addToRecord(cropResult.minYieldPerWeekByUnit, product.unit, product.minYieldPerWeek);
    }

    // Aggregate by product (each productYield is a separate row)
    for (const productResult of plantingProduction.products) {
      const productEntity = products[productResult.productId];
      if (!productEntity) continue;

      let productSummary = productMap.get(productResult.productId);
      if (!productSummary) {
        productSummary = {
          productId: productResult.productId,
          crop: productEntity.crop,
          cropId: spec.cropId,
          productName: productEntity.product,
          unit: productEntity.unit,
          totalYield: 0,
          totalBedFeet: 0,
          plantingCount: 0,
          yieldPerFoot: 0,
          maxYieldPerWeek: 0,
          minYieldPerWeek: 0,
          plantings: [],
          harvestEvents: [],
        };
        productMap.set(productResult.productId, productSummary);
      }

      productSummary.totalYield += productResult.totalYield;
      productSummary.totalBedFeet += planting.bedFeet;
      productSummary.plantingCount += 1;
      // Note: maxYieldPerWeek will be recalculated using interval overlap after all plantings collected
      productSummary.minYieldPerWeek += productResult.minYieldPerWeek;
      // Look up bed name
      const bedName = planting.startBed && plan.beds?.[planting.startBed]
        ? plan.beds[planting.startBed].name
        : null;

      productSummary.plantings.push({
        plantingId: planting.id,
        identifier: spec.identifier,
        bedFeet: planting.bedFeet,
        totalYield: productResult.totalYield,
        harvestStartDate: productResult.harvestStartDate,
        harvestEndDate: productResult.harvestEndDate,
        fieldStartDate: planting.fieldStartDate,
        startBed: planting.startBed ?? null,
        bedName,
        numberOfHarvests: productResult.numberOfHarvests,
        daysBetweenHarvest: productResult.daysBetweenHarvest,
        maxYieldPerWeek: productResult.maxYieldPerWeek,
      });

      // Generate individual harvest events for timeline chart
      if (productResult.harvestStartDate && productResult.numberOfHarvests > 0) {
        const yieldPerHarvest = productResult.totalYield / productResult.numberOfHarvests;
        const harvestStart = parseISO(productResult.harvestStartDate);

        // Get effective market split: planting override > spec default > 100% Direct
        const marketSplit = planting.marketSplit ?? spec.defaultMarketSplit;

        for (let i = 0; i < productResult.numberOfHarvests; i++) {
          const harvestDate = addDays(harvestStart, i * productResult.daysBetweenHarvest);

          // Calculate yield by market
          const yieldByMarket: Record<string, number> = {};
          if (marketSplit && Object.keys(marketSplit).length > 0) {
            // Calculate total percentage for normalization
            const totalPct = Object.values(marketSplit).reduce((sum, pct) => sum + (pct || 0), 0);
            for (const [marketId, pct] of Object.entries(marketSplit)) {
              if (pct > 0 && markets[marketId]?.active !== false) {
                yieldByMarket[marketId] = yieldPerHarvest * (pct / totalPct);
              }
            }
          } else {
            // Default: all to first active market or 'market-direct'
            const defaultMarketId = Object.values(markets).find(m => m.active)?.id ?? 'market-direct';
            yieldByMarket[defaultMarketId] = yieldPerHarvest;
          }

          productSummary.harvestEvents.push({
            date: harvestDate.toISOString().split('T')[0],
            yield: yieldPerHarvest,
            yieldByMarket,
            plantingId: planting.id,
            identifier: spec.identifier,
            bedName,
          });
        }
      }
    }

    // Distribute yield across months for timeline
    for (const product of plantingProduction.products) {
      if (!plantingProduction.harvestStartDate || !plantingProduction.harvestEndDate) continue;

      const harvestStart = parseISO(plantingProduction.harvestStartDate);
      const harvestEnd = parseISO(plantingProduction.harvestEndDate);

      const monthlyDistribution = distributeYieldAcrossWindow(
        product.totalYield,
        harvestStart,
        harvestEnd
      );

      for (const [month, yieldValue] of monthlyDistribution) {
        // Total by unit
        if (!monthlyYieldByUnit.has(month)) {
          monthlyYieldByUnit.set(month, {});
        }
        addToRecord(monthlyYieldByUnit.get(month)!, product.unit, yieldValue);

        // By crop
        if (!monthlyByCrop.has(month)) {
          monthlyByCrop.set(month, {});
        }
        const cropBreakdown = monthlyByCrop.get(month)!;
        if (!cropBreakdown[spec.crop]) {
          cropBreakdown[spec.crop] = {};
        }
        addToRecord(cropBreakdown[spec.crop], product.unit, yieldValue);
      }
    }
  }

  // Calculate yield efficiency for each crop
  for (const cropResult of cropMap.values()) {
    if (cropResult.totalBedFeet > 0) {
      for (const [unit, totalYield] of Object.entries(cropResult.totalYieldByUnit)) {
        cropResult.yieldPerFootByUnit[unit] = totalYield / cropResult.totalBedFeet;
      }
    }
  }

  // Calculate yield efficiency and true max per week for each product
  for (const productSummary of productMap.values()) {
    if (productSummary.totalBedFeet > 0) {
      productSummary.yieldPerFoot = productSummary.totalYield / productSummary.totalBedFeet;
    }
    // Calculate true max per week using interval overlap algorithm
    // This finds the actual peak based on overlapping harvest windows
    productSummary.maxYieldPerWeek = calculatePeakOverlapYieldPerWeek(productSummary.plantings);
  }

  // Sort products by total yield (descending)
  const byProduct = Array.from(productMap.values()).sort((a, b) => {
    // First by crop name, then by total yield within crop
    const cropCompare = a.crop.localeCompare(b.crop);
    if (cropCompare !== 0) return cropCompare;
    return b.totalYield - a.totalYield;
  });

  // Sort crops by total yield (need to pick a primary unit for sorting)
  // Use the unit with the highest total yield across all crops
  const unitTotals: Record<string, number> = {};
  for (const [unit, total] of Object.entries(totalYieldByUnit)) {
    unitTotals[unit] = total;
  }
  const primaryUnit = Object.entries(unitTotals)
    .sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'lb';

  const byCrop = Array.from(cropMap.values()).sort((a, b) => {
    const aYield = a.totalYieldByUnit[primaryUnit] ?? 0;
    const bYield = b.totalYieldByUnit[primaryUnit] ?? 0;
    return bYield - aYield;
  });

  // Build monthly results sorted by month
  const sortedMonths = Array.from(monthlyYieldByUnit.keys()).sort();
  const cumulativeByUnit: Record<string, number> = {};

  const byMonth: MonthlyProductionResult[] = sortedMonths.map(month => {
    const yieldByUnit = monthlyYieldByUnit.get(month) ?? {};
    const byCropData = monthlyByCrop.get(month) ?? {};

    // Update cumulative
    for (const [unit, value] of Object.entries(yieldByUnit)) {
      cumulativeByUnit[unit] = (cumulativeByUnit[unit] ?? 0) + value;
    }

    return {
      month,
      yieldByUnit,
      cumulativeByUnit: { ...cumulativeByUnit },
      byCrop: byCropData,
    };
  });

  return {
    totalYieldByUnit,
    plantingCount: plantingResults.length,
    cropCount: cropMap.size,
    byCrop,
    byProduct,
    byMonth,
    plantings: plantingResults,
  };
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

/**
 * Format yield with unit for display.
 */
export function formatYield(value: number, unit: string): string {
  if (value >= 100) {
    return `${Math.round(value).toLocaleString()} ${unit}`;
  } else if (value >= 10) {
    return `${value.toFixed(1)} ${unit}`;
  } else {
    return `${value.toFixed(2)} ${unit}`;
  }
}

/**
 * Format yield by unit record for display.
 * Returns something like "450 lb, 200 bunch"
 */
export function formatYieldByUnit(yieldByUnit: Record<string, number>): string {
  const entries = Object.entries(yieldByUnit)
    .filter(([, value]) => value > 0)
    .sort(([, a], [, b]) => b - a);

  if (entries.length === 0) return '-';

  return entries.map(([unit, value]) => formatYield(value, unit)).join(', ');
}

/**
 * Get month display name from YYYY-MM format.
 */
export function formatProductionMonth(month: string): string {
  const [year, monthNum] = month.split('-');
  const date = new Date(parseInt(year), parseInt(monthNum) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

/**
 * Get all unique units from a production report.
 */
export function getReportUnits(report: PlanProductionReport): string[] {
  return Object.keys(report.totalYieldByUnit).sort((a, b) => {
    // Sort by total yield descending
    const aTotal = report.totalYieldByUnit[a] ?? 0;
    const bTotal = report.totalYieldByUnit[b] ?? 0;
    return bTotal - aTotal;
  });
}

/**
 * Get unique market IDs from harvest events.
 */
export function getHarvestEventMarkets(harvestEvents: HarvestEvent[]): string[] {
  const marketIds = new Set<string>();
  for (const event of harvestEvents) {
    for (const marketId of Object.keys(event.yieldByMarket)) {
      marketIds.add(marketId);
    }
  }
  return Array.from(marketIds);
}
