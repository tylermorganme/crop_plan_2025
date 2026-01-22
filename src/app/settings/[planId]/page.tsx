'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { usePlanStore } from '@/lib/plan-store';
import { TIMEZONE_OPTIONS, DEFAULT_TIMEZONE } from '@/lib/date-utils';
import AppHeader from '@/components/AppHeader';

export default function SettingsPage() {
  const params = useParams();
  const planId = params.planId as string;

  const {
    currentPlan,
    loadPlanById,
    updatePlanMetadata,
  } = usePlanStore();

  const [isLoading, setIsLoading] = useState(true);

  // Load plan on mount
  useEffect(() => {
    if (planId) {
      loadPlanById(planId).then(() => setIsLoading(false));
    }
  }, [planId, loadPlanById]);

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-51px)] flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }

  if (!currentPlan) {
    return (
      <div className="h-[calc(100vh-51px)] flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Plan not found</div>
      </div>
    );
  }

  const metadata = currentPlan.metadata;

  return (
    <>
      <AppHeader />
      <div className="h-[calc(100vh-51px)] overflow-auto bg-gray-50">
        <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Plan Settings</h1>

        {/* Plan Info Section */}
        <section className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Plan Information</h2>

          <div className="space-y-4">
            {/* Plan Name */}
            <div>
              <label htmlFor="planName" className="block text-sm font-medium text-gray-700 mb-1">
                Plan Name
              </label>
              <input
                id="planName"
                type="text"
                value={metadata.name}
                onChange={(e) => updatePlanMetadata({ name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                id="description"
                value={metadata.description || ''}
                onChange={(e) => updatePlanMetadata({ description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Optional description for this plan..."
              />
            </div>

            {/* Plan Year */}
            <div>
              <label htmlFor="year" className="block text-sm font-medium text-gray-700 mb-1">
                Plan Year
              </label>
              <input
                id="year"
                type="number"
                value={metadata.year}
                onChange={(e) => updatePlanMetadata({ year: parseInt(e.target.value) || new Date().getFullYear() })}
                min={2020}
                max={2100}
                className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </section>

        {/* Regional Settings Section */}
        <section className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Regional Settings</h2>

          <div className="space-y-4">
            {/* Timezone */}
            <div>
              <label htmlFor="timezone" className="block text-sm font-medium text-gray-700 mb-1">
                Timezone
              </label>
              <select
                id="timezone"
                value={metadata.timezone || DEFAULT_TIMEZONE}
                onChange={(e) => updatePlanMetadata({ timezone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-sm text-gray-500">
                Used for date calculations and display. All dates are interpreted in this timezone.
              </p>
            </div>
          </div>
        </section>

        {/* Plan Details Section (read-only) */}
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Plan Details</h2>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Plan ID:</span>
              <span className="ml-2 font-mono text-gray-700">{metadata.id}</span>
            </div>
            <div>
              <span className="text-gray-500">Version:</span>
              <span className="ml-2 text-gray-700">{metadata.version || 1}</span>
            </div>
            <div>
              <span className="text-gray-500">Created:</span>
              <span className="ml-2 text-gray-700">
                {new Date(metadata.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Last Modified:</span>
              <span className="ml-2 text-gray-700">
                {new Date(metadata.lastModified).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            </div>
            {metadata.parentPlanId && (
              <>
                <div>
                  <span className="text-gray-500">Copied From:</span>
                  <span className="ml-2 font-mono text-gray-700">{metadata.parentPlanId}</span>
                </div>
                {metadata.parentVersion && (
                  <div>
                    <span className="text-gray-500">Parent Version:</span>
                    <span className="ml-2 text-gray-700">{metadata.parentVersion}</span>
                  </div>
                )}
              </>
            )}
            <div>
              <span className="text-gray-500">Plantings:</span>
              <span className="ml-2 text-gray-700">{currentPlan.plantings?.length || 0}</span>
            </div>
            <div>
              <span className="text-gray-500">Beds:</span>
              <span className="ml-2 text-gray-700">{Object.keys(currentPlan.beds || {}).length}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
    </>
  );
}
