# Shared Data Layer + Declarative Sort/Filter

## Problem

Three views (Timeline, Plantings, Overview) consume `useComputedCrops()` → `TimelineCrop[]` but then each re-looks up the same spec data and re-computes the same values independently. This creates:
- **Divergent enrichment**: Each view has its own enriched type with different field names for the same data
- **Duplicated sort switches**: 11 cases (Timeline) + 16 cases (Plantings) + 11 cases (Overview)
- **Duplicated filter configs**: Nearly identical search configs using different property accessors
- **Adding a field** touches 3+ files with custom logic each time

## User's Mental Model (correct)

```
Input values (Planting, stored)
    ↓
Calculated values (shared — spec lookups, dates, revenue)  ← filter/sort HERE
    ↓
UI-specific calculations (thin, per-view)                  ← view-specific
```

If we compute shared values once at the TimelineCrop level, all views filter/sort the same type with the same config. The view-specific layers shrink to almost nothing.

## TanStack Table — Why Not (for sort/filter)

TanStack Table is only used in Reports. FastEditTable uses TanStack Virtual (virtualization only). CropTimeline is a Gantt chart that doesn't fit a table model. Our search DSL already handles field:value filtering with negation and aliases — the only gap is declarative sorting. Extending our DSL is ~100 lines, not a library migration.

## Two-Phase Approach

### Phase 1: Declarative Sort/Filter on SearchConfig

Extend `SearchConfig` with sort definitions so adding a sortable field = one config entry. Replace all switch statements. **No type changes needed** — works with current types as-is.

### Phase 2: Enrich TimelineCrop with Shared Calculated Fields

Move spec lookups and common calculations from per-view enrichment into `expandToTimelineCrops()`. All views get these fields for free. Enrichment layers shrink. Filter/sort configs converge.

---

## Phase 1: Declarative Sort/Filter

### 1a. `src/lib/search-dsl.ts` — Extend types + add `createComparator()`

**Extend `FilterFieldDef<T>`:**
```ts
/** If true, this field appears in sort autocomplete. */
sortable?: boolean;
/** Extract sort value (may differ from filter value). Falls back to getValue(). */
getSortValue?: (entity: T) => string | number | boolean | null | undefined;
/** Custom comparator for complex sorts (e.g., multi-key sequence grouping). */
customCompare?: (a: T, b: T) => number;
```

**Extend `SearchConfig<T>`:**
```ts
/** Fields available for sorting but not field:value filtering */
sortFields?: FilterFieldDef<T>[];
```

**Add `createComparator(config, sortField, sortDir)`:**
- Builds lookup from `config.fields` (where `sortable: true`) + `config.sortFields`, using name + aliases
- If field has `customCompare`, wrap with direction flip
- Otherwise use `getSortValue ?? getValue` to extract values
- Generic comparison: nulls sort last, numbers numeric, strings localeCompare
- Returns `() => 0` for unknown fields (safe no-op)

**Update `getSortFieldNames()` / `getFilterFieldNames()`** to derive from config.

