# State Migration Plan

This document tracks all state structure changes needed for the self-contained plan architecture.

---

## Progress Checklist

### Step 1: Create `lib/entities/` with new types ✅ COMPLETE
- [x] `bed.ts` - Bed type + `createBedsFromTemplate()`
- [x] `planting.ts` - Planting type (one per planting)
- [x] `crop-config.ts` - Move CropConfig + calculations here
- [x] `plan.ts` - Plan type + `validatePlan()`
- [x] `index.ts` - Re-exports
- [x] `test-entities.ts` - 14 validation tests (all pass)

### Step 2: Update plan-store to use new types
- [ ] Make `beds` required (build from template on create)
- [ ] Make `cropCatalog` required (copy from stock on create)
- [ ] Store `Planting[]` instead of `TimelineCrop[]`
- [ ] Add `validatePlan()` call on load/save

### Step 3: Update timeline computation
- [ ] Create `computeTimelineEntries(plan)` - derives display data
- [ ] Delete duplicate `TimelineCrop` from `CropTimeline.tsx`
- [ ] Consolidate `calculateBedSpan()` to use `plan.beds`

### Step 4: Delete dead code
- [ ] Delete `crop-api/src/lib/types/entities.ts`
- [ ] Remove `STANDARD_BED_FT`, `SHORT_BED_FT`, `SHORT_ROWS` constants
- [ ] Remove duplicate `getBedCapacity` functions
- [ ] Clean up re-exports

---

## Design Principles

1. **Plans are self-contained** - All data needed to render/calculate lives in the plan
2. **Stock data is read-only** - `crops.json`, `bed-plan.json` are templates only
3. **Validation throws** - Invalid state = throw error, never warn silently
4. **No sacred data** - Test data is disposable, can nuke and reimport
5. **LLM-friendly** - Grepable, explicit, colocated

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Old plan data | Nuke it | Test data only, reimport from templates |
| Validation | Throw errors | Loud failures catch bugs early |
| `entities.ts` | Delete it | Unused future design, replaced by `lib/entities/` |
| `TimelineCrop` | Replace with `Planting` | Store one per planting, compute display at render |
| Migration code | Minimal | No backward compat needed for test data |

---

## Architecture Problems Identified

### Problem 1: Parallel Type Systems

There are **THREE** different ways crop data is represented:

| File | Types | Status |
|------|-------|--------|
| `entities.ts` | CropEntity, ProductEntity, ProductSequence, PlantingConfigEntity | DELETE - unused future design |
| `crop-calculations.ts` | CropConfig, TrayStage, PlantingMethod | Active - what's stored |
| `plan-types.ts` | TimelineCrop | Active - display representation |

**Impact**: Grep for "crop" returns 3+ interfaces with overlapping fields. Unclear which to use.

### Problem 2: Same Concept, Multiple Names

| Concept | Names Used |
|---------|------------|
| Crop identifier | `id`, `identifier`, `cropConfigId`, `cropId`, `crop` |
| Bed size | `bedsCount`, `feetNeeded`, `bedFeet`, `lengthFt` |
| Planting | `SlimPlanting`, `TimelineCrop`, `BedAssignment`, `assignment` |
| Start date | `startDate`, `fixedFieldStartDate`, `tpOrDsDate`, `plannedTpOrDsDate` |

**Impact**: LLM greps for "identifier" misses code using "cropConfigId".

### Problem 3: Calculation Logic Scattered

| Calculation | Files |
|-------------|-------|
| Days in cells | `crop-calculations.ts`, `slim-planting.ts`, `timeline-data.ts` |
| Bed capacity | `timeline-data.ts`, `CropTimeline.tsx`, `scripts/test-spans.js` |
| Harvest window | `crop-calculations.ts`, `crop-timing-calculator.ts` |
| Display name | `slim-planting.ts`, `timeline-data.ts`, `CropTimeline.tsx` |

**Impact**: Update one, forget another = bugs. LLM doesn't know which is canonical.

### Problem 4: Mixed Concerns in TimelineCrop

`TimelineCrop` conflates three different things:

1. **Planting identity** (what we store): `id`, `groupId`, `plantingId`, `cropConfigId`
2. **Bed assignment** (calculated per-bed): `resource`, `bedIndex`, `totalBeds`, `feetUsed`
3. **Display data** (derived for UI): `name`, `category`, `bgColor`, `plantingMethod`

**Impact**: A 3-bed planting creates 3 nearly-identical TimelineCrop objects.

### Problem 5: Unclear Data Ownership

