# Sequence GDD Staggering Design

## Overview

Add GDD-based harvest staggering to sequences, enabling evenly-spaced harvests regardless of seasonal temperature variations.

## Two Independent GDD Systems

### Crop-Level GDD (`useGddTiming` on Planting)
**What it does:** Adjusts how long a crop takes to reach harvest based on accumulated heat units instead of fixed calendar days.

**Example:** A tomato with 1200 GDD to maturity planted April 1 might harvest July 15 (105 days in cool spring), while one planted June 1 might harvest August 10 (70 days in warm summer).

**UI location:** Planting inspector, per-planting toggle

### Sequence-Level GDD (`useGddStagger` on Sequence)
**What it does:** Calculates variable planting date offsets so that harvests are evenly spaced by the target number of days.

**Example:** To achieve 7-day harvest spacing:
- Slot 0: Plant March 1 → Harvest May 15
- Slot 1: Plant March 10 (9 days later) → Harvest May 22 (7 days later)
- Slot 2: Plant March 18 (8 days later) → Harvest May 29 (7 days later)

The planting gaps vary (9 days, 8 days) to achieve consistent harvest gaps (7 days, 7 days).

**UI location:** Sequence create/edit modal, sequence-level toggle

### How They Interact

These are **independent and orthogonal**:

| Crop GDD | Sequence GDD Stagger | Result |
|----------|---------------------|--------|
| OFF | OFF | Fixed planting offsets, fixed DTM → uneven harvests in variable weather |
| OFF | ON | Dynamic planting offsets, fixed DTM → even harvest spacing |
| ON | OFF | Fixed planting offsets, GDD-based DTM → harvests vary with season |
| ON | ON | Dynamic planting offsets, GDD-based DTM → even harvest spacing with weather-adjusted growth |

**Key insight:** Sequence GDD staggering works even if crop-level GDD is OFF. It uses GDD calculations to determine *when to plant*, not *how long growth takes*.

---

## UI Copy for Sequence Modal

### Toggle Label
**"Use GDD-based harvest stagger"** (checkbox)

### Help Text (expandable info panel)
> **What is GDD-based staggering?**
>
> Normally, succession plantings are spaced by fixed planting dates (e.g., plant every 7 days). But crops grow faster in warm weather and slower in cool weather, so harvest dates end up unevenly spaced.
>
> With GDD staggering enabled, the system calculates variable planting offsets so your **harvests** are evenly spaced by your target interval. Early-season plantings may be closer together; late-season plantings may be further apart.
>
> **This is different from crop-level GDD timing**, which affects how long each individual crop takes to mature. GDD staggering affects when to plant each slot in the sequence.

### Preview Section Update
When `useGddStagger` is ON, show both dates:
```
#1: Plant Mar 1 → Harvest May 15
#2: Plant Mar 10 (+9d) → Harvest May 22 (+7d)
#3: Plant Mar 18 (+8d) → Harvest May 29 (+7d)
```

When OFF (current behavior):
```
#1: Mar 1
#2: Mar 8 (+7d)
#3: Mar 15 (+7d)
```

---

## Data Model Changes

```typescript
interface PlantingSequence {
  id: string;
  name?: string;
  offsetDays: number;
  useGddStagger?: boolean;  // NEW
}
```

When `useGddStagger` is true:
- `offsetDays` means "days between harvests" (goal)
- Planting dates are calculated dynamically

When `useGddStagger` is false (default):
- `offsetDays` means "days between plantings" (current behavior)
- Harvest spacing varies with weather

---

## GDD Calculation Caching Strategy

### Problem
GDD calculations are slow because they iterate through daily temperature data repeatedly. With sequences, we may calculate many forward/reverse lookups per render.

### Solution: Cumulative GDD Lookup Table

Build a single lookup table per year that maps each date to cumulative GDD from January 1:

```typescript
interface GddLookupTable {
  year: number;
  baseTemp: number;
  upperTemp: number;
  // Day of year (0-365) → cumulative GDD from Jan 1
  cumulativeGdd: number[];
}
```

