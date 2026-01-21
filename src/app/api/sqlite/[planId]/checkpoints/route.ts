/**
 * SQLite Checkpoints API Routes
 *
 * GET /api/sqlite/[planId]/checkpoints - List all checkpoints
 * POST /api/sqlite/[planId]/checkpoints - Create a new checkpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  planExists,
  listCheckpoints,
  createCheckpoint,
} from '@/lib/sqlite-storage';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

/**
 * GET /api/sqlite/[planId]/checkpoints
 * Returns all checkpoints for a plan.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { planId } = await params;

  if (!planExists(planId)) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  try {
    const checkpoints = listCheckpoints(planId);
    return NextResponse.json({ checkpoints });
  } catch (error) {
    console.error('Failed to list checkpoints:', error);
    return NextResponse.json({ error: 'Failed to list checkpoints' }, { status: 500 });
  }
}

/**
 * POST /api/sqlite/[planId]/checkpoints
 * Creates a new checkpoint with the given name.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { planId } = await params;

  if (!planExists(planId)) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  try {
    const body = await request.json();
    const name = body.name as string;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Checkpoint name is required' }, { status: 400 });
    }

    const checkpointId = createCheckpoint(planId, name);
    return NextResponse.json({ ok: true, checkpointId });
  } catch (error) {
    console.error('Failed to create checkpoint:', error);
    return NextResponse.json({ error: 'Failed to create checkpoint' }, { status: 500 });
  }
}
