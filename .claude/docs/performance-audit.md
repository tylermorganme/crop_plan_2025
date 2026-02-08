# Performance Audit — Feb 2026

## Context
App becomes unresponsive with hundreds of plantings. Audit identified specific bottlenecks and proposed fixes ranked by impact and risk.

---

## FIXED: GDD Cache Hot Path (was #1 bottleneck — 91% of CPU)

**Where:** gdd-cache.ts — `estimateGddForDayOfYear()` + `getDayOfYear()`

**Problem:** CDP profiling revealed the actual #1 bottleneck was NOT parseISO (as originally theorized), but the GDD cache building code. `getCumulativeTable()` calls `estimateGddForDayOfYear()` for each missing day in the plan year (~300 future days). That function iterated ALL ~3,300 temperature records calling `getDayOfYear(new Date(day.date))` for each one — allocating ~990,000 Date objects per cumulative table build.

- `getDayOfYear`: 7,554ms self-time (49.3% of total CPU)
- `estimateGddForDayOfYear`: 6,424ms self-time (41.9%)
- Combined: **91.2% of all CPU time**

**Fix (applied):**
1. Pre-compute a `avgByDoy: number[]` lookup (index 1-366) during `getDailyCache()` build — historical GDD average per day-of-year computed once in the same pass that builds `byDate`
2. Replace `getDayOfYear(new Date(day.date))` with `dayOfYearFromParts()` that parses month/day/year from the date string directly, using a lookup table for cumulative days per month — no Date object allocation
3. `estimateGddForDayOfYear()` reduced from O(N) full scan to O(1) array lookup

**Result:** GDD functions completely disappeared from CPU profile. Page profile time dropped from ~15s to ~4.4s. Top function is now React rendering (jsxDEV at 320ms).

---

## FIXED: Duplicate Plan Loading (2-3x hydrations per page load)

**Where:** timeline/overview/reports page useEffects + PlanStoreProvider

**Problem:** Three sources triggered plan loading concurrently:
1. `initializePlanStore()` (from PlanStoreProvider) loading last active plan from localStorage
2. Page's `loadPlanFromLibrary(planId)` existence check (which internally loads the plan)
3. Page's `loadPlanById(planId)` actual load

Each hydration was 60-70ms server-side (477 patches in checkpoint), but the 757KB JSON response × 3 loads = significant wasted work.

**Fix (applied):**
1. Added in-flight request deduplication to `loadPlanById` in plan-store.ts — concurrent calls for the same planId share a single promise
2. Removed redundant `loadPlanFromLibrary` calls from timeline, overview, and reports pages — they now call `loadPlanById` directly (plantings page already did this correctly)

**Result:** Server logs show 1 hydration per page load (down from 2-3).

---

## Bottleneck 1: Redundant `parseISO()` calls (~14,600 per render)

**Where:** CropTimeline.tsx — `overlappingIds`, `overCapacityRanges`, `calculateStacking`

The same ISO date strings on TimelineCrop are re-parsed into Date objects thousands of times per render:
- `overlappingIds` (lines 662-688): 4 parseISO per pair comparison, ~10,300 calls
- `overCapacityRanges` (lines 692-751): 2 per crop per bed, ~1,400 calls
- `calculateStacking`: 2 per crop per visible bed, ~800 calls
- `expandToTimelineCrops`: 3 per planting, ~2,100 calls

**Fix:** Add numeric timestamp fields (`startMs`, `endMs`, `harvestStartMs`) to TimelineCrop, computed once during `expandToTimelineCrops()`. All downstream consumers use the pre-parsed numbers instead of calling parseISO. Zero behavior change — just avoiding redundant work.

**Impact:** MEDIUM (was HIGH before GDD fix — now parseISO is 83ms/13.8% of profile, not seconds)
**Risk:** LOW — additive fields, no existing behavior changes

---

## Bottleneck 2: Linear catalog search (238K comparisons per recompute)

**Where:** planting-display-calc.ts:148 — `lookupConfigFromCatalog()`

`catalog.find()` does linear search through a 340-element array for each of 700 plantings. The catalog is converted from `Record<string, PlantingSpec>` to an array via `Object.values()` at timeline-data.ts:643, then searched linearly — despite the original object supporting O(1) key lookup.

**Fix:** Convert `lookupConfigFromCatalog` to accept a `Record<string, PlantingSpec>` (or a `Map`) and do direct key lookup instead of `.find()`. The caller already has the keyed object.

**Impact:** MEDIUM — 238K string comparisons → 700 hash lookups
**Risk:** LOW — same data, different access pattern

---

## Bottleneck 3: Full plan recompute on every mutation

**Where:** use-computed-crops.ts:61-64

`getTimelineCropsFromPlan()` recomputes ALL plantings whenever `currentPlan` changes. This includes mutations that don't affect crop timing:
- Editing planting notes
- Changing plan metadata (name, description)
- Updating planting box display settings
- Importing varieties, seed mixes, products
- Changing market definitions