**Cache `buildFieldMap` per config** via WeakMap (perf-audit bottleneck #6 — eliminates 700 Map constructions per keystroke).

### 1b. `src/lib/search-configs.ts` — Add sort definitions

**`timelineCropSearchConfig`** — mark filter fields as sortable where applicable, add sort-only fields:
- Sort-only: `date` (aliases: `['start']`), `end`, `name`, `feet` (aliases: `['size']`), `sequence` (custom comparator)
- Filter fields that are also sortable: `bed`, `category`, `method`, `irrigation`, `rowcover`

**Factory for revenue** (needs runtime data):
```ts
export function createTimelineCropSearchConfig(
  getRevenue?: (crop: TimelineCropFilterable) => number
): SearchConfig<TimelineCropFilterable>
```

**`enrichedPlantingSearchConfig`** — add sort-only fields for Plantings-specific columns:
- `crop`, `specName`, `fieldStartDate`, `ghDate`, `harvestStart`, `harvestEnd`, `bedFeet`, `dtm`, `harvestWindow`, `daysInField`, `daysInCells`, `revenue`, `revenuePerFt`, `growingStructure`, `id`, `specId`, `lastModified`

**Extend `TimelineCropFilterable`** with sort-relevant fields already on TimelineCrop:
- `startDate`, `endDate`, `name`, `feetNeeded`, `sequenceId`, `sequenceSlot`

### 1c. `src/components/CropTimeline.tsx` — Replace switch + hardcoded arrays

**Before** (~70 lines, lines 454-511):
```ts
const compareCrops = useCallback((a, b) => {
  switch (sortField) { /* 11 cases */ }
}, [sortField, sortDir, getRevenue]);
```

**After** (~5 lines):
```ts
const sortConfig = useMemo(() => createTimelineCropSearchConfig(getRevenue), [getRevenue]);
const compareCrops = useMemo(
  () => sortField ? createComparator(sortConfig, sortField, sortDir) : () => 0,
  [sortConfig, sortField, sortDir]
);
```

Replace hardcoded SearchInput props (~line 1765):
```ts
sortFields={getSortFieldNames(sortConfig)}
filterFields={getFilterFieldNames(sortConfig)}
```

### 1d. `src/app/plantings/[planId]/page.tsx` — Replace 16-case switch

Replace sort switch (lines 995-1016) with `createComparator()`.
Replace hardcoded sortFields/filterFields arrays (lines 1605-1607).

### 1e. `src/app/overview/[planId]/page.tsx` — Replace 11-case switch

Replace sort switch (lines 785-806) with `createComparator()`.
Create overview-specific config or reuse timeline config for `EnrichedUnassignedCrop`.

---

## Phase 2: Enrich TimelineCrop (future, separate PR)

### What moves to TimelineCrop

Currently `expandToTimelineCrops()` in `planting-display-calc.ts` creates TimelineCrop but does NOT include many spec fields. These would move from per-view enrichment to the shared computation:

| Field | Currently | Source | Notes |
|-------|-----------|--------|-------|
| `cropName` | Plantings/Overview re-lookup | `spec.crop` | Already on TC as `crop` field |
| `specName` | Plantings/Overview re-lookup | `spec.name` | Add to TC |
| `dtm` | Plantings re-lookup | `getPrimarySeedToHarvest(spec)` | Already computed in PlantingConfigLookup, not copied |
| `daysInCells` | Plantings re-lookup | `calculateDaysInCells(spec)` | Already computed, not copied |
| `daysInField` | Plantings re-lookup | `calculateFieldOccupationDays(spec)` | Already computed, not copied |
| `rows` | Plantings re-lookup | `spec.rows` | Add to TC |
| `spacing` | Plantings re-lookup | `spec.spacing` | Add to TC |
| `ghDate` | Plantings re-compute | `fieldDate - daysInCells` | Derive from above |
| `plants` | Plantings re-compute | `calculatePlantCount(bedFeet, rows, spacing)` | Derive from above |
| `isUnassigned` | Plantings compute | `!startBed` | Simple flag |

### What stays view-specific

| Field | View | Why |
|-------|------|-----|
| `bedsDisplay` | Plantings | Formatted string "A1, A2, A3 (12')" |
| `bedName` | Plantings | Lookup from bed definitions |
| `seedSourceDisplay` | Plantings | Variety/mix name lookup |
| `revenuePerFt` | Plantings | Derived from revenue |
| `maxYieldPerWeek` | Plantings | Display string format |
| `minYieldPerWeek` | Plantings | Display string format |

### What this enables

Once TimelineCrop carries these shared fields:
1. **Single search config** — `timelineCropSearchConfig` covers most filter/sort needs across all views
2. **Plantings config becomes extension** — only adds its view-specific sort fields
3. **Overview drops its enrichment** — just filters TimelineCrop directly
4. **Filter before enrich** — all views can filter on the shared type first, then do thin UI formatting

---

## Implementation Order

**Phase 1 (this PR):**
1. `search-dsl.ts` — Add types + `createComparator()` + WeakMap cache for buildFieldMap
2. `search-configs.ts` — Add `sortFields` to configs + factory + extend interfaces
3. `CropTimeline.tsx` — Replace switch + hardcoded props
4. `plantings/page.tsx` — Replace switch + props
5. `overview/page.tsx` — Replace switch + props
6. Type check: `npx tsc --noEmit`

**Phase 2 (future PR):**
7. Expand TimelineCrop type with shared calculated fields
8. Move spec lookups into `expandToTimelineCrops()`
9. Slim down EnrichedPlanting to only view-specific fields
10. Converge search configs

## What stays manual

- **`compareBeds`** in CropTimeline: Sorts bed *names* using aggregate data (revenue per bed, crop count). Different entity type, only 3-4 cases.
- **SpecExplorer**: Already has generic property-key sorting.

## Verification (Phase 1)
1. `npx tsc --noEmit` — clean
2. Timeline: `s:date`, `s:revenue`, `s:sequence`, `s:irrigation` all work
3. Timeline: `s:sequence` groups by sequenceId then orders by slot
4. Plantings page: all sort columns work via DSL
5. Overview page: all sort columns work
6. SearchInput autocomplete shows sort/filter fields from config (no hardcoded arrays)
7. Add a hypothetical field to config — verify it works for sort, filter, and autocomplete with zero component changes
