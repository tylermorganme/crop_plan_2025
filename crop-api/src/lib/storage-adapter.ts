/**
 * Storage Adapter
 *
 * Abstracts storage operations behind an interface so we can swap
 * localStorage for cloud/database storage later.
 */

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
}

/** Auto-save snapshot */
export interface PlanSnapshot {
  id: string;
  timestamp: number;
  plan: Plan;
}

// ============================================
// Storage Adapter Interface
// ============================================

export interface StorageAdapter {
  // Plans
  getPlanList(): Promise<PlanSummary[]>;
  getPlan(id: string): Promise<PlanData | null>;
  savePlan(id: string, data: PlanData): Promise<void>;
  deletePlan(id: string): Promise<void>;

  // Snapshots (auto-saves)
  getSnapshots(): Promise<PlanSnapshot[]>;
  saveSnapshot(snapshot: PlanSnapshot): Promise<void>;

  // Stash (safety saves before destructive operations)
  getStash(): Promise<StashEntry[]>;
  saveToStash(entry: StashEntry): Promise<void>;
  clearStash(): Promise<void>;

  // Checkpoints (user-created save points)
  getCheckpoints(planId: string): Promise<Checkpoint[]>;
  saveCheckpoint(checkpoint: Checkpoint): Promise<void>;
  deleteCheckpoint(checkpointId: string, planId: string): Promise<void>;

  // Flags (migration markers, settings, etc.)
  getFlag(key: string): Promise<string | null>;
  setFlag(key: string, value: string): Promise<void>;
}

// ============================================
// LocalStorage Adapter Implementation
// ============================================

const PLAN_LIBRARY_PREFIX = 'crop-plan-lib-';
const PLAN_REGISTRY_KEY = 'crop-plan-registry';
const SNAPSHOTS_STORAGE_KEY = 'crop-plan-snapshots';
const STASH_STORAGE_KEY = 'crop-plan-stash';
const CHECKPOINTS_PREFIX = 'crop-plan-checkpoints-';
const MAX_SNAPSHOTS = 32;
const MAX_STASH_ENTRIES = 10;
const MAX_CHECKPOINTS_PER_PLAN = 20;

export class LocalStorageAdapter implements StorageAdapter {
  // ----------------------------------------
  // Plans
  // ----------------------------------------

  async getPlanList(): Promise<PlanSummary[]> {
    try {
      const data = localStorage.getItem(PLAN_REGISTRY_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  async getPlan(id: string): Promise<PlanData | null> {
    const key = PLAN_LIBRARY_PREFIX + id;
    try {
      const data = localStorage.getItem(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (e) {
      console.error('Failed to load plan from storage:', e);
      return null;
    }
  }

  async savePlan(id: string, data: PlanData): Promise<void> {
    const key = PLAN_LIBRARY_PREFIX + id;

    // Save the plan data
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save plan to storage:', e);
      throw new Error('Failed to save plan - storage may be full');
    }

    // Update the registry
    await this.updateRegistry(data.plan);
  }

  async deletePlan(id: string): Promise<void> {
    const key = PLAN_LIBRARY_PREFIX + id;

    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error('Failed to delete plan:', e);
    }

    // Update registry
    const registry = await this.getPlanList();
    const filtered = registry.filter(p => p.id !== id);
    try {
      localStorage.setItem(PLAN_REGISTRY_KEY, JSON.stringify(filtered));
    } catch (e) {
      console.error('Failed to update plan registry:', e);
    }
  }

  private async updateRegistry(plan: Plan): Promise<void> {
    const registry = await this.getPlanList();
    const summary: PlanSummary = {
      id: plan.id,
      name: plan.metadata.name,
      version: plan.metadata.version,
      lastModified: plan.metadata.lastModified,
      cropCount: plan.crops.length,
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
      localStorage.setItem(PLAN_REGISTRY_KEY, JSON.stringify(registry));
    } catch (e) {
      console.error('Failed to update plan registry:', e);
    }
  }

  // ----------------------------------------
  // Snapshots (auto-saves)
  // ----------------------------------------

  async getSnapshots(): Promise<PlanSnapshot[]> {
    try {
      const data = localStorage.getItem(SNAPSHOTS_STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  async saveSnapshot(snapshot: PlanSnapshot): Promise<void> {
    const snapshots = await this.getSnapshots();
    snapshots.push(snapshot);

    // Keep only the last MAX_SNAPSHOTS
    while (snapshots.length > MAX_SNAPSHOTS) {
      snapshots.shift();
    }

    try {
      localStorage.setItem(SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshots));
    } catch (e) {
      console.warn('Failed to save snapshot:', e);
    }
  }

  // ----------------------------------------
  // Stash (safety saves)
  // ----------------------------------------

  async getStash(): Promise<StashEntry[]> {
    try {
      const data = localStorage.getItem(STASH_STORAGE_KEY);
      return data ? JSON.parse(data) : [];
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
      localStorage.setItem(STASH_STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      console.warn('Failed to save stash entry:', e);
    }
  }

  async clearStash(): Promise<void> {
    try {
      localStorage.removeItem(STASH_STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear stash:', e);
    }
  }

  // ----------------------------------------
  // Checkpoints (user-created save points)
  // ----------------------------------------

  async getCheckpoints(planId: string): Promise<Checkpoint[]> {
    const key = CHECKPOINTS_PREFIX + planId;
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    const key = CHECKPOINTS_PREFIX + checkpoint.planId;
    const checkpoints = await this.getCheckpoints(checkpoint.planId);

    // Add new checkpoint at the beginning (most recent first)
    checkpoints.unshift(checkpoint);

    // Keep only the last MAX_CHECKPOINTS_PER_PLAN
    while (checkpoints.length > MAX_CHECKPOINTS_PER_PLAN) {
      checkpoints.pop();
    }

    try {
      localStorage.setItem(key, JSON.stringify(checkpoints));
    } catch (e) {
      console.error('Failed to save checkpoint:', e);
      throw new Error('Failed to save checkpoint - storage may be full');
    }
  }

  async deleteCheckpoint(checkpointId: string, planId: string): Promise<void> {
    const key = CHECKPOINTS_PREFIX + planId;
    const checkpoints = await this.getCheckpoints(planId);
    const filtered = checkpoints.filter(c => c.id !== checkpointId);

    try {
      localStorage.setItem(key, JSON.stringify(filtered));
    } catch (e) {
      console.warn('Failed to delete checkpoint:', e);
    }
  }

  // ----------------------------------------
  // Flags
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

// ============================================
// Singleton Instance
// ============================================

/** Default storage adapter instance */
export const storage = new LocalStorageAdapter();

// ============================================
// Helpers
// ============================================

/** Get the localStorage key for a plan (used by cross-tab sync) */
export function getPlanStorageKey(planId: string): string {
  return PLAN_LIBRARY_PREFIX + planId;
}
