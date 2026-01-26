/**
 * Variety Entity
 *
 * Represents a specific seed variety from a supplier.
 * Varieties are stored globally (not per-plan) and linked to plantings via seedSource.
 * Connection to CropConfig is by crop name (Variety.crop === CropConfig.crop).
 */

import convert from 'convert-units';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Unit for seed density measurements.
 * - g: grams (metric)
 * - oz: ounces (imperial)
 * - lb: pounds (imperial)
 * - ct: count (for seeds sold by count, e.g., pelleted)
 */
export type DensityUnit = 'g' | 'oz' | 'lb' | 'ct';

/**
 * A seed variety from a specific supplier.
 *
 * Design: Varieties are the actual seeds you can buy/plant.
 * CropConfig defines HOW to grow (timing, spacing).
 * Variety defines WHAT seed to use (supplier, organic status, etc.).
 */
export interface Variety {
  /** Unique variety identifier (UUID) */
  id: string;

  /** Crop name - matches CropConfig.crop for filtering (e.g., "Tomato", "Arugula") */
  crop: string;

  /** Reference to Crop entity ID for stable linking (populated by migration) */
  cropId?: string;

  /** Variety/cultivar name (e.g., "San Marzano", "Astro") */
  name: string;

  /** Seed supplier/company (e.g., "Johnny's", "High Mowing", "Uprising") */
  supplier: string;

  /** Whether this variety is certified organic */
  organic: boolean;

  /** Whether seeds are pelleted */
  pelleted: boolean;

  /** Whether pelleted seeds meet organic standards */
  pelletedApproved?: boolean;

  /** Variety-specific days to maturity (optional override) */
  dtm?: number;

  /**
   * Seed density - number of seeds per densityUnit.
   * E.g., density=6000, densityUnit='oz' means 6000 seeds per ounce.
   */
  density?: number;

  /**
   * Unit for seed density measurement.
   * 'ct' means seeds are sold/measured by count (no weight conversion).
   */
  densityUnit?: DensityUnit;

  /**
   * @deprecated Use density + densityUnit instead.
   * Seeds per ounce for ordering calculations.
   * Kept for backwards compatibility with existing data.
   */
  seedsPerOz?: number;

  /** Link to seed catalog page */
  website?: string;

  /** User notes about this variety */
  notes?: string;

  /** Whether we already own/have this variety in inventory */
  alreadyOwn?: boolean;

  /** Whether this variety is deprecated (hidden from dropdowns unless already in use) */
  deprecated?: boolean;
}

// =============================================================================
// DENSITY CONVERSION HELPERS
// =============================================================================

/**
 * Convert a mass value from one unit to another.
 * Does not handle 'ct' (count) - caller should check for count-only varieties.
 */
export function convertMass(value: number, from: 'g' | 'oz' | 'lb', to: 'g' | 'oz' | 'lb'): number {
  if (from === to) return value;
  return convert(value).from(from).to(to);
}

/**
 * Get the seeds per gram for a variety (normalized density).
 * Returns undefined if density is not set or if it's count-only.
 */
export function getSeedsPerGram(variety: Variety): number | undefined {
  // Try new density fields first
  if (variety.density !== undefined && variety.densityUnit) {
    if (variety.densityUnit === 'ct') {
      return undefined; // Count-only, no weight conversion
    }
    // Convert to seeds per gram
    const gramsPerUnit = convertMass(1, variety.densityUnit, 'g');
    return variety.density / gramsPerUnit;
  }

  // Fall back to legacy seedsPerOz
  if (variety.seedsPerOz !== undefined) {
    const gramsPerOz = convertMass(1, 'oz', 'g');
    return variety.seedsPerOz / gramsPerOz;
  }

  return undefined;
}

/**
 * Calculate how much weight is needed for a given number of seeds.
 * Returns the weight in the variety's native densityUnit.
 *
 * @param variety - The variety with density info
 * @param seedCount - Number of seeds needed
 * @returns { weight, unit } or undefined if density not available
 */
export function calculateWeightForSeeds(
  variety: Variety,
  seedCount: number
): { weight: number; unit: DensityUnit } | undefined {
  if (variety.density === undefined || !variety.densityUnit) {
    // Try legacy field
    if (variety.seedsPerOz !== undefined) {
      return {
        weight: seedCount / variety.seedsPerOz,
        unit: 'oz',
      };
    }
    return undefined;
  }

  if (variety.densityUnit === 'ct') {
    // Count-only - just return the count
    return { weight: seedCount, unit: 'ct' };
  }

  // Calculate weight in native unit
  return {
    weight: seedCount / variety.density,
    unit: variety.densityUnit,
  };
}

/**
 * Calculate how many seeds are in a given weight.
 *
 * @param variety - The variety with density info
 * @param weight - Weight value
 * @param unit - Unit of the weight
 * @returns Number of seeds, or undefined if density not available
 */
