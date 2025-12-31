# Excel → Code Implementation Roadmap

Generated from DAG analysis of `Crop Plan 2025 V20.xlsm`.

## Summary

| Table | Total Cols | INPUT | CALCULATED | MIXED | EMPTY |
|-------|------------|-------|------------|-------|-------|
| Crops | 136 | 35 | 91 | 8 | 2 |
| BedPlan | 143 | 83 | 54 | 1 | 5 |

## Cross-Table Dependencies

BedPlan → Crops (2 columns):
- `Fixed Field Start Date` → `Crops.Identifier`, `Crops.Target Field Date`
- `Chart Index` → `Crops.Identifier`

Both use XLOOKUP with `Crop` (Identifier) as the join key.

---

## Crops Table - Implementation Order

### Level 0: Pure Inputs (35 columns)

These have no formulas. Verify they are truly static:

| Col | Header | Notes |
|-----|--------|-------|
| 9 | Crop | Primary identifier |
| 10 | Variety | |
| 11 | Product | |
| 13 | Category | Flower/Vegetable/etc |
| 15 | Growing Structure | Field/Hoop/Greenhouse |
| 17-19,21 | Sp/Su/Fa/OW | Season flags |
| 23 | Food | Boolean |
| 24 | Rows | Bed rows |
| 25 | Spacing | Inches |
| 26 | Irrigation | DR/Sprinkler |
| 27 | Row Cover | |
| 28 | Frost Tolerant Starts | |
| 29 | Height at Maturity | |
| 31 | Seeds Per Planting | |
| 36-37 | DTG Lower/Upper | Days to germination range |
| 44 | STH | Seed to harvest (key timing) |
| 49-50 | Tray Size, Tray 1 Size | |
| 61 | Days Between Harvest | |
| 68 | Unit | Bunch/Lb/etc |
| 78 | Sewing Rel Last Frost | |

### Level 0: Constants/Simple Formulas

These reference named ranges or are constant:

| Col | Header | Formula |
|-----|--------|---------|
| 33 | Safety Factor | `=IF(Custom Safety Factor="",PlantingSafetyFactor,...)` |
| 34 | Seeding Factor | `=1` (constant) |
| 38 | Days to Germination | `=FLOOR(AVERAGE(DTG Lower:DTG Upper))` |
| 43 | DTM | `=FLOOR(AVERAGE(DTM Lower:DTM Upper))` |
| 80 | Direct Seeding Difficulty | `=1` (constant) |

### ⚠️ MIXED Columns (Need Review)

These have significant formula variance - different rows use different formulas:

| Col | Header | Variance | Base Formula |
|-----|--------|----------|--------------|
| 42 | DTM Upper | 87.1% | `=8*30` (rest are manual values) |
| 65 | Direct Price | 84.0% | `=6*1.1` (rest are manual) |
| 59 | Units Per Harvest | 83.0% | `=Plantings Per Bed/Harvests` |
| 51 | Tray 1 Days | 81.8% | `=9*7` |
| 41 | DTM Lower | 80.0% | `=4*30` |
| 60 | Harvests | 64.7% | `=28/Days Between Harvest` |
| 40 | Days in Cells Old | 56.2% | `=3.5*7` |

**Recommendation**: These are likely semi-manual inputs with formulas as defaults. Treat as INPUT in code, with optional calculated fallback.

### Level 1-3: Core Calculations

| Level | Col | Header | Key Dependencies |
|-------|-----|--------|------------------|
| 1 | 14 | Common Name | Crop |
| 1 | 22 | Seasons | Sp, Su, Fa, Wi, OW |
| 1 | 30 | Plantings Per Bed | Rows, Spacing, BedLength |
| 1 | 74 | Target Sewing Date | Sewing Rel Last Frost, LastFrostDate |
| 1 | 138 | ProductIndex | Crop, Product, Unit |
| 2 | 35 | Seeds Per Bed | Plantings Per Bed, Seeds Per Planting, Safety Factor |
| 2 | 39 | Days in Cells | Tray 1/2/3 Days |
| 2 | 46 | Harvest window | Harvests, Days Between Harvest |
| 3 | 16 | Planting Method | Days in Cells |
| 3 | 47 | Days In Field | STH, Days in Cells, Harvest window |
| 3 | 75 | Target Field Date | Target Sewing Date, Days in Cells |

