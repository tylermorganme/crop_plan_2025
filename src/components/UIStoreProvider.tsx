'use client';

import { useEffect } from 'react';
import { useUIStore, onUIStoreSyncMessage, TAB_ID } from '@/lib/ui-store';

interface UIStoreProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that sets up cross-tab sync for UI state.
 * Listens for sync messages from other tabs and updates local store.
 * Actions in ui-store.ts handle broadcasting (prevents infinite loops).
 * Must be mounted once near the root of the app (client-side only).
 */
export default function UIStoreProvider({ children }: UIStoreProviderProps) {
  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return;

    // Listen for sync messages from other tabs
    const unsubscribe = onUIStoreSyncMessage((message) => {
      // Ignore messages from this tab (echo prevention)
      if (message.tabId === TAB_ID) {
        return;
      }

      // Update store based on message type
      // Using setState directly bypasses actions, so no broadcast loop
      if (message.type === 'selection-changed') {
        useUIStore.setState({
          selectedPlantingIds: new Set(message.selectedIds),
        });
      } else if (message.type === 'search-changed') {
        useUIStore.setState({
          searchQuery: message.query,
        });
      } else if (message.type === 'toast-changed') {
        useUIStore.setState({
          toast: message.toast,
        });
      } else if (message.type === 'edit-mode-changed') {
        useUIStore.setState({
          isEditMode: message.isEditMode,
        });
      }
    });

    return unsubscribe;
  }, []);

  return <>{children}</>;
}
