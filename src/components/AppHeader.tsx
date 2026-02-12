'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlanDropdown from './PlanDropdown';
import SaveAsModal from './SaveAsModal';
import { usePlanStore, useUndoRedo, copyPlan } from '@/lib/plan-store';
import { Z_INDEX } from '@/lib/z-index';

// Hook to check if we're on the client (avoids hydration mismatch)
function useHasMounted() {
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);
  return hasMounted;
}

interface AppHeaderProps {
  /** Optional toolbar content to render below the main nav */
  toolbar?: React.ReactNode;
}

export default function AppHeader({ toolbar }: AppHeaderProps) {
  const pathname = usePathname();
  const hasMounted = useHasMounted();

  // Use centralized store state - automatically syncs across tabs
  // Only access activePlanId after mount to avoid hydration mismatch
  const activePlanId = usePlanStore((state) => hasMounted ? state.activePlanId : null);
  const currentPlanName = usePlanStore((state) => state.currentPlan?.metadata.name ?? 'Untitled');
  const currentPlanNotes = usePlanStore((state) => state.currentPlan?.notes);
  const refreshPlanList = usePlanStore((state) => state.refreshPlanList);

  // Undo/redo from store
  const { canUndo, canRedo, undo, redo, undoCount, redoCount } = useUndoRedo();

  // Modal state
  const [showCopyModal, setShowCopyModal] = useState(false);

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
        setShowCopyModal(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, undo, redo]);

  // Determine which tab is active
  const isExplorerActive = pathname === '/';
  const isTimelineActive = pathname.startsWith('/timeline/');
  const isPlantingsActive = pathname.startsWith('/plantings/');
  const isBedsActive = pathname.startsWith('/beds/');
  const isOverviewActive = pathname.startsWith('/overview/');
  const isReportsActive = pathname.startsWith('/reports/');
  const isSettingsActive = pathname.startsWith('/settings/');
  const isCropsActive = pathname.startsWith('/crops/');
  const isVarietiesActive = pathname === '/varieties';
  const isSeedMixesActive = pathname === '/seed-mixes';
  const isProductsActive = pathname === '/products';
  const isMarketsActive = pathname === '/markets';
  const isSeedSearchActive = pathname === '/seed-search';

  // Config dropdown is active if any of its sub-pages are active
  const isConfigActive = isBedsActive || isCropsActive || isVarietiesActive || isSeedMixesActive || isProductsActive || isMarketsActive || isSeedSearchActive || isSettingsActive;

  // Links - go to active plan's views
  const timelineHref = activePlanId ? `/timeline/${activePlanId}` : '/plans';
  const plantingsHref = activePlanId ? `/plantings/${activePlanId}` : '/plans';
  const bedsHref = activePlanId ? `/beds/${activePlanId}` : '/plans';
  const overviewHref = activePlanId ? `/overview/${activePlanId}` : '/plans';
  const reportsHref = activePlanId ? `/reports/${activePlanId}` : '/plans';
  const settingsHref = activePlanId ? `/settings/${activePlanId}` : '/plans';
  const cropsHref = activePlanId ? `/crops/${activePlanId}` : '/plans';

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

        {/* View Tabs - plan views when plan selected */}
        <nav className="flex items-center gap-1">
          {/* Plan-specific tabs - only show when a plan is selected */}
          {activePlanId && (
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
                href={plantingsHref}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  isPlantingsActive
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                Plantings
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
                    <Link
                      href={`${reportsHref}?tab=production`}
                      className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Production
                    </Link>
                    <Link
                      href={`${reportsHref}?tab=portions`}
                      className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Portions
                    </Link>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Config dropdown - always visible */}
          <div className="relative group">
            <button
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors inline-flex items-center gap-1 ${
                isConfigActive
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              Config
              <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {/* Dropdown menu */}
            <div className="absolute left-0 top-full pt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150" style={{ zIndex: Z_INDEX.DROPDOWN }}>
              <div className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]">
                {activePlanId && (
                  <>
                    <Link
                      href={bedsHref}
                      className={`block px-3 py-1.5 text-sm hover:bg-gray-100 ${
                        isBedsActive ? 'text-blue-700 bg-blue-50' : 'text-gray-700'
                      }`}
                    >
                      Beds
                    </Link>
                    <div className="border-t border-gray-100 my-1" />
                  </>
                )}
                <Link
                  href="/varieties"
                  className={`block px-3 py-1.5 text-sm hover:bg-gray-100 ${
                    isVarietiesActive ? 'text-blue-700 bg-blue-50' : 'text-gray-700'
                  }`}
                >
                  Varieties
                </Link>
                <Link
                  href="/seed-mixes"
                  className={`block px-3 py-1.5 text-sm hover:bg-gray-100 ${
                    isSeedMixesActive ? 'text-blue-700 bg-blue-50' : 'text-gray-700'
                  }`}
                >
                  Seed Mixes
                </Link>
                <Link
                  href="/products"
                  className={`block px-3 py-1.5 text-sm hover:bg-gray-100 ${
                    isProductsActive ? 'text-blue-700 bg-blue-50' : 'text-gray-700'
                  }`}
                >
                  Products
                </Link>
                <Link
                  href="/markets"
                  className={`block px-3 py-1.5 text-sm hover:bg-gray-100 ${
                    isMarketsActive ? 'text-blue-700 bg-blue-50' : 'text-gray-700'
                  }`}
                >
                  Markets
                </Link>
                <Link
                  href="/seed-search"
                  className={`block px-3 py-1.5 text-sm hover:bg-gray-100 ${
                    isSeedSearchActive ? 'text-blue-700 bg-blue-50' : 'text-gray-700'
                  }`}
                >
                  Seed Search
                </Link>
                {activePlanId && (
                  <>
                    <div className="border-t border-gray-100 my-1" />
                    <Link
                      href={cropsHref}
                      className={`block px-3 py-1.5 text-sm hover:bg-gray-100 ${
                        isCropsActive ? 'text-blue-700 bg-blue-50' : 'text-gray-700'
                      }`}
                    >
                      Crops
                    </Link>
                    <Link
                      href={settingsHref}
                      className={`block px-3 py-1.5 text-sm hover:bg-gray-100 ${
                        isSettingsActive ? 'text-blue-700 bg-blue-50' : 'text-gray-700'
                      }`}
                    >
                      Settings
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
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

        {/* Copy plan button - only show when a plan is active */}
        {activePlanId && (
          <button
            onClick={() => setShowCopyModal(true)}
            className="px-2 py-1 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200"
            title="Copy plan - Ctrl+S"
          >
            💾
          </button>
        )}

        {/* Debug button - copies useful context */}
        {activePlanId && (
          <button
            onClick={() => {
              const debugInfo = {
                url: typeof window !== 'undefined' ? window.location.href : '',
                planId: activePlanId,
                planName: currentPlanName,
                pathname,
                timestamp: new Date().toISOString(),
              };
              navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
              // Brief visual feedback
              const btn = document.activeElement as HTMLButtonElement;
              const original = btn?.textContent;
              if (btn) {
                btn.textContent = '✓';
                setTimeout(() => { btn.textContent = original; }, 500);
              }
            }}
            className="px-2 py-1 text-sm font-medium text-gray-400 hover:text-gray-600 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100"
            title="Copy debug info to clipboard"
          >
            🐛
          </button>
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
      <SaveAsModal
        isOpen={showCopyModal}
        currentPlanName={currentPlanName}
        currentPlanNotes={currentPlanNotes}
        onClose={() => setShowCopyModal(false)}
        onSave={async (newName: string, notes?: string) => {
          await copyPlan({
            newName,
            shiftDates: false,
            shiftAmount: 0,
            shiftUnit: 'years',
            unassignAll: false,
            notes,
          });
          await refreshPlanList();
          setShowCopyModal(false);
        }}
      />
    )}

  </>
  );
}
