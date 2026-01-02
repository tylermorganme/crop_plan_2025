import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { CropConfig } from '@/lib/entities/crop-config';

const CROPS_FILE = join(process.cwd(), 'src/data/crops.json');

interface CropsData {
  crops: CropConfig[];
}

/**
 * GET /api/crops - Get all crops
 */
export async function GET() {
  try {
    const content = readFileSync(CROPS_FILE, 'utf-8');
    const data: CropsData = JSON.parse(content);
    return NextResponse.json(data);
  } catch (e) {
    console.error('Failed to read crops:', e);
    return NextResponse.json(
      { error: 'Failed to read crops' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/crops - Update a single crop by ID
 */
export async function PUT(req: NextRequest) {
  try {
    const updated: CropConfig = await req.json();

    if (!updated.id) {
      return NextResponse.json(
        { error: 'Crop ID is required' },
        { status: 400 }
      );
    }

    // Read current crops
    const content = readFileSync(CROPS_FILE, 'utf-8');
    const data: CropsData = JSON.parse(content);

    // Find and update the crop
    const index = data.crops.findIndex(c => c.id === updated.id);
    if (index === -1) {
      return NextResponse.json(
        { error: `Crop not found: ${updated.id}` },
        { status: 404 }
      );
    }

    // Update the crop
    data.crops[index] = updated;

    // Write back to file
    writeFileSync(CROPS_FILE, JSON.stringify(data, null, 2) + '\n');

    return NextResponse.json({ ok: true, crop: updated });
  } catch (e) {
    console.error('Failed to update crop:', e);
    return NextResponse.json(
      { error: 'Failed to update crop' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/crops - Create a new crop
 */
export async function POST(req: NextRequest) {
  try {
    const newCrop: CropConfig = await req.json();

    if (!newCrop.identifier || !newCrop.crop) {
      return NextResponse.json(
        { error: 'Identifier and crop name are required' },
        { status: 400 }
      );
    }

    // Read current crops
    const content = readFileSync(CROPS_FILE, 'utf-8');
    const data: CropsData = JSON.parse(content);

    // Check for duplicate identifier
    if (data.crops.some(c => c.identifier === newCrop.identifier)) {
      return NextResponse.json(
        { error: `Crop identifier already exists: ${newCrop.identifier}` },
        { status: 409 }
      );
    }

    // Generate ID if not provided
    if (!newCrop.id) {
      newCrop.id = `crop-${Date.now()}`;
    }

    // Add the new crop
    data.crops.push(newCrop);

    // Write back to file
    writeFileSync(CROPS_FILE, JSON.stringify(data, null, 2) + '\n');

    return NextResponse.json({ ok: true, crop: newCrop }, { status: 201 });
  } catch (e) {
    console.error('Failed to create crop:', e);
    return NextResponse.json(
      { error: 'Failed to create crop' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/crops?id=xxx - Delete a crop by ID
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Crop ID is required' },
        { status: 400 }
      );
    }

    // Read current crops
    const content = readFileSync(CROPS_FILE, 'utf-8');
    const data: CropsData = JSON.parse(content);

    // Find and remove the crop
    const index = data.crops.findIndex(c => c.id === id);
    if (index === -1) {
      return NextResponse.json(
        { error: `Crop not found: ${id}` },
        { status: 404 }
      );
    }

    const deleted = data.crops.splice(index, 1)[0];

    // Write back to file
    writeFileSync(CROPS_FILE, JSON.stringify(data, null, 2) + '\n');

    return NextResponse.json({ ok: true, crop: deleted });
  } catch (e) {
    console.error('Failed to delete crop:', e);
    return NextResponse.json(
      { error: 'Failed to delete crop' },
      { status: 500 }
    );
  }
}
