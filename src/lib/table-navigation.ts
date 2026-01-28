/**
 * Table Navigation Utilities
 *
 * Shared helpers for keyboard navigation in virtualized tables.
 * Used by FastEditTable and SpecExplorer for arrow key navigation
 * between rows in the same column.
 */

/**
 * Get visual Y position from a cell's parent row.
 * Works with virtualized rows that use translateY for positioning.
 */
export function getRowY(cell: HTMLElement): number {
  const row = cell.parentElement;
  if (!row) return 0;
  const match = row.style.transform?.match(/translateY\(([^)]+)px\)/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Find the target cell in the same column for vertical navigation.
 * Returns the cell element or null if none found.
 *
 * @param input - The currently focused input element
 * @param direction - 'down' to find next row, 'up' to find previous row
 * @returns The target cell element or null
 */
export function findVerticalTarget(input: HTMLElement, direction: 'down' | 'up'): HTMLElement | null {
  const cell = input.closest('[data-edit-col]') as HTMLElement | null;
  if (!cell) return null;
  const col = cell.getAttribute('data-edit-col');
  if (!col) return null;

  const currentY = getRowY(cell);

  // Find all cells in this column, sorted by visual position
  const allCells = Array.from(document.querySelectorAll(`[data-edit-col="${col}"]`)) as HTMLElement[];
  if (allCells.length === 0) return null;

  allCells.sort((a, b) => getRowY(a) - getRowY(b));

  // Find target based on direction
  if (direction === 'down') {
    return allCells.find(c => getRowY(c) > currentY) || null;
  } else {
    const candidates = allCells.filter(c => getRowY(c) < currentY);
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }
}

/**
 * Move focus to the next/previous row's same column (click-to-edit mode).
 * Used by FastEditTable where cells need to be clicked to activate editing.
 *
 * @param input - The currently focused input element
 * @param direction - 'down' to move to next row, 'up' to move to previous row
 */
export function moveFocusVertical(input: HTMLElement, direction: 'down' | 'up'): void {
  const targetCell = findVerticalTarget(input, direction);
  if (targetCell) {
    const clickable = targetCell.querySelector('[data-inline-cell]') as HTMLElement | null;
    if (clickable) {
      clickable.click();
      // Focus will happen via useEffect in the cell component after it enters edit mode
    }
  }
}

/**
 * Move focus to the next/previous row's same column (always-visible input mode).
 * Used by SpecExplorer where inputs are always rendered.
 *
 * @param input - The currently focused input element
 * @param direction - 'down' to move to next row, 'up' to move to previous row
 */
export function moveFocusVerticalDirect(input: HTMLElement, direction: 'down' | 'up'): void {
  const targetCell = findVerticalTarget(input, direction);

  if (!targetCell) {
    input.blur();
    return;
  }

  const nextInput = targetCell.querySelector('input, select') as HTMLElement | null;
  if (nextInput) {
    nextInput.focus();
    if (nextInput instanceof HTMLInputElement) {
      nextInput.select();
    }
  }
}
