/**
 * SQLite Checkpoint API Routes (individual checkpoint)
 *
 * DELETE /api/sqlite/[planId]/checkpoints/[checkpointId] - Delete checkpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  planExists,
  deleteCheckpoint,
} from '@/lib/sqlite-storage';

interface RouteParams {
  params: Promise<{ planId: string; checkpointId: string }>;
}

/**
 * DELETE /api/sqlite/[planId]/checkpoints/[checkpointId]
 * Deletes a checkpoint.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { planId, checkpointId } = await params;

  if (!planExists(planId)) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  try {
    deleteCheckpoint(planId, checkpointId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete checkpoint:', error);
    return NextResponse.json({ error: 'Failed to delete checkpoint' }, { status: 500 });
  }
}
