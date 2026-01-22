import { create } from 'zustand';

/**
 * UI Store - Manages ephemeral UI state shared across views
 *
 * Separate from plan-store.ts because:
 * - UI state (selections, toasts, search) is ephemeral and cross-view
 * - Plan state (plantings, beds, configs) is persistent and data-centric
 *
 * ## Philosophy: Consistency > Independence
 *
 * **Default to SHARED unless truly view-specific.**
 *
 * Timeline and Plantings should behave consistently:
 * - Same selection behavior (multi-select shows inspector)
 * - Same search/filter behavior
 * - Same toast notifications
 * - Same "current focus" state
 *
 * **Invisible divergence is worse than invisible coupling.**
 * Having Timeline and Plantings work differently creates user confusion.
 *
 * ## When to use UI Store vs Local useState
 *
 * **Use UI Store (default):**
 * - Selection state (selectedPlantingIds)
 * - Search queries (searchQuery)
 * - Toast notifications (toast)
 * - Any state that should persist across navigation
 * - Any state that coordinates between Timeline/Plantings
 *
 * **Use Local useState (rare exceptions):**
 * - View-specific layout (columnOrder, columnWidths - Plantings only)
 * - Transient drag state (draggedCropId, dragOverResource)
 * - Modal open/closed state (showColumnManager)
 * - Form input being edited (editingCellValue)
 *
 * **Rule of thumb:**
 * Could this create behavioral inconsistency between Timeline and Plantings?
 * - YES → UI Store (keep views consistent)
 * - NO → Local useState
 */

interface UIState {
  // Selection state: Set of planting IDs that are currently selected
  // Inspector shows details for selected plantings (same in Timeline and Plantings)
  selectedPlantingIds: Set<string>;

  // Search query: Filters visible plantings (shared across Timeline and Plantings)
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Toast notifications: Global feedback messages
  toast: { message: string; type: 'error' | 'success' | 'info' } | null;
  setToast: (toast: { message: string; type: 'error' | 'success' | 'info' } | null) => void;

  // Actions
  selectPlanting: (id: string) => void;
  deselectPlanting: (id: string) => void;
  togglePlanting: (id: string) => void;
  selectMultiple: (ids: string[]) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;

  // Group selection helpers (for multi-bed plantings with same groupId)
  selectGroup: (groupId: string, plantingIds: string[]) => void;
  deselectGroup: (groupId: string, plantingIds: string[]) => void;
  toggleGroup: (groupId: string, plantingIds: string[]) => void;
  isGroupSelected: (groupId: string, plantingIds: string[]) => boolean;
}

export const useUIStore = create<UIState>((set, get) => ({
  // Selection
  selectedPlantingIds: new Set<string>(),

  selectPlanting: (id: string) =>
    set((state) => ({
      selectedPlantingIds: new Set(state.selectedPlantingIds).add(id),
    })),

  deselectPlanting: (id: string) =>
    set((state) => {
      const next = new Set(state.selectedPlantingIds);
      next.delete(id);
      return { selectedPlantingIds: next };
    }),

  togglePlanting: (id: string) =>
    set((state) => {
      const next = new Set(state.selectedPlantingIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedPlantingIds: next };
    }),

  selectMultiple: (ids: string[]) =>
    set((state) => ({
      selectedPlantingIds: new Set([...state.selectedPlantingIds, ...ids]),
    })),

  clearSelection: () => set({ selectedPlantingIds: new Set<string>() }),

  isSelected: (id: string) => get().selectedPlantingIds.has(id),

  // Group selection: selects/deselects all plantings in a group
  selectGroup: (groupId: string, plantingIds: string[]) =>
    set((state) => ({
      selectedPlantingIds: new Set([...state.selectedPlantingIds, ...plantingIds]),
    })),

  deselectGroup: (groupId: string, plantingIds: string[]) =>
    set((state) => {
      const next = new Set(state.selectedPlantingIds);
      plantingIds.forEach((id) => next.delete(id));
      return { selectedPlantingIds: next };
    }),

  toggleGroup: (groupId: string, plantingIds: string[]) =>
    set((state) => {
      const next = new Set(state.selectedPlantingIds);
      const allSelected = plantingIds.every((id) => next.has(id));

      if (allSelected) {
        // If all are selected, deselect all
        plantingIds.forEach((id) => next.delete(id));
      } else {
        // Otherwise, select all
        plantingIds.forEach((id) => next.add(id));
      }

      return { selectedPlantingIds: next };
    }),

  isGroupSelected: (groupId: string, plantingIds: string[]) => {
    const state = get();
    return plantingIds.length > 0 && plantingIds.every((id) => state.selectedPlantingIds.has(id));
  },

  // Search
  searchQuery: '',
  setSearchQuery: (query: string) => set({ searchQuery: query }),

  // Toast
  toast: null,
  setToast: (toast) => set({ toast }),
}));
