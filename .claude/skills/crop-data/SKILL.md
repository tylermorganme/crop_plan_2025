---
name: crop-data
description: Crop planning data model and architecture. Use when working with crops.json, bed-plan.json, TimelineCrop, or plan data structures for: (1) Understanding entity relationships (Crop → PlantingConfig → Planting → Product), (2) Determining which fields are static inputs vs calculated, (3) Identifying which entity a field belongs to (crop, product, planting, or config-level), (4) Planning data migrations or implementing the slim data architecture, (5) Modifying timeline or explorer components that consume crop data. (project)
---

# Crop Data Context

This skill provides essential context for working with the crop planning data model.

## CRITICAL: Stock Data vs Live Plan Data

**There are TWO independent data systems:**

1. **Stock data** (`src/data/crops.json`)
   - Template for new plans (~339 crop configs)
   - Generated from Excel via build pipeline
   - Changes ONLY affect newly created plans

2. **Live plan data** (`data/plans/*.json` + IndexedDB)
   - Each plan has its own `cropCatalog` snapshot
   - Created by cloning stock data at plan creation time
   - Independent after creation - edits don't affect stock or other plans

```
src/data/crops.json (STOCK - template for new plans)
    │
    ▼ cloneCropCatalog() at plan creation
plan.cropCatalog (LIVE - per-plan snapshot, editable)
```

**When to update what:**
- Adding new field to stock data → update `build-minimal-crops.js`
- Editing existing plan → use the UI or store methods
- Fixing crop config data → decide if it's stock fix or needs plan migration

## Entity Model

```
GLOBAL CONSTANTS (farm settings: LastFrostDate, BedLength)
       │
       ▼
CROP (~100 unique) ─────────────────────────────────────────────────┐
│ name, category, deprecated                                        │
│ Same for all configurations of a crop                             │
       │                                                            │
       │ one crop → many configurations                             │
       ▼                                                            │
CROP CONFIG (339 total in stock)                                    │
│ structure (field/greenhouse/high-tunnel)                          │
│ normalMethod (from-seeding/from-transplant/total-time)           │
│ product type, DTM, spacing, rows                                  │
│ Identifier: "Arugula - Baby Leaf 1X | Field DS Sp"               │
       │                                    │                       │
       │ one config → many plantings        │ references            │
       ▼                                    ▼                       │
PLANTING (per-plan instance)          PRODUCT (processing info) ◄──┘
│ bed, bedFeet, fieldStartDate        │ Unit, Price, Yield
│ per-planting overrides              │ labor times
│ references configId                 │
```

## Key Types and Fields

### CropConfig (stored inputs)

| Field | Type | Description |
|-------|------|-------------|
| `identifier` | string | Unique key: "Crop - Product XH \| Structure Method Season" |
| `crop` | string | Crop name (e.g., "Tomato") |
| `variant` | string | Variety (e.g., "Cherry") |
| `product` | string | Product type (e.g., "Slicing") |
| `normalMethod` | enum | How DTM is measured: `from-seeding`, `from-transplant`, `total-time` |
| `growingStructure` | enum | Where grown: `field`, `greenhouse`, `high-tunnel` |
| `dtm` | number | Days to maturity (interpretation depends on normalMethod) |
| `daysToGermination` | number | Days from seeding to emergence |
| `trayStages` | array | Greenhouse stages: `[{days, cellsPerTray}]` |
| `rows` | number | Rows per bed |
| `spacing` | number | In-row spacing (inches) |
| `numberOfHarvests` | number | Total harvests |
| `daysBetweenHarvest` | number | Days between harvests |
| `harvestBufferDays` | number | Buffer after last harvest (default 7) |
| `seedsPerBed` | number | Seeds needed per bed |
| `seedsPerPlanting` | number | Seeds per cell/hole |
| `safetyFactor` | number | Extra cells started (1.1 = 10% extra) |
| `seedingFactor` | number | Multi-seeding per cell (usually 1, sometimes 2) |
| `yieldFormula` | string | e.g., `plantingsPerBed * 0.5 * harvests` |
| `yieldPerHarvest` | number | **LEGACY** - use yieldFormula instead |

