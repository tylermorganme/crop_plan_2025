# Bed Plan Calculation DAG

## Complete Formula Chain: Start Date → End of Harvest

This document traces the complete calculation chain from inputs to the final `End of Harvest` date.

---

## INPUTS (User-Provided or from Crop Database)

| Column | Name | Description |
|--------|------|-------------|
| 20 | `Fixed Field Start Date` | Manual override for when crop goes in field |
| 21 | `Follows Crop` | Identifier of a crop this one follows (succession) |
| 22 | `Follow Offset` | Days after the followed crop ends |
| 18 | `Actual Greenhouse Date` | Override: when seeds actually went into greenhouse |
| 24 | `Actual TP or DS Date` | Override: when crop actually went into field |
| 29 | `Actual Beginning of Harvest` | Override: when harvest actually started |
| 32 | `Actual End of Harvest` | Override: when harvest actually ended |
| 33 | `Additional Days of Harvest` | **Extends harvest window beyond default** |
| 27 | `Additional Days In Field` | (Not used in main calculation) |
| 57 | `DTM` | Days to Maturity (from crop database) |
| 59 | `Harvest Window` | Days of harvest (from crop database) |
| 62 | `Days in Cells` | Days in greenhouse trays (from crop database) |

---

## FORMULA DEFINITIONS (Simplified)

### Level 1: Planned Dates

**[17] Planned Greenhouse Start Date**
```
IF(Days_in_Cells = 0,
   "",
   COALESCE(
     XLOOKUP(Follows_Crop → Expected_End_of_Harvest) + 1 + Follow_Offset,
     Fixed_Field_Start_Date
   ) - Days_in_Cells
)
```

**[23] Planned TP or DS Date**
```
IF(Actual_Greenhouse_Date exists,
   Actual_Greenhouse_Date + Days_in_Cells,
   COALESCE(
     XLOOKUP(Follows_Crop → Expected_End_of_Harvest) + 1 + Follow_Offset,
     Fixed_Field_Start_Date
   )
)
```

### Level 2: Resolved Dates (Actual overrides Planned)

**[19] Greenhouse Start Date**
```
COALESCE(Actual_Greenhouse_Date, Planned_Greenhouse_Start_Date)
```

**[26] TP or DS Date**
```
COALESCE(Actual_TP_or_DS_Date, Planned_TP_or_DS_Date)
```

**[16] Start Date** (Display date - earliest activity)
```
COALESCE(Planned_Greenhouse_Start_Date, Planned_TP_or_DS_Date)
```

### Level 3: Harvest Calculations

**[28] Expected Beginning of Harvest**
```
IF(Greenhouse_Start_Date exists,
   Greenhouse_Start_Date + DTM,    // Transplants: DTM from GH start
   TP_or_DS_Date + DTM             // Direct seed: DTM from field date
)
```

**[30] Beginning of Harvest** (Actual overrides Expected)
```
COALESCE(Actual_Beginning_of_Harvest, Expected_Beginning_of_Harvest)
```

**[31] Expected End of Harvest**
```
Expected_Beginning_of_Harvest + Harvest_Window + Additional_Days_of_Harvest
```

### Level 4: Final Output

**[36] End of Harvest**
```
COALESCE(Actual_End_of_Harvest, Expected_End_of_Harvest)
```

---

## FULLY EXPANDED EQUATION

For a **transplanted crop** (Days_in_Cells > 0) with no actuals/overrides:

```
End_of_Harvest =
  (Fixed_Field_Start_Date - Days_in_Cells)  // Greenhouse Start
  + DTM                                      // Days to Maturity
  + Harvest_Window                           // Base harvest duration
  + Additional_Days_of_Harvest               // User extension
```

For a **direct-seeded crop** (Days_in_Cells = 0) with no actuals/overrides:

```
End_of_Harvest =
  Fixed_Field_Start_Date                     // Goes directly in field
  + DTM                                      // Days to Maturity
  + Harvest_Window                           // Base harvest duration
  + Additional_Days_of_Harvest               // User extension
```

For a **succession crop** following another crop:

```
End_of_Harvest =
  (Followed_Crop_End_of_Harvest + 1 + Follow_Offset - Days_in_Cells)  // Start
  + DTM
  + Harvest_Window
  + Additional_Days_of_Harvest
```

---

## DEPENDENCY GRAPH (ASCII)

