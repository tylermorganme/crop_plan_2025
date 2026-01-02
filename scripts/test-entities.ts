/**
 * Entity Validation Tests
 *
 * Tests for the new entity types and validation functions.
 * Run: npx tsx scripts/test-entities.ts
 */

import {
  type Bed,
  type Planting,
  type CropConfig,
  type Plan,
  type PlanMetadata,
  ROW_LENGTHS,
  createBedsFromTemplate,
  deriveResources,
  deriveGroups,
  getBedLength,
  validatePlan,
  PlanValidationError,
  createPlanting,
} from '../src/lib/entities';

// Test utilities
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e instanceof Error ? e.message : e}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(
      `${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertThrows(fn: () => void, errorType?: new (...args: any[]) => Error) {
  try {
    fn();
    throw new Error('Expected function to throw');
  } catch (e) {
    if (errorType && !(e instanceof errorType)) {
      throw new Error(`Expected ${errorType.name}, got ${e instanceof Error ? e.constructor.name : typeof e}`);
    }
  }
}

// =============================================================================
// BED TESTS
// =============================================================================

console.log('\n=== Bed Tests ===\n');

test('ROW_LENGTHS has correct values for F and J (short rows)', () => {
  assertEqual(ROW_LENGTHS['F'], 20, 'F should be 20ft');
  assertEqual(ROW_LENGTHS['J'], 20, 'J should be 20ft');
});

test('ROW_LENGTHS has correct values for standard rows', () => {
  assertEqual(ROW_LENGTHS['A'], 50, 'A should be 50ft');
  assertEqual(ROW_LENGTHS['B'], 50, 'B should be 50ft');
  assertEqual(ROW_LENGTHS['U'], 50, 'U should be 50ft');
});

test('ROW_LENGTHS has correct value for X (greenhouse)', () => {
  assertEqual(ROW_LENGTHS['X'], 80, 'X should be 80ft');
});

test('createBedsFromTemplate creates beds with correct lengths', () => {
  const bedGroups = {
    'A': ['A1', 'A2'],
    'F': ['F1', 'F2'],
    'X': ['X1'],
  };
  const beds = createBedsFromTemplate(bedGroups);

  assertEqual(beds['A1'].lengthFt, 50, 'A1 should be 50ft');
  assertEqual(beds['F1'].lengthFt, 20, 'F1 should be 20ft');
  assertEqual(beds['X1'].lengthFt, 80, 'X1 should be 80ft');
});

test('deriveResources returns sorted bed IDs', () => {
  const beds: Record<string, Bed> = {
    'A2': { id: 'A2', lengthFt: 50, group: 'A' },
    'A1': { id: 'A1', lengthFt: 50, group: 'A' },
    'B1': { id: 'B1', lengthFt: 50, group: 'B' },
  };
  const resources = deriveResources(beds);

  assertEqual(resources[0], 'A1', 'First should be A1');
  assertEqual(resources[1], 'A2', 'Second should be A2');
  assertEqual(resources[2], 'B1', 'Third should be B1');
});

test('getBedLength throws for missing bed', () => {
  const beds: Record<string, Bed> = {
    'A1': { id: 'A1', lengthFt: 50, group: 'A' },
  };
  assertThrows(() => getBedLength(beds, 'Z99'));
});

// =============================================================================
// PLANTING TESTS
// =============================================================================

console.log('\n=== Planting Tests ===\n');

test('createPlanting generates ID if not provided', () => {
  const planting = createPlanting({
    configId: 'test-config',
    fieldStartDate: '2025-05-01',
    startBed: 'A1',
    bedFeet: 50,
  });
  assertEqual(planting.id.startsWith('P'), true, 'ID should start with P');
});

test('createPlanting uses provided ID', () => {
  const planting = createPlanting({
    id: 'CUSTOM001',
    configId: 'test-config',
    fieldStartDate: '2025-05-01',
    startBed: 'A1',
    bedFeet: 50,
  });
  assertEqual(planting.id, 'CUSTOM001');
});

// =============================================================================
// VALIDATION TESTS
// =============================================================================

console.log('\n=== Validation Tests ===\n');

function createTestPlan(): Plan {
  const beds: Record<string, Bed> = {
    'A1': { id: 'A1', lengthFt: 50, group: 'A' },
    'A2': { id: 'A2', lengthFt: 50, group: 'A' },
  };

  const cropCatalog: Record<string, CropConfig> = {
    'arugula-baby-leaf': {
      id: 'arugula-baby-leaf',
      identifier: 'Arugula - Baby Leaf | Field DS Sp',
      crop: 'Arugula',
      product: 'Baby Leaf',
      dtm: 45,
    },
  };

  const plantings: Planting[] = [
    {
      id: 'P1',
      configId: 'arugula-baby-leaf',
      fieldStartDate: '2025-05-01',
      startBed: 'A1',
      bedFeet: 50,
      lastModified: Date.now(),
    },
  ];

  const metadata: PlanMetadata = {
    id: 'test-plan',
    name: 'Test Plan',
    createdAt: Date.now(),
    lastModified: Date.now(),
    year: 2025,
  };

  return {
    id: 'test-plan',
    schemaVersion: 2,
    metadata,
    beds,
    cropCatalog,
    plantings,
    changeLog: [],
  };
}

test('validatePlan passes for valid plan', () => {
  const plan = createTestPlan();
  validatePlan(plan); // Should not throw
});

test('validatePlan throws for missing configId', () => {
  const plan = createTestPlan();
  plan.plantings![0].configId = 'nonexistent-config';

  assertThrows(() => validatePlan(plan), PlanValidationError);
});

test('validatePlan throws for missing bed', () => {
  const plan = createTestPlan();
  plan.plantings![0].startBed = 'Z99';

  assertThrows(() => validatePlan(plan), PlanValidationError);
});

test('validatePlan allows null startBed (unassigned)', () => {
  const plan = createTestPlan();
  plan.plantings![0].startBed = null;

  validatePlan(plan); // Should not throw
});

test('validatePlan throws for missing followsPlantingId', () => {
  const plan = createTestPlan();
  plan.plantings![0].followsPlantingId = 'nonexistent-planting';

  assertThrows(() => validatePlan(plan), PlanValidationError);
});

test('validatePlan passes for valid followsPlantingId', () => {
  const plan = createTestPlan();

  // Add a second planting that follows the first
  plan.plantings!.push({
    id: 'P2',
    configId: 'arugula-baby-leaf',
    fieldStartDate: '2025-06-01',
    startBed: 'A2',
    bedFeet: 50,
    followsPlantingId: 'P1',
    lastModified: Date.now(),
  });

  validatePlan(plan); // Should not throw
});

// =============================================================================
// SUMMARY
// =============================================================================

console.log('\n=== Summary ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
