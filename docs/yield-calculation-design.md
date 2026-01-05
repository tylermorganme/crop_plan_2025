# Yield Calculation Design

## The Problem

Yield calculation is one of the most complex parts of the crop planning system. Different crops are naturally thought about in completely different ways, yet we need to:

1. Store yield data in a consistent format
2. Calculate standardized yield for comparing configs (Explorer)
3. Calculate actual yield for a specific planting (Timeline/Plan totals)
4. Scale yield correctly with bed length

## Excel Formula Analysis (339 configs)

Every formula was parsed and categorized. Here's what we found:

### Pattern Distribution

| Pattern | Count | % | Description |
|---------|-------|---|-------------|
| PPB_DIV_DIV_H | 80 | 23.6% | PPB / divisor / Harvests |
| PPB_MULT_DIV_H | 50 | 14.7% | PPB * multiplier / Harvests |
| PPB_MULT | 43 | 12.7% | PPB * multiplier |
| PPB_DIV | 40 | 11.8% | PPB / divisor |
| EMPTY | 34 | 10.0% | No yield data |
| PPB_DIRECT | 31 | 9.1% | PPB (1:1) |
| AREA | 19 | 5.6% | X * BedLength/100 |
| AREA_DIV_H | 15 | 4.4% | X * BedLength/100 / Harvests |
| AREA_DBH_SCALED | 10 | 2.9% | Area with DBH factor (tomatoes) |
| PPB_WEEKLY_RATE | 6 | 1.8% | PPB * rate * DBH/7 |
| BEDLENGTH_DIV_H | 5 | 1.5% | BedLength * rate / Harvests |
| LETTUCE_COMPLEX | 3 | 0.9% | First harvest fixed + PPB-based |
| SEEDS_BASED | 2 | 0.6% | Based on seed count (shallots) |
| PPB_DAILY_RATE | 1 | 0.3% | PPB * rate * DBH |

**100% of formulas matched** (excluding empty entries).

### The Key Distinction: Rate vs Total

The critical question is NOT "per-plant vs area-based." It's:

**Does harvests MULTIPLY the total, or just SPREAD it?**

| Behavior | Count | % | Calculation |
|----------|-------|---|-------------|
| **Rate per harvest** (multiply) | 133 | 39.2% | Total = rate × harvests |
| **Total spread** (divide) | 150 | 44.2% | Total = rate (harvests just distributes it) |
| Complex/edge cases | 22 | 6.5% | DBH-dependent, lettuce, shallots |
| Empty | 34 | 10.0% | No yield data |

### Breakdown by Basis + Behavior

```
PER-PLANT, RATE PER HARVEST:     114 (33.6%)
  Formula: UnitsPerHarvest = PPB * rate
  Total = PPB * rate * harvests
  Examples: Basil (PPB/8), Pepper (PPB*0.28), Broccoli (PPB)

PER-PLANT, TOTAL SPREAD:         130 (38.3%)
  Formula: UnitsPerHarvest = PPB * rate / harvests
  Total = PPB * rate (harvests doesn't multiply)
  Examples: Beet (PPB/5/H), Zinnia (PPB*8/H), Cauliflower (PPB/2/H)

AREA-BASED, RATE PER HARVEST:     19 (5.6%)
  Formula: UnitsPerHarvest = bedFeet/100 * rate
  Total = bedFeet/100 * rate * harvests
  Examples: Bean (65*BL/100), Spinach (20*BL/100)

AREA-BASED, TOTAL SPREAD:         20 (5.9%)
  Formula: UnitsPerHarvest = bedFeet/100 * rate / harvests
  Total = bedFeet/100 * rate
  Examples: Arugula (45*BL/100/H), Raspberry (5*BL/H)

COMPLEX/EDGE CASES:               22 (6.5%)
  - Tomatoes: Area * DBH scaling
  - Summer squash: Weekly rate (PPB * DBH/7)
  - Lettuce: Fixed first harvest + PPB-based
  - Shallots: Seed-based yield
```

## Concrete Examples

### Basil - Rate Per Harvest (PPB_DIV)
- Formula: `PPB / 8`
- PPB = 50 plants, Harvests = 4
- UnitsPerHarvest = 50/8 = 6.25 bunches
- **Total = 6.25 × 4 = 25 bunches** (harvests multiplies)
- Mental model: "8 plants make 1 bunch, every harvest"

