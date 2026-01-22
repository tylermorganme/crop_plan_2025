import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const LOG_DIR = join(process.cwd(), 'tmp');
const LOG_FILE = join(LOG_DIR, 'browser-logs.txt');

// Ensure tmp directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch (e) {
  // Directory already exists
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { level, message, timestamp, location, stack } = body;

    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${location}\n${message}\n${stack ? `Stack: ${stack}\n` : ''}---\n`;

    appendFileSync(LOG_FILE, logEntry);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to log client message:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
