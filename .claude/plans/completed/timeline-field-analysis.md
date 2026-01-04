# Timeline Field Analysis

This document provides an exhaustive breakdown of what fields the timeline needs to function, what can be calculated at runtime, and how to slim down the stored data.

## 1. Fields Currently in `TimelineCrop`

The timeline component consumes `TimelineCrop` objects with these fields:

| Field | Source | Required? | Notes |
|-------|--------|-----------|-------|
| `id` | Generated | ✅ | Unique ID for React keys |
| `name` | Config lookup | ✅ | Display name (Crop + Product) |
| `startDate` | **Calculated** | ✅ | When crop enters bed (tpOrDsDate) |
| `endDate` | **Calculated** | ✅ | End of harvest |
| `harvestStartDate` | **Calculated** | Optional | For harvest stripe overlay |
| `resource` | Planting | ✅ | Bed assignment (empty = unassigned) |
| `category` | Config lookup | Optional | For color coding |
| `bgColor` / `textColor` | Override | Optional | Color overrides |
| `feetNeeded` | Planting | ✅ | From `bedsCount × 50` |
| `structure` | Config lookup | Optional | Field/GH/HT (unused in render) |
| `plantingId` | Planting | ✅ | Source identifier |
| `totalBeds` | **Calculated** | ✅ | From bed span calculation |
| `bedIndex` | **Calculated** | ✅ | Position in span (1-indexed) |
| `groupId` | Planting | ✅ | For drag/select grouping |
| `feetUsed` | **Calculated** | Optional | Per-bed usage from span |
| `bedCapacityFt` | **Calculated** | Optional | Bed size (20 or 50) |
| `plantingMethod` | Config lookup | Optional | DS/TP/PE badge |
| `lastModified` | System | Optional | For sync tracking |

---

## 2. Minimal Planting Data (What We Store)

```typescript
interface SlimPlanting {
  // Identity
  id: string;              // e.g., "ARU001"
  cropConfigId: string;    // Reference to planting config catalog

  // Bed Assignment
  bed: string | null;      // e.g., "A5" or null if unassigned
  bedsCount: number;       // In 50ft units (e.g., 0.5 = 25ft)

  // Scheduling (exactly one required)
  fixedFieldStartDate?: string;  // ISO date - when crop enters field
  followsCrop?: string;          // ID of crop this follows
  followOffset?: number;         // Days after followed crop (default 0)

  // Overrides (only if different from config defaults)
  overrides?: {
    additionalDaysOfHarvest?: number;
    additionalDaysInField?: number;
    additionalDaysInCells?: number;
  };

  // Actuals (for tracking variance)
  actuals?: {
    greenhouseDate?: string;
    tpOrDsDate?: string;
    beginningOfHarvest?: string;
    endOfHarvest?: string;
    failed?: boolean;
  };
}
```

---

## 3. Planting Config Fields for Calculations

These come from the **crop catalog** (looked up by `cropConfigId`):

```typescript
interface PlantingConfigForTimeline {
  // Identity & Display
  id: string;
  crop: string;           // "Arugula"
  product: string;        // "Baby Leaf"
  category: string;       // "Green"
  growingStructure: string; // "Field"
  plantingMethod: 'DS' | 'TP' | 'PE';

  // Timing Config
  dtm: number;            // Days to maturity
  harvestWindow: number;  // Days of harvest
  daysInCells: number;    // Days in greenhouse (0 = direct seed)
}
```

---

## 4. Calculation Chain

From `crop-timing-calculator.ts`:

```
fixedFieldStartDate (OR followsCrop end + offset)
    │
    ├── if transplant: - daysInCells → plannedGreenhouseStartDate
    │                                        │
    │                                        v
    │                               greenhouseStartDate (or actualGH override)
    │
    v
plannedTpOrDsDate → tpOrDsDate (or actualTpOrDs override)
                         │
                         v
                    + DTM → expectedBeginningOfHarvest
                                    │
                                    v
                         beginningOfHarvest (or actualBegin override)
                                    │
                                    + harvestWindow + additionalDays
                                    │
                                    v
                         expectedEndOfHarvest
                                    │
                                    v
                         endOfHarvest (or actualEnd override)
```

**Timeline Display Dates:**
- `startDate` = `tpOrDsDate` (when crop enters bed)
- `endDate` = `endOfHarvest`
- `harvestStartDate` = `beginningOfHarvest`

---

## 5. Fields Used in Rendering

| Visual Element | Fields Used |
|----------------|-------------|
| **Position** | `startDate`, `endDate` → `getTimelinePosition()` |
| **Lane** | `resource` → which row to render in |
| **Color** | `category` → `CATEGORY_COLORS` lookup, or `bgColor`/`textColor` override |
| **Name text** | `name` |
| **Date text** | `startDate`, `endDate` → formatted as "M/D" |
| **Harvest stripes** | `harvestStartDate` → overlay from harvest start to end |
| **Method badge** | `plantingMethod` → "DS"/"TP"/"PE" strip |
| **Bed badge** | `bedIndex`/`totalBeds` → "2/3" display |
| **Feet badge** | `feetUsed` vs `bedCapacityFt` → "25'" if partial |
| **Tooltip** | `name`, dates, `bedIndex`/`totalBeds`, `feetUsed`/`bedCapacityFt`, `plantingMethod` |
| **Drag grouping** | `groupId` |
| **Selection** | `groupId` |

