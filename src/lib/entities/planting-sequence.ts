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
  /** Optional custom ID (defaults to generated S1, S2, etc.) */
  id?: string;
  /** Optional sequence name */
  name?: string;
  /** Days between each planting (required) */
  offsetDays: number;
}

// Simple counter for generating unique sequence IDs
let nextSequenceId = 1;

/**
 * Generate a unique sequence ID.
 * Format: S{sequential number} e.g., S1, S2, S3...
 */
export function generateSequenceId(): string {
  return `S${nextSequenceId++}`;
}

/**
 * Initialize the sequence ID counter based on existing sequences.
 * Call this when loading a plan to avoid ID collisions.
 */
export function initializeSequenceIdCounter(existingIds: string[]): void {
  let maxId = 0;
  for (const id of existingIds) {
    const match = id.match(/^S(\d+)$/);
    if (match) {
      maxId = Math.max(maxId, parseInt(match[1], 10));
    }
  }
  nextSequenceId = maxId + 1;
}

/**
 * Create a new PlantingSequence entity.
 */
export function createSequence(input: CreateSequenceInput): PlantingSequence {
  return {
    id: input.id ?? generateSequenceId(),
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
