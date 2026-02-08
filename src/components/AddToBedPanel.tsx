'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import type { PlantingSpec } from '@/lib/entities/planting-specs';
import { calculatePlantingMethod, calculateCropFields } from '@/lib/entities/planting-specs';

/** Format a number to at most 2 decimal places, removing trailing zeros */
function formatNum(val: number | undefined | null): string {
  if (val == null) return '–';
  const rounded = Math.round(val * 100) / 100;
  return rounded.toString();
}

interface AddToBedPanelProps {
  bedId: string;
  specs: Record<string, PlantingSpec>;
  planYear: number;
  onAddPlanting: (specId: string, fieldStartDate: string, bedId: string) => void;
  onClose: () => void;
  /** Called when hovered spec changes, for timeline preview */
  onHoverChange?: (spec: PlantingSpec | null, fieldStartDate: string | null) => void;
}

export default function AddToBedPanel({
  bedId,
  specs,
  planYear,
  onAddPlanting,
  onClose,
  onHoverChange,
}: AddToBedPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [hoveredSpec, setHoveredSpec] = useState<PlantingSpec | null>(null);

  // Get all specs from catalog, filter out deprecated unless showing all
  const visibleSpecs = useMemo(() => {
    const all = Object.values(specs);
    return showDeprecated ? all : all.filter(c => !c.deprecated);
  }, [specs, showDeprecated]);

  // Filter by search query
  const filteredSpecs = useMemo(() => {
    if (!searchQuery.trim()) return visibleSpecs;
    const q = searchQuery.toLowerCase();
    return visibleSpecs.filter(c =>
      // Use searchText if available (materialized), otherwise fall back to fields
      c.searchText?.toLowerCase().includes(q) ||
      c.name?.toLowerCase().includes(q) ||
      c.crop?.toLowerCase().includes(q) ||
      c.category?.toLowerCase().includes(q)
    );
  }, [visibleSpecs, searchQuery]);

  // Group specs by category for easier browsing
  const groupedSpecs = useMemo(() => {
    const groups: Record<string, PlantingSpec[]> = {};
    for (const spec of filteredSpecs) {
      const category = spec.category || 'Other';
      if (!groups[category]) groups[category] = [];
      groups[category].push(spec);
    }
    // Sort specs within each group by crop name
    for (const category of Object.keys(groups)) {
      groups[category].sort((a, b) => (a.crop || '').localeCompare(b.crop || ''));
    }
    return groups;
  }, [filteredSpecs]);

  // Sort categories alphabetically
  const sortedCategories = useMemo(() => {
    return Object.keys(groupedSpecs).sort((a, b) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });
  }, [groupedSpecs]);

  // Compute fieldStartDate from targetFieldDate + planYear
  const getFieldStartDate = useCallback((spec: PlantingSpec): string => {
    if (spec.targetFieldDate) {
      // targetFieldDate is "MM-DD", combine with planYear
      return `${planYear}-${spec.targetFieldDate}`;
    }
    // Fallback to today
    const today = new Date();
    return today.toISOString().slice(0, 10);
  }, [planYear]);

  // Notify parent of hover changes for timeline preview
  useEffect(() => {
    if (onHoverChange) {
      if (hoveredSpec) {
        onHoverChange(hoveredSpec, getFieldStartDate(hoveredSpec));
      } else {
        onHoverChange(null, null);
      }
    }
  }, [hoveredSpec, onHoverChange, getFieldStartDate]);

  const handleSelectSpec = useCallback((spec: PlantingSpec) => {
    const fieldStartDate = getFieldStartDate(spec);
    onAddPlanting(spec.id, fieldStartDate, bedId);
  }, [bedId, getFieldStartDate, onAddPlanting]);

  // Calculate timing details for hovered spec
  const hoveredDetails = useMemo(() => {
    if (!hoveredSpec) return null;
    const calculated = calculateCropFields(hoveredSpec);
    const fieldStartDate = getFieldStartDate(hoveredSpec);
    return {
      ...calculated,
      fieldStartDate,
    };
  }, [hoveredSpec, getFieldStartDate]);

  return (
    <div className="w-[560px] bg-white border-l flex shrink-0 h-full">
      {/* Left side: Search and list */}
      <div className="w-64 flex flex-col border-r">
        {/* Header */}
        <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
          <h3 className="font-semibold text-sm">Add to {bedId}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Search and Show Deprecated */}
        <div className="p-3 border-b space-y-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search crops..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showDeprecated}
              onChange={(e) => setShowDeprecated(e.target.checked)}
              className="rounded"
            />
            Show deprecated
          </label>
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-auto min-h-0">
          {filteredSpecs.length === 0 ? (
            <div className="p-4 text-sm text-gray-500 text-center">
              No crops found
            </div>
          ) : (
            <div>
              {sortedCategories.map((category) => (
                <div key={category}>
                  <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-100 sticky top-0">
                    {category} ({groupedSpecs[category].length})
                  </div>
                  {groupedSpecs[category].map((spec) => (
                    <div
                      key={spec.name}
                      className={`px-3 py-2 cursor-pointer transition-colors border-b border-gray-100 ${
                        hoveredSpec?.name === spec.name
                          ? 'bg-blue-50'
                          : 'hover:bg-gray-50'
                      } ${spec.deprecated ? 'opacity-60' : ''}`}
                      onClick={() => handleSelectSpec(spec)}
                      onMouseEnter={() => setHoveredSpec(spec)}
                      onMouseLeave={() => setHoveredSpec(null)}
                    >
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {spec.name}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {spec.category} · {spec.growingStructure} · {calculatePlantingMethod(spec)}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right side: Inspector */}
      <div className="flex-1 flex flex-col bg-gray-50">
        {hoveredSpec && hoveredDetails ? (
          <>
            {/* Spec header */}
            <div className="p-4 border-b bg-white">
              <div className="font-semibold text-gray-900">
                {hoveredSpec.name}
              </div>
              <div className="text-sm text-gray-600 mt-1">
                {hoveredSpec.category}
              </div>
            </div>

            {/* Details grid */}
            <div className="flex-1 overflow-auto p-4">
              <div className="space-y-4">
                {/* Timing section */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Timing
                  </div>
                  <div className="bg-white rounded-lg border p-3 space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-600 shrink-0">Field Start</span>
                      <span className="font-medium truncate max-w-[120px]" title={hoveredDetails.fieldStartDate}>{hoveredDetails.fieldStartDate}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-600 shrink-0">Seed to Harvest</span>
                      <span className="font-medium truncate max-w-[120px]">{formatNum(hoveredDetails.seedToHarvest)} days</span>
                    </div>
                    {hoveredDetails.daysInCells > 0 && (
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-600 shrink-0">Days in Greenhouse</span>
                        <span className="font-medium truncate max-w-[120px]">{formatNum(hoveredDetails.daysInCells)} days</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-600 shrink-0">Harvest Window</span>
                      <span className="font-medium truncate max-w-[120px]">{formatNum(hoveredDetails.harvestWindow)} days</span>
                    </div>
                  </div>
                </div>

                {/* Growing section */}
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Growing
                  </div>
                  <div className="bg-white rounded-lg border p-3 space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-600 shrink-0">Category</span>
                      <span className="font-medium truncate max-w-[120px]" title={hoveredSpec.category || '–'}>{hoveredSpec.category || '–'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-600 shrink-0">Structure</span>
                      <span className="font-medium truncate max-w-[120px]">{hoveredSpec.growingStructure || 'Field'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-600 shrink-0">Method</span>
                      <span className="font-medium truncate max-w-[120px]">{hoveredDetails.plantingMethod}</span>
                    </div>
                    {hoveredSpec.perennial && (
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-600 shrink-0">Perennial</span>
                        <span className="font-medium text-green-600 truncate max-w-[120px]">Yes</span>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>

            {/* Click hint */}
            <div className="p-3 border-t bg-white text-center">
              <span className="text-xs text-gray-500">Click to add to {bedId}</span>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Hover a crop to see details
          </div>
        )}
      </div>
    </div>
  );
}
