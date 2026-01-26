/**
 * Shared stacking algorithm for timeline views.
 *
 * Used by CropTimeline and overview page to assign crops to rows
 * so non-overlapping items can share the same row.
 */

/**
 * Item with start/end values for stacking calculation.
 */
export interface StackableItem {
  id: string;
  start: number;
  end: number;
}

/**
 * Result of stacking calculation.
 */
export interface StackResult<T extends StackableItem> {
  items: Array<T & { stackLevel: number }>;
  maxLevel: number;
}

/**
 * Calculate stacking levels for items with time/position ranges.
 *
 * Assigns each item to the lowest available row where it doesn't overlap
 * with existing items. This is a greedy interval-packing algorithm.
 *
 * @param items - Items with start/end values
 * @param options - Configuration options
 * @returns Items with stackLevel added, plus maxLevel count
 */
export function calculateStacking<T extends StackableItem>(
  items: T[],
  options?: {
    /** Custom sort function. Default: sort by start ascending */
    sortFn?: (a: T, b: T) => number;
    /** Skip sorting (items already in desired order) */
    skipSort?: boolean;
    /** Use >= instead of > for overlap check (allows touching items on same row) */
    allowTouching?: boolean;
  }
): StackResult<T> {
  if (items.length === 0) {
    return { items: [], maxLevel: 1 };
  }

  const { sortFn, skipSort, allowTouching } = options ?? {};

  // Sort items unless skipSort is true
  const sorted = skipSort
    ? items
    : [...items].sort(sortFn ?? ((a, b) => a.start - b.start));

  const stacked: Array<T & { stackLevel: number }> = [];
  const rowEndValues: number[] = [];

  for (const item of sorted) {
    // Find first available row where previous item has ended
    let assignedRow = -1;
    for (let r = 0; r < rowEndValues.length; r++) {
      const canFit = allowTouching
        ? item.start >= rowEndValues[r]
        : item.start > rowEndValues[r];

      if (canFit) {
        assignedRow = r;
        break;
      }
    }

    // If no row available, create a new one
    if (assignedRow === -1) {
      assignedRow = rowEndValues.length;
      rowEndValues.push(item.end);
    } else {
      rowEndValues[assignedRow] = item.end;
    }

    stacked.push({ ...item, stackLevel: assignedRow });
  }

  return {
    items: stacked,
    maxLevel: Math.max(1, rowEndValues.length),
  };
}

/**
 * Build a lookup map from stacking result.
 * Useful when you need to look up stackLevel by id.
 */
export function buildStackingMap<T extends StackableItem>(
  result: StackResult<T>
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of result.items) {
    map[item.id] = item.stackLevel;
  }
  return map;
}
