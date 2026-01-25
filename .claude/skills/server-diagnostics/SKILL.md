---
name: server-diagnostics
description: "Diagnose server-side issues using JSONL logs. Use when debugging slow operations, failed requests, migration problems, data corruption, or understanding what happened during a user session. Triggers: performance issues, 500 errors, 'why is this slow', plan loading problems, undo/redo bugs, checkpoint issues, migration failures."
---

# Server Diagnostics

Server operations are logged to `data/logs/server.jsonl` in JSONL format (one JSON object per line, each with a `timestamp` field).

## Before Analyzing Logs

Check when the logging code was modified relative to log entries. Log entries from before recent code changes may reflect bugs that are already fixed:

```bash
# When was logging code last modified?
git log --oneline -3 -- src/lib/server-logger.ts src/lib/sqlite-storage.ts

# Compare to earliest log entry you're analyzing
head -1 data/logs/server.jsonl | jq .timestamp
```

## Log Location and Format

```bash
# View recent logs
tail -30 data/logs/server.jsonl

# Pretty-print recent logs
tail -10 data/logs/server.jsonl | jq .

# Follow logs in real-time
tail -f data/logs/server.jsonl | jq .
```

## Event Types

Check `src/lib/server-logger.ts` for the authoritative list of event types and their fields. The key event types are:

- **api_call** - Every API request with method, path, status, duration
- **hydration** - Plan loading from checkpoint + patches
- **migration** - Schema version upgrades
- **patch_save** - User mutations being saved
- **undo/redo** - Undo/redo operations
- **checkpoint** - Checkpoint creation events
- **schema_mismatch** - Client with old code trying to edit plan migrated by newer code
- **error** - Failures with stack traces

## Common Diagnostic Patterns

### Performance Investigation

```bash
# Find slow operations (hydration, API calls with high durationMs)
grep '"durationMs"' data/logs/server.jsonl | jq 'select(.durationMs > 100)'

# Find slow hydrations specifically
grep '"event":"hydration"' data/logs/server.jsonl | jq 'select(.durationMs > 100)'
```

**What to look for:**
- High `patchesApplied` count in hydration events (may need checkpoint)
- Repeated migrations (`migrated: true` on every load)
- Missing checkpoints (`checkpointId: null` with high patch count)

### Failed Requests

```bash
# Find non-200 responses
grep '"api_call"' data/logs/server.jsonl | jq 'select(.status != 200)'

# Find 500 errors
grep '"status":500' data/logs/server.jsonl
```

### Migration Issues

```bash
# See all migration events
grep '"event":"migration"' data/logs/server.jsonl | jq .

# Check if migrations are running repeatedly (bug symptom)
grep '"migrated":true' data/logs/server.jsonl | jq '{planId, timestamp}'
```

**Healthy pattern:** Migration runs once, then subsequent loads show `migrated: false` and use a checkpoint.

**Unhealthy pattern:** Every load shows `migrated: true` - indicates checkpoint selection bug.

### Session Reconstruction

```bash
# All activity for a specific plan
grep '"planId":"PLAN_ID_HERE"' data/logs/server.jsonl | jq .

# Recent activity timeline
tail -100 data/logs/server.jsonl | jq '{event, planId, timestamp, status, durationMs}'
```

### Checkpoint Health

```bash
# See checkpoint creation
grep '"event":"checkpoint"' data/logs/server.jsonl | jq .

# Check if auto-checkpoints are triggering (slow hydration recovery)
grep 'auto-checkpoint' data/logs/server.jsonl
```

### Schema Mismatch Detection

```bash
# Find schema mismatch events (client with old code trying to edit)
grep '"event":"schema_mismatch"' data/logs/server.jsonl | jq .

# Check for 409 responses (schema mismatch rejections)
grep '"status":409' data/logs/server.jsonl | jq .
```

**When this happens:** A client with older code (lower CURRENT_SCHEMA_VERSION) tries to save changes to a plan that was migrated by newer code. The server rejects the patch with HTTP 409.

**Resolution:** User needs to refresh their browser to get the latest code.

## Self-Healing Behaviors

The system includes automatic recovery mechanisms:

1. **Post-migration checkpoint** - After migrating a plan, a checkpoint is created so future loads don't re-migrate
2. **Slow hydration checkpoint** - If hydration exceeds threshold, a checkpoint is created to speed up future loads

These appear in logs as checkpoint events with descriptive names.

## When Logs Are Insufficient

If server logs don't reveal the issue:

1. Check browser console for client-side errors
2. Check SQLite database directly: `sqlite3 data/plans/{planId}.db`
3. Inspect the patches table: `SELECT id, description, created_at FROM patches ORDER BY id DESC LIMIT 10;`
4. Check checkpoint_metadata table for checkpoint state
