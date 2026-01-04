/**
 * Single Plan API - Get, update, delete a specific plan
 *
 * GET    /api/plans/:planId - Get plan by ID
 * PUT    /api/plans/:planId - Update plan
 * DELETE /api/plans/:planId - Delete plan
 */

import { NextRequest, NextResponse } from 'next/server';
import { fileStorage } from '@/lib/file-storage';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { planId } = await params;
    const data = await fileStorage.getPlan(planId);

    if (!data) {
      return NextResponse.json(
        { error: 'Plan not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data });
  } catch (e) {
    console.error('Failed to get plan:', e);
    return NextResponse.json(
      { error: 'Failed to get plan' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { planId } = await params;
    const { data } = await req.json();

    if (!data) {
      return NextResponse.json(
        { error: 'Plan data is required' },
        { status: 400 }
      );
    }

    await fileStorage.savePlan(planId, data);
    return NextResponse.json({ ok: true, id: planId });
  } catch (e) {
    console.error('Failed to update plan:', e);
    return NextResponse.json(
      { error: 'Failed to update plan' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { planId } = await params;
    await fileStorage.deletePlan(planId);
    return NextResponse.json({ ok: true, id: planId });
  } catch (e) {
    console.error('Failed to delete plan:', e);
    return NextResponse.json(
      { error: 'Failed to delete plan' },
      { status: 500 }
    );
  }
}
