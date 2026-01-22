# Single Source of Truth Implementation Plan

**Date**: 2026-01-22
**Objective**: Eliminate duplicate calculations and ensure all views consume the same computed state

---

## Problems Identified

### 1. Duplicate Date Calculations (HIGH SEVERITY)

**PlantingsPage** (`src/app/plantings/[planId]/page.tsx` lines 679-781) manually recalculates:
- `ghDate` = fieldDate - daysInCells
- `harvestStart` = fieldDate + (dtm - daysInCells)
- `harvestEnd` = harvestStart + harvestWindow

These are **duplicates** of the authoritative `calculateCropTiming()` in `crop-timing-calculator.ts`.

**Impact**:
- ❌ Actual dates ignored (PlantingsPage always uses plan dates)
- ❌ Sequence plantings show wrong dates
- ❌ Two codepaths to maintain for same logic
- ❌ Users see different dates in different views

**Example**:
```
Planting with actuals set:
  fieldStartDate: 2025-06-01 (plan)
  actuals.fieldDate: 2025-06-10 (actual, 9 days late)

Timeline: Shows dates calculated from 2025-06-10 ✓
PlantingsPage: Shows dates calculated from 2025-06-01 ✗ WRONG
```

### 2. Config Timing Values Recalculated Per View

Both Timeline and PlantingsPage independently call:
- `calculateDaysInCells(config)`
- `calculatePlantingMethod(config)`
- `getPrimarySeedToHarvest(config)`
- `calculateAggregateHarvestWindow(config)`

These are **pure functions of config** and should be computed once.

### 3. Legacy "Slim Planting" Terminology

The term `SlimPlanting` is an artifact from old architecture (hundreds of commits ago).

**Current confusion**:
- `SlimPlanting` interface - "minimal planting data"
- `Planting` entity - the actual storage type
- `plantingToSlim()` - converter function
- `extractSlimPlanting()` - import converter

**Reality**: There's only ONE planting type now. The "slim" vs "fat" distinction no longer exists.

---

## Current Data Flow (Broken)

```
Storage (SQLite):
  Planting { id, configId, fieldStartDate, startBed, bedFeet, overrides, actuals }

Computation Layer:
  expandPlantingsToTimelineCrops(plantings, beds, catalog, bedGroups, sequences)
    → for each planting:
      → lookupConfigFromCatalog() → base config
      → resolveEffectiveTiming() → apply overrides
      → calculateCropTiming() → [AUTHORITATIVE] all dates
      → calculateRowSpan() → bed span
      → returns TimelineCrop[]

Display Layer:
  Timeline Page ──→ getTimelineCropsFromPlan() ──→ TimelineCrop[] ✓
                                                          ↓
                                                  renders directly

  Plantings Page ──→ enrichedPlantings useMemo ──→ EnrichedPlanting[]
                     (IGNORES TimelineCrop[])          ↓
                     recalculates dates manually    renders grid
```

**Problem**: PlantingsPage bypasses the computed state and recalculates from scratch.

---

## Target Data Flow (Fixed)

```
Storage (SQLite):
  Planting { id, configId, fieldStartDate, startBed, bedFeet, overrides, actuals }
                                    ↓
Computation Layer (SINGLE EXECUTION):
  expandPlantingsToTimelineCrops() → TimelineCrop[]
    - All dates computed via calculateCropTiming()
    - All bed spans computed via calculateRowSpan()
    - Actual dates properly handled
    - Sequences computed correctly
                                    ↓
                    ┌───────────────┴───────────────┐
                    ↓                               ↓
            Timeline View                   Plantings View
        (renders TimelineCrop[])      (derives grid from TimelineCrop[])
        - startDate                   - groups by groupId
        - endDate                     - extracts dates from first crop
        - harvestStartDate            - formats beds from all crops in group
        - resource (bed)              - adds grid-specific fields
```

**Benefit**: Single calculation, multiple views. Guaranteed consistency.

---

## Implementation Plan

### Phase 1: Make PlantingsPage Consume TimelineCrop[]

**Goal**: Remove duplicate date calculations from PlantingsPage

**Files to change**:
- `src/app/plantings/[planId]/page.tsx` - Rewrite enrichedPlantings useMemo

