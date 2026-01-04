/**
 * Storage Adapter
 *
 * Abstracts storage operations behind an interface.
 * Uses IndexedDB via localForage for larger storage capacity (~50MB+)
 * and better performance than localStorage.
 *
 * Also syncs to file storage (data/plans/) for durability.
 */

import localforage from 'localforage';

// ============================================
// File Sync (Background, Throttled)
// ============================================

/** Minimum interval between file syncs (5 seconds) */
const SYNC_THROTTLE_MS = 5000;

/** Track last sync time per plan */
const lastSyncTime = new Map<string, number>();

/** Pending sync data (for coalescing rapid saves) */
const pendingSync = new Map<string, PlanData>();

/** Active sync timeout */
let syncTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Sync plan to file storage in background.
 * Throttled to avoid excessive writes - coalesces rapid saves.
 */
function syncToFile(planId: string, data: PlanData): void {
  // Store latest data (overwrites any pending)
  pendingSync.set(planId, data);

  // If already scheduled, let it handle this
  if (syncTimeout) return;

  const lastSync = lastSyncTime.get(planId) ?? 0;
  const elapsed = Date.now() - lastSync;
  const delay = Math.max(0, SYNC_THROTTLE_MS - elapsed);

  syncTimeout = setTimeout(async () => {
    syncTimeout = null;

    // Flush all pending syncs
    for (const [id, planData] of pendingSync) {
      try {
        const response = await fetch('/api/plans/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: id, data: planData }),
        });
        if (response.ok) {
          lastSyncTime.set(id, Date.now());
        } else {
          console.warn('File sync failed:', await response.text());
        }
      } catch (e) {
        console.warn('File sync error:', e);
      }
    }
    pendingSync.clear();
  }, delay);
}
import type {
  Plan,
  TimelineCrop,
  StashEntry,
  Checkpoint,
} from './plan-types';

// ============================================
// Types
// ============================================

/** Plan data with undo/redo history */
export interface PlanData {
  plan: Plan;
  past: TimelineCrop[][];
  future: TimelineCrop[][];
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
}

/** Auto-save snapshot */
export interface PlanSnapshot {
  id: string;
  timestamp: number;
  plan: Plan;
}

// ============================================
// Storage Adapter Interfaces
// ============================================

/**
 * Core plan storage - used by IndexedDB for fast client-side storage
 */
export interface PlanStorageAdapter {
  // Plans
  getPlanList(): Promise<PlanSummary[]>;
  getPlan(id: string): Promise<PlanData | null>;
  savePlan(id: string, data: PlanData): Promise<void>;
  deletePlan(id: string): Promise<void>;

  // Stash (safety saves before destructive operations)
  getStash(): Promise<StashEntry[]>;
  saveToStash(entry: StashEntry): Promise<void>;
  clearStash(): Promise<void>;

  // Flags (migration markers, settings, etc.)
  getFlag(key: string): Promise<string | null>;
  setFlag(key: string, value: string): Promise<void>;
}

/**
 * Full storage adapter - used by file storage for durable history
 */
export interface StorageAdapter extends PlanStorageAdapter {
  // Snapshots (auto-saves)
  getSnapshots(): Promise<PlanSnapshot[]>;
  saveSnapshot(snapshot: PlanSnapshot): Promise<void>;

  // Checkpoints (user-created save points)
  getCheckpoints(planId: string): Promise<Checkpoint[]>;
  saveCheckpoint(checkpoint: Checkpoint): Promise<void>;
  deleteCheckpoint(checkpointId: string, planId: string): Promise<void>;
}

// ============================================
// Storage Keys
// ============================================

const PLAN_LIBRARY_PREFIX = 'crop-plan-lib-';
const PLAN_REGISTRY_KEY = 'crop-plan-registry';
const STASH_STORAGE_KEY = 'crop-plan-stash';
const MAX_STASH_ENTRIES = 10;

// ============================================
// Cross-Tab Sync via BroadcastChannel
// ============================================

const SYNC_CHANNEL_NAME = 'crop-plan-sync';

/** Message types for cross-tab communication */
export type SyncMessage =
  | { type: 'plan-updated'; planId: string }
  | { type: 'plan-deleted'; planId: string };

/** BroadcastChannel for cross-tab sync (IndexedDB doesn't fire storage events) */
let syncChannel: BroadcastChannel | null = null;

/** Get or create the sync channel */
function getSyncChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (!syncChannel) {
    try {
      syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    } catch {
      // BroadcastChannel not supported (e.g., older browsers)
      console.warn('BroadcastChannel not supported, cross-tab sync disabled');
    }
  }
  return syncChannel;
}

/** Broadcast a sync message to other tabs */
function broadcastSync(message: SyncMessage): void {
  getSyncChannel()?.postMessage(message);
}

