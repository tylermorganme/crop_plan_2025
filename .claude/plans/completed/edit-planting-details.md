# Edit Planting Details

Transform the existing inspector panel from read-only to editable when a single planting is selected.

## Current State

- Inspector shows planting details (name, dates, bed, feet, etc.) as read-only
- Actions available: Edit Crop Config, Duplicate, Delete
- No way to change `bedFeet`, `configId`, `overrides`, or add notes

## Approach: Inline Editing in Inspector

Instead of a separate modal, make the inspector panel itself editable. This:
- Keeps context visible (user can still see timeline)
- Matches the pattern we just built for AddToBedPanel (side panel UI)
- Avoids modal complexity

## Editable Fields

| Field | UI Element | Notes |
|-------|------------|-------|
| `configId` | Dropdown/search (reuse AddToBedPanel crop search) | Changes the crop type |
| `fieldStartDate` | Date input | Already editable via drag, but nice to have precise input |
| `bedFeet` | Number input with stepper | Typically 25, 50, 75, 100, etc. |
| `startBed` | Dropdown of available beds | Already editable via drag |
| `overrides.additionalDaysOfHarvest` | Number input | Extend harvest window |
| `overrides.additionalDaysInField` | Number input | Delay harvest |
| `overrides.additionalDaysInCells` | Number input | Extend greenhouse time |
| `notes` (new field) | Textarea | Free-form notes |

## Implementation Steps

### 1. Add `updatePlanting` action to plan-store

```typescript
updatePlanting: async (plantingId: string, updates: Partial<Planting>) => {
  // Snapshot for undo
  // Find planting by id
  // Apply updates (merge with existing)
  // Update lastModified
  // Save to library
}
```

### 2. Add `notes` field to Planting type

In `src/lib/entities/planting.ts`:
```typescript
/** User notes about this planting */
notes?: string;
```

### 3. Create EditPlantingPanel component

New file: `src/components/EditPlantingPanel.tsx`

Props:
- `planting: Planting` - the planting being edited
- `cropCatalog: Record<string, CropConfig>` - for config dropdown
- `beds: string[]` - available beds
- `onUpdate: (updates: Partial<Planting>) => void`
- `onClose: () => void`

Structure:
```
┌─────────────────────────────┐
│ Edit: Tomato (Slicing)    × │
├─────────────────────────────┤
│ Crop Config                 │
│ [Search/dropdown........▾]  │
│                             │
│ Field Start     Bed Feet    │
│ [2025-04-15]    [50    ▾]   │
│                             │
│ Starting Bed                │
│ [GH-A1..............▾]      │
│                             │
│ ─── Timing Overrides ───    │
│ Extra Harvest Days  [0   ]  │
│ Extra Field Days    [0   ]  │
│ Extra GH Days       [0   ]  │
│                             │
│ Notes                       │
│ [........................]  │
│ [........................]  │
│                             │
├─────────────────────────────┤
│ [Cancel]          [Save]    │
└─────────────────────────────┘
```

### 4. Integrate into CropTimeline

Replace inspector's read-only single-selection view with:
- **View mode** (default): Current display + "Edit" button
- **Edit mode**: EditPlantingPanel

Or simpler: just swap in EditPlantingPanel when user clicks "Edit Planting"

### 5. Wire up to timeline page

In `src/app/timeline/[planId]/page.tsx`:
- Pass `onUpdatePlanting` callback to CropTimeline
- Get actual `Planting` object from store (not just `TimelineCrop`)

## State Flow

```
User clicks planting → selectedGroupIds updated
                     → Inspector shows read-only view
                     → User clicks "Edit Planting"
                     → Inspector swaps to EditPlantingPanel
                     → User makes changes
                     → User clicks "Save"
                     → onUpdate called with partial updates
                     → updatePlanting in store
                     → Planting updated, saved
                     → Inspector returns to read-only view
```

## Edge Cases

- **Config change**: If user changes configId, timeline crop dates recalculate
- **Bed change**: If user changes startBed, bed span recalculates
- **Bed feet change**: May change number of beds occupied
- **Validation**: bedFeet must be > 0, fieldStartDate must be valid

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/entities/planting.ts` | Add `notes?: string` field |
| `src/lib/plan-store.ts` | Add `updatePlanting` action |
| `src/components/EditPlantingPanel.tsx` | **New file** - edit form component |
| `src/components/CropTimeline.tsx` | Add edit mode toggle, integrate panel |
| `src/app/timeline/[planId]/page.tsx` | Pass onUpdatePlanting, get planting from store |

## Simplifications for MVP

1. Skip config change for now (complex - involves recalculating all dates)
2. Skip bed change (already works via drag)
3. Focus on: `bedFeet`, `overrides`, `notes`

This makes MVP much simpler:
- Just add number inputs for bedFeet and overrides
- Add textarea for notes
- Wire up updatePlanting action

## Alternative: Edit-in-place

Even simpler - just make the existing inspector fields editable:
- Click on "50'" feet value → becomes input
- Click on override value → becomes input
- Add notes section at bottom

This is the least disruptive and matches spreadsheet UX patterns.