**Current code** (lines 679-781):
```typescript
const enrichedPlantings = useMemo((): EnrichedPlanting[] => {
  return currentPlan.plantings.map((p) => {
    const config = catalogLookup[p.configId];

    // DUPLICATE CALCULATIONS (remove these)
    const daysInCells = calculateDaysInCells(config);
    const method = calculatePlantingMethod(config);
    const dtm = getPrimarySeedToHarvest(config);
    const harvestWindow = calculateAggregateHarvestWindow(config);

    const fieldDate = parseISO(p.fieldStartDate);
    const ghDate = method === 'transplant' && daysInCells > 0
      ? format(addDays(fieldDate, -daysInCells), 'yyyy-MM-dd')
      : null;
    const harvestStart = dtm > 0
      ? format(addDays(fieldDate, dtm - daysInCells), 'yyyy-MM-dd')
      : null;
    const harvestEnd = harvestStart && harvestWindow > 0
      ? format(addDays(parseISO(harvestStart), harvestWindow), 'yyyy-MM-dd')
      : harvestStart;

    // ... rest of enrichment
  });
}, [currentPlan?.plantings, ...]);
```

**New code**:
```typescript
// Step 1: Compute TimelineCrop[] once
const timelineCrops = useMemo(() =>
  getTimelineCropsFromPlan(currentPlan),
  [currentPlan]
);

// Step 2: Group by planting (groupId)
const cropsByPlanting = useMemo(() => {
  const groups = new Map<string, TimelineCrop[]>();
  for (const crop of timelineCrops) {
    if (!groups.has(crop.groupId)) {
      groups.set(crop.groupId, []);
    }
    groups.get(crop.groupId)!.push(crop);
  }
  return groups;
}, [timelineCrops]);

// Step 3: Derive grid data from TimelineCrop[]
const enrichedPlantings = useMemo((): EnrichedPlanting[] => {
  if (!currentPlan?.plantings) return [];

  return currentPlan.plantings.map((planting) => {
    const crops = cropsByPlanting.get(planting.id) || [];
    const firstCrop = crops[0];

    if (!firstCrop) {
      // Planting has no timeline crops (shouldn't happen, but handle gracefully)
      return {
        ...planting,
        cropName: planting.configId,
        category: '',
        // ... defaults
      };
    }

    // Extract dates from pre-computed TimelineCrop
    // startDate is ISO with time, strip to date
    const extractDate = (isoDateTime: string) => isoDateTime.split('T')[0];

    const config = catalogLookup[planting.configId];
    const method = firstCrop.plantingMethod;

    // USE PRE-COMPUTED VALUES
    const ghDate = method === 'transplant'
      ? extractDate(firstCrop.startDate)  // GH start is the display startDate for transplants
      : null;
    const harvestStart = firstCrop.harvestStartDate
      ? extractDate(firstCrop.harvestStartDate)
      : null;
    const harvestEnd = extractDate(firstCrop.endDate);

    // Derive grid-specific fields
    const bedsDisplay = formatBedSpan(crops);
    const plants = config?.rows && config?.spacing
      ? calculatePlants(planting.bedFeet, config.rows, config.spacing)
      : null;

    // Seed source display (same logic as before)
    const seedSourceDisplay = resolveSeedSourceDisplay(
      planting.seedSource,
      config?.defaultSeedSource,
      varietiesLookup,
      seedMixesLookup
    );

    return {
      ...planting,
      cropName: firstCrop.name,
      category: firstCrop.category || '',
      identifier: config?.identifier || planting.configId,
      bedName: crops[0]?.resource || '',
      bedsDisplay,
      isUnassigned: !planting.startBed,
      isFailed: planting.actuals?.failed ?? false,
      dtm: config ? getPrimarySeedToHarvest(config) : 0,  // for display/sorting only
      harvestWindow: config ? calculateAggregateHarvestWindow(config) : 0,
      method: method === 'transplant' ? 'TP' : method === 'direct-seed' ? 'DS' : 'P',
      rows: config?.rows ?? null,
      spacing: config?.spacing ?? null,
      plants,
      seedSourceDisplay,
      sequenceDisplay: planting.sequenceId || '',
      seqNum: planting.sequenceSlot !== undefined ? planting.sequenceSlot + 1 : null,
      ghDate,
      harvestStart,
      harvestEnd,
    };
  });
}, [currentPlan?.plantings, cropsByPlanting, catalogLookup, varietiesLookup, seedMixesLookup]);

// Helper: Format bed span for grid display
function formatBedSpan(crops: TimelineCrop[]): string {
  if (crops.length === 0) return '';

  // Sort by bedIndex to maintain order
  const sorted = [...crops].sort((a, b) => a.bedIndex - b.bedIndex);

  const parts = sorted.map((crop, idx) => {
    const isLast = idx === sorted.length - 1;
    const isPartial = crop.feetUsed && crop.bedCapacityFt && crop.feetUsed < crop.bedCapacityFt;

    // Show feet on last bed if partial
    if (isLast && isPartial) {
      return `${crop.resource} (${crop.feetUsed}')`;
    }
    return crop.resource;
  });

  return parts.join(', ');
}

