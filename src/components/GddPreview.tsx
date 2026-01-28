'use client';

import { useMemo } from 'react';
import { useGdd, formatGddDifference, getGddExplanation } from '@/lib/gdd-client';

interface GddPreviewProps {
  /** Days to maturity from config */
  dtm: number;
  /** Target field date from config (MM-DD format) */
  targetFieldDate?: string;
  /** Actual field start date of the planting (YYYY-MM-DD format) */
  actualFieldDate: string;
  /** Crop category (for base temp lookup) */
  category: string;
  /** Optional override for base temperature */
  baseTemp?: number;
  /** Location coordinates */
  location?: {
    lat: number;
    lon: number;
  };
  /** Plan year */
  year: number;
}

/**
 * GDD Preview Panel
 *
 * Shows how Growing Degree Days affect the expected timing for a planting.
 * Compares the original DTM (based on target planting date) to the adjusted
 * DTM (based on actual planting date and historical temperatures).
 */
export function GddPreview({
  dtm,
  targetFieldDate,
  actualFieldDate,
  category,
  baseTemp,
  location,
  year,
}: GddPreviewProps) {
  const { isLoaded, isLoading, calculateAdjustedTiming } = useGdd(
    location?.lat,
    location?.lon,
    year
  );

  const gddData = useMemo(() => {
    if (!isLoaded || !targetFieldDate) return null;
    return calculateAdjustedTiming(
      dtm,
      targetFieldDate,
      actualFieldDate,
      category,
      baseTemp
    );
  }, [isLoaded, dtm, targetFieldDate, actualFieldDate, category, baseTemp, calculateAdjustedTiming]);

  // No location configured
  if (!location) {
    return (
      <div className="text-xs text-gray-500">
        Set location in{' '}
        <span className="text-blue-600">Settings</span>{' '}
        for GDD calculations
      </div>
    );
  }

  // No target field date on config
  if (!targetFieldDate) {
    return (
      <div className="text-xs text-gray-500">
        Config needs targetFieldDate for GDD
      </div>
    );
  }

  // No GDD temps configured for this crop
  if (baseTemp === undefined) {
    return (
      <div className="text-xs text-gray-500">
        Crop has no GDD temps configured
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div className="text-xs text-gray-500">
        Loading temperature data...
      </div>
    );
  }

  // Not loaded (maybe fetch failed)
  if (!isLoaded || !gddData) {
    return (
      <div className="text-xs text-red-500">
        Temperature data unavailable
      </div>
    );
  }

  // Calculation failed
  if (!gddData.success) {
    return (
      <div className="text-xs text-amber-600">
        {gddData.message || 'Insufficient data for GDD calculation'}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Main comparison */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-xs text-gray-500">Original DTM</div>
          <div className="text-sm font-medium">{gddData.originalDtm}d</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">GDD Adjusted</div>
          <div className={`text-sm font-medium ${
            gddData.daysDifference > 0 ? 'text-amber-600' :
            gddData.daysDifference < 0 ? 'text-green-600' : ''
          }`}>
            {gddData.adjustedDtm}d
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Difference</div>
          <div className={`text-sm font-medium ${
            gddData.daysDifference > 0 ? 'text-amber-600' :
            gddData.daysDifference < 0 ? 'text-green-600' : 'text-gray-500'
          }`}>
            {formatGddDifference(gddData.daysDifference)}
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="text-xs text-gray-500 space-y-1">
        <div className="flex justify-between">
          <span>Reference GDD:</span>
          <span className="font-medium">{gddData.referenceGdd}</span>
        </div>
        <div className="flex justify-between">
          <span>Base temp:</span>
          <span className="font-medium">{baseTemp}°F</span>
        </div>
      </div>

      {/* Explanation */}
      {gddData.daysDifference !== 0 && (
        <div className="text-xs text-gray-600 italic">
          {getGddExplanation(gddData.daysDifference)}
        </div>
      )}
    </div>
  );
}

/**
 * Compact GDD indicator for timeline or list views.
 * Shows just the difference badge.
 */
export function GddBadge({
  daysDifference,
}: {
  daysDifference: number;
}) {
  if (daysDifference === 0) return null;

  const isSlower = daysDifference > 0;

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
        isSlower
          ? 'bg-amber-100 text-amber-700'
          : 'bg-green-100 text-green-700'
      }`}
      title={`GDD adjusted: ${formatGddDifference(daysDifference)}`}
    >
      {isSlower ? '+' : ''}{daysDifference}d
    </span>
  );
}
