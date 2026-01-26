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

/**
 * v4 → v5: Rename sequenceIndex to sequenceSlot
 * This supports the new sparse slot model for sequences.
 * Slot numbers can have gaps (e.g., 0, 1, 2, 5, 10) when plantings are removed.
 */
function migrateV4ToV5(rawPlan: unknown): unknown {
  const plan = rawPlan as {
    plantings?: Array<{
      sequenceIndex?: number;
      sequenceSlot?: number;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };

  if (!plan.plantings) {
    return plan;
  }

  // Check if already migrated (plantings have sequenceSlot instead of sequenceIndex)
  const hasOldField = plan.plantings.some(p => 'sequenceIndex' in p);
  if (!hasOldField) {
    return plan; // Already migrated or no sequences
  }

  // Rename sequenceIndex to sequenceSlot in all plantings
  const migratedPlantings = plan.plantings.map(planting => {
    if ('sequenceIndex' in planting) {
      const { sequenceIndex, ...rest } = planting;
      return {
        ...rest,
        sequenceSlot: sequenceIndex,
      };
    }
    return planting;
  });

  return {
    ...plan,
    plantings: migratedPlantings,
  };
}

/**
 * v5 → v6: Ensure all plantings have bedFeet
 * Converts legacy bedsCount (fractions of 50ft beds) to bedFeet (actual feet).
 * Defaults to 50 if neither field is present.
 */
function migrateV5ToV6(rawPlan: unknown): unknown {
  const LEGACY_BED_FT = 50;

  const plan = rawPlan as {
    plantings?: Array<{
      bedFeet?: number;
      bedsCount?: number;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };

  if (!plan.plantings) {
    return plan;
  }

  // Migrate plantings: ensure bedFeet exists
  const migratedPlantings = plan.plantings.map(planting => {
    // Already has bedFeet - no change needed
    if (typeof planting.bedFeet === 'number' && planting.bedFeet > 0) {
      // Remove legacy bedsCount if present
      if ('bedsCount' in planting) {
        const { bedsCount, ...rest } = planting;
        return rest;
      }
      return planting;
    }

    // Convert bedsCount to bedFeet
    if (typeof planting.bedsCount === 'number' && planting.bedsCount > 0) {
      const { bedsCount, ...rest } = planting;
      return {
        ...rest,
        bedFeet: bedsCount * LEGACY_BED_FT,
      };
    }

    // Neither field exists - default to 50ft
    return {
      ...planting,
      bedFeet: LEGACY_BED_FT,
    };
  });

  return {
    ...plan,
    plantings: migratedPlantings,
  };
}

/**
 * v6 → v7: Add crops entity with colors
 * Creates crops record from unique crop names in cropCatalog and products.
 * Colors are sourced from crops-template.json (extracted from Excel).
 */
function migrateV6ToV7(rawPlan: unknown): unknown {
  const plan = rawPlan as {
    cropCatalog?: Record<string, { crop: string }>;
    products?: Record<string, { crop: string }>;
    crops?: Record<string, { id: string; name: string; bgColor: string; textColor: string }>;
  };

  // Already migrated
  if (plan.crops && Object.keys(plan.crops).length > 0) {
    return plan;
  }

  // Load crops template for default colors
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cropsTemplate: Array<{
    id: string;
    name: string;
    bgColor: string;
    textColor: string;
  }> = require('@/data/crops-template.json');
  const templateMap = new Map(cropsTemplate.map((c) => [c.name, c]));

  // Default color for crops not in template
  const DEFAULT_BG = '#78909c';
  const DEFAULT_TEXT = '#ffffff';

  // Helper to generate crop ID
  const getCropId = (name: string) =>
    `crop_${name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')}`;

  // Collect unique crop names from this plan
  const cropNames = new Set<string>();

  if (plan.cropCatalog) {
    for (const config of Object.values(plan.cropCatalog)) {
      if (config.crop) cropNames.add(config.crop);
    }
  }

  if (plan.products) {
    for (const product of Object.values(plan.products)) {
      if (product.crop) cropNames.add(product.crop);
    }
  }

  // Create crops record with colors from template
  const crops: Record<
    string,
    { id: string; name: string; bgColor: string; textColor: string }
  > = {};

  for (const name of cropNames) {
    const id = getCropId(name);
    const templateCrop = templateMap.get(name);

    crops[id] = {
      id,
      name,
      bgColor: templateCrop?.bgColor || DEFAULT_BG,
      textColor: templateCrop?.textColor || DEFAULT_TEXT,
    };
  }

  return { ...plan, crops };
}

/**
 * v7 → v8: Add colorDefs field (DEPRECATED - feature was removed)
 * This migration added colorDefs for a named color palette feature that was
 * subsequently removed. Keeping this migration for schema compatibility with
 * existing plans that have empty colorDefs: {} in their data.
 */
function migrateV7ToV8(rawPlan: unknown): unknown {
  const plan = rawPlan as { colorDefs?: Record<string, unknown>; [key: string]: unknown };

  if (plan.colorDefs !== undefined) {
    return plan; // Already has colorDefs field
  }

  return {
    ...plan,
    colorDefs: {},
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
 *
 * For simple field renames/transforms, also add declarative operations
 * in dsl.ts (declarativeMigrations) to enable automatic patch migration.
 * This preserves undo history across schema changes.
 */
const migrations: MigrationFn[] = [
  migrateV1ToV2, // Index 0: v1 → v2
  migrateV2ToV3, // Index 1: v2 → v3
  migrateV3ToV4, // Index 2: v3 → v4
  migrateV4ToV5, // Index 3: v4 → v5 (sequenceIndex → sequenceSlot)
  migrateV5ToV6, // Index 4: v5 → v6 (ensure bedFeet exists on all plantings)
  migrateV6ToV7, // Index 5: v6 → v7 (add crops entity with colors)
  migrateV7ToV8, // Index 6: v7 → v8 (add colorDefs for named color palettes)
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
