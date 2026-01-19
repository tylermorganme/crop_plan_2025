# Storage Options Analysis

## Problem Statement

Current pain points with IndexedDB + Zustand + JSON file backups:

1. **Three places to keep in sync**: IndexedDB, JSON backup files, in-memory Zustand state
2. **Migrations are TypeScript functions**: Must write code, handle edge cases, test carefully
3. **Can't query data easily**: Must load entire plan into memory to inspect/modify
4. **Claude can't touch IndexedDB**: Forces export→edit→import workflow for live data changes

## Options Evaluated

### 1. Dexie.js ✅ RECOMMENDED

IndexedDB wrapper with **built-in versioned migrations**.

```javascript
const db = new Dexie('CropPlanDB');

db.version(1).stores({
  plantings: 'id, configId, fieldStartDate',
  cropConfigs: 'id, identifier, crop'
});

db.version(2).stores({
  plantings: 'id, configId, fieldStartDate',
  cropConfigs: 'id, identifier, crop, marketSplit'
}).upgrade(tx => {
  return tx.table('cropConfigs').toCollection().modify(config => {
    config.marketSplit = { direct: 100 };
  });
});
```

| Aspect | Assessment |
|--------|------------|
| Migration support | Excellent - declarative versioning with upgrade functions |
| Offline/local-first | Yes - still IndexedDB under the hood |
| Adoption complexity | Low - drop-in replacement for raw IndexedDB |
| Tab sync | Preserved - same storage mechanism |

**Why it's the best fit:**
- Minimal architecture change
- Directly solves migration pain
- Battle-tested (widely used)
- Keeps everything else the same

---

### 2. PGlite + Drizzle

Full Postgres in the browser via WebAssembly, with type-safe ORM.

| Aspect | Assessment |
|--------|------------|
| Migration support | Good - schema defined in TypeScript, `ALTER TABLE` works |
| Offline/local-first | Yes - persists to IndexedDB |
| Adoption complexity | Medium - new mental model, WASM considerations |
| Tab sync | Requires additional work |

**Trade-offs:**
- More powerful queries (full SQL)
- Schema in code with Drizzle types
- Larger bundle size (~3MB gzipped for PGlite)
- Would need to rebuild storage layer

---

### 3. RxDB

Full local-first database with replication support.

| Aspect | Assessment |
|--------|------------|
| Migration support | Excellent - migration strategies with data transformation |
| Offline/local-first | Yes - designed for it |
| Adoption complexity | High - full framework, different paradigm |
| Tab sync | Built-in multi-tab coordination |

**Trade-offs:**
- Most comprehensive solution
- Overkill for single-user local app
- Steep learning curve
- Future-proofs for multi-device sync if needed

---

### 4. SQLite via API Routes

Move storage to server-side SQLite, accessed via Next.js API routes.

| Aspect | Assessment |
|--------|------------|
| Migration support | Excellent - standard `ALTER TABLE` + SQL scripts |
| Offline/local-first | Yes (localhost always available) |
| Adoption complexity | Medium - new API layer, but familiar SQL |
| Tab sync | Lost - would need custom solution |

**Trade-offs:**
- Claude can run SQL directly on `.db` files
- Loses free tab sync from IndexedDB
- Clean separation of concerns
- One file per plan (easy backup/sharing)

---

### 5. Keep Current System

Stay with raw IndexedDB + Zustand + JSON backups.

| Aspect | Assessment |
|--------|------------|
| Migration support | Manual TypeScript functions |
| Offline/local-first | Yes |
| Adoption complexity | None - already there |
| Tab sync | Works |

**Trade-offs:**
- No adoption cost
- Migration pain remains
- Multiple storage locations to sync
- Works fine, just not elegant

---

## Tools NOT Recommended

| Tool | Reason |
|------|--------|
| **Prisma** | Not browser-ready, server-only ORM |
| **ElectricSQL/PowerSync** | Require backend infrastructure, overkill for local-only |
| **TanStack Query** | Caching layer for server state, doesn't help with local migrations |
| **Custom migration system** | Dexie already solved this problem |

---

## Decision

**Migrate to Dexie.js** - smallest change that directly addresses migration pain while preserving current architecture.

Future upgrade path if needed: PGlite + Drizzle for full SQL power.