/** Subscribe to sync messages from other tabs */
export function onSyncMessage(callback: (message: SyncMessage) => void): () => void {
  const channel = getSyncChannel();
  if (!channel) return () => {};

  const handler = (event: MessageEvent<SyncMessage>) => callback(event.data);
  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}

// ============================================
// IndexedDB Adapter Implementation (via localForage)
// ============================================

// Configure localForage
localforage.config({
  name: 'CropPlanner',
  storeName: 'plans',
  description: 'Crop planning data storage',
});

export class IndexedDBAdapter implements PlanStorageAdapter {
  // ----------------------------------------
  // Plans
  // ----------------------------------------

  async getPlanList(): Promise<PlanSummary[]> {
    try {
      const data = await localforage.getItem<PlanSummary[]>(PLAN_REGISTRY_KEY);
      return data ?? [];
    } catch {
      return [];
    }
  }

  async getPlan(id: string): Promise<PlanData | null> {
    const key = PLAN_LIBRARY_PREFIX + id;
    try {
      const data = await localforage.getItem<PlanData>(key);
      return data ?? null;
    } catch (e) {
      console.error('Failed to load plan from storage:', e);
      return null;
    }
  }

  async savePlan(id: string, data: PlanData): Promise<void> {
    const key = PLAN_LIBRARY_PREFIX + id;

    // Save the plan data
    try {
      await localforage.setItem(key, data);
    } catch (e) {
      console.error('Failed to save plan to storage:', e);
      throw new Error('Failed to save plan - storage may be full');
    }

    // Update the registry
    await this.updateRegistry(data.plan);

    // Notify other tabs
    broadcastSync({ type: 'plan-updated', planId: id });

    // Sync to file storage in background (non-blocking)
    syncToFile(id, data);
  }

  async deletePlan(id: string): Promise<void> {
    const key = PLAN_LIBRARY_PREFIX + id;

    try {
      await localforage.removeItem(key);
    } catch (e) {
      console.error('Failed to delete plan:', e);
    }

    // Update registry
    const registry = await this.getPlanList();
    const filtered = registry.filter(p => p.id !== id);
    try {
      await localforage.setItem(PLAN_REGISTRY_KEY, filtered);
    } catch (e) {
      console.error('Failed to update plan registry:', e);
    }

    // Notify other tabs
    broadcastSync({ type: 'plan-deleted', planId: id });
  }

  private async updateRegistry(plan: Plan): Promise<void> {
    const registry = await this.getPlanList();
    const summary: PlanSummary = {
      id: plan.id,
      name: plan.metadata.name,
      version: plan.metadata.version,
      lastModified: plan.metadata.lastModified,
      cropCount: plan.plantings?.length ?? 0,
      year: plan.metadata.year ?? new Date().getFullYear(),
    };

    const existingIndex = registry.findIndex(p => p.id === plan.id);
    if (existingIndex >= 0) {
      registry[existingIndex] = summary;
    } else {
      registry.push(summary);
    }

    // Sort by lastModified descending
    registry.sort((a, b) => b.lastModified - a.lastModified);

    try {
      await localforage.setItem(PLAN_REGISTRY_KEY, registry);
    } catch (e) {
      console.error('Failed to update plan registry:', e);
    }
  }

  // ----------------------------------------
  // Stash (safety saves)
  // ----------------------------------------

  async getStash(): Promise<StashEntry[]> {
    try {
      const data = await localforage.getItem<StashEntry[]>(STASH_STORAGE_KEY);
      return data ?? [];
    } catch {
      return [];
    }
  }

  async saveToStash(entry: StashEntry): Promise<void> {
    const entries = await this.getStash();
    entries.push(entry);

    // Keep only the last MAX_STASH_ENTRIES
    while (entries.length > MAX_STASH_ENTRIES) {
      entries.shift();
    }

    try {
      await localforage.setItem(STASH_STORAGE_KEY, entries);
    } catch (e) {
      console.warn('Failed to save stash entry:', e);
    }
  }

  async clearStash(): Promise<void> {
    try {
      await localforage.removeItem(STASH_STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear stash:', e);
    }
  }

  // ----------------------------------------
  // Flags (still use localStorage for simple key-value flags)
  // ----------------------------------------

  async getFlag(key: string): Promise<string | null> {
    try {
      // Flags use localStorage for simplicity (small values, need sync access sometimes)
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

// ============================================
// Singleton Instance
// ============================================

/** Default storage adapter instance (IndexedDB via localForage) */
export const storage = new IndexedDBAdapter();

// ============================================
// Helpers
// ============================================

/** Get the storage key for a plan (used for identifying plan updates) */
export function getPlanStorageKey(planId: string): string {
  return PLAN_LIBRARY_PREFIX + planId;
}
