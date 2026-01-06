# Session State Dump - 2025-01-05

## What Was Done This Session

### 1. Seed Data Audit & Fix
- **Found**: `seedingFactor` was NOT being imported from Excel
- **Fixed**: Added to `build-minimal-crops.js` line 121
- **Added**: Type definition in `crop-config.ts` line 147
- **Verified**: 100% parity with Excel for Seeds Per Bed values
- **Created**: `scripts/audit-seed-data.js` for verification

### 2. Yield Formula Status
- `tmp/yield-formulas.json` has 305 formulas ready (regenerated with `plantingsPerBed` naming)
- `crops.json` has 0 `yieldFormula`, only legacy `yieldPerHarvest`
- **NOT blocking**: Fallback to legacy works fine
- Apply later with: `node scripts/apply-yield-formulas.js`

### 3. Documentation Updates
- Updated `CLAUDE.md` with Stock vs Live Plan data section
- Updated `.claude/skills/crop-data/SKILL.md` - complete rewrite
- Created `src/data/README.md` explaining file purposes

## Critical Architecture Understanding

### Stock vs Live Data (KNOW THIS)
```
src/data/crops.json (STOCK - template)
    │
    ▼ cloneCropCatalog() at plan creation
plan.cropCatalog (LIVE - per-plan, independent)
```

- **Stock changes** → only affect NEW plans
- **Live plan** → has own catalog snapshot, editable in UI
- They are INDEPENDENT after plan creation

### What Files Matter

**Production (imported by app)**:
- `src/data/crops.json` - stock catalog
- `src/data/bed-plan.json` - bed layout
- `src/data/column-analysis.json` - display metadata

**Pipeline artifacts (NOT used by app)**:
- `src/data/crops_from_excel.json`
- `src/data/crops.json.old`
- `src/data/normalized.json`
- `src/data/products.json`
- `src/data/formula-analysis.json`
- `tmp/*` - all temp files

### Current Data State

| Location | yieldFormula | seedingFactor | yieldPerHarvest |
|----------|--------------|---------------|-----------------|
| crops.json (stock) | 0 | 303 | 305 |
| Live plan catalogs | 339 | 0 | 0 |
| tmp/yield-formulas.json | 305 | n/a | n/a |

Live plans were created before seedingFactor fix - they have formulas but not seedingFactor.

## Key Files Modified

1. `src/data/build-minimal-crops.js` - added seedingFactor import
2. `src/lib/entities/crop-config.ts` - added seedingFactor type
3. `CLAUDE.md` - added data pipeline docs
4. `.claude/skills/crop-data/SKILL.md` - complete rewrite
5. `src/data/README.md` - new file

## Naming Conventions (Already Done)

Code uses self-documenting names:
- `plantingsPerBed` not `PPB`
- `daysBetweenHarvest` not `DBH`
- `seedToHarvest` not `STH`
- `from-seeding` / `from-transplant` / `total-time` not `DS` / `TP` / `X`
- `direct-seed` / `transplant` / `perennial` not `DS` / `TP` / `PE`
- `field` / `greenhouse` / `high-tunnel` not `Field` / `GH` / `HT`

## Outstanding / Deferred

1. **Yield formulas in stock**: Can apply with `node scripts/apply-yield-formulas.js` when ready
2. **Pipeline artifacts cleanup**: Could move to `src/data/_pipeline/` for clarity
3. **tmp/ cleanup**: Safe to delete, gitignored
4. **Scripts cleanup**: Many one-time scripts in `scripts/` could be archived

## Commands

```bash
# Regenerate stock data from Excel
python scripts/extract-crops.py
node src/data/build-minimal-crops.js

# Verify seed data
node scripts/audit-seed-data.js

# Apply yield formulas (when ready)
node scripts/apply-yield-formulas.js --dry-run
node scripts/apply-yield-formulas.js

# Type check
npx tsc --noEmit

# Build
npm run build
```
