import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../lib/db';

interface ColumnRow {
  id: string;
  table_name: string;
  col_num: number;
  col_letter: string;
  header: string;
  classification: string;
  level: number;
  formula: string | null;
  variance: number;
  formula_count: number;
  value_count: number;
  unique_formulas: number;
  depends_on: string;
  external_deps: string;
  is_leaf: number;
  is_root: number;
  verified: number;
  remove: number;
  has_issue: number;
  implemented: number;
  skip: number;
  notes: string;
  code_field: string | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get('table');
  const level = searchParams.get('level');
  const classification = searchParams.get('classification');
  const status = searchParams.get('status');

  const db = getDb();

  let sql = 'SELECT * FROM columns WHERE 1=1';
  const params: (string | number)[] = [];

  if (table) {
    sql += ' AND table_name = ?';
    params.push(table === 'crops' ? 'Crops' : 'BedPlan');
  }
  if (level !== null && level !== undefined) {
    sql += ' AND level = ?';
    params.push(parseInt(level));
  }
  if (classification) {
    sql += ' AND classification = ?';
    params.push(classification);
  }
  if (status === 'pending') {
    sql += ' AND verified = 0 AND remove = 0 AND has_issue = 0';
  } else if (status === 'verified') {
    sql += ' AND verified = 1';
  } else if (status === 'issues') {
    sql += ' AND has_issue = 1';
  } else if (status === 'remove') {
    sql += ' AND remove = 1';
  }

  sql += ' ORDER BY col_num';

  const rows = db.prepare(sql).all(...params) as ColumnRow[];

  // Parse JSON fields and convert booleans
  const columns = rows.map(row => ({
    ...row,
    depends_on: JSON.parse(row.depends_on || '[]'),
    external_deps: JSON.parse(row.external_deps || '[]'),
    verified: Boolean(row.verified),
    remove: Boolean(row.remove),
    has_issue: Boolean(row.has_issue),
    implemented: Boolean(row.implemented),
    skip: Boolean(row.skip),
  }));

  return NextResponse.json(columns);
}
