# Crop Planning Data Model Design

This document captures design decisions and migration notes. **For type definitions, see `crop-api/src/lib/types/entities.ts`** - that's the source of truth.

## Key Design Decisions

### DTM is Config-Specific, Lives in ProductSequence

DTM varies by planting configuration, not just product. The same product (e.g., "Cherry Tomatoes") can have wildly different DTMs depending on the config:
- Determinate field tomatoes: ~55-70 days
- Indeterminate greenhouse tomatoes: ~90+ days

**Where DTM lives:**
- `Crop.dtm`: Reference/default DTM for the crop family, used as starting point when creating new configs
- `ProductSequence.harvestStartDays`: The actual planning number - days from planting to first harvest for this specific config

**Products have no DTM** - they represent what is sold (pricing, labor, handling), not timing. Timing is captured in the bridge between config and product (ProductSequence).

### ProductSequence Links Planting to Products

A single planting can produce multiple products. ProductSequence defines when and how each product is harvested. User decides which products to model - if they want green garlic, add that sequence. If they want bulbs, add that. Both? Add both.

### Perennial is a Config Choice, Not a Crop Property

Same crop can be grown as annual or perennial (strawberries, some herbs). This is a planting configuration decision.

### Progressive Disclosure in UI

Only show fields when relevant:
- `daysBetweenHarvest`: hidden when `harvestCount = 1`
- `traySequence`: hidden for direct seed
- `establishmentYears`: hidden for non-perennials
- Direct seed fields: hidden for transplants

### Simplified Harvest Model

- No `harvest_end` - calculated from `harvestStartDays + (harvestCount-1) * daysBetweenHarvest`
- No complex harvest types (single/recurring/continuous) - just count + interval
- No `is_destructive` flag - if you're short-circuiting a bed, why model it?

### Yield Entry is a UI Concern

The data model stores `yieldPerHarvest` + `harvestCount`. How the user enters this is a UI choice:
- **Backward calculation**: "I know I'll get 1200 beets total over 4 harvests" → UI divides for them
- **Forward calculation**: "I get 3 kale stems per plant per week" → UI multiplies for them

No `yieldMethod` field needed - the stored value is always yield-per-harvest.

### Bed Lifecycle

A bed is "done" when the last ProductSequence completes.

### Default Year-Round Pricing

Seasonal pricing windows are supported but not required. Most products just need a single price.

### DTM Conversion Rules

When the actual planting method differs from how DTM was measured (Normal Method), we convert.
See `crop-api/src/lib/dtm-conversion.ts` for implementation.

**Conversions:**
- **TP→DS** (DTM from transplant, actually direct seeding): Add 20 days
- **DS→TP** (DTM from direct seed, actually transplanting): Add `daysInCells × 0.65`

**STH Calculation:**
- Direct seed: `STH = DTM` (with TP→DS conversion if needed)
- Transplant with TP DTM: `STH = DTM + daysInCells`
- Transplant with DS DTM: `STH = DTM + (daysInCells × 0.65)`

These rules apply consistently to ALL crops. Legacy spreadsheet data (especially flowers) may have inconsistent STH values - treat the conversion rules as canonical.

---

## Data Migration

### Fields Removed Entirely
- Might Grow, Deprecated, Audited?, In Plan, Needs DTM Audit
- CACA, Days in Cells Old, Start in Tray

### Moved to Crop
- Variety → name
- Category
- Common Name → displayName
- DTG fields
- Row Cover
- Notes (merge 2024 Note with prefix)

### Moved to Product
- Product name
- Unit
- Holding Window
- Food
- Prices (with year-round default window)
- Labor times, handling, packaging

### Moved to ProductSequence
- **harvestStartDays** (the effective DTM for this config)
- Harvest count
- Days between harvest
- Units per harvest (yieldPerHarvest)

### Moved to PlantingConfig
- Growing Structure
- Planting Method → plantingType
- Rows, Spacing
- Tray sizes → traySequence

### Calculated at Runtime
- Identifier/quickDescription
- Days in Cells (sum of tray stages)
- Days in Field (from product sequences)
- Harvest Window (from sequences)
- Plantings Per Bed

---

## Implementation Status

- [x] Products table extracted
- [x] TypeScript interfaces created with ProductSequence
- [x] Basic normalization script (needs ProductSequence support)
- [x] DTM conversion utilities (`dtm-conversion.ts`)
- [ ] Update UI for entity-based editing
- [ ] "Copy from template" workflow
- [ ] Product sequence editor

