import { NextRequest, NextResponse } from 'next/server';
import { getDb, broadcastUpdate } from '../../../lib/db';

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
  verified: number;
  remove: number;
  has_issue: number;
  implemented: number;
  skip: number;
  notes: string;
  code_field: string | null;
}

type ColumnStatus = 'include' | 'skip' | 'remove' | null;

// Convert DB columns (skip/remove as 0/1) to status field
function dbToStatus(row: ColumnRow): ColumnStatus {
  if (row.remove) return 'remove';
  if (row.skip) return 'skip';
  return null;
}

// Convert row to API response format
function rowToColumn(row: ColumnRow) {
  return {
    id: row.id,
    table_name: row.table_name,
    col_num: row.col_num,
    col_letter: row.col_letter,
    header: row.header,
    classification: row.classification,
    level: row.level,
    formula: row.formula,
    variance: row.variance,
    formula_count: row.formula_count,
    value_count: row.value_count,
    unique_formulas: row.unique_formulas,
    depends_on: JSON.parse(row.depends_on || '[]'),
    external_deps: JSON.parse(row.external_deps || '[]'),
    verified: Boolean(row.verified),
    status: dbToStatus(row),
    has_issue: Boolean(row.has_issue),
    implemented: Boolean(row.implemented),
    notes: row.notes,
    code_field: row.code_field,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const row = db.prepare('SELECT * FROM columns WHERE id = ?').get(id) as ColumnRow | undefined;

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(rowToColumn(row));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { verified, status, has_issue, implemented, notes, code_field } = body;

  const db = getDb();

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (verified !== undefined) {
    updates.push('verified = ?');
    values.push(verified ? 1 : 0);
  }

  // Handle new status field - converts to skip/remove columns
  if (status !== undefined) {
    updates.push('skip = ?');
    updates.push('remove = ?');
    values.push(status === 'skip' ? 1 : 0);
    values.push(status === 'remove' ? 1 : 0);
  }

  if (has_issue !== undefined) {
    updates.push('has_issue = ?');
    values.push(has_issue ? 1 : 0);
  }
  if (implemented !== undefined) {
    updates.push('implemented = ?');
    values.push(implemented ? 1 : 0);
  }
  if (notes !== undefined) {
    updates.push('notes = ?');
    values.push(notes);
  }
  if (code_field !== undefined) {
    updates.push('code_field = ?');
    values.push(code_field);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const sql = `UPDATE columns SET ${updates.join(', ')} WHERE id = ?`;
  const result = db.prepare(sql).run(...values);

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Get updated column and broadcast
  const updated = db.prepare('SELECT * FROM columns WHERE id = ?').get(id) as ColumnRow;
  broadcastUpdate('column-updated', rowToColumn(updated));

  return NextResponse.json({ success: true });
}
