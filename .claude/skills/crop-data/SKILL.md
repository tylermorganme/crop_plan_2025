---
name: crop-data
description: Crop planning data model and architecture. Use when working with crops.json, bed-plan.json, TimelineCrop, or plan data structures for: (1) Understanding entity relationships (Crop → PlantingConfig → Planting → Product), (2) Determining which fields are static inputs vs calculated, (3) Identifying which entity a field belongs to (crop, product, planting, or config-level), (4) Planning data migrations or implementing the slim data architecture, (5) Modifying timeline or explorer components that consume crop data. (project)
---

# Crop Data Context

This skill provides essential context for working with the crop planning data model.

## CRITICAL: Data Analysis Caveats

**The extracted analysis files have known gaps:**

| File | Issue |
|------|-------|
| `column-analysis.json` | Misclassifies array formulas as "static" or "mixed" |
| `formula-analysis.json` | Missing ~20+ formulas using SWITCH, complex XLOOKUP |

**Always verify against the actual workbook** using:
```bash
python scripts/inspect-column.py "STH"           # Inspect specific column
python scripts/inspect-column.py --list          # List all columns
python scripts/inspect-column.py "DTM" --sheet "Bed Plan"
```

**Authoritative reference**: `vba/workbook-structure.md` has table schemas extracted directly from Excel.

## Key Timing Formulas (FROM WORKBOOK)

**STH (Seed To Harvest)** - NOT static, despite what analysis files say:
```
SWITCH(Normal Method,
  "DS": Days to Germination + DTM + IF(Days in Cells > 0, 15, 0)
  "TP": DTM + Days in Cells + IF(Days in Cells <= 0, 20, 0)
  "X":  DTM
)
```

**DTM** - Calculated from range:
```
=FLOOR.MATH(AVERAGE(DTM Lower, DTM Upper))
```

**Days in Cells** - Sum of tray stages:
```
=SUM(Tray 1 Days, Tray 2 Days, Tray 3 Days)
```

**Target dates**:
- `Target Sewing Date = LastFrostDate - 5 * Sewing Rel Last Frost`
- `Target Field Date = Target Sewing Date + Days in Cells`
- `Target Harvest Data = Target Sewing Date + STH`
- `Target End of Harvest = Target Harvest Data + Harvest window`

## Entity Model

```
GLOBAL CONSTANTS (farm settings: LastFrostDate, BedLength, LaborRate)
       │
       ▼
CROP (~100 unique) ─────────────────────────────────────────────────┐
│ name, category, deprecated                                        │
│ Same for all configurations of a crop                             │
       │                                                            │
       │ one crop → many configurations                             │
       ▼                                                            │
PLANTING CONFIGURATION (340 total)                                  │
│ structure (Field/Hoop/Greenhouse)                                 │
│ method (DS/TP), season (Sp/Su/Fa/Wi/Ow)                          │
│ product type, DTM, spacing, rows                                  │
│ Identifier: "Arugula - Baby Leaf | Field DS Sp"                  │
       │                                    │                       │
       │ one config → many plantings        │ references            │
       ▼                                    ▼                       │
PLANTING (per-plan instance)          PRODUCT (processing info) ◄──┘
│ bed, bedsCount, startDate           │ Unit, Price, Yield
│ per-planting overrides              │ Wash type, labor times
│ actual vs planned dates (future)    │ Holding period
```

## Data Source Files

| File | Size | Contents | Notes |
|------|------|----------|-------|
| `src/data/crops.json` | 1.7 MB | 340 configs × ~155 fields | Fat export, includes calculated |
| `src/data/bed-plan.json` | 170 KB | ~138 plantings | Current plan assignments |
| `src/data/products.json` | 213 KB | Product processing data | Labor times, packaging |
| `column-analysis.json` | 46 KB | Field classification | **Has gaps - verify!** |
| `formula-analysis.json` | 29 KB | Formula DAG | **Missing array formulas!** |
| `vba/workbook-structure.md` | - | Table schemas | **Authoritative reference** |

## Planting Override Fields

These bed-plan fields modify catalog values per-planting:

| Override Field | Modifies | Purpose |
|----------------|----------|---------|
| `additionalDaysInField` | STH/DTM | Weather, conditions adjustment |
| `additionalDaysOfHarvest` | Harvest window | Extended/shortened season |
| `additionalDaysInCells` | Days in Cells | Greenhouse timing adjustment |

**Computation pattern**:
```typescript
const effectiveDTM = catalog.STH + planting.additionalDaysInField;
const effectiveHarvestWindow = catalog.harvestWindow + planting.additionalDaysOfHarvest;
```

## Timeline Date Computation

The timeline uses these inputs to compute dates:

**From Catalog (crops.json)**:
- `STH` - Total days from seeding to first harvest
- `Harvest window` - Days of harvest period
- `Days in Cells` - Greenhouse time (0 = direct seed)

**From Planting (bed-plan.json)**:
- `fixedFieldStartDate` - The target transplant/direct-seed date
- `additionalDays*` - Per-planting adjustments

**Computed**:
```
startDate = fixedFieldStartDate (the TP/DS date)
harvestStartDate = startDate + (STH - daysInCells) = startDate + DTM
endDate = harvestStartDate + harvestWindow
```

## Key Implementation Files

| File | Purpose |
|------|---------|
| `lib/slim-planting.ts` | computeTimelineCrop(), lookupConfigFromCatalog() |
| `lib/timeline-data.ts` | getTimelineCrops() - orchestrates computation |
| `lib/plan-types.ts` | TypeScript types for Plan, TimelineCrop |
| `lib/plan-store.ts` | Zustand store for plan state |

## Testing & Verification

| Test | Purpose |
|------|---------|
| `test-slim-planting.ts` | Verifies computed dates match bed-plan stored dates |
| `test-catalog-parity.ts` | Verifies catalog lookup matches bed-plan config values |
| `scripts/inspect-column.py` | Inspect actual Excel formulas |

Run tests:
```bash
npx tsx src/lib/test-slim-planting.ts
npx tsx src/lib/test-catalog-parity.ts
```

## Current vs Target Architecture

**Current**: Fat copies - each planting stores all 155 fields
**Target**: Slim references - plantings reference a plan catalog

Target model:
```typescript
// Slim planting (what we store)
interface SlimPlanting {
  id: string;
  cropId: string;           // references catalog
  bed: string | null;
  bedsCount: number;
  fixedFieldStartDate: string;
  overrides?: {
    additionalDaysInField?: number;
    additionalDaysOfHarvest?: number;
    additionalDaysInCells?: number;
  };
}

// Config looked up from catalog at render time
const config = lookupConfigFromCatalog(cropId, catalog);
const endDate = addDays(startDate, config.dtm + config.harvestWindow);
```
