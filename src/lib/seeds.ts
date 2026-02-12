/**
 * Seed Calculation Module
 *
 * Calculates seeds needed per variety across all plantings in a plan.
 * Handles both direct variety assignments and seed mixes.
 * Groups results by supplier for ordering.
 * Integrates with SeedOrder to show ordering status.
 */

import type { Plan } from './plan-types';
import type { Planting } from './entities/planting';
import { getEffectiveSeedSource } from './entities/planting';
import type { PlantingSpec } from './entities/planting-specs';
import type { Variety, DensityUnit } from './entities/variety';
import { calculateWeightForSeeds, calculateSeedsFromWeight } from './entities/variety';
import type { SeedMix } from './entities/seed-mix';
import type { SeedOrder } from './entities/seed-order';
import { getOrderedAmount, getSeedOrderId } from './entities/seed-order';

// =============================================================================
// CONSTANTS
// =============================================================================

// =============================================================================
// TYPES
// =============================================================================

/** One planting's contribution to a variety's seed total */
export interface PlantingSeedContribution {
  plantingId: string;
  specName: string;
  fieldStartDate: string;
  startBed: string | null;
  bedFeet: number;
  /** Number of plant sites in the bed: (12/spacing) * rows * bedFeet */
  plantsInBed: number;
  /** Seeds dropped per plant site */
  seedsPerPlanting: number;
  /** Extra start factor — insurance multiplier (e.g., 1.3 = 30% extra) */
  extraStartFactor: number;
  /** Total seeds for the entire planting (before variety split) */
  totalPlantingSeeds: number;
  /** Seeds attributed to THIS variety from this planting */
  varietySeeds: number;
  /** 1.0 for direct variety, mix component % for mix (0.0–1.0) */
  varietyShare: number;
  /** How this variety is assigned to the planting */
  assignmentType: 'direct' | 'spec-default' | 'mix-direct' | 'mix-spec-default';
  /** For mix assignments: the mix name */
  mixName?: string;
}

/** Aggregated seeds needed for a single variety across all plantings */
export interface VarietySeedResult {
  varietyId: string;
  varietyName: string;
  crop: string;
  supplier: string;
  organic: boolean;
  seedsNeeded: number;
  /** Weight needed in the variety's native density unit */
  weightNeeded?: number;
  /** Unit for weightNeeded */
  weightUnit?: DensityUnit;
  /** @deprecated Use weightNeeded/weightUnit instead */
  seedsPerOz?: number;
  /** @deprecated Use weightNeeded/weightUnit instead */
  ouncesNeeded?: number;
  website?: string;
  alreadyOwn?: boolean;
  /** Number of plantings using this variety */
  plantingCount: number;
  /** Per-planting breakdown of seed contributions */
  contributions: PlantingSeedContribution[];
  /** Order info from SeedOrder entity */
  order?: {
    /** Total seeds ordered (calculated from order weight × density) */
    seedsOrdered: number;
    /** Weight ordered */
    weightOrdered: number;
    /** Unit for ordered weight */
    orderUnit: DensityUnit;
    /** Cost per product */
    productCost?: number;
    /** Quantity ordered */
    quantity: number;
    /** Amount already in inventory */
    haveWeight?: number;
    /** Unit for inventory amount */
    haveUnit?: DensityUnit;
    /** Link to product page */
    productLink?: string;
  };
  /** Whether (have + order) meets or exceeds needed */
  isEnough?: boolean;
  /** Shortage (seeds) - positive means we need more */
  shortageSeeds?: number;
}

/** Seeds grouped by supplier */
export interface SupplierSeedResult {
  supplier: string;
  varieties: VarietySeedResult[];
  totalSeeds: number;
  totalOunces?: number;
}

/** Complete seed report for a plan */
export interface PlanSeedReport {
  /** Total seeds needed across all varieties */
  totalSeeds: number;
  /** Total unique varieties needed */
  varietyCount: number;
  /** Total suppliers to order from */
  supplierCount: number;
  /** Plantings without seedSource assigned */
  plantingsWithoutSeed: number;
  /** Breakdown by variety */
  byVariety: VarietySeedResult[];
  /** Breakdown by supplier (for ordering) */
  bySupplier: SupplierSeedResult[];
}

// =============================================================================
// SEED CALCULATION FUNCTIONS
// =============================================================================

/**
 * Calculate seeds needed for a single planting.
 *
 * Formula: (12/spacing) * rows * bedFeet * seedsPerPlanting * extraStartFactor
 *
 * @param planting - The planting to calculate
 * @param spec - The PlantingSpec for this planting
 * @returns Number of seeds needed (rounded up)
 */
