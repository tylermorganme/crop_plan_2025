/**
 * Snapshot API - Create tiered auto-save snapshots
 *
 * POST /api/plans/snapshot - Create a snapshot for version history
 *
 * Snapshots are separate from current state syncs:
 * - Sync: Updates {planId}.json with current state (frequent, 5s throttle)
 * - Snapshot: Adds to {planId}.snapshots.json.gz history (every 15min)
 *
 * Tiered retention policy is applied server-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fileStorage } from '@/lib/file-storage';
import type { PlanSnapshot } from '@/lib/storage-adapter';
import type { Plan } from '@/lib/plan-types';

export async function POST(req: NextRequest) {
  try {
    const { planId, plan } = await req.json() as { planId: string; plan: Plan };

    if (!planId || !plan) {
      return NextResponse.json(
        { error: 'planId and plan are required' },
        { status: 400 }
      );
    }

    const snapshot: PlanSnapshot = {
      id: `${planId}-${Date.now()}`,
      timestamp: Date.now(),
      plan,
    };

    await fileStorage.saveSnapshot(snapshot);

    return NextResponse.json({
      ok: true,
      snapshotId: snapshot.id,
      timestamp: snapshot.timestamp,
    });
  } catch (e) {
    console.error('Failed to save snapshot:', e);
    return NextResponse.json(
      { error: 'Failed to save snapshot' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/plans/snapshot?planId=xxx - Get snapshots for a plan
 */
export async function GET(req: NextRequest) {
  try {
    const planId = req.nextUrl.searchParams.get('planId');

    // Get all snapshots and filter by planId if provided
    const allSnapshots = await fileStorage.getSnapshots();

    const snapshots = planId
      ? allSnapshots.filter(s => s.plan.id === planId)
      : allSnapshots;

    // Return summaries (not full plan data) for listing
    const summaries = snapshots.map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      planId: s.plan.id,
      planName: s.plan.metadata?.name ?? 'Untitled',
      plantingCount: s.plan.plantings?.length ?? 0,
    }));

    return NextResponse.json({ snapshots: summaries });
  } catch (e) {
    console.error('Failed to get snapshots:', e);
    return NextResponse.json(
      { error: 'Failed to get snapshots' },
      { status: 500 }
    );
  }
}
