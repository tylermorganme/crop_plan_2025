/**
 * SQLite Redo API Route
 *
 * POST /api/sqlite/[planId]/redo - Perform redo operation
 *
 * Simplified implementation that just manipulates the patches table:
 * 1. Moves the last entry from redo_stack back to patches table
 * 2. Returns the hydrated plan (reconstructed from checkpoint + patches)
 *
 * No full plan save needed - patches are the source of truth.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  planExists,
  redoPatch,
  hydratePlan,
  getPatchCount,
  getRedoStackCount,
} from '@/lib/sqlite-storage';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

/**
 * POST /api/sqlite/[planId]/redo
 * Performs a redo operation on the plan.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { planId } = await params;

  if (!planExists(planId)) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  try {
    // Move last redo entry back to patches (simplified - no plan load/save)
    const result = redoPatch(planId);
    if (!result) {
      return NextResponse.json({ error: 'Nothing to redo' }, { status: 400 });
    }

    // Get the freshly hydrated plan
    const plan = hydratePlan(planId);

    // Get updated counts
    const canUndo = getPatchCount(planId) > 0;
    const canRedo = getRedoStackCount(planId) > 0;

    return NextResponse.json({
      ok: true,
      plan,
      canUndo,
      canRedo,
      description: result.description,
    });
  } catch (error) {
    console.error('Failed to redo:', error);
    return NextResponse.json({ error: 'Failed to redo' }, { status: 500 });
  }
}