### Zinnia - Total Spread (PPB_MULT_DIV_H)
- Formula: `PPB * 8 / Harvests`
- PPB = 150 plants, Harvests = 7
- UnitsPerHarvest = 150 × 8 / 7 = 171 stems
- **Total = 150 × 8 = 1,200 stems** (harvests doesn't multiply)
- Mental model: "8 stems per plant over the whole season"

### Bean - Area Rate Per Harvest (AREA)
- Formula: `65 * BedLength/100`
- BedLength = 50ft, Harvests = 2
- UnitsPerHarvest = 65 × 0.5 = 32.5 lbs
- **Total = 32.5 × 2 = 65 lbs** (harvests multiplies)
- Mental model: "65 lbs per 100ft bed, per harvest"

### Arugula - Area Total Spread (AREA_DIV_H)
- Formula: `45 * BedLength/100 / Harvests`
- BedLength = 50ft, Harvests = 2
- UnitsPerHarvest = 45 × 0.5 / 2 = 11.25 lbs
- **Total = 45 × 0.5 = 22.5 lbs** (harvests doesn't multiply)
- Mental model: "45 lbs per 100ft bed total, spread across cuts"

### Tomato - Complex (AREA_DBH_SCALED)
- Formula: `500 * BedLength/100 * (Harvests * DBH) / 42 / Harvests`
- Simplifies to: `500 * BedLength/100 * DBH/42`
- The DBH factor adjusts yield based on harvest window duration
- Mental model: "500 lbs per 100ft over a 6-week harvest, scaled by actual weeks"

## Proposed Data Model

### Option E: Two-Dimensional Model

The key dimensions are:
1. **Basis**: per-plant vs per-area
2. **Harvest behavior**: rate-per-harvest vs total-spread

```typescript
interface YieldConfig {
  // Basis: how yield scales with bed size
  yieldBasis: 'per-plant' | 'per-100ft';

  // The rate value
  yieldRate: number;  // units per plant OR units per 100ft

  // Harvest behavior: does harvests multiply the total?
  harvestMultiplies: boolean;  // true = rate × H, false = rate (spread)

  // Unit and harvest info
  yieldUnit: string;
  numberOfHarvests: number;
  daysBetweenHarvest: number;
}
```

### Calculation Functions

```typescript
function calculateTotalYield(
  config: YieldConfig,
  bedFeet: number,
  rows: number,
  spacing: number
): number {
  const ppb = (12 / spacing) * rows * bedFeet;

  let baseYield: number;
  if (config.yieldBasis === 'per-plant') {
    baseYield = ppb * config.yieldRate;
  } else {
    baseYield = (bedFeet / 100) * config.yieldRate;
  }

  if (config.harvestMultiplies) {
    return baseYield * config.numberOfHarvests;
  } else {
    return baseYield;  // harvests just spreads it
  }
}

function calculateYieldPerHarvest(
  config: YieldConfig,
  bedFeet: number,
  rows: number,
  spacing: number
): number {
  const total = calculateTotalYield(config, bedFeet, rows, spacing);
  return total / config.numberOfHarvests;
}
```

## Edge Cases to Handle

### Tomatoes (AREA_DBH_SCALED) - 10 configs
The yield depends on harvest duration: `500 * BedLength/100 * DBH/42`

Options:
1. Store as `per-100ft` with rate = 500, then apply DBH/42 factor at calculation time
2. Pre-compute a "weekly rate" and store that
3. Flag as special case with custom calculation

### Summer Squash (PPB_WEEKLY_RATE) - 6 configs
Yield is per-plant-per-week: `PPB * rate * DBH/7`

Mental model: "Each plant produces X squash per week, I harvest every DBH days"

### Lettuce (LETTUCE_COMPLEX) - 3 configs
First harvest is fixed, subsequent scale with PPB:
`(0.5 + (Harvests-1) * 0.25 * PPB) / Harvests`

This represents head lettuce where first harvest is full-size, later harvests are smaller regrowth.

### Shallots (SEEDS_BASED) - 2 configs
Yield based on seed count, not spacing: `Seeds / 16 / SafetyFactor`

Mental model: "Each seed produces a cluster, ~1 lb per 16 seeds"

## Migration Strategy

For each formula pattern, extract:
1. `yieldBasis` - does it use PPB or BedLength directly?
2. `yieldRate` - the multiplier or divisor (inverted if divisor)
3. `harvestMultiplies` - is there a `/Harvests` in the formula?

Example migrations:
```
PPB/8           → per-plant, rate=0.125, harvestMultiplies=true
PPB*8/Harvests  → per-plant, rate=8, harvestMultiplies=false
65*BL/100       → per-100ft, rate=65, harvestMultiplies=true
45*BL/100/H     → per-100ft, rate=45, harvestMultiplies=false
```

## UX Design

### Input UI

Let users enter yield in their preferred mental model:

**Per-plant crops:**
1. "How many [units] per plant?" → rate
2. "Is that per harvest, or total over the season?" → harvestMultiplies

**Bulk/area crops:**
1. "How many [units] per 100ft bed?" → rate
2. "Is that per harvest, or total?" → harvestMultiplies

### Display

**Explorer (comparing configs):**
Show total yield per standard 50ft bed: "57 heads", "22.5 lbs", "1,200 stems"

**Timeline (actual plantings):**
Show total for actual bed feet: "114 heads from 100ft"

## Next Steps

- [x] Parse all Excel formulas - DONE (100% matched)
- [x] Identify the key dimensions (basis + harvest behavior) - DONE
- [ ] Implement YieldConfig type in crop-config.ts
- [ ] Add calculation functions
- [ ] Build migration script to extract rates from formulas
- [ ] Handle edge cases (tomatoes, squash, lettuce, shallots)
- [ ] Design yield input UI
