/**
 * SQLite Checkpoint Restore API Route
 *
 * POST /api/sqlite/[planId]/checkpoints/[checkpointId]/restore - Restore checkpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  planExists,
  restoreCheckpoint,
} from '@/lib/sqlite-storage';

interface RouteParams {
  params: Promise<{ planId: string; checkpointId: string }>;
}

/**
 * POST /api/sqlite/[planId]/checkpoints/[checkpointId]/restore
 * Restores a checkpoint (overwrites current plan with checkpoint).
 * Returns the restored plan.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { planId, checkpointId } = await params;

  if (!planExists(planId)) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  try {
    const plan = restoreCheckpoint(planId, checkpointId);
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    console.error('Failed to restore checkpoint:', error);
    const message = error instanceof Error ? error.message : 'Failed to restore checkpoint';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