| Data | Lives In | Problem |
|------|----------|---------|
| Crop configs | `crops.json` (stock) | Edits should modify plan, not stock |
| Crop configs | `plan.cropCatalog` (plan) | Optional, may be missing |
| Bed layout | `bed-plan.json.bedGroups` | Hardcoded, not per-plan |
| Bed sizes | Constants in 3 files | Hardcoded, not per-plan |

### Problem 6: Implicit Relationships

```typescript
cropConfigId: string;  // References... crops.json identifier? plan.cropCatalog?
followsCrop?: string;  // References... SlimPlanting.id? TimelineCrop.groupId?
```

---

## Proposed Architecture

### Core Principle: One Entity = One File = One Type

```
crop-api/src/lib/entities/
├── crop-config.ts      # CropConfig type + all its calculations
├── planting.ts         # Planting type + all its calculations
├── bed.ts              # Bed type + factory
├── plan.ts             # Plan type + validation + computed views
└── index.ts            # Re-exports all
```

**Note**: Delete `crop-api/src/lib/types/entities.ts` (unused).

### Entity: Planting (replaces TimelineCrop for storage)

```typescript
interface Planting {
  id: string;
  configId: string;        // References CropConfig.id in plan's catalog

  // Scheduling
  fieldStartDate: string;
  followsPlantingId?: string;
  followOffset?: number;

  // Bed Assignment
  startBed: string | null;
  bedFeet: number;

  // Overrides
  overrides?: { ... };

  // Actuals
  actuals?: { ... };

  lastModified: number;
}
```

### Entity: Plan (self-contained)

```typescript
interface Plan {
  id: string;
  schemaVersion: number;
  metadata: { ... };

  // Owned Data
  cropCatalog: Record<string, CropConfig>;  // Required, not optional
  beds: Record<string, Bed>;                 // With individual lengths
  plantings: Planting[];                     // One per planting, not per bed

  changeLog: PlanChange[];
}
```

### Computed Views (not stored)

```typescript
// Computed at render time from Plan
interface TimelineEntry {
  plantingId: string;
  configId: string;
  displayName: string;
  startDate: string;
  endDate: string;
  beds: Array<{ bedId: string; feetUsed: number; }>;
}

function computeTimelineEntries(plan: Plan): TimelineEntry[] { ... }
```

---

## Current State Audit

### Storage Architecture (storage-adapter.ts)

| Key Pattern | Content | Limit |
|-------------|---------|-------|
| `crop-plan-lib-{id}` | Full PlanData (plan + undo/redo) | One per plan |
| `crop-plan-registry` | Array of PlanSummary | All plans |
| `crop-plan-snapshots` | Auto-save snapshots | 32 entries |
| `crop-plan-stash` | Safety saves before destructive ops | 10 entries |
| `crop-plan-checkpoints-{planId}` | User-created named saves | 20 per plan |

### Plan Interface (plan-types.ts)

```typescript
interface Plan {
  id: string;
  metadata: PlanMetadata;
  crops: TimelineCrop[];
  resources: string[];           // Just bed names: ["A1", "A2", ...]
  groups: ResourceGroup[];       // Grouping: { name: "Row A", beds: ["A1"...] }
  changeLog: PlanChange[];
  cropCatalog?: Record<string, CropConfig>;  // Added recently, optional
}
```

### TimelineCrop (What's Stored Per Planting)

```typescript
interface TimelineCrop {
  id: string;                    // Deterministic: {plantingId}_bed{index}
  name: string;
  startDate: string;             // ISO date
  endDate: string;
  resource: string;              // Bed assignment (empty = unassigned)
  cropConfigId: string;          // Reference to catalog identifier
  groupId: string;               // For multi-bed grouping
  plantingId?: string;           // Short ID like "ARU001"
  totalBeds: number;
  bedIndex: number;              // 1-indexed
  feetNeeded?: number;
  feetUsed?: number;
  bedCapacityFt?: number;
  harvestStartDate?: string;
  plantingMethod?: 'DS' | 'TP' | 'PE';
  category?: string;
  structure?: string;
  bgColor?: string;
  textColor?: string;
  lastModified?: number;
}
```

### What's Missing for Self-Contained Plans

| Field | Current | Needed | Notes |
|-------|---------|--------|-------|
| `beds` | N/A | `Record<string, Bed>` | Bed definitions with lengths |
| `cropCatalog` | Optional | Required | Already implemented, needs migration |
| `resources` | `string[]` | Derive from beds | Can compute from beds map |
| `groups` | `ResourceGroup[]` | Keep or derive | Grouping logic for UI |
| `schemaVersion` | N/A | `number` | Track which migrations applied |

