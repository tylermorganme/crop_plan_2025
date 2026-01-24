# Migration Architecture

This document captures the design decisions for schema migrations and client/server synchronization.

## The Problem

When we change the data schema (rename a field, restructure data), we need to:
1. Migrate existing stored data to the new format
2. Keep undo/redo history working across migrations
3. Handle stale clients that don't know about new schema

## Key Decisions

### Server-Side Migration (not client-side)

**We chose**: Server migrates plans on load.

**Why**:
- Runs once per plan, not per-client
- All consumers (API, scripts, other tools) get migrated data
- Client stays simple - just receives current-schema data
- Single source of truth

**Rejected alternative**: Client-side migration would require migration logic in the client bundle and coordination between multiple clients potentially racing to migrate.

### Declarative Migration DSL

**We chose**: Define migrations as path-based operations, not imperative code.

```typescript
const migrateV5ToV6 = [
  { op: 'renamePath', from: 'plantings.*.bedsCount', to: 'plantings.*.bedFeet' },
  { op: 'transformValue', path: 'plantings.*.bedFeet', fn: (v) => v * 50 }
];
```

**Why**: One definition drives both:
- Plan migration (walks object tree)
- Patch migration (transforms stored patch paths/values)

This is isomorphic - the same operation expressed differently for snapshots vs deltas.

**Operations**:
- `renamePath`: Rename a field (handles nested paths)
- `deletePath`: Remove a field (patches become no-ops)
- `addPath`: Add field with default value
- `transformValue`: Transform value at path

**Implementation**: Plain JS + TypeScript types where possible. Avoid custom parsers or unnecessary abstraction, but don't under-engineer either - type safety and clear APIs prevent bugs. The goal is removing footguns, not minimizing code.

### Migrating Patches (not discarding them)

**We chose**: Transform existing patches when migrating, preserving undo history.

**Why patches break without migration**:
A patch like `{ path: ["plantings", 0, "bedsCount"], value: 2 }` references a field that no longer exists after migration. Applying it doesn't crash - immer just creates the path - causing silent data corruption (zombie fields).

**The solution**:
When migrating a plan, also migrate all patches in the patches table:
- Transform paths according to migration rules
- Transform values if needed
- Mark patches as no-ops if they touch deleted fields

**Rejected alternative**: Discarding patches on migration loses undo history. We considered this acceptable initially, but realized the migration DSL makes patch transformation straightforward.

### No-Op Patches

If a migration deletes a field, patches that touched that field become no-ops:
- Patch still exists in table (audit trail)
- Flagged as no-op, not applied during hydration
- On undo, skip no-ops and show toast: "Some operations skipped due to data changes"

### Schema Version on Patches

Each patch stores two version columns:
- `original_schema_version`: Version when patch was created (never changes)
- `current_schema_version`: Version patch has been migrated to (updated on migration)

This enables debugging: "this patch was created at v3, has been migrated through v4, v5, v6"

**Server rejects mismatched patches**:
```typescript
if (patch.schema_version < plan.schemaVersion) {
  return { error: 'schema_mismatch', message: 'Please refresh' };
}
```

This prevents stale clients from creating old-format patches after migration.

### Client Staleness Detection

**Belt and suspenders**:

| Layer | Check | Action |
|-------|-------|--------|
| Client (on load) | `plan.schemaVersion > CLIENT_VERSION` | Show "please refresh" |
| Server (on save) | `patch.schema_version < plan.schemaVersion` | Reject with error |

Client warns early, server enforces always.

### Why Not Hard-Block Stale Clients?

Initially we considered a full-screen blocker for stale clients. But:
- Most schema changes are non-breaking from client perspective
- Hard-blocking loses any pending work
- Softer approach: warn, let them finish, reject on save

For truly breaking changes, the client won't be able to parse the data anyway.

### Immediate Save Model

This app saves every change immediately - no "pending changes" batch. So the worst case for a stale client is:
1. User makes ONE change
2. Server rejects (schema mismatch)
3. User sees "please refresh"
4. User refreshes, redoes one operation

Minimal data loss, simple recovery.

## The Recursion Hazard

`hydratePlan()` runs migrations. If migration code called `createCheckpointWithMetadata()`, that would call `hydratePlan()` → infinite loop.

**Solution**: Migration path uses `savePlan()` directly. The recursion hazard is documented in CLAUDE.md and in code comments.

**Structural fix**: `createCheckpointWithMetadata()` accepts optional `plan` parameter to avoid re-hydrating when plan is already available.

## Migration Flow

```
Load plan
  ↓
Check: plan.schemaVersion < CURRENT_SCHEMA_VERSION?
  ↓ yes
In transaction:
  1. Migrate plan (apply DSL operations)
  2. Migrate all patches (transform paths/values, update schema_version)
  3. Save plan
  4. Update patches table
  ↓
Return migrated plan
```

After this, plan and patches are in sync at current version.

## Edge Cases Considered

