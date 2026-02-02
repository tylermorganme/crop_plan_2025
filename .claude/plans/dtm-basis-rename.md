# Rename normalMethod → dtmBasis

Rename the field and values to be self-documenting.

## Changes Summary

| Old | New |
|-----|-----|
| Field: `normalMethod` | Field: `dtmBasis` |
| Value: `from-seeding` | Value: `ds-from-germination-to-harvest` |
| Value: `from-transplant` | Value: `tp-from-planting-to-harvest` |
| Value: `total-time` | Value: `tp-from-seeding-to-harvest` |

## Implementation Steps

### 1. Migration (v16 → v17)

Add to `src/lib/migrations/index.ts`:

```typescript
/**
 * v16 → v17: Rename normalMethod → dtmBasis with clearer values
 *
 * Old values → New values:
 * - from-seeding → ds-from-germination-to-harvest
 * - from-transplant → tp-from-planting-to-harvest
 * - total-time → tp-from-seeding-to-harvest
 */
function migrateV16ToV17(rawPlan: unknown): unknown {
  const plan = rawPlan as { specs?: Record<string, { normalMethod?: string }> };
  if (!plan.specs) return plan;

  const VALUE_MAP: Record<string, string> = {
    'from-seeding': 'ds-from-germination-to-harvest',
    'from-transplant': 'tp-from-planting-to-harvest',
    'total-time': 'tp-from-seeding-to-harvest',
  };

  const newSpecs: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(plan.specs)) {
    const { normalMethod, ...rest } = spec as Record<string, unknown>;
    newSpecs[key] = {
      ...rest,
      dtmBasis: normalMethod ? VALUE_MAP[normalMethod as string] ?? normalMethod : undefined,
    };
  }

  return { ...plan, specs: newSpecs };
}
```

Add to migrations array and declarative DSL for patch migration.

### 2. Type Definitions

**`src/lib/entities/planting-specs.ts`:**
- Rename field in `PlantingSpec` interface: `normalMethod` → `dtmBasis`
- Update type: `'from-seeding' | 'from-transplant' | 'total-time'` → `'ds-from-germination-to-harvest' | 'tp-from-planting-to-harvest' | 'tp-from-seeding-to-harvest'`
- Update `calculateSeedToHarvest()` switch cases
- Update `calculateProductSeedToHarvest()` switch cases
- Update JSDoc comments

**`src/lib/display-labels.ts`:**
- Rename type: `NormalMethod` → `DtmBasis`
- Update `NORMAL_METHOD_LABELS` → `DTM_BASIS_LABELS`
- Update `FIELD_LABELS['normalMethod']` → `FIELD_LABELS['dtmBasis']`

### 3. Code Updates (12 files)

| File | Changes |
|------|---------|
| `src/components/PlantingSpecEditor.tsx` | Update field name, option values, help modal text |
| `src/components/SpecExplorer.tsx` | Update field references |
| `src/components/PlantingSpecCreator.tsx` | Update field name |
| `src/components/GddExplorerModal.tsx` | Update comments referencing normalMethod |
| `src/components/CompareSpecsModal.tsx` | Update field name |
| `src/lib/spec-explorer-columns.ts` | Update column key |
| `src/data/build-minimal-crops.js` | Update field name in stock data builder |
| `scripts/migrate-naming-conventions.js` | Update if still relevant |

### 4. Template Data

**`src/data/planting-spec-template.json`:**
- Rename all `normalMethod` → `dtmBasis`
- Transform all values using the mapping above

### 5. Documentation

**`.claude/skills/crop-data/SKILL.md`:**
- Update field name and values
- Update example code

## Verification

1. Run `npm run build` - no type errors
2. Open app, load existing plan - migration runs
3. Edit a spec - dtmBasis dropdown shows new labels
4. Create new spec - uses new field/values
5. Undo/redo works (patch migration)
6. Create new plan from template - uses new values

## Rollback

Restore from backup: `data/plans/backup-20260130-155609/`
