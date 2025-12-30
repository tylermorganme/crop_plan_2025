# Project Context

## What This Is

A crop planning system Tyler built 5 years ago that has grown into a comprehensive farm management tool. It's essentially **10 tools in 1 Excel workbook** with one of the largest databases of crop planting information around.

## The Core Value

Two things make this worth the hassle:

1. **Crop Chart** - A database of ~340 "planting configurations" representing every crop considered and how to grow it
2. **Paper dolling** - Visual drag-and-drop layout of crops on a calendar/bed map

The real magic is the **bidirectional sync** between visual (Crop Map) and data (Bed Plan). You can drag shapes to plan visually, then sync back to get all downstream reports. This is why Tyler built it and why he tolerates the pain.

## The System

### Data Flow
```
Crop Chart (planting config database, 340 entries)
    ↓ filter & copy identifiers
Bed Plan (this year's plantings, ~138 rows)
    ↓ VBA generates shapes
Crop Map (visual calendar with draggable crop boxes)
    ↓ VBA syncs back
Bed Plan → Reports (schedules, seed orders, tasks, etc.)
```

### Key Sheets
- **Config** - Named ranges, constants (BedLength, LaborRate, LastFrostDate, etc.)
- **Crop Chart** - Master database of planting configurations
- **Bed Plan** - This year's specific plantings
- **Crop Map** - Visual Gantt-style calendar with 92 beds
- **Seed Mixes** - Named mixes with % breakdown of varieties (e.g., "Lettuce Mix" = 30% Salanova, 40% Romaine, 30% Butterhead)
- **Varieties** - Master catalog of 731 varieties: organic status, URL, seed density, company

### Key Abstractions

**Seed Mixes** - Instead of assigning 5 varieties to a planting, assign one mix name. Power Query explodes these out to calculate actual seed needs per variety.

**Planting Configurations** - A specific way to grow a crop (e.g., "Tomato (Cherry) - Fresh / Field TP Su" captures crop, product type, growing structure, planting method, and season).

### Overwintering

The plan spans **crop years, not calendar years**. Crops that overwinter (garlic, perennials) stay in the plan and carry forward to the next year.

### Organic Certification

The farm is certified organic. For any non-organic seeds, must document searching 3 vendors for organic alternatives as proof organic wasn't available.

### Farm Details
- 1.5 acres, 92 beds (50ft × 2.5ft)
- Last frost: April 1
- 50 CSA members + wholesale + farmers market
- 2025 plan: 138 plantings, $153K projected revenue
- Tomatoes = 41% of revenue

## Workflow

1. Filter Crop Chart to desired configs
2. Copy identifiers to Bed Plan
3. Duplicate rows for succession plantings
4. Set variety, bed count, dates
5. Run VBA to generate crop boxes
6. Drag boxes horizontally to assign beds
7. Run VBA to sync bed assignments back
8. Reports generate from Bed Plan

## Seasonal Rhythm

| When | Activity |
|------|----------|
| December | Planning next year |
| Late Winter | Finalize spring/summer plan |
| Summer | Add fall crops |
| Soon | Seed ordering |

## Known Pain Points (for future reference)

1. **Seed ordering** - Brittle pivot tables, manual reconciliation, 300 items across 15-20 vendors
2. **Complexity** - 10 tools crammed into one workbook
3. **Technical debt** - VBA, complex formulas, fragile connections
4. **Scale** - Massive database, hard to maintain

## What's Next

Tyler has a destination in mind - waiting for direction.
