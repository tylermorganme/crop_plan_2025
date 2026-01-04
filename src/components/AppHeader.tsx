'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlanDropdown from './PlanDropdown';
import { usePlanStore, useUndoRedo } from '@/lib/plan-store';

interface AppHeaderProps {
  /** Optional toolbar content to render below the main nav */
  toolbar?: React.ReactNode;
}

export default function AppHeader({ toolbar }: AppHeaderProps) {
  const pathname = usePathname();

  // Use centralized store state - automatically syncs across tabs
  const activePlanId = usePlanStore((state) => state.activePlanId);

  // Undo/redo from store
  const { canUndo, canRedo, undo, redo, undoCount, redoCount } = useUndoRedo();

  // Global keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) redo();
        } else {
          if (canUndo) undo();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        if (canRedo) redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, undo, redo]);

  // Determine which tab is active
  const isExplorerActive = pathname === '/';
  const isTimelineActive = pathname.startsWith('/timeline/');
  const isBedsActive = pathname.startsWith('/beds/');

  // Links - go to active plan's views
  const timelineHref = activePlanId ? `/timeline/${activePlanId}` : '/plans';
  const bedsHref = activePlanId ? `/beds/${activePlanId}` : '/plans';

  return (
    <header className="bg-white border-b border-gray-200">
      {/* Main Navigation Bar */}
      <div className="px-4 py-2 flex items-center gap-6">
        {/* Logo / App Name */}
        <Link
          href="/plans"
          className="text-lg font-bold text-gray-900 hover:text-blue-600 transition-colors"
        >
          Crop Planner
        </Link>

        {/* View Tabs - only show Explorer/Timeline/Beds when a plan is selected */}
        <nav className="flex items-center gap-1">
          {activePlanId ? (
            <>
              <Link
                href="/"
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  isExplorerActive
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                Explorer
              </Link>
              <Link
                href={timelineHref}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  isTimelineActive
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                Timeline
              </Link>
              <Link
                href={bedsHref}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  isBedsActive
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                Beds
              </Link>
            </>
          ) : (
            <span className="px-3 py-1.5 text-sm text-gray-500">
              Select a plan to get started
            </span>
          )}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Undo/Redo buttons - only show when a plan is active */}
        {activePlanId && (
          <div className="flex items-center gap-1">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="px-2 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 disabled:text-gray-400 disabled:bg-gray-50 disabled:border-gray-200 disabled:cursor-not-allowed"
              title={`Undo${undoCount > 0 ? ` (${undoCount})` : ''} - Ctrl+Z`}
            >
              ↶
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="px-2 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 disabled:text-gray-400 disabled:bg-gray-50 disabled:border-gray-200 disabled:cursor-not-allowed"
              title={`Redo${redoCount > 0 ? ` (${redoCount})` : ''} - Ctrl+Shift+Z`}
            >
              ↷
            </button>
          </div>
        )}

        {/* Plan Dropdown */}
        <PlanDropdown />
      </div>

      {/* View-Specific Toolbar */}
      {toolbar && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          {toolbar}
        </div>
      )}
    </header>
  );
}
