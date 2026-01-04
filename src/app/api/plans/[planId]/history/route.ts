/**
 * History API - Combined view of checkpoints, auto-saves, and stash
 *
 * GET /api/plans/[planId]/history - Get unified history for a plan
 */

import { NextRequest, NextResponse } from 'next/server';
import { fileStorage } from '@/lib/file-storage';
import type { HistoryEntry } from '@/lib/plan-types';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { planId } = await params;

    const [checkpoints, allSnapshots, stash] = await Promise.all([
      fileStorage.getCheckpoints(planId),
      fileStorage.getSnapshots(),
      fileStorage.getStash(),
    ]);

    const entries: HistoryEntry[] = [];

    // Add checkpoints
    for (const cp of checkpoints) {
      entries.push({
        id: cp.id,
        type: 'checkpoint',
        name: cp.name,
        timestamp: cp.timestamp,
        plan: cp.plan,
      });
    }

    // Add auto-saves (only for this plan)
    for (const snap of allSnapshots) {
      if (snap.plan.id === planId) {
        entries.push({
          id: snap.id,
          type: 'auto-save',
          name: 'Auto-save',
          timestamp: snap.timestamp,
          plan: snap.plan,
        });
      }
    }

    // Add stash entries (only for this plan)
    for (const s of stash) {
      if (s.plan.id === planId) {
        entries.push({
          id: s.id,
          type: 'stash',
          name: s.reason,
          timestamp: s.timestamp,
          plan: s.plan,
        });
      }
    }

    // Sort by timestamp descending (most recent first)
    entries.sort((a, b) => b.timestamp - a.timestamp);

    return NextResponse.json({ history: entries });
  } catch (e) {
    console.error('Failed to get history:', e);
    return NextResponse.json(
      { error: 'Failed to get history' },
      { status: 500 }
    );
  }
}