### Level 4-5: Derived Metrics

| Level | Col | Header | Key Dependencies |
|-------|-----|--------|------------------|
| 4 | 1 | Identifier | Many fields (display string) |
| 4 | 64 | Custom Yield Per Bed | Units Per Harvest, Harvests |
| 5 | 69 | Direct Revenue Per Bed | Custom Yield Per Bed, Direct Price |
| 5 | 96-105 | Harvest/Bunch/Haul/etc | XLOOKUP to Products table |
| 5 | 127 | Wholesale Revenue Per Bed | Custom Yield Per Bed, Rough Wholesale Price |

### Level 6+: Aggregate/Financial Metrics

These are the "leaf" calculations - implement last:
- Revenue per hour/day/acre
- Profit calculations
- CSA portion calculations
- Wholesale profit metrics

---

## BedPlan Table - Implementation Order

### Level 0: Pure Inputs (83 columns)

Key inputs that drive BedPlan calculations:

| Col | Header | Notes |
|-----|--------|-------|
| 1 | Crop | Links to Crops.Identifier |
| 2 | Identifier | Unique ID for this planting |
| 3 | Bed | Physical bed assignment |
| 18 | Actual Greenhouse Date | Manual override |
| 24 | Actual TP or DS Date | Manual override |
| 57 | DTM | Looked up from Crops |
| 59 | Harvest Window | Looked up from Crops |
| 62 | Days in Cells | Looked up from Crops |

### Cross-Table Lookups

| Col | Header | External Deps |
|-----|--------|---------------|
| 20 | Fixed Field Start Date | Crops.Target Field Date |
| 68 | Chart Index | Crops.Identifier |

### Core Timing Calculations

| Col | Header | Formula Pattern |
|-----|--------|-----------------|
| 16 | Start Date | `IF(Planned Greenhouse Start Date, that, else Planned TP or DS Date)` |
| 17 | Planned Greenhouse Start Date | `IF(Days in Cells=0, "", XLOOKUP(Follows Crop...) + Follow Offset - Days in Cells)` |
| 23 | Planned TP or DS Date | Similar pattern with Follows Crop |
| 28 | Expected Beginning of Harvest | `Greenhouse Start Date + DTM` or `TP Date + DTM` |
| 31 | Expected End of Harvest | `Expected Beginning of Harvest + Harvest Window + Additional Days` |

---

## Named Ranges Used

Referenced in formulas but not in tables:

- `BedLength` - Standard bed length
- `LastFrostDate` - Frost date for planning
- `PlantingSafetyFactor` - Default safety multiplier
- `GrowingDays` - Season length
- `BedsPerAcre` - For per-acre calculations
- `LaborRate` - $/hour for labor costing
- `StartsPerHourSeeding` - Labor rate
- `CSAMembers` - Member count

---

## Implementation Strategy

### Phase 1: Verify Inputs
1. Compare INPUT columns against existing TypeScript types
2. Verify no hidden dependencies in "manual" columns
3. Document which MIXED columns should be INPUT vs CALCULATED

### Phase 2: Implement Level 0-2
1. Named range constants
2. Simple derived fields (Seasons, Planting Method)
3. Core timing fields (Days in Cells, DTM, Harvest window)

### Phase 3: Implement Level 3-5
1. Spacing/yield calculations
2. Date calculations (Target dates)
3. Revenue calculations

### Phase 4: Implement Level 6+
1. Financial aggregates
2. Per-acre/per-hour metrics
3. CSA calculations

### Phase 5: BedPlan Calculations
1. Cross-table lookups (use Crops data)
2. Timing calculations
3. Status flags

---

## Parity Testing Approach

For each column implemented:

1. Export Excel values for that column
2. Run code calculation on same input data
3. Compare values, flag mismatches
4. For each mismatch:
   - Is it a code bug? Fix code
   - Is it bad Excel data? Fix import
   - Is it an Excel formula error? Document and decide
