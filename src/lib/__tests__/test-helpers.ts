/**
 * Test Helper Functions
 *
 * Utilities for creating test data in plan-store integration tests.
 */

import type { Plan, Planting, Bed, BedGroup, PlantingSpec } from '../plan-types';
import { CURRENT_SCHEMA_VERSION } from '../migrations';

/**
 * Create a minimal valid Plan for testing.
 */
export function createTestPlan(overrides: Partial<Plan> = {}): Plan {
  const now = Date.now();
  return {
    id: overrides.id ?? `test-plan-${now}`,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    metadata: {
      id: overrides.id ?? `test-plan-${now}`,
      name: 'Test Plan',
      createdAt: now,
      lastModified: now,
      year: 2025,
      version: 1,
    },
    beds: {},
    bedGroups: {},
    plantings: [],
    specs: {},
    changeLog: [],
    varieties: {},
    seedMixes: {},
    products: {},
    seedOrders: {},
    markets: {},
    ...overrides,
  };
}

/**
 * Create a minimal valid Planting for testing.
 */
export function createTestPlanting(overrides: Partial<Planting> = {}): Planting {
  const now = Date.now();
  return {
    id: overrides.id ?? `planting-${now}`,
    specId: overrides.specId ?? 'test-config',
    fieldStartDate: overrides.fieldStartDate ?? '2025-03-15',
    startBed: overrides.startBed ?? null,
    bedFeet: overrides.bedFeet ?? 50,
    lastModified: now,
    ...overrides,
  };
}

/**
 * Create a minimal valid Bed for testing.
 */
export function createTestBed(overrides: Partial<Bed> = {}): Bed {
  const now = Date.now();
  const id = overrides.id ?? `bed-${now}`;
  return {
    id,
    name: overrides.name ?? 'A1',
    lengthFt: overrides.lengthFt ?? 50,
    groupId: overrides.groupId ?? 'group-1',
    displayOrder: overrides.displayOrder ?? 0,
    ...overrides,
  };
}

/**
 * Create a minimal valid BedGroup for testing.
 */
export function createTestBedGroup(overrides: Partial<BedGroup> = {}): BedGroup {
  const now = Date.now();
  const id = overrides.id ?? `group-${now}`;
  return {
    id,
    name: overrides.name ?? 'Row A',
    displayOrder: overrides.displayOrder ?? 0,
    ...overrides,
  };
}

/**
 * Create a minimal valid PlantingSpec for testing.
 */
export function createTestPlantingSpec(overrides: Partial<PlantingSpec> = {}): PlantingSpec {
  const id = overrides.id ?? `config-${Date.now()}`;
  return {
    id,
    name: overrides.name ?? id,
    crop: overrides.crop ?? 'Test Crop',
    category: 'Green',
    rows: 4,
    spacing: 6,
    productYields: overrides.productYields ?? [
      { productId: 'test-product', dtm: 60, numberOfHarvests: 1 },
    ],
    ...overrides,
  } as PlantingSpec;
}

/**
 * Create a test plan with beds and groups pre-configured.
 */
export function createTestPlanWithBeds(): Plan {
  const groupId = 'group-1';
  const bedId = 'bed-1';
  return createTestPlan({
    beds: {
      [bedId]: createTestBed({ id: bedId, name: 'A1', groupId }),
    },
    bedGroups: {
      [groupId]: createTestBedGroup({ id: groupId, name: 'Row A' }),
    },
  });
}

/**
 * Create a test plan with a planting spec in the catalog.
 */
export function createTestPlanWithSpec(): Plan {
  const spec = createTestPlantingSpec({ name: 'tomato-beefsteak' });
  return createTestPlan({
    specs: {
      [spec.id]: spec,
    },
  });
}
