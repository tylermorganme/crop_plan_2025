/**
 * API route to get actual values for a column from the source data.
 * Accepts column header name as query param to match against JSON keys.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Path to the crop-api data files
const DATA_PATH = path.join(process.cwd(), '..', '..', 'crop-api', 'src', 'data');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const headerParam = searchParams.get('header');

  // Parse the column ID (e.g., "crops_1" -> table: "crops", col: 1)
  const match = id.match(/^(crops|bedplan)_(\d+)$/);
  if (!match) {
    return NextResponse.json({ error: 'Invalid column ID' }, { status: 400 });
  }

  const [, table] = match;
  const dataFile = table === 'crops' ? 'crops.json' : 'bed-plan.json';
  const dataPath = path.join(DATA_PATH, dataFile);

  if (!fs.existsSync(dataPath)) {
    return NextResponse.json({ error: 'Data file not found' }, { status: 404 });
  }

  try {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const rows = table === 'crops' ? data.crops : data.plantings;

    if (!rows || rows.length === 0) {
      return NextResponse.json({ values: [], header: null });
    }

    // Use provided header name, or return error if not provided
    if (!headerParam) {
      return NextResponse.json({ error: 'Header parameter required' }, { status: 400 });
    }

    // Check if the header exists in the data
    const keys = Object.keys(rows[0]);
    if (!keys.includes(headerParam)) {
      return NextResponse.json({
        error: `Column "${headerParam}" not found in data`,
        availableColumns: keys,
      }, { status: 404 });
    }

    const header = headerParam;

    // Extract values for this column
    const values = rows.map((row: Record<string, unknown>, index: number) => ({
      rowNum: index + 2, // Excel row numbers start at 2 (1 is header)
      value: row[header],
    }));

    // Get unique values with counts
    const valueCounts = new Map<string, number>();
    for (const { value } of values) {
      const key = JSON.stringify(value);
      valueCounts.set(key, (valueCounts.get(key) || 0) + 1);
    }

    const uniqueValues = Array.from(valueCounts.entries())
      .map(([key, count]) => ({ value: JSON.parse(key), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50); // Limit to top 50 unique values

    return NextResponse.json({
      header,
      totalRows: values.length,
      uniqueCount: valueCounts.size,
      uniqueValues,
      sampleValues: values, // All rows
    });
  } catch (e) {
    console.error('Error reading column values:', e);
    return NextResponse.json({ error: 'Failed to read data' }, { status: 500 });
  }
}
