/**
 * Variety Store
 *
 * Zustand store for managing global seed varieties and mixes.
 * Unlike plans, varieties are shared across all plans (not per-plan).
 * Uses IndexedDB for persistence with file backup.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import localforage from 'localforage';
import type { Variety } from './entities/variety';
import type { SeedMix } from './entities/seed-mix';

// =============================================================================
// TYPES
// =============================================================================

export interface VarietyState {
  /** All varieties keyed by ID */
  varieties: Record<string, Variety>;
  /** All seed mixes keyed by ID */
  seedMixes: Record<string, SeedMix>;
  /** Whether data has been loaded from storage */
  isLoaded: boolean;
}

export interface VarietyActions {
  // Initialization
  loadFromStorage(): Promise<void>;

  // Variety CRUD
  addVariety(variety: Variety): Promise<void>;
  updateVariety(variety: Variety): Promise<void>;
  deleteVariety(id: string): Promise<void>;
  importVarieties(varieties: Variety[]): Promise<void>;

  // SeedMix CRUD
  addSeedMix(mix: SeedMix): Promise<void>;
  updateSeedMix(mix: SeedMix): Promise<void>;
  deleteSeedMix(id: string): Promise<void>;
  importSeedMixes(mixes: SeedMix[]): Promise<void>;

  // Queries (computed, not stored)
  getVarietiesForCrop(crop: string): Variety[];
  getSeedMixesForCrop(crop: string): SeedMix[];
  getVariety(id: string): Variety | undefined;
  getSeedMix(id: string): SeedMix | undefined;
}

export type VarietyStore = VarietyState & VarietyActions;

// =============================================================================
// STORAGE KEYS
// =============================================================================

const VARIETIES_STORAGE_KEY = 'crop-plan-varieties';
const SEED_MIXES_STORAGE_KEY = 'crop-plan-seed-mixes';

// =============================================================================
// FILE SYNC
// =============================================================================

/**
 * Sync varieties and seed mixes to file storage.
 * Fire-and-forget - errors are logged but don't block.
 */
async function syncToFile(
  varieties: Record<string, Variety>,
  seedMixes: Record<string, SeedMix>
): Promise<void> {
  try {
    const response = await fetch('/api/varieties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ varieties, seedMixes }),
    });
    if (!response.ok) {
      console.warn('Variety file sync failed:', await response.text());
    }
  } catch (e) {
    console.warn('Variety file sync error:', e);
  }
}

// =============================================================================
// STORE IMPLEMENTATION
// =============================================================================

export const useVarietyStore = create<VarietyStore>()(
  immer((set, get) => ({
    // ----- State -----
    varieties: {},
    seedMixes: {},
    isLoaded: false,

    // ----- Initialization -----

    async loadFromStorage() {
      try {
        const [varieties, seedMixes] = await Promise.all([
          localforage.getItem<Record<string, Variety>>(VARIETIES_STORAGE_KEY),
          localforage.getItem<Record<string, SeedMix>>(SEED_MIXES_STORAGE_KEY),
        ]);

        set((state) => {
          state.varieties = varieties ?? {};
          state.seedMixes = seedMixes ?? {};
          state.isLoaded = true;
        });
      } catch (e) {
        console.error('Failed to load varieties from storage:', e);
        set((state) => {
          state.isLoaded = true;
        });
      }
    },

    // ----- Variety CRUD -----

    async addVariety(variety: Variety) {
      set((state) => {
        state.varieties[variety.id] = variety;
      });
      await saveVarieties(get());
    },

    async updateVariety(variety: Variety) {
      set((state) => {
        if (state.varieties[variety.id]) {
          state.varieties[variety.id] = variety;
        }
      });
      await saveVarieties(get());
    },

    async deleteVariety(id: string) {
      set((state) => {
        delete state.varieties[id];
        // Also remove from any seed mixes that reference this variety
        for (const mix of Object.values(state.seedMixes)) {
          mix.components = mix.components.filter((c) => c.varietyId !== id);
        }
      });
      await saveAll(get());
    },

    async importVarieties(varieties: Variety[]) {
      set((state) => {
        for (const v of varieties) {
          state.varieties[v.id] = v;
        }
      });
      await saveVarieties(get());
    },

    // ----- SeedMix CRUD -----

    async addSeedMix(mix: SeedMix) {
      set((state) => {
        state.seedMixes[mix.id] = mix;
      });
      await saveSeedMixes(get());
    },

    async updateSeedMix(mix: SeedMix) {
      set((state) => {
        if (state.seedMixes[mix.id]) {
          state.seedMixes[mix.id] = mix;
        }
      });
      await saveSeedMixes(get());
    },

    async deleteSeedMix(id: string) {
      set((state) => {
        delete state.seedMixes[id];
      });
      await saveSeedMixes(get());
    },

    async importSeedMixes(mixes: SeedMix[]) {
      set((state) => {
        for (const m of mixes) {
          state.seedMixes[m.id] = m;
        }
      });
      await saveSeedMixes(get());
    },

    // ----- Queries -----

    getVarietiesForCrop(crop: string): Variety[] {
      const { varieties } = get();
      return Object.values(varieties).filter((v) => v.crop === crop);
    },

    getSeedMixesForCrop(crop: string): SeedMix[] {
      const { seedMixes } = get();
      return Object.values(seedMixes).filter((m) => m.crop === crop);
    },

    getVariety(id: string): Variety | undefined {
      return get().varieties[id];
    },

    getSeedMix(id: string): SeedMix | undefined {
      return get().seedMixes[id];
    },
  }))
);

// =============================================================================
// PERSISTENCE HELPERS
// =============================================================================

async function saveVarieties(state: VarietyState): Promise<void> {
  try {
    await localforage.setItem(VARIETIES_STORAGE_KEY, state.varieties);
    syncToFile(state.varieties, state.seedMixes);
  } catch (e) {
    console.error('Failed to save varieties:', e);
  }
}

async function saveSeedMixes(state: VarietyState): Promise<void> {
  try {
    await localforage.setItem(SEED_MIXES_STORAGE_KEY, state.seedMixes);
    syncToFile(state.varieties, state.seedMixes);
  } catch (e) {
    console.error('Failed to save seed mixes:', e);
  }
}

async function saveAll(state: VarietyState): Promise<void> {
  try {
    await Promise.all([
      localforage.setItem(VARIETIES_STORAGE_KEY, state.varieties),
      localforage.setItem(SEED_MIXES_STORAGE_KEY, state.seedMixes),
    ]);
    syncToFile(state.varieties, state.seedMixes);
  } catch (e) {
    console.error('Failed to save variety data:', e);
  }
}

// =============================================================================
// INITIALIZATION HELPER
// =============================================================================

/**
 * Initialize the variety store (call once on app startup).
 * Loads data from IndexedDB.
 */
export async function initializeVarietyStore(): Promise<void> {
  const store = useVarietyStore.getState();
  if (!store.isLoaded) {
    await store.loadFromStorage();
  }
}