// Helper: Extract seed source display string
function resolveSeedSourceDisplay(
  seedSource: SeedSource | undefined,
  defaultSeedSource: SeedSource | undefined,
  varieties: Record<string, Variety>,
  mixes: Record<string, SeedMix>
): string {
  const source = seedSource || defaultSeedSource;
  if (!source) return '';

  if (source.type === 'variety') {
    return varieties[source.id]?.name ?? source.id;
  } else if (source.type === 'mix') {
    return mixes[source.id]?.name ?? source.id;
  }
  return '';
}

// Helper: Calculate plant count
function calculatePlants(bedFeet: number, rows: number, spacing: number): number {
  if (!spacing || spacing <= 0) return 0;
  return Math.round((bedFeet * 12 / spacing) * rows);
}
```

**Benefits**:
- ✅ Removes ~100 lines of duplicate calculation logic
- ✅ Actual dates now respected in PlantingsPage
- ✅ Sequence plantings show correct effective dates
- ✅ Single source of truth for all date computations
- ✅ Both views guaranteed to show same dates

**Testing**:
```typescript
// Test case 1: Planting with actual dates
const planting = {
  id: 'P001',
  fieldStartDate: '2025-06-01',
  actuals: { fieldDate: '2025-06-10' }, // 9 days late
};

const timelineCrop = expandPlantings([planting])[0];
const enrichedPlanting = enrichPlantings([planting])[0];

assert(timelineCrop.harvestStartDate === enrichedPlanting.harvestStart);
assert(timelineCrop.endDate === enrichedPlanting.harvestEnd);

// Test case 2: Sequence planting (follower)
const sequence = { id: 'S1', offsetDays: 14 };
const anchor = { id: 'P001', fieldStartDate: '2025-05-01', sequenceId: 'S1', sequenceSlot: 0 };
const follower = { id: 'P002', fieldStartDate: '2025-05-01', sequenceId: 'S1', sequenceSlot: 1 };

// Both views should show follower starting 14 days after anchor
const timelineCrops = expandPlantings([anchor, follower], sequences);
const enriched = enrichPlantings([anchor, follower]);

const followerTimeline = timelineCrops.find(c => c.groupId === 'P002');
const followerEnriched = enriched.find(p => p.id === 'P002');

assert(followerTimeline.startDate === followerEnriched.ghDate);
```

---

### Phase 2: Remove "Slim Planting" Terminology

**Goal**: Simplify naming by removing outdated "slim" terminology

**Files to change**:
- `src/lib/slim-planting.ts` - Rename interfaces and functions
- `src/lib/timeline-data.ts` - Update imports and usages
- Any other files importing from slim-planting

**Changes**:

1. **Rename `SlimPlanting` → Remove interface entirely**
   - The interface just mirrors `Planting` entity
   - Use `Planting` directly in function signatures

2. **Rename `computeTimelineCrop()` → `expandPlanting()`**
   ```typescript
   // Before
   function computeTimelineCrop(
     planting: SlimPlanting,
     config: PlantingConfigLookup,
     bedGroups: Record<string, string[]>,
     bedLengths: Record<string, number>
   ): TimelineCrop[]

   // After
   function expandPlanting(
     planting: Planting,
     config: CropConfig,
     bedGroups: Record<string, string[]>,
     bedLengths: Record<string, number>
   ): TimelineCrop[]
   ```

3. **Remove converter functions**
   - `plantingToSlim()` - no longer needed
   - `extractSlimPlanting()` - simplify to direct extraction

4. **Update `PlantingConfigLookup` → use `CropConfig` directly**
   - The lookup interface duplicates fields from CropConfig
   - Just pass the full CropConfig

**Benefits**:
- ✅ Clearer mental model: `Planting` (storage) → `TimelineCrop` (display)
- ✅ Less abstraction, fewer converter functions
- ✅ Easier onboarding (no need to explain "slim vs fat")

---

### Phase 3: Cache TimelineCrop[] in Store (Optional Optimization)

**Goal**: Avoid recomputing TimelineCrop[] on every render

**Current**: Both Timeline and PlantingsPage call `getTimelineCropsFromPlan()` independently

**Optimization**: Cache in plan store with selector

```typescript
// In plan-store.ts
interface PlanState {
  currentPlan: Plan | null;
  // ... existing state

