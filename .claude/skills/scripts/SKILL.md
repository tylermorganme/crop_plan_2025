---
name: scripts
description: Guidelines for creating and organizing scripts in this project. Use when creating new scripts, deciding where scripts should live, or cleaning up temporary work. Covers tmp/ for scratch work vs scripts/ for reusable tools.
---

# Script Organization

## Directory Structure

| Location | Purpose | Committed |
|----------|---------|-----------|
| `crop-api/scripts/` | Reusable project tools and tests | Yes |
| `tmp/` or `*/tmp/` | Scratch work, one-off analysis | No |
| `.claude/skills/*/scripts/` | Portable skill-bundled scripts | Yes |

## When Creating Scripts

**Put in `tmp/`** (not committed):
- One-off data exploration
- Debugging scripts
- Investigation/analysis that won't be reused
- Prototypes before deciding on final location

**Put in `crop-api/scripts/`** (committed):
- Tests that verify correctness
- Tools used repeatedly across sessions
- Data extraction/transformation pipelines
- Project-specific utilities

**Put in skill `scripts/`** (committed):
- Scripts that are core to a skill's functionality
- Only if self-contained (no project-specific dependencies)
- Portable to other projects

## All Project Scripts

### Code Structure Tools

```bash
# Query TypeScript AST - find interfaces, functions, callers
# Use when: exploring type definitions, finding where something is defined
node crop-api/scripts/ast-query.js "Plan"
node crop-api/scripts/ast-query.js "validatePlan" --callers
```

### Excel Workbook Tools

```bash
# Inspect column formulas and values from Excel workbook
# Use when: verifying what Excel actually calculates, checking if field is formula vs static
python crop-api/scripts/inspect-column.py "STH"
python crop-api/scripts/inspect-column.py --list
python crop-api/scripts/inspect-column.py "DTM" --sheet "Bed Plan"

# Extract products table from Excel to JSON
# Use when: workbook has been updated and data needs re-extraction
python crop-api/scripts/extract-products.py
```

### Validation Tests

```bash
# Entity validation - bed lengths, plan structure, planting creation
# Use when: modifying entity types or validation logic
npx tsx crop-api/scripts/test-entities.ts

# Date computation parity - verify computed dates match Excel
# Use when: modifying date calculation logic
npx tsx crop-api/scripts/test-slim-planting.ts

# Catalog lookup parity - verify config lookup matches bed-plan
# Use when: modifying catalog lookup or slim planting extraction
npx tsx crop-api/scripts/test-catalog-parity.ts

# Crop calculation parity - verify calculations match Excel export
# Use when: modifying STH, DTM, harvest window, or planting method calculations
npx tsx crop-api/scripts/test-crop-calculations.ts
```

## Cleanup Pattern

When finishing investigation work:
1. If insights are captured in tests or docs, delete the script
2. If script might be useful later, move to `tmp/`
3. If script is reusable, keep in `scripts/` and document in relevant skill
