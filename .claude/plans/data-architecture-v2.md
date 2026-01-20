# Data Architecture v2: Local-First with Time Travel

## Overview

This document outlines the target data architecture for the crop planning app. It supersedes previous explorations (Dexie migration, SQLite via API routes) based on learnings from those attempts.

**Core principles:**
- Local-first: works offline, syncs when online
- Document-based: each plan is a self-contained unit
- Time travel: full undo history with ability to restore to any point
- Simple server: dumb blob storage, all logic on client
- Future-ready: architecture supports eventual cloud sync without major changes

## Current State (Problems)

We have three storage locations that must stay in sync:
1. **In-memory** (Zustand store)
2. **IndexedDB** (browser persistence)
3. **Filesystem** (JSON backup files)

Pain points:
- Triple-write on every mutation
- IndexedDB is "nearly persistent" but users can lose data (cache clear, new browser)
- Full plan snapshots for undo (memory-intensive with 340+ plantings)
- Migrations are TypeScript functions, no rollback capability
- No time travel beyond current session

## Target Architecture

### Storage: SQLite Per Plan

Each plan lives in its own SQLite database file.

```
plans/
├── index.json              # Plan metadata: [{id, name, path, lastOpened}, ...]
├── plan_abc123.db          # Self-contained plan database
├── plan_def456.db
└── plan_ghi789.db
```

**Why database-per-plan:**
- A plan is conceptually a document - this makes it literally a single file
- Easy backup: copy one file
- Easy sharing: send one file
- Easy deletion: remove one file
- Maps directly to Turso's model (one cloud database per plan)
- Isolation: corrupt plan doesn't affect others

**Why SQLite over normalized Postgres-style:**
- We tried normalizing data into relational tables - created complexity without benefit
- Plans are inherently document-shaped (snapshot of assumptions at a point in time)
- Don't want future schema changes bleeding into historical data
- JSON blobs in SQLite give us structure (queryable) without rigidity

### Schema Per Plan Database

```sql
-- Current state (fast reads)
CREATE TABLE plan (
  id TEXT PRIMARY KEY DEFAULT 'main',  -- single row
  data JSON NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Periodic snapshots for time travel reconstruction
CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data JSON NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- All changes as patches (the source of truth for history)
CREATE TABLE patches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patches JSON NOT NULL,           -- immer patches (forward)
  inverse_patches JSON NOT NULL,   -- immer inverse patches (for undo)
  description TEXT,                -- optional: "updated planting X"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_patches_time ON patches(created_at);
CREATE INDEX idx_snapshots_time ON snapshots(created_at);
```

### Immer Patches for Undo/Time Travel

Instead of storing full plan snapshots for undo, we store patches.

**Current approach (memory-heavy):**
```typescript
history: Plan[]  // Each undo state is a full copy (~340 plantings each)
```

**New approach (lightweight):**
```typescript
// On every mutation
const [nextPlan, patches, inversePatches] = produceWithPatches(plan, draft => {
  // mutation logic
})

// Store patches to SQLite
await db.execute(
  'INSERT INTO patches (patches, inverse_patches, description) VALUES (?, ?, ?)',
  [JSON.stringify(patches), JSON.stringify(inversePatches), 'Updated bed count']
)
```

**Patch size:** A typical edit produces ~60 bytes. Even complex operations are ~3KB. You could store 100,000 patches in a few megabytes.

**Undo implementation:**
```typescript
async function undo() {
  const lastPatch = await db.execute(
    'SELECT * FROM patches ORDER BY id DESC LIMIT 1'
  )
  if (!lastPatch) return

  const plan = await getCurrentPlan()
  const restored = applyPatches(plan, JSON.parse(lastPatch.inverse_patches))
  await savePlan(restored)
  await db.execute('DELETE FROM patches WHERE id = ?', [lastPatch.id])
}
```

**Time travel (restore to date):**
```typescript
async function getPlanAtTime(targetTime: Date): Plan {
  // Find nearest snapshot before target
  const snapshot = await db.execute(
    'SELECT * FROM snapshots WHERE created_at <= ? ORDER BY created_at DESC LIMIT 1',
    [targetTime]
  )

  // Get patches between snapshot and target
  const patches = await db.execute(
    'SELECT * FROM patches WHERE created_at > ? AND created_at <= ? ORDER BY created_at',
    [snapshot.created_at, targetTime]
  )

  // Reconstruct by applying patches
  let plan = JSON.parse(snapshot.data)
  for (const p of patches) {
    plan = applyPatches(plan, JSON.parse(p.patches))
  }
  return plan
}
```

**Periodic snapshots:** Every N patches (100?) or every day, save a full snapshot. This bounds reconstruction time.

### Migrations

Migrations run **on the client**, lazily when a plan is opened.

**Why client-side:**
- App must work offline, so migration code must be local
- Server is dumb storage - it never interprets the JSON blobs
- No point maintaining migrations in two places

**Migration structure:**
```typescript
interface Migration {
  version: number
  description: string
  up: (plan: Plan) => Plan
}

const migrations: Migration[] = [
  {
    version: 2,
    description: 'Add harvestDate to plantings',
    up: (plan) => {
      return produce(plan, draft => {
        draft.plantings.forEach(p => {
          p.harvestDate = computeHarvestDate(p)
        })
        draft.schemaVersion = 2
      })
    }
  },
  // ... more migrations
]
```

