'use client';

import { useEffect } from 'react';

/**
 * Development-only component that intercepts console.log/warn/error
 * and sends them to /api/log for file-based logging.
 *
 * This allows Claude Code to read browser console output from ./console.log
 */
export function DevConsoleLogger() {
  useEffect(() => {
    // Only run in development
    if (process.env.NODE_ENV !== 'development') {
      return;
    }

    // Store original console methods
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    // Helper to send log to API
    const sendLog = (level: string, args: unknown[]) => {
      // Don't log our own fetch requests to avoid infinite loops
      const firstArg = args[0];
      if (typeof firstArg === 'string' && firstArg.includes('/api/log')) {
        return;
      }

      // Fire and forget - don't await to avoid blocking
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level,
          args: args.map(arg => {
            if (arg instanceof Error) {
              return { message: arg.message, stack: arg.stack };
            }
            // Handle circular references and DOM elements
            try {
              return JSON.parse(JSON.stringify(arg));
            } catch {
              return String(arg);
            }
          }),
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {
        // Silently fail - we don't want to spam errors about logging
      });
    };

    // Override console methods
    console.log = (...args: unknown[]) => {
      originalLog.apply(console, args);
      sendLog('log', args);
    };

    console.warn = (...args: unknown[]) => {
      originalWarn.apply(console, args);
      sendLog('warn', args);
    };

    console.error = (...args: unknown[]) => {
      originalError.apply(console, args);
      sendLog('error', args);
    };

    // Cleanup on unmount
    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, []);

  // This component renders nothing
  return null;
}
