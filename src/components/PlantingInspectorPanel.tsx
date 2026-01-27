'use client';

import { useState } from 'react';
import { parseISO } from 'date-fns';
import { DateInputWithButtons } from './DateInputWithButtons';
import {
  calculateSeedToHarvest,
  calculateHarvestWindow,
  calculateDaysInCells,
  buildYieldContext,
  evaluateYieldFormula,
} from '@/lib/entities/crop-config';
import { calculateConfigRevenue, formatCurrency } from '@/lib/revenue';
import type { Planting, CropConfig } from '@/lib/plan-types';
import type { Product } from '@/lib/entities/product';
import type { TimelineCrop } from '@/lib/entities/plan';
import type { SeedSource } from '@/lib/entities/planting';
import type { MutationResult } from '@/lib/plan-store';

// =============================================================================
// Constants
// =============================================================================

// Colors now come from TimelineCrop.bgColor/textColor (populated from plan.crops)
const DEFAULT_COLOR = { bg: '#78909c', text: '#fff' };

// =============================================================================
// Utility Functions
// =============================================================================

function parseDate(dateStr: string): Date {
  return parseISO(dateStr);
}

function getDuration(start: string, end: string): number {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Calculate effective timing values with overrides applied
 */
function resolveEffectiveTiming(
  base: { dtm: number; harvestWindow: number; daysInCells: number },
  overrides?: { additionalDaysInField?: number; additionalDaysOfHarvest?: number; additionalDaysInCells?: number }
): { dtm: number; harvestWindow: number; daysInCells: number } {
  return {
    dtm: Math.max(1, base.dtm + (overrides?.additionalDaysInField || 0)),
    harvestWindow: Math.max(0, base.harvestWindow + (overrides?.additionalDaysOfHarvest || 0)),
    daysInCells: Math.max(0, base.daysInCells + (overrides?.additionalDaysInCells || 0)),
  };
}

// =============================================================================
// Seed Source Picker (inline component)
// =============================================================================

interface SeedSourcePickerProps {
  crop: string;
  currentSource?: SeedSource;
  useDefault?: boolean;
  defaultSource?: SeedSource;
  varieties: Record<string, { id: string; crop: string; name: string; supplier?: string }>;
  seedMixes: Record<string, { id: string; crop: string; name: string }>;
  usedVarietyIds?: Set<string>;
  usedMixIds?: Set<string>;
  onChange: (source?: SeedSource) => void;
  onToggleDefault: (useDefault: boolean) => void;
}

function SeedSourcePicker({
  crop,
  currentSource,
  useDefault,
  defaultSource,
  varieties,
  seedMixes,
  usedVarietyIds,
  usedMixIds,
  onChange,
  onToggleDefault,
}: SeedSourcePickerProps) {
  // Filter varieties and mixes for this crop
  const cropVarieties = Object.values(varieties).filter((v) => v.crop === crop);
  const cropMixes = Object.values(seedMixes).filter((m) => m.crop === crop);

  const hasOptions = cropVarieties.length > 0 || cropMixes.length > 0;

  // Current effective source (default or override)
  const effectiveSource = useDefault ? defaultSource : currentSource;

  // Format display text
  const getSourceDisplay = (source?: SeedSource): string => {
    if (!source) return 'None';
    if (source.type === 'variety') {
      const v = varieties[source.id];
      return v ? `${v.name}${v.supplier ? ` (${v.supplier})` : ''}` : 'Unknown';
    }
    if (source.type === 'mix') {
      const m = seedMixes[source.id];
      return m ? `Mix: ${m.name}` : 'Unknown';
    }
    return 'None';
  };

  return (
    <div className="space-y-2">
      {/* Use Default Checkbox */}
      {defaultSource && (
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={useDefault || false}
            onChange={(e) => onToggleDefault(e.target.checked)}
            className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <span className="text-gray-700">
            Use default: <span className="font-medium">{getSourceDisplay(defaultSource)}</span>
          </span>
        </label>
      )}

      {/* Source Picker */}
      {!useDefault && hasOptions && (
        <select
          value={
            effectiveSource
              ? `${effectiveSource.type}:${effectiveSource.id}`
              : 'none'
          }
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'none') {
              onChange(undefined);
            } else {
              const [type, id] = val.split(':');
              onChange({ type: type as 'variety' | 'mix', id });
            }
          }}
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="none">None</option>
          {cropVarieties.length > 0 && (
            <optgroup label="Varieties">
              {cropVarieties.map((v) => {
                const isUsed = usedVarietyIds?.has(v.id);
                return (
                  <option key={v.id} value={`variety:${v.id}`}>
                    {v.name}
                    {v.supplier ? ` (${v.supplier})` : ''}
                    {isUsed ? ' ✓' : ''}
                  </option>
                );
              })}
            </optgroup>
          )}
          {cropMixes.length > 0 && (
            <optgroup label="Seed Mixes">
              {cropMixes.map((m) => {
                const isUsed = usedMixIds?.has(m.id);
                return (
                  <option key={m.id} value={`mix:${m.id}`}>
                    {m.name}
                    {isUsed ? ' ✓' : ''}
                  </option>
                );
              })}
            </optgroup>
          )}
        </select>
      )}

      {/* No options message */}
      {!useDefault && !hasOptions && (
        <div className="text-xs text-gray-500">
          No varieties or seed mixes available for {crop}
        </div>
      )}

      {/* Current display (read-only) */}
      {useDefault && (
        <div className="text-sm text-gray-700">{getSourceDisplay(effectiveSource)}</div>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export interface PlantingInspectorPanelProps {
  // Selected crop data
  selectedCrops: TimelineCrop[];

  // Selection management
  onDeselect?: (groupId: string) => void;
  onClearSelection?: () => void;

  // Edit callbacks - returns MutationResult so caller can handle validation failures
  onUpdatePlanting?: (plantingId: string, updates: Partial<Planting>) => Promise<MutationResult>;
  onCropDateChange?: (groupId: string, startDate: string, endDate: string) => void;
  onDeleteCrop?: (groupIds: string[]) => void;
  onDuplicateCrop?: (groupId: string) => Promise<string | void>;

  // Bulk actions (for multi-select)
  onBulkDuplicatePlantings?: (plantingIds: string[]) => Promise<string[]>;
  onBulkRefreshFromConfig?: (plantingIds: string[]) => Promise<void>;

  // Sequence actions
  onCreateSequence?: (plantingId: string, cropName: string, fieldStartDate: string) => void;
  onEditSequence?: (sequenceId: string) => void;
  onUnlinkFromSequence?: (plantingId: string) => void;

  // Config actions
  onEditCropConfig?: (identifier: string) => void;
  /** Reset planting to use config defaults (clears overrides, uses default seed source) */
  onRefreshFromConfig?: (plantingId: string) => void;

  // Lookup data
  cropCatalog?: Record<string, CropConfig>;
  varieties?: Record<string, { id: string; crop: string; name: string; supplier?: string }>;
  seedMixes?: Record<string, { id: string; crop: string; name: string }>;
  usedVarietyIds?: Set<string>;
  usedMixIds?: Set<string>;
  products?: Record<string, Product>;

  // UI options
  showTimingEdits?: boolean;
  className?: string;
}

export function PlantingInspectorPanel({
  selectedCrops,
  onDeselect,
  onClearSelection,
  onUpdatePlanting,
  onCropDateChange,
  onDeleteCrop,
  onDuplicateCrop,
  onBulkDuplicatePlantings,
  onBulkRefreshFromConfig,
  onCreateSequence,
  onEditSequence,
  onUnlinkFromSequence,
  onEditCropConfig,
  onRefreshFromConfig,
  cropCatalog,
  varieties,
  seedMixes,
  usedVarietyIds,
  usedMixIds,
  products,
  showTimingEdits = false,
  className = '',
}: PlantingInspectorPanelProps) {
  const [showSequenceInfo, setShowSequenceInfo] = useState(false);

  // No selection
  if (selectedCrops.length === 0) {
    return null;
  }

  // Multi-select: show summary view
  if (selectedCrops.length > 1) {
    // Group crops by groupId to get unique plantings
    const uniqueGroups = new Map<string, TimelineCrop>();
    selectedCrops.forEach((c) => {
      if (!uniqueGroups.has(c.groupId)) {
        uniqueGroups.set(c.groupId, c);
      }
    });
    const plantings = Array.from(uniqueGroups.values());

    return (
      <div className={className}>
        {/* Inspector Header */}
        <div className="p-3 border-b bg-gray-50 flex items-center justify-between sticky top-0 z-10">
          <h3 className="font-semibold text-sm min-w-0 flex-1">
            {plantings.length} Plantings Selected
          </h3>
          {onClearSelection && (
            <button
              onClick={onClearSelection}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-2 shrink-0"
            >
              &times;
            </button>
          )}
        </div>

        {/* Inspector Content */}
        <div className="flex-1 overflow-auto p-3">
          <div className="space-y-4">
            {/* Summary */}
            <div className="text-sm text-gray-600">
              {plantings.length} planting{plantings.length > 1 ? 's' : ''} selected
            </div>

            {/* List of selected plantings */}
            <div className="space-y-2 max-h-60 overflow-auto">
              {plantings.map((crop) => {
                // Colors come from plan.crops via timeline-data.ts
                const colors = {
                  bg: crop.bgColor || DEFAULT_COLOR.bg,
                  text: crop.textColor || DEFAULT_COLOR.text,
                };
                return (
                  <div
                    key={crop.groupId}
                    className="flex items-center gap-2 p-2 rounded border border-gray-100"
                  >
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: colors.bg }}
                    />
                    <span className="text-sm text-gray-900 truncate flex-1">{crop.name}</span>
                    {onDeselect && (
                      <button
                        onClick={() => onDeselect(crop.groupId)}
                        className="text-gray-400 hover:text-gray-600 text-xs"
                        title="Remove from selection"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bulk Actions */}
            <div className="pt-3 border-t space-y-2">
              <div className="text-xs text-gray-600 mb-2">
                Tip: {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Click to add/remove from selection
              </div>
              {onBulkDuplicatePlantings && (
                <button
                  onClick={async () => {
                    const plantingIds = plantings
                      .map((p) => p.plantingId)
                      .filter((id): id is string => id !== undefined);
                    await onBulkDuplicatePlantings(plantingIds);
                  }}
                  className="w-full px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  Duplicate {plantings.length} Planting{plantings.length > 1 ? 's' : ''}
                </button>
              )}
              {onBulkRefreshFromConfig && (
                <button
                  onClick={async () => {
                    const plantingIds = plantings
                      .map((p) => p.plantingId)
                      .filter((id): id is string => id !== undefined);
                    await onBulkRefreshFromConfig(plantingIds);
                  }}
                  className="w-full px-3 py-2 text-sm font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  Refresh {plantings.length} from Config
                </button>
              )}
              {onDeleteCrop && (
                <button
                  onClick={() => {
                    const groupIds = plantings.map((p) => p.groupId);
                    onDeleteCrop(groupIds);
                  }}
                  className="w-full px-3 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                >
                  Delete {plantings.length} Planting{plantings.length > 1 ? 's' : ''}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Single selection: show detailed view
  const crop = selectedCrops[0];
  const duration = getDuration(crop.startDate, crop.endDate);
  // Get all bed entries for this single group
  const groupCrops = selectedCrops.filter((c) => c.groupId === crop.groupId);

  // Get base config for calculating effective values
  const configId = crop.cropConfigId;
  const baseConfig = configId && cropCatalog ? cropCatalog[configId] : undefined;
  const baseValues = baseConfig
    ? {
        dtm: calculateSeedToHarvest(baseConfig, calculateDaysInCells(baseConfig)),
        harvestWindow: calculateHarvestWindow(baseConfig),
        daysInCells: calculateDaysInCells(baseConfig),
      }
    : null;

  // Calculate effective values (with overrides applied and clamped)
  const effectiveValues = baseValues
    ? resolveEffectiveTiming(baseValues, crop.overrides)
    : null;

  // Calculate minimum allowed adjustments (to not go below clamped minimums)
  // DTM: effective min is 1, so adjustment min is 1 - baseDTM
  // Others: effective min is 0, so adjustment min is -baseValue
  const minAdjustments = baseValues
    ? {
        dtm: 1 - baseValues.dtm,
        harvestWindow: -baseValues.harvestWindow,
        daysInCells: -baseValues.daysInCells,
      }
    : { dtm: -999, harvestWindow: -999, daysInCells: -999 };

  return (
    <div className={className}>
      {/* Inspector Header */}
      <div className="p-3 border-b bg-gray-50 flex items-center justify-between sticky top-0 z-10">
        <h3 className="font-semibold text-sm min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate">{crop.name}</span>
            {crop.plantingId && (
              <span className="text-gray-500 font-normal shrink-0">{crop.plantingId}</span>
            )}
          </span>
        </h3>
        {onClearSelection && (
          <button
            onClick={onClearSelection}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-2 shrink-0"
          >
            &times;
          </button>
        )}
      </div>

      {/* Sticky Actions Bar */}
      <div className="p-3 border-b bg-white sticky top-[49px] z-10 flex flex-wrap gap-2">
        {onEditCropConfig && crop.cropConfigId && (
          <button
            onClick={() => onEditCropConfig(crop.cropConfigId!)}
            className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
          >
            Edit Config
          </button>
        )}
        {onDuplicateCrop && (
          <button
            onClick={async () => {
              await onDuplicateCrop(crop.groupId);
            }}
            className="flex-1 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
          >
            Duplicate
          </button>
        )}
        {onDeleteCrop && (
          <button
            onClick={() => {
              onDeleteCrop([crop.groupId]);
            }}
            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors"
          >
            Delete
          </button>
        )}
      </div>

      {/* Inspector Content */}
      <div className="flex-1 overflow-auto p-3">
        <div className="space-y-4">
          {/* Bed, Length - compact row */}
          <div className="grid grid-cols-2 gap-2 text-center">
            <div>
              <div className="text-xs text-gray-600 mb-1">Bed</div>
              {crop.resource ? (
                <div
                  className="text-sm text-gray-900 truncate py-1"
                  title={groupCrops.length > 1 ? groupCrops.map((c) => c.resource).join(', ') : crop.resource}
                >
                  {groupCrops.length === 1 ? crop.resource : `${groupCrops.length} beds`}
                </div>
              ) : (
                <div className="text-sm text-amber-600 py-1">Unassigned</div>
              )}
            </div>
            <div>
              <div className="text-xs text-gray-600 mb-1">Length</div>
              {onUpdatePlanting ? (
                <input
                  key={`length-${crop.groupId}-${crop.feetNeeded}`}
                  type="number"
                  min={1}
                  step={25}
                  defaultValue={crop.feetNeeded}
                  onBlur={async (e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val > 0 && val !== crop.feetNeeded) {
                      const result = await onUpdatePlanting(crop.groupId, { bedFeet: val });
                      // Reset input to original value if validation failed
                      if (!result.success) {
                        e.target.value = String(crop.feetNeeded);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
                />
              ) : (
                <div className="text-sm text-gray-900 py-1">{crop.feetNeeded}&apos;</div>
              )}
            </div>
          </div>

          {/* Config Info - show what config this planting was created from */}
          {baseConfig && (
            <div className="bg-gray-50 rounded p-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-500">Config</div>
                  <div className="text-sm font-medium text-gray-900">{baseConfig.identifier}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Category</div>
                  <div className="text-sm text-gray-700">{baseConfig.category || '—'}</div>
                </div>
              </div>
            </div>
          )}

          {/* Structure, Yield, Revenue - compact row */}
          {baseConfig && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-xs text-gray-600 mb-1">Structure</div>
                <div className="text-sm text-gray-900 py-1">
                  {baseConfig.growingStructure === 'greenhouse' ? 'Greenhouse' :
                   baseConfig.growingStructure === 'high-tunnel' ? 'High Tunnel' : 'Field'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Yield</div>
                <div className="text-sm text-gray-900 py-1">
                  {(() => {
                    if (!baseConfig.productYields?.length) return '—';
                    let totalYield = 0;
                    let unit = '';
                    for (const py of baseConfig.productYields) {
                      if (!py.yieldFormula) continue;
                      const ctx = buildYieldContext(baseConfig, crop.feetNeeded);
                      ctx.harvests = py.numberOfHarvests ?? 1;
                      const result = evaluateYieldFormula(py.yieldFormula, ctx);
                      if (result.value !== null) {
                        totalYield += result.value;
                        // Get unit from product
                        if (products && !unit) {
                          const product = products[py.productId];
                          if (product) unit = product.unit;
                        }
                      }
                    }
                    if (totalYield === 0) return '—';
                    return `${totalYield.toLocaleString(undefined, { maximumFractionDigits: 0 })}${unit ? ` ${unit}` : ''}`;
                  })()}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Revenue</div>
                <div className="text-sm text-gray-900 py-1">
                  {(() => {
                    if (!products) return '—';
                    const revenue = calculateConfigRevenue(baseConfig, crop.feetNeeded, products);
                    return revenue ? formatCurrency(revenue) : '—';
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Dates - Seeding, Field (editable), Remove */}
          {(() => {
            const fieldDate = parseISO(crop.startDate);
            const daysInCells = effectiveValues?.daysInCells || 0;
            const seedingDate =
              daysInCells > 0
                ? new Date(fieldDate.getTime() - daysInCells * 24 * 60 * 60 * 1000)
                : fieldDate;
            const removeDate = parseISO(crop.endDate);

            // Format date for input (YYYY-MM-DD)
            const formatForInput = (d: Date) => d.toISOString().split('T')[0];

            return (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs text-gray-600 mb-1">Seeding</div>
                  <div className="text-sm text-gray-900 py-0.5">{seedingDate.toLocaleDateString()}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">Field</div>
                  {onCropDateChange ? (
                    <DateInputWithButtons
                      value={formatForInput(fieldDate)}
                      mode="input"
                      onSave={(newFieldDate) => {
                        if (newFieldDate) {
                          // End date shifts by the same delta
                          const oldField = parseISO(crop.startDate);
                          const newField = parseISO(newFieldDate);
                          const deltaDays = Math.round(
                            (newField.getTime() - oldField.getTime()) / (24 * 60 * 60 * 1000)
                          );
                          const newEnd = new Date(
                            removeDate.getTime() + deltaDays * 24 * 60 * 60 * 1000
                          );
                          onCropDateChange(
                            crop.groupId,
                            newFieldDate + 'T00:00:00',
                            newEnd.toISOString().split('T')[0] + 'T00:00:00'
                          );
                        }
                      }}
                      className="text-center"
                    />
                  ) : (
                    <div className="text-sm text-gray-900 py-0.5">{fieldDate.toLocaleDateString()}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">Remove</div>
                  <div className="text-sm text-gray-900 py-0.5">{removeDate.toLocaleDateString()}</div>
                </div>
              </div>
            );
          })()}

          {/* Actual Dates - only show in edit mode */}
          {onUpdatePlanting && (
            <div className="grid grid-cols-2 gap-2 text-center">
              <div>
                <div className="text-xs text-gray-600 mb-1">Actual Greenhouse</div>
                <DateInputWithButtons
                  value={crop.actuals?.greenhouseDate?.split('T')[0] || ''}
                  mode="input"
                  onSave={(val) => {
                    onUpdatePlanting(crop.groupId, {
                      actuals: { ...crop.actuals, greenhouseDate: val || undefined },
                    });
                  }}
                  className="text-center"
                />
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Actual Field</div>
                <DateInputWithButtons
                  value={crop.actuals?.fieldDate?.split('T')[0] || ''}
                  mode="input"
                  onSave={(val) => {
                    onUpdatePlanting(crop.groupId, {
                      actuals: { ...crop.actuals, fieldDate: val || undefined },
                    });
                  }}
                  className="text-center"
                />
              </div>
            </div>
          )}

          {/* Multi-bed info */}
          {groupCrops.length > 1 && (
            <div>
              <div className="text-xs text-gray-600 mb-1">Bed Details</div>
              <div className="text-xs text-gray-900 space-y-1">
                {groupCrops.map((c) => (
                  <div key={c.id} className="flex justify-between py-1 border-b border-gray-100">
                    <span>{c.resource}</span>
                    <span className="text-gray-700">
                      {c.feetUsed || c.bedCapacityFt || 50}&apos;
                      {c.feetUsed && c.bedCapacityFt && c.feetUsed < c.bedCapacityFt && (
                        <span className="text-amber-600"> of {c.bedCapacityFt}&apos;</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sequence Info */}
          {crop.sequenceId !== undefined && crop.sequenceSlot !== undefined && (
            <div className="pt-3 border-t">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-gray-600">Sequence</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSequenceInfo(true);
                    }}
                    title="Moving a planting will move all sequenced plantings that aren't already fixed by actual dates. Click for more info."
                    className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    ⓘ
                  </button>
                </div>
                <span
                  className="px-2 py-0.5 rounded text-xs font-bold"
                  style={{ backgroundColor: '#7c3aed', color: '#ffffff' }}
                >
                  #{crop.sequenceSlot + 1}
                </span>
              </div>
              {crop.isLocked && (
                <div className="text-xs text-amber-600 mb-2">
                  This planting has actual dates set and cannot be moved.
                </div>
              )}
              <div className="mt-2 flex gap-2">
                {onEditSequence && (
                  <button
                    onClick={() => onEditSequence(crop.sequenceId!)}
                    className="flex-1 px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 rounded hover:bg-purple-100 transition-colors"
                  >
                    Edit Sequence
                  </button>
                )}
                {onUnlinkFromSequence && (
                  <button
                    onClick={() => onUnlinkFromSequence(crop.groupId)}
                    className="flex-1 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors"
                  >
                    Break from Sequence
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Create Sequence Action - only show if not already in a sequence */}
          {crop.sequenceId === undefined && onCreateSequence && (
            <div className="pt-3 border-t">
              <button
                onClick={() => onCreateSequence(crop.groupId, crop.name, crop.startDate)}
                className="w-full px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 rounded hover:bg-purple-100 transition-colors"
              >
                Create Succession Sequence
              </button>
            </div>
          )}

          {/* Timing Adjustments - 4-column grid: row labels + Greenhouse, Maturity, Harvest */}
          {onUpdatePlanting && showTimingEdits && (
            <div className="pt-3 border-t">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-600">Timing Adjustments (days)</span>
                <span className="text-xs text-gray-600">
                  Total: <span className="font-semibold">{duration}d</span>
                </span>
              </div>
              <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-2 gap-y-1 items-center">
                {/* Header row */}
                <div></div>
                <div className="text-xs text-gray-600 text-center">Greenhouse</div>
                <div className="text-xs text-gray-600 text-center">Maturity</div>
                <div className="text-xs text-gray-600 text-center">Harvest</div>

                {/* Adjustment row */}
                <div className="text-xs text-gray-500 text-right pr-1">Adj</div>
                <div className={`flex justify-center ${baseValues && baseValues.daysInCells > 0 ? '' : 'opacity-30'}`}>
                  <input
                    key={`gh-${crop.groupId}-${crop.overrides?.additionalDaysInCells || 0}`}
                    type="number"
                    defaultValue={crop.overrides?.additionalDaysInCells || 0}
                    disabled={!baseValues || baseValues.daysInCells === 0}
                    onBlur={(e) => {
                      let val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        val = Math.max(minAdjustments.daysInCells, val);
                        e.target.value = val.toString();
                        onUpdatePlanting(crop.groupId, {
                          overrides: { additionalDaysInCells: val },
                        });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    className="w-14 px-1 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex justify-center">
                  <input
                    key={`dtm-${crop.groupId}-${crop.overrides?.additionalDaysInField || 0}`}
                    type="number"
                    defaultValue={crop.overrides?.additionalDaysInField || 0}
                    onBlur={(e) => {
                      let val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        val = Math.max(minAdjustments.dtm, val);
                        e.target.value = val.toString();
                        onUpdatePlanting(crop.groupId, {
                          overrides: { additionalDaysInField: val },
                        });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    className="w-14 px-1 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
                  />
                </div>
                <div className="flex justify-center">
                  <input
                    key={`harvest-${crop.groupId}-${crop.overrides?.additionalDaysOfHarvest || 0}`}
                    type="number"
                    defaultValue={crop.overrides?.additionalDaysOfHarvest || 0}
                    onBlur={(e) => {
                      let val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        val = Math.max(minAdjustments.harvestWindow, val);
                        e.target.value = val.toString();
                        onUpdatePlanting(crop.groupId, {
                          overrides: { additionalDaysOfHarvest: val },
                        });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    className="w-14 px-1 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
                  />
                </div>

                {/* Total row */}
                <div className="text-xs text-gray-500 text-right pr-1">Total</div>
                <div className={`text-xs text-gray-500 text-center ${baseValues && baseValues.daysInCells > 0 ? '' : 'opacity-30'}`}>
                  {effectiveValues ? effectiveValues.daysInCells : '-'}
                </div>
                <div className="text-xs text-gray-500 text-center">
                  {effectiveValues ? effectiveValues.dtm : '-'}
                </div>
                <div className="text-xs text-gray-500 text-center">
                  {effectiveValues ? effectiveValues.harvestWindow : '-'}
                </div>
              </div>
            </div>
          )}

          {/* Seed Source - Editable */}
          {onUpdatePlanting && varieties && seedMixes && crop.crop && (
            <div className="pt-3 border-t">
              <div className="text-xs text-gray-600 mb-1">
                Seed Source
                {!crop.seedSource && !crop.useDefaultSeedSource && <span className="text-amber-500 ml-1">⚠</span>}
              </div>
              <SeedSourcePicker
                crop={crop.crop}
                currentSource={crop.seedSource}
                useDefault={crop.useDefaultSeedSource}
                defaultSource={baseConfig?.defaultSeedSource}
                varieties={varieties}
                seedMixes={seedMixes}
                usedVarietyIds={usedVarietyIds}
                usedMixIds={usedMixIds}
                onChange={(source) => onUpdatePlanting(crop.groupId, { seedSource: source })}
                onToggleDefault={(useDefault) =>
                  onUpdatePlanting(crop.groupId, { useDefaultSeedSource: useDefault })
                }
              />
            </div>
          )}

          {/* Notes - Editable */}
          {onUpdatePlanting && (
            <div className="pt-3 border-t">
              <div className="text-xs text-gray-600 mb-1">Notes</div>
              <textarea
                defaultValue={crop.notes || ''}
                placeholder="Add notes..."
                rows={2}
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  if (val !== (crop.notes || '')) {
                    onUpdatePlanting(crop.groupId, { notes: val });
                  }
                }}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
            </div>
          )}

          {/* Notes Display (read-only mode) */}
          {!onUpdatePlanting && crop.notes && (
            <div>
              <div className="text-xs text-gray-600 mb-1">Notes</div>
              <div className="text-sm text-gray-900 whitespace-pre-wrap">{crop.notes}</div>
            </div>
          )}

          {/* Failed checkbox - only show in edit mode */}
          {onUpdatePlanting && (
            <div className="pt-3 border-t">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={crop.actuals?.failed || false}
                  onChange={(e) => {
                    onUpdatePlanting(crop.groupId, {
                      actuals: { ...crop.actuals, failed: e.target.checked },
                    });
                  }}
                  className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                />
                <span className="text-sm text-gray-700">Planting failed</span>
              </label>
              {crop.actuals?.failed && (
                <p className="text-xs text-gray-500 mt-1 ml-6">
                  This planting is marked as failed (disease, pests, weather, etc.)
                </p>
              )}
            </div>
          )}

          {/* IDs - Planting ID and Group ID on same row */}
          <div className="grid grid-cols-2 gap-2">
            {crop.plantingId && (
              <div>
                <div className="text-xs text-gray-600 mb-1">Planting ID</div>
                <div className="font-mono text-xs text-gray-900">{crop.plantingId}</div>
              </div>
            )}
            <div>
              <div className="text-xs text-gray-600 mb-1">Group ID</div>
              <div className="font-mono text-xs text-gray-900">{crop.groupId}</div>
            </div>
          </div>

          {/* Refresh from Config - at bottom */}
          {onRefreshFromConfig && crop.plantingId && (
            <div className="pt-3 border-t">
              <button
                onClick={() => onRefreshFromConfig(crop.plantingId!)}
                className="w-full px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 rounded hover:bg-gray-100 transition-colors"
                title="Reset timing overrides and use config defaults for seed source"
              >
                Refresh from Config
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sequence Info Modal */}
      {showSequenceInfo && (
        <SequenceInfoModal
          isOpen={showSequenceInfo}
          onClose={() => setShowSequenceInfo(false)}
        />
      )}
    </div>
  );
}

// =============================================================================
// Sequence Info Modal Component
// =============================================================================

interface SequenceInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function SequenceInfoModal({ isOpen, onClose }: SequenceInfoModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 410 }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal */}
      <div
        className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Succession Sequences</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <div className="space-y-3 text-sm text-gray-700">
            <p>
              A <strong>succession sequence</strong> is a group of plantings spaced at regular
              intervals to provide continuous harvest.
            </p>

            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <h3 className="font-semibold text-purple-900 mb-2">How It Works</h3>
              <ul className="space-y-2 text-sm">
                <li className="flex gap-2">
                  <span className="text-purple-600">•</span>
                  <span>All plantings in the sequence are numbered (#1, #2, #3...)</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-purple-600">•</span>
                  <span>
                    Dates are automatically calculated based on the first planting and the spacing
                    between them
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-purple-600">•</span>
                  <span>
                    Moving any planting will move all sequenced plantings that aren't already fixed
                    by actual dates
                  </span>
                </li>
              </ul>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <h3 className="font-semibold text-gray-900 mb-2">Breaking from Sequence</h3>
              <p className="text-sm">
                Click <strong>"Break from Sequence"</strong> to remove a planting from the group.
                The remaining plantings will continue to follow each other.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end rounded-b-lg">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
