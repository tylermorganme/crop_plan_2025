# Crop Chart Improvements

Issues and enhancements identified from analyzing the Excel workbook structure.

## Data Quality Issues

### Likely Mistakes (should fix in spreadsheet)

| Row | Column | Current Value | Issue |
|-----|--------|---------------|-------|
| 308 | A (Identifier) | "Strawflower" | Static text instead of formula - should generate full identifier like other rows |
| 271 | P (Planting Method) | "PE" | Static value while other rows use formula - may be intentional for "Perennial" but inconsistent |

### Manual Overrides (intentional but worth noting)

These are cases where formulas were replaced with static values, likely because the formula couldn't handle the special case:

| Rows | Column | Values | Reason |
|------|--------|--------|--------|
| 263-265 | F (Audited?) | True | Raspberries manually marked as audited |
| 7, 263-265, 306 | AU (Days In Field) | 365 | Perennials - formula can't compute year-round field time |
| 75-76, 129, 259 | AQ (DTM) | Various | Manual DTM where formula inputs missing |
| 130-133, 337-339 | AT (Harvest window) | 14 | Fennel, Turnip - manual override |
| 105 | BG (Units Per Harvest) | 0 | Cover Mix - no harvestable yield |

---

## Modeling Gaps

### Perennials Not Well Modeled

Current issues with perennial crops (Artichoke, Raspberries, Strawberry, Rhubarb, Asparagus, etc.):

1. **Days In Field** - Formula assumes annual cycle, perennials need `365` hardcoded
2. **Planting Method** - No "Perennial" option, uses workarounds like "PE"
3. **Harvest calculations** - Based on single-season assumptions
4. **Bed occupancy** - Perennials occupy beds year-round but revenue is seasonal
5. **Establishment year** - First year may have no/reduced harvest

**Potential solutions:**
- Add `Is Perennial` boolean column
- Add `Establishment Years` (years before full production)
- Add `Productive Months` or seasonal availability flags
- Modify revenue calculations to account for multi-year bed occupancy

### Other Modeling Issues

1. **Succession Planting** - No good way to model multiple plantings of same crop
2. **Crop Rotation** - No tracking of what was planted where previously
3. **Variable Yields** - Some crops have highly variable yield (see Units Per Harvest with 93 unique formulas)
4. **Weather/Season Adjustments** - DTM and harvest windows don't account for planting date

---

## Column Consistency Issues

### High Variation Columns (many one-off formulas)

These columns have many different calculation patterns, suggesting the model doesn't fit well:

| Column | Header | Unique Patterns | Notes |
|--------|--------|-----------------|-------|
| BG | Units Per Harvest | 93 | Extremely varied - yield calculations are crop-specific |
| AP | DTM Upper | 19 | Many manual time calculations |
| BM | Direct Price | 14 | Mix of calculated and manual prices |
| CO | Pruning | 11 | Different pruning time formulas |
| BH | Harvests | 10 | Various harvest count calculations |

### Empty Columns (unused)

| Column | Header | Notes |
|--------|--------|-------|
| B | Id | Reserved but empty - we're generating IDs in the API |
| L | CACA | Unknown purpose |
| BO | True Wholesale Price | Never used |
| DH-DL | Seed/Water/Cover/Mulch/Irrigation Cost | Cost tracking not implemented |
| CP | Manage Pests | Empty |

---

## Suggested Enhancements

### Short Term (spreadsheet fixes)
- [ ] Fix Strawflower Identifier (row 308)
- [ ] Standardize Planting Method for perennials
- [ ] Fill in empty cost columns or remove them

### Medium Term (model improvements)
- [ ] Add perennial crop support
- [ ] Standardize Units Per Harvest calculation
- [ ] Add data validation to prevent formula overwrites

### Long Term (architecture)
- [ ] Move from spreadsheet to database
- [ ] Separate "crop templates" from "planting instances"
- [ ] Add proper perennial lifecycle tracking
- [ ] Version history for crop data changes

---

## Column Analysis Summary

From `column-metadata.json`:

| Type | Count | Description |
|------|-------|-------------|
| Calculated | 82 | All rows use formulas |
| Static | 45 | All rows are manual entry |
| Mixed | 19 | Some formula, some manual (potential issues) |
| Empty | 9 | No data |

| Datatype | Count |
|----------|-------|
| Number | 106 |
| Text | 21 |
| Boolean | 15 |
| Date | 4 |
| Unknown | 9 |