---

## Migration 1: Beds with Individual Lengths

### New Type

```typescript
interface Bed {
  id: string;        // "A1", "F3", etc.
  lengthFt: number;  // Individual length (50, 20, or custom)
  group?: string;    // Row/section for grouping ("A", "F", "X")
}
```

### Current Bed Length Logic (duplicated in 3 places, INCOMPLETE)

```typescript
// timeline-data.ts, CropTimeline.tsx, scripts/test-spans.js
const SHORT_ROWS = ['F', 'J'];
const STANDARD_BED_FT = 50;
const SHORT_BED_FT = 20;

function getBedCapacity(bed: string): number {
  const row = bed.charAt(0);
  return SHORT_ROWS.includes(row) ? SHORT_BED_FT : STANDARD_BED_FT;
}
// BUG: X beds are 80ft but this returns 50ft!
```

### Migration Strategy

1. Add `beds: Record<string, Bed>` to Plan interface
2. On plan creation: build beds map from bedGroups + length rules
3. On plan load: if `beds` missing, backfill from legacy logic
4. Update all `getBedCapacity()` calls to use `plan.beds[bedId].lengthFt`
5. Remove `STANDARD_BED_FT`, `SHORT_BED_FT`, `SHORT_ROWS` constants

### Canonical Bed Lengths

```typescript
// Bed lengths by row (this is the source of truth)
const ROW_LENGTHS: Record<string, number> = {
  A: 50, B: 50, C: 50, D: 50, E: 50,  // Standard field rows
  F: 20,                               // Short row
  G: 50, H: 50, I: 50,                // Standard field rows
  J: 20,                               // Short row
  U: 50,                               // Single bed
  X: 80,                               // Long greenhouse beds
};
```

### Stock Beds Template

From `bed-plan.json.bedGroups`:
- Rows A-E, G-I: 8 beds each × 50ft = 400ft/row
- Row F: 9 beds (F0-F8) × 20ft = 180ft
- Row J: 8 beds × 20ft = 160ft
- Row U: 1 bed × 50ft
- Row X: 4 beds × 80ft = 320ft

**Total**: ~92 beds, ~4,460 bed-feet

### Deriving Resources and Groups from Beds

```typescript
function deriveResources(beds: Record<string, Bed>): string[] {
  return Object.keys(beds).sort((a, b) => {
    const rowA = a.replace(/\d+/g, '');
    const rowB = b.replace(/\d+/g, '');
    if (rowA !== rowB) return rowA.localeCompare(rowB);
    const numA = parseInt(a.replace(/\D/g, '')) || 0;
    const numB = parseInt(b.replace(/\D/g, '')) || 0;
    return numA - numB;
  });
}

function deriveGroups(beds: Record<string, Bed>): ResourceGroup[] {
  const groupMap = new Map<string, string[]>();
  for (const bed of Object.values(beds)) {
    const group = bed.group ?? bed.id.replace(/\d+/g, '');
    if (!groupMap.has(group)) groupMap.set(group, []);
    groupMap.get(group)!.push(bed.id);
  }
  return Array.from(groupMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, bedIds]) => ({ name: `Row ${name}`, beds: bedIds.sort() }));
}
```

---

## Migration 2: Required cropCatalog

### Current State

- `cropCatalog?: Record<string, CropConfig>` - optional
- New plans get catalog on creation
- Old plans may not have it

### Migration Strategy

1. Make `cropCatalog` required in type
2. On plan load: if missing, copy from stock `getAllCrops()`
3. Increment `CURRENT_SCHEMA_VERSION` to 2

---

## Migration 3: bedFeet vs bedsCount

### Current Planting Data

```typescript
// In bed-plan.json assignments
{
  bedsCount: 0.5,  // Half a bed = 25ft (assumes 50ft beds)
  bed: "A5",       // Starting bed
  ...
}
```

### New Model

```typescript
// User specifies total feet needed
{
  bedFeet: 125,    // Explicit feet needed
  beds: ["A5", "A6", "A7"],  // Assigned beds (calculated from bedFeet + bed lengths)
  ...
}
```

### Migration Strategy

1. Add `bedFeet` field to SlimPlanting
2. Compute: `bedFeet = bedsCount × 50` (legacy assumption)
3. Keep `bedsCount` for backward compat during transition
4. Update span calculation to use actual bed lengths

---

## Files to Update

### Core Types
- [ ] `plan-types.ts` - Add Bed interface, update Plan
- [ ] `crop-calculations.ts` - May need bed-aware calculations
- [ ] `slim-planting.ts` - bedFeet field

