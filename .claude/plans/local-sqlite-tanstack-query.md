# Local SQLite + TanStack Query Architecture

**Status**: Future option, not current direction. Documented for reference.

## The Core Insight

A local client talking to a local database through HTTP is still **local-first**. The HTTP layer is just IPC (inter-process communication) - it doesn't make it "network-dependent" any more than any other method of talking between processes.

```
Browser → fetch('localhost:3000/api/...') → Next.js API route → SQLite file
```

Every part of this runs on your machine. It's local. The fact that it uses HTTP is a feature - it means you could later point it at a cloud database with zero client-side changes.

## Why This Document Exists

During architecture discussions, there was confusion about whether this pattern qualifies as "local-first." The mental trap was:

> "HTTP = network = not offline-capable = not local-first"

This is **wrong**. The correct framing:

> "Local client → Local server → Local database = Local-first (and local-only)"

The HTTP layer doesn't route through any network. `localhost` is your machine. The dev server is always running when you're using the app. There's no "offline" scenario to worry about.

**Key clarifications for future readers:**

1. "Offline-first" concerns about network failure don't apply to localhost
2. Using `fetch()` doesn't mean you're dependent on internet connectivity
3. The separation via HTTP is a *benefit* - clean architecture that could later scale to cloud
4. This is arguably *more* local-first than IndexedDB, because SQLite is a real file you can inspect, backup, and run SQL against directly

## The Architecture

```
┌─────────────────────────────────────┐
│ Browser                              │
│  ├─ React Components                │
│  ├─ Zustand (UI state only)         │
│  │   └─ selections, modals, filters │
│  └─ TanStack Query (data cache)     │
│      └─ fetches from API, caches,   │
│         handles optimistic updates  │
└──────────────┬──────────────────────┘
               │ fetch() to localhost
               ▼
┌─────────────────────────────────────┐
│ Next.js API Routes                   │
│  ├─ GET  /api/plans                 │
│  ├─ GET  /api/plans/[id]            │
│  ├─ POST /api/plans                 │
│  ├─ PUT  /api/plans/[id]            │
│  ├─ GET  /api/plantings             │
│  └─ ... etc                         │
└──────────────┬──────────────────────┘
               │ SQL queries
               ▼
┌─────────────────────────────────────┐
│ SQLite Database                      │
│  └─ data/crop-planner.db            │
└─────────────────────────────────────┘
```

## What Each Layer Does

### SQLite
- **Single source of truth** for all persistent data
- File on disk (`data/crop-planner.db`)
- Claude can query/modify directly via SQL
- Migrations are just `ALTER TABLE` statements
- Easy to backup (copy the file)

### Next.js API Routes
- Thin CRUD layer over SQLite
- Uses `better-sqlite3` for sync operations (fast, no async overhead)
- Validates input, runs queries, returns JSON
- No business logic - just data access

### TanStack Query
- Manages the client-side cache of server data
- Handles fetching, caching, refetching, invalidation
- Provides optimistic update patterns with rollback
- Components subscribe to queries, re-render when data changes

### Zustand
- **Only for ephemeral UI state** that doesn't persist:
  - Which items are selected
  - Is a modal open
  - Current filter/sort settings
  - Drag-and-drop state
- Does NOT hold plan data, plantings, crop configs, etc.

## The Problem This Solves

Current architecture has a sync problem:

```
Zustand (in-memory) ←→ IndexedDB ←→ JSON files (backup)
                           ↑
                    migrations touch all of these
```

Three places to keep in sync. Migrations are TypeScript functions that transform the whole Plan object. Adding a field requires understanding the whole system.

With SQLite + TanStack Query:

```
SQLite (source of truth) → TanStack Query (cache) → React (UI)
```

One source of truth. TanStack Query handles the caching/sync. Migrations are SQL.

## What You Gain

1. **Single source of truth** - SQLite file, period
2. **SQL migrations** - `ALTER TABLE crop_configs ADD COLUMN market_split TEXT;`
3. **Claude can edit data directly** - run SQL on the file
4. **Query power** - find things with SQL, not loading everything into memory
5. **TanStack Query patterns** - battle-tested caching, optimistic updates, refetching
6. **Clean separation** - data layer is independent of UI framework
7. **Future-proof** - swap SQLite for Turso/Postgres later, client code unchanged

## What You Lose

