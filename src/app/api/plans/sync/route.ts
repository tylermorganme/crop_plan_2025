/**
 * Sync API - Sync plan to file storage
 *
 * POST /api/plans/sync - Sync current plan state to disk
 *
 * This is called alongside IndexedDB saves for dual-write durability.
 * The file storage acts as a backup that survives browser data loss.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fileStorage } from '@/lib/file-storage';
import type { PlanData } from '@/lib/storage-adapter';

export async function POST(req: NextRequest) {
  try {
    const { planId, data } = await req.json() as { planId: string; data: PlanData };

    if (!planId || !data) {
      return NextResponse.json(
        { error: 'planId and data are required' },
        { status: 400 }
      );
    }

    await fileStorage.savePlan(planId, data);

    return NextResponse.json({
      ok: true,
      synced: planId,
      timestamp: Date.now(),
    });
  } catch (e) {
    console.error('Failed to sync plan:', e);
    return NextResponse.json(
      { error: 'Failed to sync plan' },
      { status: 500 }
    );
  }
}
