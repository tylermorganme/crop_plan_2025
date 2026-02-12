/**
 * Seed Unit Conversion
 *
 * Universal conversion between mass units (g, oz, lb) and seed count (ct).
 * Density (seeds per mass unit) bridges the mass ↔ count boundary.
 *
 * Usage:
 *   convertSeedQuantity(2.93, 'g', 'ct', { seedsPerUnit: 6000, unit: 'oz' })
 *   convertSeedQuantity(100, 'g', 'oz')  // mass-to-mass, no density needed
 *   convertSeedQuantity(500, 'ct', 'oz', { seedsPerUnit: 6000, unit: 'oz' })
 */

import convert from 'convert-units';

// =============================================================================
// TYPES
// =============================================================================

/** Mass units we support */
export type MassUnit = 'g' | 'oz' | 'lb';

/** All seed quantity units: mass + count */
export type SeedUnit = MassUnit | 'ct';

/**
 * Density: the bridge between mass and count.
 * Expressed as "X seeds per 1 unit of mass".
 * E.g., { seedsPerUnit: 6000, unit: 'oz' } = 6,000 seeds per ounce.
 */
export interface SeedDensity {
  seedsPerUnit: number;
  unit: MassUnit;
}

// =============================================================================
// MASS CONVERSION
// =============================================================================

/** Convert between mass units (g, oz, lb). */
export function convertMass(value: number, from: MassUnit, to: MassUnit): number {
  if (from === to) return value;
  return convert(value).from(from).to(to);
}

// =============================================================================
// MASS ↔ COUNT CONVERSION
// =============================================================================

/** Convert a mass value to seed count using density. */
export function massToSeeds(mass: number, massUnit: MassUnit, density: SeedDensity): number {
  const massInDensityUnit = convertMass(mass, massUnit, density.unit);
  return massInDensityUnit * density.seedsPerUnit;
}

/** Convert a seed count to mass using density. */
export function seedsToMass(seeds: number, density: SeedDensity, targetUnit: MassUnit): number {
  const massInDensityUnit = seeds / density.seedsPerUnit;
  return convertMass(massInDensityUnit, density.unit, targetUnit);
}

// =============================================================================
// UNIVERSAL CONVERSION
// =============================================================================

/**
 * Convert a seed quantity between any supported units.
 *
 * - Mass ↔ Mass (g/oz/lb): no density needed.
 * - Mass ↔ Count: density required, returns undefined if missing.
 * - Count ↔ Count: identity.
 *
 * Returns undefined when the conversion is impossible (missing density).
 */
export function convertSeedQuantity(
  value: number,
  from: SeedUnit,
  to: SeedUnit,
  density?: SeedDensity,
): number | undefined {
  if (from === to) return value;

  const fromIsCount = from === 'ct';
  const toIsCount = to === 'ct';

  // Mass → Mass
  if (!fromIsCount && !toIsCount) {
    return convertMass(value, from, to);
  }

  // Need density to cross the mass ↔ count boundary
  if (!density) return undefined;

  // Mass → Count
  if (!fromIsCount && toIsCount) {
    return massToSeeds(value, from, density);
  }

  // Count → Mass
  if (fromIsCount && !toIsCount) {
    return seedsToMass(value, density, to);
  }

  return undefined;
}

// =============================================================================
// VARIETY DENSITY EXTRACTION
// =============================================================================

/**
 * Extract a SeedDensity from variety density fields.
 * Returns undefined for count-only varieties or missing density data.
 */
export function getVarietyDensity(variety: {
  density?: number;
  densityUnit?: string;
  seedsPerOz?: number;
}): SeedDensity | undefined {
  // New density fields
  if (variety.density !== undefined && variety.densityUnit) {
    if (variety.densityUnit === 'ct') return undefined; // Count-only, no mass↔count bridge
    return { seedsPerUnit: variety.density, unit: variety.densityUnit as MassUnit };
  }

  // Legacy field
  if (variety.seedsPerOz !== undefined) {
    return { seedsPerUnit: variety.seedsPerOz, unit: 'oz' };
  }

  return undefined;
}
