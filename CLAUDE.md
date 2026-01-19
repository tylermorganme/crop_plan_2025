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
npm run dev          # Run development server (localhost:3000)
npm run build        # Build for production
npm run lint         # Run ESLint
npx tsc --noEmit     # Type check without emitting
```

## Architecture

### Data Flow

```
Planting[] (storage)
    ↓ expandPlantingsToTimelineCrops()
TimelineCrop[] (display)
    ↓
CropTimeline Component
```

**Planting** = one planting decision (stored), even if spanning multiple beds
**TimelineCrop** = one entry per bed (computed at render time for display)

### State Management

- **Zustand store** (`plan-store.ts`) - manages Plan state with immer for immutable updates
- **localStorage persistence** via `storage-adapter.ts`
- Undo/redo via full Plan snapshots

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

2. **Live plan data** (`data/plans/*.json` + IndexedDB)
   - Each plan has its own `cropCatalog` snapshot
   - Created by cloning stock data at plan creation time
   - Independent after creation - edits don't affect stock or other plans

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

data/plans/              # Saved plan files (backup of IndexedDB)
tmp/                     # Pipeline artifacts & working files (gitignored)
scripts/                 # Utility scripts
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/plan-store.ts` | Zustand store with all plan mutations |
| `src/lib/timeline-data.ts` | `getTimelineCropsFromPlan()` - expands Planting[] → TimelineCrop[] |
| `src/lib/slim-planting.ts` | `computeTimelineCrop()` - timing calculations |
| `src/lib/entities/` | Entity types and CRUD functions |
| `src/components/CropTimeline.tsx` | Main timeline visualization |
| `src/data/crop-config-template.json` | Crop catalog (340 configurations) |

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

## Key Concepts

- **Planting**: A single decision to grow a crop (one entry even if spanning multiple beds)
- **TimelineCrop**: Display format - one entry per bed for timeline rendering
- **CropConfig**: Static configuration (DTM, spacing, seasons) from the crop catalog
- **Bed**: A 50-foot growing bed (92 total on the farm)
- **Crop Year**: Plans span crop years, not calendar years - overwintering crops carry forward

## Data Evolution Strategy

### Migrations (Schema Changes)

For structural changes to the Plan schema, use the migration system in `src/lib/migrations/index.ts`:

- **Automatic**: Migrations run on plan load (IndexedDB and disk files)
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
2. **Live plan data** - stored in IndexedDB (browser), backed up to `data/plans/`

**IMPORTANT:** Claude cannot directly access IndexedDB - it's browser-only storage. The `data/plans/*.json` files are backups/exports. To modify live plan data:
- Use the app's UI
- Export → edit JSON → import
- Write a migration (for schema changes)
