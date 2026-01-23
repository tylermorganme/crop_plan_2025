# Patch-Based Hydration Implementation Plan

**Created:** 2026-01-22
**Updated:** 2026-01-22
**Status:** Planning
**Goal:** Reduce network calls from ~99 per drag operation to ~10 by switching from full-plan-save-on-every-mutation to patch-based hydration.

---

## Executive Summary

**Current architecture:**
- Every mutation does TWO network calls:
  1. `POST /patches` - Append lightweight patch (~700B) - fast
  2. `PUT /plan` - Save full plan (~3.5MB JSON) - slow
- On load, `loadPlan()` reads full snapshot from `plan` table - patches are ignored except for undo/redo
- Undo/redo loads plan, applies patches, saves full plan again

**Target architecture:**
- Mutations only send patches (no full plan save)
- On load, reconstruct plan from last checkpoint + patches since checkpoint
- Periodic auto-checkpoints every N patches
- Undo/redo just manipulates the patches table (no load/apply/save cycle)

**Expected improvement:**
- Current: ~2 mutations/sec × 3.5MB = 7MB/sec sustained write load
- Target: ~2 mutations/sec × 700B = 1.4KB/sec (5000x reduction)

---

## Design Principles

1. **No fallback code** - Hydration is the only path, not "try this, fall back to that". If hydration fails, it's a bug to fix, not a condition to paper over.

2. **No shim code** - We're not keeping deprecated endpoints around "for compatibility". Clean break.

3. **Test first** - Comprehensive tests before touching storage layer. We validate hydration produces identical results before deploying.

4. **One-time migration** - Existing plans get initial checkpoints via migration script before deployment, not gradual transition.

---

## Where savePlan() Is Actually Needed

| Use Case | savePlan needed? | Reason |
|----------|------------------|--------|
| Normal mutations | NO | Patches are the source of truth |
| Create new plan | YES | Initial state must be persisted |
| Copy plan | YES | New plan needs initial state |
| Load plan | NO | Hydrate from checkpoint + patches |
| Undo | NO | Just pop patch from patches table |
| Redo | NO | Just push patch back to patches table |
| Schema migration | YES | Save migrated state as new checkpoint |
| Create checkpoint | IMPLICIT | Checkpoint copies .db which includes plan table |

---

## Where savePlan() Must Be Removed

1. **All ~60 mutation methods in plan-store.ts** - These call `await savePlanToLibrary()` after `mutateWithPatches()`. Redundant because patches are already saved.

2. **Undo/redo API routes** - Currently load plan, apply patches, save plan. Should just manipulate patches/redo_stack tables.

3. **loadPlan() in plan-store.ts (line 715)** - Currently saves immediately after loading. Makes no sense.

4. **PUT /api/sqlite/[planId] endpoint** - Remove entirely. No client code should be saving full plans.

---

## 1. Database Schema Changes

### 1.1 Current Schema (unchanged)

