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
  /** Stable UUID for references (plantings link here) */
  id: string;
  /** Display name (e.g., "A1", "West 3") - can be renamed without breaking links */
  name: string;
  /** Length in feet (50, 20, or 80) */
  lengthFt: number;
  /** Reference to BedGroup.id */
  groupId: string;
  /** Order within the group (0-indexed) */
  displayOrder: number;
}

/** A group of beds (e.g., "Row A", "West Field") */
export interface BedGroup {
  /** Stable UUID */
  id: string;
  /** Display name (e.g., "Row A", "West Field") */
  name: string;
  /** Order of this group in timeline display */
  displayOrder: number;
}

/**
 * Legacy ResourceGroup for timeline display compatibility.
 * @deprecated Use BedGroup instead - this is computed for timeline rendering
 */
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
// CRUD OPERATIONS
// =============================================================================

/**
 * Create a new BedGroup with a generated UUID.
 * This is the single source of truth for creating bed groups.
 */
export function createBedGroup(
  name: string,
  displayOrder: number
): BedGroup {
  return {
    id: generateBedUuid(),
    name,
    displayOrder,
  };
}

/**
 * Create a new Bed with a generated UUID.
 * This is the single source of truth for creating beds.
 */
export function createBed(
  name: string,
  groupId: string,
  lengthFt: number,
  displayOrder: number
): Bed {
  return {
    id: generateBedUuid(),
    name,
    lengthFt,
    groupId,
    displayOrder,
  };
}

// =============================================================================
// HELPER FUNCTIONS
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
 * Generate a UUID for beds and groups.
 */
export function generateBedUuid(): string {
  return crypto.randomUUID();
}

/**
 * Result of creating beds from template - includes both beds and groups.
 */
export interface BedsFromTemplateResult {
  beds: Record<string, Bed>;
  groups: Record<string, BedGroup>;
  /** Maps old bed names (e.g., "A1") to new UUIDs for migration */
  nameToIdMap: Record<string, string>;
}

/**
 * Create beds and groups from a bedGroups template (from bed-plan.json).
 * This is a thin shim that uses the CRUD operations.
 *
 * @param bedGroupsTemplate - Map of row names to bed names (e.g., { "A": ["A1", "A2", ...] })
 * @returns Beds, groups, and a name-to-ID mapping for migration
 */
export function createBedsFromTemplate(
  bedGroupsTemplate: Record<string, string[]>
): BedsFromTemplateResult {
  const beds: Record<string, Bed> = {};
  const groups: Record<string, BedGroup> = {};
  const nameToIdMap: Record<string, string> = {};

  // Sort group names to establish display order
  const sortedGroupNames = Object.keys(bedGroupsTemplate).sort((a, b) =>
    a.localeCompare(b)
  );

  for (let groupIndex = 0; groupIndex < sortedGroupNames.length; groupIndex++) {
    const groupName = sortedGroupNames[groupIndex];
    const bedNames = bedGroupsTemplate[groupName];
    const lengthFt = ROW_LENGTHS[groupName] ?? DEFAULT_BED_LENGTH;

    // Use CRUD operation to create group
    const group = createBedGroup(`Row ${groupName}`, groupIndex);
    groups[group.id] = group;

    // Sort bed names by number within group
    const sortedBedNames = [...bedNames].sort(
      (a, b) => getBedNumber(a) - getBedNumber(b)
    );

    // Use CRUD operation to create each bed
    for (let bedIndex = 0; bedIndex < sortedBedNames.length; bedIndex++) {
      const bedName = sortedBedNames[bedIndex];
      const bed = createBed(bedName, group.id, lengthFt, bedIndex);
      beds[bed.id] = bed;
      nameToIdMap[bedName] = bed.id;
    }
  }

  return { beds, groups, nameToIdMap };
}

/**
 * Derive the ordered list of bed names for timeline display.
 * Uses displayOrder from beds and groups for stable ordering.
 * Returns bed.name (display name) not bed.id (UUID).
 */
