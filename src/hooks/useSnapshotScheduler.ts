/**
 * Snapshot Scheduler Hook
 *
 * Creates tiered auto-save snapshots on a fixed interval (default 15 minutes).
 * Only creates a snapshot if the plan has changed since the last snapshot.
 *
 * This is separate from the sync system:
 * - Sync: Keeps current state on disk (5s throttle, frequent)
 * - Snapshot: Creates version history (15min interval, for restore)
 *
 * The hook is designed to be easily replaceable - all snapshot logic
 * is contained here, and the API endpoint can be swapped for cloud storage.
 */

import { useEffect, useRef } from 'react';
import type { Plan } from '@/lib/plan-types';

/** Default interval between snapshots (15 minutes) */
const DEFAULT_SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;

/** Minimum interval to prevent accidental rapid snapshots */
const MIN_SNAPSHOT_INTERVAL_MS = 60 * 1000; // 1 minute

interface UseSnapshotSchedulerOptions {
  /** Plan to snapshot */
  plan: Plan | null;
  /** Whether snapshots are enabled (default: true) */
  enabled?: boolean;
  /** Interval between snapshots in ms (default: 15 minutes) */
  intervalMs?: number;
}

/**
 * Creates a hash of the plan for change detection.
 * Excludes metadata.lastModified since it changes on every save.
 */
function hashPlan(plan: Plan): string {
  const { metadata, ...rest } = plan;
  const { lastModified, ...metadataRest } = metadata;
  return JSON.stringify({ ...rest, metadata: metadataRest });
}

/**
 * Hook that schedules periodic snapshots of the plan.
 * Snapshots are only created if the plan has changed since the last one.
 */
export function useSnapshotScheduler({
  plan,
  enabled = true,
  intervalMs = DEFAULT_SNAPSHOT_INTERVAL_MS,
}: UseSnapshotSchedulerOptions): void {
  const lastSnapshotHash = useRef<string | null>(null);
  const safeInterval = Math.max(intervalMs, MIN_SNAPSHOT_INTERVAL_MS);

  useEffect(() => {
    if (!enabled || !plan) return;

    async function maybeSnapshot() {
      if (!plan) return;

      const currentHash = hashPlan(plan);
      if (currentHash === lastSnapshotHash.current) return;

      try {
        const response = await fetch('/api/plans/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: plan.id, plan }),
        });

        if (response.ok) {
          lastSnapshotHash.current = currentHash;
        }
      } catch (e) {
        console.warn('Snapshot failed:', e);
      }
    }

    // Initial snapshot after short delay (avoid snapshot on page load)
    const initialTimeout = setTimeout(maybeSnapshot, 5000);

    // Periodic snapshots
    const intervalId = setInterval(maybeSnapshot, safeInterval);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(intervalId);
    };
  }, [enabled, plan, safeInterval]);

  // Snapshot on unmount if there are unsaved changes
  useEffect(() => {
    const planRef = plan; // Capture for cleanup
    const hashRef = lastSnapshotHash;

    return () => {
      if (planRef && hashRef.current !== hashPlan(planRef)) {
        navigator.sendBeacon?.(
          '/api/plans/snapshot',
          JSON.stringify({ planId: planRef.id, plan: planRef })
        );
      }
    };
  }, [plan]);
}
