# State Migration Plan

Track state structure changes for self-contained plan architecture.

---

## Progress

### Step 1: Create `lib/entities/` ✅ COMPLETE
- [x] `bed.ts` - Bed type + `createBedsFromTemplate()`
- [x] `planting.ts` - Planting type (one per planting)
- [x] `crop-config.ts` - CropConfig + calculations
- [x] `plan.ts` - Plan type + `validatePlan()`

### Step 2: Update plan-store ✅ COMPLETE
- [x] `beds` required (built from template on create)
- [x] `cropCatalog` required (copied from stock on create)
- [x] Undo/redo stores `Plan[]` snapshots
- [x] `validatePlan()` called on load

### Step 3: Store Planting[] ✅ COMPLETE
- [x] `collapseToPlantings()` in slim-planting.ts
- [x] `getTimelineCropsFromPlan()` in timeline-data.ts
- [x] moveCrop/updateCropDates/deleteCrop work with plantings[]
- [x] addPlanting/duplicatePlanting
- [x] createNewPlan() stores plantings
- [x] CropExplorer creates Planting objects
- [x] updateCropConfig works with plantings (display recomputes on-demand)
- [x] Removed legacy helpers (getPlanCrops, getPlanResources, getPlanGroups)
- [x] Removed unused imports and usePlanCrops hook
- [x] loadPlanById migrates old crops[] to plantings[] on load
- [x] lookupConfigFromCatalog trims whitespace on both search term and catalog entries
- [x] expandPlantingsToTimelineCrops falls back to default catalog

### Step 4: Delete dead code ✅ COMPLETE
- [x] Delete `lib/types/entities.ts` (also dtm-conversion.ts, normalize.ts)
- [x] Remove duplicate getBedCapacity → centralized `getBedLengthFromId`
- [x] Clean up re-exports
- [ ] Remove `crops` field from Plan type (deferred - still used for migration)

---

## Design Principles

1. **Plans are self-contained** - All data needed lives in the plan
2. **Stock data is read-only** - `crops.json`, `bed-plan.json` are templates
3. **Validation throws** - Invalid state = throw error
4. **No sacred data** - Test data is disposable
5. **LLM-friendly** - Grepable, explicit, colocated

---

## Architecture

### Storage: One Planting Per Decision

```typescript
interface Planting {
  id: string;
  configId: string;        // References CropConfig.id
  fieldStartDate: string;
  startBed: string | null;
  bedFeet: number;
  overrides?: { ... };
  actuals?: { ... };
  lastModified: number;
}
```

### Display: Computed at Render

```
Planting[] (storage)
    ↓ expandPlantingsToTimelineCrops()
TimelineCrop[] (display)
    ↓
CropTimeline Component
```

### Plan: Self-Contained

```typescript
interface Plan {
  id: string;
  schemaVersion: number;
  metadata: PlanMetadata;
  cropCatalog: Record<string, CropConfig>;  // Required
  beds: Record<string, Bed>;                 // Required
  plantings: Planting[];                     // One per planting
  changeLog: PlanChange[];
}
```

---

## Bed Lengths

```typescript
const ROW_LENGTHS: Record<string, number> = {
  A: 50, B: 50, C: 50, D: 50, E: 50,  // Standard
  F: 20,                               // Short
  G: 50, H: 50, I: 50,
  J: 20,                               // Short
  U: 50,                               // Single bed
  X: 80,                               // Greenhouse
};
```

---

## Validation

```typescript
function validatePlan(plan: Plan): void {
  for (const p of plan.plantings) {
    if (!plan.cropCatalog[p.configId])
      throw new Error(`Missing config ${p.configId}`);
    if (p.startBed && !plan.beds[p.startBed])
      throw new Error(`Missing bed ${p.startBed}`);
    if (p.followsPlantingId && !plan.plantings.some(x => x.id === p.followsPlantingId))
      throw new Error(`Missing followed planting ${p.followsPlantingId}`);
  }
}
```

---

## Key Files

| File | Purpose |
|------|---------|
| `entities/bed.ts` | Bed type + createBedsFromTemplate() |
| `entities/planting.ts` | Planting type + factory |
| `entities/crop-config.ts` | CropConfig + calculations |
| `entities/plan.ts` | Plan type + validatePlan() |
| `slim-planting.ts` | computeTimelineCrop(), collapseToPlantings() |
| `timeline-data.ts` | getTimelineCropsFromPlan(), expandPlantingsToTimelineCrops() |
| `plan-store.ts` | Zustand store, mutations |
