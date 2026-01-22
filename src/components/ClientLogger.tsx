'use client';

import { useEffect } from 'react';

/**
 * ClientLogger - Intercepts browser console calls and sends them to the server
 *
 * To remove this feature:
 * 1. Delete this file (src/components/ClientLogger.tsx)
 * 2. Delete src/app/api/log-client/route.ts
 * 3. Remove <ClientLogger /> from src/app/layout.tsx
 * 4. Delete tmp/browser-logs.txt if it exists
 */
export function ClientLogger() {
  useEffect(() => {
    // Only intercept in development
    if (process.env.NODE_ENV !== 'development') return;

    const sendLog = (level: string, args: unknown[]) => {
      const message = args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch (e) {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');

      const location = window.location.pathname;
      const timestamp = new Date().toISOString();

      // Get stack trace for errors
      let stack = '';
      if (level === 'error' || level === 'warn') {
        try {
          throw new Error();
        } catch (e) {
          stack = (e as Error).stack || '';
        }
      }

      // Send to server (non-blocking, fire-and-forget)
      fetch('/api/log-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, message, timestamp, location, stack }),
      }).catch(() => {
        // Silently fail - we don't want logging to break the app
      });
    };

    // Store original console methods
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };

    // Wrap console methods
    console.log = (...args: unknown[]) => {
      originalConsole.log(...args);
      sendLog('log', args);
    };

    console.warn = (...args: unknown[]) => {
      originalConsole.warn(...args);
      sendLog('warn', args);
    };

    console.error = (...args: unknown[]) => {
      originalConsole.error(...args);
      sendLog('error', args);
    };

    console.info = (...args: unknown[]) => {
      originalConsole.info(...args);
      sendLog('info', args);
    };

    console.debug = (...args: unknown[]) => {
      originalConsole.debug(...args);
      sendLog('debug', args);
    };

    // Cleanup: restore original console methods
    return () => {
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.info = originalConsole.info;
      console.debug = originalConsole.debug;
    };
  }, []);

  return null; // This component doesn't render anything
}
