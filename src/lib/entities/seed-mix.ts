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

  /** Components with their percentages (should sum to 1.0) */
  components: SeedMixComponent[];

  /** User notes about this mix */
  notes?: string;
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Generate a unique seed mix ID.
 * Format: SM_{timestamp}_{random}
 */
export function generateSeedMixId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `SM_${timestamp}_${random}`;
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
}

/**
 * Factory function for creating SeedMix objects.
 */
export function createSeedMix(input: CreateSeedMixInput): SeedMix {
  return {
    id: input.id ?? generateSeedMixId(),
    name: input.name,
    crop: input.crop,
    components: input.components,
    notes: input.notes,
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
