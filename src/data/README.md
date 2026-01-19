# Data Directory Structure

## Production Data (used by the app)

| File | Purpose | Updated By |
|------|---------|------------|
| `crop-config-template.json` | Stock crop catalog (339 configs) | `build-minimal-crops.js` |
| `bed-template.json` | Default bed layout (92 beds) | Manual or import |
| `products-template.json` | Product catalog with pricing | `build-products.js` |
| `varieties-template.json` | Variety catalog | `build-varieties.js` |
| `seed-mixes-template.json` | Seed mix definitions | `build-seed-mixes.js` |
| `column-analysis.json` | Display column metadata (used by CropExplorer) | One-time analysis |

## Build Script

| File | Purpose |
|------|---------|
| `build-minimal-crops.js` | Transforms `crops_from_excel.json` → `crop-config-template.json` |

## Data Flow

```
Excel Workbook (Crop Plan 2025 V20.xlsm)
    │
    ▼ extract-crops.py
tmp/crops_from_excel.json (raw dump, not used by app)
    │
    ▼ build-minimal-crops.js
crop-config-template.json (PRODUCTION - used by app)
    │
    ▼ Plan creation (cloneCropCatalog)
plan.cropCatalog (per-plan snapshot, stored in IndexedDB + data/plans/)
```

## Key Distinction: Stock vs Plan Data

**Stock data** (`crop-config-template.json`):
- Template for new plans
- Shared across all new plans
- Changes here affect NEW plans only

**Plan data** (`data/plans/*.json` + IndexedDB):
- Each plan has its own `cropCatalog` snapshot
- Independent of stock data after creation
- Editable per-plan via the UI

## Directory Structure

```
src/data/                         # Production data (imported by app)
├── crop-config-template.json     # Stock crop catalog
├── bed-template.json             # Default bed layout
├── products-template.json        # Product catalog
├── varieties-template.json       # Variety catalog
├── seed-mixes-template.json      # Seed mix definitions
├── column-analysis.json          # UI display metadata
└── build-*.js                    # Build scripts

data/plans/                  # Saved plan files (backup of IndexedDB)

tmp/                         # Temporary/regenerable files (gitignored)
├── crops_from_excel.json    # Raw Excel dump (regenerate with extract-crops.py)
├── yield-formulas.json      # Extracted yield formulas
└── ...                      # Other working files

tools/excel-analysis/        # Dev tools for Excel analysis
├── formula-analysis.json    # Formula dependency graph data
└── column-metadata.json     # Excel column metadata

scripts/                     # Utility scripts
```

## Regenerating Stock Data

```bash
# Step 1: Extract raw data from Excel
python scripts/extract-crops.py

# Step 2: Transform to production format
node src/data/build-minimal-crops.js

# Step 3: (Optional) Apply yield formulas
node scripts/apply-yield-formulas.js
```
