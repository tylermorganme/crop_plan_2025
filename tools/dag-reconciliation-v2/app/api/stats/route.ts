import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../lib/db';

interface StatsRow {
  total: number;
  verified: number;
  removed: number;
  issues: number;
  implemented: number;
  pending: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get('table');

  const db = getDb();

  let whereClause = '';
  const params: string[] = [];
  if (table) {
    whereClause = 'WHERE table_name = ?';
    params.push(table === 'crops' ? 'Crops' : 'BedPlan');
  }

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(verified) as verified,
      SUM(remove) as removed,
      SUM(has_issue) as issues,
      SUM(implemented) as implemented,
      COUNT(*) - SUM(verified) - SUM(remove) - SUM(has_issue) as pending
    FROM columns ${whereClause}
  `).get(...params) as StatsRow;

  return NextResponse.json({ stats });
}