---

## 6. Fields Used in Drag/Drop

| Operation | Fields Used |
|-----------|-------------|
| **Span calculation** | `feetNeeded` + target bed → `calculateBedSpan()` |
| **Move operation** | `groupId`, `feetNeeded` → passed to `onCropMove` |
| **Date change** | `groupId`, new `startDate`/`endDate` → `onCropDateChange` |
| **Preview ghost** | `category`/`bgColor`, `cropName`, `feetNeeded`, `startDate`/`endDate` |

---

## 7. What You Can Remove/Calculate

### STORE (in slim planting):
- `id`, `cropConfigId`, `bed`, `bedsCount`
- `fixedFieldStartDate` OR `followsCrop` + `followOffset`
- Optional: `overrides`, `actuals`

### LOOKUP FROM CATALOG:
- `crop`, `product` → display name
- `category` → color
- `growingStructure`, `plantingMethod`
- `dtm`, `harvestWindow`, `daysInCells`

### CALCULATE AT RENDER TIME:
- `startDate` (from timing calculator)
- `endDate` (from timing calculator)
- `harvestStartDate` (from timing calculator)
- `feetNeeded` = `bedsCount × 50`
- `totalBeds`, `bedIndex`, `feetUsed`, `bedCapacityFt` (from bed span calculation)
- `name` = `${crop} (${product})`

---

## 8. Current bed-plan.json Field Audit

Currently storing **37 fields per assignment**. Can slim to **~8-12 fields**:

| Current Field | Keep/Drop | Notes |
|--------------|-----------|-------|
| `crop` | Drop | Derive from config |
| `identifier` | Keep | → `id` |
| `bed` | Keep | Assignment |
| `bedsCount` | Keep | Size |
| `startDate` | Drop | Calculate |
| `plannedGreenhouseStartDate` | Drop | Calculate |
| `actualGreenhouseDate` | Keep if used | Actual override |
| `greenhouseStartDate` | Drop | Calculate |
| `fixedFieldStartDate` | Keep | Input |
| `followsCrop` | Keep | Input |
| `followOffset` | Keep | Input |
| `plannedTpOrDsDate` | Drop | Calculate |
| `actualTpOrDsDate` | Keep if used | Actual override |
| `tpOrDsDate` | Drop | Calculate |
| `expectedBeginningOfHarvest` | Drop | Calculate |
| `actualBeginningOfHarvest` | Keep if used | Actual override |
| `beginningOfHarvest` | Drop | Calculate |
| `expectedEndOfHarvest` | Drop | Calculate |
| `actualEndOfHarvest` | Keep if used | Actual override |
| `endOfHarvest` | Drop | Calculate |
| `additionalDaysOfHarvest` | Keep if used | Override |
| `additionalDaysInField` | Keep if used | Override |
| `additionalDaysInCells` | Keep if used | Override |
| `inGroundDaysLate` | Drop | Calculate |
| `daysUntilHarvest` | Drop | Calculate |
| `trueHarvestWindow` | Drop | Calculate |
| `dtm` | Drop | From catalog |
| `harvestWindow` | Drop | From catalog |
| `daysInCells` | Drop | From catalog |
| `dsTp` | Drop | From catalog |
| `category` | Drop | From catalog |
| `growingStructure` | Drop | From catalog |
| `augustHarvest` | Drop | Unused |
| `failed` | Keep if used | Status flag |

---

## 9. Migration Steps

1. **Create `SlimPlanting` type** matching the interface in Section 2
2. **Build `computeTimelineCrop()` function** that:
   - Takes slim planting + catalog lookup
   - Uses `crop-timing-calculator.ts` for dates
   - Uses `calculateRowSpan()` for bed span info
   - Returns full `TimelineCrop` for rendering
3. **Update `getTimelineCrops()`** to use compute function
4. **Migrate bed-plan.json** to slim format
5. **Update plan-store.ts** to store slim plantings, compute on read

---

## 10. Key Files

| File | Purpose |
|------|---------|
| [plan-types.ts](../../crop-api/src/lib/plan-types.ts) | `TimelineCrop` interface |
| [timeline-data.ts](../../crop-api/src/lib/timeline-data.ts) | `getTimelineCrops()`, bed span calc |
| [crop-timing-calculator.ts](../../crop-api/src/lib/crop-timing-calculator.ts) | Date calculations |
| [CropTimeline.tsx](../../crop-api/src/components/CropTimeline.tsx) | Timeline rendering |
| [plan-store.ts](../../crop-api/src/lib/plan-store.ts) | Plan persistence |
| [entities.ts](../../crop-api/src/lib/types/entities.ts) | Normalized entity types |
