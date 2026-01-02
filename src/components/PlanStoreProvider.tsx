'use client';

import { useEffect, useState } from 'react';
import { initializePlanStore } from '@/lib/plan-store';

interface PlanStoreProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that initializes the plan store on app startup.
 * Sets up cross-tab sync listeners and loads initial data from storage.
 * Must be mounted once near the root of the app (client-side only).
 */
export default function PlanStoreProvider({ children }: PlanStoreProviderProps) {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    initializePlanStore()
      .then(() => setInitialized(true))
      .catch((err) => {
        console.error('Failed to initialize plan store:', err);
        setInitialized(true); // Still render app even if init fails
      });
  }, []);

  // Always render children - store works without initialization,
  // just won't have plan list pre-loaded
  return <>{children}</>;
}