export function calculateSeedsFromWeight(
  variety: Variety,
  weight: number,
  unit: DensityUnit
): number | undefined {
  if (variety.density === undefined || !variety.densityUnit) {
    // Try legacy field
    if (variety.seedsPerOz !== undefined && unit !== 'ct') {
      const weightInOz = unit === 'oz' ? weight : convertMass(weight, unit as 'g' | 'lb', 'oz');
      return weightInOz * variety.seedsPerOz;
    }
    return undefined;
  }

  if (variety.densityUnit === 'ct') {
    // Count-only variety
    if (unit === 'ct') {
      return weight; // Already a count
    }
    return undefined; // Can't convert weight to count for count-only variety
  }

  if (unit === 'ct') {
    return undefined; // Can't use count input with weight-based variety
  }

  // Convert input weight to variety's native unit
  const weightInNativeUnit = convertMass(weight, unit, variety.densityUnit);
  return weightInNativeUnit * variety.density;
}

/**
 * Format density for display.
 * E.g., "6,000 seeds/oz" or "250 seeds/g" or "Count only"
 */
export function formatDensity(variety: Variety): string {
  if (variety.density !== undefined && variety.densityUnit) {
    if (variety.densityUnit === 'ct') {
      return 'Count only';
    }
    return `${variety.density.toLocaleString()} seeds/${variety.densityUnit}`;
  }

  if (variety.seedsPerOz !== undefined) {
    return `${variety.seedsPerOz.toLocaleString()} seeds/oz`;
  }

  return 'No density data';
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Generate a deterministic variety ID from content.
 * Format: V_{contentKey} - uses the content key directly for consistency.
 * This ensures the same variety always gets the same ID across sessions.
 *
 * @param crop - Crop name
 * @param name - Variety name
 * @param supplier - Supplier/company name
 * @returns Deterministic ID in format "V_{crop}|{name}|{supplier}"
 */
export function getVarietyId(crop: string, name: string, supplier: string): string {
  return `V_${crop.toLowerCase().trim()}|${name.toLowerCase().trim()}|${supplier.toLowerCase().trim()}`;
}

/**
 * Get the content key for deduplication (without V_ prefix).
 * Two varieties with the same crop+name+supplier are considered duplicates.
 */
export function getVarietyContentKey(crop: string, name: string, supplier: string): string {
  return `${crop.toLowerCase().trim()}|${name.toLowerCase().trim()}|${supplier.toLowerCase().trim()}`;
}

/**
 * Get the content key for an existing variety (without V_ prefix).
 */
export function getVarietyKey(variety: Variety): string {
  return getVarietyContentKey(variety.crop, variety.name, variety.supplier);
}

/**
 * Input for creating a new Variety.
 */
export interface CreateVarietyInput {
  /** Optional ID (generated if not provided) */
  id?: string;
  /** Crop name */
  crop: string;
  /** Variety name */
  name: string;
  /** Supplier/company */
  supplier: string;
  /** Organic certified */
  organic?: boolean;
  /** Pelleted seeds */
  pelleted?: boolean;
  /** Pelleted meets organic standards */
  pelletedApproved?: boolean;
  /** Days to maturity */
  dtm?: number;
  /** Seed density (seeds per densityUnit) */
  density?: number;
  /** Unit for density measurement */
  densityUnit?: DensityUnit;
  /**
   * @deprecated Use density + densityUnit instead.
   * Seeds per ounce
   */
  seedsPerOz?: number;
  /** Catalog link */
  website?: string;
  /** Notes */
  notes?: string;
  /** Already in inventory */
  alreadyOwn?: boolean;
  /** Deprecated (hidden from dropdowns) */
  deprecated?: boolean;
}

/**
 * Factory function for creating Variety objects.
 * ID is deterministic based on crop+name+supplier for consistency across sessions.
 */
export function createVariety(input: CreateVarietyInput): Variety {
  return {
    id: input.id ?? getVarietyId(input.crop, input.name, input.supplier),
    crop: input.crop,
    name: input.name,
    supplier: input.supplier,
    organic: input.organic ?? false,
    pelleted: input.pelleted ?? false,
    pelletedApproved: input.pelletedApproved,
    dtm: input.dtm,
    density: input.density,
    densityUnit: input.densityUnit,
    seedsPerOz: input.seedsPerOz,
    website: input.website,
    notes: input.notes,
    alreadyOwn: input.alreadyOwn,
    deprecated: input.deprecated,
  };
}

/**
 * Deep clone a variety (preserves ID).
 * Use this for creating backup copies.
 */
export function cloneVariety(source: Variety): Variety {
  return JSON.parse(JSON.stringify(source));
}

/**
 * Clone multiple varieties into a Record keyed by ID.
 */
export function cloneVarieties(
  sources: Variety[] | Record<string, Variety>
): Record<string, Variety> {
  const result: Record<string, Variety> = {};
  const arr = Array.isArray(sources) ? sources : Object.values(sources);
  for (const v of arr) {
    result[v.id] = cloneVariety(v);
  }
  return result;
}
