import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const LOG_FILE = join(process.cwd(), 'console.log');

// Initialize log file on first request
let initialized = false;

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const { level, args, timestamp } = data;

    // Create or clear log file on first write of each dev session
    if (!initialized) {
      writeFileSync(LOG_FILE, `--- Console log started at ${new Date().toISOString()} ---\n`);
      initialized = true;
    }

    const prefix = level === 'log' ? '' : `[${level.toUpperCase()}] `;
    const line = `[${timestamp}] ${prefix}${args.map((a: unknown) =>
      typeof a === 'string' ? a : JSON.stringify(a, null, 2)
    ).join(' ')}\n`;

    appendFileSync(LOG_FILE, line);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Failed to write log:', e);
    return NextResponse.json({ error: 'Failed to write log' }, { status: 500 });
  }
}
