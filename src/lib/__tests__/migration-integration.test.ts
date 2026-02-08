/**
 * Integration tests for the migration system.
 *
 * These tests exercise the full migration flow:
 * 1. Create plan with old schema version
 * 2. Add patches that touch fields being migrated
 * 3. Trigger migration via hydratePlan
 * 4. Verify plan + patches are correctly transformed
 * 5. Verify undo/redo still works
 *
 * Uses test-specific migrations to avoid coupling to production migrations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import {
  openPlanDb,
  savePlan,
  hydratePlan,
  appendPatch,
  getPatches,
  undoPatch,
  redoPatch,
  getRedoStackCount,
  migrateStoredPatches,
} from '../sqlite-storage';
import { migratePatch, getDeclarativeOperationsForRange } from '../migrations/dsl';
import type { MigrationOp } from '../migrations/dsl';
import { CURRENT_SCHEMA_VERSION } from '../migrations';
import type { Plan } from '../entities/plan';
import type { Patch } from 'immer';

// =============================================================================
// TEST SETUP
// =============================================================================

const TEST_PLAN_ID = 'migration-integration-test';
const DATA_DIR = join(process.cwd(), 'data', 'plans');
const TEST_DB_PATH = join(DATA_DIR, `${TEST_PLAN_ID}.db`);

function cleanupTestPlan() {
  if (existsSync(TEST_DB_PATH)) {
    rmSync(TEST_DB_PATH);
  }
  // Clean up WAL files
  const walPath = `${TEST_DB_PATH}-wal`;
  const shmPath = `${TEST_DB_PATH}-shm`;
  if (existsSync(walPath)) rmSync(walPath);
  if (existsSync(shmPath)) rmSync(shmPath);
}

function createTestPlan(schemaVersion: number): Plan {
  return {
    id: TEST_PLAN_ID,
    schemaVersion,
    metadata: {
      id: TEST_PLAN_ID,
      name: 'Migration Test Plan',
      createdAt: Date.now(),
      lastModified: Date.now(),
      year: 2025,
    },
    plantings: [
      {
        id: 'planting-1',
        specId: 'spec-1',
        fieldStartDate: '2025-04-01',
        startBed: 'bed-1',
        bedFeet: 100,
        lastModified: Date.now(),
      },
      {
        id: 'planting-2',
        specId: 'spec-2',
        fieldStartDate: '2025-05-01',
        startBed: 'bed-2',
        bedFeet: 50,
        lastModified: Date.now(),
      },
    ],
    beds: {},
    bedGroups: {},
    specs: {},
    crops: {},
    products: {},
    varieties: {},
    seedMixes: {},
    seedOrders: {},
    changeLog: [],
  } as Plan;
}

beforeEach(() => {
  cleanupTestPlan();
});

afterEach(() => {
  cleanupTestPlan();
});

// =============================================================================
// UNIT TESTS: DSL Operations
// =============================================================================

describe('DSL patch transformation', () => {
  it('transforms patch path with renamePath operation', () => {
    const patch: Patch = {
      op: 'replace',
      path: ['plantings', 0, 'oldField'],
      value: 42,
    };

    const ops: MigrationOp[] = [
      { op: 'renamePath', from: 'plantings.*.oldField', to: 'plantings.*.newField' },
    ];

    const result = migratePatch(patch, ops);

    expect(result.isNoOp).toBe(false);
    expect(result.patch.path).toEqual(['plantings', 0, 'newField']);
    expect(result.patch.value).toBe(42);
  });

  it('transforms patch value with transformValue operation', () => {
    const patch: Patch = {
      op: 'replace',
      path: ['plantings', 0, 'count'],
      value: 2,
    };

    const ops: MigrationOp[] = [
      { op: 'transformValue', path: 'plantings.*.count', fn: (v) => (v as number) * 10 },
    ];

    const result = migratePatch(patch, ops);

    expect(result.isNoOp).toBe(false);
    expect(result.patch.value).toBe(20);
  });

  it('marks patch as no-op when touching deleted field', () => {
    const patch: Patch = {
      op: 'replace',
      path: ['plantings', 0, 'deprecatedField'],
      value: 'anything',
    };

    const ops: MigrationOp[] = [
      { op: 'deletePath', path: 'plantings.*.deprecatedField' },
    ];

    const result = migratePatch(patch, ops);

    expect(result.isNoOp).toBe(true);
  });

  it('chains multiple operations correctly', () => {
    const patch: Patch = {
      op: 'replace',
      path: ['plantings', 0, 'bedsCount'],
      value: 2,
    };

    // Same operations as v5→v6 migration
    const ops: MigrationOp[] = [
      { op: 'transformValue', path: 'plantings.*.bedsCount', fn: (v) => (v as number) * 50 },
      { op: 'renamePath', from: 'plantings.*.bedsCount', to: 'plantings.*.bedFeet' },
    ];

    const result = migratePatch(patch, ops);

    expect(result.isNoOp).toBe(false);
    expect(result.patch.path).toEqual(['plantings', 0, 'bedFeet']);
    expect(result.patch.value).toBe(100); // 2 * 50
  });
});

// =============================================================================
// INTEGRATION TESTS: Full Migration Flow
// =============================================================================

describe('full migration flow', () => {
  it('migrates plan and patches together via migrateStoredPatches', () => {
    // 1. Create plan at v4
    const plan = createTestPlan(4);
    // Add old field for testing (cast through unknown for type flexibility)
    const planting0 = plan.plantings![0] as unknown as Record<string, unknown>;
    planting0.sequenceIndex = 5;
    delete planting0.sequenceSlot;
    savePlan(TEST_PLAN_ID, plan);

    // 2. Add a patch that touches the old field
    const db = openPlanDb(TEST_PLAN_ID);
    db.prepare(
      `INSERT INTO patches (patches, inverse_patches, description, original_schema_version, current_schema_version)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      JSON.stringify([{ op: 'replace', path: ['plantings', 0, 'sequenceIndex'], value: 10 }]),
      JSON.stringify([{ op: 'replace', path: ['plantings', 0, 'sequenceIndex'], value: 5 }]),
      'Update sequence',
      4,
      4
    );
    db.close();

    // 3. Migrate patches from v4 to v5
    const result = migrateStoredPatches(TEST_PLAN_ID, 4, 5);

    expect(result.migrated).toBe(1);
    expect(result.markedNoOp).toBe(0);

    // 4. Verify patch was transformed
    const patches = getPatches(TEST_PLAN_ID);
    expect(patches[0].patches[0].path).toEqual(['plantings', 0, 'sequenceSlot']);
    expect(patches[0].inversePatches[0].path).toEqual(['plantings', 0, 'sequenceSlot']);
    expect(patches[0].currentSchemaVersion).toBe(5);
  });

  it('preserves undo/redo functionality after migration', () => {
    // 1. Create plan at current version
    const plan = createTestPlan(6);
    savePlan(TEST_PLAN_ID, plan);

    // 2. Make a change (this creates a patch)
    appendPatch(TEST_PLAN_ID, {
      patches: [{ op: 'replace', path: ['metadata', 'name'], value: 'New Name' }],
      inversePatches: [{ op: 'replace', path: ['metadata', 'name'], value: 'Migration Test Plan' }],
      description: 'Rename plan',
    });

    // Verify patch exists
    expect(getPatches(TEST_PLAN_ID)).toHaveLength(1);

    // 3. Undo
    const undoResult = undoPatch(TEST_PLAN_ID);
    expect(undoResult).not.toBeNull();
    expect(undoResult!.description).toBe('Rename plan');

    // Verify moved to redo stack
    expect(getPatches(TEST_PLAN_ID)).toHaveLength(0);
    expect(getRedoStackCount(TEST_PLAN_ID)).toBe(1);

    // 4. Redo
    const redoResult = redoPatch(TEST_PLAN_ID);
    expect(redoResult).not.toBeNull();
    expect(redoResult!.description).toBe('Rename plan');

    // Verify back in patches
    expect(getPatches(TEST_PLAN_ID)).toHaveLength(1);
    expect(getRedoStackCount(TEST_PLAN_ID)).toBe(0);
  });

  it('handles value transformation with undo/redo', () => {
    // 1. Create plan at v5 (before bedFeet migration)
    const plan = createTestPlan(5);
    // Use old field name (cast through unknown for type flexibility)
    const planting0 = plan.plantings![0] as unknown as Record<string, unknown>;
    planting0.bedsCount = 2;
    delete planting0.bedFeet;
    savePlan(TEST_PLAN_ID, plan);

    // 2. Add patches that modify bedsCount
    const db = openPlanDb(TEST_PLAN_ID);
    db.prepare(
      `INSERT INTO patches (patches, inverse_patches, description, original_schema_version, current_schema_version)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      JSON.stringify([{ op: 'replace', path: ['plantings', 0, 'bedsCount'], value: 3 }]),
      JSON.stringify([{ op: 'replace', path: ['plantings', 0, 'bedsCount'], value: 2 }]),
      'Increase beds',
      5,
      5
    );
    db.close();

    // 3. Migrate to v6 (bedsCount → bedFeet with *50 transform)
    const result = migrateStoredPatches(TEST_PLAN_ID, 5, 6);

    expect(result.migrated).toBe(1);

    // 4. Verify transformation
    const patches = getPatches(TEST_PLAN_ID);
    expect(patches[0].patches[0].path).toEqual(['plantings', 0, 'bedFeet']);
    expect(patches[0].patches[0].value).toBe(150); // 3 * 50
    expect(patches[0].inversePatches[0].path).toEqual(['plantings', 0, 'bedFeet']);
    expect(patches[0].inversePatches[0].value).toBe(100); // 2 * 50
  });

  it('getDeclarativeOperationsForRange returns correct operations', () => {
    // v4→v5: sequenceIndex → sequenceSlot
    const ops4to5 = getDeclarativeOperationsForRange(4, 5);
    expect(ops4to5).toHaveLength(1);
    expect(ops4to5[0].op).toBe('renamePath');

    // v5→v6: bedsCount transform + rename
    const ops5to6 = getDeclarativeOperationsForRange(5, 6);
    expect(ops5to6).toHaveLength(2);
    expect(ops5to6[0].op).toBe('transformValue');
    expect(ops5to6[1].op).toBe('renamePath');

    // v4→v6: all operations
    const ops4to6 = getDeclarativeOperationsForRange(4, 6);
    expect(ops4to6).toHaveLength(3);

    // v1→v4: no declarative operations (complex migrations)
    const ops1to4 = getDeclarativeOperationsForRange(1, 4);
    expect(ops1to4).toHaveLength(0);
  });
});

describe('v17→v18: spec id re-keying migration', () => {
  it('migrates v17→v18: re-keys specs by id and updates planting.specId', () => {
    // 1. Create a v17 plan with specs keyed by identifier
    const oldPlan = {
      id: TEST_PLAN_ID,
      schemaVersion: 17,
      metadata: {
        id: TEST_PLAN_ID,
        name: 'V17 Spec Key Test',
        createdAt: Date.now(),
        lastModified: Date.now(),
        year: 2025,
      },
      plantings: [
        {
          id: 'planting-1',
          specId: 'tomato-beefsteak', // references identifier (old)
          fieldStartDate: '2025-04-01',
          startBed: 'bed-1',
          bedFeet: 100,
          lastModified: Date.now(),
        },
        {
          id: 'planting-2',
          specId: 'lettuce-romaine', // references identifier (old)
          fieldStartDate: '2025-05-01',
          startBed: 'bed-2',
          bedFeet: 50,
          lastModified: Date.now(),
        },
        {
          id: 'planting-3',
          specId: 'orphan-spec', // no matching spec — should be preserved as-is
          fieldStartDate: '2025-06-01',
          startBed: 'bed-3',
          bedFeet: 25,
          lastModified: Date.now(),
        },
      ],
      beds: {},
      bedGroups: {},
      specs: {
        // Keyed by identifier (old v17 format)
        'tomato-beefsteak': {
          id: 'crop_aaa11111',
          identifier: 'tomato-beefsteak',
          crop: 'Tomato',
          category: 'Fruiting',
        },
        'lettuce-romaine': {
          id: 'crop_bbb22222',
          identifier: 'lettuce-romaine',
          crop: 'Lettuce',
          category: 'Green',
        },
      },
      products: {},
      varieties: {},
      seedMixes: {},
      seedOrders: {},
      changeLog: [],
    };

    savePlan(TEST_PLAN_ID, oldPlan as unknown as Plan);

    // 2. Hydrate (triggers migration)
    const hydratedPlan = hydratePlan(TEST_PLAN_ID);

    expect(hydratedPlan.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    // 3. Verify specs are now keyed by spec.id
    const specKeys = Object.keys(hydratedPlan.specs!);
    expect(specKeys).toContain('crop_aaa11111');
    expect(specKeys).toContain('crop_bbb22222');
    expect(specKeys).not.toContain('tomato-beefsteak');
    expect(specKeys).not.toContain('lettuce-romaine');

    // Verify spec data is preserved (identifier renamed to name by v18→v19 migration)
    expect((hydratedPlan.specs!['crop_aaa11111'] as { name: string }).name).toBe('tomato-beefsteak');
    expect((hydratedPlan.specs!['crop_bbb22222'] as { name: string }).name).toBe('lettuce-romaine');

    // 4. Verify planting.specId updated to spec.id
    expect(hydratedPlan.plantings![0].specId).toBe('crop_aaa11111');
    expect(hydratedPlan.plantings![1].specId).toBe('crop_bbb22222');

    // 5. Verify orphaned reference preserved as-is
    expect(hydratedPlan.plantings![2].specId).toBe('orphan-spec');
  });

  it('v17→v18 migration is idempotent', () => {
    // Create a plan that's already in v18 format (specs keyed by id)
    const alreadyMigrated = {
      id: TEST_PLAN_ID,
      schemaVersion: 17, // Claims v17 but data already in v18 format
      metadata: {
        id: TEST_PLAN_ID,
        name: 'Already Migrated',
        createdAt: Date.now(),
        lastModified: Date.now(),
        year: 2025,
      },
      plantings: [
        {
          id: 'planting-1',
          specId: 'crop_aaa11111',
          fieldStartDate: '2025-04-01',
          startBed: 'bed-1',
          bedFeet: 50,
          lastModified: Date.now(),
        },
      ],
      beds: {},
      bedGroups: {},
      specs: {
        'crop_aaa11111': {
          id: 'crop_aaa11111',
          identifier: 'tomato-beefsteak',
          crop: 'Tomato',
        },
      },
      products: {},
      varieties: {},
      seedMixes: {},
      seedOrders: {},
      changeLog: [],
    };

    savePlan(TEST_PLAN_ID, alreadyMigrated as unknown as Plan);
    const hydratedPlan = hydratePlan(TEST_PLAN_ID);

    // Should pass through unchanged
    expect(Object.keys(hydratedPlan.specs!)).toContain('crop_aaa11111');
    expect(hydratedPlan.plantings![0].specId).toBe('crop_aaa11111');
    expect((hydratedPlan.specs!['crop_aaa11111'] as { name: string }).name).toBe('tomato-beefsteak');
  });

  it('v17→v18 migration handles empty specs', () => {
    const emptySpecs = {
      id: TEST_PLAN_ID,
      schemaVersion: 17,
      metadata: {
        id: TEST_PLAN_ID,
        name: 'Empty Specs',
        createdAt: Date.now(),
        lastModified: Date.now(),
        year: 2025,
      },
      plantings: [],
      beds: {},
      bedGroups: {},
      specs: {},
      products: {},
      varieties: {},
      seedMixes: {},
      seedOrders: {},
      changeLog: [],
    };

    savePlan(TEST_PLAN_ID, emptySpecs as unknown as Plan);
    const hydratedPlan = hydratePlan(TEST_PLAN_ID);

    expect(hydratedPlan.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(Object.keys(hydratedPlan.specs!)).toHaveLength(0);
  });
});

// =============================================================================
// END-TO-END: Full hydration flow
// =============================================================================

describe('end-to-end hydration with migration', () => {
  it('migrates plan and patches when loading old-version plan via hydratePlan', () => {
    // 1. Create a v5 plan (before bedFeet migration)
    const oldPlan = {
      id: TEST_PLAN_ID,
      schemaVersion: 5,
      metadata: {
        id: TEST_PLAN_ID,
        name: 'Old Version Plan',
        createdAt: Date.now(),
        lastModified: Date.now(),
        year: 2025,
      },
      plantings: [
        {
          id: 'planting-1',
          configId: 'config-1',
          fieldStartDate: '2025-04-01',
          startBed: 'bed-1',
          bedsCount: 2, // Old field name
          sequenceSlot: 0,
        },
      ],
      beds: {},
      bedGroups: {},
      cropCatalog: {},
      products: {},
      varieties: {},
      seedMixes: {},
      seedOrders: {},
    };
    savePlan(TEST_PLAN_ID, oldPlan as unknown as Plan);

    // 2. Add a patch that modifies bedsCount (old field)
    const db = openPlanDb(TEST_PLAN_ID);
    db.prepare(
      `INSERT INTO patches (patches, inverse_patches, description, original_schema_version, current_schema_version)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      JSON.stringify([{ op: 'replace', path: ['plantings', 0, 'bedsCount'], value: 3 }]),
      JSON.stringify([{ op: 'replace', path: ['plantings', 0, 'bedsCount'], value: 2 }]),
      'Change beds count',
      5,
      5
    );
    db.close();

    // 3. Hydrate the plan (triggers migration)
    const hydratedPlan = hydratePlan(TEST_PLAN_ID);

    // 4. Verify plan was migrated to current version
    expect(hydratedPlan.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // The planting should have bedFeet, not bedsCount
    const planting = hydratedPlan.plantings![0] as unknown as Record<string, unknown>;
    expect(planting.bedFeet).toBe(150); // 3 * 50 (patch applied, then value preserved)
    expect(planting.bedsCount).toBeUndefined();

    // 5. Verify patches were migrated
    const patches = getPatches(TEST_PLAN_ID);
    expect(patches[0].patches[0].path).toEqual(['plantings', 0, 'bedFeet']);
    expect(patches[0].patches[0].value).toBe(150); // 3 * 50
    expect(patches[0].inversePatches[0].path).toEqual(['plantings', 0, 'bedFeet']);
    expect(patches[0].inversePatches[0].value).toBe(100); // 2 * 50
    expect(patches[0].currentSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    // 6. Verify undo returns correct migrated inverse patch
    const undoResult = undoPatch(TEST_PLAN_ID);
    expect(undoResult).not.toBeNull();
    expect(undoResult!.description).toBe('Change beds count');

    // Note: undoPatch only moves the patch to redo_stack and returns the inverse.
    // The plan-store client applies the inverse in memory.
    // Re-hydrating gives the saved state (which includes all patches applied at save time).

    // 7. Verify redo still works (patches in redo stack are also migrated)
    const redoResult = redoPatch(TEST_PLAN_ID);
    expect(redoResult).not.toBeNull();
    expect(redoResult!.description).toBe('Change beds count');

    // Patches should be back in the patches table with migrated paths
    const patchesAfterRedo = getPatches(TEST_PLAN_ID);
    expect(patchesAfterRedo[0].patches[0].path).toEqual(['plantings', 0, 'bedFeet']);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

// =============================================================================
// REALISTIC PLAN TESTS: Using actual template data
// =============================================================================

describe('realistic plan with template data', () => {
  it('creates plan with real template data, mutates, and verifies aggregates', async () => {
    // Import template data directly
    const cropsData = await import('@/data/planting-spec-template.json');
    const bedData = await import('@/data/bed-template.json');

    // Build a realistic plan with actual template data
    // Type is flexible since PlantingSpec has many optional fields
    const crops = (cropsData as unknown as { crops: Array<{ id: string; identifier: string; crop: string; dtm?: number; harvestWindow?: number; [k: string]: unknown }> }).crops;
    const bedGroups = (bedData as { bedGroups: Record<string, string[]> }).bedGroups;

    // Pick a few real planting specs from template
    const tomatoConfig = crops.find(c => c.crop?.toLowerCase().includes('tomato'));
    const lettuceConfig = crops.find(c => c.crop?.toLowerCase().includes('lettuce'));
    const basilConfig = crops.find(c => c.crop?.toLowerCase().includes('basil'));

    expect(tomatoConfig).toBeDefined();
    expect(lettuceConfig).toBeDefined();
    expect(basilConfig).toBeDefined();

    // Build catalog from selected configs
    const cropCatalog: Record<string, typeof crops[0]> = {};
    if (tomatoConfig) cropCatalog[tomatoConfig.identifier] = tomatoConfig;
    if (lettuceConfig) cropCatalog[lettuceConfig.identifier] = lettuceConfig;
    if (basilConfig) cropCatalog[basilConfig.identifier] = basilConfig;

    // Build beds with UUIDs (simplified version - just use bed names as IDs for test)
    const beds: Record<string, { id: string; name: string; lengthFt: number; groupId: string; displayOrder: number }> = {};
    const bedGroupsRecord: Record<string, { id: string; name: string; displayOrder: number }> = {};
    let groupOrder = 0;

    for (const [groupLetter, bedNames] of Object.entries(bedGroups)) {
      const groupId = `group-${groupLetter}`;
      bedGroupsRecord[groupId] = {
        id: groupId,
        name: `Row ${groupLetter}`,
        displayOrder: groupOrder++,
      };

      bedNames.forEach((bedName, idx) => {
        const bedId = `bed-${bedName}`;
        beds[bedId] = {
          id: bedId,
          name: bedName,
          lengthFt: 50,
          groupId,
          displayOrder: idx,
        };
      });
    }

    // Create plantings using real configs
    const plantings = [
      {
        id: 'P1',
        specId: tomatoConfig!.identifier,
        fieldStartDate: '2025-04-15',
        startBed: Object.keys(beds)[0], // First bed
        bedFeet: 100,
        lastModified: Date.now(),
      },
      {
        id: 'P2',
        specId: lettuceConfig!.identifier,
        fieldStartDate: '2025-03-01',
        startBed: Object.keys(beds)[5], // 6th bed
        bedFeet: 50,
        lastModified: Date.now(),
      },
      {
        id: 'P3',
        specId: basilConfig!.identifier,
        fieldStartDate: '2025-05-01',
        startBed: Object.keys(beds)[10], // 11th bed
        bedFeet: 75,
        lastModified: Date.now(),
      },
    ];

    // Create the plan
    const plan: Plan = {
      id: TEST_PLAN_ID,
      schemaVersion: 6,
      metadata: {
        id: TEST_PLAN_ID,
        name: 'Realistic Test Plan',
        createdAt: Date.now(),
        lastModified: Date.now(),
        year: 2025,
      },
      plantings,
      beds: beds as Plan['beds'],
      bedGroups: bedGroupsRecord as Plan['bedGroups'],
      specs: cropCatalog as unknown as Plan['specs'],
      products: {},
      varieties: {},
      seedMixes: {},
      seedOrders: {},
      changeLog: [],
    };

    // Save and hydrate
    savePlan(TEST_PLAN_ID, plan);
    const loadedPlan = hydratePlan(TEST_PLAN_ID);

    // === VERIFY INITIAL STATE ===
    expect(loadedPlan.plantings).toHaveLength(3);

    // Calculate initial aggregates
    const initialTotalBedFeet = loadedPlan.plantings!.reduce((sum, p) => sum + p.bedFeet, 0);
    expect(initialTotalBedFeet).toBe(225); // 100 + 50 + 75

    // === MUTATION 1: Move a planting to a different bed ===
    const newBedId = Object.keys(beds)[20]; // Move to 21st bed
    appendPatch(TEST_PLAN_ID, {
      patches: [{ op: 'replace', path: ['plantings', 0, 'startBed'], value: newBedId }],
      inversePatches: [{ op: 'replace', path: ['plantings', 0, 'startBed'], value: plantings[0].startBed }],
      description: 'Move tomato planting',
    });

    // Hydrate and verify move
    const afterMove = hydratePlan(TEST_PLAN_ID);
    expect(afterMove.plantings![0].startBed).toBe(newBedId);
    // Total bed feet unchanged by move
    expect(afterMove.plantings!.reduce((sum, p) => sum + p.bedFeet, 0)).toBe(225);

    // === MUTATION 2: Change bedFeet on a planting ===
    appendPatch(TEST_PLAN_ID, {
      patches: [{ op: 'replace', path: ['plantings', 1, 'bedFeet'], value: 100 }],
      inversePatches: [{ op: 'replace', path: ['plantings', 1, 'bedFeet'], value: 50 }],
      description: 'Increase lettuce bedFeet',
    });

    const afterResize = hydratePlan(TEST_PLAN_ID);
    expect(afterResize.plantings![1].bedFeet).toBe(100);
    expect(afterResize.plantings!.reduce((sum, p) => sum + p.bedFeet, 0)).toBe(275); // 100 + 100 + 75

    // === MUTATION 3: Delete a planting (basilConfig) ===
    const deletedPlanting = afterResize.plantings![2];
    appendPatch(TEST_PLAN_ID, {
      patches: [{ op: 'remove', path: ['plantings', 2] }],
      inversePatches: [{ op: 'add', path: ['plantings', 2], value: deletedPlanting }],
      description: 'Remove basil planting',
    });

    const afterDelete = hydratePlan(TEST_PLAN_ID);
    expect(afterDelete.plantings).toHaveLength(2);
    expect(afterDelete.plantings!.reduce((sum, p) => sum + p.bedFeet, 0)).toBe(200); // 100 + 100

    // === UNDO TESTS ===
    // Undo delete (basil comes back)
    const undoDelete = undoPatch(TEST_PLAN_ID);
    expect(undoDelete?.description).toBe('Remove basil planting');

    // Undo resize (lettuce back to 50)
    const undoResize = undoPatch(TEST_PLAN_ID);
    expect(undoResize?.description).toBe('Increase lettuce bedFeet');

    // Undo move (tomato back to original bed)
    const undoMove = undoPatch(TEST_PLAN_ID);
    expect(undoMove?.description).toBe('Move tomato planting');

    // All undone - should match initial state
    const afterAllUndo = hydratePlan(TEST_PLAN_ID);
    expect(afterAllUndo.plantings).toHaveLength(3);
    expect(afterAllUndo.plantings!.reduce((sum, p) => sum + p.bedFeet, 0)).toBe(225);
    expect(afterAllUndo.plantings![0].startBed).toBe(plantings[0].startBed);

    // === REDO TESTS ===
    expect(getRedoStackCount(TEST_PLAN_ID)).toBe(3);

    // Redo move
    const redoMove = redoPatch(TEST_PLAN_ID);
    expect(redoMove?.description).toBe('Move tomato planting');

    // Redo resize
    const redoResize = redoPatch(TEST_PLAN_ID);
    expect(redoResize?.description).toBe('Increase lettuce bedFeet');

    // Redo delete
    const redoDelete = redoPatch(TEST_PLAN_ID);
    expect(redoDelete?.description).toBe('Remove basil planting');

    // Should match state after all mutations
    const afterAllRedo = hydratePlan(TEST_PLAN_ID);
    expect(afterAllRedo.plantings).toHaveLength(2);
    expect(afterAllRedo.plantings!.reduce((sum, p) => sum + p.bedFeet, 0)).toBe(200);
    expect(afterAllRedo.plantings![0].startBed).toBe(newBedId);
  });

  it('verifies bed counts and group aggregations with template beds', async () => {
    const bedData = await import('@/data/bed-template.json');
    const bedGroups = (bedData as { bedGroups: Record<string, string[]>; beds: string[] }).bedGroups;
    const allBedNames = (bedData as { beds: string[] }).beds;

    // Verify template has expected structure
    expect(Object.keys(bedGroups).length).toBeGreaterThan(0);
    expect(allBedNames.length).toBeGreaterThan(0);

    // Count beds per group
    const bedsPerGroup: Record<string, number> = {};
    for (const [group, beds] of Object.entries(bedGroups)) {
      bedsPerGroup[group] = beds.length;
    }

    // Verify total beds matches
    const totalFromGroups = Object.values(bedsPerGroup).reduce((sum, n) => sum + n, 0);
    expect(totalFromGroups).toBe(allBedNames.length);

    // Log for debugging (visible in test output)
    console.log(`Template has ${allBedNames.length} beds across ${Object.keys(bedGroups).length} groups`);
  });

  it('verifies crop catalog has expected crop types', async () => {
    const cropsData = await import('@/data/planting-spec-template.json');
    const crops = (cropsData as unknown as { crops: Array<{ id: string; name: string; crop: string; category?: string }> }).crops;

    // Count by category
    const byCategory: Record<string, number> = {};
    for (const crop of crops) {
      const cat = crop.category || 'Uncategorized';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    // Verify we have multiple categories
    expect(Object.keys(byCategory).length).toBeGreaterThan(1);

    // Verify we have substantial number of configs
    expect(crops.length).toBeGreaterThan(100);

    // Log for debugging
    console.log(`Template has ${crops.length} planting specs across categories:`, byCategory);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('edge cases', () => {
  it('handles patches with no matching operations (pass-through)', () => {
    const patch: Patch = {
      op: 'replace',
      path: ['metadata', 'name'],
      value: 'New Name',
    };

    // Operations that don't match this path
    const ops: MigrationOp[] = [
      { op: 'renamePath', from: 'plantings.*.oldField', to: 'plantings.*.newField' },
    ];

    const result = migratePatch(patch, ops);

    expect(result.isNoOp).toBe(false);
    expect(result.patch.path).toEqual(['metadata', 'name']);
    expect(result.patch.value).toBe('New Name');
  });

  it('handles empty operations array', () => {
    const patch: Patch = {
      op: 'replace',
      path: ['plantings', 0, 'bedFeet'],
      value: 100,
    };

    const result = migratePatch(patch, []);

    expect(result.isNoOp).toBe(false);
    expect(result.patch).toEqual(patch);
  });

  it('handles deeply nested paths', () => {
    const patch: Patch = {
      op: 'replace',
      path: ['plantings', 0, 'nested', 'deep', 'value'],
      value: 42,
    };

    const ops: MigrationOp[] = [
      { op: 'renamePath', from: 'plantings.*.nested.deep.value', to: 'plantings.*.nested.deep.newValue' },
    ];

    const result = migratePatch(patch, ops);

    expect(result.patch.path).toEqual(['plantings', 0, 'nested', 'deep', 'newValue']);
  });

  it('handles add operation on patches (no transformation)', () => {
    const patch: Patch = {
      op: 'add',
      path: ['plantings', 0, 'newField'],
      value: 'new',
    };

    const ops: MigrationOp[] = [
      { op: 'addPath', path: 'plantings.*.newField', defaultValue: 'default' },
    ];

    // addPath doesn't transform patches (it's for plan migration)
    const result = migratePatch(patch, ops);

    expect(result.isNoOp).toBe(false);
    expect(result.patch).toEqual(patch);
  });
});
