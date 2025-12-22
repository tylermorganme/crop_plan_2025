# Crop Plan 2025 - Workbook Structure

## Summary

This workbook is a comprehensive farm planning system with **24 sheets** and **17 tables**. It tracks crops from seed ordering through harvest, with revenue projections and task scheduling.

### Core Data Flow

```
Crop Chart (master crop data)
     ↓
Bed Plan (specific plantings for the season)
     ↓
Crop Map (visual calendar via VBA)
```

### Sheet Categories

| Category | Sheets |
|----------|--------|
| **Planning** | Crop Chart, Bed Plan, Crop Map, Config |
| **Seeds** | Seed List, Seed Mixes, Seed Order Pivot, Varieties |
| **Production** | Seed Starting, Production Schedule, Planting, Tasks Pivot |
| **Analysis** | Products, Product Analysis, Crop Quantity Pivot, PAL |
| **Infrastructure** | Bed Info |
| **Historical/Notes** | EOY Notes, Removed, 2023 Seed Order |
| **Organic Cert** | Organic Print, Organic Search, Organic Tasks, Organic BedPlan |

---

## Sheets Overview

| Sheet | Dimensions | Visibility |
|-------|------------|------------|
| Config | A1:M49 | Visible |
| Crop Chart | A1:FB342 | Visible |
| Bed Plan | A1:EW203 | Visible |
| EOY Notes | B2:AE140 | Visible |
| Crop Map | A1:CT77 | Visible |
| Removed | B1:E44 | Visible |
| Products | A1:BB170 | Visible |
| Product Analysis | A1:A1 | Visible |
| Varieties | B2:S733 | Visible |
| Seed List | A1:AI265 | Visible |
| Seed Mixes | B1:K403 | Visible |
| Seed Starting | A1:AC124 | Visible |
| Tasks Pivot | B1:J57 | Visible |
| Planting | B1:L48 | Visible |
| Bed Info | A5:G142 | Visible |
| Crop Quantity Pivot | A1:F43 | Visible |
| Seed Order Pivot | A3:R72 | Visible |
| 2023 Seed Order | B2:S150 | Visible |
| Organic Print | C1:L184 | Visible |
| Production Schedule | B1:AB62 | Visible |
| PAL | B2:P61 | Visible |
| Organic Search | A1:S206 | Visible |
| Organic Tasks | A1:BD5974 | Visible |
| Organic BedPlan | A1:M134 | Visible |

## Key Tables

| Table | Sheet | Purpose | Rows |
|-------|-------|---------|------|
| **Crops** | Crop Chart | Master crop database with timing, spacing, revenue calculations | ~340 |
| **BedPlan** | Bed Plan | Specific plantings for 2025 season | ~138 |
| **Products** | Products | Post-harvest handling times, packaging, CSA planning | ~168 |
| **Varieties** | Varieties | Seed variety catalog with sources | ~731 |
| **SeedOrder** | Seed List | Current year seed purchasing | ~57 |
| **SeedMixes** | Seed Mixes | Custom seed mix compositions | ~402 |
| **Start_Seedlings_Detailed** | Seed Starting | Greenhouse seeding schedule | ~96 |

---

## All Tables (Detailed)

### Containers

- **Sheet:** Config
- **Range:** E1:F5

- **Rows:** ~4 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Container | Text | No | `32 oz` |
| Cost | Formula | Yes | `0.65...` |

### Table9

- **Sheet:** Config
- **Range:** I1:J11

- **Rows:** ~10 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Wash Type | Text | No | `Allium Stalk` |
| Seconds | Number | No | `10` |

### TrellisMethods

- **Sheet:** Config
- **Range:** L1:M3

- **Rows:** ~2 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Trellis Type | Text | No | `Florida Weave 2x` |
| Hours | Formula | Yes | `=3*BedLength/100...` |

### Crops

- **Sheet:** Crop Chart
- **Range:** A2:EY342

