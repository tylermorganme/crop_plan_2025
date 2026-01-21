/**
 * SQLite Redo API Route
 *
 * POST /api/sqlite/[planId]/redo - Perform redo operation
 *
 * This endpoint:
 * 1. Pops the last entry from the redo stack
 * 2. Applies the forward patches to the plan
 * 3. Pushes the patch back to the patches table
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
  popFromRedoStack,
  appendPatch,
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
    // Pop from redo stack
    const redoEntry = popFromRedoStack(planId);
    if (!redoEntry) {
      return NextResponse.json({ error: 'Nothing to redo' }, { status: 400 });
    }

    // Load current plan
    const plan = loadPlan(planId);
    if (!plan) {
      return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 });
    }

    // Apply forward patches to restore the redone state
    const restoredPlan = applyPatches(plan, redoEntry.patches);

    // Save the restored plan
    savePlan(planId, restoredPlan);

    // Push back to patches table
    appendPatch(planId, {
      patches: redoEntry.patches,
      inversePatches: redoEntry.inversePatches,
      description: redoEntry.description,
    });

    // Get updated counts
    const canRedo = getRedoStackCount(planId) > 0;

    return NextResponse.json({
      ok: true,
      plan: restoredPlan,
      canUndo: true,
      canRedo,
      description: redoEntry.description,
    });
  } catch (error) {
    console.error('Failed to redo:', error);
    return NextResponse.json({ error: 'Failed to redo' }, { status: 500 });
  }
}
