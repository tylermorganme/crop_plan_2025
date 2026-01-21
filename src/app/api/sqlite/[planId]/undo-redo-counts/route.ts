/**
 * SQLite Undo/Redo Counts API Route
 *
 * GET /api/sqlite/[planId]/undo-redo-counts - Get counts of available undo/redo operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { planExists, getPatchCount, getRedoStackCount } from '@/lib/sqlite-storage';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

/**
 * GET /api/sqlite/[planId]/undo-redo-counts
 * Returns the number of available undo and redo operations.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { planId } = await params;

  if (!planExists(planId)) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  try {
    const undoCount = getPatchCount(planId);
    const redoCount = getRedoStackCount(planId);

    return NextResponse.json({ undoCount, redoCount });
  } catch (error) {
    console.error('Failed to get undo/redo counts:', error);
    return NextResponse.json({ error: 'Failed to get counts' }, { status: 500 });
  }
}
