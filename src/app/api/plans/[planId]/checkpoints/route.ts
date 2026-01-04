/**
 * Checkpoints API - User-created save points
 *
 * GET /api/plans/[planId]/checkpoints - List checkpoints for a plan
 * POST /api/plans/[planId]/checkpoints - Create a new checkpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { fileStorage } from '@/lib/file-storage';
import type { Checkpoint } from '@/lib/plan-types';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { planId } = await params;
    const checkpoints = await fileStorage.getCheckpoints(planId);
    return NextResponse.json({ checkpoints });
  } catch (e) {
    console.error('Failed to get checkpoints:', e);
    return NextResponse.json(
      { error: 'Failed to get checkpoints' },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { planId } = await params;
    const { checkpoint } = await req.json() as { checkpoint: Checkpoint };

    if (!checkpoint || checkpoint.planId !== planId) {
      return NextResponse.json(
        { error: 'Invalid checkpoint data' },
        { status: 400 }
      );
    }

    await fileStorage.saveCheckpoint(checkpoint);

    return NextResponse.json({
      ok: true,
      checkpointId: checkpoint.id,
    });
  } catch (e) {
    console.error('Failed to save checkpoint:', e);
    return NextResponse.json(
      { error: 'Failed to save checkpoint' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { planId } = await params;
    const { checkpointId } = await req.json() as { checkpointId: string };

    if (!checkpointId) {
      return NextResponse.json(
        { error: 'checkpointId is required' },
        { status: 400 }
      );
    }

    await fileStorage.deleteCheckpoint(checkpointId, planId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Failed to delete checkpoint:', e);
    return NextResponse.json(
      { error: 'Failed to delete checkpoint' },
      { status: 500 }
    );
  }
}