1. **Tab sync is manual** - IndexedDB's BroadcastChannel pattern would need reimplementing
2. **Slightly more latency** - HTTP round-trip vs direct IndexedDB access (but it's localhost, so ~1ms)
3. **Dev server must run** - but it already does, so not a real cost

## Future Cloud Path

If you later want multi-device sync:

**Option A: Replace SQLite with cloud database**
- Point API routes at Turso/Postgres instead of local SQLite
- Client code unchanged
- Lose "local-first" - now dependent on internet

**Option B: Sync local SQLite with cloud**
- Keep local SQLite as primary
- Background sync to cloud database (Turso, Postgres)
- Tools: LiteStream (backup to S3), Electric SQL (bi-directional sync), PowerSync
- Maintains local-first, adds multi-device

**Option C: TanStack DB + Electric**
- More sophisticated: TanStack DB for reactive client store
- Electric for sync to Postgres
- Full offline-first with conflict resolution
- More complex, but handles multiplayer scenarios

## Implementation Sketch

### 1. Set up SQLite

```typescript
// src/lib/db.ts
import Database from 'better-sqlite3';

const db = new Database('data/crop-planner.db');

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

export default db;
```

### 2. Create API routes

```typescript
// src/app/api/plantings/route.ts
import db from '@/lib/db';

export async function GET() {
  const plantings = db.prepare('SELECT * FROM plantings').all();
  return Response.json(plantings);
}

export async function POST(request: Request) {
  const planting = await request.json();
  const stmt = db.prepare(`
    INSERT INTO plantings (id, config_id, field_start_date, start_bed, bed_feet)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(planting.id, planting.configId, planting.fieldStartDate, planting.startBed, planting.bedFeet);
  return Response.json(planting);
}
```

### 3. Use TanStack Query in components

```typescript
// src/hooks/usePlantings.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function usePlantings() {
  return useQuery({
    queryKey: ['plantings'],
    queryFn: () => fetch('/api/plantings').then(r => r.json()),
  });
}

export function useAddPlanting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (planting) =>
      fetch('/api/plantings', {
        method: 'POST',
        body: JSON.stringify(planting),
      }).then(r => r.json()),

    // Optimistic update
    onMutate: async (newPlanting) => {
      await queryClient.cancelQueries({ queryKey: ['plantings'] });
      const previous = queryClient.getQueryData(['plantings']);
      queryClient.setQueryData(['plantings'], (old) => [...old, newPlanting]);
      return { previous };
    },
    onError: (err, newPlanting, context) => {
      queryClient.setQueryData(['plantings'], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['plantings'] });
    },
  });
}
```

### 4. Zustand for UI state only

```typescript
// src/lib/ui-store.ts
import { create } from 'zustand';

interface UIState {
  selectedPlantingIds: Set<string>;
  isEditModalOpen: boolean;
  filterCategory: string | null;
  // ... only ephemeral UI state
}

export const useUIStore = create<UIState>((set) => ({
  selectedPlantingIds: new Set(),
  isEditModalOpen: false,
  filterCategory: null,
  // ... actions
}));
```

## Migration Path from Current Architecture

1. **Set up SQLite** - create database, define schema
2. **Export current data** - dump IndexedDB/JSON to SQLite
3. **Create API routes** - CRUD for each entity
4. **Add TanStack Query** - wrap API calls
5. **Migrate components** - replace `usePlanStore().plantings` with `usePlantings()`
6. **Slim down Zustand** - remove data, keep only UI state
7. **Remove IndexedDB code** - delete storage-adapter.ts, localForage dependency

## Why We're Not Doing This Now

The current IndexedDB + Zustand architecture works. The immediate path forward is:

1. **Dexie.js** - better IndexedDB wrapper with built-in migrations (see [dexie-migration.md](./dexie-migration.md))

This document exists so that when we revisit architecture, we have a clear picture of what the SQLite + TanStack Query option looks like and why it's valid.

## Summary

| Aspect | Current (IndexedDB) | This Option (SQLite) |
|--------|---------------------|----------------------|
| Source of truth | Zustand + IndexedDB | SQLite |
| Sync complexity | High (3 places) | Low (1 place) |
| Migrations | TypeScript functions | SQL statements |
| Claude can edit | No (IndexedDB is browser-only) | Yes (SQL on file) |
| Offline | Yes | Yes (localhost is always available) |
| Future cloud path | Rebuild storage layer | Change connection string |
