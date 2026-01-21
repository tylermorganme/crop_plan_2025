/**
 * SQLite Undo API Route
 *
 * POST /api/sqlite/[planId]/undo - Perform undo operation
 *
 * This endpoint:
 * 1. Pops the last patch from the patches table
 * 2. Applies the inverse patches to the plan
 * 3. Pushes the patch to the redo stack
 * 4. Saves the updated plan
 */

import { NextRequest, NextResponse } from 'next/server';
import { applyPatches, enablePatches } from 'immer';

// Enable Immer patches plugin
enablePatches();
import {
  loadPlan,
  savePlan,
  planExists,
  popLastPatch,
  pushToRedoStack,
  getPatchCount,
} from '@/lib/sqlite-storage';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

/**
 * POST /api/sqlite/[planId]/undo
 * Performs an undo operation on the plan.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { planId } = await params;

  if (!planExists(planId)) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  try {
    // Pop the last patch
    const lastPatch = popLastPatch(planId);
    if (!lastPatch) {
      return NextResponse.json({ error: 'Nothing to undo' }, { status: 400 });
    }

    // Load current plan
    const plan = loadPlan(planId);
    if (!plan) {
      return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 });
    }

    // Apply inverse patches to restore previous state
    const restoredPlan = applyPatches(plan, lastPatch.inversePatches);

    // Save the restored plan
    savePlan(planId, restoredPlan);

    // Push to redo stack
    pushToRedoStack(planId, {
      patches: lastPatch.patches,
      inversePatches: lastPatch.inversePatches,
      description: lastPatch.description,
    });

    // Get updated counts
    const canUndo = getPatchCount(planId) > 0;

    return NextResponse.json({
      ok: true,
      plan: restoredPlan,
      canUndo,
      canRedo: true,
      description: lastPatch.description,
    });
  } catch (error) {
    console.error('Failed to undo:', error);
    return NextResponse.json({ error: 'Failed to undo' }, { status: 500 });
  }
}