**Build once per (year, baseTemp, upperTemp) tuple.**

### Forward Lookup (plant date → harvest date)
```typescript
function getHarvestDate(plantDate: Date, gddNeeded: number): Date {
  const plantDoy = getDayOfYear(plantDate);
  const targetGdd = table.cumulativeGdd[plantDoy] + gddNeeded;
  // Binary search for day where cumulative GDD >= targetGdd
  const harvestDoy = binarySearch(table.cumulativeGdd, targetGdd);
  return dayOfYearToDate(harvestDoy, year);
}
```

### Reverse Lookup (target harvest date → required plant date)
```typescript
function getPlantDate(harvestDate: Date, gddNeeded: number): Date {
  const harvestDoy = getDayOfYear(harvestDate);
  const targetGdd = table.cumulativeGdd[harvestDoy] - gddNeeded;
  // Binary search for day where cumulative GDD >= targetGdd
  const plantDoy = binarySearch(table.cumulativeGdd, targetGdd);
  return dayOfYearToDate(plantDoy, year);
}
```

### Cache Location
Store in `useComputedCrops` or a new `useGddCache` hook:
- Key: `${year}-${baseTemp}-${upperTemp}`
- Built lazily on first access
- Cleared when year or temp settings change

### Performance Gains
- **Before:** O(days) per GDD calculation, repeated N times per render
- **After:** O(365) once to build table, then O(log 365) per lookup

---

## Implementation Plan

### Phase 1: GDD Caching ✅ COMPLETE
1. ✅ Created `src/lib/gdd-cache.ts` with cumulative GDD table and lookups
2. ✅ Added `getCumulativeTable()` - builds cumulative GDD array for O(log n) lookups
3. ✅ Added `findHarvestDate()` - forward lookup (plant date → harvest date)
4. ✅ Added `findPlantDate()` - reverse lookup (harvest date → plant date)
5. ✅ Integrated into `createGddCalculator()` - uses cached binary search instead of O(n) iteration

**Performance gains achieved:**
- Daily GDD values computed once per (baseTemp, upperTemp, structureOffset) combination
- Cumulative tables built once per year, reused for all lookups
- Binary search gives O(log 366) ≈ 9 comparisons per lookup vs O(n) iteration
- Trig functions (`Math.acos`, `Math.sin`) only called once per day in history

### Phase 2: Data Model
1. Add `useGddStagger?: boolean` to `PlantingSequence` interface
2. Add migration (optional field, no migration needed)
3. Update `computeSequenceDate` to use GDD stagger when enabled

### Phase 3: UI
1. Add toggle to CreateSequenceModal
2. Add toggle to SequenceEditorModal
3. Update preview to show both plant and harvest dates when GDD stagger is ON
4. Add help text explaining the feature

### Phase 4: Store Actions
1. Update `createSequenceFromPlanting` to accept `useGddStagger` option
2. Update `updateSequenceOffset` to handle GDD stagger mode
3. Add `updateSequenceGddStagger` action

---

## Files to Modify

| File | Changes | Status |
|------|---------|--------|
| `src/lib/gdd-cache.ts` | NEW - cumulative GDD table and lookups | ✅ Done |
| `src/lib/gdd.ts` | Integrate caching, add reverse lookup | ✅ Done |
| `src/lib/entities/planting-sequence.ts` | Add `useGddStagger` field |
| `src/lib/plan-store.ts` | Update sequence actions |
| `src/components/CreateSequenceModal.tsx` | Add toggle + help text |
| `src/components/SequenceEditorModal.tsx` | Add toggle + help text, update preview |
| `src/lib/use-computed-crops.ts` | Consider caching GDD table here |

---

## Open Questions

1. **Cross-year sequences:** If a sequence spans into the next year, we need to handle the table boundary. Solution: Build tables for both years and stitch together.

2. **Different base temps per crop:** Currently GDD uses crop-specific base temps. For sequences, all plantings share a spec, so they share base temp. No issue.

3. **Preview accuracy:** The preview needs access to GDD calculator. Should we pass it down or compute in the modal?