```sql
-- plan table - stores full plan JSON (used for checkpoints, not mutations)
CREATE TABLE plan (
  id TEXT PRIMARY KEY DEFAULT 'main',
  data JSON NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- patches table - THE source of truth for mutations
CREATE TABLE patches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patches JSON NOT NULL,
  inverse_patches JSON NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- redo_stack table - stores patches for redo
CREATE TABLE redo_stack (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patches JSON NOT NULL,
  inverse_patches JSON NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 1.2 New: Checkpoint Metadata Table

```sql
CREATE TABLE IF NOT EXISTS checkpoint_metadata (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_patch_id INTEGER NOT NULL,  -- ID of last patch included in checkpoint
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Purpose:** Track which patches are included in each checkpoint. When hydrating:
1. Find latest checkpoint
2. Load plan from checkpoint's .db file
3. Get patches WHERE id > checkpoint.last_patch_id
4. Apply those patches

---

## 2. New Functions to Implement

### 2.1 sqlite-storage.ts - Core Hydration

```typescript
/**
 * Reconstruct a plan from checkpoint + patches.
 * This is THE way to load a plan. No fallback.
 *
 * Algorithm:
 * 1. Find latest checkpoint (if any)
 * 2. Load plan from checkpoint database (or main db if no checkpoint)
 * 3. Get patches created after checkpoint
 * 4. Apply patches sequentially
 * 5. Run migrations if needed
 * 6. Return reconstructed plan
 */
export function hydratePlan(planId: string): Plan;

/**
 * Get all patches created after a given patch ID.
 */
export function getPatchesAfter(planId: string, afterPatchId: number): StoredPatchEntry[];

/**
 * Get the most recent checkpoint metadata.
 */
export function getLatestCheckpointMetadata(planId: string): CheckpointMetadata | null;
```

### 2.2 sqlite-storage.ts - Checkpoint Management

```typescript
/**
 * Create a checkpoint and record its metadata.
 * This saves the current hydrated state to the plan table,
 * then copies the .db file as a checkpoint.
 */
export function createCheckpointWithMetadata(planId: string, name: string): string;

/**
 * Create a checkpoint if patches since last checkpoint exceeds threshold.
 * Called after appending patches.
 */
export function maybeCreateCheckpoint(planId: string, threshold?: number): string | null;
```

### 2.3 sqlite-storage.ts - Simplified Undo/Redo

```typescript
/**
 * Perform undo by moving last patch to redo stack.
 * No plan loading or saving - patches are the source of truth.
 * Returns the description of what was undone.
 */
export function undoPatch(planId: string): { description: string } | null;

/**
 * Perform redo by moving last redo entry back to patches.
 * Returns the description of what was redone.
 */
export function redoPatch(planId: string): { description: string } | null;
```

---

## 3. Changes to Existing Functions

### 3.1 loadPlan() - Use Hydration Only

```typescript
// BEFORE
export function loadPlan(planId: string): Plan | null {
  const row = db.prepare('SELECT data FROM plan WHERE id = ?').get('main');
  if (!row) return null;
  return migratePlan(JSON.parse(row.data));
}

// AFTER
export function loadPlan(planId: string): Plan | null {
  if (!planExists(planId)) return null;
  return hydratePlan(planId);  // No fallback
}
```

### 3.2 appendPatch() - Add Auto-Checkpoint

```typescript
export function appendPatch(planId: string, entry: ...): number {
  // ... existing append logic ...

  // Auto-checkpoint if threshold exceeded
  maybeCreateCheckpoint(planId);

  return patchId;
}
```

### 3.3 createCheckpoint() - Record Metadata

```typescript
export function createCheckpoint(planId: string, name: string): string {
  // First, save current hydrated state to plan table
  const currentPlan = hydratePlan(planId);
  savePlan(planId, currentPlan);

  // Get last patch ID for metadata
  const lastPatch = getLastPatch(planId);
  const lastPatchId = lastPatch?.id ?? 0;

  // Copy .db file as checkpoint
  const checkpointId = crypto.randomUUID();
  copyFileSync(getDbPath(planId), getCheckpointDbPath(planId, checkpointId));

  // Record metadata
  recordCheckpointMetadata(planId, checkpointId, name, lastPatchId);

  return checkpointId;
}
```

---

## 4. API Route Changes

### 4.1 DELETE: PUT /api/sqlite/[planId]

Remove the entire PUT handler. No client code should be saving full plans.

```typescript
// DELETE THIS ENTIRE HANDLER
export async function PUT(request, { params }) { ... }
```

### 4.2 SIMPLIFY: POST /api/sqlite/[planId]/undo

```typescript
// BEFORE: Load plan, apply inverse patches, save plan, manipulate tables
// AFTER: Just manipulate tables, return new plan via hydration

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { planId } = await params;

  const result = undoPatch(planId);
  if (!result) {
    return NextResponse.json({ error: 'Nothing to undo' }, { status: 400 });
  }

  // Return freshly hydrated plan
  const plan = hydratePlan(planId);
  const canUndo = getPatchCount(planId) > 0;
  const canRedo = getRedoCount(planId) > 0;

  return NextResponse.json({
    ok: true,
    plan,
    canUndo,
    canRedo,
    description: result.description,
  });
}
```

### 4.3 SIMPLIFY: POST /api/sqlite/[planId]/redo

Same pattern as undo - just manipulate tables, hydrate fresh.

### 4.4 KEEP: GET /api/sqlite/[planId]

No changes needed - it calls `loadPlan()` which now uses hydration.

### 4.5 KEEP: POST /api/sqlite/[planId]/patches

No changes needed - still appends patches.

---

## 5. Client-Side Changes (plan-store.ts)

### 5.1 Remove savePlanToLibrary() from All Mutations

Every mutation currently follows this pattern:

```typescript
someAction: async () => {
  set((state) => {
    mutateWithPatches(state, (plan) => { /* mutation */ }, 'description');
    state.isDirty = true;
    state.isSaving = true;
  });

  // REMOVE THIS ENTIRE BLOCK
  const newState = get();
  if (newState.currentPlan) {
    await savePlanToLibrary(newState.currentPlan);
  }

  set((state) => {
    state.isSaving = false;
    state.lastSaved = Date.now();
  });
}
```

After:

```typescript
someAction: async () => {
  set((state) => {
    mutateWithPatches(state, (plan) => { /* mutation */ }, 'description');
    // Patches are sent by mutateWithPatches via appendPatch
    // No need to save full plan
  });
}
```

### 5.2 Remove savePlanToLibrary() from loadPlan

```typescript
// BEFORE
loadPlan: (plan: Plan) => {
  set((state) => { ... });
  savePlanToLibrary(plan).catch(e => { ... });  // WHY?
},

// AFTER
loadPlan: (plan: Plan) => {
  set((state) => { ... });
  // No save - plan came from server, already persisted
},
```

### 5.3 Remove storage.savePlan() from sqlite-client.ts

```typescript
// DELETE THIS METHOD
async savePlan(id: string, data: PlanData): Promise<void> { ... }
```

### 5.4 Keep savePlanToLibrary() for New/Copy Plan Only

These are the only legitimate uses:

```typescript
// createNewPlan - initial save of brand new plan
// copyPlan - initial save of copied plan
```

---

## 6. Test Cases Required

### 6.1 Core Hydration Tests

```typescript
describe('hydratePlan', () => {
  it('returns plan from plan table when no patches exist');
  it('applies single patch to base plan');
  it('applies multiple patches in order');
  it('applies 1000 patches correctly');

  it('uses checkpoint when available');
  it('only applies patches after checkpoint');
  it('uses most recent checkpoint when multiple exist');

  it('runs migrations on hydrated plan');
  it('throws on corrupted patch (no silent fallback)');
  it('throws on missing plan (no silent fallback)');
});
```

### 6.2 Checkpoint Tests

```typescript
describe('checkpoints', () => {
  it('createCheckpoint saves hydrated state to plan table first');
  it('createCheckpoint records last_patch_id in metadata');
  it('maybeCreateCheckpoint triggers at threshold');
  it('maybeCreateCheckpoint does nothing below threshold');
  it('getPatchesAfter returns only patches after given ID');
});
```

### 6.3 Undo/Redo Tests

```typescript
describe('undo/redo without full plan saves', () => {
  it('undoPatch moves patch to redo_stack');
  it('undoPatch returns null when no patches');
  it('redoPatch moves entry back to patches');
  it('redoPatch returns null when redo_stack empty');

  it('hydratePlan after undo reflects undone state');
  it('hydratePlan after redo reflects redone state');
  it('new patch clears redo_stack');
});
```

### 6.4 Migration Script Tests

```typescript
describe('migration script', () => {
  it('creates checkpoint for plan with no checkpoints');
  it('skips plan that already has checkpoint');
  it('handles plan with 0 patches');
  it('records correct last_patch_id');
});
```

### 6.5 Integration Tests

```typescript
describe('full flow', () => {
  it('create plan -> mutate -> reload -> correct state');
  it('create plan -> mutate 100x -> undo 50x -> reload -> correct state');
  it('create plan -> mutate 600x -> auto-checkpoint created');
  it('copy plan -> original and copy are independent');
});
```

---

## 7. Additional Considerations

### 7.1 Cross-Tab Sync

**Currently works via:**
- `appendPatch()` calls `withBroadcast()` which broadcasts `plan-updated`
- Other tabs receive message and call `loadPlanById()` which reloads the plan

**After hydration:** No changes needed. `appendPatch()` still broadcasts, and `loadPlanById()` will use hydration. Other tabs will see the updated state.

### 7.2 Schema Migrations During Hydration

When `hydratePlan()` loads a plan with an old schema version:
1. Load plan from checkpoint (old schema)
2. Apply patches
3. Run `migratePlan()`
4. Create a new checkpoint at new schema (so we don't re-migrate every load)

Patches are schema-agnostic - they're path-based operations like `{ op: 'replace', path: ['metadata', 'name'], value: 'X' }`. They should apply regardless of schema version since migrations add new fields but don't change existing paths.

### 7.3 Checkpoint Restore

When restoring a checkpoint via `restoreCheckpoint()`:
1. Copies checkpoint .db over main .db
2. This replaces the plan table, patches table, AND checkpoint_metadata table
3. Any patches made after the checkpoint are lost (intentional)
4. The plan returns to the exact state at checkpoint time

This is correct behavior - no changes needed.

### 7.4 Auto-Checkpoint Timing

`maybeCreateCheckpoint()` should be called AFTER the patch is appended, not during. Checkpointing involves:
1. Hydrating the current plan (to get latest state)
2. Saving to plan table
3. Copying .db file

This should NOT block the mutation response. Options:
- Fire-and-forget (don't await)
- Run in a setTimeout/setImmediate
- Let the client mutation return immediately

### 7.5 Import Functions

`importVarieties`, `importSeedMixes`, `importProducts`, `importSeedOrders` all use `mutateWithPatches` internally. They'll automatically benefit from the change - no modifications needed.

---

## 8. Pre-Deployment Migration

### Pre-Deployment (Required)

Run migration script on all existing plans:

```typescript
// scripts/create-initial-checkpoints.ts
import { listPlans, createCheckpointWithMetadata, getPatchCount } from '../src/lib/sqlite-storage';

async function migrate() {
  const plans = listPlans();

  for (const plan of plans) {
    const patchCount = getPatchCount(plan.id);
    console.log(`${plan.id}: ${patchCount} patches`);

    // Create checkpoint at current state
    const checkpointId = createCheckpointWithMetadata(
      plan.id,
      `Migration checkpoint (${patchCount} patches)`
    );
    console.log(`  Created checkpoint ${checkpointId}`);
  }
}

migrate();
```

This ensures:
- Every plan has at least one checkpoint
- Hydration has a known-good starting point
- No "cold start" performance issues

### Deployment

1. Run migration script
2. Deploy new code
3. Old plans hydrate from checkpoint (fast)
4. New mutations only append patches
5. Auto-checkpoints keep things bounded

---

## 9. Rollback Plan

If something goes wrong:

1. **Checkpoints are .db file copies** - They contain full state. Restore by copying checkpoint over main db.

2. **Patches are append-only** - They're still there even if hydration has a bug.

3. **Emergency fix script:**
```typescript
// Rebuild plan table from hydration for all plans
for (const plan of listPlans()) {
  const hydrated = hydratePlan(plan.id);
  savePlan(plan.id, hydrated);
}
```

---

## 10. Performance Considerations

### Mutation Latency

| Scenario | Before | After |
|----------|--------|-------|
| Single mutation | 50-100ms (full save) | ~5ms (patch append) |
| Drag 10 items | 99 API calls | 10 patch appends |

### Load Time

| Scenario | Time |
|----------|------|
| Checkpoint + 0 patches | ~35ms |
| Checkpoint + 100 patches | ~50ms |
| Checkpoint + 500 patches | ~100ms |

### Auto-Checkpoint Threshold

- Default: 500 patches
- Keeps replay time < 100ms
- Checkpoints created in background after mutation completes

---

## 11. Implementation Order

### Phase 1: Core Infrastructure (sqlite-storage.ts)
1. Add `checkpoint_metadata` table to schema
2. Implement `getPatchesAfter()`
3. Implement `getLatestCheckpointMetadata()`
4. Implement `hydratePlan()`
5. Implement `undoPatch()` / `redoPatch()`
6. Implement `createCheckpointWithMetadata()`
7. Implement `maybeCreateCheckpoint()`
8. Write tests for all above

### Phase 2: API Routes
9. Simplify undo route (no load/save)
10. Simplify redo route (no load/save)
11. Delete PUT route entirely
12. Update loadPlan() to use hydratePlan()

### Phase 3: Client Changes
13. Remove all savePlanToLibrary() calls from mutations
14. Remove savePlan from sqlite-client.ts
15. Remove save-on-load from loadPlan action

### Phase 4: Migration & Deploy
16. Write migration script
17. Run migration on backup first
18. Verify all plans hydrate correctly
19. Deploy

---

## 12. Files to Modify

| File | Changes |
|------|---------|
| `src/lib/sqlite-storage.ts` | Add hydration functions, checkpoint metadata, simplified undo/redo |
| `src/lib/plan-store.ts` | Remove ~60 savePlanToLibrary() calls |
| `src/lib/sqlite-client.ts` | Remove savePlan() method |
| `src/app/api/sqlite/[planId]/route.ts` | Delete PUT handler |
| `src/app/api/sqlite/[planId]/undo/route.ts` | Simplify to patch manipulation only |
| `src/app/api/sqlite/[planId]/redo/route.ts` | Simplify to patch manipulation only |
| `src/lib/__tests__/hydration.test.ts` | NEW - comprehensive hydration tests |
| `scripts/create-initial-checkpoints.ts` | NEW - migration script |

---

## 13. Success Criteria

- [ ] Drag operation goes from ~99 API calls to ~10
- [ ] No data loss - all existing plans load correctly after migration
- [ ] Undo/redo works correctly
- [ ] Cross-tab sync works (broadcasts after checkpoint creation)
- [ ] Load time < 100ms for plans with < 500 patches since checkpoint
- [ ] All tests pass
- [ ] No fallback code in production

---

## 14. What We're NOT Doing

- **No fallback to full snapshot** - If hydration fails, it's a bug
- **No deprecated endpoints** - PUT is deleted, not deprecated
- **No feature flags** - Clean cutover after migration
- **No gradual rollout** - Migration script runs on all plans before deploy
