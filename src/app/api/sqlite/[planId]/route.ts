/**
 * SQLite Plan API Routes
 *
 * Provides REST endpoints for plan CRUD operations using SQLite storage.
 *
 * GET /api/sqlite/[planId] - Load a plan
 * PUT /api/sqlite/[planId] - Save a plan
 * DELETE /api/sqlite/[planId] - Delete a plan
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  loadPlan,
  savePlan,
  deletePlan,
  updatePlanIndex,
  PlanFromFutureError,
} from '@/lib/sqlite-storage';
import { CURRENT_SCHEMA_VERSION } from '@/lib/migrations';
import type { Plan } from '@/lib/entities/plan';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

/**
 * GET /api/sqlite/[planId]
 * Load a plan from SQLite storage.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { planId } = await params;

  try {
    const plan = loadPlan(planId);

    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    return NextResponse.json({ plan });
  } catch (error) {
    if (error instanceof PlanFromFutureError) {
      return NextResponse.json(
        {
          error: 'Plan requires newer app version',
          planVersion: error.planVersion,
          appVersion: error.appVersion,
        },
        { status: 409 }
      );
    }

    console.error('Failed to load plan:', error);
    return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 });
  }
}

/**
 * PUT /api/sqlite/[planId]
 * Save a plan to SQLite storage.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { planId } = await params;

  try {
    const body = await request.json();
    const plan = body.plan as Plan;

    if (!plan) {
      return NextResponse.json({ error: 'Missing plan data' }, { status: 400 });
    }

    // Ensure plan has required fields
    if (!plan.id || !plan.metadata) {
      return NextResponse.json({ error: 'Invalid plan structure' }, { status: 400 });
    }

    // Set schema version if not present
    if (!plan.schemaVersion) {
      plan.schemaVersion = CURRENT_SCHEMA_VERSION;
    }

    savePlan(planId, plan);

    // Update plan index
    updatePlanIndex(plan);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to save plan:', error);
    return NextResponse.json({ error: 'Failed to save plan' }, { status: 500 });
  }
}

/**
 * DELETE /api/sqlite/[planId]
 * Delete a plan from SQLite storage.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { planId } = await params;

  try {
    const deleted = deletePlan(planId);

    if (!deleted) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete plan:', error);
    return NextResponse.json({ error: 'Failed to delete plan' }, { status: 500 });
  }
}
