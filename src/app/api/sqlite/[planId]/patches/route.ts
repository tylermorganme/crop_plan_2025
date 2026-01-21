/**
 * SQLite Patches API Routes
 *
 * GET /api/sqlite/[planId]/patches - Get all patches for a plan
 * POST /api/sqlite/[planId]/patches - Append a new patch
 * DELETE /api/sqlite/[planId]/patches - Clear all patches
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  appendPatch,
  getPatches,
  clearPatches,
  planExists,
  toStoredPatch,
  fromStoredPatch,
} from '@/lib/sqlite-storage';
import type { PatchEntry } from '@/lib/plan-types';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

/**
 * GET /api/sqlite/[planId]/patches
 * Returns all patches for a plan, converted to client format.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { planId } = await params;

  if (!planExists(planId)) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  try {
    const storedPatches = getPatches(planId);
    const patches = storedPatches.map(fromStoredPatch);
    return NextResponse.json({ patches });
  } catch (error) {
    console.error('Failed to get patches:', error);
    return NextResponse.json({ error: 'Failed to get patches' }, { status: 500 });
  }
}

/**
 * POST /api/sqlite/[planId]/patches
 * Appends a new patch entry.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { planId } = await params;

  try {
    const body = await request.json();
    const entry = body.patch as PatchEntry;

    if (!entry || !entry.patches || !entry.inversePatches) {
      return NextResponse.json({ error: 'Invalid patch data' }, { status: 400 });
    }

    const id = appendPatch(planId, toStoredPatch(entry));
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error('Failed to append patch:', error);
    return NextResponse.json({ error: 'Failed to append patch' }, { status: 500 });
  }
}

/**
 * DELETE /api/sqlite/[planId]/patches
 * Clears all patches for a plan.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { planId } = await params;

  try {
    clearPatches(planId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to clear patches:', error);
    return NextResponse.json({ error: 'Failed to clear patches' }, { status: 500 });
  }
}