### Bed Capacity Logic (consolidate to one place)
- [ ] `timeline-data.ts:69-101` - getBedCapacity, SHORT_ROWS
- [ ] `CropTimeline.tsx:183-201` - duplicate getBedCapacity
- [ ] `scripts/test-spans.js:4-27` - duplicate for testing

### Plan Creation/Loading
- [ ] `plan-store.ts:createNewPlan` - build beds map
- [ ] `plan-store.ts:loadPlanById` - migration on load

### UI Components
- [ ] `CropTimeline.tsx` - use plan.beds for capacity
- [ ] `CropExplorer.tsx` - show plan's catalog, not stock

---

## Schema Versioning

| Version | Changes |
|---------|---------|
| 1 | Initial schema |
| 2 | Required cropCatalog, beds map with lengths |

### Migration Function

```typescript
function migratePlan(plan: Plan, fromVersion: number): Plan {
  let migrated = { ...plan };

  if (fromVersion < 2) {
    // Add beds if missing
    if (!migrated.beds) {
      migrated.beds = buildBedsFromLegacy(migrated.resources);
    }
    // Add cropCatalog if missing
    if (!migrated.cropCatalog) {
      migrated.cropCatalog = buildCatalogFromStock();
    }
  }

  return migrated;
}
```

---

## Existing User Operations (Must Preserve)

### Plan Lifecycle
| Operation | Store Action | Notes |
|-----------|--------------|-------|
| Create plan | `createNewPlan(name, crops, resources, groups)` | Copies stock catalog |
| Load plan | `loadPlanById(planId)` | From localStorage |
| Rename plan | `renamePlan(newName)` | Updates metadata |
| Copy plan | `copyPlan(options)` | Date shift, unassign options |
| Delete plan | `deletePlanFromLibrary(planId)` | Removes from registry |
| Export plan | `exportPlanToFile()` | Gzipped JSON |
| Import plan | `importPlanFromFile(file)` | Stashes current first |

### Crop Operations
| Operation | Store Action | Notes |
|-----------|--------------|-------|
| Move crop | `moveCrop(groupId, newResource, bedSpanInfo?)` | Expands/collapses multi-bed |
| Change dates | `updateCropDates(groupId, startDate, endDate)` | Affects all beds in group |
| Delete crop | `deleteCrop(groupId)` | Removes all beds |
| Duplicate crop | `duplicateCrop(groupId)` | New planting ID |
| Add crop | `addCrop(crop)` | From catalog |
| Edit config | `updateCropConfig(config)` | Recalculates affected |

### History Operations
| Operation | Store Action | Notes |
|-----------|--------------|-------|
| Undo/Redo | `undo()` / `redo()` | Max 50 entries |
| Create checkpoint | `createCheckpoint(name)` | Named save |
| Restore history | `restoreFromHistory(entry)` | Stashes current |
| Auto-save | Timer-based | 15-minute interval |

---

## Code Duplication to Consolidate

### Bed Capacity Logic (3 copies)

```typescript
// timeline-data.ts:69-101
// CropTimeline.tsx:183-201
// scripts/test-spans.js:4-27

const SHORT_ROWS = ['F', 'J'];
const STANDARD_BED_FT = 50;
const SHORT_BED_FT = 20;

function getBedCapacity(bed: string): number {
  const row = bed.charAt(0);
  return SHORT_ROWS.includes(row) ? SHORT_BED_FT : STANDARD_BED_FT;
}
```

**After migration**: All lookups use `plan.beds[bedId].lengthFt`

### API vs Plan Catalog

Currently:
- `/api/crops` - CRUD for global crops.json (file write)
- `plan.cropCatalog` - Plan-local copy

**Decision**: API routes modify stock templates. Plan edits modify plan catalog only. CropExplorer shows plan catalog when viewing a plan.

---

## Resolved Questions

1. **U bed length**: 50ft (confirmed)
2. **X bed length**: 80ft (confirmed)
3. **Old plan data**: Nuke it, reimport fresh (no migration needed)
4. **entities.ts**: Delete it (unused future design)
5. **Validation**: Throw on invalid state, never warn

---

## Implementation Order

### Step 1: Create `lib/entities/` with new types ✅ COMPLETE
- [x] `bed.ts` - `Bed` type + `createBedsFromTemplate(bedGroups)`
- [x] `planting.ts` - `Planting` type (one per planting, not per bed)
- [x] `crop-config.ts` - Move `CropConfig` here with its calculations
- [x] `plan.ts` - `Plan` with required `beds`, `cropCatalog`, `plantings` + `validatePlan()`
- [x] `index.ts` - Re-exports

