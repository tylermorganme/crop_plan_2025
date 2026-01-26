# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **crop planning webapp** for a small organic farm (1.5 acres, 92 beds). Built with Next.js, it provides a visual timeline for planning and managing crop plantings.

Reference data was originally sourced from an Excel workbook (`Crop Plan 2025 V20.xlsm`) containing ~340 planting configurations.

## Production Status

This is production software. Data is sacred - don't lose it. Use migrations for schema changes.

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Run development server (localhost:5336)
npm run build        # Build for production
npm run lint         # Run ESLint
npm test             # Run tests in watch mode
npm run test:run     # Run tests once (CI mode)
npx tsc --noEmit     # Type check without emitting
```

## Architecture

### Data Flow

```
Planting[] (storage)
    ↓ getTimelineCropsFromPlan()
TimelineCrop[] (1:1 with Planting)
    ↓ CropTimeline.cropsByResource (render-time bed spanning)
Per-bed entries for display
```

**Planting** = one planting decision (stored), even if spanning multiple beds
**TimelineCrop** = 1:1 with Planting; bed spanning computed at render time in CropTimeline

### State Management

- **Zustand store** (`plan-store.ts`) - manages Plan state with immer for immutable updates
- **SQLite persistence** - one database per plan (`data/plans/*.db`)
- **Patch-based undo/redo** - lightweight immer patches instead of full plan snapshots

### Key Types

| Type | Purpose |
|------|---------|
| `Plan` | Root entity: plantings[], beds, cropCatalog, metadata |
| `Planting` | Storage format: configId, fieldStartDate, startBed, bedFeet |
| `TimelineCrop` | Display format: one per bed with computed dates |
| `CropConfig` | Static config from catalog (DTM, spacing, seasons) |

## Data Philosophy

**Data is sacred**: User plan data must never be lost. Schema changes use migrations. Stock templates are separate from live data.

**Import = shim + ingest**: Raw external data gets transformed into the expected format, then ingested through the same CRUD functions used for manual creation. Never bypass production code for import - this prevents "import-only" bugs.

**No parallel pipelines**: If there's a `createPlanting()` for manual use, import must use it too. Clone functions (`clonePlanting`, `cloneCropConfig`, etc.) compose on top of create functions.

**Stock vs Live**: Stock templates (`*-template.json`) seed new plans. Each plan gets an independent snapshot that evolves via migrations. Excel pipeline is for regenerating templates, not a continuous feed.

## Data Pipeline

### Stock Data vs Live Plan Data

**IMPORTANT**: There are TWO independent data systems:

1. **Stock data** (`src/data/crop-config-template.json`)
   - Template for new plans
   - Generated from Excel via build pipeline
   - Changes ONLY affect newly created plans

2. **Live plan data** (`data/plans/*.db` - SQLite databases)
   - Each plan has its own `cropCatalog` snapshot
   - Created by cloning stock data at plan creation time
   - Independent after creation - edits don't affect stock or other plans
   - Includes patch history for undo/redo recovery

```
src/data/crop-config-template.json (STOCK - template for new plans)
    │
    ▼ cloneCropCatalog() at plan creation
plan.cropCatalog (LIVE - per-plan snapshot, editable)
```

### Excel Import Pipeline

crop-config-template.json is generated from Excel via:
1. `extract-crops.py` → `crops_from_excel.json` (raw dump, NOT used by app)
2. `src/data/build-minimal-crops.js` → `crop-config-template.json` (normalized, used by app)

When adding new fields to CropConfig, update build-minimal-crops.js.

### Data Directory Map

```
src/data/
├── crop-config-template.json  # Stock crop catalog (339 configs)
├── bed-template.json          # Default bed layout (92 beds)
├── products-template.json     # Product catalog with pricing
├── varieties-template.json    # Variety catalog
├── seed-mixes-template.json   # Seed mix definitions
├── seed-orders.json           # Seed order data
├── column-analysis.json       # UI display metadata
└── build-*.js                 # Scripts to regenerate templates from Excel

data/plans/
├── *.db                 # SQLite databases (one per plan)
├── index.json           # Plan metadata index
└── archive/             # Migrated legacy .json.gz files

tmp/                     # Pipeline artifacts & working files (gitignored)
scripts/                 # Utility scripts
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/plan-store.ts` | Zustand store with all plan mutations |
| `src/lib/sqlite-storage.ts` | SQLite adapter (server-side) |
| `src/lib/sqlite-client.ts` | Storage client (browser-side, calls API) |
| `src/lib/timeline-data.ts` | `getTimelineCropsFromPlan()` - converts Planting[] → TimelineCrop[] (1:1) |
| `src/lib/planting-display-calc.ts` | `expandToTimelineCrops()` - timing calculations |
| `src/lib/entities/` | Entity types and CRUD functions |
| `src/components/CropTimeline.tsx` | Main timeline visualization |
| `src/data/crop-config-template.json` | Crop catalog (340 configurations) |

### Persistence Layer Architecture

```
Browser (client)              Server (API routes)           Disk
sqlite-client.ts  ───HTTP───→ /api/sqlite/[planId]  ───→  data/plans/{id}.db
```

- **Client**: `sqlite-client.ts` makes fetch calls to API routes
- **Server**: API routes in `src/app/api/sqlite/` use `sqlite-storage.ts`
- **Storage**: SQLite database per plan with `plan` and `patches` tables

**SQLite Schema (per plan database):**
```sql
CREATE TABLE plan (
  id TEXT PRIMARY KEY DEFAULT 'main',
  data JSON NOT NULL,
  schema_version INTEGER NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE patches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patches JSON NOT NULL,
  inverse_patches JSON NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Patch-Based Undo/Redo

- Every mutation produces immer patches (what changed) + inverse patches (how to undo)
- Patches stored in SQLite, survive page reload
- Plan hydrates from checkpoint + patches on load
- `undo()` applies inverse patch; `redo()` reapplies forward patch
- New mutation clears redo stack
- 50 patch history limit; periodic checkpoints for fast hydration

### Cross-Tab Sync

Multiple browser tabs viewing the same plan stay synchronized via BroadcastChannel:

```
Tab A mutates plan → appendPatch() → SQLite saved → broadcasts 'plan-updated'
                                                            ↓
Tab B receives message → loadPlanById(id, { force: true }) → reloads from SQLite
```

**Key files:**
- `sqlite-client.ts`: `withBroadcast()` wraps mutations, `onSyncMessage()` subscribes
- `plan-store.ts`: `initializePlanStore()` sets up cross-tab listener
- `ui-store.ts`: Separate BroadcastChannel for UI state (selection, search, toast)

**Important:** `loadPlanById` has an early return to avoid race conditions during same-tab navigation. For cross-tab sync, pass `{ force: true }` to bypass this check and reload from SQLite.

### Entity CRUD Pattern

All entity creation flows through functions in `src/lib/entities/`:

| Entity | Create | Clone |
|--------|--------|-------|
| Planting | `createPlanting()` | `clonePlanting()` |
| Bed | `createBed()` | `cloneBed()`, `cloneBeds()` |
| BedGroup | `createBedGroup()` | `cloneBedGroup()`, `cloneBedGroups()` |
| CropConfig | `createBlankConfig()` | `cloneCropConfig()`, `cloneCropCatalog()` |

**Flow**: Component → CRUD function → Store method → Persistence

Clone functions compose on create (e.g., `clonePlanting` calls `createPlanting` internally).

### Bulk Operations

For operations affecting multiple entities, **always use bulk methods** to ensure:
- Single undo step (one patch entry)
- Single API call (one save to SQLite)
- Atomic transaction (all succeed or none)
- Better performance (no N+1 problem)

**Available bulk operations:**

| Entity | Bulk Create | Bulk Update | Bulk Delete |
|--------|-------------|-------------|-------------|
| Planting | `bulkAddPlantings()` | `bulkUpdatePlantings()` | `bulkDeletePlantings()` |
| Bed | `upsertBeds()` | `upsertBeds()` | — |
| CropConfig | — | `bulkUpdateCropConfigs()` | `deleteCropConfigs()` |

**Anti-pattern - NEVER do this:**
```typescript
// BAD: N API calls, N undo steps
for (const id of selectedIds) {
  await deleteCrop(id);
}
```

**Correct pattern:**
```typescript
// GOOD: 1 API call, 1 undo step
const deletedCount = await bulkDeletePlantings(selectedIds);
```

**Import functions** (`importVarieties`, `importSeedMixes`, `importProducts`, `importSeedOrders`) also use this pattern internally.

### Drag Operations

Drag-and-drop in CropTimeline uses optimistic preview with commit-on-drop:

```
During drag:
  onBulkCropMove/onBulkCropDateChange → queue to pendingDragChanges (local state)
  previewCrops applies pending changes → CropTimeline renders preview

On drop:
  onDragEnd(true) → bulkUpdatePlantings() → single API call + patch

On cancel:
  onDragEnd(false) → clear pendingDragChanges (no API call)
```

**Key files:**
- `src/app/timeline/[planId]/page.tsx` - handles `pendingDragChanges` state and `previewCrops`
- `src/components/CropTimeline.tsx` - `cropsByResource` expands bed spanning at render time

## Key Concepts

- **Planting**: A single decision to grow a crop (one entry even if spanning multiple beds)
- **TimelineCrop**: Display format - 1:1 with Planting; bed spanning computed at render time
- **CropConfig**: Static configuration (DTM, spacing, seasons) from the crop catalog
- **Bed**: A 50-foot growing bed (92 total on the farm)
- **Crop Year**: Plans span crop years, not calendar years - overwintering crops carry forward

## UI Philosophy

**This is NOT greenfield UI.** Established patterns exist for pages, toolbars, forms, and lists. Before writing ANY new UI, search for existing examples. Use `/ui` to get guidance on where to find patterns.

**Data-driven**: UI always reflects the data. Change the data, UI updates. No UI-only state that diverges from stored state.

**Timeline view purpose**: Change `fieldStartDate` (horizontal) and `startBed` (vertical). Everything else (harvest dates, bed spanning, display) is derived.

**Shared UI state**: Use `ui-store.ts` for state that should sync across views/windows (selection, search, toast). Multiple browser tabs viewing the same plan should stay in sync.

**Reuse patterns**: No one-off components unless truly unique. Copy existing patterns exactly - same class names, same structure. UI is built from simple primitives and simple rules that combine to represent complexity.

## Data Evolution Strategy

### Migrations (Schema Changes)

For structural changes to the Plan schema, use the migration system in `src/lib/migrations/index.ts`:

- **Automatic**: Migrations run on plan load (from SQLite)
- **Append-only**: Never modify existing migrations
- **Versioned**: `schemaVersion` tracks which migrations have run
- **Pure functions**: Each migration is `(plan: unknown) => unknown`

**When you need a migration:**
- Renaming a field (e.g., `foo` → `bar`)
- Changing field type (e.g., `string` → `number`)
- Restructuring data (e.g., flat → nested)
- Removing a required field

**When you DON'T need a migration:**
- Adding a new optional field (code handles `undefined`)
- Adding a new entity type with empty default

**To add a migration:**
1. Create function in `migrations/index.ts`
2. Append to `migrations` array
3. `CURRENT_SCHEMA_VERSION` auto-increments
4. For simple renames/transforms, also add declarative operations to `dsl.ts`

**Declarative DSL** (`migrations/dsl.ts`): For field renames, deletions, or value transforms, add operations to `declarativeMigrations`. This enables automatic patch migration - stored patches get their paths/values transformed to match the new schema, preserving undo history across schema changes. Complex migrations (like v2→v3 bed UUID migration) remain imperative-only.

**Recursion hazard:** Migrations run inside `hydratePlan()`. Never call functions that trigger `hydratePlan()` from migration code (e.g., `createCheckpointWithMetadata()`). Use `savePlan()` directly if needed.

**Testing:** After any schema change, verify old plans still load by opening the app with existing data.

### Data Enrichment (Import/Export)

For enriching existing data with new values (e.g., pulling data from Excel):

- **Export**: Plan JSON files include full `cropCatalog`
- **Enrich externally**: Edit JSON, run scripts, or use Excel
- **Import**: Merge enriched configs back into plan via import feature

This keeps the app simple - no special "shim" code paths. Enrichment happens outside the app using whatever tools make sense.

**Import modes:**
- **Merge**: Update existing configs, add new ones, preserve user edits to unlisted fields
- **Replace**: Wholesale replacement of catalog (use with caution)

### Template vs Plan Data

Remember the two-tier system:
1. **Template** (`*-template.json`) - edit directly, affects only NEW plans
2. **Live plan data** - stored in SQLite (`data/plans/*.db`)

**Accessing plan data:**
- SQLite databases are server-side files, accessible via API or directly
- Use `sqlite3 data/plans/{id}.db` for direct inspection
- Use the app's UI for normal edits
- Write a migration for schema changes