**Fix options (pick one, increasing complexity):**
1. **Cheaper recompute:** Fix bottlenecks 1+2 first — if full recompute is fast enough (<50ms), this becomes less urgent
2. **Selective invalidation:** Cache TimelineCrop per planting ID, only recompute plantings whose source data changed (compare by lastModified or field equality)
3. **Split plan state:** Separate timing-relevant data (plantings, specs, sequences) from non-timing data (metadata, display settings, markets) so non-timing mutations don't trigger recompute

**Impact:** HIGH — every keystroke in notes field currently recomputes 700 plantings
**Risk:** MEDIUM — cache invalidation bugs possible; option 1 (faster recompute) is safest

---

## Bottleneck 4: Drag preview recomputes everything

**Where:** timeline page previewCrops useMemo (lines 458-613)

During drag with timing edit enabled, `pendingDragChanges` updates every 2-4 pixels. Each update calls `getTimelineCropsFromPlan()` on ALL plantings. A 300px drag = ~75-150 full recomputes.

**Fix:** Only recompute the dragged planting(s) + their sequence members. Keep the rest of `baseCrops` unchanged. Splice the recomputed entries into the array.

**Impact:** HIGH — drag goes from O(N) to O(1) per frame
**Risk:** MEDIUM — need to ensure sequence member recalculation is correct

---

## Bottleneck 5: `overlappingIds` is O(N²)

**Where:** CropTimeline.tsx:662-688

Pairwise comparison of all crops within each bed. With 8 crops/bed average across 92 beds = ~5,300 comparisons. Worse if beds are heavily loaded.

**Fix:** Sort crops by start date within each bed, then use a sweep-line algorithm. Only compare each crop against crops that haven't ended yet. With pre-parsed timestamps (bottleneck 1), this becomes O(N log N) per bed.

**Impact:** MEDIUM — mostly matters for beds with many overlapping plantings
**Risk:** LOW — same output, better algorithm

---

## Bottleneck 6: `buildFieldMap()` rebuilt per filter call

**Where:** search-dsl.ts — `matchesFilter()` calls `buildFieldMap(config.fields)` internally

With 700 crops and a search query, the field map (which is static per SearchConfig) is rebuilt 700 times per keystroke.

**Fix:** Build the field map once when the SearchConfig is created (or lazily on first use), store it on the config object.

**Impact:** MEDIUM — eliminates 700 Map constructions per filter
**Risk:** LOW — pure computation, no side effects

---

## Bottleneck 7: No virtualization

**Where:** CropTimeline.tsx render

All 92 bed rows are rendered in the DOM simultaneously, producing 16,000-23,000 DOM nodes. Crops in off-screen beds are fully rendered and reconciled by React. `renderCropBox()` is called inline with no React.memo.

**Fix:** Virtualize bed rows — only render rows visible in the viewport plus a small buffer. Libraries like react-window or tanstack-virtual work well for this. Could also wrap individual crop boxes in React.memo since their props are stable between selection-only changes.

**Impact:** HIGH for large plans — reduces DOM from ~20K to ~3K nodes
**Risk:** MEDIUM — virtualization affects scroll behavior, sticky headers, and drag-drop. Needs careful testing.

---

## Bottleneck 8: Revenue calculation in sort comparator

**Where:** CropTimeline.tsx:438-443

`getRevenue()` calls `calculateSpecRevenue()` (which evaluates yield formulas) and is invoked O(N log N) times during sort. For 700 plantings sorted by revenue: ~8,400 formula evaluations.

**Fix:** Pre-compute revenue per crop once (keyed by specId + feetNeeded), reuse in comparator.

**Impact:** MEDIUM — only when sorting by revenue
**Risk:** LOW — cache keyed on immutable inputs

---

## Bottleneck 9: Per-planting work in expandToTimelineCrops

**Where:** planting-display-calc.ts, timeline-data.ts

Per planting: ~15-20 function calls, 5-8 object allocations, 3 date format ops, plus sub-calculations (daysInCells, seedToHarvest, harvestWindow, plantingMethod). `calculateAggregateHarvestWindow()` loops productYields twice.

**Fix:** Cache PlantingConfigLookup per specId (specs don't change between plantings using the same spec). Currently a new PlantingConfigLookup is allocated per planting even when 50 plantings share the same spec.

**Impact:** MEDIUM — reduces spec calculation from 700× to ~340× (unique specs)
**Risk:** LOW — specs are immutable within a single computation

---

## Recommended Order

**Phase 1 — Quick wins, zero behavior risk:**
1. ~~GDD cache hot path~~ ✅ FIXED — eliminated 91% of CPU time
2. ~~Duplicate plan loading~~ ✅ FIXED — 1 hydration instead of 2-3
3. Pre-parse timestamps on TimelineCrop (bottleneck 1)
4. Convert catalog lookup to Map/Record (bottleneck 2)
5. Cache buildFieldMap per SearchConfig (bottleneck 6)
6. Cache PlantingConfigLookup per specId (bottleneck 9)
7. Pre-compute revenue for sort (bottleneck 8)

**Phase 2 — Moderate effort, high reward:**
8. Selective drag preview recompute (bottleneck 4)
9. Sweep-line for overlappingIds (bottleneck 5)

**Phase 3 — Larger effort:**
10. Selective plan recompute / caching (bottleneck 3)
11. Row virtualization (bottleneck 7)
