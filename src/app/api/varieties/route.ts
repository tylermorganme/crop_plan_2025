/**
 * Varieties API - Sync varieties and seed mixes to file storage
 *
 * GET /api/varieties - Load varieties and seed mixes from disk
 * POST /api/varieties - Sync current state to disk
 *
 * This provides durable file-based backup for the variety catalog,
 * similar to how plans are synced to data/plans/.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Variety } from '@/lib/entities/variety';
import type { SeedMix } from '@/lib/entities/seed-mix';

// Storage location
const DATA_DIR = join(process.cwd(), 'data');
const VARIETIES_FILE = join(DATA_DIR, 'varieties.json');

interface VarietyData {
  varieties: Record<string, Variety>;
  seedMixes: Record<string, SeedMix>;
  lastModified: number;
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readData(): VarietyData {
  try {
    if (!existsSync(VARIETIES_FILE)) {
      return { varieties: {}, seedMixes: {}, lastModified: 0 };
    }
    const content = readFileSync(VARIETIES_FILE, 'utf-8');
    return JSON.parse(content) as VarietyData;
  } catch {
    return { varieties: {}, seedMixes: {}, lastModified: 0 };
  }
}

function writeData(data: VarietyData): void {
  ensureDir();
  writeFileSync(VARIETIES_FILE, JSON.stringify(data, null, 2) + '\n');
}

/**
 * GET - Load varieties from file storage
 */
export async function GET() {
  try {
    const data = readData();
    return NextResponse.json(data);
  } catch (e) {
    console.error('Failed to load varieties:', e);
    return NextResponse.json(
      { error: 'Failed to load varieties' },
      { status: 500 }
    );
  }
}

/**
 * POST - Sync varieties to file storage
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      varieties: Record<string, Variety>;
      seedMixes: Record<string, SeedMix>;
    };

    if (!body.varieties || !body.seedMixes) {
      return NextResponse.json(
        { error: 'varieties and seedMixes are required' },
        { status: 400 }
      );
    }

    const data: VarietyData = {
      varieties: body.varieties,
      seedMixes: body.seedMixes,
      lastModified: Date.now(),
    };

    writeData(data);

    return NextResponse.json({
      ok: true,
      varietyCount: Object.keys(body.varieties).length,
      mixCount: Object.keys(body.seedMixes).length,
      timestamp: data.lastModified,
    });
  } catch (e) {
    console.error('Failed to sync varieties:', e);
    return NextResponse.json(
      { error: 'Failed to sync varieties' },
      { status: 500 }
    );
  }
}
