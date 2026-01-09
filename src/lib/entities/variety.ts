/**
 * Variety Entity
 *
 * Represents a specific seed variety from a supplier.
 * Varieties are stored globally (not per-plan) and linked to plantings via seedSource.
 * Connection to CropConfig is by crop name (Variety.crop === CropConfig.crop).
 */

// =============================================================================
// TYPES
// =============================================================================

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

  /** Seeds per ounce for ordering calculations */
  seedsPerOz?: number;

  /** Link to seed catalog page */
  website?: string;

  /** User notes about this variety */
  notes?: string;

  /** Whether we already own/have this variety in inventory */
  alreadyOwn?: boolean;
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Generate a unique variety ID.
 * Format: V_{timestamp}_{random}
 */
export function generateVarietyId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `V_${timestamp}_${random}`;
}

/**
 * Generate a content-based key for deduplication.
 * Two varieties with the same crop+name+supplier are considered duplicates.
 * Used during import to detect existing varieties.
 */
export function getVarietyContentKey(crop: string, name: string, supplier: string): string {
  return `${crop}|${name}|${supplier}`.toLowerCase().trim();
}

/**
 * Get the content key for an existing variety.
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
  /** Seeds per ounce */
  seedsPerOz?: number;
  /** Catalog link */
  website?: string;
  /** Notes */
  notes?: string;
  /** Already in inventory */
  alreadyOwn?: boolean;
}

/**
 * Factory function for creating Variety objects.
 */
export function createVariety(input: CreateVarietyInput): Variety {
  return {
    id: input.id ?? generateVarietyId(),
    crop: input.crop,
    name: input.name,
    supplier: input.supplier,
    organic: input.organic ?? false,
    pelleted: input.pelleted ?? false,
    pelletedApproved: input.pelletedApproved,
    dtm: input.dtm,
    seedsPerOz: input.seedsPerOz,
    website: input.website,
    notes: input.notes,
    alreadyOwn: input.alreadyOwn,
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
