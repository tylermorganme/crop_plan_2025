# Planting Sequences Design

## Overview

Planting sequences represent succession plantings - multiple plantings of the same crop staggered over time. For example, 5 arugula plantings each 7 days apart to ensure continuous harvest.

## Data Model

### PlantingSequence Entity

```typescript
interface PlantingSequence {
  id: string;           // e.g., "S1", "S2"
  name?: string;        // Optional label, e.g., "Spring Arugula"
  offsetDays: number;   // Days between each slot
}
```

### Planting Fields

```typescript
interface Planting {
  // ... existing fields ...
  sequenceId?: string;     // Reference to PlantingSequence.id
  sequenceSlot?: number;   // Sparse slot number (0 = anchor, can have gaps like 0,1,2,5,10)
}
```

Note: Renaming `sequenceIndex` to `sequenceSlot` to better reflect that it's sparse, not dense.

### Date Calculation

The effective field start date for a sequence member is calculated as:

```
effectiveFieldStartDate = anchor.fieldStartDate + (slot * sequence.offsetDays) + planting.overrides.additionalDaysInField
```

Where:
- `anchor` = the planting with `sequenceSlot === 0`
- `slot` = this planting's `sequenceSlot`
- `sequence.offsetDays` = the interval from the sequence definition
- `additionalDaysInField` = optional per-planting adjustment (existing override field)

## Key Behaviors

### Slot 0 = Anchor

- The anchor planting (slot 0) owns the base `fieldStartDate`
- All other plantings derive their dates from the anchor
- To extend a sequence earlier, create more plantings and adjust slot numbers

### Sparse Slots

- Slots can have gaps: 0, 1, 2, 5, 10 is valid
- When a planting is unlinked, remaining plantings keep their slot numbers
- Example: Remove slot 3 from [0,1,2,3,4] → remaining show [0,1,2,4] (displayed as #1,#2,#3,#5)

### Drag Behavior

- **Drag any sequence member** → moves the entire sequence
  - Calculates delta days from drag
  - Adjusts anchor's `fieldStartDate`
  - All followers automatically recalculate via the formula
- **Dragging never unlinks** - explicit "unlink" action required

### Unlinking

- Explicit action removes planting from sequence
- Unlinked planting becomes standalone with its current calculated date preserved
- Remaining plantings keep their slot numbers (gaps preserved)
- If only 1 planting remains, sequence is dissolved

### Changing offsetDays

- Editing `offsetDays` on a sequence recalculates all follower dates
- Each planting's slot number stays the same, but the actual dates shift

### Per-Planting Adjustments

- `additionalDaysInField` moves that specific planting from its theoretical slot position
- Other overrides (`additionalDaysInCells`, `additionalDaysOfHarvest`) work as normal
- A planting with adjustments displays at its adjusted position, not its theoretical slot

## Sequence Editing UI

A dedicated UI for managing sequences with these features:

### Display

- Sequence metadata: ID, name (editable), offsetDays (editable)
- List of all slots from 0 to max, showing:
  - Slot number
  - Planting info (crop, bed, ID) or "Empty" for gaps
  - Calculated date for that slot

### Actions

- **Edit name** - rename the sequence
- **Edit offsetDays** - change interval, recalculates all dates
- **Reorder plantings** - drag to reassign slot numbers
- **Add planting** - appends at max+1 by default, can reorder after
- **Remove planting** - unlinks from sequence

### Gap Handling

- Empty slots shown as placeholders in the list
- Dragging a planting to a gap fills that slot
- Empty slots at the ends (before slot 0 or after max occupied slot) are auto-removed
- Interior gaps are preserved until filled

## Timeline Display

- No special visual for gaps on the timeline
- Sequence members show their sequence badge (e.g., "#3" for slot 2)
- Sequence ID shown in badge or tooltip (e.g., "S1")

## Implementation Tasks

### Phase 1: Data Model Updates

1. Rename `sequenceIndex` to `sequenceSlot` in Planting type
2. Update `unlinkFromSequence` to NOT reindex (preserve gaps)
3. Write migration for existing data (sequenceIndex → sequenceSlot, preserve values)

### Phase 2: Formula-Driven Dates

1. Update `expandPlantingsToTimelineCrops` to calculate dates from formula
2. Ensure `additionalDaysInField` is included in the calculation
3. Update drag logic to adjust anchor date only (followers auto-recalculate)

### Phase 3: Sequence Editing

1. Create sequence editing modal/panel
2. Implement slot reordering via drag
3. Implement add planting to sequence
4. Implement offsetDays editing with recalculation
5. Implement gap cleanup (auto-remove end gaps)

### Phase 4: Polish

1. Update Plantings page columns to show slot number correctly
2. Add sequence info to inspector panel
3. Ensure undo/redo works correctly for all sequence operations
