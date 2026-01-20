/**
 * SQLite Client Adapter
 *
 * Client-side adapter that calls SQLite API routes.
 * Replaces the IndexedDB adapter for plan storage.
 */

import type { Plan, StashEntry } from './plan-types';

// =============================================================================
// TYPES (matching what storage-adapter.ts exported)
// =============================================================================

/** Plan data (simplified - no more past/future arrays) */
export interface PlanData {
  plan: Plan;
}

/** Summary info for plan list display */
export interface PlanSummary {
  id: string;
  name: string;
  version?: number;
  lastModified: number;
  cropCount: number;
  /** Target year for new plantings */
  year: number;
  /** Schema version of the plan */
  schemaVersion?: number;
}

// =============================================================================
// API CLIENT
// =============================================================================

/**
 * SQLite-backed storage adapter that calls Next.js API routes.
 */
export class SQLiteClientAdapter {
  // ----------------------------------------
  // Plans
  // ----------------------------------------

  async getPlanList(): Promise<PlanSummary[]> {
    try {
      const response = await fetch('/api/sqlite');
      if (!response.ok) {
        console.error('Failed to fetch plan list:', response.statusText);
        return [];
      }
      const data = await response.json();
      return data.plans ?? [];
    } catch (e) {
      console.error('Failed to fetch plan list:', e);
      return [];
    }
  }

  async getPlan(id: string): Promise<PlanData | null> {
    try {
      const response = await fetch(`/api/sqlite/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        console.error('Failed to fetch plan:', response.statusText);
        return null;
      }
      const data = await response.json();
      return { plan: data.plan };
    } catch (e) {
      console.error('Failed to fetch plan:', e);
      return null;
    }
  }

  async savePlan(id: string, data: PlanData): Promise<void> {
    try {
      const response = await fetch(`/api/sqlite/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: data.plan }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save plan');
      }
    } catch (e) {
      console.error('Failed to save plan:', e);
      throw e;
    }
  }

  async deletePlan(id: string): Promise<void> {
    try {
      const response = await fetch(`/api/sqlite/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok && response.status !== 404) {
        throw new Error('Failed to delete plan');
      }
    } catch (e) {
      console.error('Failed to delete plan:', e);
      throw e;
    }
  }

  // ----------------------------------------
  // Stash (kept in localStorage for now - simple key-value)
  // ----------------------------------------

  private readonly STASH_KEY = 'crop-plan-stash';
  private readonly MAX_STASH_ENTRIES = 10;

  async getStash(): Promise<StashEntry[]> {
    try {
      const data = localStorage.getItem(this.STASH_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  async saveToStash(entry: StashEntry): Promise<void> {
    const entries = await this.getStash();
    entries.push(entry);

    // Keep only the last MAX_STASH_ENTRIES
    while (entries.length > this.MAX_STASH_ENTRIES) {
      entries.shift();
    }

    try {
      localStorage.setItem(this.STASH_KEY, JSON.stringify(entries));
    } catch (e) {
      console.warn('Failed to save stash entry:', e);
    }
  }

  async clearStash(): Promise<void> {
    try {
      localStorage.removeItem(this.STASH_KEY);
    } catch (e) {
      console.warn('Failed to clear stash:', e);
    }
  }

  // ----------------------------------------
  // Flags (still use localStorage)
  // ----------------------------------------

  async getFlag(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async setFlag(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn('Failed to set flag:', e);
    }
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

/** Default storage adapter instance (SQLite via API routes) */
export const storage = new SQLiteClientAdapter();

// =============================================================================
// SYNC MESSAGES (stubbed - can add back later if needed)
// =============================================================================

/** Message types for cross-tab communication (future) */
export type SyncMessage =
  | { type: 'plan-updated'; planId: string }
  | { type: 'plan-deleted'; planId: string };

/** Subscribe to sync messages - currently a no-op */
export function onSyncMessage(_callback: (message: SyncMessage) => void): () => void {
  // Cross-tab sync disabled for now - can add back via polling if needed
  return () => {};
}