  // Add cached computed state
  _cachedTimelineCrops: TimelineCrop[] | null;
  _cacheInvalidated: boolean;
}

// Selector
const getTimelineCrops = (state: PlanState): TimelineCrop[] => {
  if (!state.currentPlan) return [];

  // Return cached if valid
  if (state._cachedTimelineCrops && !state._cacheInvalidated) {
    return state._cachedTimelineCrops;
  }

  // Recompute and cache
  const crops = expandPlantingsToTimelineCrops(
    state.currentPlan.plantings,
    state.currentPlan.beds,
    state.currentPlan.cropCatalog,
    state.currentPlan.bedGroups,
    state.currentPlan.sequences
  );

  state._cachedTimelineCrops = crops;
  state._cacheInvalidated = false;

  return crops;
};

// Invalidate on mutations
const invalidateTimelineCropsCache = (state: PlanState) => {
  state._cacheInvalidated = true;
};

// All mutation methods call invalidate:
addPlanting: (planting) => {
  set(produce((state) => {
    state.currentPlan.plantings.push(planting);
    invalidateTimelineCropsCache(state);
  }));
}
```

**Usage**:
```typescript
// In components
const timelineCrops = usePlanStore(state => getTimelineCrops(state));
```

**Benefits**:
- ✅ Compute once per mutation instead of per render
- ✅ Both views automatically share the same cached result
- ✅ Invalidation handled automatically by store

**Trade-off**: Adds complexity to store. Only implement if profiling shows performance issue.

---

### Phase 4: Add Config Value Caching (Optional)

**Goal**: Compute config-derived values (daysInCells, dtm, etc.) once per config

Currently these are pure functions called repeatedly:
```typescript
// Called multiple times per render
const daysInCells = calculateDaysInCells(config);
const dtm = getPrimarySeedToHarvest(config);
const harvestWindow = calculateAggregateHarvestWindow(config);
```

**Optimization**: Memoize at catalog level

```typescript
// In plan-store or catalog loader
interface CachedCropConfig extends CropConfig {
  _computed: {
    daysInCells: number;
    seedToHarvest: number;
    harvestWindow: number;
    plantingMethod: PlantingMethod;
  };
}

