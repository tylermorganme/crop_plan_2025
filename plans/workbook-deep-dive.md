# Workbook Deep Dive - Research Plan

## Status

| # | Topic | Status | Notes |
|---|-------|--------|-------|
| 1 | Named Ranges / Constants | Complete | 30+ named ranges found |
| 2 | Crop Map Layout | Complete | Visual calendar with 92 beds |
| 3 | Bed Info Sheet | Complete | 136 bed assignments |
| 4 | Pivot Tables | Complete | Tasks, Quantities, Seed Orders |
| 5 | Actual Data Summary | Complete | 138 plantings, $153K revenue |
| 6 | Workflow Questions | Pending | Needs user input |

---

## 1. Named Ranges / Constants

All defined in the **Config** sheet:

### Farm Parameters
| Name | Value | Description |
|------|-------|-------------|
| `BedLength` | 50 ft | Standard bed length |
| `BedWidth` | 2.5 ft | Standard bed width |
| `StandardBedLength` | 100 ft | Reference length for calculations |
| `BedsPerAcre` | 160 | Beds per acre |
| `FieldAcres` | 1.5 | Total field acreage |
| `GrowingDays` | 180 | Length of growing season |
| `LastFrostDate` | 2025-04-01 | Last frost date |

### Labor & Costs
| Name | Value | Description |
|------|-------|-------------|
| `LaborRate` | $25/hr | Hourly labor rate |
| `BedCost` | $52.88 | Cost per bed |
| `CompostCost` | $35 | Compost cost |
| `CompostCostPerBed` | $13.50 | Compost per bed |
| `AnnualCompostDepth` | 0.083 ft (1") | Annual compost application |

### Timing Constants
| Name | Value | Description |
|------|-------|-------------|
| `PlantingSafetyFactor` | 1.3 | Extra seeds/plants buffer |
| `DaysBetweenStartIrrigation` | 2 | Greenhouse irrigation frequency |
| `HoursPerWeedingPass` | 0.167 (10 min) | Weeding time per bed |
| `SmallTransplantTime` | 0.005 hr | Per small transplant |
| `LargeTransplantTime` | 0.042 hr | Per large transplant |

### Production Rates
| Name | Value | Description |
|------|-------|-------------|
| `StartsPerHourSeeding` | 256 | Seeding rate |
| `UpPottingPerHour` | 120 | Potting up rate |
| `HomeStartFlatIrrigationPerHour` | 120 | Flats watered/hour |

### Market/Handling
| Name | Value | Description |
|------|-------|-------------|
| `CrateHaulTime` | 90 sec | Time to haul one crate |
| `MarketHaulTime` | 3600 sec (1 hr) | Market transport time |
| `CratesPerMarketLoad` | 16 | Crates per market trip |
| `MarketingTimeFactor` | 0.33 | Marketing overhead |

### CSA
| Name | Value | Description |
|------|-------|-------------|
| `CSAMembers` | 50 | Number of CSA members |

---

## 2. Crop Map Layout

The Crop Map is a **visual calendar** where VBA draws colored rectangles representing crops.

### Structure
```
Row 1: Width: 14 (column width setting)
Row 2: Height: 45 (row height setting)
Row 3: Format: mm/dd (date format)
Row 4: First Year: 2024
Row 5: [blank] | [blank] | Date | A1 | A2 | A3 | ... bed names
Row 6+: Year labels | [blank] | Month/Week labels | [crop shapes drawn here]
```

### Bed Layout (92 total beds)
- **Blocks A-J**: 8 beds each (A1-A8, B1-B8, ... J1-J8)
- **Block F & G**: Include F0/G0 (9 beds each)
- **Block X**: 4 beds (X1-X4)
- **U beds**: 6 unassigned/utility beds

### How VBA Uses It
- `MakeCropBox` reads from BedPlan table
- Calculates vertical position based on date offset from Jan 1
- Draws rectangle with height = days in field
- Width = number of beds
- Color from Crop Chart
- Gradient shows harvest period

---

## 3. Bed Info Sheet

A summary view of **136 bed assignments** showing what's planted where.

### Columns
| Column | Description |
|--------|-------------|
| Identifier | Crop ID (e.g., GAR533) |
| Crop | Full crop name with product type |
| Name | Short crop name |
| Variety | Variety planted |
| Row Count | Rows per bed |
| Space | In-row spacing (inches) |
| Beds | Number of beds |

### Sample Data
| Identifier | Name | Variety | Rows | Spacing | Beds |
|------------|------|---------|------|---------|------|
| GAR533 | Garlic | Saved Seed | 3 | 6" | 2 |
| LOV366 | Lovage | Perennial | 1 | 18" | 0.4 |
| BAS002 | Basil | Basil Mix | 4 | 12" | 1 |
| BEA001 | Bean | Pole Bean Mix | 1 | 6" | 2 |

---

## 4. Pivot Tables

### Tasks Pivot
Generates a **task list** by date, showing:
- Task type (Direct Seed, Transplant, etc.)
- Date
- Crop identifier
- Name, variety, company
- Bed assignment
- Done status

Sample tasks:
- 2024-12-21: Direct Seed GAR533 (Garlic) → I5
- 2025-04-01: Direct Seed DAH001 (Dahlia) → U
- 2025-06-30: Direct Seed RAD006 (Radish) → B5

### Crop Quantity Pivot
Aggregates **beds and revenue by crop**:

| Crop | Beds | Revenue |
|------|------|---------|
| Tomato | 41.8 | $89,642 |
| Squash | 17.0 | $5,625 |
| Lettuce | 12.8 | $17,447 |
| Radish | 5.75 | $3,121 |
| Carrot | 5.0 | $2,931 |

### Seed Order Pivot
Tracks **seed costs by crop**:

| Crop | Seed Cost | Beds | Cost/Bed |
|------|-----------|------|----------|
| Tomato | $428 | 41.8 | $10.24 |
| Corn | $84 | 2 | $42.00 |
| Squash | $71 | 17 | $4.17 |
| Carrot | $53 | 5 | $10.65 |

---

## 5. Actual Data Summary

### 2025 Season Overview
| Metric | Value |
|--------|-------|
| Total plantings | 138 |
| Total bed-equivalents | 154.8 |
| Projected revenue | $152,880 |
| Season start | ~January 2024 (garlic) |
| Main season | April - December 2025 |
| Season end | December 22, 2025 |

### Top Crops by Beds
| Crop | Beds | Plantings |
|------|------|-----------|
| Tomato | 31.0 | 10 |
| Squash | 17.0 | 2 |
| Lettuce | 10.4 | 13 |
| Radish | 6.8 | 11 |
| Carrot | 6.0 | 8 |
| Beet | 5.0 | 3 |
| Cabbage | 4.4 | 5 |
| Dahlia | 4.0 | 1 |
| Garlic | 4.0 | 3 |
| Potato | 4.0 | 2 |

### Top Crops by Revenue
| Crop | Revenue |
|------|---------|
| Tomato | $62,642 |
| Lettuce | $14,338 |
| Squash | $5,625 |
| Pepper | $5,098 |
| Celery | $4,950 |
| Cucumber | $4,481 |
| Radish | $3,496 |
| Carrot | $3,489 |
| Bean | $3,120 |
| Garlic | $2,957 |

### Revenue Concentration
- **Tomatoes alone = 41% of projected revenue**
- Top 5 crops = 60% of revenue
- Highly diversified with 40+ crop types

---

## 6. Workflow (From Tyler)

### Core Planning Workflow

```
1. CROP CHART (Database)
   └── ~340 "planting configurations" - every crop you'd consider growing
   └── Rarely changes - built up over years
   └── Added to occasionally: late winter (spring/summer) and summer (fall)

2. FILTER & SELECT
   └── Filter Crop Chart to configs you want this year
   └── Copy identifiers into Bed Plan

3. BED PLAN (This Year's Plantings)
   └── Paste identifiers - looks up all data from Crop Chart
   └── Duplicate rows for succession plantings
   └── Set # of beds, target dates, variety choices

4. GENERATE CROP BOXES (VBA)
   └── Run MakeCropBoxes macro
   └── Creates rectangles on Crop Map
   └── Correct length (days in field) and vertical position (date offset)

5. VISUAL LAYOUT (Crop Map)
   └── Shift+click drag boxes horizontally into beds
   └── Arrange plantings visually across 92 beds
   └── See conflicts, gaps, succession timing

6. SYNC BACK (VBA)
   └── Run UpdateBedPlan macro
   └── Writes bed assignments back to Bed Plan table
   └── Enables all downstream reporting

7. REPORTS (Generated from Bed Plan)
   └── Planting schedules
   └── Seed order lists
   └── Production schedule
   └── Task lists
```

### Overwintering
- Crops that overwinter stay in the plan and carry forward to next year
- Garlic planted in fall, harvested next summer, etc.

### Sales Channels
| Channel | Planning Approach |
|---------|-------------------|
| **CSA** | 50 members, estimate weekly portions needed per crop, calculate beds required |
| **Wholesale** | Similar demand-based planning |
| **Farmers Market** | Similar demand-based planning |

### CSA Math
- `CSAMembers` (50) × portions per week × weeks = total demand
- `Units Per Weekly Harvest` from Crop Chart estimates production
- Calculate beds needed to meet demand

### Seasonal Rhythm
| When | Activity |
|------|----------|
| **Now (Dec)** | Planning 2026 |
| **Late Winter** | Add spring/summer crops, finalize plan |
| **Summer** | Add fall crops |
| **Soon** | Seed ordering (painful) |

### Daily Drivers
- **Bed Plan** - the operational truth
- **Crop Map** - visual layout and scheduling

### Pain Points

> "Honestly the entire thing is kind of broken and tedious, it's way better than not having it, but it's grown so beyond what it ever should have been. It needs an aggressive rework at some point. It's essentially ten tools in 1 with one of the largest databases of crop planting information I've ever seen."

**Specific Issues:**
1. **Seed ordering** - "one of the most painful parts of our process"
2. **Complexity** - 10 tools in 1 workbook
3. **Scale** - massive crop database, hard to maintain
4. **Technical debt** - VBA, complex formulas, fragile connections
