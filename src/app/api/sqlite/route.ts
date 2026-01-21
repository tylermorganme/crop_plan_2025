/**
 * SQLite Plans List API Route
 *
 * GET /api/sqlite - List all plans
 * GET /api/sqlite?rebuild=true - Rebuild index from database files
 */

import { NextRequest, NextResponse } from 'next/server';
import { listPlans, rebuildPlanIndex } from '@/lib/sqlite-storage';

/**
 * GET /api/sqlite
 * List all plans from the index.
 * Add ?rebuild=true to force index rebuild from database files.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rebuild = searchParams.get('rebuild') === 'true';

    const plans = rebuild ? rebuildPlanIndex() : listPlans();
    return NextResponse.json({ plans });
  } catch (error) {
    console.error('Failed to list plans:', error);
    return NextResponse.json({ error: 'Failed to list plans' }, { status: 500 });
  }
}
