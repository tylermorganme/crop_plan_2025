/**
 * SeedMix Entity
 *
 * Represents a blend of multiple seed varieties.
 * Seed mixes are stored globally (not per-plan) and linked to plantings via seedSource.
 * Each component references a Variety by ID with a percentage.
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * A component of a seed mix - one variety with its percentage.
 */
export interface SeedMixComponent {
  /** Reference to Variety.id */
  varietyId: string;
  /** Percentage of the mix (0.0 to 1.0, e.g., 0.333 = 33.3%) */
  percent: number;
}

/**
 * A blend of multiple seed varieties.
 *
 * Design: SeedMix groups varieties together for ordering and tracking.
 * When a planting uses a mix, seed needs are split proportionally.
 */
export interface SeedMix {
  /** Unique mix identifier (UUID) */
  id: string;

  /** Display name (e.g., "Amaranth Mix", "Salad Mix Spring") */
  name: string;

  /** Crop name - all components should be same crop (e.g., "Amaranth", "Lettuce") */
  crop: string;

  /** Reference to Crop entity ID for stable linking (populated by migration) */
  cropId?: string;

  /** Components with their percentages (should sum to 1.0) */
  components: SeedMixComponent[];

  /** User notes about this mix */
  notes?: string;

  /** Whether this mix is deprecated (hidden from dropdowns unless already in use) */
  deprecated?: boolean;
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Generate a deterministic seed mix ID from content.
 * Format: SM_{contentKey} - uses the content key directly for consistency.
 * This ensures the same mix always gets the same ID across sessions.
 *
 * @param name - Mix name
 * @param crop - Crop name
 * @returns Deterministic ID in format "SM_{name}|{crop}"
 */
export function getSeedMixId(name: string, crop: string): string {
  return `SM_${name.toLowerCase().trim()}|${crop.toLowerCase().trim()}`;
}

/**
 * Get the content key for deduplication (without SM_ prefix).
 * Two mixes with the same name+crop are considered duplicates.
 */
export function getSeedMixContentKey(name: string, crop: string): string {
  return `${name.toLowerCase().trim()}|${crop.toLowerCase().trim()}`;
}

/**
 * Get the content key for an existing seed mix (without SM_ prefix).
 */
export function getSeedMixKey(mix: SeedMix): string {
  return getSeedMixContentKey(mix.name, mix.crop);
}

/**
 * Input for creating a new SeedMix.
 */
export interface CreateSeedMixInput {
  /** Optional ID (generated if not provided) */
  id?: string;
  /** Display name */
  name: string;
  /** Crop name */
  crop: string;
  /** Mix components */
  components: SeedMixComponent[];
  /** Notes */
  notes?: string;
  /** Deprecated (hidden from dropdowns) */
  deprecated?: boolean;
}

/**
 * Factory function for creating SeedMix objects.
 * ID is deterministic based on name+crop for consistency across sessions.
 */
export function createSeedMix(input: CreateSeedMixInput): SeedMix {
  return {
    id: input.id ?? getSeedMixId(input.name, input.crop),
    name: input.name,
    crop: input.crop,
    components: input.components,
    notes: input.notes,
    deprecated: input.deprecated,
  };
}

/**
 * Deep clone a seed mix (preserves ID).
 * Use this for creating backup copies.
 */
export function cloneSeedMix(source: SeedMix): SeedMix {
  return JSON.parse(JSON.stringify(source));
}

/**
 * Clone multiple seed mixes into a Record keyed by ID.
 */
export function cloneSeedMixes(
  sources: SeedMix[] | Record<string, SeedMix>
): Record<string, SeedMix> {
  const result: Record<string, SeedMix> = {};
  const arr = Array.isArray(sources) ? sources : Object.values(sources);
  for (const m of arr) {
    result[m.id] = cloneSeedMix(m);
  }
  return result;
}

/**
 * Validate that a seed mix's components sum to approximately 1.0.
 * Returns true if valid, false if percentages don't sum correctly.
 */
export function validateSeedMixPercentages(mix: SeedMix): boolean {
  const total = mix.components.reduce((sum, c) => sum + c.percent, 0);
  // Allow for floating point tolerance
  return Math.abs(total - 1.0) < 0.001;
}
