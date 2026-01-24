/**
 * SQLite Undo API Route
 *
 * POST /api/sqlite/[planId]/undo - Perform undo operation
 *
 * Simplified implementation that just manipulates the patches table:
 * 1. Moves the last patch from patches table to redo_stack
 * 2. Returns the hydrated plan (reconstructed from checkpoint + remaining patches)
 *
 * No full plan save needed - patches are the source of truth.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  planExists,
  undoPatch,
  hydratePlan,
  getPatchCount,
  getRedoStackCount,
} from '@/lib/sqlite-storage';
import { logEvent } from '@/lib/server-logger';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

/**
 * POST /api/sqlite/[planId]/undo
 * Performs an undo operation on the plan.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const { planId } = await params;

  if (!planExists(planId)) {
    logEvent({ event: 'api_call', method: 'POST', path: `/api/sqlite/${planId}/undo`, planId, status: 404, durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  try {
    // Move last patch to redo stack (simplified - no plan load/save)
    const result = undoPatch(planId);
    if (!result) {
      logEvent({ event: 'api_call', method: 'POST', path: `/api/sqlite/${planId}/undo`, planId, status: 400, durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Nothing to undo' }, { status: 400 });
    }

    // Get the freshly hydrated plan
    const plan = hydratePlan(planId);

    // Get updated counts
    const canUndo = getPatchCount(planId) > 0;
    const canRedo = getRedoStackCount(planId) > 0;

    logEvent({ event: 'api_call', method: 'POST', path: `/api/sqlite/${planId}/undo`, planId, status: 200, durationMs: Date.now() - startTime });
    return NextResponse.json({
      ok: true,
      plan,
      canUndo,
      canRedo,
      description: result.description,
    });
  } catch (error) {
    console.error('Failed to undo:', error);
    logEvent({ event: 'api_call', method: 'POST', path: `/api/sqlite/${planId}/undo`, planId, status: 500, durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Failed to undo' }, { status: 500 });
  }
}
