'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PlanDropdown, { ACTIVE_PLAN_KEY } from './PlanDropdown';

interface AppHeaderProps {
  /** Optional toolbar content to render below the main nav */
  toolbar?: React.ReactNode;
}

export default function AppHeader({ toolbar }: AppHeaderProps) {
  const pathname = usePathname();
  const [activePlanId, setActivePlanId] = useState<string | null>(null);

  // Load active plan ID for Timeline tab link
  useEffect(() => {
    const storedId = localStorage.getItem(ACTIVE_PLAN_KEY);
    setActivePlanId(storedId);

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === ACTIVE_PLAN_KEY) {
        setActivePlanId(e.newValue);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Determine which tab is active
  const isExplorerActive = pathname === '/';
  const isTimelineActive = pathname.startsWith('/timeline/');
  const isPlansActive = pathname === '/plans';

  // Timeline link - goes to active plan's timeline, or /plans if no plan selected
  const timelineHref = activePlanId ? `/timeline/${activePlanId}` : '/plans';

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

        {/* View Tabs */}
        <nav className="flex items-center gap-1">
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
            } ${!activePlanId && !isTimelineActive ? 'opacity-60' : ''}`}
            title={!activePlanId ? 'Select a plan first' : undefined}
          >
            Timeline
          </Link>
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

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
