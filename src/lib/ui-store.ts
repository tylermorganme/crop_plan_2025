import { create } from 'zustand';

// ============================================
// Cross-Tab Sync via BroadcastChannel
// ============================================

const SYNC_CHANNEL_NAME = 'ui-store-sync';
const TAB_ID_KEY = 'ui-store-tab-id';
const SEARCH_QUERY_KEY = 'ui-store-search-query';
const EDIT_MODE_KEY = 'ui-store-edit-mode';

/** Load persisted search query from localStorage */
function loadPersistedSearchQuery(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(SEARCH_QUERY_KEY) || '';
  } catch {
    return '';
  }
}

/** Save search query to localStorage */
function saveSearchQuery(query: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (query) {
      localStorage.setItem(SEARCH_QUERY_KEY, query);
    } else {
      localStorage.removeItem(SEARCH_QUERY_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

/** Load persisted edit mode from localStorage */
function loadPersistedEditMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(EDIT_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Save edit mode to localStorage */
function saveEditMode(isEditMode: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (isEditMode) {
      localStorage.setItem(EDIT_MODE_KEY, 'true');
    } else {
      localStorage.removeItem(EDIT_MODE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Unique ID for this tab (to filter out own broadcasts).
 * Persisted in sessionStorage to survive Fast Refresh during development.
 */
export const TAB_ID = (() => {
  if (typeof window === 'undefined') return null;

  // Try to get existing tab ID from sessionStorage
  let tabId = sessionStorage.getItem(TAB_ID_KEY);

  // Generate new one if it doesn't exist
  if (!tabId) {
    tabId = `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem(TAB_ID_KEY, tabId);
  }

  return tabId;
})();

/** Message types for cross-tab UI state sync */
export type UIStoreSyncMessage =
  | { type: 'selection-changed'; selectedIds: string[]; tabId: string }
  | { type: 'search-changed'; query: string; tabId: string }
  | { type: 'toast-changed'; toast: { message: string; type: 'error' | 'success' | 'info' } | null; tabId: string }
  | { type: 'edit-mode-changed'; isEditMode: boolean; tabId: string };

/** BroadcastChannel for cross-tab sync */
let syncChannel: BroadcastChannel | null = null;

/** Track if we already have a listener registered (prevent duplicates from Fast Refresh) */
let listenerRegistered = false;

/** Get or create the sync channel */
function getSyncChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (!syncChannel) {
    try {
      syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    } catch {
      console.warn('BroadcastChannel not supported, cross-tab UI sync disabled');
    }
  }
  return syncChannel;
}

/** Broadcast a sync message to other tabs (includes tab ID) */
function broadcastUISync(message: { type: 'selection-changed'; selectedIds: string[] } | { type: 'search-changed'; query: string } | { type: 'toast-changed'; toast: { message: string; type: 'error' | 'success' | 'info' } | null } | { type: 'edit-mode-changed'; isEditMode: boolean }): void {
  if (!TAB_ID) return;
  const fullMessage = { ...message, tabId: TAB_ID } as UIStoreSyncMessage;
  getSyncChannel()?.postMessage(fullMessage);
}

/** Subscribe to sync messages from other tabs */
export function onUIStoreSyncMessage(callback: (message: UIStoreSyncMessage) => void): () => void {
  const channel = getSyncChannel();
  if (!channel || listenerRegistered) {
    return () => {};
  }

  listenerRegistered = true;
  const handler = (event: MessageEvent<UIStoreSyncMessage>) => callback(event.data);
  channel.addEventListener('message', handler);

  return () => {
    listenerRegistered = false;
    channel.removeEventListener('message', handler);
  };
}

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

  // Edit mode: Whether inline editing is enabled (shared across views)
  isEditMode: boolean;
  setIsEditMode: (isEditMode: boolean) => void;
  toggleEditMode: () => void;

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

  selectPlanting: (id: string) => {
    let newIds: string[];
    set((state) => {
      const next = new Set(state.selectedPlantingIds).add(id);
      newIds = Array.from(next);
      return { selectedPlantingIds: next };
    });
    broadcastUISync({ type: 'selection-changed', selectedIds: newIds! });
  },

  deselectPlanting: (id: string) => {
    let newIds: string[];
    set((state) => {
      const next = new Set(state.selectedPlantingIds);
      next.delete(id);
      newIds = Array.from(next);
      return { selectedPlantingIds: next };
    });
    broadcastUISync({ type: 'selection-changed', selectedIds: newIds! });
  },

  togglePlanting: (id: string) => {
    let newIds: string[];
    set((state) => {
      const next = new Set(state.selectedPlantingIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      newIds = Array.from(next);
      return { selectedPlantingIds: next };
    });
    broadcastUISync({ type: 'selection-changed', selectedIds: newIds! });
  },

  selectMultiple: (ids: string[]) => {
    let newIds: string[];
    set((state) => {
      const next = new Set([...state.selectedPlantingIds, ...ids]);
      newIds = Array.from(next);
      return { selectedPlantingIds: next };
    });
    broadcastUISync({ type: 'selection-changed', selectedIds: newIds! });
  },

  clearSelection: () => {
    set({ selectedPlantingIds: new Set<string>() });
    broadcastUISync({ type: 'selection-changed', selectedIds: [] });
  },

  isSelected: (id: string) => get().selectedPlantingIds.has(id),

  // Group selection: selects/deselects all plantings in a group
  selectGroup: (_groupId: string, plantingIds: string[]) => {
    let newIds: string[];
    set((state) => {
      const next = new Set([...state.selectedPlantingIds, ...plantingIds]);
      newIds = Array.from(next);
      return { selectedPlantingIds: next };
    });
    broadcastUISync({ type: 'selection-changed', selectedIds: newIds! });
  },

  deselectGroup: (_groupId: string, plantingIds: string[]) => {
    let newIds: string[];
    set((state) => {
      const next = new Set(state.selectedPlantingIds);
      plantingIds.forEach((id) => next.delete(id));
      newIds = Array.from(next);
      return { selectedPlantingIds: next };
    });
    broadcastUISync({ type: 'selection-changed', selectedIds: newIds! });
  },

  toggleGroup: (_groupId: string, plantingIds: string[]) => {
    let newIds: string[];
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

      newIds = Array.from(next);
      return { selectedPlantingIds: next };
    });
    broadcastUISync({ type: 'selection-changed', selectedIds: newIds! });
  },

  isGroupSelected: (_groupId: string, plantingIds: string[]) => {
    const state = get();
    return plantingIds.length > 0 && plantingIds.every((id) => state.selectedPlantingIds.has(id));
  },

  // Search - persisted to localStorage
  searchQuery: loadPersistedSearchQuery(),
  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
    saveSearchQuery(query);
    broadcastUISync({ type: 'search-changed', query });
  },

  // Edit mode - persisted to localStorage
  isEditMode: loadPersistedEditMode(),
  setIsEditMode: (isEditMode: boolean) => {
    set({ isEditMode });
    saveEditMode(isEditMode);
    broadcastUISync({ type: 'edit-mode-changed', isEditMode });
  },
  toggleEditMode: () => {
    const isEditMode = !get().isEditMode;
    set({ isEditMode });
    saveEditMode(isEditMode);
    broadcastUISync({ type: 'edit-mode-changed', isEditMode });
  },

  // Toast
  toast: null,
  setToast: (toast) => {
    set({ toast });
    broadcastUISync({ type: 'toast-changed', toast });
  },
}));
