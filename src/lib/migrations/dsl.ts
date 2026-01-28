/**
 * Declarative Migration DSL
 *
 * Defines migrations as path-based operations that can transform both:
 * 1. Plan data (walks object tree)
 * 2. Patches (transforms stored patch paths/values)
 *
 * This is isomorphic - the same operation expressed differently for snapshots vs deltas.
 *
 * Path syntax:
 * - "plantings" - top-level field
 * - "plantings.0" - array index
 * - "plantings.*" - all array elements (wildcard)
 * - "plantings.*.bedFeet" - field on all array elements
 */

import type { Patch } from 'immer';

// =============================================================================
// DSL OPERATION TYPES
// =============================================================================

/**
 * Rename a field path.
 * Example: { op: 'renamePath', from: 'plantings.*.bedsCount', to: 'plantings.*.bedFeet' }
 */
export interface RenamePathOp {
  op: 'renamePath';
  from: string;
  to: string;
}

/**
 * Delete a field path.
 * Example: { op: 'deletePath', path: 'plantings.*.legacyField' }
 * Patches touching deleted paths become no-ops.
 */
export interface DeletePathOp {
  op: 'deletePath';
  path: string;
}

/**
 * Add a field with default value.
 * Example: { op: 'addPath', path: 'plantings.*.newField', defaultValue: 0 }
 */
export interface AddPathOp {
  op: 'addPath';
  path: string;
  defaultValue: unknown;
}

/**
 * Transform value at path.
 * Example: { op: 'transformValue', path: 'plantings.*.bedFeet', fn: (v) => v * 50 }
 */
export interface TransformValueOp {
  op: 'transformValue';
  path: string;
  fn: (value: unknown) => unknown;
}

export type MigrationOp = RenamePathOp | DeletePathOp | AddPathOp | TransformValueOp;

/**
 * A declarative migration definition.
 * Contains the version range and operations to perform.
 */
export interface DeclarativeMigration {
  fromVersion: number;
  toVersion: number;
  operations: MigrationOp[];
}

// =============================================================================
// PATH UTILITIES
// =============================================================================

/**
 * Parse a path string into segments.
 * "plantings.*.bedFeet" -> ["plantings", "*", "bedFeet"]
 */
export function parsePath(path: string): string[] {
  return path.split('.');
}

/**
 * Check if a patch path matches a pattern path (with wildcards).
 * Pattern: ["plantings", "*", "bedFeet"]
 * Patch: ["plantings", 0, "bedFeet"] -> true
 * Patch: ["plantings", 5, "bedFeet"] -> true
 * Patch: ["beds", 0, "bedFeet"] -> false
 */
export function pathMatchesPattern(patchPath: (string | number)[], pattern: string[]): boolean {
  if (patchPath.length !== pattern.length) {
    return false;
  }

  for (let i = 0; i < pattern.length; i++) {
    const patternSegment = pattern[i];
    const patchSegment = patchPath[i];

    if (patternSegment === '*') {
      // Wildcard matches any segment (string or number)
      continue;
    }

    // Exact match (convert both to string for comparison)
    if (String(patternSegment) !== String(patchSegment)) {
      return false;
    }
  }

  return true;
}

/**
 * Transform a patch path according to a rename operation.
 * Returns the new path, or null if the path doesn't match.
 */
export function transformPatchPath(
  patchPath: (string | number)[],
  fromPattern: string[],
  toPattern: string[]
): (string | number)[] | null {
  if (!pathMatchesPattern(patchPath, fromPattern)) {
    return null;
  }

  // Build the new path, preserving concrete indices from the patch
  const newPath: (string | number)[] = [];
  for (let i = 0; i < toPattern.length; i++) {
    if (toPattern[i] === '*') {
      // Use the concrete value from the original patch path
      newPath.push(patchPath[i]);
    } else {
      newPath.push(toPattern[i]);
    }
  }

  return newPath;
}

// =============================================================================
// PATCH MIGRATION
// =============================================================================

/**
 * Result of migrating a patch.
 */
export interface MigratedPatch {
  patch: Patch;
  /** Whether the patch became a no-op (e.g., touched a deleted field) */
  isNoOp: boolean;
}

/**
 * Migrate a single patch according to migration operations.
 * Returns the transformed patch and whether it became a no-op.
 */
