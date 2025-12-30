# Column Reference

Quick reference for field classifications from `column-analysis.json`.

## By Entity

### Crop-level (26 fields)
Same value across all configurations of a crop (consistencyPercent ~100%).

| Column | Header | Type | Notes |
|--------|--------|------|-------|
| E | Deprecated | static | Boolean flag |
| I | Crop | static | Crop name (e.g., "Arugula") |
| BA | Tray 2 Size | static | |
| BB | Tray 2 Days | static | |
| BC | Tray 2 Count | calculated | |
| BD-BF | Tray 3 fields | static/calc | Mostly empty |
| CB | Direct Seeding Difficulty | calculated | |
| CE | Potting Up | calculated | |
| CJ | Trellising | calculated | |
| DO | Direct Non-Labor Cost | calculated | Always 0 |

### Product-level (19 fields)
Tied to how the crop is processed and sold.

| Column | Header | Type | Notes |
|--------|--------|------|-------|
| K | Product | static | Product type (e.g., "Baby Leaf") |
| BG | Units Per Harvest | mixed | |
| BL | Custom Yield Per Bed | calculated | |
| BM | Direct Price | mixed | $/unit |
| BN | Rough Wholesale Price | mixed | |
| BP | Unit | static | "Bunch", "Lb", etc. |
| BQ | Direct Revenue Per Bed | calculated | |
| BT | Direct Revenue Per Bed Day | calculated | |
| BU | Direct Revenue Per Acre Year | calculated | |
| EH | ProductIndex | calculated | Lookup key for Products table |
| EI | ProductTarget | calculated | |
| EJ | Bed Yield | calculated | |
| EK | Units Per Weekly Harvest | calculated | |

### Planting-level (36 fields)
Unique per planting instance (varies even within same config).

| Column | Header | Type | Notes |
|--------|--------|------|-------|
| A | Identifier | mixed | e.g., "ARU002" |
| AQ | DTM | mixed | Days to maturity (key timing field) |
| AP | DTM Upper | mixed | |
| AR | STH | static | Seed to harvest |
| AU | Days In Field | mixed | |
| BV | Target Sewing Date | calculated | From startDate |
| BW | Target Field Date | calculated | |
| BX | Target Harvest Data | calculated | |
| BY | Target End of Harvest | calculated | |
| BZ | Sewing Rel Last Frost | static | Days relative to frost |
| AI | Seeds Per Bed | calculated | |
| CN | Weeding | calculated | Labor hours |
| CQ | Market & Sell | calculated | |
| CR | Harvest | calculated | |
| CT | Haul | calculated | |
| CX | Pack | calculated | |
| DA | Market Transport | calculated | |
| DD | Direct Time | calculated | Total labor |
| DE | Wholesale Time | calculated | |
| DN-DV | Direct profit metrics | calculated | |
| DX-EF | Wholesale profit metrics | calculated | |

### Mixed (74 fields)
Vary by planting configuration (structure, method, season).

| Column | Header | Type | Notes |
|--------|--------|------|-------|
| O | Growing Structure | static | Field/Hoop/Greenhouse |
| P | Planting Method | mixed | DS/TP |
| Q-U | Sp/Su/Fa/Wi/OW | static | Season flags |
| V | Seasons | calculated | Combined seasons string |
| X | Rows | static | Bed rows (e.g., 6) |
| Y | Spacing | static | Inches between plants |
| AA | Row Cover | static | |
| AJ-AK | DTG Lower/Upper | static | Germination range |
| AL | Days to Germination | calculated | |
| AM | Days in Cells | calculated | For transplants |
| AT | Harvest window | mixed | Days of harvest |
| AW | Tray Size | static | |
| AX-AZ | Tray 1 fields | static/calc | |
| BI | Days Between Harvest | static | |
| BJ | Holding Window | calculated | From Products table |

## Key Computed Fields

These are the most important calculations:

```
endDate = startDate + dtm + harvestWindow
harvestStart = startDate + dtm
plantingsPerBed = rows × (BedLength / spacing)
holdingWindow = XLOOKUP(ProductIndex, Products[ID], Products[Holding Period])
```

## Removal Candidates (23 fields)

**Empty (9)**: B (Id), L (CACA), BO (True Wholesale Price), CP (Manage Pests), DH-DL (cost columns)

**Mostly-empty (11)**: D (2024 Notes), T (Wi), AF (Custom Safety Factor), AV (Start In), BD-BF (Tray 3), BK (Delay Before Sale), CI (Trellis Type), DB (Remove Crop Residue), EQ (CSA Notes)

**Obsolete (2)**: F (Audited?), H (Needs DTM Audit)

**Runtime-only (1)**: G (In Plan)
