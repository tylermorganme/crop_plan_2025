/**
 * SQLite Patches API Routes
 *
 * GET /api/sqlite/[planId]/patches - Get all patches for a plan
 * POST /api/sqlite/[planId]/patches - Append a new patch
 * DELETE /api/sqlite/[planId]/patches - Clear all patches
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  appendPatch,
  getPatches,
  clearPatches,
  clearRedoStack,
  planExists,
  toStoredPatch,
  fromStoredPatch,
  getPlanSchemaVersion,
} from '@/lib/sqlite-storage';
import type { PatchEntry } from '@/lib/plan-types';
import { logEvent } from '@/lib/server-logger';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

/**
 * GET /api/sqlite/[planId]/patches
 * Returns all patches for a plan, converted to client format.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const { planId } = await params;

  if (!planExists(planId)) {
    logEvent({ event: 'api_call', method: 'GET', path: `/api/sqlite/${planId}/patches`, planId, status: 404, durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  try {
    const storedPatches = getPatches(planId);
    const patches = storedPatches.map(fromStoredPatch);
    logEvent({ event: 'api_call', method: 'GET', path: `/api/sqlite/${planId}/patches`, planId, status: 200, durationMs: Date.now() - startTime });
    return NextResponse.json({ patches });
  } catch (error) {
    console.error('Failed to get patches:', error);
    logEvent({ event: 'api_call', method: 'GET', path: `/api/sqlite/${planId}/patches`, planId, status: 500, durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Failed to get patches' }, { status: 500 });
  }
}

/**
 * POST /api/sqlite/[planId]/patches
 * Appends a new patch entry.
 *
 * Validates client schema version against plan's current schema version
 * to detect stale clients that loaded an older version of the plan.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const { planId } = await params;

  try {
    const body = await request.json();
    const entry = body.patch as PatchEntry;
    const clientSchemaVersion = body.clientSchemaVersion as number | undefined;

    if (!entry || !entry.patches || !entry.inversePatches) {
      logEvent({ event: 'api_call', method: 'POST', path: `/api/sqlite/${planId}/patches`, planId, status: 400, durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Invalid patch data' }, { status: 400 });
    }

    // Schema staleness check: reject if client is running older code than the plan requires
    if (clientSchemaVersion !== undefined) {
      const planSchemaVersion = getPlanSchemaVersion(planId);
      if (planSchemaVersion !== null && clientSchemaVersion < planSchemaVersion) {
        console.warn(
          `[patches] Schema mismatch for plan ${planId}: client version ${clientSchemaVersion}, plan version ${planSchemaVersion}`
        );
        logEvent({
          event: 'schema_mismatch',
          planId,
          clientVersion: clientSchemaVersion,
          planVersion: planSchemaVersion,
          operation: 'patch_save',
        });
        logEvent({ event: 'api_call', method: 'POST', path: `/api/sqlite/${planId}/patches`, planId, status: 409, durationMs: Date.now() - startTime });
        return NextResponse.json(
          { error: 'SCHEMA_MISMATCH', message: 'Plan was updated by newer code. Please refresh.' },
          { status: 409 }
        );
      }
    }

    // Clear redo stack when new mutation is made (invalidates redo history)
    clearRedoStack(planId);

    const id = appendPatch(planId, toStoredPatch(entry));
    logEvent({ event: 'api_call', method: 'POST', path: `/api/sqlite/${planId}/patches`, planId, status: 200, durationMs: Date.now() - startTime });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error('Failed to append patch:', error);
    logEvent({ event: 'api_call', method: 'POST', path: `/api/sqlite/${planId}/patches`, planId, status: 500, durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Failed to append patch' }, { status: 500 });
  }
}

/**
 * DELETE /api/sqlite/[planId]/patches
 * Clears all patches for a plan.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const { planId } = await params;

  try {
    clearPatches(planId);
    logEvent({ event: 'api_call', method: 'DELETE', path: `/api/sqlite/${planId}/patches`, planId, status: 200, durationMs: Date.now() - startTime });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to clear patches:', error);
    logEvent({ event: 'api_call', method: 'DELETE', path: `/api/sqlite/${planId}/patches`, planId, status: 500, durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Failed to clear patches' }, { status: 500 });
  }
}
