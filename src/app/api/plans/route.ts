/**
 * Plans API - List and create plans
 *
 * GET  /api/plans     - List all plans
 * POST /api/plans     - Create a new plan
 */

import { NextRequest, NextResponse } from 'next/server';
import { fileStorage } from '@/lib/file-storage';

export async function GET() {
  try {
    const plans = await fileStorage.getPlanList();
    return NextResponse.json({ plans });
  } catch (e) {
    console.error('Failed to list plans:', e);
    return NextResponse.json(
      { error: 'Failed to list plans' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { id, data } = await req.json();

    if (!id || !data) {
      return NextResponse.json(
        { error: 'Plan ID and data are required' },
        { status: 400 }
      );
    }

    await fileStorage.savePlan(id, data);
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    console.error('Failed to create plan:', e);
    return NextResponse.json(
      { error: 'Failed to create plan' },
      { status: 500 }
    );
  }
}