export function calculateSeedsForPlanting(
  planting: Planting,
  spec: PlantingSpec,
): number {
  const rows = spec.rows ?? 1;
  const spacing = spec.spacing ?? 12;
  const seedsPerPlanting = spec.seedsPerPlanting ?? 1;
  const extraStartFactor = spec.extraStartFactor ?? 1;

  if (spacing <= 0) return 0;

  // plantingsPerBed = (12 / spacing) * rows * bedFeet
  const plantingsPerBed = (12 / spacing) * rows * planting.bedFeet;

  // seedsToPlant = plantingsPerBed * seedsPerPlanting * extraStartFactor
  const seedsToPlant = plantingsPerBed * seedsPerPlanting * extraStartFactor;

  return Math.ceil(seedsToPlant);
}

/**
 * Split seeds needed for a mix into per-variety allocations.
 *
 * @param totalSeeds - Total seeds needed for this planting
 * @param mix - The seed mix to expand
 * @param varieties - All varieties in the plan (for lookups)
 * @returns Array of { varietyId, seeds } for each resolved component
 */
export function expandSeedMixToVarieties(
  totalSeeds: number,
  mix: SeedMix,
  varieties: Record<string, Variety>
): { varietyId: string; seeds: number }[] {
  const results: { varietyId: string; seeds: number }[] = [];

  // Normalize percentages if they don't sum to 1.0
  const totalPercent = mix.components.reduce((sum, c) => sum + c.percent, 0);
  const normalizer = totalPercent > 0 ? 1 / totalPercent : 1;

  for (const component of mix.components) {
    const variety = varieties[component.varietyId];
    if (!variety) continue; // Skip unresolved varieties

    const normalizedPercent = component.percent * normalizer;
    const seeds = Math.ceil(totalSeeds * normalizedPercent);

    results.push({ varietyId: component.varietyId, seeds });
  }

  return results;
}

/**
 * Generate a complete seed report for a plan.
 *
 * @param plan - The plan to analyze
 * @returns Complete seed breakdown by variety and supplier
 */
