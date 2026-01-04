# Seed Ordering Pain Points

> **Note:** This documents the current pain points for future reference. Not the current focus.

## Current Process

```
BED PLAN (138 plantings)
    │
    ├── Each planting has variety(s)
    │   └── Often a "seed mix" (named mix with % of each variety)
    │
    ▼
POWER QUERY (aggregation)
    │
    ├── Merges: plantings × seed mixes × varieties
    ├── Calculates: total seeds needed per variety
    │   (e.g., 10% here + 100% there + 50% there = X total)
    │
    ▼
PIVOT TABLE (seeds needed by variety)
    │
    ▼
SEED ORDER TABLE (manual copy of unique company/variety combos)
    │
    ├── Looks up from VARIETIES table:
    │   - Organic status
    │   - URL to purchase
    │   - Seed density (seeds per gram/oz)
    │
    ├── You enter:
    │   - Pack size (e.g., 3x 1/4 lb packs)
    │   - Compares to amount needed
    │
    ├── Checks:
    │   - Already have enough? Mark as don't need
    │   - Weight on hand vs weight needed
    │
    ▼
SHOPPING (15-20 vendor websites)
    │
    ├── Open URLs, fill carts
    ├── Discover sold-out items → back to sheet → pivot breaks
    ├── Double-check everything
    │
    ▼
PLACE ORDERS (~300 line items across 15-20 vendors)
```

## The Data

| Table | Purpose | Size |
|-------|---------|------|
| Bed Plan | Plantings with variety assignments | 138 rows |
| Seed Mixes | Named mixes with % breakdown | 402 rows |
| Varieties | Master catalog (organic, URL, density) | 731 rows |
| Seed Order | This year's order with quantities | ~57-300 rows |

## Inventory Tracking

Tyler weighs seeds on hand and reconciles against what's needed. If there's enough, mark as "already have" / don't need to buy.

## What Breaks

1. **Typo in variety/crop name** → need to fix in source → rebuild pivot → rows shift → manual re-merge

2. **Sold out discovery** (during shopping) → change plan → pivot rebuild → row shifts → manual re-merge

3. **Pivot table fragility** → any change upstream cascades into manual reconciliation work

4. **Unit conversion** → need 5000 seeds, vendor sells by oz/gram/packet → manual math per line item

## Organic Certification Requirement

- Must use organic seed when available
- If using non-organic: **must document search of 3 vendors** for comparable organic seed
- Need proof that organic wasn't available

## What Success Looks Like

| Level | Description |
|-------|-------------|
| **Good** | List of what I need (seeds × quantities) |
| **Better** | List of units to buy (3x 1/4lb packs from Johnny's) |
| **Great** | Prepped order with URLs, quantities, ready to click |
| **Dream** | Actually placed orders |

## Timeline

- Orders placed: ~1 month from now (early January?)
- Things start selling out: varies, but popular varieties go fast

## Key Insight

The problem isn't calculating what you need - that part works. The problem is:

1. **Brittle sync** between pivot and order table
2. **Manual reconciliation** when anything changes
3. **Discovery loop** (sold out → change → rebuild → re-reconcile)
4. **300 items × unit conversion × 15-20 vendors** = tedious

## Questions to Explore

1. Can we make the pivot → order table sync less brittle?
2. Can we automate the unit conversion (seeds needed → packs to buy)?
3. Can we check availability before you start shopping?
4. Can we generate vendor-specific order lists with URLs?
5. Can we automate the organic search documentation?