- **Rows:** ~340 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Identifier | Formula | Yes | `=(Crops[[#This Row],[Crop]] & IF(NOT(Cro...` |
| Id | Empty | No | `` |
| Might Grow | Number | No | `False` |
| 2024 Notes | Text | No | `Maybe not for food. Valdemar b` |
| Deprecated | Number | No | `True` |
| Audited? | Formula | Yes | `=IFERROR(IF(ISNUMBER(MATCH(Crops[[#This ...` |
| In Plan | Formula | Yes | `=IFERROR(IF(ISNUMBER(MATCH(Crops[[#This ...` |
| Needs DTM Audit | Number | No | `True` |
| Crop | Text | No | `Alexanders` |
| Variety | Text | No | `General` |
| Product | Text | No | `Mature` |
| CACA | Empty | No | `` |
| Category | Text | No | `Flower` |
| Common Name | Formula | Yes | `=Crops[[#This Row],[Crop]]...` |
| Growing Structure | Text | No | `Field` |
| Planting Method | Formula | Yes | `=IF(OR(Crops[[#This Row],[Days in Cells]...` |
| Sp | Empty | No | `` |
| Su | Mixed | No | `TRUE` |
| Fa | Empty | No | `` |
| Wi | Empty | No | `` |
| OW | Text | No | `TRUE` |
| Seasons | Formula | Yes | `= IF(Crops[[#This Row],[Sp]], "Sp", "") ...` |
| Food | Mixed | No | `TRUE` |
| Rows | Number | No | `3` |
| Spacing | Number | No | `9` |
| Irrigation | Text | No | `DR` |
| Row Cover | Text | No | `None` |
| Frost Tolerant Starts | Number | No | `False` |
| Height at Maturity | Number | No | `7` |
| Plantings Per Bed | Formula | Yes | `=IFERROR(12/Crops[[#This Row],[Spacing]]...` |
| Seeds Per Planting | Number | No | `3` |
| Custom Safety Factor | Empty | No | `` |
| Safety Factor | Formula | Yes | `=IF(Crops[[#This Row],[Custom Safety Fac...` |
| Seeding Factor | Formula | Yes | `=1...` |
| Seeds Per Bed | Formula | Yes | `=IFERROR(Crops[[#This Row],[Plantings Pe...` |
| DTG Lower | Number | No | `7` |
| DTG Upper | Number | No | `10` |
| Days to Germination | Formula | Yes | `=_xlfn.FLOOR.MATH(IFERROR(AVERAGE(Crops[...` |
| Days in Cells | Formula | Yes | `=SUM(Crops[[#This Row],[Tray 1 Days]],Cr...` |
| Days in Cells Old | Number | No | `30` |
| DTM Lower | Number | No | `65` |
| DTM Upper | Number | No | `180` |
| DTM | Formula | Yes | `=IFERROR(_xlfn.FLOOR.MATH(AVERAGE(Crops[...` |
| STH | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Normal Method | Text | No | `X` |
| Harvest window | Formula | Yes | `=(Crops[[#This Row],[Harvests]]-1)*Crops...` |
| Days In Field | Formula | Yes | `=Crops[[#This Row],[STH]]-Crops[[#This R...` |
| Start In | Empty | No | `` |
| Tray Size | Number | No | `128` |
| Tray 1 Size | Number | No | `128` |
| Tray 1 Days | Number | No | `35` |
| Tray 1 Count | Formula | Yes | `=IFERROR(IF(Crops[[#This Row],[Tray 1 Da...` |
| Tray 2 Size | Empty | No | `` |
| Tray 2 Days | Empty | No | `` |
| Tray 2 Count | Formula | Yes | `=IFERROR(IF(Crops[[#This Row],[Tray 2 Da...` |
| Tray 3 Size | Empty | No | `` |
| Tray 3 Days | Formula | Yes | `=IF(NOT(ISBLANK(Crops[[#This Row],[Tray ...` |
| Tray 3 Count | Formula | Yes | `=IFERROR(IF(Crops[[#This Row],[Tray 3 Da...` |
| Units Per Harvest | Formula | Yes | `=Crops[[#This Row],[Plantings Per Bed]]*...` |
| Harvests | Number | No | `3` |
| Days Between Harvest | Number | No | `14` |
| Holding Window | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Produc...` |
| Delay Before Sale | Empty | No | `` |
| Custom Yield Per Bed | Formula | Yes | `=Crops[[#This Row],[Units Per Harvest]]*...` |
| Direct Price | Number | No | `3` |
| Rough Wholesale Price | Formula | Yes | `=Crops[[#This Row],[Direct Price]]*0.6...` |
| True Wholesale Price | Empty | No | `` |
| Unit | Text | No | `Bunch` |
| Direct Revenue Per Bed | Formula | Yes | `=Crops[[#This Row],[Custom Yield Per Bed...` |
| Wholesale List | Number | No | `False` |
| Extended Harvest | Formula | Yes | `=Crops[[#This Row],[Harvests]]>1...` |
| Direct Revenue Per Bed Day | Formula | Yes | `=IFERROR(Crops[[#This Row],[Direct Reven...` |
| Direct Revenue Per Acre Year | Formula | Yes | `=IFERROR(Crops[[#This Row],[Direct Reven...` |
| Target Sewing Date | Formula | Yes | `=LastFrostDate-5*Crops[[#This Row],[Sewi...` |
| Target Field Date | Formula | Yes | `=Crops[[#This Row],[Target Sewing Date]]...` |
| Target Harvest Data | Formula | Yes | `=Crops[[#This Row],[Target Sewing Date]]...` |
| Target End of Harvest | Formula | Yes | `=Crops[[#This Row],[Target Harvest Data]...` |
| Sewing Rel Last Frost | Number | No | `-1` |
| Inspiration | Number | No | `10` |
| Direct Seeding Difficulty | Formula | Yes | `=1...` |
| Bed Prep | Formula | Yes | `=IF(Crops[[#This Row],[Transplanting]]>0...` |
| Seeding Trays | Formula | Yes | `=IF(Crops[[#This Row],[Days in Cells]]<=...` |
| Potting Up | Formula | Yes | `=IF(ISBLANK(Crops[[#This Row],[Tray 2 Da...` |
| Start Irrigation | Formula | Yes | `=IFERROR(Crops[[#This Row],[Tray 1 Count...` |
| Start Transport | Formula | Yes | `=0.5/16*MAX(Crops[[#This Row],[Tray 1 Co...` |
| Transplanting | Formula | Yes | `=IF(Crops[[#This Row],[Days in Cells]]>0...` |
| Trellis Type | Empty | No | `` |
| Trellising | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Trelli...` |
| Direct Seeding | Formula | Yes | `=IF(Crops[[#This Row],[Days in Cells]]<=...` |
| Install Irrigation | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Install Row Cover | Formula | Yes | `=IF(OR(ISBLANK(Crops[[#This Row],[Row Co...` |
| Weeding | Formula | Yes | `=HoursPerWeedingPass*Crops[[#This Row],[...` |
| Pruning | Empty | No | `` |
| Manage Pests | Empty | No | `` |
| Market & Sell | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Crop]]...` |
| Harvest | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Crop]]...` |
| Bunch | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Crop]]...` |
| Haul | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Crop]]...` |
| Wash | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Crop]]...` |
| Condition | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Crop]]...` |
| Trim | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Crop]]...` |
| Pack | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Crop]]...` |
| Clean | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Crop]]...` |
| Rehandle | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Crop]]...` |
| Market Transport | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Crop]]...` |
| Remove Crop Residue | Empty | No | `` |
| Revenue - Copy | Formula | Yes | `=Crops[[#This Row],[Direct Revenue Per B...` |
| Direct Time | Formula | Yes | `=_xlfn.AGGREGATE(9,6,Crops[[#This Row],[...` |
| Wholesale Time | Formula | Yes | `=_xlfn.AGGREGATE(9,6,Crops[[#This Row],[...` |
| Revenue Per Hour | Formula | Yes | `=Crops[[#This Row],[Direct Revenue Per B...` |
| Packaging Costs | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Produc...` |
| Seed Cost | Empty | No | `` |
| Water Cost | Empty | No | `` |
| Row Cover Cost | Empty | No | `` |
| Mulch Cost | Empty | No | `` |
| Irrigation Cost | Empty | No | `` |
| Direct Revenue Per Bed2 | Formula | Yes | `=IFERROR(Crops[[#This Row],[Custom Yield...` |
| Direct Labor Cost | Formula | Yes | `=Crops[[#This Row],[Direct Time]]*LaborR...` |
| Direct Non-Labor Cost | Formula | Yes | `=SUM(Crops[[#This Row],[Irrigation Cost]...` |
| Direct Total Cost | Formula | Yes | `=Crops[[#This Row],[Direct Labor Cost]]+...` |
| Direct Profit | Formula | Yes | `=Crops[[#This Row],[Direct Revenue Per B...` |
| Direct Profit Per Acre | Formula | Yes | `=Crops[[#This Row],[Direct Profit]]*Beds...` |
| Direct Profit Per Acre Year | Formula | Yes | `=Crops[[#This Row],[Direct Profit]]*Beds...` |
| Direct Profit Per Bed Day | Formula | Yes | `=Crops[[#This Row],[Direct Profit]]/MIN(...` |
| Direct Labor Per Acre | Formula | Yes | `=Crops[[#This Row],[Direct Time]] * Beds...` |
| Direct Profit Per Owner Labor Hour | Formula | Yes | `=(Crops[[#This Row],[Direct Revenue Per ...` |
| Wholesale Revenue Per Bed | Formula | Yes | `=IFERROR(Crops[[#This Row],[Custom Yield...` |
| Wholesale Labor Cost | Formula | Yes | `=Crops[[#This Row],[Wholesale Time]]*Lab...` |
| Wholesale Non-Labor Cost | Formula | Yes | `=SUM(Crops[[#This Row],[Packaging Costs]...` |
| Wholesale Total Cost | Formula | Yes | `=Crops[[#This Row],[Wholesale Labor Cost...` |
| Wholesale Profit | Formula | Yes | `=Crops[[#This Row],[Wholesale Revenue Pe...` |
| Wholesale Profit Per Acre | Formula | Yes | `=Crops[[#This Row],[Wholesale Profit]]*B...` |
| Wholesale Profit Per Acre Year | Formula | Yes | `=Crops[[#This Row],[Wholesale Profit]]*B...` |
| Wholesale Labor Per Acre | Formula | Yes | `=Crops[[#This Row],[Wholesale Time]] * B...` |
| Wholesale Profit Per Bed Day | Formula | Yes | `=Crops[[#This Row],[Wholesale Profit]]/M...` |
| Wholesale Profit Per Owner Labor Hour | Formula | Yes | `=(Crops[[#This Row],[Wholesale Revenue P...` |
| Packaging Percent | Formula | Yes | `=Crops[[#This Row],[Packaging Costs]]/Cr...` |
| ProductIndex | Formula | Yes | `=Crops[[#This Row],[Crop]]&Crops[[#This ...` |
| ProductTarget | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Produc...` |
| Bed Yield | Formula | Yes | `=Crops[[#This Row],[Custom Yield Per Bed...` |
| Units Per Weekly Harvest | Formula | Yes | `=Crops[[#This Row],[Units Per Harvest]]/...` |
| CSA Portions | Formula | Yes | `=Crops[[#This Row],[Custom Yield Per Bed...` |
| CSA Portions Per Week | Formula | Yes | `=Crops[[#This Row],[Units Per Harvest]]/...` |
| CSA % | Formula | Yes | `=Crops[[#This Row],[CSA Portions Per Wee...` |
| Beds | Empty | No | `` |
| Times | Empty | No | `` |
| CSA Notes | Empty | No | `` |
| Propduction Weeks | Formula | Yes | `=Crops[[#This Row],[Harvests]]*Crops[[#T...` |
| CSA Need | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Produc...` |
| CSA Times | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Produc...` |
| CSA Harvests | Formula | Yes | `=Crops[[#This Row],[Custom Yield Per Bed...` |
| CSA Beds | Formula | Yes | `=_xlfn.XLOOKUP(Crops[[#This Row],[Produc...` |
| CSA Bed Days | Formula | Yes | `=IFERROR(Crops[[#This Row],[Days In Fiel...` |
| Planned CSA Bed Days | Formula | Yes | `=Crops[[#This Row],[CSA Bed Days]]*#REF!...` |
| Notes | Text | No | `0` |

### BedPlan

- **Sheet:** Bed Plan
- **Range:** A5:EW143

- **Rows:** ~138 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Crop | Text | No | `Arugula - Baby Leaf 1X / Field` |
| Identifier | Text | No | `ARU002` |
| Bed | Text | No | `X2` |
| CSA Portions Per Week | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| CSA Portions | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Code | Formula | Yes | `=UPPER(LEFT(BedPlan[[#This Row],[Crop]],...` |
| Notes | Empty | No | `` |
| Name | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Variety | Text | No | `Arugala Mix` |
| Company | Empty | No | `` |
| Mix Constituents | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Seeds | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Seed Bought | Empty | No | `` |
| # Of Beds | Formula | Yes | `0.5...` |
| Display Width | Formula | Yes | `=MAX(BedPlan[[#This Row],['# Of Beds]],0...` |
| Start Date | Formula | Yes | `=IF(ISNUMBER(BedPlan[[#This Row],[Planne...` |
| Planned Greenhouse Start Date | Formula | Yes | `=IF(BedPlan[[#This Row],[Days in Cells]]...` |
| Actual Greenhouse Date | Empty | No | `` |
| Greenhouse Start Date | Formula | Yes | `=IF(ISNUMBER(BedPlan[[#This Row],[Actual...` |
| Fixed Field Start Date | Formula | Yes | `2025-04-07 00:00:00...` |
| Follows Crop | Empty | No | `` |
| Follow Offset | Empty | No | `` |
| Planned TP or DS Date | Formula | Yes | `=IF(ISNUMBER(BedPlan[[#This Row],[Actual...` |
| Actual TP or DS Date | Mixed | No | `2025-04-07 00:00:00` |
| In Ground Days Late | Formula | Yes | `=BedPlan[[#This Row],[Actual TP or DS Da...` |
| TP or DS Date | Formula | Yes | `=IF(ISNUMBER(BedPlan[[#This Row],[Actual...` |
| Additional Days In Field | Empty | No | `` |
| Expected Beginning of Harvest | Formula | Yes | `=IF(ISNUMBER(BedPlan[[#This Row],[Greenh...` |
| Actual Beginning of Harvest | Empty | No | `` |
| Beginning of Harvest | Formula | Yes | `=IF(ISNUMBER(BedPlan[[#This Row],[Actual...` |
| Expected End of Harvest | Formula | Yes | `=BedPlan[[#This Row],[Expected Beginning...` |
| Actual End of Harvest | Empty | No | `` |
| Additional Days of Harvest | Empty | No | `` |
| August Harvest | Formula | Yes | `=IF(AND( BedPlan[[#This Row],[Expected E...` |
| Failed | Empty | No | `` |
| End of Harvest | Formula | Yes | `=IF(ISNUMBER(BedPlan[[#This Row],[Actual...` |
| Seeding Done | Formula | Yes | `=OR(ISNUMBER(BedPlan[[#This Row],[Actual...` |
| Transplant Done | Formula | Yes | `=IF(ISNUMBER(BedPlan[[#This Row],[Planne...` |
| Harvest Done | Formula | Yes | `=OR(ISNUMBER(BedPlan[[#This Row],[Actual...` |
| Crop Done | Formula | Yes | `=OR(BedPlan[[#This Row],[Harvest Done]],...` |
| Broadfork | Number | No | `True` |
| Tilther | Number | No | `True` |
| Amend | Text | No | `Stutzman's 8-2-4: 3 scoops` |
| Row Cover | Number | No | `True` |
| Broadfork Date | Formula | Yes | `=IF(BedPlan[[#This Row],[Broadfork]],Bed...` |
| Tilther Date | Formula | Yes | `=IF(BedPlan[[#This Row],[Tilther]],BedPl...` |
| Amend Date | Formula | Yes | `=IF(NOT(ISBLANK(BedPlan[[#This Row],[Ame...` |
| Row Cover Date | Formula | Yes | `=IF(BedPlan[[#This Row],[Row Cover]],Bed...` |
| Observation 1 | Text | No | `Astro bolted much faster than ` |
| Observation 1 Date | Mixed | No | `2025-05-14 00:00:00` |
| Oberservation 2 | Empty | No | `` |
| Observation 2 Date | Empty | No | `` |
| Observation 3 | Empty | No | `` |
| Observation 3 Date | Empty | No | `` |
| Revenue | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue Per Bed Day | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| DTM | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Additional Days in Cells | Empty | No | `` |
| Harvest Window | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| DS/TP | Formula | Yes | `=IF(ISNUMBER(BedPlan[[#This Row],[Planne...` |
| Full Bed Equivalent | Formula | Yes | `=BedPlan[[#This Row],['# Of Beds]]...` |
| Days in Cells | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Rows | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Spacing | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Seeds Per Planting | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Plantings | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Irrigation | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Chart Index | Formula | Yes | `=MATCH(BedPlan[[#This Row],[Crop]],Crops...` |
| Variant | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Seasons | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Days Until Harvest | Formula | Yes | `=BedPlan[[#This Row],[Expected Beginning...` |
| True Harvest Window | Formula | Yes | `=BedPlan[[#This Row],[Expected End of Ha...` |
| Category | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Height | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Cover | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Tray 1 Size | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Tray 1 Days | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Tray 1 Count | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Tray 2 Size | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Tray 2 Days | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Tray 2 Count | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Tray 3 Size | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Tray 3 Days | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Tray 3 Count | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Safety Factor | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| DTG | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Growing Structure | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
|   | Formula | Yes | `=_xlfn.TEXTJOIN(CHAR(10),FALSE,BedPlan[[...` |
| Harvest Days January 2025 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days February 2025 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days March 2025 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days April 2025 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days May 2025 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days June 2025 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days July 2025 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days August 2025 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days September 2025 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days October 2025 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days November 2025 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days December 2025 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days January 2026 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days February 2026 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days March 2026 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days April 2026 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days May 2026 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days June 2026 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days July 2026 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days August 2026 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days September 2026 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days October 2026 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days November 2026 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Harvest Days December 2026 | Formula | Yes | `=MAX( 0, MIN(BedPlan[[#This Row],[Expect...` |
| Revenue January 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue February 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue March 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue April 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue May 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue June 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue July 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue August 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue September 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue October 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue November 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue December 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue January 2026 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue February 2026 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue March 2026 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue April 2026 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue May 2026 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue June 2026 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue July 2026 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue August 2026 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue September 2026 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue October 2026 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue November 2026 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue December 2026 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Revenue Check | Formula | Yes | `=SUM(BedPlan[[#This Row],[Revenue Januar...` |
| Yield | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Unit | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Product | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Compound Product | Formula | Yes | `=BedPlan[[#This Row],[Name]]&" "&BedPlan...` |
| Yield January 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Yield February 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Yield March 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Yield April 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Yield May 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Yield June 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Yield July 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Yield August 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Yield September 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Yield October 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Yield November 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Yield December 2025 | Mixed | No | `<openpyxl.worksheet.formula.Ar` |

### Table17

- **Sheet:** EOY Notes
- **Range:** B2:AE140

- **Rows:** ~138 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Crop | Text | No | `Carrot (Early) - Mature Root 1` |
| Identifier | Text | No | `CAR001` |
| Bed | Text | No | `A1` |
| CSA Portions Per Week | Mixed | No | `42.8571429` |
| CSA Portions | Mixed | No | `171.428571` |
| Code | Text | No | `CAR` |
| Notes | Text | No | `Asian Greens` |
| Name | Text | No | ` Carrot ` |
| # Of Beds | Number | No | `1` |
| Display Width | Number | No | `1` |
| Start Date | Mixed | No | `2025-03-27 00:00:00` |
| Planned Greenhouse Start Date | Mixed | No | `2025-06-15 00:00:00` |
| Actual Greenhouse Date | Mixed | No | `2025-07-03 00:00:00` |
| Greenhouse Start Date | Mixed | No | `2025-07-03 00:00:00` |
| Fixed Field Start Date | Mixed | No | `2025-03-27 00:00:00` |
| Follows Crop | Empty | No | `` |
| Follow Offset | Empty | No | `` |
| Planned TP or DS Date | Mixed | No | `2025-03-27 00:00:00` |
| Actual TP or DS Date | Mixed | No | `2025-04-05 00:00:00` |
| In Ground Days Late | Number | No | `9` |
| TP or DS Date | Mixed | No | `2025-04-05 00:00:00` |
| Additional Days In Field | Empty | No | `` |
| Expected Beginning of Harvest | Mixed | No | `2025-06-14 00:00:00` |
| Actual Beginning of Harvest | Empty | No | `` |
| Beginning of Harvest | Mixed | No | `2025-06-14 00:00:00` |
| Expected End of Harvest | Mixed | No | `2025-07-05 00:00:00` |
| Actual End of Harvest | Empty | No | `` |
| Adjust | Text | No | `More` |
| Note | Text | No | `Plant later. Need a new red? ` |
| Column1 | Empty | No | `` |

### Products

- **Sheet:** Products
- **Range:** A2:BB170

- **Rows:** ~168 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| ID | Formula | Yes | `=Products[[#This Row],[Crop]]&Products[[...` |
| Crop | Text | No | `Amaranth` |
| Product | Text | No | `Mature Leaf` |
| Unit | Text | No | `Bunch` |
| Target | Number | No | `True` |
| Wash Type | Text | No | `None` |
| Wash Factor | Number | No | `1` |
| Per Crate | Number | No | `40` |
| Units Per Pack | Number | No | `40` |
| Packing Container | Text | No | `IP4` |
| Packaging Cost | Formula | Yes | `=_xlfn.XLOOKUP(Products[[#This Row],[Pac...` |
| Holding Period | Number | No | `0` |
| Marketing (hr) | Number | No | `5` |
| Bunch (s) | Formula | Yes | `=IF(Products[[#This Row],[Unit]]="Bunch"...` |
| Harvest (s) | Number | No | `45` |
| Haul (s) | Formula | Yes | `=CrateHaulTime/Products[[#This Row],[Per...` |
| Wash (s) | Formula | Yes | `=_xlfn.XLOOKUP(Products[[#This Row],[Was...` |
| Condition (s) | Number | No | `0` |
| Trim (s) | Number | No | `0` |
| Pack (s) | Formula | Yes | `=120/40...` |
| Clean (s) | Number | No | `0` |
| Rehandle (s) | Number | No | `0` |
| Market Transport (s) | Formula | Yes | `=MarketHaulTime/CratesPerMarketLoad/Prod...` |
| CSA | Text | No | `Maybe` |
| May 1 | Empty | No | `` |
| May 2 | Empty | No | `` |
| May 3 | Empty | No | `` |
| May 4 | Empty | No | `` |
| Jun 1 | Empty | No | `` |
| Jun 2 | Empty | No | `` |
| Jun 3 | Empty | No | `` |
| Jun 4 | Empty | No | `` |
| Jul1  | Empty | No | `` |
| Jul 2 | Empty | No | `` |
| Jul 3 | Empty | No | `` |
| Jul 32 | Empty | No | `` |
| Aug 1 | Empty | No | `` |
| Aug 2 | Empty | No | `` |
| Aug 3 | Empty | No | `` |
| Aug 4 | Empty | No | `` |
| Sep 1 | Empty | No | `` |
| Sep 2 | Empty | No | `` |
| Sep 3 | Empty | No | `` |
| Sep 4 | Empty | No | `` |
| Oct 1 | Empty | No | `` |
| Oct 2 | Empty | No | `` |
| Oct 3 | Empty | No | `` |
| Oct 4 | Empty | No | `` |
| CSA Portion | Number | No | `0.5` |
| CSA Times | Number | No | `0` |
| CSA Need | Formula | Yes | `=Products[[#This Row],[CSA Portion]]*Pro...` |
| Market Price | Empty | No | `` |
| Value | Formula | Yes | `=Products[[#This Row],[CSA Need]]*Produc...` |
| Out of Season | Empty | No | `` |

### Varieties

- **Sheet:** Varieties
- **Range:** B2:S733

- **Rows:** ~731 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Id | Formula | Yes | `=Varieties[[#This Row],[Company]] & " " ...` |
| Crop | Text | No | `Tomato` |
| Sub Category | Text | No | `Hot` |
| Variety | Text | No | `42-Day` |
| DTM | Empty | No | `` |
| Company | Text | No | `A H Whaley` |
| Organic | Number | No | `False` |
| Pelleted | Empty | No | `` |
| Approved Pellet | Empty | No | `` |
| No Organic | Empty | No | `` |
| SeedLinked | Number | No | `4.4` |
| Notes | Text | No | `Very rare highly prized heirlo` |
| Already Own | Empty | No | `` |
| Selected | Empty | No | `` |
| In Plan | Formula | Yes | `=ISNUMBER(MATCH(Varieties[[#This Row],[I...` |
| Density | Mixed | No | `By Count` |
| Density Per | Text | No | `#N/A` |
| Website | Text | No | `https://awhaley.com/product/42` |

### SeedOrder

- **Sheet:** Seed List
- **Range:** J5:AI62

- **Rows:** ~57 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Id | Formula | Yes | `=SeedOrder[[#This Row],[Company]]& " " &...` |
| Crop | Text | No | `Beet` |
| Company | Text | No | `Adaptive` |
| Variety | Text | No | `Chiogga` |
| Order | Text | No | `x` |
| Is In Cart | Text | No | `x` |
| Density | Formula | Yes | `=_xlfn.XLOOKUP(SeedOrder[[#This Row],[Id...` |
| Density Per | Formula | Yes | `=_xlfn.XLOOKUP(SeedOrder[[#This Row],[Id...` |
| Link | Formula | Yes | `=HYPERLINK(_xlfn.XLOOKUP(SeedOrder[[#Thi...` |
| Needed | Formula | Yes | `=GETPIVOTDATA("Seeds",$B$4,"Variety",See...` |
| Product Weight | Number | No | `1` |
| Weight Unit | Text | No | `ozm` |
| Product Cost | Number | No | `16` |
| Product Quantity | Number | No | `1` |
| Already Have | Number | No | `True` |
| Order Weight | Formula | Yes | `=SeedOrder[[#This Row],[Product Weight]]...` |
| Needed (g) | Formula | Yes | `=IFERROR(CONVERT(S6/SeedOrder[[#This Row...` |
| Needed (ozm) | Formula | Yes | `=IFERROR(CONVERT(S6/SeedOrder[[#This Row...` |
| Needed (lbm) | Formula | Yes | `=IFERROR(CONVERT(S6/SeedOrder[[#This Row...` |
| Is Enough? | Mixed | No | `<openpyxl.worksheet.formula.Ar` |
| Order Cost | Formula | Yes | `=SeedOrder[[#This Row],[Product Quantity...` |
| Notes | Text | No | `Bought from Osborne` |
| Work Needed | Empty | No | `` |
| Is duplicate | Formula | Yes | `=SeedOrder[[#This Row],[Id]]=J5...` |
| Organic | Formula | Yes | `=_xlfn.XLOOKUP(SeedOrder[[#This Row],[Id...` |
| OG Search | Empty | No | `` |

### SeedMixes

- **Sheet:** Seed Mixes
- **Range:** B1:H403

- **Rows:** ~402 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Percent | Formula | Yes | `=1/COUNTIF(SeedMixes[Name],"="&SeedMixes...` |
| Name | Text | No | `Amaranth Mix` |
| Crop | Text | No | `Amaranth` |
| Variety | Text | No | `Callaloo` |
| Company | Text | No | `Uprising` |
| Variety & Company | Formula | Yes | `=SeedMixes[[#This Row],[Variety]]&" "&Se...` |
| Label | Formula | Yes | `=_xlfn.TEXTJOIN(CHAR(10),FALSE, SeedMixe...` |

### Start_Seedlings_Detailed

- **Sheet:** Seed Starting
- **Range:** A2:W98

- **Rows:** ~96 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Done | Number | No | `True` |
| Date | Mixed | No | `2024-03-23 00:00:00` |
| Identifier | Text | No | `SOR485` |
| Bed | Text | No | `J2` |
| Name | Text | No | `Sorrel` |
| Variety | Text | No | `Sorrel Mix` |
| Company | Text | No | `Johnny's` |
| Tray 1 Size | Number | No | `128` |
| Tray 1 Days | Number | No | `28` |
| Tray 1 Count | Number | No | `0.609375` |
| Tray 2 Size | Number | No | `0` |
| Tray 2 Days | Number | No | `0` |
| Tray 2 Count | Number | No | `` |
| Tray 3 Size | Number | No | `0` |
| Tray 3 Days | Number | No | `0` |
| Tray 3 Count | Number | No | `` |
| Seeds Per Planting | Number | No | `3` |
| # Of Beds | Number | No | `0.4` |
| Safety Factor | Number | No | `1.3` |
| DTG | Number | No | `0` |
| Cells | Number | No | `78` |
| Unsafe Cells | Number | No | `60` |
| Column1 | Empty | No | `` |

### Table5

- **Sheet:** Seed Order Pivot
- **Range:** M3:R71

- **Rows:** ~68 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Crop | Text | No | `Salsola` |
| Seed Cost | Number | No | `5.75` |
| Rows | Number | No | `0.5` |
| Row Cost | Number | No | `11.5` |
| Crop Revenue | Number | No | `8.333333333333332` |
| Seed Cost Margin | Number | No | `0.6900000000000001` |

### Table7

- **Sheet:** Seed Order Pivot
- **Range:** F3:K71

- **Rows:** ~68 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Crop | Text | No | `Lemongrass` |
| Seed Cost | Formula | Yes | `=_xlfn.XLOOKUP(F4,$A$4:$A$71,$B$4:$B$71)...` |
| Crop Revenue | Formula | Yes | `=_xlfn.XLOOKUP(F4,'Crop Quantity Pivot'!...` |
| Rows | Formula | Yes | `=_xlfn.XLOOKUP(A4,'Crop Quantity Pivot'!...` |
| Row Cost | Formula | Yes | `=_xlfn.XLOOKUP(F4,$A$4:$A$71,$D$4:$D$71)...` |
| Seed Cost Margin | Formula | Yes | `=G4/H4...` |

### SeedOrder2023

- **Sheet:** 2023 Seed Order
- **Range:** B2:S150

- **Rows:** ~148 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Id | Formula | Yes | `=_xlfn.TEXTJOIN(" ",  FALSE,SeedOrder202...` |
| Company | Text | No | `Adaptive` |
| Name | Text | No | `Borage (White Borage)` |
| Variety | Text | No | `Blue` |
| Varieties.Website | Text | No | `https://www.adaptiveseeds.com/` |
| Density | Number | No | `60` |
| Density Per | Text | No | `g` |
| Product Weight | Number | No | `1` |
| Weight Unit | Text | No | `g` |
| Product Cost | Number | No | `4.15` |
| Product Quantity | Number | No | `4` |
| Order Weight | Mixed | No | `#VALUE!` |
| Needed (g) | Number | No | `` |
| Needed (ozm) | Number | No | `` |
| Needed (lbm) | Number | No | `` |
| Is Enough? | Number | No | `` |
| Order Cost | Mixed | No | `#VALUE!` |
| Notes | Empty | No | `` |

### Merge1

- **Sheet:** Organic Search
- **Range:** A1:S206

- **Rows:** ~205 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Identifier | Text | No | `TOM007` |
| Variety | Text | No | `42-Day` |
| Company | Text | No | `A H Whaley` |
| Seeds | Number | No | `32.5` |
| Crop | Text | No | `Tomato` |
| Sub Category | Empty | No | `` |
| DTM | Empty | No | `` |
| Organic | Text | No | `false` |
| Pelleted | Empty | No | `` |
| Approved Pellet | Empty | No | `` |
| No Organic | Empty | No | `` |
| SeedLinked | Empty | No | `` |
| Notes | Empty | No | `` |
| Already Own | Empty | No | `` |
| Selected | Empty | No | `` |
| In Plan | Number | No | `True` |
| Density | Text | No | `By Count` |
| Density Per | Empty | No | `` |
| Website | Text | No | `https://awhaley.com/product/42` |

### OrganicTasks

- **Sheet:** Organic Tasks
- **Range:** A1:R135

- **Rows:** ~134 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Crop | Text | No | `Lovage (Perennial) - Mature Le` |
| Identifier | Text | No | `LOV366` |
| Bed | Text | No | `J8` |
| # Of Beds | Number | No | `0.4` |
| Broadfork | Empty | No | `` |
| Tilther | Empty | No | `` |
| Amend | Empty | No | `` |
| Row Cover | Empty | No | `` |
| Broadfork Date | Empty | No | `` |
| Tilther Date | Empty | No | `` |
| Amend Date | Empty | No | `` |
| Row Cover Date | Empty | No | `` |
| Observation 1 | Text | No | `Has less weeds because it has ` |
| Observation 1 Date | Mixed | No | `2025-05-04 00:00:00` |
| Oberservation 2 | Empty | No | `` |
| Observation 2 Date | Empty | No | `` |
| Observation 3 | Empty | No | `` |
| Observation 3 Date | Empty | No | `` |

### Organic_BedPlan

- **Sheet:** Organic BedPlan
- **Range:** A1:M134

- **Rows:** ~133 data rows

| Column | Data Type | Calculated | Sample |
|--------|-----------|------------|--------|
| Name | Text | No | `Lovage` |
| Variety | Text | No | `Perennial` |
| Company | Text | No | `Sustainable Seed Company` |
| Bed | Text | No | `J8` |
| Identifier | Text | No | `LOV366` |
| # Of Beds | Number | No | `0.4` |
| Planned Greenhouse Start Date | Mixed | No | `2024-04-01 00:00:00` |
| Actual Greenhouse Date | Mixed | No | `2024-01-01 00:00:00` |
| Planned TP or DS Date | Mixed | No | `2024-01-01 00:00:00` |
| Actual TP or DS Date | Mixed | No | `2024-01-01 00:00:00` |
| TP or DS Date | Mixed | No | `2024-01-01 00:00:00` |
| Expected Beginning of Harvest | Mixed | No | `2024-05-05 00:00:00` |
| Expected End of Harvest | Mixed | No | `2025-01-20 00:00:00` |