function enrichCatalog(catalog: Record<string, CropConfig>): Record<string, CachedCropConfig> {
  const enriched: Record<string, CachedCropConfig> = {};

  for (const [id, config] of Object.entries(catalog)) {
    enriched[id] = {
      ...config,
      _computed: {
        daysInCells: calculateDaysInCells(config),
        seedToHarvest: getPrimarySeedToHarvest(config),
        harvestWindow: calculateAggregateHarvestWindow(config),
        plantingMethod: calculatePlantingMethod(config),
      }
    };
  }

  return enriched;
}
```

**Benefits**:
- ✅ Compute once at load time instead of per-render
- ✅ ~300 configs × 4 calculations = 1200 function calls saved per render

**Trade-off**: Memory overhead (~few KB). Only implement if profiling shows it matters.

---

## Validation & Testing

### Unit Tests

```typescript
describe('Single Source of Truth', () => {
  it('Timeline and PlantingsPage show same dates for normal planting', () => {
    const plan = createTestPlan({
      plantings: [{ fieldStartDate: '2025-06-01', configId: 'lettuce-tp' }]
    });

    const timelineCrops = getTimelineCropsFromPlan(plan);
    const enrichedPlantings = enrichPlantingsFromTimelineCrops(timelineCrops, plan.plantings);

    expect(timelineCrops[0].harvestStartDate).toBe(enrichedPlantings[0].harvestStart);
    expect(timelineCrops[0].endDate).toBe(enrichedPlantings[0].harvestEnd);
  });

  it('Timeline and PlantingsPage show same dates when actuals set', () => {
    const plan = createTestPlan({
      plantings: [{
        fieldStartDate: '2025-06-01',
        actuals: { fieldDate: '2025-06-10' }, // 9 days late
        configId: 'lettuce-tp'
      }]
    });

    const timelineCrops = getTimelineCropsFromPlan(plan);
    const enrichedPlantings = enrichPlantingsFromTimelineCrops(timelineCrops, plan.plantings);

    // Both should reflect the actual field date of 2025-06-10
    expect(enrichedPlantings[0].harvestStart).toContain('2025-07'); // later than plan
    expect(timelineCrops[0].harvestStartDate).toBe(enrichedPlantings[0].harvestStart);
  });

  it('Sequence followers show correct offset dates', () => {
    const plan = createTestPlan({
      plantings: [
        { id: 'P001', fieldStartDate: '2025-05-01', sequenceId: 'S1', sequenceSlot: 0 },
        { id: 'P002', fieldStartDate: '2025-05-01', sequenceId: 'S1', sequenceSlot: 1 },
      ],
      sequences: {
        S1: { id: 'S1', offsetDays: 14 }
      }
    });

    const timelineCrops = getTimelineCropsFromPlan(plan);
    const enrichedPlantings = enrichPlantingsFromTimelineCrops(timelineCrops, plan.plantings);

    const follower = enrichedPlantings.find(p => p.id === 'P002');
    // Should start 14 days after anchor
    expect(follower.ghDate).toBe('2025-05-15');
  });
});
```

### Integration Tests

```typescript
describe('PlantingsPage Integration', () => {
  it('displays correct dates after actual date is set', async () => {
    const { user, getByText, getByLabelText } = render(<PlantingsPage planId="test" />);

    // Set actual field date
    await user.click(getByText('P001')); // select planting
    await user.type(getByLabelText('Actual Field Date'), '2025-06-10');
    await user.click(getByText('Save'));

    // Both timeline and grid should update to show dates from actual
    expect(getByText(/Harvest: 2025-07/)).toBeInTheDocument();
  });
});
```

---

## Migration & Rollout

### Step 1: Add Tests
- Add unit tests for date calculation consistency
- Add integration tests for PlantingsPage

### Step 2: Implement Phase 1
- Rewrite PlantingsPage enrichedPlantings useMemo
- Verify all existing functionality still works
- Run test suite

### Step 3: Manual QA
- Open plan with various planting types:
  - Direct seed crops
  - Transplant crops
  - Crops with actual dates set
  - Sequence plantings
- Verify Timeline and PlantingsPage show identical dates
- Test sorting, filtering still work

### Step 4: Deploy
- Merge to main
- Monitor for issues

### Step 5 (Later): Implement Phase 2
- Rename "SlimPlanting" terminology
- This is purely refactoring, no user-facing changes

### Step 6 (Optional): Implement Phase 3/4
- Only if profiling shows performance issues
- Add caching optimizations

---

## Success Criteria

- [ ] PlantingsPage shows same dates as Timeline for all plantings
- [ ] Actual dates properly reflected in both views
- [ ] Sequence plantings show correct effective dates
- [ ] No duplicate calculation logic
- [ ] Test coverage for date consistency
- [ ] All existing functionality preserved

---

## Rollback Plan

If issues arise:
1. Revert PlantingsPage changes
2. Fall back to previous enrichedPlantings implementation
3. Keep temporary duplicate logic until fix identified

The change is isolated to PlantingsPage enrichedPlantings useMemo, making rollback straightforward.

---

## Future Improvements

After this is stable:

1. **Add "Computed Fields" inspector**
   - Show all intermediate dates (plannedGH, actualGH, etc.)
   - Useful for debugging "why is this date what it is?"

2. **Memoize per-planting computation**
   - Only recalculate plantings that changed
   - Use immer patches to detect what changed

3. **Export timing calculation explanation**
   - "This crop harvests on X because: GH start Y + DTM Z = X"
   - Help users understand the calculation chain

---

## References

- Previous analysis: `/tmp/data-flow-analysis.md`
- Architecture: `/.claude/plans/data-architecture-v2.md`
- Authoritative calculation: `src/lib/crop-timing-calculator.ts`
- Timeline expansion: `src/lib/timeline-data.ts`
- PlantingsPage current code: `src/app/plantings/[planId]/page.tsx` lines 679-781