### Step 2: Update plan-store to use new types
- [ ] Make `beds` required (build from template on create)
- [ ] Make `cropCatalog` required (copy from stock on create)
- [ ] Store `Planting[]` instead of `TimelineCrop[]`
- [ ] Add `validatePlan()` call - throws on invalid state

### Step 3: Update timeline computation
- [ ] Create `computeTimelineEntries(plan)` - derives display data
- [ ] Delete duplicate `TimelineCrop` from `CropTimeline.tsx`
- [ ] One `calculateBedSpan()` function using `plan.beds`

### Step 4: Delete dead code
- [ ] Delete `crop-api/src/lib/types/entities.ts` (unused)
- [ ] Remove `STANDARD_BED_FT`, `SHORT_BED_FT`, `SHORT_ROWS` constants
- [ ] Remove duplicate `getBedCapacity` functions
- [ ] Clean up re-exports

---

## Naming Conventions (LLM-Friendly)

### IDs and References

```typescript
// Entity's own ID
id: string;

// Reference to another entity (explicit suffix)
configId: string;              // References CropConfig.id
followsPlantingId: string;     // References Planting.id
```

### Dates (all ISO strings)

```typescript
fieldStartDate: string;     // When crop enters field
harvestStartDate: string;   // When harvest begins
harvestEndDate: string;     // When harvest ends
```

### Calculated vs Stored

```typescript
// Stored fields: simple names
bedFeet: number;

// Calculated: either function or separate interface
calculateHarvestWindow(config: CropConfig): number;
// OR
interface PlantingCalculated {
  harvestWindow: number;
  sth: number;
}
```

---

## LLM-Friendly Patterns

### Pattern 1: Colocated Operations

```typescript
// GOOD: Type and operations together
// crop-config.ts
export interface CropConfig { ... }
export function calculateSTH(config: CropConfig): number { ... }
export function calculateHarvestWindow(config: CropConfig): number { ... }
```

### Pattern 2: No Magic Defaults

```typescript
// BAD: Default hidden in constant
const days = crop.assumedTransplantDays ?? DEFAULT_ASSUMED_TRANSPLANT_DAYS;

// GOOD: Default documented in type, explicit in code
interface CropConfig {
  /** Default: 30 days */
  assumedTransplantDays: number;  // Required, not optional
}
```

### Pattern 3: Explicit Imports

```typescript
// BAD: Re-exports hide source
export type { TimelineCrop } from './plan-types';

// GOOD: Import from source
import { type Planting } from '@/lib/entities/planting';
```

### Pattern 4: Searchable Names

```typescript
// BAD: Generic
function compute() { ... }
interface Data { ... }

// GOOD: Specific, grepable
function computePlantingTimeline() { ... }
interface PlantingTimelineEntry { ... }
```

---

## Testing Checklist

- [ ] New plan creation includes beds and cropCatalog
- [ ] Bed capacity lookups use plan.beds
- [ ] Span calculations work with mixed bed lengths (F=20, X=80)
- [ ] X beds use 80ft (not 50ft - the bug we're fixing)
- [ ] CropExplorer shows plan catalog when viewing plan
- [ ] Export/import preserves all data
- [ ] Undo/redo works with new structure
- [ ] Checkpoints include beds and catalog
- [ ] `validatePlan()` throws on missing config reference
- [ ] `validatePlan()` throws on missing bed reference
- [ ] Invalid plan data causes visible error (not silent failure)

---

## Recalculation Triggers

| Event | Action |
|-------|--------|
| Edit crop config | Recalculate plantings using that config |
| Edit bed length | Recalculate plantings starting on that bed |
| Delete bed with plantings | Throw error (user must reassign first) |
| Delete config with plantings | Throw error (user must reassign first) |

## Validation Function

```typescript
function validatePlan(plan: Plan): void {
  // Every planting references a valid config
  for (const p of plan.plantings) {
    if (!plan.cropCatalog[p.configId]) {
      throw new Error(`Planting ${p.id} references missing config ${p.configId}`);
    }
    if (p.startBed && !plan.beds[p.startBed]) {
      throw new Error(`Planting ${p.id} references missing bed ${p.startBed}`);
    }
    if (p.followsPlantingId) {
      const exists = plan.plantings.some(other => other.id === p.followsPlantingId);
      if (!exists) {
        throw new Error(`Planting ${p.id} follows missing planting ${p.followsPlantingId}`);
      }
    }
  }
  // If we get here, plan is valid
}
```

Call this on load and before save. If it throws, we have a bug to fix.
