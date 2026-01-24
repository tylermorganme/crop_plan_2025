/**
 * Server-side logging for migration, hydration, and patch operations.
 *
 * Logs to data/logs/server.jsonl in JSONL format (one JSON object per line).
 * This enables easy parsing and analysis of server operations.
 *
 * See docs/2026-01-migration-architecture.md for logging strategy rationale.
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const LOG_DIR = join(process.cwd(), 'data', 'logs');
const LOG_FILE = join(LOG_DIR, 'server.jsonl');

/**
 * Log event types for server operations.
 */
export type LogEvent =
  | {
      event: 'hydration';
      planId: string;
      checkpointId: string | null;
      patchesApplied: number;
      migrated: boolean;
      durationMs: number;
    }
  | {
      event: 'migration';
      planId: string;
      fromVersion: number;
      toVersion: number;
      durationMs: number;
    }
  | {
      event: 'patch_save';
      planId: string;
      description: string;
      patchId: number;
    }
  | {
      event: 'undo';
      planId: string;
      description: string;
    }
  | {
      event: 'redo';
      planId: string;
      description: string;
    }
  | {
      event: 'error';
      planId: string;
      operation: string;
      error: string;
      stack?: string;
    };

/**
 * Append a log event to the server log file.
 * Creates the log directory if it doesn't exist.
 */
export function logEvent(event: LogEvent): void {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    const entry = { ...event, timestamp: new Date().toISOString() };
    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {
    // Don't let logging failures break the app
    console.error('[server-logger] Failed to write log:', e);
  }
}
