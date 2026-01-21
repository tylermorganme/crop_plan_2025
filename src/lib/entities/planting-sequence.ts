/**
 * PlantingSequence Entity
 *
 * A sequence links multiple plantings temporally (succession planting).
 * Each planting in the sequence has its fieldStartDate calculated as:
 *   anchor.fieldStartDate + (index * offsetDays)
 *
 * Key concepts:
 * - Anchor: The first planting (index 0) - owns its own fieldStartDate
 * - Followers: Subsequent plantings (index > 0) - dates calculated from anchor
 * - Offset: Days between each planting's fieldStartDate
 *
 * Sequences are orthogonal to bed-spanning - a planting can both be in
 * a sequence AND span multiple beds.
 */

export interface PlantingSequence {
  /** Unique sequence identifier (UUID) */
  id: string;

  /** Optional user-friendly name (e.g., "Spring Cilantro Succession") */
  name?: string;

  /** Days between each planting's fieldStartDate */
  offsetDays: number;
}

export interface CreateSequenceInput {
  /** Optional custom ID (defaults to UUID) */
  id?: string;
  /** Optional sequence name */
  name?: string;
  /** Days between each planting (required) */
  offsetDays: number;
}

/**
 * Create a new PlantingSequence entity.
 */
export function createSequence(input: CreateSequenceInput): PlantingSequence {
  return {
    id: input.id ?? crypto.randomUUID(),
    name: input.name,
    offsetDays: input.offsetDays,
  };
}

/**
 * Clone a sequence with optional overrides.
 * Generates a new ID by default.
 */
export function cloneSequence(
  source: PlantingSequence,
  overrides?: Partial<PlantingSequence>
): PlantingSequence {
  return {
    id: crypto.randomUUID(),
    name: source.name,
    offsetDays: source.offsetDays,
    ...overrides,
  };
}
