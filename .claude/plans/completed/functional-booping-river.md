# Fix Multi-Select Drag with Timing Edit

## Problem

When dragging multiple selected unassigned crops with timing edit enabled:
1. The visual timing preview ghost only shows for the dragged item, not all selected items
2. All items DO move correctly on drop, but user can't see what will happen

## Root Cause

Two issues identified in `src/components/CropTimeline.tsx`:

### Issue 1: Unassigned resource mismatch

The condition at line 990 checks:
```typescript
dragPreview?.targetResource === dragPreview?.originalResource
```

For unassigned crops:
- `originalResource` = `""` (empty string, from `crop.resource`)
- `targetResource` = `'Unassigned'` (string literal from `handleDragOver`)

These don't match, so `hasTimingPreview` is false and no ghost appears.

### Issue 2: Preview logic already correct for multi-select

Lines 983-986 already have the right logic:
```typescript
const isDraggedInSelection = dragPreview?.groupId && selectedGroupIds.has(dragPreview.groupId);
const shouldShowTimingPreview = isDraggedInSelection
  ? selectedGroupIds.has(crop.groupId)  // Show for ALL selected
  : dragPreview?.groupId === crop.groupId;
```

This IS correct - once Issue 1 is fixed, previews should show for all selected.

## Fix

### Change 1: Normalize resource comparison (line 990)

Replace:
```typescript
dragPreview?.targetResource === dragPreview?.originalResource
```

With:
```typescript
(dragPreview?.targetResource === dragPreview?.originalResource ||
 (dragPreview?.targetResource === 'Unassigned' && dragPreview?.originalResource === ''))
```

Or better, normalize to `'Unassigned'` in `handleDragStart`:
```typescript
originalResource: effectiveCrop.resource || 'Unassigned',
```

### Change 2: Also normalize in handleDragOver (line 758)

Currently:
```typescript
setDragOverResource(resource);
```

This sets `resource` which could be `'Unassigned'`. The comparison will then work.

## Files to Modify

| File | Change |
|------|--------|
| [CropTimeline.tsx:728](src/components/CropTimeline.tsx#L728) | Normalize `originalResource` to `'Unassigned'` when empty |

## Implementation

Single line change in `handleDragStart`:

```typescript
// Line 728
originalResource: effectiveCrop.resource || 'Unassigned',
```

This ensures `originalResource` is `'Unassigned'` for unassigned crops, matching how `targetResource` is set in `handleDragOver`.