export function migratePatch(patch: Patch, operations: MigrationOp[]): MigratedPatch {
  let currentPatch = { ...patch };
  let isNoOp = false;

  for (const op of operations) {
    switch (op.op) {
      case 'renamePath': {
        const fromPattern = parsePath(op.from);
        const toPattern = parsePath(op.to);
        const newPath = transformPatchPath(currentPatch.path, fromPattern, toPattern);
        if (newPath) {
          currentPatch = { ...currentPatch, path: newPath };
        }
        break;
      }

      case 'deletePath': {
        const pattern = parsePath(op.path);
        if (pathMatchesPattern(currentPatch.path, pattern)) {
          // This patch touches a deleted field - mark as no-op
          isNoOp = true;
        }
        break;
      }

      case 'transformValue': {
        const pattern = parsePath(op.path);
        if (pathMatchesPattern(currentPatch.path, pattern) && 'value' in currentPatch) {
          // Transform the value
          currentPatch = {
            ...currentPatch,
            value: op.fn(currentPatch.value),
          };
        }
        break;
      }

      case 'addPath':
        // addPath doesn't affect existing patches - it's for plan migration only
        break;
    }
  }

  return { patch: currentPatch, isNoOp };
}

/**
 * Migrate an array of patches according to migration operations.
 * Filters out no-ops.
 */
export function migratePatches(patches: Patch[], operations: MigrationOp[]): Patch[] {
  const results: Patch[] = [];

  for (const patch of patches) {
    const { patch: migratedPatch, isNoOp } = migratePatch(patch, operations);
    if (!isNoOp) {
      results.push(migratedPatch);
    }
  }

  return results;
}

// =============================================================================
// PLAN MIGRATION (via DSL)
// =============================================================================

/**
 * Get all values at a path pattern in an object.
 * Handles wildcards by iterating arrays.
 */
function getValuesAtPath(obj: unknown, pattern: string[]): { path: (string | number)[]; value: unknown }[] {
  if (pattern.length === 0) {
    return [{ path: [], value: obj }];
  }

  const [first, ...rest] = pattern;

  if (first === '*') {
    // Wildcard - iterate array
    if (!Array.isArray(obj)) {
      return [];
    }
    const results: { path: (string | number)[]; value: unknown }[] = [];
    for (let i = 0; i < obj.length; i++) {
      const subResults = getValuesAtPath(obj[i], rest);
      for (const sub of subResults) {
        results.push({ path: [i, ...sub.path], value: sub.value });
      }
    }
    return results;
  }

  // Concrete key
  if (obj === null || typeof obj !== 'object') {
    return [];
  }
  const record = obj as Record<string, unknown>;
  if (!(first in record)) {
    return [];
  }

  const subResults = getValuesAtPath(record[first], rest);
  return subResults.map(sub => ({ path: [first, ...sub.path], value: sub.value }));
}

/**
 * Set a value at a concrete path in an object (immutably).
 */
function setValueAtPath(obj: unknown, path: (string | number)[], value: unknown): unknown {
  if (path.length === 0) {
    return value;
  }

  const [first, ...rest] = path;

  if (Array.isArray(obj)) {
    const index = typeof first === 'number' ? first : parseInt(first as string, 10);
    const newArray = [...obj];
    newArray[index] = setValueAtPath(newArray[index], rest, value);
    return newArray;
  }

  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  const record = obj as Record<string, unknown>;
  return {
    ...record,
    [first]: setValueAtPath(record[first as string], rest, value),
  };
}

/**
 * Delete a value at a path pattern in an object (immutably).
 */
function deleteAtPath(obj: unknown, pattern: string[]): unknown {
  if (pattern.length === 0) {
    return undefined;
  }

  const [first, ...rest] = pattern;

  if (first === '*') {
    // Wildcard - apply to all array elements
    if (!Array.isArray(obj)) {
      return obj;
    }
    return obj.map(item => deleteAtPath(item, rest));
  }

  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  const record = obj as Record<string, unknown>;

  if (rest.length === 0) {
    // Delete this key
    const { [first]: _, ...remaining } = record;
    return remaining;
  }

  // Recurse
  return {
    ...record,
    [first]: deleteAtPath(record[first], rest),
  };
}

/**
 * Rename a field at a path pattern in an object (immutably).
 */
