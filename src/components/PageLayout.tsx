'use client';

import type { ReactNode } from 'react';

export interface PageLayoutProps {
  // Optional header (defaults to AppHeader if not provided)
  header?: ReactNode;

  // Optional toolbar/subheader (sits below header, above body)
  toolbar?: ReactNode;

  // Optional left panel (fixed width, fills body height, own scroll)
  leftPanel?: ReactNode;
  leftPanelWidth?: string; // e.g., "w-64", defaults to "w-64"

  // Optional right panel (fixed width, fills body height, own scroll)
  rightPanel?: ReactNode;
  rightPanelWidth?: string; // e.g., "w-80", defaults to "w-80"

  // Center content (flexes to fill remaining space, own scroll)
  children: ReactNode;

  // Optional class overrides
  className?: string;
  contentClassName?: string;
}

/**
 * PageLayout provides a consistent layout structure across the application.
 *
 * Structure:
 * - Fixed height header (full width)
 * - Optional fixed height toolbar (full width)
 * - Body fills remaining viewport height
 *   - Left panel (optional, fixed width, own scroll context)
 *   - Center content (flexes to fill, own scroll context)
 *   - Right panel (optional, fixed width, own scroll context)
 *
 * Benefits:
 * - Eliminates hardcoded height calculations like calc(100vh-51px)
 * - Provides consistent scroll contexts across all pages
 * - Single source of truth for layout structure
 */
export function PageLayout({
  header,
  toolbar,
  leftPanel,
  leftPanelWidth = 'w-64',
  rightPanel,
  rightPanelWidth = 'w-80',
  children,
  className = '',
  contentClassName = '',
}: PageLayoutProps) {
  return (
    <div className={`h-screen flex flex-col overflow-hidden ${className}`}>
      {/* Header (fixed height, sticky) */}
      {header}

      {/* Optional Toolbar (fixed height, below header, full width) */}
      {toolbar && (
        <div className="flex-shrink-0 border-b bg-white w-full">
          {toolbar}
        </div>
      )}

      {/* Body (fills remaining viewport height) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Panel (optional, fixed width, own scroll) */}
        {leftPanel && (
          <div className={`${leftPanelWidth} flex-shrink-0 border-r bg-white overflow-auto`}>
            {leftPanel}
          </div>
        )}

        {/* Center Content (flexes to fill, own scroll) */}
        <div className={`flex-1 min-w-0 overflow-auto ${contentClassName}`}>
          {children}
        </div>

        {/* Right Panel (optional, fixed width, own scroll) */}
        {rightPanel && (
          <div className={`${rightPanelWidth} flex-shrink-0 border-l bg-white overflow-auto`}>
            {rightPanel}
          </div>
        )}
      </div>
    </div>
  );
}
