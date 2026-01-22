'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/lib/ui-store';

interface UIStoreProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that sets up cross-tab sync for UI state.
 * Uses BroadcastChannel to sync selection, search, and toast state across browser tabs.
 * Must be mounted once near the root of the app (client-side only).
 */
export default function UIStoreProvider({ children }: UIStoreProviderProps) {
  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return;

    const channel = new BroadcastChannel('ui-store-sync');

    // Subscribe to zustand store changes
    const unsubscribe = useUIStore.subscribe((state) => {
      // Broadcast entire state to other tabs
      channel.postMessage({
        type: 'STATE_UPDATE',
        state: {
          selectedPlantingIds: Array.from(state.selectedPlantingIds),
          searchQuery: state.searchQuery,
          toast: state.toast,
        },
      });
    });

    // Listen for updates from other tabs
    channel.onmessage = (event) => {
      if (event.data.type === 'STATE_UPDATE') {
        const { state: newState } = event.data;

        // Update store with state from other tab
        useUIStore.setState({
          selectedPlantingIds: new Set(newState.selectedPlantingIds),
          searchQuery: newState.searchQuery,
          toast: newState.toast,
        });
      }
    };

    return () => {
      unsubscribe();
      channel.close();
    };
  }, []);

  return <>{children}</>;
}