function renameAtPath(obj: unknown, fromPattern: string[], toPattern: string[]): unknown {
  // Get all values at the "from" path
  const values = getValuesAtPath(obj, fromPattern);

  if (values.length === 0) {
    return obj;
  }

  // Delete old paths and set new paths
  let result = obj;

  // First, collect all values
  for (const { path: concretePath, value } of values) {
    // Build the "to" path with concrete indices
    const toPath: (string | number)[] = [];
    let fromIdx = 0;
    for (const segment of toPattern) {
      if (segment === '*') {
        toPath.push(concretePath[fromIdx]);
        fromIdx++;
      } else {
        toPath.push(segment);
        if (fromPattern[toPath.length - 1] !== '*') {
          fromIdx++;
        }
      }
    }

    // Set at new path
    result = setValueAtPath(result, toPath, value);
  }

  // Delete old paths (after setting new ones to preserve data)
  result = deleteAtPath(result, fromPattern);

  return result;
}

/**
 * Apply a single migration operation to a plan object.
 */
export function applyOperationToPlan(plan: unknown, op: MigrationOp): unknown {
  switch (op.op) {
    case 'renamePath': {
      const fromPattern = parsePath(op.from);
      const toPattern = parsePath(op.to);
      return renameAtPath(plan, fromPattern, toPattern);
    }

    case 'deletePath': {
      const pattern = parsePath(op.path);
      return deleteAtPath(plan, pattern);
    }

    case 'addPath': {
      // For addPath, we need to set default values at the pattern
      // This is complex with wildcards - for now, just skip
      // Real implementation would iterate and set defaults
      return plan;
    }

    case 'transformValue': {
      const pattern = parsePath(op.path);
      const values = getValuesAtPath(plan, pattern);

      let result = plan;
      for (const { path: concretePath, value } of values) {
        result = setValueAtPath(result, concretePath, op.fn(value));
      }
      return result;
    }
  }
}

/**
 * Apply all migration operations to a plan object.
 */
export function applyMigrationToPlan(plan: unknown, migration: DeclarativeMigration): unknown {
  let result = plan;
  for (const op of migration.operations) {
    result = applyOperationToPlan(result, op);
  }
  return result;
}

// =============================================================================
// DECLARATIVE MIGRATION DEFINITIONS
// =============================================================================

/**
 * Declarative operations for migrations that can be expressed as path transforms.
 * Key: fromVersion
 * Value: operations to apply when migrating from that version
 *
 * Not all migrations have declarative definitions - some are too complex
 * (like v2→v3 bed UUID migration) and only exist as imperative functions.
 *
 * When a migration has a declarative definition here, patches can be auto-migrated.
 */
export const declarativeMigrations: Record<number, MigrationOp[]> = {
  // v4 → v5: Rename sequenceIndex to sequenceSlot
  4: [
    { op: 'renamePath', from: 'plantings.*.sequenceIndex', to: 'plantings.*.sequenceSlot' },
  ],

  // v5 → v6: bedsCount → bedFeet conversion
  // Note: The value transform (multiply by 50) is handled separately since
  // patches contain the raw value - we transform patch values too
  5: [
    {
      op: 'transformValue',
      path: 'plantings.*.bedsCount',
      fn: (v: unknown) => (typeof v === 'number' ? v * 50 : v),
    },
    { op: 'renamePath', from: 'plantings.*.bedsCount', to: 'plantings.*.bedFeet' },
  ],

  // v11 → v12: Rename configId → specId, cropBoxDisplay → plantingBoxDisplay
  11: [
    { op: 'renamePath', from: 'plantings.*.configId', to: 'plantings.*.specId' },
    { op: 'renamePath', from: 'cropBoxDisplay', to: 'plantingBoxDisplay' },
  ],

  // v12 → v13: Rename cropCatalog → specs
  12: [
    { op: 'renamePath', from: 'cropCatalog', to: 'specs' },
  ],
};

/**
 * Get declarative operations for a version range.
 * Returns operations for all migrations from fromVersion to toVersion.
 */
export function getDeclarativeOperationsForRange(
  fromVersion: number,
  toVersion: number
): MigrationOp[] {
  const allOps: MigrationOp[] = [];

  for (let v = fromVersion; v < toVersion; v++) {
    const ops = declarativeMigrations[v];
    if (ops) {
      allOps.push(...ops);
    }
  }

  return allOps;
}