export function deriveResources(
  beds: Record<string, Bed>,
  groups: Record<string, BedGroup>
): string[] {
  return Object.values(beds)
    .sort((a, b) => {
      const groupA = groups[a.groupId];
      const groupB = groups[b.groupId];
      // Sort by group displayOrder first
      if (groupA?.displayOrder !== groupB?.displayOrder) {
        return (groupA?.displayOrder ?? 0) - (groupB?.displayOrder ?? 0);
      }
      // Then by bed displayOrder within group
      return a.displayOrder - b.displayOrder;
    })
    .map(bed => bed.name);
}

/**
 * Derive ResourceGroup array from beds and groups for timeline display.
 * Uses displayOrder for stable ordering.
 * Returns bed.name (display name) not bed.id (UUID).
 */
export function deriveGroups(
  beds: Record<string, Bed>,
  groups: Record<string, BedGroup>
): ResourceGroup[] {
  // Group beds by groupId
  const groupMap = new Map<string, Bed[]>();

  for (const bed of Object.values(beds)) {
    if (!groupMap.has(bed.groupId)) {
      groupMap.set(bed.groupId, []);
    }
    groupMap.get(bed.groupId)!.push(bed);
  }

  // Sort groups by displayOrder, then beds within each group
  return Array.from(groupMap.entries())
    .sort(([groupIdA], [groupIdB]) => {
      const groupA = groups[groupIdA];
      const groupB = groups[groupIdB];
      return (groupA?.displayOrder ?? 0) - (groupB?.displayOrder ?? 0);
    })
    .map(([groupId, bedsInGroup]) => ({
      name: groups[groupId]?.name ?? null,
      beds: bedsInGroup
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map(bed => bed.name),
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

/**
 * Get bed length from just a bed ID string, using ROW_LENGTHS lookup.
 * Use this for import/template contexts only - runtime code should use plan.beds.
 */
export function getBedLengthFromId(bedId: string): number {
  const group = getBedGroup(bedId);
  return ROW_LENGTHS[group] ?? DEFAULT_BED_LENGTH;
}

/**
 * Build a bed lengths map from template bed names.
 * Use this for import/template contexts only - runtime code should use plan.beds.
 *
 * @param bedNames - Array of bed names from template (e.g., ["A1", "A2", "B1"])
 * @returns Mapping of bed name -> length in feet
 */
export function buildBedLengthsFromTemplate(bedNames: string[]): Record<string, number> {
  const bedLengths: Record<string, number> = {};
  for (const bed of bedNames) {
    bedLengths[bed] = getBedLengthFromId(bed);
  }
  return bedLengths;
}

// =============================================================================
// CLONE FUNCTIONS
// =============================================================================

/**
 * Clone a Bed, preserving all fields including UUID.
 * Use this when duplicating a plan's beds.
 */
export function cloneBed(source: Bed): Bed {
  return { ...source };
}

/**
 * Clone a BedGroup, preserving all fields including UUID.
 * Use this when duplicating a plan's bed groups.
 */
export function cloneBedGroup(source: BedGroup): BedGroup {
  return { ...source };
}

/**
 * Clone all beds from a plan.
 * Returns a new Record with cloned Bed objects.
 */
export function cloneBeds(beds: Record<string, Bed>): Record<string, Bed> {
  const result: Record<string, Bed> = {};
  for (const [id, bed] of Object.entries(beds)) {
    result[id] = cloneBed(bed);
  }
  return result;
}

/**
 * Clone all bed groups from a plan.
 * Returns a new Record with cloned BedGroup objects.
 */
export function cloneBedGroups(
  groups: Record<string, BedGroup>
): Record<string, BedGroup> {
  const result: Record<string, BedGroup> = {};
  for (const [id, group] of Object.entries(groups)) {
    result[id] = cloneBedGroup(group);
  }
  return result;
}
