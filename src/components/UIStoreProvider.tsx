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

    console.log('[UIStoreProvider] 🔄 VERSIONED CODE - Initializing with versioning support');

    // Listen for sync messages from other tabs
    const unsubscribe = onUIStoreSyncMessage((message) => {
      const currentVersion = useUIStore.getState().version;

      console.log('[UIStoreProvider] received message:', {
        type: message.type,
        messageVersion: message.version,
        currentVersion,
        messageTabId: message.tabId,
        localTabId: TAB_ID,
        isOwnMessage: message.tabId === TAB_ID,
        isNewer: message.version > currentVersion
      });

      // Ignore messages from this tab (echo prevention)
      if (message.tabId === TAB_ID) {
        console.log('[UIStoreProvider] ✓ ignoring own broadcast:', message.type);
        return;
      }

      // Only apply updates with newer version (prevents out-of-order updates)
      if (message.version <= currentVersion) {
        console.log('[UIStoreProvider] ✗ rejecting stale message: version', message.version, '≤', currentVersion);
        return;
      }

      console.log('[UIStoreProvider] ✓ applying message from different tab (newer version)');

      // Update store based on message type
      // Using setState directly bypasses actions, so no broadcast loop
      if (message.type === 'selection-changed') {
        console.log('[UIStoreProvider] applying selection-changed:', message.selectedIds.length, 'IDs');
        useUIStore.setState({
          selectedPlantingIds: new Set(message.selectedIds),
          version: message.version,
        });
      } else if (message.type === 'search-changed') {
        console.log('[UIStoreProvider] applying search-changed:', message.query);
        useUIStore.setState({
          searchQuery: message.query,
          version: message.version,
        });
      } else if (message.type === 'toast-changed') {
        console.log('[UIStoreProvider] applying toast-changed:', message.toast);
        useUIStore.setState({
          toast: message.toast,
          version: message.version,
        });
      }
    });

    return unsubscribe;
  }, []);

  return <>{children}</>;
}
