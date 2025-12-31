import { NextResponse } from 'next/server';
import { getGraphEdges } from '../../lib/db';

export async function GET() {
  const edges = getGraphEdges();
  return NextResponse.json(edges);
}
