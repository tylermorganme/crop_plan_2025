/**
 * Seed Calculation Module
 *
 * Calculates seeds needed per variety across all plantings in a plan.
 * Handles both direct variety assignments and seed mixes.
 * Groups results by supplier for ordering.
 */

import type { Plan } from './plan-types';
import type { Planting } from './entities/planting';
import type { CropConfig } from './entities/crop-config';
import type { Variety } from './entities/variety';
import type { SeedMix } from './entities/seed-mix';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default buffer for ordering (20% extra) */
export const DEFAULT_SEED_ORDER_BUFFER = 1.2;

/** Standard bed length for scaling seedsPerBed */
const STANDARD_BED_LENGTH = 50;

// =============================================================================
// TYPES
// =============================================================================

/** Aggregated seeds needed for a single variety across all plantings */
export interface VarietySeedResult {
  varietyId: string;
  varietyName: string;
  crop: string;
  supplier: string;
  organic: boolean;
  seedsNeeded: number;
  seedsPerOz?: number;
  ouncesNeeded?: number;
  website?: string;
  alreadyOwn?: boolean;
  /** Number of plantings using this variety */
  plantingCount: number;
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
 * Uses seedsPerBed if available (scaled by bedFeet/50),
 * otherwise calculates from spacing/rows/seedsPerPlanting.
 *
 * @param planting - The planting to calculate
 * @param config - The CropConfig for this planting
 * @param seedOrderBuffer - Buffer multiplier for ordering (default 1.2)
 * @returns Number of seeds needed (rounded up)
 */
export function calculateSeedsForPlanting(
  planting: Planting,
  config: CropConfig,
  seedOrderBuffer: number = DEFAULT_SEED_ORDER_BUFFER
): number {
  // If seedsPerBed is pre-calculated, use it (scaled by bed feet)
  if (config.seedsPerBed !== undefined && config.seedsPerBed > 0) {
    const bedsEquivalent = planting.bedFeet / STANDARD_BED_LENGTH;
    return Math.ceil(config.seedsPerBed * bedsEquivalent * seedOrderBuffer);
  }

  // Otherwise calculate from formula
  const rows = config.rows ?? 1;
  const spacing = config.spacing ?? 12;
  const seedsPerPlanting = config.seedsPerPlanting ?? 1;
  const safetyFactor = config.safetyFactor ?? 1;
  const seedingFactor = config.seedingFactor ?? 1;

  if (spacing <= 0) return 0;

  // plantingsPerBed = (12 / spacing) * rows * bedFeet
  const plantingsPerBed = (12 / spacing) * rows * planting.bedFeet;

  // seedsToPlant = plantingsPerBed * seedsPerPlanting * safetyFactor * seedingFactor
  const seedsToPlant = plantingsPerBed * seedsPerPlanting * safetyFactor * seedingFactor;

  return Math.ceil(seedsToPlant * seedOrderBuffer);
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
 * @param seedOrderBuffer - Buffer multiplier for ordering (default 1.2)
 * @returns Complete seed breakdown by variety and supplier
 */
export function calculatePlanSeeds(
  plan: Plan,
  seedOrderBuffer: number = DEFAULT_SEED_ORDER_BUFFER
): PlanSeedReport {
  // Accumulator: varietyId -> { seeds, plantingIds }
  const varietyTotals = new Map<string, { seeds: number; plantingIds: Set<string> }>();

  const plantings = plan.plantings ?? [];
  const cropCatalog = plan.cropCatalog ?? {};
  const varieties = plan.varieties ?? {};
  const seedMixes = plan.seedMixes ?? {};

  let plantingsWithoutSeed = 0;

  for (const planting of plantings) {
    const config = cropCatalog[planting.configId];
    if (!config) continue;

    // Resolve effective seed source:
    // - If useDefaultSeedSource=true, use config.defaultSeedSource
    // - Otherwise use planting.seedSource
    const effectiveSeedSource = planting.useDefaultSeedSource
      ? config.defaultSeedSource
      : planting.seedSource;

    // Check if planting has a seed source assigned (either explicit or default)
    if (!effectiveSeedSource) {
      plantingsWithoutSeed++;
      continue;
    }

    const totalSeeds = calculateSeedsForPlanting(planting, config, seedOrderBuffer);

    if (effectiveSeedSource.type === 'variety') {
      // Direct variety assignment
      const variety = varieties[effectiveSeedSource.id];
      if (!variety) {
        plantingsWithoutSeed++;
        continue;
      }

      addToVarietyTotals(varietyTotals, variety.id, totalSeeds, planting.id);
    } else if (effectiveSeedSource.type === 'mix') {
      // Seed mix - split proportionally
      const mix = seedMixes[effectiveSeedSource.id];
      if (!mix) {
        plantingsWithoutSeed++;
        continue;
      }

      const expanded = expandSeedMixToVarieties(totalSeeds, mix, varieties);

      for (const { varietyId, seeds } of expanded) {
        addToVarietyTotals(varietyTotals, varietyId, seeds, planting.id);
      }
    }
  }

  // Build aggregated results
  const byVariety = buildVarietyResults(varietyTotals, varieties);
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
 * Add seeds to a variety's running total.
 */
function addToVarietyTotals(
  totals: Map<string, { seeds: number; plantingIds: Set<string> }>,
  varietyId: string,
  seeds: number,
  plantingId: string
): void {
  const existing = totals.get(varietyId) ?? { seeds: 0, plantingIds: new Set() };
  existing.seeds += seeds;
  existing.plantingIds.add(plantingId);
  totals.set(varietyId, existing);
}

/**
 * Build variety results from accumulated totals.
 */
function buildVarietyResults(
  totals: Map<string, { seeds: number; plantingIds: Set<string> }>,
  varieties: Record<string, Variety>
): VarietySeedResult[] {
  const results: VarietySeedResult[] = [];

  for (const [varietyId, data] of totals.entries()) {
    const variety = varieties[varietyId];
    if (!variety) continue;

    const ouncesNeeded = variety.seedsPerOz
      ? data.seeds / variety.seedsPerOz
      : undefined;

    results.push({
      varietyId,
      varietyName: variety.name,
      crop: variety.crop,
      supplier: variety.supplier,
      organic: variety.organic,
      seedsNeeded: data.seeds,
      seedsPerOz: variety.seedsPerOz,
      ouncesNeeded,
      website: variety.website,
      alreadyOwn: variety.alreadyOwn,
      plantingCount: data.plantingIds.size,
    });
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
 */
export function formatOunces(oz: number): string {
  if (oz >= 16) {
    return `${(oz / 16).toFixed(2)} lb`;
  }
  return `${oz.toFixed(2)} oz`;
}
