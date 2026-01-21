/**
 * SQLite Client Adapter
 *
 * Client-side adapter that calls SQLite API routes.
 * Replaces the IndexedDB adapter for plan storage.
 */

import type { Plan, PatchEntry } from './plan-types';

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
  createdAt: number;
  lastModified: number;
  cropCount: number;
  /** Target year for new plantings */
  year: number;
  /** Schema version of the plan */
  schemaVersion?: number;
  /** Optional notes about this plan */
  notes?: string;
}

/** Checkpoint metadata */
export interface CheckpointInfo {
  id: string;
  name: string;
  createdAt: number;
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
  // Patches
  // ----------------------------------------

  /**
   * Append a patch entry to the plan's patch history.
   * Fire-and-forget: returns null on error instead of throwing.
   */
  async appendPatch(planId: string, entry: PatchEntry): Promise<number | null> {
    try {
      const response = await fetch(`/api/sqlite/${planId}/patches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: entry }),
      });
      if (!response.ok) {
        console.warn('Failed to append patch:', response.statusText);
        return null;
      }
      const data = await response.json();
      return data.id ?? null;
    } catch (e) {
      console.warn('Failed to append patch:', e);
      return null;
    }
  }

  /**
   * Get all patches for a plan.
   * Returns empty array on error.
   */
  async getPatches(planId: string): Promise<PatchEntry[]> {
    try {
      const response = await fetch(`/api/sqlite/${planId}/patches`);
      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        console.warn('Failed to get patches:', response.statusText);
        return [];
      }
      const data = await response.json();
      return data.patches ?? [];
    } catch (e) {
      console.warn('Failed to get patches:', e);
      return [];
    }
  }

  /**
   * Clear all patches for a plan.
   * Used when starting a fresh session or clearing history.
   */
  async clearPatches(planId: string): Promise<void> {
    try {
      await fetch(`/api/sqlite/${planId}/patches`, { method: 'DELETE' });
    } catch (e) {
      console.warn('Failed to clear patches:', e);
    }
  }

  // ----------------------------------------
  // Undo/Redo (server-side operations)
  // ----------------------------------------

  /**
   * Perform undo operation.
   * Server pops from patches, applies inverse, pushes to redo stack.
   * Returns the restored plan state.
   */
  async undo(planId: string): Promise<{ ok: boolean; plan: Plan | null; canUndo: boolean; canRedo: boolean; description?: string }> {
    try {
      const response = await fetch(`/api/sqlite/${planId}/undo`, {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.warn('Undo failed:', data.error || response.statusText);
        return { ok: false, plan: null, canUndo: false, canRedo: false };
      }
      const data = await response.json();
      return {
        ok: true,
        plan: data.plan,
        canUndo: data.canUndo,
        canRedo: data.canRedo,
        description: data.description,
      };
    } catch (e) {
      console.error('Undo failed:', e);
      return { ok: false, plan: null, canUndo: false, canRedo: false };
    }
  }

  /**
   * Perform redo operation.
   * Server pops from redo stack, applies forward patches, pushes back to patches.
   * Returns the restored plan state.
   */
  async redo(planId: string): Promise<{ ok: boolean; plan: Plan | null; canUndo: boolean; canRedo: boolean; description?: string }> {
    try {
      const response = await fetch(`/api/sqlite/${planId}/redo`, {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.warn('Redo failed:', data.error || response.statusText);
        return { ok: false, plan: null, canUndo: false, canRedo: false };
      }
      const data = await response.json();
      return {
        ok: true,
        plan: data.plan,
        canUndo: data.canUndo,
        canRedo: data.canRedo,
        description: data.description,
      };
    } catch (e) {
      console.error('Redo failed:', e);
      return { ok: false, plan: null, canUndo: false, canRedo: false };
    }
  }

  /**
   * Get undo/redo counts for a plan.
   * Returns { undoCount, redoCount } for checking if operations are available.
   */
  async getUndoRedoCounts(planId: string): Promise<{ undoCount: number; redoCount: number }> {
    try {
      const response = await fetch(`/api/sqlite/${planId}/undo-redo-counts`);
      if (!response.ok) {
        return { undoCount: 0, redoCount: 0 };
      }
      const data = await response.json();
      return { undoCount: data.undoCount ?? 0, redoCount: data.redoCount ?? 0 };
    } catch (e) {
      console.warn('Failed to get undo/redo counts:', e);
      return { undoCount: 0, redoCount: 0 };
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

  // ----------------------------------------
  // Checkpoints
  // ----------------------------------------

  /**
   * Create a checkpoint (full database copy).
   * Returns the checkpoint ID.
   */
  async createCheckpoint(planId: string, name: string): Promise<string | null> {
    try {
      const response = await fetch(`/api/sqlite/${planId}/checkpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.warn('Failed to create checkpoint:', data.error || response.statusText);
        return null;
      }
      const data = await response.json();
      return data.checkpointId ?? null;
    } catch (e) {
      console.error('Failed to create checkpoint:', e);
      return null;
    }
  }

  /**
   * List all checkpoints for a plan.
   */
  async listCheckpoints(planId: string): Promise<CheckpointInfo[]> {
    try {
      const response = await fetch(`/api/sqlite/${planId}/checkpoints`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return data.checkpoints ?? [];
    } catch (e) {
      console.warn('Failed to list checkpoints:', e);
      return [];
    }
  }

  /**
   * Restore a checkpoint (overwrites current plan).
   * Returns the restored plan.
   */
  async restoreCheckpoint(planId: string, checkpointId: string): Promise<Plan | null> {
    try {
      const response = await fetch(`/api/sqlite/${planId}/checkpoints/${checkpointId}/restore`, {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.warn('Failed to restore checkpoint:', data.error || response.statusText);
        return null;
      }
      const data = await response.json();
      return data.plan ?? null;
    } catch (e) {
      console.error('Failed to restore checkpoint:', e);
      return null;
    }
  }

  /**
   * Delete a checkpoint.
   */
  async deleteCheckpoint(planId: string, checkpointId: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/sqlite/${planId}/checkpoints/${checkpointId}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch (e) {
      console.warn('Failed to delete checkpoint:', e);
      return false;
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
