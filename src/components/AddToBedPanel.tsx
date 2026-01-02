'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import type { CropConfig } from '@/lib/entities/crop-config';
import { calculatePlantingMethod, calculateCropFields } from '@/lib/entities/crop-config';

/** Format a number to at most 2 decimal places, removing trailing zeros */
function formatNum(val: number | undefined | null): string {
  if (val == null) return '–';
  const rounded = Math.round(val * 100) / 100;
  return rounded.toString();
}

interface AddToBedPanelProps {
  bedId: string;
  cropCatalog: Record<string, CropConfig>;
  planYear: number;
  onAddPlanting: (configId: string, fieldStartDate: string, bedId: string) => void;
  onClose: () => void;
  /** Called when hovered config changes, for timeline preview */
  onHoverChange?: (config: CropConfig | null, fieldStartDate: string | null) => void;
}

export default function AddToBedPanel({
  bedId,
  cropCatalog,
  planYear,
  onAddPlanting,
  onClose,
  onHoverChange,
}: AddToBedPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [hoveredConfig, setHoveredConfig] = useState<CropConfig | null>(null);

  // Get all configs from catalog, filter out deprecated unless showing all
  const configs = useMemo(() => {
    const all = Object.values(cropCatalog);
    return showDeprecated ? all : all.filter(c => !c.deprecated);
  }, [cropCatalog, showDeprecated]);

  // Filter by search query
  const filteredConfigs = useMemo(() => {
    if (!searchQuery.trim()) return configs;
    const q = searchQuery.toLowerCase();
    return configs.filter(c =>
      c.identifier?.toLowerCase().includes(q) ||
      c.crop?.toLowerCase().includes(q) ||
      c.variant?.toLowerCase().includes(q) ||
      c.product?.toLowerCase().includes(q) ||
      c.category?.toLowerCase().includes(q)
    );
  }, [configs, searchQuery]);

  // Group configs by category for easier browsing
  const groupedConfigs = useMemo(() => {
    const groups: Record<string, CropConfig[]> = {};
    for (const config of filteredConfigs) {
      const category = config.category || 'Other';
      if (!groups[category]) groups[category] = [];
      groups[category].push(config);
    }
    // Sort configs within each group by crop name
    for (const category of Object.keys(groups)) {
      groups[category].sort((a, b) => (a.crop || '').localeCompare(b.crop || ''));
    }
    return groups;
  }, [filteredConfigs]);

  // Sort categories alphabetically
  const sortedCategories = useMemo(() => {
    return Object.keys(groupedConfigs).sort((a, b) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });
  }, [groupedConfigs]);

  // Compute fieldStartDate from targetFieldDate + planYear
  const getFieldStartDate = useCallback((config: CropConfig): string => {
    if (config.targetFieldDate) {
      // targetFieldDate is "MM-DD", combine with planYear
      return `${planYear}-${config.targetFieldDate}`;
    }
    // Fallback to today
    const today = new Date();
    return today.toISOString().slice(0, 10);
  }, [planYear]);

  // Notify parent of hover changes for timeline preview
  useEffect(() => {
    if (onHoverChange) {
      if (hoveredConfig) {
        onHoverChange(hoveredConfig, getFieldStartDate(hoveredConfig));
      } else {
        onHoverChange(null, null);
      }
    }
  }, [hoveredConfig, onHoverChange, getFieldStartDate]);

  const handleSelectConfig = useCallback((config: CropConfig) => {
    const fieldStartDate = getFieldStartDate(config);
    onAddPlanting(config.identifier, fieldStartDate, bedId);
  }, [bedId, getFieldStartDate, onAddPlanting]);

  // Calculate timing details for hovered config
  const hoveredDetails = useMemo(() => {
    if (!hoveredConfig) return null;
    const calculated = calculateCropFields(hoveredConfig);
    const fieldStartDate = getFieldStartDate(hoveredConfig);
    return {
      ...calculated,
      fieldStartDate,
    };
  }, [hoveredConfig, getFieldStartDate]);

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
          {filteredConfigs.length === 0 ? (
            <div className="p-4 text-sm text-gray-500 text-center">
              No crops found
            </div>
          ) : (
            <div>
              {sortedCategories.map((category) => (
                <div key={category}>
                  <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-100 sticky top-0">
                    {category} ({groupedConfigs[category].length})
                  </div>
                  {groupedConfigs[category].map((config) => (
                    <div
                      key={config.identifier}
                      className={`px-3 py-2 cursor-pointer transition-colors border-b border-gray-100 ${
                        hoveredConfig?.identifier === config.identifier
                          ? 'bg-blue-50'
                          : 'hover:bg-gray-50'
                      } ${config.deprecated ? 'opacity-60' : ''}`}
                      onClick={() => handleSelectConfig(config)}
                      onMouseEnter={() => setHoveredConfig(config)}
                      onMouseLeave={() => setHoveredConfig(null)}
                    >
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {config.crop}
                        {config.variant && config.variant !== 'General' && (
                          <span className="text-gray-600 font-normal"> ({config.variant})</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {config.product} · {config.growingStructure} · {calculatePlantingMethod(config)}
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
        {hoveredConfig && hoveredDetails ? (
          <>
            {/* Config header */}
            <div className="p-4 border-b bg-white">
              <div className="font-semibold text-gray-900">
                {hoveredConfig.crop}
                {hoveredConfig.variant && hoveredConfig.variant !== 'General' && (
                  <span className="font-normal text-gray-600"> ({hoveredConfig.variant})</span>
                )}
              </div>
              <div className="text-sm text-gray-600 mt-1">
                {hoveredConfig.product}
              </div>
              <div className="text-xs text-gray-500 mt-1 truncate" title={hoveredConfig.identifier}>
                {hoveredConfig.identifier}
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
                      <span className="text-gray-600 shrink-0">Days to Maturity</span>
                      <span className="font-medium truncate max-w-[120px]">{formatNum(hoveredConfig.dtm)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-600 shrink-0">Seed to Harvest</span>
                      <span className="font-medium truncate max-w-[120px]">{formatNum(hoveredDetails.sth)} days</span>
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
                      <span className="font-medium truncate max-w-[120px]" title={hoveredConfig.category || '–'}>{hoveredConfig.category || '–'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-600 shrink-0">Structure</span>
                      <span className="font-medium truncate max-w-[120px]">{hoveredConfig.growingStructure || 'Field'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-600 shrink-0">Method</span>
                      <span className="font-medium truncate max-w-[120px]">{hoveredDetails.plantingMethod}</span>
                    </div>
                    {hoveredConfig.perennial && (
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-600 shrink-0">Perennial</span>
                        <span className="font-medium text-green-600 truncate max-w-[120px]">Yes</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Harvest section */}
                {(hoveredConfig.numberOfHarvests || hoveredConfig.yieldPerHarvest) && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Harvest
                    </div>
                    <div className="bg-white rounded-lg border p-3 space-y-2 text-sm">
                      {hoveredConfig.numberOfHarvests && (
                        <div className="flex justify-between gap-2">
                          <span className="text-gray-600 shrink-0"># of Harvests</span>
                          <span className="font-medium truncate max-w-[120px]">{formatNum(hoveredConfig.numberOfHarvests)}</span>
                        </div>
                      )}
                      {hoveredConfig.daysBetweenHarvest && (
                        <div className="flex justify-between gap-2">
                          <span className="text-gray-600 shrink-0">Days Between</span>
                          <span className="font-medium truncate max-w-[120px]">{formatNum(hoveredConfig.daysBetweenHarvest)}</span>
                        </div>
                      )}
                      {hoveredConfig.yieldPerHarvest && (
                        <div className="flex justify-between gap-2">
                          <span className="text-gray-600 shrink-0">Yield/Harvest</span>
                          <span className="font-medium truncate max-w-[120px]" title={`${hoveredConfig.yieldPerHarvest} ${hoveredConfig.yieldUnit || ''}`}>
                            {formatNum(hoveredConfig.yieldPerHarvest)} {hoveredConfig.yieldUnit || ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
