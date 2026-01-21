'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlanDropdown from './PlanDropdown';
import CopyPlanModal from './CopyPlanModal';
import { usePlanStore, useUndoRedo, copyPlan } from '@/lib/plan-store';
import { Z_INDEX } from '@/lib/z-index';
import type { CopyPlanOptions } from './CopyPlanModal';

interface AppHeaderProps {
  /** Optional toolbar content to render below the main nav */
  toolbar?: React.ReactNode;
}

export default function AppHeader({ toolbar }: AppHeaderProps) {
  const pathname = usePathname();

  // Use centralized store state - automatically syncs across tabs
  const activePlanId = usePlanStore((state) => state.activePlanId);
  const currentPlanName = usePlanStore((state) => state.currentPlan?.metadata.name ?? 'Untitled');
  const refreshPlanList = usePlanStore((state) => state.refreshPlanList);

  // Undo/redo from store
  const { canUndo, canRedo, undo, redo, undoCount, redoCount } = useUndoRedo();

  // Modal state
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Save handler - now just shows confirmation since saving is automatic
  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    // With SQLite storage, all changes are auto-saved on each mutation.
    // Ctrl+S / Save button just provides user feedback that everything is saved.
    await new Promise((resolve) => setTimeout(resolve, 200)); // Brief visual feedback
    setIsSaving(false);
  }, [isSaving]);

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
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, undo, redo, handleSave]);

  // Determine which tab is active
  const isExplorerActive = pathname === '/';
  const isTimelineActive = pathname.startsWith('/timeline/');
  const isBedsActive = pathname.startsWith('/beds/');
  const isOverviewActive = pathname.startsWith('/overview/');
  const isReportsActive = pathname.startsWith('/reports/');
  const isVarietiesActive = pathname === '/varieties';
  const isSeedMixesActive = pathname === '/seed-mixes';
  const isProductsActive = pathname === '/products';
  const isMarketsActive = pathname === '/markets';

  // Links - go to active plan's views
  const timelineHref = activePlanId ? `/timeline/${activePlanId}` : '/plans';
  const bedsHref = activePlanId ? `/beds/${activePlanId}` : '/plans';
  const overviewHref = activePlanId ? `/overview/${activePlanId}` : '/plans';
  const reportsHref = activePlanId ? `/reports/${activePlanId}` : '/plans';

  return (
    <>
    <header className="sticky top-0 bg-white border-b border-gray-200" style={{ zIndex: Z_INDEX.APP_HEADER }}>
      {/* Main Navigation Bar */}
      <div className="px-4 py-2 flex items-center gap-6">
        {/* Logo / App Name */}
        <Link
          href="/plans"
          className="text-lg font-bold text-gray-900 hover:text-blue-600 transition-colors"
        >
          Crop Planner
        </Link>

        {/* View Tabs - plan views when plan selected, global views always */}
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
              <Link
                href={overviewHref}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  isOverviewActive
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                Map
              </Link>
              {/* Reports dropdown */}
              <div className="relative group">
                <Link
                  href={reportsHref}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors inline-flex items-center gap-1 ${
                    isReportsActive
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  Reports
                  <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </Link>
                {/* Dropdown menu */}
                <div className="absolute left-0 top-full pt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150" style={{ zIndex: Z_INDEX.DROPDOWN }}>
                  <div className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[120px]">
                    <Link
                      href={`${reportsHref}?tab=revenue`}
                      className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Revenue
                    </Link>
                    <Link
                      href={`${reportsHref}?tab=seeds`}
                      className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Seeds
                    </Link>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <span className="px-3 py-1.5 text-sm text-gray-500">
              Select a plan to get started
            </span>
          )}

          {/* Separator */}
          <div className="w-px h-5 bg-gray-300 mx-1" />

          {/* Global pages - always visible */}
          <Link
            href="/varieties"
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              isVarietiesActive
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            Varieties
          </Link>
          <Link
            href="/seed-mixes"
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              isSeedMixesActive
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            Mixes
          </Link>
          <Link
            href="/products"
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              isProductsActive
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            Products
          </Link>
          <Link
            href="/markets"
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              isMarketsActive
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            Markets
          </Link>
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

        {/* Save/History buttons - only show when a plan is active */}
        {activePlanId && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-2 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 disabled:text-gray-400 disabled:bg-gray-50 disabled:cursor-not-allowed"
              title="Save checkpoint - Ctrl+S"
            >
              {isSaving ? '...' : '💾'}
            </button>
            <button
              onClick={() => setShowCopyModal(true)}
              className="px-2 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200"
              title="Save As (copy plan)"
            >
              📋
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

    {/* Modals/Panels - outside header to avoid stacking context issues */}
    {showCopyModal && (
      <CopyPlanModal
        isOpen={showCopyModal}
        currentPlanName={currentPlanName}
        onClose={() => setShowCopyModal(false)}
        onCopy={async (options: CopyPlanOptions) => {
          await copyPlan(options);
          await refreshPlanList();
          setShowCopyModal(false);
        }}
      />
    )}

  </>
  );
}
