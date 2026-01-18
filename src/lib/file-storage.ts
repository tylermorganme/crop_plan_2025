/**
 * File-based Storage Backend
 *
 * Simple file storage for plans. Designed to be easily swappable
 * with cloud storage (R2, S3, Supabase, etc.) later.
 *
 * Storage layout:
 *   data/plans/
 *     {planId}.json              - Current plan state
 *     {planId}.snapshots.json.gz - Tiered auto-save history (gzipped)
 *     {planId}.checkpoints.json  - User checkpoints
 *   data/plans/stash.json        - Safety saves
 *   data/plans/registry.json     - Plan index
 *
 * Tiered snapshot retention:
 *   - 32 × 15-minute snapshots (8 hours of granular history)
 *   - 14 × daily snapshots (2 weeks)
 *   - 8 × weekly snapshots (2 months)
 *   - 12 × monthly snapshots (1 year)
 *
 * Total: ~66 snapshots × ~25KB gzipped = ~1.6MB per plan
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { gzipSync, gunzipSync } from 'zlib';
import { join } from 'path';
import type { PlanData, PlanSummary, PlanSnapshot, StorageAdapter } from './storage-adapter';
import type { StashEntry, Checkpoint } from './plan-types';

// ============================================
// Tiered Snapshot Retention Policy
// ============================================

interface TieredSnapshot extends PlanSnapshot {
  tier: 'minute' | 'daily' | 'weekly' | 'monthly';
}

const RETENTION = {
  minute: { count: 32, intervalMs: 15 * 60 * 1000 },      // 15 minutes
  daily:  { count: 14, intervalMs: 24 * 60 * 60 * 1000 }, // 1 day
  weekly: { count: 8,  intervalMs: 7 * 24 * 60 * 60 * 1000 }, // 1 week
  monthly:{ count: 12, intervalMs: 30 * 24 * 60 * 60 * 1000 }, // ~1 month
} as const;

type Tier = keyof typeof RETENTION;
const TIERS: Tier[] = ['minute', 'daily', 'weekly', 'monthly'];

/**
 * Apply tiered retention policy to snapshots.
 * Promotes older snapshots to higher tiers and prunes excess.
 */
function applyRetentionPolicy(snapshots: TieredSnapshot[]): TieredSnapshot[] {
  const now = Date.now();
  const result: TieredSnapshot[] = [];

  // Group by tier
  const byTier: Record<Tier, TieredSnapshot[]> = {
    minute: [],
    daily: [],
    weekly: [],
    monthly: [],
  };

  for (const snap of snapshots) {
    byTier[snap.tier].push(snap);
  }

  // Process each tier
  for (const tier of TIERS) {
    const { count, intervalMs } = RETENTION[tier];
    const tierSnapshots = byTier[tier].sort((a, b) => b.timestamp - a.timestamp);

    // Keep only the most recent per interval slot, up to count
    const kept: TieredSnapshot[] = [];
    let lastSlot = -1;

    for (const snap of tierSnapshots) {
      const age = now - snap.timestamp;
      const slot = Math.floor(age / intervalMs);

      if (slot !== lastSlot && kept.length < count) {
        kept.push(snap);
        lastSlot = slot;
      }
    }

    result.push(...kept);

    // Promote oldest to next tier if it's old enough
    if (tier !== 'monthly' && tierSnapshots.length > 0) {
      const nextTier = TIERS[TIERS.indexOf(tier) + 1];
      const nextInterval = RETENTION[nextTier].intervalMs;

      for (const snap of tierSnapshots) {
        const age = now - snap.timestamp;
        if (age >= nextInterval && !kept.includes(snap)) {
          // Promote to next tier
          snap.tier = nextTier;
          byTier[nextTier].push(snap);
        }
      }
    }
  }

  return result.sort((a, b) => b.timestamp - a.timestamp);
}

// Base directory for plan storage
const PLANS_DIR = join(process.cwd(), 'data', 'plans');

// Ensure directory exists
function ensureDir() {
  if (!existsSync(PLANS_DIR)) {
    mkdirSync(PLANS_DIR, { recursive: true });
  }
}

// Helper to read JSON file safely
function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

