import { describe, it, expect } from 'vitest';
import {
  parsePath,
  pathMatchesPattern,
  transformPatchPath,
  migratePatch,
  migratePatches,
  applyOperationToPlan,
  type MigrationOp,
} from '../migrations/dsl';
import type { Patch } from 'immer';

describe('migration DSL', () => {
  describe('parsePath', () => {
    it('parses simple path', () => {
      expect(parsePath('plantings')).toEqual(['plantings']);
    });

    it('parses nested path', () => {
      expect(parsePath('plantings.0.bedFeet')).toEqual(['plantings', '0', 'bedFeet']);
    });

    it('parses path with wildcard', () => {
      expect(parsePath('plantings.*.bedFeet')).toEqual(['plantings', '*', 'bedFeet']);
    });
  });

  describe('pathMatchesPattern', () => {
    it('matches exact path', () => {
      expect(pathMatchesPattern(['plantings'], ['plantings'])).toBe(true);
    });

    it('does not match different path', () => {
      expect(pathMatchesPattern(['beds'], ['plantings'])).toBe(false);
    });

    it('matches path with wildcard', () => {
      expect(pathMatchesPattern(['plantings', 0, 'bedFeet'], ['plantings', '*', 'bedFeet'])).toBe(true);
      expect(pathMatchesPattern(['plantings', 5, 'bedFeet'], ['plantings', '*', 'bedFeet'])).toBe(true);
    });

    it('does not match wrong field with wildcard', () => {
      expect(pathMatchesPattern(['plantings', 0, 'wrongField'], ['plantings', '*', 'bedFeet'])).toBe(false);
    });

    it('does not match different length', () => {
      expect(pathMatchesPattern(['plantings', 0], ['plantings', '*', 'bedFeet'])).toBe(false);
    });
  });

  describe('transformPatchPath', () => {
    it('transforms matching path', () => {
      const result = transformPatchPath(
        ['plantings', 0, 'bedsCount'],
        ['plantings', '*', 'bedsCount'],
        ['plantings', '*', 'bedFeet']
      );
      expect(result).toEqual(['plantings', 0, 'bedFeet']);
    });

    it('preserves array index', () => {
      const result = transformPatchPath(
        ['plantings', 42, 'bedsCount'],
        ['plantings', '*', 'bedsCount'],
        ['plantings', '*', 'bedFeet']
      );
      expect(result).toEqual(['plantings', 42, 'bedFeet']);
    });

    it('returns null for non-matching path', () => {
      const result = transformPatchPath(
        ['beds', 0, 'lengthFt'],
        ['plantings', '*', 'bedsCount'],
        ['plantings', '*', 'bedFeet']
      );
      expect(result).toBeNull();
    });
  });

  describe('migratePatch', () => {
    it('renames field in patch path', () => {
      const patch: Patch = { op: 'replace', path: ['plantings', 0, 'bedsCount'], value: 2 };
      const op: MigrationOp = { op: 'renamePath', from: 'plantings.*.bedsCount', to: 'plantings.*.bedFeet' };

      const result = migratePatch(patch, [op]);

      expect(result.isNoOp).toBe(false);
      expect(result.patch.path).toEqual(['plantings', 0, 'bedFeet']);
    });

    it('marks patch as no-op when touching deleted field', () => {
      const patch: Patch = { op: 'replace', path: ['plantings', 0, 'legacyField'], value: 'x' };
      const op: MigrationOp = { op: 'deletePath', path: 'plantings.*.legacyField' };

      const result = migratePatch(patch, [op]);

      expect(result.isNoOp).toBe(true);
    });

    it('transforms value in patch', () => {
      const patch: Patch = { op: 'replace', path: ['plantings', 0, 'bedsCount'], value: 2 };
      const op: MigrationOp = { op: 'transformValue', path: 'plantings.*.bedsCount', fn: (v) => (v as number) * 50 };

      const result = migratePatch(patch, [op]);

      expect(result.patch.value).toBe(100);
    });

    it('applies multiple operations in order', () => {
      const patch: Patch = { op: 'replace', path: ['plantings', 0, 'bedsCount'], value: 2 };
      const ops: MigrationOp[] = [
        { op: 'transformValue', path: 'plantings.*.bedsCount', fn: (v) => (v as number) * 50 },
        { op: 'renamePath', from: 'plantings.*.bedsCount', to: 'plantings.*.bedFeet' },
      ];

      const result = migratePatch(patch, ops);

      expect(result.patch.path).toEqual(['plantings', 0, 'bedFeet']);
      expect(result.patch.value).toBe(100);
    });
  });

  describe('migratePatches', () => {
    it('filters out no-op patches', () => {
      const patches: Patch[] = [
        { op: 'replace', path: ['plantings', 0, 'bedFeet'], value: 50 },
        { op: 'replace', path: ['plantings', 0, 'legacyField'], value: 'x' },
        { op: 'replace', path: ['plantings', 1, 'bedFeet'], value: 100 },
      ];
      const ops: MigrationOp[] = [{ op: 'deletePath', path: 'plantings.*.legacyField' }];

      const result = migratePatches(patches, ops);

      expect(result).toHaveLength(2);
      expect(result[0].path).toEqual(['plantings', 0, 'bedFeet']);
      expect(result[1].path).toEqual(['plantings', 1, 'bedFeet']);
    });
  });

  describe('applyOperationToPlan', () => {
    it('renames field in plan', () => {
      const plan = {
        plantings: [
          { id: '1', bedsCount: 2 },
          { id: '2', bedsCount: 3 },
        ],
      };
      const op: MigrationOp = { op: 'renamePath', from: 'plantings.*.bedsCount', to: 'plantings.*.bedFeet' };

      const result = applyOperationToPlan(plan, op) as typeof plan;

      expect(result.plantings[0]).toHaveProperty('bedFeet', 2);
      expect(result.plantings[0]).not.toHaveProperty('bedsCount');
      expect(result.plantings[1]).toHaveProperty('bedFeet', 3);
    });

    it('deletes field from plan', () => {
      const plan = {
        plantings: [
          { id: '1', bedFeet: 50, legacyField: 'x' },
          { id: '2', bedFeet: 100, legacyField: 'y' },
        ],
      };
      const op: MigrationOp = { op: 'deletePath', path: 'plantings.*.legacyField' };

      const result = applyOperationToPlan(plan, op) as typeof plan;

      expect(result.plantings[0]).not.toHaveProperty('legacyField');
      expect(result.plantings[1]).not.toHaveProperty('legacyField');
      expect(result.plantings[0]).toHaveProperty('bedFeet', 50);
    });

    it('transforms values in plan', () => {
      const plan = {
        plantings: [
          { id: '1', bedsCount: 2 },
          { id: '2', bedsCount: 3 },
        ],
      };
      const op: MigrationOp = { op: 'transformValue', path: 'plantings.*.bedsCount', fn: (v) => (v as number) * 50 };

      const result = applyOperationToPlan(plan, op) as typeof plan;

      expect(result.plantings[0].bedsCount).toBe(100);
      expect(result.plantings[1].bedsCount).toBe(150);
    });

    it('handles empty arrays', () => {
      const plan = { plantings: [] };
      const op: MigrationOp = { op: 'renamePath', from: 'plantings.*.bedsCount', to: 'plantings.*.bedFeet' };

      const result = applyOperationToPlan(plan, op);

      expect(result).toEqual({ plantings: [] });
    });

    it('handles missing fields gracefully', () => {
      const plan = { beds: {} };
      const op: MigrationOp = { op: 'renamePath', from: 'plantings.*.bedsCount', to: 'plantings.*.bedFeet' };

      const result = applyOperationToPlan(plan, op);

      expect(result).toEqual({ beds: {} });
    });
  });
});
