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

  const column = {
    ...row,
    depends_on: JSON.parse(row.depends_on || '[]'),
    external_deps: JSON.parse(row.external_deps || '[]'),
    verified: Boolean(row.verified),
    remove: Boolean(row.remove),
    has_issue: Boolean(row.has_issue),
    implemented: Boolean(row.implemented),
    skip: Boolean(row.skip),
  };

  return NextResponse.json(column);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { verified, remove, has_issue, implemented, skip, notes, code_field } = body;

  const db = getDb();

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (verified !== undefined) {
    updates.push('verified = ?');
    values.push(verified ? 1 : 0);
  }
  if (remove !== undefined) {
    updates.push('remove = ?');
    values.push(remove ? 1 : 0);
  }
  if (has_issue !== undefined) {
    updates.push('has_issue = ?');
    values.push(has_issue ? 1 : 0);
  }
  if (implemented !== undefined) {
    updates.push('implemented = ?');
    values.push(implemented ? 1 : 0);
  }
  if (skip !== undefined) {
    updates.push('skip = ?');
    values.push(skip ? 1 : 0);
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
  const column = {
    ...updated,
    depends_on: JSON.parse(updated.depends_on || '[]'),
    external_deps: JSON.parse(updated.external_deps || '[]'),
    verified: Boolean(updated.verified),
    remove: Boolean(updated.remove),
    has_issue: Boolean(updated.has_issue),
    implemented: Boolean(updated.implemented),
    skip: Boolean(updated.skip),
  };

  broadcastUpdate('column-updated', column);

  return NextResponse.json({ success: true });
}
