# Dexie.js Migration Plan

## Goal

Replace localForage (thin IndexedDB wrapper) with Dexie.js to get **declarative schema versioning and built-in migrations**.

## Current Architecture

```
storage-adapter.ts
├── IndexedDBAdapter class (uses localForage)
│   ├── getPlan() / savePlan() / deletePlan()
│   ├── getStash() / saveToStash() / clearStash()
│   └── getFlag() / setFlag()
├── Cross-tab sync via BroadcastChannel
└── Background file sync via /api/plans/sync

migrations/index.ts
├── migratePlan() - runs on plan load
├── CURRENT_SCHEMA_VERSION (currently 4)
└── Migration functions (v1→v2, v2→v3, v3→v4)
```

**Pain point**: Migrations are TypeScript functions that transform the entire Plan object. Adding a field requires writing a migration function and understanding the whole system.

## Target Architecture

```
storage-adapter.ts (Dexie version)
├── DexieAdapter class
│   ├── db.plans.get() / .put() / .delete()
│   ├── db.stash.toArray() / .add() / .clear()
│   └── db.flags.get() / .put()
├── Cross-tab sync via BroadcastChannel (unchanged)
└── Background file sync (unchanged)

db.ts (NEW)
├── Dexie database definition
├── Schema versions with stores
└── Upgrade functions per version
```

## Schema Design

Dexie stores data as records with indexed fields. Our Plan is a single document, so we'll store it as one record keyed by plan ID.

```typescript
// src/lib/db.ts
import Dexie, { Table } from 'dexie';
import type { Plan, StashEntry } from './plan-types';

export interface PlanRecord {
  id: string;
  plan: Plan;
  past: unknown[];  // Undo history (opaque blobs)
  future: unknown[];
}

export interface FlagRecord {
  key: string;
  value: string;
}

export class CropPlannerDB extends Dexie {
  plans!: Table<PlanRecord, string>;
  registry!: Table<PlanSummary, string>;
  stash!: Table<StashEntry, number>;
  flags!: Table<FlagRecord, string>;

  constructor() {
    super('CropPlanner');

    // Version 1: Initial schema
    this.version(1).stores({
      plans: 'id',           // Primary key only (plan is a blob)
      registry: 'id',        // Plan summaries for list view
      stash: '++id',         // Auto-increment for stash entries
      flags: 'key',          // Simple key-value flags
    });

    // Future migrations go here:
    // this.version(2).stores({...}).upgrade(tx => {...});
  }
}

export const db = new CropPlannerDB();
```

## Migration Strategy

### Phase 1: Install Dexie, Create Schema

1. `npm install dexie`
2. Create `src/lib/db.ts` with schema definition
3. No behavior change yet

### Phase 2: Create DexieAdapter

Replace localForage calls with Dexie equivalents:

```typescript
// In storage-adapter.ts

export class DexieAdapter implements PlanStorageAdapter {
  async getPlan(id: string): Promise<PlanData | null> {
    const record = await db.plans.get(id);
    return record ? { plan: record.plan, past: record.past, future: record.future } : null;
  }

  async savePlan(id: string, data: PlanData): Promise<void> {
    await db.plans.put({
      id,
      plan: data.plan,
      past: data.past,
      future: data.future,
    });
    await this.updateRegistry(data.plan);
    broadcastSync({ type: 'plan-updated', planId: id });
    syncToFile(id, data);
  }

  async deletePlan(id: string): Promise<void> {
    await db.plans.delete(id);
    await db.registry.delete(id);
    broadcastSync({ type: 'plan-deleted', planId: id });
  }

  // ... etc
}
```

### Phase 3: Data Migration from localForage to Dexie

One-time migration on first load:

```typescript
async function migrateFromLocalForage(): Promise<void> {
  const migrated = await db.flags.get('migrated-from-localforage');
  if (migrated) return;

  // Read all plans from old localForage storage
  const keys = await localforage.keys();
  for (const key of keys) {
    if (key.startsWith('crop-plan-lib-')) {
      const data = await localforage.getItem<PlanData>(key);
      if (data) {
        const id = key.replace('crop-plan-lib-', '');
        await db.plans.put({ id, ...data });
      }
    }
  }

  // Migrate registry
  const registry = await localforage.getItem<PlanSummary[]>('crop-plan-registry');
  if (registry) {
    await db.registry.bulkPut(registry);
  }

  // Migrate stash
  const stash = await localforage.getItem<StashEntry[]>('crop-plan-stash');
  if (stash) {
    await db.stash.bulkAdd(stash);
  }

  await db.flags.put({ key: 'migrated-from-localforage', value: 'true' });
}
```

### Phase 4: Remove localForage

1. Delete localForage import
2. Remove `IndexedDBAdapter` class
3. `npm uninstall localforage`

### Phase 5: Future Schema Changes

When we need to add a field (e.g., `marketSplit` to CropConfig):

```typescript
// In db.ts, add new version:

this.version(2).stores({
  plans: 'id',
  registry: 'id',
  stash: '++id',
  flags: 'key',
}).upgrade(async tx => {
  // Dexie runs this automatically for databases at version 1
  await tx.table('plans').toCollection().modify(record => {
    // Add marketSplit to all configs
    const catalog = record.plan.cropCatalog;
    for (const config of Object.values(catalog)) {
      if (!config.defaultMarketSplit) {
        config.defaultMarketSplit = { direct: 100 };
      }
    }
  });
});
```

**Benefits over current system:**
- Schema and migration in one place
- Dexie handles version tracking
- Upgrade runs transactionally
- No separate `migratePlan()` function to maintain

## What Changes

| Component | Before | After |
|-----------|--------|-------|
| Storage library | localForage | Dexie |
| Adapter class | `IndexedDBAdapter` | `DexieAdapter` |
| Schema definition | Implicit | Explicit in `db.ts` |
| Version tracking | `schemaVersion` in Plan | Dexie version number |
| Migrations | `migrations/index.ts` functions | Dexie `.upgrade()` callbacks |
| Tab sync | BroadcastChannel | BroadcastChannel (unchanged) |
| File sync | `/api/plans/sync` | `/api/plans/sync` (unchanged) |

## What Stays the Same

- `PlanStorageAdapter` interface
- `PlanData`, `PlanSummary` types
- Cross-tab sync via BroadcastChannel
- File sync to `data/plans/`
- Plan structure (just stored differently)
- All UI and business logic

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Data loss during migration | Keep localForage data until confirmed working |
| Breaking existing plans | Test with real plan data before removing old code |
| Dexie learning curve | Dexie API is well-documented and similar to localForage |
| Future Dexie upgrades | Dexie is stable (v3.2+), widely used |

## Implementation Order

1. [ ] Install Dexie (`npm install dexie`)
2. [ ] Create `src/lib/db.ts` with schema
3. [ ] Create `DexieAdapter` class in storage-adapter.ts
4. [ ] Add migration from localForage to Dexie
5. [ ] Switch `storage` export to use DexieAdapter
6. [ ] Test thoroughly with existing plans
7. [ ] Remove localForage code and dependency
8. [ ] Update CLAUDE.md with new migration instructions

## Future: Consolidating Plan Migrations

After Dexie migration, we can consolidate:

**Current**: Two migration systems
- `migrations/index.ts` - Plan schema migrations (runs on load)
- Dexie `.upgrade()` - Storage schema migrations

**Future**: Single system
- Move Plan migrations into Dexie `.upgrade()` callbacks
- Remove `migrations/index.ts`
- All versioning in one place

This is optional - the current Plan migrations will continue to work. But having one system is cleaner long-term.