```
                                    ┌─────────────────────────────────────┐
                                    │           END OF HARVEST            │
                                    │              [36]                   │
                                    └──────────────┬──────────────────────┘
                                                   │
                          ┌────────────────────────┼────────────────────────┐
                          │                        │                        │
                          ▼                        ▼                        │
              ┌───────────────────────┐  ┌─────────────────────┐            │
              │  Actual End Harvest   │  │ Expected End Harvest│            │
              │        [32]           │  │        [31]         │            │
              │       (INPUT)         │  └──────────┬──────────┘            │
              └───────────────────────┘             │                       │
                                                    │                       │
                    ┌───────────────────────────────┼───────────────────┐   │
                    │                               │                   │   │
                    ▼                               ▼                   ▼   │
        ┌───────────────────────┐     ┌───────────────────────┐ ┌──────────┴──────┐
        │Expected Begin Harvest │     │    Harvest Window     │ │Additional Days  │
        │        [28]           │     │        [59]           │ │  of Harvest [33]│
        └──────────┬────────────┘     │       (INPUT)         │ │    (INPUT)      │
                   │                  └───────────────────────┘ └─────────────────┘
                   │
       ┌───────────┴────────────────────────┐
       │                                    │
       ▼                                    ▼
┌──────────────┐                    ┌──────────────┐
│ GH Start Date│                    │ TP/DS Date   │
│     [19]     │                    │    [26]      │
└──────┬───────┘                    └──────┬───────┘
       │                                   │
       │    ┌──────────┐                   │    ┌──────────────┐
       ├────│ DTM [57] │                   ├────│Actual TP [24]│
       │    │ (INPUT)  │                   │    │   (INPUT)    │
       │    └──────────┘                   │    └──────────────┘
       │                                   │
       ▼                                   ▼
┌──────────────┐                    ┌──────────────┐
│Actual GH [18]│                    │Planned TP/DS │
│   (INPUT)    │                    │    [23]      │
└──────────────┘                    └──────┬───────┘
       │                                   │
       ▼                                   │
┌──────────────┐          ┌────────────────┼────────────────────┐
│Planned GH    │          │                │                    │
│Start [17]    │          ▼                ▼                    ▼
└──────┬───────┘   ┌─────────────┐  ┌─────────────┐     ┌──────────────┐
       │           │Actual GH    │  │FollowsCrop  │     │Fixed Field   │
       │           │Date [18]    │  │[21] + Offset│     │Start [20]    │
       │           │(INPUT)      │  │[22] (INPUT) │     │(INPUT)       │
       │           └─────────────┘  └─────────────┘     └──────────────┘
       │
       ├─────────────────────────────┐
       │                             │
       ▼                             ▼
┌─────────────┐              ┌─────────────┐
│Days in Cells│              │Fixed Field  │
│[62] (INPUT) │              │Start [20]   │
└─────────────┘              │(INPUT)      │
                             └─────────────┘
```

---

## KEY INSIGHTS FOR TIMELINE

1. **Start Date** `[16]` is the display anchor - earliest of greenhouse or field start
2. **End of Harvest** `[36]` is the display end - computed or overridden
3. **Additional Days of Harvest** `[33]` is the primary user adjustment that extends harvest
4. **Actual dates override planned dates** at every step (COALESCE pattern)
5. **Follows Crop** creates inter-crop dependencies (succession planting)
6. **DTM is added from the appropriate starting point:**
   - Transplants: from Greenhouse Start Date
   - Direct seed: from TP/DS Date (field date)

---

## ADJUSTMENT COLUMNS SUMMARY

| Column | Effect on Timeline |
|--------|-------------------|
| `[33] Additional Days of Harvest` | **Extends end date** - adds to harvest window |
| `[27] Additional Days In Field` | Not directly used in main calculation |
| `[58] Additional Days in Cells` | Not used in row-level calcs (might be crop-level) |
| `[22] Follow Offset` | Shifts start date when following another crop |

---

## FOR NORMALIZED DATA COMPARISON

To compute dates from normalized config values:

```javascript
// For transplants (daysInCells > 0)
const ghStart = fixedFieldStartDate - daysInCells;
const expectedBeginHarvest = ghStart + dtm;
const expectedEndHarvest = expectedBeginHarvest + harvestWindow + additionalDaysOfHarvest;

// For direct seed (daysInCells = 0)
const fieldDate = fixedFieldStartDate;
const expectedBeginHarvest = fieldDate + dtm;
const expectedEndHarvest = expectedBeginHarvest + harvestWindow + additionalDaysOfHarvest;
```

The key difference between normalized and raw data:
- **Raw data** uses `Target Sewing Date` and `Target End of Harvest` directly from crops.json
- **Normalized** should compute from `dtm`, `harvestWindow`, and include `additionalDaysOfHarvest`

---

## VALIDATION RESULTS

The TypeScript calculator (`crop-timing-calculator.ts`) was validated against all 136 bed plan assignments:

| Result | Count | Percentage |
|--------|-------|------------|
| Exact matches | 129 | 96.3% |
| Skipped (missing data) | 2 | 1.5% |
| Mismatches | 5 | 3.7% |

### Mismatched Crops (Edge Cases)

1. **Garlic (GAR533, GAR534, GAR535)** - Overwintered crops with special timing
   - Planted Fall 2024, harvest Summer 2025
   - DTM doesn't apply linearly for overwintering crops

2. **Lettuce (LET012, LET013)** - Manual harvest cap
   - End date appears to be manually capped at July 4th
   - Different harvest windows but same end date

These edge cases would need special handling for 100% accuracy.