**On plan open:**
```typescript
async function openPlan(db: Database): Promise<Plan> {
  const row = await db.execute('SELECT * FROM plan WHERE id = "main"')
  let plan = JSON.parse(row.data)

  // Check for future schema (newer app version saved this)
  if (plan.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error('PLAN_FROM_FUTURE')  // UI shows "please refresh"
  }

  // Migrate if behind
  if (plan.schemaVersion < CURRENT_SCHEMA_VERSION) {
    plan = migrateToLatest(plan)
    await savePlan(db, plan)
    // Save a snapshot at migration boundary
    await saveSnapshot(db, plan)
  }

  return plan
}
```

**Schema version mismatch handling:**

If a plan was saved by a newer app version than the client has:
```typescript
if (plan.schemaVersion > CURRENT_SCHEMA_VERSION) {
  showModal({
    title: 'Update Required',
    message: 'This plan was saved with a newer version of the app.',
    primaryAction: { label: 'Refresh', onClick: () => window.location.reload() },
    footer: "If refreshing doesn't work, try Ctrl+Shift+R to clear cache."
  })
}
```

This is rare (requires using multiple devices with different app versions) and the fix is simple (refresh). No need for complex update orchestration.

### Cloud Sync (Future)

The architecture is designed to eventually sync to Turso (or similar) with minimal changes.

**Local-only (now):**
```
Client → Local SQLite file
```

**With cloud (later):**
```
Client → libSQL client → Turso cloud database
              ↓
        (same API, different connection string)
```

**Turso model:** Cheap databases. One database per plan maps naturally.

```
Local                          Turso
─────                          ─────
plans/plan_abc.db    ←sync→    libsql://plan-abc.turso.io
plans/plan_def.db    ←sync→    libsql://plan-def.turso.io
```

**Storage API abstraction:**
```typescript
interface StorageAPI {
  getPlan(id: string): Promise<Plan>
  savePlan(id: string, plan: Plan): Promise<void>
  appendPatches(id: string, patches: PatchEntry[]): Promise<void>
  getPatches(id: string, since?: Date): Promise<PatchEntry[]>
  getPlanAtTime(id: string, timestamp: Date): Promise<Plan>
}

// Implementations swap without changing app code
class LocalSQLiteStorage implements StorageAPI { ... }
class TursoStorage implements StorageAPI { ... }
```

### Security Model

**Key insight:** Each plan is user-owned data. The security boundary is "which database can you access," not "what shape is the JSON."

When cloud sync exists:
- Server authenticates requests (JWT, session, etc.)
- Server checks ownership: "Does this user own this plan?"
- Server stores/retrieves blobs without interpreting them

**What about malicious JSON?**

The server never executes or interprets the JSON - it's just `store blob` and `return blob`. There's no attack surface. The only code that parses the JSON is the client, and the client can only harm its own data.

**Client-side validation** is for UX (prevent accidental corruption), not security:
```typescript
// Optional: validate patches don't touch system fields
const forbidden = patches.some(p => p.path === '/schemaVersion')
if (forbidden) {
  return { error: 'Cannot modify system fields' }
}
```

### What About Dexie Cloud?

Dexie Cloud provides sync, but:
- Tightly coupled to their service (can't point at arbitrary database)
- Still IndexedDB under the hood (browser-only, user can clear it)
- Less flexibility than owning infrastructure

If you want Turso/libSQL as your backend, Dexie Cloud isn't the path. It solves "I don't want to build sync" but trades flexibility for convenience.

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| SQLite per plan (not one big DB) | Plans are documents. One file = portable, easy backup, maps to Turso model |
| JSON blobs (not normalized tables) | Tried normalization, added complexity without benefit. Plans are document-shaped |
| Immer patches for history | Lightweight (~60 bytes/edit vs full snapshot). Same library we already use |
| Client-side migrations only | Must work offline. Server never interprets data. No point maintaining in both places |
| Lazy migration on open | Simple, no coordination needed. Unused plans never migrate (why bother?) |
| Simple "refresh" for version mismatch | Rare edge case, simple solution. No complex update orchestration |
| Dumb server (blob storage + auth) | All business logic client-side for local-first. Server is just persistence layer |

## Migration Path from Current State

1. **Implement StorageAPI interface** - abstract current storage behind consistent API
2. **Add SQLite storage backend** - using sql.js (browser) or better-sqlite3 (Node)
3. **Switch to patch-based history** - replace snapshot undo with immer patches
4. **Remove triple-storage** - single source of truth (SQLite), remove IndexedDB/JSON file sync
5. **Add time travel UI** - "View plan as of [date]", "Restore to [date]"
6. **(Future) Add Turso sync** - implement TursoStorage with same interface

## Open Questions

- **History retention:** How long to keep patches? Rolling window (90 days)? Size limit? Keep forever?
- **Snapshot frequency:** Every N patches? Daily? On significant operations?
- **Conflict resolution:** When cloud sync exists and same plan edited on two devices offline, how to merge? (Probably last-write-wins initially, smarter later)

## References

- Previous analysis: [storage-options-analysis.md](storage-options-analysis.md)
- Immer patches: https://immerjs.github.io/immer/patches
- Turso: https://turso.tech/
- libSQL: https://github.com/tursodatabase/libsql