export function calculatePlanSeeds(
  plan: Plan,
): PlanSeedReport {
  // Accumulator: varietyId -> contributions (aggregates derived from these)
  const varietyContributions = new Map<string, PlantingSeedContribution[]>();

  const plantings = plan.plantings ?? [];
  const specs = plan.specs ?? {};
  const varieties = plan.varieties ?? {};
  const seedMixes = plan.seedMixes ?? {};
  const seedOrders = plan.seedOrders ?? {};

  let plantingsWithoutSeed = 0;

  for (const planting of plantings) {
    const spec = specs[planting.specId];
    if (!spec) continue;

    const effectiveSeedSource = getEffectiveSeedSource(planting, spec.defaultSeedSource);

    // Check if planting has a seed source assigned (either explicit or default)
    if (!effectiveSeedSource) {
      plantingsWithoutSeed++;
      continue;
    }

    const totalSeeds = calculateSeedsForPlanting(planting, spec);

    // Determine if using explicit seedSource or falling through to spec default
    const isExplicit = !!planting.seedSource;

    // Extract planting detail fields from spec for breakdown display
    const rows = spec.rows ?? 1;
    const spacing = spec.spacing ?? 12;
    const spp = spec.seedsPerPlanting ?? 1;
    const sf = spec.extraStartFactor ?? 1;
    const plantsInBed = spacing > 0 ? Math.round((12 / spacing) * rows * planting.bedFeet) : 0;

    if (effectiveSeedSource.type === 'variety') {
      // Direct variety assignment
      const variety = varieties[effectiveSeedSource.id];
      if (!variety) {
        plantingsWithoutSeed++;
        continue;
      }

      addContribution(varietyContributions, variety.id, {
        plantingId: planting.id,
        specName: spec.name,
        fieldStartDate: planting.fieldStartDate,
        startBed: planting.startBed ?? null,
        bedFeet: planting.bedFeet,
        plantsInBed,
        seedsPerPlanting: spp,
        extraStartFactor: sf,
        totalPlantingSeeds: totalSeeds,
        varietySeeds: totalSeeds,
        varietyShare: 1.0,
        assignmentType: isExplicit ? 'direct' : 'spec-default',
      });
    } else if (effectiveSeedSource.type === 'mix') {
      // Seed mix - split proportionally
      const mix = seedMixes[effectiveSeedSource.id];
      if (!mix) {
        plantingsWithoutSeed++;
        continue;
      }

      const expanded = expandSeedMixToVarieties(totalSeeds, mix, varieties);
      // Compute normalized share for display
      const totalPercent = mix.components.reduce((s, c) => s + c.percent, 0);
      const normalizer = totalPercent > 0 ? 1 / totalPercent : 1;

      for (const { varietyId, seeds } of expanded) {
        const component = mix.components.find(c => c.varietyId === varietyId);
        const share = component ? component.percent * normalizer : 0;

        addContribution(varietyContributions, varietyId, {
          plantingId: planting.id,
          specName: spec.name,
          fieldStartDate: planting.fieldStartDate,
          startBed: planting.startBed ?? null,
          bedFeet: planting.bedFeet,
          plantsInBed,
          seedsPerPlanting: spp,
          extraStartFactor: sf,
            totalPlantingSeeds: totalSeeds,
          varietySeeds: seeds,
          varietyShare: share,
          assignmentType: isExplicit ? 'mix-direct' : 'mix-spec-default',
          mixName: mix.name,
        });
      }
    }
  }

  // Build aggregated results with order info
  const byVariety = buildVarietyResults(varietyContributions, varieties, seedOrders);
  const bySupplier = groupBySupplier(byVariety);

  const totalSeeds = byVariety.reduce((sum, v) => sum + v.seedsNeeded, 0);

  return {
    totalSeeds,
    varietyCount: byVariety.length,
    supplierCount: bySupplier.length,
    plantingsWithoutSeed,
    byVariety,
    bySupplier,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Add a planting's contribution to a variety's running list.
 */
function addContribution(
  totals: Map<string, PlantingSeedContribution[]>,
  varietyId: string,
  contribution: PlantingSeedContribution,
): void {
  const existing = totals.get(varietyId) ?? [];
  existing.push(contribution);
  totals.set(varietyId, existing);
}

/**
 * Build variety results from accumulated contributions.
 * Aggregates (seedsNeeded, plantingCount) are derived from contributions.
 * Integrates SeedOrder data to show ordering status.
 */
function buildVarietyResults(
  contributions: Map<string, PlantingSeedContribution[]>,
  varieties: Record<string, Variety>,
  seedOrders: Record<string, SeedOrder>
): VarietySeedResult[] {
  const results: VarietySeedResult[] = [];

  for (const [varietyId, contribs] of contributions.entries()) {
    const variety = varieties[varietyId];
    if (!variety) continue;

    // Derive aggregates from contributions — single source of truth
    const seedsNeeded = contribs.reduce((sum, c) => sum + c.varietySeeds, 0);
    const plantingCount = new Set(contribs.map(c => c.plantingId)).size;

    // Calculate weight needed using new density system
    const weightInfo = calculateWeightForSeeds(variety, seedsNeeded);

    // Legacy fields for backwards compatibility
    const ouncesNeeded = variety.seedsPerOz
      ? seedsNeeded / variety.seedsPerOz
      : undefined;

    // Get seed order if exists
    const orderId = getSeedOrderId(varietyId);
    const order = seedOrders[orderId];

    // Sort contributions by seeds descending for display
    const sortedContribs = [...contribs].sort((a, b) => b.varietySeeds - a.varietySeeds);

    // Build result
    const result: VarietySeedResult = {
      varietyId,
      varietyName: variety.name,
      crop: variety.crop,
      supplier: variety.supplier,
      organic: variety.organic,
      seedsNeeded,
      weightNeeded: weightInfo?.weight,
      weightUnit: weightInfo?.unit,
      seedsPerOz: variety.seedsPerOz,
      ouncesNeeded,
      website: variety.website,
      alreadyOwn: variety.alreadyOwn,
      plantingCount,
      contributions: sortedContribs,
    };

    // Add order info if available
    if (order) {
      const orderedAmount = getOrderedAmount(order);
      if (orderedAmount) {
        // Calculate seeds ordered from weight × density
        const seedsOrdered = calculateSeedsFromWeight(
          variety,
          orderedAmount.weight,
          orderedAmount.unit
        );

        if (seedsOrdered !== undefined) {
          // Calculate seeds from inventory (haveWeight)
          let seedsHave = 0;
          if (order.haveWeight && order.haveUnit) {
            const haveSeeds = calculateSeedsFromWeight(variety, order.haveWeight, order.haveUnit);
            if (haveSeeds !== undefined) {
              seedsHave = haveSeeds;
            }
          }

          result.order = {
            seedsOrdered,
            weightOrdered: orderedAmount.weight,
            orderUnit: orderedAmount.unit,
            productCost: order.productCost,
            quantity: order.quantity,
            haveWeight: order.haveWeight,
            haveUnit: order.haveUnit,
            productLink: order.productLink,
          };

          // Calculate if (have + order) meets need
          const totalSeeds = seedsHave + seedsOrdered;
          result.isEnough = totalSeeds >= seedsNeeded;
          result.shortageSeeds = Math.max(0, seedsNeeded - totalSeeds);
        }
      }
    }

    results.push(result);
  }

  return results.sort((a, b) => b.seedsNeeded - a.seedsNeeded);
}

/**
 * Group variety results by supplier for ordering.
 */
function groupBySupplier(varieties: VarietySeedResult[]): SupplierSeedResult[] {
  const supplierMap = new Map<string, VarietySeedResult[]>();

  for (const v of varieties) {
    const list = supplierMap.get(v.supplier) ?? [];
    list.push(v);
    supplierMap.set(v.supplier, list);
  }

  return Array.from(supplierMap.entries())
    .map(([supplier, vars]) => {
      const totalSeeds = vars.reduce((sum, v) => sum + v.seedsNeeded, 0);
      const hasAllOunces = vars.every((v) => v.ouncesNeeded !== undefined);
      const totalOunces = hasAllOunces
        ? vars.reduce((sum, v) => sum + (v.ouncesNeeded ?? 0), 0)
        : undefined;

      return {
        supplier,
        varieties: vars.sort((a, b) => a.crop.localeCompare(b.crop)),
        totalSeeds,
        totalOunces,
      };
    })
    .sort((a, b) => b.totalSeeds - a.totalSeeds);
}

// =============================================================================
// VARIETY USAGE ANALYSIS
// =============================================================================

/** Summary of everywhere a variety is referenced in a plan */
export interface VarietyUsageSummary {
  directPlantings: Array<{ id: string; specId: string; specName: string }>;
  specsWithDefault: Array<{ id: string; name: string; plantingCount: number }>;
  mixesContaining: Array<{ id: string; name: string; percent: number }>;
  hasOrder: boolean;
}

/** Scan a plan for all references to a given variety */
export function findVarietyUsages(plan: Plan, varietyId: string): VarietyUsageSummary {
  const specs = (plan as { specs?: Record<string, PlantingSpec> }).specs ?? {};
  const plantings = (plan as { plantings?: Planting[] }).plantings ?? [];
  const seedMixes = (plan as { seedMixes?: Record<string, SeedMix> }).seedMixes ?? {};
  const seedOrders = (plan as { seedOrders?: Record<string, SeedOrder> }).seedOrders ?? {};

  const directPlantings = plantings
    .filter(p => p.seedSource?.type === 'variety' && p.seedSource.id === varietyId)
    .map(p => ({
      id: p.id,
      specId: p.specId,
      specName: specs[p.specId]?.name ?? p.specId,
    }));

  const specsWithDefault = Object.values(specs)
    .filter(s => s.defaultSeedSource?.type === 'variety' && s.defaultSeedSource.id === varietyId)
    .map(s => ({
      id: s.id,
      name: s.name,
      plantingCount: plantings.filter(p =>
        p.specId === s.id && !p.seedSource && p.useDefaultSeedSource !== false
      ).length,
    }));

  const mixesContaining = Object.values(seedMixes)
    .filter(m => m.components.some(c => c.varietyId === varietyId))
    .map(m => {
      const comp = m.components.find(c => c.varietyId === varietyId)!;
      return { id: m.id, name: m.name, percent: comp.percent };
    });

  const hasOrder = !!seedOrders[getSeedOrderId(varietyId)];

  return { directPlantings, specsWithDefault, mixesContaining, hasOrder };
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

/**
 * Format a seed count for display (e.g., "1.5K", "2.3M").
 */
export function formatSeeds(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toLocaleString();
}

/**
 * Format ounces for display (converts to lb if >= 16oz).
 * @deprecated Use formatWeight instead
 */
export function formatOunces(oz: number): string {
  if (oz >= 16) {
    return `${(oz / 16).toFixed(2)} lb`;
  }
  return `${oz.toFixed(2)} oz`;
}

/**
 * Format weight with unit for display.
 * Automatically converts to larger units when appropriate.
 *
 * @param weight - Weight value
 * @param unit - Unit of measurement (g, oz, lb, ct)
 * @returns Formatted string like "2.5 oz" or "1,000 seeds"
 */
export function formatWeight(weight: number, unit: DensityUnit): string {
  if (unit === 'ct') {
    return `${Math.round(weight).toLocaleString()} seeds`;
  }

  if (unit === 'g') {
    if (weight >= 1000) {
      return `${(weight / 1000).toFixed(2)} kg`;
    }
    return `${weight.toFixed(1)} g`;
  }

  if (unit === 'oz') {
    if (weight >= 16) {
      return `${(weight / 16).toFixed(2)} lb`;
    }
    return `${weight.toFixed(2)} oz`;
  }

  if (unit === 'lb') {
    return `${weight.toFixed(2)} lb`;
  }

  return `${weight} ${unit}`;
}
