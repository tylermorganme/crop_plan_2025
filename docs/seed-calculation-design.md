# Seed Calculation Design

## Overview

This document captures the design for seed-related calculations, including how to estimate seeds needed for planting and purchasing, and how seeds relate to yield formulas.

## The Four Factors

| Field | What it is | Multiplies | Example |
|-------|-----------|------------|---------|
| `seedsPerPlanting` | Seeds per cell/hole | — (base count) | 1 (lettuce), 6 (scallion bunch), 4 (shallots) |
| `overseedingFactor` | Extra seeds IN each cell | seeds per cell | 1.1 = plant 10% extra seeds per cell, thin/prick later |
| `extraStartFactor` | Extra cells/trays started | cell count | 1.3 = start 30% more cells, take the best |
| `seedOrderBuffer` | Purchasing buffer | total seeds | 1.2 = order 20% extra for packet variance, handling |

## Key Insight

`overseedingFactor` and `extraStartFactor` are **independent strategies** - you can use neither, either, or both:

| Strategy | Cells | Seeds | Use case |
|----------|-------|-------|----------|
| Neither | 128 | 128 | Confident germination |
| Overseed only | 128 | 256 | Prick-out method - 2 seeds/cell, thin to 1 |
| Extra trays only | 150 | 150 | Take best 128 from 150 cells |
| Both | 150 | 300 | Maximum insurance |

## The Math

```
Cells needed   = plantingsPerBed × extraStartFactor
Seeds to plant = plantingsPerBed × seedsPerPlanting × overseedingFactor × extraStartFactor
Seeds to order = seedsToPlant × seedOrderBuffer
```

## For Yield Formulas

Yield formulas should use `plantingsPerBed` (field plants) - buffers are input planning, not output prediction.

For seed-based yield (like green onions: "1 bunch per 10 seeds"):
```
yield = (plantingsPerBed × seedsPerPlanting) / seedsPerUnit
```

Example: Scallions with 6 seeds per bunch, 10 seeds per harvestable bunch:
```
yield = (plantingsPerBed × 6) / 10 × harvests
```

## Current Data in crops.json

From Excel import via `build-minimal-crops.js`:
- `seedsPerPlanting` - Seeds Per Planting column
- `safetyFactor` - Safety Factor column (currently combines overseed + extra start)
- `seedsPerBed` - Seeds Per Bed (has safetyFactor baked in)

## Future Migration

When implementing, rename `safetyFactor` to the new fields:
- Split into `overseedingFactor` and `extraStartFactor`
- Add `seedOrderBuffer` (currently implicit)
- Keep `seedsPerPlanting` as-is

## Related Excel Formulas

From the Excel workbook:
```
Plantings Per Bed = (12 / Spacing) × Rows × BedLength
Seeds Per Bed = PPB × Seeds Per Planting × Safety Factor × Seeding Factor
```

Where:
- **Safety Factor** (1.1-1.3): Used in BOTH tray counts AND seeds per bed
- **Seeding Factor** (usually 1, sometimes 2): Used ONLY in seeds per bed (multi-seeding per cell)
