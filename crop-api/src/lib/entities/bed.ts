/**
 * Bed Entity
 *
 * Represents a single bed in the farm layout with its physical properties.
 * Each plan owns its beds, allowing different bed configurations per season.
 */

// =============================================================================
// TYPES
// =============================================================================

/** A single bed in the farm layout */
export interface Bed {
  /** Unique bed identifier (e.g., "A1", "F3", "X2") */
  id: string;
  /** Length in feet (50, 20, or 80) */
  lengthFt: number;
  /** Row/section group (e.g., "A", "F", "X") */
  group: string;
}

/** A group of beds (e.g., row "A" contains beds A1-A8) */
export interface ResourceGroup {
  name: string | null;
  beds: string[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Canonical bed lengths by row.
 *
 * - F, J: 20ft (short rows)
 * - A-E, G-I, U: 50ft (standard field rows)
 * - X: 80ft (greenhouse beds)
 */
export const ROW_LENGTHS: Record<string, number> = {
  A: 50,
  B: 50,
  C: 50,
  D: 50,
  E: 50,
  F: 20,
  G: 50,
  H: 50,
  I: 50,
  J: 20,
  U: 50,
  X: 80,
};

/** Default bed length when row is unknown */
const DEFAULT_BED_LENGTH = 50;

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Extract the row/group from a bed ID.
 * e.g., "A5" -> "A", "GH1" -> "GH", "X2" -> "X"
 */
export function getBedGroup(bedId: string): string {
  let group = '';
  for (const char of bedId) {
    if (char.match(/[A-Za-z]/)) {
      group += char;
    } else {
      break;
    }
  }
  return group;
}

/**
 * Get the bed number from a bed ID.
 * e.g., "A5" -> 5, "X2" -> 2
 */
export function getBedNumber(bedId: string): number {
  const match = bedId.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

/**
 * Create beds from a bedGroups template (from bed-plan.json).
 *
 * @param bedGroups - Map of row names to bed IDs (e.g., { "A": ["A1", "A2", ...] })
 * @returns Map of bed IDs to Bed objects
 */
export function createBedsFromTemplate(
  bedGroups: Record<string, string[]>
): Record<string, Bed> {
  const beds: Record<string, Bed> = {};

  for (const [group, bedIds] of Object.entries(bedGroups)) {
    const lengthFt = ROW_LENGTHS[group] ?? DEFAULT_BED_LENGTH;

    for (const bedId of bedIds) {
      beds[bedId] = {
        id: bedId,
        lengthFt,
        group,
      };
    }
  }

  return beds;
}

/**
 * Derive the ordered list of bed IDs for timeline display.
 * Sorted by group (alphabetically) then by bed number.
 */
export function deriveResources(beds: Record<string, Bed>): string[] {
  return Object.keys(beds).sort((a, b) => {
    const groupA = getBedGroup(a);
    const groupB = getBedGroup(b);
    if (groupA !== groupB) return groupA.localeCompare(groupB);
    return getBedNumber(a) - getBedNumber(b);
  });
}

/**
 * Derive ResourceGroup array from beds map for timeline display.
 * Groups beds by their group property, sorted alphabetically.
 */
export function deriveGroups(beds: Record<string, Bed>): ResourceGroup[] {
  const groupMap = new Map<string, string[]>();

  for (const bed of Object.values(beds)) {
    const group = bed.group;
    if (!groupMap.has(group)) {
      groupMap.set(group, []);
    }
    groupMap.get(group)!.push(bed.id);
  }

  return Array.from(groupMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, bedIds]) => ({
      name: `Row ${group}`,
      beds: bedIds.sort((a, b) => getBedNumber(a) - getBedNumber(b)),
    }));
}

/**
 * Get the length of a specific bed from the beds map.
 * Throws if bed is not found.
 */
export function getBedLength(beds: Record<string, Bed>, bedId: string): number {
  const bed = beds[bedId];
  if (!bed) {
    throw new Error(`Bed not found: ${bedId}`);
  }
  return bed.lengthFt;
}
