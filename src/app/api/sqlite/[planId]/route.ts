/**
 * SQLite Plan API Routes
 *
 * Provides REST endpoints for plan operations using SQLite storage.
 *
 * GET /api/sqlite/[planId] - Load a plan (uses hydration: checkpoint + patches)
 * PUT /api/sqlite/[planId] - Save initial plan state (for createNewPlan/copyPlan only)
 * DELETE /api/sqlite/[planId] - Delete a plan
 *
 * NOTE: PUT should only be used for initial plan creation.
 * Regular mutations use POST /api/sqlite/[planId]/patches to append patches.
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
import { logEvent } from '@/lib/server-logger';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

/**
 * GET /api/sqlite/[planId]
 * Load a plan from SQLite storage using hydration.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const { planId } = await params;

  try {
    const plan = loadPlan(planId);

    if (!plan) {
      logEvent({ event: 'api_call', method: 'GET', path: `/api/sqlite/${planId}`, planId, status: 404, durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    logEvent({ event: 'api_call', method: 'GET', path: `/api/sqlite/${planId}`, planId, status: 200, durationMs: Date.now() - startTime });
    return NextResponse.json({ plan });
  } catch (error) {
    if (error instanceof PlanFromFutureError) {
      logEvent({ event: 'api_call', method: 'GET', path: `/api/sqlite/${planId}`, planId, status: 409, durationMs: Date.now() - startTime });
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
    logEvent({ event: 'api_call', method: 'GET', path: `/api/sqlite/${planId}`, planId, status: 500, durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 });
  }
}

/**
 * PUT /api/sqlite/[planId]
 * Save initial plan state to SQLite storage.
 *
 * NOTE: This should only be used for initial plan creation (createNewPlan/copyPlan).
 * Regular mutations should use POST /patches to append patches instead.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const { planId } = await params;

  try {
    const body = await request.json();
    const plan = body.plan as Plan;

    if (!plan) {
      logEvent({ event: 'api_call', method: 'PUT', path: `/api/sqlite/${planId}`, planId, status: 400, durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Missing plan data' }, { status: 400 });
    }

    // Ensure plan has required fields
    if (!plan.id || !plan.metadata) {
      logEvent({ event: 'api_call', method: 'PUT', path: `/api/sqlite/${planId}`, planId, status: 400, durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Invalid plan structure' }, { status: 400 });
    }

    // Set schema version if not present
    if (!plan.schemaVersion) {
      plan.schemaVersion = CURRENT_SCHEMA_VERSION;
    }

    savePlan(planId, plan);

    // Update plan index
    updatePlanIndex(plan);

    logEvent({ event: 'api_call', method: 'PUT', path: `/api/sqlite/${planId}`, planId, status: 200, durationMs: Date.now() - startTime });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to save plan:', error);
    logEvent({ event: 'api_call', method: 'PUT', path: `/api/sqlite/${planId}`, planId, status: 500, durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Failed to save plan' }, { status: 500 });
  }
}

/**
 * DELETE /api/sqlite/[planId]
 * Delete a plan from SQLite storage.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const startTime = Date.now();
  const { planId } = await params;

  try {
    const deleted = deletePlan(planId);

    if (!deleted) {
      logEvent({ event: 'api_call', method: 'DELETE', path: `/api/sqlite/${planId}`, planId, status: 404, durationMs: Date.now() - startTime });
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    logEvent({ event: 'api_call', method: 'DELETE', path: `/api/sqlite/${planId}`, planId, status: 200, durationMs: Date.now() - startTime });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete plan:', error);
    logEvent({ event: 'api_call', method: 'DELETE', path: `/api/sqlite/${planId}`, planId, status: 500, durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Failed to delete plan' }, { status: 500 });
  }
}