### What if migration fails halfway?
Patches have `schema_version` column - we can detect which were migrated. Recovery: re-run migration on unmigrated patches.

### What about undo across migration boundary?
Patches are migrated, so they reference current schema. Undo works. If patch became no-op (touched deleted field), it's skipped with user notification.

### What about concurrent clients?
First client to load triggers migration. Second client either:
- Gets already-migrated data (if migration complete)
- Waits (if migration in progress, via database lock)
- Server rejects their stale patches

### What about long-running tabs?
They work until they try to save. Then: reject, toast, refresh.

## What We Explicitly Chose NOT To Do

1. **Client-side migration**: Adds complexity, coordination issues
2. **Polling for version updates**: Overkill for single-user app
3. **Service worker auto-update**: Page still needs reload, complexity not worth it
4. **Hard-block stale clients**: Too aggressive, loses pending work
5. **Discard patches on migration**: Loses undo history unnecessarily
6. **On-the-fly patch migration for incoming saves**: Server shouldn't transform incoming data, just reject mismatches

## Logging Strategy

Lean towards over-gathering. Logs are cheap; debugging blind is expensive.

### What Could Go Wrong (That We Can't See Now)

| Failure Mode | Why It's Invisible | What Would Help |
|--------------|-------------------|-----------------|
| Migration fails halfway | Plan says v6, some patches still v5 | Log each patch migration with before/after version |
| Silent data corruption | Patch "succeeds" but creates zombie field | Log patch paths + validate schema after apply |
| Version mismatch rejections | User just sees "refresh" | Log client version, server version, what was rejected |
| Hydration from wrong checkpoint | Subtle data inconsistency | Log checkpoint ID, patches applied, result hash |
| Slow hydration | User waits, we don't know why | Log patch count, duration, checkpoint age |
| Concurrent modification | Race conditions | Log request timestamps, plan version before/after |

### What to Log (JSONL format)

**On every migration:**
```json
{ "event": "migration", "planId": "x", "fromVersion": 5, "toVersion": 6, "patchesMigrated": 42, "patchesMarkedNoOp": 2, "durationMs": 150, "timestamp": "..." }
```

**On every patch save:**
```json
{ "event": "patch_save", "planId": "x", "schemaVersion": 6, "description": "moved planting", "success": true, "timestamp": "..." }
```

**On every rejection:**
```json
{ "event": "schema_mismatch", "planId": "x", "clientVersion": 5, "serverVersion": 6, "endpoint": "/api/sqlite/x/patch", "timestamp": "..." }
```

**On every hydration:**
```json
{ "event": "hydration", "planId": "x", "checkpointId": "abc", "patchesApplied": 15, "resultSchemaVersion": 6, "durationMs": 50, "timestamp": "..." }
```

**On errors:**
```json
{ "event": "error", "planId": "x", "operation": "migration", "error": "...", "stack": "...", "context": {...}, "timestamp": "..." }
```

### Log Location

For now: `data/logs/server.jsonl` (append-only, rotated by date or size).

Later: Could ship to external service if needed.

## Database Schema vs Data Schema

We have TWO types of schema changes:

| | Data Schema | Database Schema |
|---|-------------|-----------------|
| What | Shape of Plan JSON blob | Structure of SQLite tables |
| Example | Rename `bedsCount` → `bedFeet` | Add `original_schema_version` column |
| When | On plan load (lazy) | On db open (eager) |
| Scope | Per-plan | Per-database file |
| Tracking | `plan.schemaVersion` | `PRAGMA user_version` |

**Database schema migrations run BEFORE data schema migrations** - the columns must exist before code uses them.

### Using PRAGMA user_version

SQLite has a built-in integer for exactly this purpose:

```typescript
function migrateDbSchema(db: Database) {
  const version = db.pragma('user_version', { simple: true }) as number;

  if (version < 1) {
    // Initial schema already created by SCHEMA constant
    db.pragma('user_version = 1');
  }

  if (version < 2) {
    db.exec(`
      ALTER TABLE patches ADD COLUMN original_schema_version INTEGER;
      ALTER TABLE patches ADD COLUMN current_schema_version INTEGER;
    `);
    db.pragma('user_version = 2');
  }

  // Future db schema migrations go here...
}
```

Call this in `openPlanDb()` after creating tables but before returning the db handle.

### Order of Operations

```
openPlanDb(planId)
  ├─ Create tables if not exist (SCHEMA constant)
  ├─ Run database schema migrations (PRAGMA user_version)
  └─ Return db handle

hydratePlan(planId)
  ├─ Load from checkpoint/plan table
  ├─ Apply patches
  ├─ Run data schema migrations (plan.schemaVersion)
  └─ Save migrated plan
```

Database schema is ready before any data operations happen.

## Future Considerations

- If we had multiple concurrent users editing same plan, would need conflict resolution
- For very complex migrations (array restructuring), might need per-migration custom logic
- Could add UI to show migration history/audit trail