### Calculated Fields (derived at runtime)

| Field | Calculation |
|-------|-------------|
| `daysInCells` | Sum of tray stage days |
| `plantingMethod` | `perennial` if flag set, else `transplant` if daysInCells > 0, else `direct-seed` |
| `seedToHarvest` | Total days from seeding to first harvest (accounts for normalMethod) |
| `harvestWindow` | Duration of harvest period |
| `plantingsPerBed` | `(12 / spacing) * rows * bedFeet` |

### seedToHarvest Calculation (by normalMethod)

```typescript
switch (normalMethod) {
  case 'from-seeding':
    // DTM measured from emergence
    return daysToGermination + dtm + (isTransplant ? 15 : 0);

  case 'from-transplant':
    // DTM measured from transplant date
    return isTransplant ? daysInCells + dtm : 20 + dtm - 15;

  case 'total-time':
    // DTM is total time (use as-is for transplants)
    return isTransplant ? dtm : dtm - 15;
}
```

## Data Source Files

| File | Purpose | Used by App? |
|------|---------|--------------|
| `src/data/crop-config-template.json` | Stock crop catalog (339 configs) | YES |
| `src/data/bed-template.json` | Default bed layout | YES |
| `src/data/products-template.json` | Product catalog with pricing | YES |
| `src/data/varieties-template.json` | Variety catalog | YES |
| `src/data/seed-mixes-template.json` | Seed mix definitions | YES |
| `src/data/column-analysis.json` | Display column metadata | YES |
| `src/data/crops_from_excel.json` | Raw Excel dump | NO (pipeline artifact) |
| `src/data/crops.json.old` | Backup | NO (pipeline artifact) |
| `data/plans/*.json` | Saved plans (file backup) | YES (via API) |

## Yield Formula System

Formulas use these variables:

| Variable | Description |
|----------|-------------|
| `plantingsPerBed` | Plants per bed (calculated from rows × spacing × bedFeet) |
| `bedFeet` | Bed length (default 50) |
| `harvests` | Number of harvests |
| `daysBetweenHarvest` | Days between harvests |
| `rows` | Number of rows |
| `spacing` | In-row spacing (inches) |
| `seeds` | Seeds per bed |

Common patterns:
- Per-plant: `plantingsPerBed * 0.5 * harvests`
- Per-100ft: `(bedFeet / 100) * 45`
- Seed-based: `seeds * 0.0568 * harvests`

**Fallback**: If no `yieldFormula`, uses legacy `yieldPerHarvest * harvests * (bedFeet / 50)`

## Pipeline Commands

```bash
# Regenerate crops.json from Excel
python scripts/extract-crops.py           # Step 1: raw dump
node src/data/build-minimal-crops.js      # Step 2: normalize

# Verify data
node scripts/audit-seed-data.js           # Check seed field parity with Excel

# Test calculations
npx tsx scripts/test-entities.ts          # Entity validation
npx tsx scripts/test-slim-planting.ts     # Date computation
npx tsx scripts/test-crop-calculations.ts # Crop calc vs Excel
```

## Finding Things

```bash
# Entity types
grep -r "^export interface" src/lib/entities/

# Calculation functions
grep -r "^export function calculate" src/lib

# Store actions
grep -n "async.*=>" src/lib/plan-store.ts | head -20

# Data imports
grep -rh "from '@/data" src/lib src/app src/components
```

## Architecture

**Canonical types** live in `src/lib/entities/`:
- `Bed` - bed with `lengthFt` (default 50)
- `Planting` - one per planting decision, references `configId`
- `CropConfig` - planting configuration with calculations
- `Plan` - self-contained: owns `beds`, `cropCatalog`, `plantings`

**Key principle**: Plans own their data. No external references.

```typescript
interface Plan {
  beds: Record<string, Bed>;
  cropCatalog: Record<string, CropConfig>;  // Snapshot at creation
  plantings: Planting[];
}

// Computed at render time
const calculated = calculateCropFields(config);
const timing = computeTimelineCrop(planting, config, beds);
```
