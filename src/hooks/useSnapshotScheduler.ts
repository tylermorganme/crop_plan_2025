/**
 * Snapshot Scheduler Hook
 *
 * Previously created tiered auto-save snapshots.
 * Now a no-op - SQLite storage handles persistence directly.
 *
 * TODO: Re-implement for creating periodic patch snapshots if needed.
 */

import type { Plan } from '@/lib/plan-types';

interface UseSnapshotSchedulerOptions {
  /** Plan to snapshot */
  plan: Plan | null;
  /** Whether snapshots are enabled (default: true) */
  enabled?: boolean;
  /** Interval between snapshots in ms (default: 15 minutes) */
  intervalMs?: number;
}

/**
 * Hook that previously scheduled periodic snapshots.
 * Now a no-op - SQLite storage handles persistence directly.
 */
export function useSnapshotScheduler(_options: UseSnapshotSchedulerOptions): void {
  // No-op - SQLite storage handles persistence directly
  // Patches provide undo/time-travel without needing periodic snapshots
}