// Helper to write JSON file
function writeJson(path: string, data: unknown): void {
  ensureDir();
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

// File paths
const registryPath = () => join(PLANS_DIR, 'registry.json');
const planPath = (id: string) => join(PLANS_DIR, `${id}.json.gz`);
const snapshotsPath = (id: string) => join(PLANS_DIR, `${id}.snapshots.json.gz`);
const checkpointsPath = (id: string) => join(PLANS_DIR, `${id}.checkpoints.json`);
const stashPath = () => join(PLANS_DIR, 'stash.json');
const flagsPath = () => join(PLANS_DIR, 'flags.json');

// Helper to read gzipped JSON
function readGzippedJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    const compressed = readFileSync(path);
    const json = gunzipSync(compressed).toString('utf-8');
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

// Helper to write gzipped JSON
function writeGzippedJson(path: string, data: unknown): void {
  ensureDir();
  const json = JSON.stringify(data);
  const compressed = gzipSync(json);
  writeFileSync(path, compressed);
}

// ============================================
// Registry (Plan Index)
// ============================================

interface Registry {
  plans: PlanSummary[];
}

function getRegistry(): Registry {
  return readJson(registryPath(), { plans: [] });
}

function saveRegistry(registry: Registry): void {
  writeJson(registryPath(), registry);
}

function updateRegistry(summary: PlanSummary): void {
  const registry = getRegistry();
  const index = registry.plans.findIndex(p => p.id === summary.id);
  if (index >= 0) {
    registry.plans[index] = summary;
  } else {
    registry.plans.push(summary);
  }
  saveRegistry(registry);
}

function removeFromRegistry(id: string): void {
  const registry = getRegistry();
  registry.plans = registry.plans.filter(p => p.id !== id);
  saveRegistry(registry);
}

// ============================================
// File Storage Implementation
// ============================================

export const fileStorage: StorageAdapter = {
  // Plans
  async getPlanList(): Promise<PlanSummary[]> {
    return getRegistry().plans;
  },

  async getPlan(id: string): Promise<PlanData | null> {
    const path = planPath(id);
    if (!existsSync(path)) return null;
    return readGzippedJson<PlanData | null>(path, null);
  },

  async savePlan(id: string, data: PlanData): Promise<void> {
    // Save as gzipped (fast compression for minimal overhead)
    ensureDir();
    const json = JSON.stringify(data);
    const compressed = gzipSync(json, { level: 1 }); // fast compression
    writeFileSync(planPath(id), compressed);

    // Update registry
    const summary: PlanSummary = {
      id,
      name: data.plan.metadata?.name ?? 'Untitled',
      version: data.plan.metadata?.version,
      lastModified: data.plan.metadata?.lastModified ?? Date.now(),
      cropCount: data.plan.plantings?.length ?? 0,
      year: data.plan.metadata?.year ?? new Date().getFullYear(),
    };
    updateRegistry(summary);
  },

  async deletePlan(id: string): Promise<void> {
    const path = planPath(id);
    if (existsSync(path)) unlinkSync(path);

    // Also delete associated files
    const snap = snapshotsPath(id);
    if (existsSync(snap)) unlinkSync(snap);

    const cp = checkpointsPath(id);
    if (existsSync(cp)) unlinkSync(cp);

    removeFromRegistry(id);
  },

  // Snapshots (tiered, gzipped)
  async getSnapshots(): Promise<PlanSnapshot[]> {
    // Return all snapshots across all plans
    ensureDir();
    const files = readdirSync(PLANS_DIR).filter(f => f.endsWith('.snapshots.json.gz'));
    const allSnapshots: PlanSnapshot[] = [];
    for (const file of files) {
      const snapshots = readGzippedJson<TieredSnapshot[]>(join(PLANS_DIR, file), []);
      allSnapshots.push(...snapshots);
    }
    return allSnapshots.sort((a, b) => b.timestamp - a.timestamp);
  },

  async saveSnapshot(snapshot: PlanSnapshot): Promise<void> {
    const planId = snapshot.plan.id;
    const path = snapshotsPath(planId);
    const existing = readGzippedJson<TieredSnapshot[]>(path, []);

    // Create tiered snapshot (new ones start as 'minute' tier)
    const tieredSnapshot: TieredSnapshot = {
      ...snapshot,
      tier: 'minute',
    };

    // Add new snapshot
    existing.unshift(tieredSnapshot);

    // Apply retention policy (promotes old snapshots, prunes excess)
    const retained = applyRetentionPolicy(existing);

    // Save gzipped
    writeGzippedJson(path, retained);
  },

  // Stash
  async getStash(): Promise<StashEntry[]> {
    return readJson<StashEntry[]>(stashPath(), []);
  },

  async saveToStash(entry: StashEntry): Promise<void> {
    const stash = await this.getStash();
    stash.unshift(entry);
    if (stash.length > 10) stash.pop();
    writeJson(stashPath(), stash);
  },

  async clearStash(): Promise<void> {
    writeJson(stashPath(), []);
  },

  // Checkpoints
  async getCheckpoints(planId: string): Promise<Checkpoint[]> {
    return readJson<Checkpoint[]>(checkpointsPath(planId), []);
  },

  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    const path = checkpointsPath(checkpoint.planId);
    const checkpoints = readJson<Checkpoint[]>(path, []);

    checkpoints.unshift(checkpoint);
    if (checkpoints.length > 20) checkpoints.pop();

    writeJson(path, checkpoints);
  },

  async deleteCheckpoint(checkpointId: string, planId: string): Promise<void> {
    const path = checkpointsPath(planId);
    const checkpoints = readJson<Checkpoint[]>(path, []);
    const filtered = checkpoints.filter(c => c.id !== checkpointId);
    writeJson(path, filtered);
  },

  // Flags
  async getFlag(key: string): Promise<string | null> {
    const flags = readJson<Record<string, string>>(flagsPath(), {});
    return flags[key] ?? null;
  },

  async setFlag(key: string, value: string): Promise<void> {
    const flags = readJson<Record<string, string>>(flagsPath(), {});
    flags[key] = value;
    writeJson(flagsPath(), flags);
  },
};

// ============================================
// Export for API routes
// ============================================

export { PLANS_DIR };
