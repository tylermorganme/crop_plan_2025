/**
 * Migration System
 *
 * Handles schema evolution for Plan data with long-term backwards compatibility.
 * Old plan files (any version) can be opened by current app.
 *
 * Rules:
 * - Migrations are append-only, never modify existing
 * - Each migration is a pure function (plan: unknown) => unknown
 * - Never reference current Plan type in migrations (use raw objects)
 * - Run migrations sequentially: v1→v2→v3→...
 */

import type { Plan } from '../entities/plan';
import type { Bed, BedGroup } from '../entities/bed';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Migration function signature.
 * Takes raw plan data (unknown) and returns migrated data.
 * Never reference current types - migrations must be frozen in time.
 */
type MigrationFn = (plan: unknown) => unknown;

// =============================================================================
// MIGRATION FUNCTIONS
// =============================================================================

/**
 * v1 → v2: No-op placeholder
 * v1 and v2 plans are structurally identical for our purposes.
 * This exists to maintain the index = fromVersion - 1 relationship.
 */
function migrateV1ToV2(plan: unknown): unknown {
  return plan;
}

/**
 * Legacy bed format (schema v2 and earlier).
 * Used for v2→v3 migration only.
 */
interface LegacyBed {
  id: string;
  lengthFt: number;
  group: string;
}

/**
 * v2 → v3: Bed UUID migration
 * - Convert bed IDs from names (e.g., "A1") to UUIDs
 * - Create BedGroup entities from implicit groups
 * - Update planting.startBed references to use UUIDs
 */
function migrateV2ToV3(rawPlan: unknown): unknown {
  const plan = rawPlan as {
    beds?: Record<string, LegacyBed>;
    bedGroups?: Record<string, BedGroup>;
    plantings?: Array<{ startBed?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };

  if (!plan.beds) {
    return plan;
  }

  // Check if already migrated (beds have groupId instead of group)
  const firstBed = Object.values(plan.beds)[0];
  if (firstBed && 'groupId' in firstBed) {
    return plan; // Already has new format
  }

  // Cast old beds to legacy format
  const legacyBeds = plan.beds as Record<string, LegacyBed>;

  // Build mapping from old bed names to new UUIDs
  const nameToUuid: Record<string, string> = {};
  const newBeds: Record<string, Bed> = {};
  const newGroups: Record<string, BedGroup> = {};

  // Group legacy beds by their group property
  const groupedBeds = new Map<string, LegacyBed[]>();
  for (const bed of Object.values(legacyBeds)) {
    if (!groupedBeds.has(bed.group)) {
      groupedBeds.set(bed.group, []);
    }
    groupedBeds.get(bed.group)!.push(bed);
  }

  // Sort group names for stable ordering
  const sortedGroupNames = Array.from(groupedBeds.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  // Create BedGroups and migrate beds
  for (let groupIndex = 0; groupIndex < sortedGroupNames.length; groupIndex++) {
    const groupName = sortedGroupNames[groupIndex];
    const groupId = crypto.randomUUID();

    // Create the group
    newGroups[groupId] = {
      id: groupId,
      name: `Row ${groupName}`,
      displayOrder: groupIndex,
    };

    // Sort beds within group by number
    const bedsInGroup = groupedBeds.get(groupName)!;
    bedsInGroup.sort((a, b) => {
      const numA = parseInt(a.id.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.id.replace(/\D/g, '')) || 0;
      return numA - numB;
    });

    // Create new beds with UUIDs
    for (let bedIndex = 0; bedIndex < bedsInGroup.length; bedIndex++) {
      const legacyBed = bedsInGroup[bedIndex];
      const bedId = crypto.randomUUID();

      nameToUuid[legacyBed.id] = bedId;

      newBeds[bedId] = {
        id: bedId,
        name: legacyBed.id, // Old ID becomes the display name
        lengthFt: legacyBed.lengthFt,
        groupId,
        displayOrder: bedIndex,
      };
    }
  }

  // Update planting references
  const migratedPlantings = plan.plantings?.map(planting => {
    if (planting.startBed && nameToUuid[planting.startBed]) {
      return {
        ...planting,
        startBed: nameToUuid[planting.startBed],
      };
    }
    return planting;
  });

  return {
    ...plan,
    beds: newBeds,
    bedGroups: newGroups,
    plantings: migratedPlantings,
  };
}

/**
 * v3 → v4: Add products field
 * Simply adds an empty products record if not present.
 * No data transformation needed (additive change).
 */
function migrateV3ToV4(rawPlan: unknown): unknown {
  const plan = rawPlan as { products?: Record<string, unknown>; [key: string]: unknown };

  if (plan.products !== undefined) {
    return plan; // Already has products field
  }

  return {
    ...plan,
    products: {},
  };
}

// =============================================================================
// MIGRATION ARRAY
// =============================================================================

/**
 * Ordered array of migrations.
 *
 * Index N contains the migration from version N+1 to version N+2:
 * - migrations[0] = v1 → v2
 * - migrations[1] = v2 → v3
 * - migrations[2] = v3 → v4
 *
 * To add a new migration:
 * 1. Create the migration function above
 * 2. Append it to this array
 * 3. CURRENT_SCHEMA_VERSION automatically updates
 */
const migrations: MigrationFn[] = [
  migrateV1ToV2, // Index 0: v1 → v2
  migrateV2ToV3, // Index 1: v2 → v3
  migrateV3ToV4, // Index 2: v3 → v4
];

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Current schema version, derived from migrations array.
 * Version = number of migrations + 1 (since we start at v1).
 */
export const CURRENT_SCHEMA_VERSION = migrations.length + 1;

/**
 * Migrate a plan from any older schema version to the current version.
 *
 * Runs all necessary migrations sequentially (stepwise upgrade).
 * A v1 plan will run through v1→v2→v3→v4→...→current.
 *
 * @param rawPlan - Plan data with unknown schema version
 * @returns Plan migrated to current schema version
 */
export function migratePlan(rawPlan: unknown): Plan {
  const plan = rawPlan as { schemaVersion?: number; [key: string]: unknown };
  const startVersion = plan.schemaVersion ?? 1;

  // Already up to date
  if (startVersion >= CURRENT_SCHEMA_VERSION) {
    return rawPlan as Plan;
  }

  // Run migrations sequentially
  let migrated = rawPlan;
  for (let fromVersion = startVersion; fromVersion < CURRENT_SCHEMA_VERSION; fromVersion++) {
    const migrationIndex = fromVersion - 1;
    const migration = migrations[migrationIndex];

    if (migration) {
      migrated = migration(migrated);
    }
  }

  // Update schema version
  return {
    ...(migrated as object),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  } as Plan;
}
