/**
 * SQLite Plans List API Route
 *
 * GET /api/sqlite - List all plans
 */

import { NextResponse } from 'next/server';
import { listPlans } from '@/lib/sqlite-storage';

/**
 * GET /api/sqlite
 * List all plans from the index.
 */
export async function GET() {
  try {
    const plans = listPlans();
    return NextResponse.json({ plans });
  } catch (error) {
    console.error('Failed to list plans:', error);
    return NextResponse.json({ error: 'Failed to list plans' }, { status: 500 });
  }
}
