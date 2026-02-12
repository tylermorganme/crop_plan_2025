# Seed Calculation Design

## Overview

This document captures the design for seed-related calculations, including how to estimate seeds needed for planting and purchasing, and how seeds relate to yield formulas.

## The Factors

| Field | What it is | Example |
|-------|-----------|---------|
| `seedsPerPlanting` | Seeds per cell/hole (base count) | 1 (lettuce), 6 (scallion bunch), 4 (shallots) |
| `extraStartFactor` | Insurance multiplier — order extra seeds | 1.3 = 30% extra; 2.2 = double-seed + 10% extra cells |

## The Math

```
Seeds needed = plantingsPerBed × seedsPerPlanting × extraStartFactor
```

Where `plantingsPerBed = (12 / spacing) × rows × bedFeet`

## History

The Excel workbook had two separate insurance fields:
- **Safety Factor** (1.1-1.3): Extra cells/trays started for transplants
- **Seeding Factor** (1-2): Multi-seeding per cell (e.g., 2 seeds per cell for cabbage)

These were combined into a single `extraStartFactor` since they serve the same purpose: ordering more seeds than plants needed. The migration multiplied them together (e.g., Safety Factor 1.1 × Seeding Factor 2 = extraStartFactor 2.2).

## For Yield Formulas

Yield formulas should use `plantingsPerBed` (field plants) — buffers are input planning, not output prediction.

For seed-based yield (like green onions: "1 bunch per 10 seeds"):
```
yield = (plantingsPerBed × seedsPerPlanting) / seedsPerUnit
```

## Future: Method-Aware Seed Calculation

When implementing DS vs TP distinction:
- **Direct seed**: seeds = plants × seedsPerPlanting (no extraStartFactor for DS)
- **Transplant**: seeds = plants × seedsPerPlanting × extraStartFactor
- **Perennial**: 0 seeds
- Yield always based on plants, not plugs
- Trays = plugs / cellsPerTray
