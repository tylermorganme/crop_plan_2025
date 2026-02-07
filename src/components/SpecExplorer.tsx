'use client';

import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Planting } from '@/lib/plan-types';
import { createPlanting, type SeedSource } from '@/lib/entities/planting';
import { SeedSourceSelect, type VarietyOption, type SeedMixOption } from './SeedSourceSelect';
import { usePlanStore, type PlanSummary } from '@/lib/plan-store';
import { type PlantingSpec, calculatePlantingMethod, calculateYieldPerWeek, calculateYieldPerHarvest } from '@/lib/entities/planting-specs';
import { calculateSpecRevenue, STANDARD_BED_LENGTH } from '@/lib/revenue';
import { getMarketSplitTotal, getActiveMarkets, type Market, type MarketSplit } from '@/lib/entities/market';
import PlantingSpecCreator from './PlantingSpecCreator';
import PlantingSpecEditor from './PlantingSpecEditor';
import CompareSpecsModal from './CompareSpecsModal';
import { TagInput } from './TagInput';
import GddExplorerModal from './GddExplorerModal';
import { useGdd } from '@/lib/gdd-client';
import { useUIStore } from '@/lib/ui-store';
import { Z_INDEX } from '@/lib/z-index';
import {
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  EDITABLE_COLUMNS,
  getDefaultColumnWidth,
  formatCellValue,
  getColumnDisplayName,
  getColumnBgClass,
  getHeaderTextClass,
  type DynamicOptionKey,
  type EditType,
} from '@/lib/spec-explorer-columns';
import { moveFocusVerticalDirect } from '@/lib/table-navigation';
import { parseSearchQuery, matchesFilter, type ParsedSearchQuery } from '@/lib/search-dsl';
import { plantingSpecSearchConfig, getFilterFieldNames, getSortFieldNames } from '@/lib/search-configs';
import { SearchInput } from './SearchInput';

// =============================================================================
// SPEC VALIDATION
// =============================================================================

interface SpecValidation {
  /** 'error' = missing required data, 'warning' = potentially misconfigured, 'ok' = all good */
  status: 'error' | 'warning' | 'ok';
  /** Human-readable issues */
  issues: string[];
}

/**
 * Validate a planting spec and return status + issues.
 * Used to show visual indicators in the explorer.
 */
function validatePlantingSpec(crop: PlantingSpec): SpecValidation {
  const issues: string[] = [];

  // Errors - missing required data
  if (!crop.name?.trim()) {
    issues.push('Missing name');
  }
  if (!crop.crop?.trim()) {
    issues.push('Missing crop name');
  }
  if (!crop.productYields || crop.productYields.length === 0) {
    issues.push('No products configured (required for timing)');
  }

  // If we have errors, return early
  if (issues.length > 0) {
    return { status: 'error', issues };
  }

  // Warnings - potentially misconfigured
  const plantingMethod = calculatePlantingMethod(crop);
  if (plantingMethod !== 'perennial' && !crop.dtmBasis) {
    issues.push('DTM basis not set');
  }

  if (crop.defaultMarketSplit) {
    const total = getMarketSplitTotal(crop.defaultMarketSplit);
    if (Math.abs(total - 100) >= 0.01) {
      issues.push(`Market split totals ${total}%, not 100%`);
    }
  }

  // Check for products with zero DTM
  if (crop.productYields) {
    const zeroDtm = crop.productYields.filter(py => py.dtm === 0);
    if (zeroDtm.length > 0) {
      issues.push(`${zeroDtm.length} product(s) with DTM = 0`);
    }
    // Check for products with no yield formula
    const noYield = crop.productYields.filter(py => !py.yieldFormula);
    if (noYield.length > 0) {
      issues.push(`${noYield.length} product(s) missing yield formula`);
    }
  }

  if (issues.length > 0) {
    return { status: 'warning', issues };
  }

  return { status: 'ok', issues: [] };
}

// =============================================================================
// BULK SPEC EDITOR MODAL
// =============================================================================
//
// Extensible bulk editor for PlantingSpec fields.
// Currently supports: Market Split
//
// TO ADD A NEW BULK EDIT FIELD:
// 1. Add state for the field value (e.g., const [newField, setNewField] = useState(...))
// 2. Add an "enabled" checkbox state (e.g., const [enableNewField, setEnableNewField] = useState(false))
// 3. Add a FieldSection component for the UI
// 4. In buildChanges(), add the field to the changes object when enabled
// 5. Update hasChanges to include the new enabled state
//
// Future candidates for bulk editing (Option C from research):
// - rows, spacing (safe across all methods)
// - category, growingStructure
// - deprecated, isFavorite
// - targetFieldDate
// - defaultSeedSource (would need variety/mix selector)
// =============================================================================

/** Props for a collapsible field section in the bulk editor */
interface FieldSectionProps {
  title: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}

/** Collapsible section for a bulk-editable field */
function FieldSection({ title, enabled, onToggle, children }: FieldSectionProps) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <label className="flex items-center gap-3 px-3 py-2 bg-gray-50 cursor-pointer hover:bg-gray-100">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
        />
        <span className="text-sm font-medium text-gray-700">{title}</span>
      </label>
      {enabled && (
        <div className="px-3 py-3 border-t border-gray-200 bg-white">
          {children}
        </div>
      )}
    </div>
  );
}

interface BulkSpecEditorModalProps {
  isOpen: boolean;
  markets: Record<string, Market>;
  selectedCount: number;
  allTags: string[];
  /** Tag → count of how many selected specs have it */
  selectedTagCounts: Record<string, number>;
  onClose: () => void;
  onSave: (changes: Partial<PlantingSpec>) => void;
  onTagChanges?: (add: string[], remove: string[]) => void;
}

function BulkSpecEditorModal({
  isOpen,
  markets,
  selectedCount,
  allTags,
  selectedTagCounts,
  onClose,
  onSave,
  onTagChanges,
}: BulkSpecEditorModalProps) {
  // ---- Market Split State ----
  const [enableMarketSplit, setEnableMarketSplit] = useState(true); // Default enabled since it's why they opened this
  const [marketSplit, setMarketSplit] = useState<MarketSplit>({});
  const activeMarkets = getActiveMarkets(markets);

  // ---- Tags State ----
  const [tagsToAdd, setTagsToAdd] = useState<string[]>([]);
  const [tagsToRemove, setTagsToRemove] = useState<string[]>([]);
  const existingTags = Object.entries(selectedTagCounts).sort(([a], [b]) => a.localeCompare(b));

  // Initialize market split with 100% to first market
  useEffect(() => {
    if (isOpen && activeMarkets.length > 0 && Object.keys(marketSplit).length === 0) {
      setMarketSplit({ [activeMarkets[0].id]: 100 });
    }
  }, [isOpen, activeMarkets, marketSplit]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setEnableMarketSplit(true);
      setMarketSplit({});
      setTagsToAdd([]);
      setTagsToRemove([]);
    }
  }, [isOpen]);

  // Market split helpers
  const marketSplitTotal = getMarketSplitTotal(marketSplit);
  const isMarketSplitValid = Math.abs(marketSplitTotal - 100) < 0.01;

  const handleMarketChange = (marketId: string, value: number) => {
    setMarketSplit(prev => {
      const newSplit = { ...prev };
      if (value <= 0) {
        delete newSplit[marketId];
      } else {
        newSplit[marketId] = value;
      }
      return newSplit;
    });
  };

  // Check if any changes are enabled
  const hasMarketChanges = enableMarketSplit && Object.keys(marketSplit).length > 0;
  const hasTagChanges = tagsToAdd.length > 0 || tagsToRemove.length > 0;
  const hasChanges = hasMarketChanges || hasTagChanges;

  const handleSave = () => {
    if (hasMarketChanges) {
      onSave({ defaultMarketSplit: marketSplit });
    }
    if (hasTagChanges) {
      onTagChanges?.(tagsToAdd, tagsToRemove);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
      <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Bulk Edit Specs</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl"
          >
            ×
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          <p className="text-sm text-gray-600 mb-4">
            Edit <strong>{selectedCount}</strong> selected spec{selectedCount !== 1 ? 's' : ''}.
            Enable the fields you want to update - only enabled fields will be changed.
          </p>

          <div className="space-y-3">
            {/* ---- Market Split Section ---- */}
            <FieldSection
              title="Default Market Split"
              enabled={enableMarketSplit}
              onToggle={setEnableMarketSplit}
            >
              <div className="space-y-2">
                {activeMarkets.map((market) => (
                  <div key={market.id} className="flex items-center gap-3">
                    <label className="text-sm text-gray-700 w-24 truncate" title={market.name}>
                      {market.name}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={marketSplit[market.id] ?? 0}
                      onChange={(e) => handleMarketChange(market.id, parseInt(e.target.value) || 0)}
                      className="w-20 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-right"
                    />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                ))}
                <div className={`flex items-center justify-end gap-2 text-sm pt-2 border-t border-gray-100 ${
                  isMarketSplitValid ? 'text-gray-600' : 'text-amber-600'
                }`}>
                  <span>Total:</span>
                  <span className="font-medium">{marketSplitTotal}%</span>
                  {!isMarketSplitValid && <span title="Split doesn't total 100% - will be treated as ratio">⚠</span>}
                </div>
              </div>
            </FieldSection>

            {/* ---- Tags Section ---- */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">Tags</span>
              </div>
              <div className="px-3 py-3 border-t border-gray-200 bg-white space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Add tags</label>
                  <TagInput
                    tags={tagsToAdd}
                    onChange={setTagsToAdd}
                    suggestions={allTags}
                    placeholder="Add tags…"
                  />
                </div>
                {existingTags.length > 0 && (
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Current tags <span className="text-gray-400">(click to remove)</span></label>
                    <div className="flex flex-wrap gap-1">
                      {existingTags.map(([tag, count]) => {
                        const removing = tagsToRemove.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => {
                              if (removing) {
                                setTagsToRemove(prev => prev.filter(t => t !== tag));
                              } else {
                                setTagsToRemove(prev => [...prev, tag]);
                              }
                            }}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full transition-colors ${
                              removing
                                ? 'bg-red-100 text-red-600 line-through'
                                : 'bg-blue-100 text-blue-800 hover:bg-red-100 hover:text-red-600'
                            }`}
                            title={removing ? 'Click to keep' : `Click to remove (${count}/${selectedCount} specs)`}
                          >
                            {tag}
                            <span className={`text-[10px] ${removing ? 'text-red-400' : 'text-blue-500'}`}>
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Apply to {selectedCount} Spec{selectedCount !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SpecExplorerProps {
  filterOptions?: {
    crops: string[];
    categories: string[];
    growingStructures: string[];
    plantingMethods?: string[];
  };
  allHeaders?: string[];
}

const STORAGE_KEY = 'spec-explorer-state-v1'; // Reset for CropExplorer → SpecExplorer rename

type SortDirection = 'asc' | 'desc' | null;
type FilterValue = string | string[] | { min?: number; max?: number } | boolean | null;

interface PersistedState {
  visibleColumns: string[];
  columnOrder: string[];
  columnWidths: Record<string, number>;
  columnFilters?: Record<string, FilterValue>;
  sortColumn: string | null;
  sortDirection: SortDirection;
  filterPaneOpen: boolean;
  filterPaneWidth: number;
  scrollTop?: number;
  frozenColumnCount?: number;
  showDeprecated?: boolean;
  showFavoritesOnly?: boolean;
}

function loadPersistedState(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return null;
}

function savePersistedState(state: PersistedState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 40;
const MIN_COL_WIDTH = 50;
const DEFAULT_FILTER_PANE_WIDTH = 280;

// Determine the type of a column based on its values
function getColumnType(crops: PlantingSpec[], col: string): 'boolean' | 'number' | 'categorical' | 'text' {
  // Tags column is always categorical (individual tags as options)
  if (col === 'tagsDisplay') return 'categorical';

  const values = crops.map(c => c[col as keyof PlantingSpec]).filter(v => v !== null && v !== undefined);
  if (values.length === 0) return 'text';

  const sample = values[0];
  if (typeof sample === 'boolean') return 'boolean';
  if (typeof sample === 'number') return 'number';

  // Check if categorical (< 30 unique string values)
  const uniqueStrings = new Set(values.map(v => String(v)));
  if (uniqueStrings.size <= 30) return 'categorical';

  return 'text';
}

// Special marker for empty/null/undefined values in filters
const NONE_VALUE = '__none__';

// Get unique values for categorical columns
function getUniqueValuesForColumn(crops: PlantingSpec[], col: string): string[] {
  const values = new Set<string>();
  let hasEmpty = false;

  // Tags: explode arrays into individual values
  if (col === 'tagsDisplay') {
    crops.forEach(c => {
      const tags = c.tags;
      if (!tags || tags.length === 0) {
        hasEmpty = true;
      } else {
        tags.forEach(t => values.add(t));
      }
    });
  } else {
    crops.forEach(c => {
      const v = c[col as keyof PlantingSpec];
      if (v === null || v === undefined || v === '') {
        hasEmpty = true;
      } else {
        values.add(String(v));
      }
    });
  }

  const sorted = Array.from(values).sort();
  // Add "(None)" option at the beginning if there are empty values
  if (hasEmpty) {
    sorted.unshift(NONE_VALUE);
  }
  return sorted;
}

// Get min/max for numeric columns
function getNumericRange(crops: PlantingSpec[], col: string): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  crops.forEach(c => {
    const v = c[col as keyof PlantingSpec];
    if (typeof v === 'number' && !isNaN(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  });
  return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 100 : max };
}

// Helper to create a Planting from a planting spec using CRUD function
function createPlantingFromSpec(crop: PlantingSpec, planYear: number): Planting {
  // Use targetFieldDate if available, otherwise fall back to June 1st
  const fieldStartDate = crop.targetFieldDate
    ? `${planYear}-${crop.targetFieldDate}`
    : `${planYear}-06-01`;

  return createPlanting({
    specId: crop.id,
    fieldStartDate,
    startBed: null, // Unassigned
    bedFeet: 50, // Default 1 bed
  });
}

export default function SpecExplorer({ allHeaders }: SpecExplorerProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCropId, setSelectedCropId] = useState<string | null>(null);

  // Multi-select state
  const [selectedCropIds, setSelectedCropIds] = useState<Set<string>>(new Set());

  // Add to Plan state
  const [showAddToPlan, setShowAddToPlan] = useState(false);
  const [cropsToAdd, setCropsToAdd] = useState<PlantingSpec[]>([]); // Crops to add (single or multiple)
  const [addingToPlan, setAddingToPlan] = useState(false);
  const [addToPlanMessage, setAddToPlanMessage] = useState<{ type: 'success' | 'error'; text: string; planId?: string } | null>(null);

  // Create custom spec state
  const [showCreateSpec, setShowCreateSpec] = useState(false);
  const [copySourceSpec, setCopySourceSpec] = useState<PlantingSpec | null>(null);

  // Edit spec state
  const [showEditSpec, setShowEditSpec] = useState(false);
  const [specToEdit, setSpecToEdit] = useState<PlantingSpec | null>(null);

  // Delete spec state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [specsToDelete, setSpecsToDelete] = useState<PlantingSpec[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // Compare specs state
  const [showCompare, setShowCompare] = useState(false);

  // GDD explorer state
  const [showGddExplorer, setShowGddExplorer] = useState(false);

  // Bulk spec editor state
  const [showBulkEditor, setShowBulkEditor] = useState(false);

  // Track which column and row is currently being edited (has focus)
  const [activeEditColumn, setActiveEditColumn] = useState<string | null>(null);
  const [activeEditRow, setActiveEditRow] = useState<number | null>(null);

  // Use shared store state - automatically syncs across tabs
  // Only subscribe to specs, not the entire plan (avoids re-renders when plantings change)
  const specs = usePlanStore((state) => state.currentPlan?.specs);
  const plantings = usePlanStore((state) => state.currentPlan?.plantings);
  const currentPlanId = usePlanStore((state) => state.currentPlan?.id);
  const planYear = usePlanStore((state) => state.currentPlan?.metadata?.year) ?? new Date().getFullYear();
  const lastFrostDate = usePlanStore((state) => state.currentPlan?.metadata?.lastFrostDate);
  // Note: timingSettings (transplantShockDays, defaultTransplantAge) are read directly
  // from store by PlantingSpecEditor - no need to subscribe here and cause table refreshes
  const varieties = usePlanStore((state) => state.currentPlan?.varieties);
  const seedMixes = usePlanStore((state) => state.currentPlan?.seedMixes);
  const products = usePlanStore((state) => state.currentPlan?.products);
  const markets = usePlanStore((state) => state.currentPlan?.markets);
  const crops = usePlanStore((state) => state.currentPlan?.crops);
  const gddLocation = usePlanStore((state) => state.currentPlan?.metadata?.location);
  const catalogLoading = usePlanStore((state) => state.isLoading);
  const loadPlanById = usePlanStore((state) => state.loadPlanById);
  const bulkAddPlantings = usePlanStore((state) => state.bulkAddPlantings);
  const updatePlantingSpec = usePlanStore((state) => state.updatePlantingSpec);
  const addPlantingSpec = usePlanStore((state) => state.addPlantingSpec);
  const deletePlantingSpecs = usePlanStore((state) => state.deletePlantingSpecs);
  const toggleSpecFavorite = usePlanStore((state) => state.toggleSpecFavorite);
  const bulkUpdatePlantingSpecs = usePlanStore((state) => state.bulkUpdatePlantingSpecs);
  const addSeedMix = usePlanStore((state) => state.addSeedMix);
  const addVariety = usePlanStore((state) => state.addVariety);
  const activePlanId = usePlanStore((state) => state.activePlanId);
  const setActivePlanId = usePlanStore((state) => state.setActivePlanId);
  const planList = usePlanStore((state) => state.planList);

  // UI store - select new plantings after adding
  const clearSelection = useUIStore((state) => state.clearSelection);
  const selectMultiple = useUIStore((state) => state.selectMultiple);

  // Find active plan info from list
  const activePlan = useMemo(() => {
    if (!activePlanId) return null;
    return planList.find(p => p.id === activePlanId) ?? null;
  }, [planList, activePlanId]);

  // GDD temperature data for selected spec
  const gdd = useGdd(gddLocation?.lat, gddLocation?.lon, planYear);

  // Convert catalog object to array for display
  const planCatalog = useMemo(() => {
    if (!specs) return [];
    return Object.values(specs) as PlantingSpec[];
  }, [specs]);

  // Dynamic filters keyed by column name
  const [columnFilters, setColumnFilters] = useState<Record<string, FilterValue>>({});

  // Check if a plan is properly loaded
  const isPlanLoaded = activePlanId && currentPlanId === activePlanId && planCatalog.length > 0;

  // Only use plan's catalog - never fall back to template data
  const baseCrops = useMemo(() => {
    if (isPlanLoaded) {
      return planCatalog as PlantingSpec[];
    }
    // No plan loaded - return empty array
    return [];
  }, [isPlanLoaded, planCatalog]);

  // Extend type to include computed fields
  type CropWithComputed = PlantingSpec & {
    revenuePerBed?: number | null;
    maxYieldPerWeek?: string;
    minYieldPerWeek?: string;
    inUse?: boolean;
    yieldPerHarvestDisplay?: string;
    totalYieldDisplay?: string;
    defaultSeedSourceDisplay?: string;
    tagsDisplay?: string;
  };

  // Build set of specIds that are in use (have plantings)
  const specsInUse = useMemo(() => {
    if (!plantings) return new Set<string>();
    return new Set(plantings.map(p => p.specId));
  }, [plantings]);

  // Enrich crops with computed fields (revenue, yield per week, inUse for a standard bed)
  const displayCrops: CropWithComputed[] = useMemo(() => {
    return baseCrops.map(crop => {
      const revenue = products && Object.keys(products).length > 0
        ? calculateSpecRevenue(crop as PlantingSpec, STANDARD_BED_LENGTH, products)
        : null;
      const yieldPerWeek = products && Object.keys(products).length > 0
        ? calculateYieldPerWeek(crop as PlantingSpec, STANDARD_BED_LENGTH, products)
        : { displayMax: '', displayMin: '', products: [] };
      // Calculate yield per harvest with unit (use calculated value to support yieldFormula-based specs)
      const computedYieldPerHarvest = calculateYieldPerHarvest(crop as PlantingSpec, STANDARD_BED_LENGTH);
      // Get unit from primary product
      const primaryProductId = crop.productYields?.[0]?.productId;
      const primaryUnit = primaryProductId && products ? products[primaryProductId]?.unit ?? '' : '';
      const yieldPerHarvestDisplay = computedYieldPerHarvest !== null
        ? `${computedYieldPerHarvest >= 10 ? Math.round(computedYieldPerHarvest) : computedYieldPerHarvest.toFixed(1)} ${primaryUnit}`.trim()
        : undefined;
      // Calculate total yield display from yield formula results
      const totalYieldDisplay = yieldPerWeek.products.length > 0
        ? yieldPerWeek.products.map(p => {
            const formatted = p.totalYield >= 10 ? Math.round(p.totalYield).toString() : p.totalYield.toFixed(1);
            return `${formatted} ${p.unit ?? ''}`.trim();
          }).join(', ')
        : undefined;
      // Build comma-separated list of product names from productYields
      const productsDisplay = crop.productYields?.length && products
        ? crop.productYields
            .map(py => products[py.productId]?.product)
            .filter(Boolean)
            .join(', ')
        : undefined;
      // Build default seed source display text
      let defaultSeedSourceDisplay: string | undefined;
      if (crop.defaultSeedSource) {
        if (crop.defaultSeedSource.type === 'variety' && varieties) {
          const v = varieties[crop.defaultSeedSource.id];
          defaultSeedSourceDisplay = v
            ? `${v.name}${v.supplier ? ` (${v.supplier})` : ''}`
            : crop.defaultSeedSource.id;
        } else if (crop.defaultSeedSource.type === 'mix' && seedMixes) {
          const m = seedMixes[crop.defaultSeedSource.id];
          defaultSeedSourceDisplay = m ? m.name : crop.defaultSeedSource.id;
        }
      }
      return {
        ...crop,
        revenuePerBed: revenue,
        maxYieldPerWeek: yieldPerWeek.displayMax,
        minYieldPerWeek: yieldPerWeek.displayMin,
        inUse: specsInUse.has(crop.id),
        yieldPerHarvestDisplay,
        totalYieldDisplay,
        productsDisplay,
        defaultSeedSourceDisplay,
        tagsDisplay: crop.tags?.join(', ') || undefined,
      };
    });
  }, [baseCrops, products, specsInUse, varieties, seedMixes]);

  // All columns come from the schema - single source of truth
  const allColumns = allHeaders && allHeaders.length > 0 ? allHeaders : DEFAULT_COLUMN_ORDER;

  // Initialize with defaults (hydration-safe), then load from localStorage
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(DEFAULT_VISIBLE_COLUMNS));
  const [columnOrder, setColumnOrder] = useState<string[]>(allColumns);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [sortColumn, setSortColumn] = useState<string | null>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [filterPaneOpen, setFilterPaneOpen] = useState(true);
  const [filterPaneWidth, setFilterPaneWidth] = useState(DEFAULT_FILTER_PANE_WIDTH);
  const [frozenColumnCount, setFrozenColumnCount] = useState(1); // Default: freeze first column
  const [hydrated, setHydrated] = useState(false);
  const [pendingScrollTop, setPendingScrollTop] = useState<number | null>(null);
  const scrollRestoredRef = useRef(false);

  // Load persisted state after hydration to avoid SSR mismatch
  useEffect(() => {
    const persisted = loadPersistedState();
    if (persisted) {
      // Filter persisted visible columns against current schema, adding
      // any default-visible columns that are new (e.g. 'name' replacing 'identifier')
      const existing = new Set(allColumns);
      if (persisted.visibleColumns) {
        const validVisible = persisted.visibleColumns.filter(c => existing.has(c));
        // Add any default-visible columns missing from persisted state (new columns)
        for (const col of DEFAULT_VISIBLE_COLUMNS) {
          if (!validVisible.includes(col)) validVisible.push(col);
        }
        setVisibleColumns(new Set(validVisible));
      } else {
        setVisibleColumns(new Set(DEFAULT_VISIBLE_COLUMNS));
      }
      if (persisted.columnOrder) {
        const order = persisted.columnOrder.filter(c => existing.has(c));
        allColumns.forEach(c => { if (!order.includes(c)) order.push(c); });
        setColumnOrder(order);
      }
      setColumnWidths(persisted.columnWidths ?? {});
      setColumnFilters(persisted.columnFilters ?? {});
      const sortCol = persisted.sortColumn && existing.has(persisted.sortColumn) ? persisted.sortColumn : 'name';
      setSortColumn(sortCol);
      setSortDirection(persisted.sortDirection ?? 'asc');
      setFilterPaneOpen(persisted.filterPaneOpen ?? true);
      setFilterPaneWidth(persisted.filterPaneWidth ?? DEFAULT_FILTER_PANE_WIDTH);
      setFrozenColumnCount(persisted.frozenColumnCount ?? 1);
      setShowDeprecated(persisted.showDeprecated ?? false);
      setShowFavoritesOnly(persisted.showFavoritesOnly ?? false);
      // Queue scroll restoration for after render
      if (persisted.scrollTop != null && persisted.scrollTop > 0) {
        setPendingScrollTop(persisted.scrollTop);
      }
    }
    setHydrated(true);
  }, [allColumns]);

  const [showColumnManager, setShowColumnManager] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const [columnFilter, setColumnFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [sidebarColumnSearch, setSidebarColumnSearch] = useState('');

  // Show/hide deprecated crops toggle (default false, persisted)
  const [showDeprecated, setShowDeprecated] = useState(false);

  // Show only favorites toggle (default false, persisted)
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // Drag state for column reordering
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Resize state for columns
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(0);

  // Resize state for filter pane
  const [resizingPane, setResizingPane] = useState(false);
  const [paneResizeStartX, setPaneResizeStartX] = useState(0);
  const [paneResizeStartWidth, setPaneResizeStartWidth] = useState(0);

  // Persist state (only after hydration to avoid overwriting with defaults)
  useEffect(() => {
    if (!hydrated) return;
    savePersistedState({
      visibleColumns: Array.from(visibleColumns),
      columnOrder,
      columnWidths,
      columnFilters,
      sortColumn,
      sortDirection,
      filterPaneOpen,
      filterPaneWidth,
      frozenColumnCount,
      showDeprecated,
      showFavoritesOnly,
    });
  }, [hydrated, visibleColumns, columnOrder, columnWidths, columnFilters, sortColumn, sortDirection, filterPaneOpen, filterPaneWidth, frozenColumnCount, showDeprecated, showFavoritesOnly]);

  // Count deprecated crops for the toggle label
  const deprecatedCount = useMemo(() => {
    return displayCrops.filter(c => c.deprecated).length;
  }, [displayCrops]);

  // Count favorite crops for the toggle label
  const favoritesCount = useMemo(() => {
    return displayCrops.filter(c => c.isFavorite).length;
  }, [displayCrops]);

  // Dynamic options for combobox columns
  const uniqueCropNames = useMemo(() => {
    const names = new Set<string>();
    displayCrops.forEach(c => {
      if (c.crop) names.add(c.crop);
    });
    return Array.from(names).sort();
  }, [displayCrops]);

  const uniqueIrrigationValues = useMemo(() => {
    const values = new Set<string>();
    displayCrops.forEach(c => {
      if (c.irrigation) values.add(c.irrigation);
    });
    return Array.from(values).sort();
  }, [displayCrops]);

  const uniqueTrellisTypes = useMemo(() => {
    const values = new Set<string>();
    displayCrops.forEach(c => {
      if (c.trellisType) values.add(c.trellisType);
    });
    return Array.from(values).sort();
  }, [displayCrops]);

  const uniqueCategories = useMemo(() => {
    const values = new Set<string>();
    displayCrops.forEach(c => {
      if (c.category) values.add(c.category);
    });
    return Array.from(values).sort();
  }, [displayCrops]);

  const uniqueGrowingStructures = useMemo(() => {
    const values = new Set<string>();
    displayCrops.forEach(c => {
      if (c.growingStructure) values.add(c.growingStructure);
    });
    return Array.from(values).sort();
  }, [displayCrops]);

  const uniqueRowCoverValues = useMemo(() => {
    const values = new Set<string>();
    displayCrops.forEach(c => {
      if (c.rowCover) values.add(c.rowCover);
    });
    return Array.from(values).sort();
  }, [displayCrops]);

  // Map of dynamic option keys to their values
  const dynamicOptionsMap: Record<DynamicOptionKey, string[]> = useMemo(() => ({
    crop: uniqueCropNames,
    irrigation: uniqueIrrigationValues,
    trellisType: uniqueTrellisTypes,
    category: uniqueCategories,
    growingStructure: uniqueGrowingStructures,
    rowCover: uniqueRowCoverValues,
    tags: [...new Set(displayCrops.flatMap(s => s.tags ?? []))].sort(),
  }), [uniqueCropNames, uniqueIrrigationValues, uniqueTrellisTypes, uniqueCategories, uniqueGrowingStructures, uniqueRowCoverValues, displayCrops]);

  // Columns to display (filtered by sidebar search if active)
  const displayColumns = useMemo(() => {
    let cols = columnOrder.filter(col => visibleColumns.has(col));
    if (sidebarColumnSearch) {
      const q = sidebarColumnSearch.toLowerCase();
      cols = cols.filter(col => col.toLowerCase().includes(q));
    }
    return cols;
  }, [columnOrder, visibleColumns, sidebarColumnSearch]);

  // Compute frozen column set and left offsets
  const frozenColumns = useMemo(() => {
    return new Set(displayColumns.slice(0, frozenColumnCount));
  }, [displayColumns, frozenColumnCount]);

  // Get left offset for a frozen column (sum of widths of all frozen columns before it)
  const getFrozenLeftOffset = useCallback((col: string, colIndex: number) => {
    if (!frozenColumns.has(col)) return undefined;
    let offset = 0;
    for (let i = 0; i < colIndex; i++) {
      const c = displayColumns[i];
      if (frozenColumns.has(c)) {
        offset += columnWidths[c] ?? getDefaultColumnWidth(c);
      }
    }
    return offset;
  }, [frozenColumns, displayColumns, columnWidths]);

  // Total width of frozen columns (for non-frozen content offset)
  const frozenColumnsWidth = useMemo(() => {
    let width = 0;
    for (let i = 0; i < frozenColumnCount && i < displayColumns.length; i++) {
      width += columnWidths[displayColumns[i]] ?? getDefaultColumnWidth(displayColumns[i]);
    }
    return width;
  }, [frozenColumnCount, displayColumns, columnWidths]);

  // Column metadata (type, options, range) for ALL columns
  const columnMeta = useMemo(() => {
    const meta: Record<string, { type: 'boolean' | 'number' | 'categorical' | 'text'; options?: string[]; range?: { min: number; max: number } }> = {};
    allColumns.forEach(col => {
      const type = getColumnType(displayCrops, col);
      meta[col] = { type };
      if (type === 'categorical') {
        meta[col].options = getUniqueValuesForColumn(displayCrops, col);
      } else if (type === 'number') {
        meta[col].range = getNumericRange(displayCrops, col);
      }
    });
    return meta;
  }, [displayCrops, allColumns]);

  // Columns for filter pane: visible first, then hidden
  const filterPaneColumns = useMemo(() => {
    const hidden = allColumns.filter(col => !visibleColumns.has(col));
    return [...displayColumns, ...hidden];
  }, [allColumns, displayColumns, visibleColumns]);

  const getColumnWidth = useCallback((col: string) => {
    return columnWidths[col] ?? getDefaultColumnWidth(col);
  }, [columnWidths]);

  // Parse search query using DSL
  // Sort field names derived from config
  const specSortFields = useMemo(() => new Set(getSortFieldNames(plantingSpecSearchConfig)), []);
  const parsedSearch = useMemo((): ParsedSearchQuery => {
    return parseSearchQuery(searchQuery, specSortFields);
  }, [searchQuery, specSortFields]);

  // Filter crops
  const filteredCrops = useMemo(() => {
    return displayCrops.filter(spec => {
      // Hide deprecated specs if toggle is off
      if (!showDeprecated && spec.deprecated) return false;

      // Show only favorites if toggle is on
      if (showFavoritesOnly && !spec.isFavorite) return false;

      // DSL search - supports field:value, negation, and plain text
      if (!matchesFilter(spec, parsedSearch.filterTerms, plantingSpecSearchConfig)) return false;

      // Column filters (sidebar filters)
      for (const [col, filterVal] of Object.entries(columnFilters)) {
        if (filterVal === null || filterVal === undefined || filterVal === '') continue;
        if (Array.isArray(filterVal) && filterVal.length === 0) continue;

        const specVal = spec[col as keyof PlantingSpec];
        const meta = columnMeta[col];

        if (!meta) continue;

        // Tags column: match against the tags array, not the display string
        if (col === 'tagsDisplay' && Array.isArray(filterVal)) {
          const specTags = spec.tags ?? [];
          if (filterVal.length > 0) {
            const matchesNone = filterVal.includes(NONE_VALUE) && specTags.length === 0;
            const matchesTag = specTags.some(t => filterVal.includes(t));
            if (!matchesNone && !matchesTag) return false;
          }
          continue;
        }

        if (meta.type === 'boolean') {
          if (filterVal === 'true' && specVal !== true) return false;
          if (filterVal === 'false' && specVal !== false) return false;
        } else if (meta.type === 'number' && typeof filterVal === 'object' && !Array.isArray(filterVal)) {
          const numVal = typeof specVal === 'number' ? specVal : null;
          if (numVal === null) return false;
          if (filterVal.min !== undefined && numVal < filterVal.min) return false;
          if (filterVal.max !== undefined && numVal > filterVal.max) return false;
        } else if (meta.type === 'categorical') {
          // Multi-select: filterVal is string[] - spec must match one of the selected values
          if (Array.isArray(filterVal)) {
            if (filterVal.length > 0) {
              const isEmpty = specVal === null || specVal === undefined || specVal === '';
              const matchesNone = filterVal.includes(NONE_VALUE) && isEmpty;
              const matchesValue = !isEmpty && filterVal.includes(String(specVal));
              if (!matchesNone && !matchesValue) return false;
            }
          } else {
            // Legacy single-select support
            if (filterVal === NONE_VALUE) {
              if (specVal !== null && specVal !== undefined && specVal !== '') return false;
            } else if (String(specVal) !== String(filterVal)) {
              return false;
            }
          }
        } else if (meta.type === 'text') {
          if (!String(specVal ?? '').toLowerCase().includes(String(filterVal).toLowerCase())) return false;
        }
      }

      return true;
    });
  }, [displayCrops, parsedSearch.filterTerms, columnFilters, columnMeta, showDeprecated, showFavoritesOnly]);

  // Sort crops (DSL sort directive overrides column header sort)
  const sortedCrops = useMemo(() => {
    // Determine effective sort: DSL s:field directive takes precedence over column header click
    const effectiveSortField = parsedSearch.sortField || sortColumn;
    const effectiveSortDir = parsedSearch.sortField ? parsedSearch.sortDir : sortDirection;

    if (!effectiveSortField || !effectiveSortDir) return filteredCrops;

    return [...filteredCrops].sort((a, b) => {
      // Map DSL sort fields to spec properties
      let aVal: unknown;
      let bVal: unknown;

      // Handle special DSL sort fields that don't map directly to spec properties
      if (effectiveSortField === 'method') {
        aVal = calculatePlantingMethod(a);
        bVal = calculatePlantingMethod(b);
      } else {
        aVal = a[effectiveSortField as keyof PlantingSpec];
        bVal = b[effectiveSortField as keyof PlantingSpec];
      }

      if (aVal === null || aVal === undefined) return effectiveSortDir === 'asc' ? 1 : -1;
      if (bVal === null || bVal === undefined) return effectiveSortDir === 'asc' ? -1 : 1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return effectiveSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
        return effectiveSortDir === 'asc'
          ? (aVal === bVal ? 0 : aVal ? -1 : 1)
          : (aVal === bVal ? 0 : aVal ? 1 : -1);
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return effectiveSortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }, [filteredCrops, sortColumn, sortDirection, parsedSearch.sortField, parsedSearch.sortDir]);

  const selectedCrop = useMemo(() => {
    if (!selectedCropId) return null;
    return displayCrops.find(c => c.id === selectedCropId) || null;
  }, [displayCrops, selectedCropId]);

  // Filtered columns for column manager
  const filteredColumns = useMemo(() => {
    let cols = columnOrder;
    if (columnSearch) {
      const q = columnSearch.toLowerCase();
      cols = cols.filter(col =>
        col.toLowerCase().includes(q) ||
        getColumnDisplayName(col).toLowerCase().includes(q)
      );
    }
    if (columnFilter === 'visible') {
      cols = cols.filter(col => visibleColumns.has(col));
    } else if (columnFilter === 'hidden') {
      cols = cols.filter(col => !visibleColumns.has(col));
    }
    return cols;
  }, [columnOrder, columnSearch, columnFilter, visibleColumns]);

  const clearAllFilters = () => {
    setSearchQuery('');
    setColumnFilters({});
  };

  const toggleColumn = (col: string) => {
    const next = new Set(visibleColumns);
    if (next.has(col)) {
      next.delete(col);
    } else {
      next.add(col);
    }
    setVisibleColumns(next);
  };

  const hideColumn = (col: string) => {
    const next = new Set(visibleColumns);
    next.delete(col);
    setVisibleColumns(next);
  };

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else if (sortDirection === 'desc') { setSortColumn(null); setSortDirection(null); }
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const resetColumns = () => {
    setVisibleColumns(new Set(DEFAULT_VISIBLE_COLUMNS));
    setColumnOrder(allColumns);
    setColumnWidths({});
    setColumnFilters({});
  };

  const selectAllShown = () => {
    const next = new Set(visibleColumns);
    filteredColumns.forEach(col => next.add(col));
    setVisibleColumns(next);
  };

  const deselectAllShown = () => {
    const next = new Set(visibleColumns);
    filteredColumns.forEach(col => next.delete(col));
    setVisibleColumns(next);
  };

  // Column drag handlers
  const handleDragStart = (e: React.DragEvent, col: string) => {
    setDraggedColumn(col);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', col);
  };

  const handleDragOver = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    if (draggedColumn && draggedColumn !== col) setDragOverColumn(col);
  };

  const handleDragLeave = () => setDragOverColumn(null);

  const handleDrop = (e: React.DragEvent, targetCol: string) => {
    e.preventDefault();
    if (draggedColumn && draggedColumn !== targetCol) {
      const newOrder = [...columnOrder];
      const draggedIdx = newOrder.indexOf(draggedColumn);
      const targetIdx = newOrder.indexOf(targetCol);
      if (draggedIdx !== -1 && targetIdx !== -1) {
        newOrder.splice(draggedIdx, 1);
        newOrder.splice(targetIdx, 0, draggedColumn);
        setColumnOrder(newOrder);
      }
    }
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
    setDragOverColumn(null);
  };

  // Column resize handlers
  const handleResizeStart = (e: React.MouseEvent, col: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(col);
    setResizeStartX(e.clientX);
    setResizeStartWidth(getColumnWidth(col));
  };

  useEffect(() => {
    if (!resizingColumn) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX;
      const newWidth = Math.max(MIN_COL_WIDTH, resizeStartWidth + delta);
      setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }));
    };
    const handleMouseUp = () => setResizingColumn(null);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn, resizeStartX, resizeStartWidth]);

  // Filter pane resize handlers
  const handlePaneResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setResizingPane(true);
    setPaneResizeStartX(e.clientX);
    setPaneResizeStartWidth(filterPaneWidth);
  };

  useEffect(() => {
    if (!resizingPane) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - paneResizeStartX;
      setFilterPaneWidth(Math.max(200, Math.min(500, paneResizeStartWidth + delta)));
    };
    const handleMouseUp = () => setResizingPane(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingPane, paneResizeStartX, paneResizeStartWidth]);

  const activeFilterCount = Object.values(columnFilters).filter(v => {
    if (v === null || v === undefined || v === '') return false;
    if (Array.isArray(v)) return v.length > 0; // Multi-select: count only if has selections
    return true;
  }).length + (searchQuery ? 1 : 0);

  // Virtualization
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const headerContainerRef = useRef<HTMLDivElement>(null);

  // Track current scroll position for restoration after data updates
  const lastScrollTopRef = useRef<number>(0);
  const lastScrollLeftRef = useRef<number>(0);

  const rowVirtualizer = useVirtualizer({
    count: sortedCrops.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const totalWidth = useMemo(() => {
    return displayColumns.reduce((sum, col) => sum + getColumnWidth(col), 0);
  }, [displayColumns, getColumnWidth]);

  // Restore scroll position after hydration (once) - use RAF to avoid flushSync during render
  useEffect(() => {
    if (pendingScrollTop !== null && !scrollRestoredRef.current && sortedCrops.length > 0) {
      requestAnimationFrame(() => {
        const container = tableContainerRef.current;
        if (container) {
          container.scrollTop = pendingScrollTop;
        }
        scrollRestoredRef.current = true;
        lastScrollTopRef.current = pendingScrollTop;
        setPendingScrollTop(null);
      });
    }
  }, [pendingScrollTop, sortedCrops.length]);

  // Debounced scroll position save
  const scrollSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const scrollLeft = e.currentTarget.scrollLeft;

    // Don't save scroll position of 0 if we had a real position - this is likely
    // a spurious scroll event from a re-render resetting the container
    if (scrollTop === 0 && lastScrollTopRef.current > 100) {
      return; // Don't update lastScrollTopRef or sync header
    }

    lastScrollTopRef.current = scrollTop;
    lastScrollLeftRef.current = scrollLeft;

    // Mark as "restored" after any user scroll - this enables scroll preservation
    if (!scrollRestoredRef.current && scrollTop > 0) {
      scrollRestoredRef.current = true;
    }

    if (headerContainerRef.current) {
      headerContainerRef.current.scrollLeft = scrollLeft;
    }

    // Save scroll position to localStorage (debounced)
    if (scrollRestoredRef.current) {
      if (scrollSaveTimeoutRef.current) {
        clearTimeout(scrollSaveTimeoutRef.current);
      }
      scrollSaveTimeoutRef.current = setTimeout(() => {
        const persisted = loadPersistedState();
        if (persisted) {
          savePersistedState({ ...persisted, scrollTop });
        }
      }, 150);
    }
  }, []);

  // Update filter for a column
  const updateColumnFilter = useCallback((col: string, value: FilterValue) => {
    setColumnFilters(prev => ({ ...prev, [col]: value }));
  }, []);

  // Load plan into store when activePlanId changes (if not already loaded)
  useEffect(() => {
    if (activePlanId && currentPlanId !== activePlanId) {
      loadPlanById(activePlanId).catch(err => {
        console.error('Failed to load plan:', err);
      });
    }
  }, [activePlanId, currentPlanId, loadPlanById]);

  // Toggle selection for a single crop
  const toggleCropSelection = useCallback((cropId: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    setSelectedCropIds(prev => {
      const next = new Set(prev);
      if (next.has(cropId)) {
        next.delete(cropId);
      } else {
        next.add(cropId);
      }
      return next;
    });
  }, []);

  // Select/deselect all visible crops
  const selectAllVisible = useCallback(() => {
    setSelectedCropIds(new Set(sortedCrops.map(c => c.id)));
  }, [sortedCrops]);

  const deselectAll = useCallback(() => {
    setSelectedCropIds(new Set());
  }, []);

  // Add crops directly to the active plan via store
  const addCropsToActivePlan = useCallback(async (cropsToAddNow: PlantingSpec[]) => {
    if (!activePlanId || cropsToAddNow.length === 0) return;

    setAddingToPlan(true);
    setAddToPlanMessage(null);

    try {
      // Ensure the plan is loaded in the store
      if (currentPlanId !== activePlanId) {
        await loadPlanById(activePlanId);
      }

      // Add all crops as plantings in a single transaction
      // Get planYear from the loaded plan (may have been just loaded)
      const loadedPlanYear = usePlanStore.getState().currentPlan?.metadata?.year ?? new Date().getFullYear();
      const newPlantings = cropsToAddNow.map(crop => createPlantingFromSpec(crop, loadedPlanYear));
      const addedCount = await bulkAddPlantings(newPlantings);

      // Select the newly created plantings
      const newIds = newPlantings.map(p => p.id);
      clearSelection();
      selectMultiple(newIds);

      setAddToPlanMessage({
        type: 'success',
        text: addedCount === 1
          ? `Added "${cropsToAddNow[0].crop}" to "${activePlan?.name}"`
          : `Added ${addedCount} crops to "${activePlan?.name}"`,
        planId: activePlanId,
      });
      setSelectedCropIds(new Set());
    } catch (err) {
      setAddToPlanMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to add crops',
      });
    } finally {
      setAddingToPlan(false);
    }
  }, [activePlanId, activePlan?.name, currentPlanId, loadPlanById, bulkAddPlantings, clearSelection, selectMultiple]);

  // Quick add single crop to plan (from row button)
  const handleQuickAdd = useCallback((crop: PlantingSpec, event: React.MouseEvent) => {
    event.stopPropagation();
    if (activePlanId) {
      // Add directly to active plan
      addCropsToActivePlan([crop]);
    } else {
      // No active plan, show picker
      setCropsToAdd([crop]);
      setShowAddToPlan(true);
    }
  }, [activePlanId, addCropsToActivePlan]);

  // Add selected crops to plan (from floating bar)
  const handleAddSelectedToPlan = useCallback(() => {
    const cropsToAddList = sortedCrops.filter(c => selectedCropIds.has(c.id));
    if (cropsToAddList.length === 0) return;

    if (activePlanId) {
      // Add directly to active plan
      addCropsToActivePlan(cropsToAddList);
    } else {
      // No active plan, show picker
      setCropsToAdd(cropsToAddList);
      setShowAddToPlan(true);
    }
  }, [selectedCropIds, sortedCrops, activePlanId, addCropsToActivePlan]);

  // Handle adding crops to a plan (single or multiple) - also sets as active plan
  const handleAddToPlan = useCallback(async (planId: string) => {
    if (cropsToAdd.length === 0) return;

    setAddingToPlan(true);
    setAddToPlanMessage(null);

    try {
      // Load the plan into the store if not already loaded
      if (currentPlanId !== planId) {
        await loadPlanById(planId);
      }

      // Add all crops as plantings in a single transaction
      // Get planYear from the loaded plan (may have been just loaded)
      const loadedPlanYear = usePlanStore.getState().currentPlan?.metadata?.year ?? new Date().getFullYear();
      const newPlantings = cropsToAdd.map(crop => createPlantingFromSpec(crop, loadedPlanYear));
      const addedCount = await bulkAddPlantings(newPlantings);

      // Select the newly created plantings
      clearSelection();
      selectMultiple(newPlantings.map(p => p.id));

      // Set this as the active plan for future adds (store handles localStorage sync)
      setActivePlanId(planId);

      // Get plan name from the store's current plan
      const plan = planList.find(p => p.id === planId);
      const planName = usePlanStore.getState().currentPlan?.metadata.name || plan?.name || 'Plan';
      setAddToPlanMessage({
        type: 'success',
        text: addedCount === 1
          ? `Added "${cropsToAdd[0].crop}" to "${planName}"`
          : `Added ${addedCount} crops to "${planName}"`,
        planId,
      });
      setShowAddToPlan(false);
      setCropsToAdd([]);
      // Clear selection after adding
      setSelectedCropIds(new Set());
    } catch (err) {
      setAddToPlanMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to add crops',
      });
    } finally {
      setAddingToPlan(false);
    }
  }, [cropsToAdd, planList, currentPlanId, loadPlanById, bulkAddPlantings, setActivePlanId, clearSelection, selectMultiple]);

  // Clear message after a timeout
  useEffect(() => {
    if (addToPlanMessage) {
      const timer = setTimeout(() => setAddToPlanMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [addToPlanMessage]);

  // Get existing names from active plan's catalog
  const existingNames = useMemo(() => {
    if (!activePlanId || planCatalog.length === 0) return [];
    return planCatalog.map(c => c.name);
  }, [activePlanId, planCatalog]);

  // Handle opening the edit spec modal
  const handleEditSpec = useCallback((crop: PlantingSpec) => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Select an active plan first to edit specs',
      });
      return;
    }
    setSpecToEdit(crop as PlantingSpec);
    setShowEditSpec(true);
  }, [activePlanId]);

  // Handle saving an edited spec via store
  const handleSaveEditedSpec = useCallback(async (spec: PlantingSpec) => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Please select an active plan first',
      });
      return;
    }

    try {
      // Ensure the plan is loaded in the store
      if (currentPlanId !== activePlanId) {
        await loadPlanById(activePlanId);
      }

      // Update the spec via the store (supports undo/redo)
      await updatePlantingSpec(spec);

      setAddToPlanMessage({
        type: 'success',
        text: `Updated spec "${spec.name}"`,
        planId: activePlanId,
      });
      setShowEditSpec(false);
      setSpecToEdit(null);
    } catch (err) {
      setAddToPlanMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update spec',
      });
    }
  }, [activePlanId, currentPlanId, loadPlanById, updatePlantingSpec, specToEdit]);

  // Handle saving a new custom spec via store
  const handleSaveCustomSpec = useCallback(async (spec: PlantingSpec) => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Please select an active plan first',
      });
      return;
    }

    try {
      // Ensure the plan is loaded in the store
      if (currentPlanId !== activePlanId) {
        await loadPlanById(activePlanId);
      }

      // Add the spec via the store (supports undo/redo)
      await addPlantingSpec(spec);

      setAddToPlanMessage({
        type: 'success',
        text: `Created spec "${spec.name}"`,
        planId: activePlanId,
      });
      setShowCreateSpec(false);
    } catch (err) {
      setAddToPlanMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create spec',
      });
    }
  }, [activePlanId, currentPlanId, loadPlanById, addPlantingSpec]);

  // Handle initiating delete for a single spec (from inspector)
  const handleDeleteSpec = useCallback((crop: PlantingSpec) => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Select an active plan first to delete specs',
      });
      return;
    }
    setSpecsToDelete([crop]);
    setShowDeleteConfirm(true);
  }, [activePlanId]);

  // =============================================================================
  // EDIT MODE HANDLERS
  // =============================================================================

  // Auto-save changes immediately when value changes
  const handleCellChange = useCallback(async (specId: string, field: string, value: unknown) => {
    try {
      await bulkUpdatePlantingSpecs([{ specId, changes: { [field]: value } }]);
    } catch (err) {
      setAddToPlanMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save change',
      });
    }
  }, [bulkUpdatePlantingSpecs]);

  // Handle initiating bulk delete (from selection bar)
  const handleBulkDelete = useCallback(() => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Select an active plan first to delete specs',
      });
      return;
    }
    const cropsToDeleteList = sortedCrops.filter(c => selectedCropIds.has(c.id));
    if (cropsToDeleteList.length === 0) return;
    setSpecsToDelete(cropsToDeleteList);
    setShowDeleteConfirm(true);
  }, [activePlanId, sortedCrops, selectedCropIds]);

  // Handle confirmed deletion (uses store actions from component-level hooks)
  const handleConfirmDelete = useCallback(async () => {
    if (!activePlanId || specsToDelete.length === 0) return;

    setIsDeleting(true);
    try {
      // Ensure the plan is loaded in the store for undo/redo to work
      if (currentPlanId !== activePlanId) {
        await loadPlanById(activePlanId);
      }

      const specIds = specsToDelete.map(c => c.id);
      const result = await deletePlantingSpecs(specIds);

      if (!result.success) {
        throw new Error(result.error);
      }

      if (result.deletedCount === 0) {
        throw new Error('No specs were found to delete');
      }

      // No event dispatch needed - store update triggers UI refresh via Zustand reactivity

      setAddToPlanMessage({
        type: 'success',
        text: result.deletedCount === 1
          ? `Deleted "${specsToDelete[0]?.name ?? specIds[0]}"`
          : `Deleted ${result.deletedCount} specs`,
        planId: activePlanId,
      });

      // Clear selection if we deleted selected items
      setSelectedCropIds(prev => {
        const next = new Set(prev);
        specsToDelete.forEach(c => next.delete(c.id));
        return next;
      });

      // Clear selected crop if it was deleted
      if (selectedCropId && specsToDelete.some(c => c.id === selectedCropId)) {
        setSelectedCropId(null);
      }

      setShowDeleteConfirm(false);
      setSpecsToDelete([]);
    } catch (err) {
      setAddToPlanMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete specs',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [activePlanId, specsToDelete, selectedCropId, currentPlanId, loadPlanById, deletePlantingSpecs]);

  // Handle cancel delete
  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    setSpecsToDelete([]);
  }, []);

  // Handle copy spec (from selection bar - single item only)
  const handleCopySelected = useCallback(() => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Select an active plan first to copy specs',
      });
      return;
    }
    if (selectedCropIds.size !== 1) return;
    const cropToCopy = sortedCrops.find(c => selectedCropIds.has(c.id));
    if (!cropToCopy) return;
    setCopySourceSpec(cropToCopy);
    setShowCreateSpec(true);
  }, [activePlanId, selectedCropIds, sortedCrops]);

  // Handle bulk favorite (add all selected to favorites - single transaction)
  const handleBulkFavorite = useCallback(async () => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Select an active plan first to favorite specs',
      });
      return;
    }
    const selectedSpecs = sortedCrops.filter(c => selectedCropIds.has(c.id));
    const updates = selectedSpecs.map(c => ({ specId: c.id, changes: { isFavorite: true } }));

    const updatedCount = await bulkUpdatePlantingSpecs(updates);

    if (updatedCount === 0) {
      setAddToPlanMessage({
        type: 'success',
        text: 'All selected specs are already favorites',
      });
    } else {
      setAddToPlanMessage({
        type: 'success',
        text: `Added ${updatedCount} spec${updatedCount !== 1 ? 's' : ''} to favorites`,
      });
    }
    deselectAll();
  }, [activePlanId, selectedCropIds, sortedCrops, bulkUpdatePlantingSpecs, deselectAll]);

  // Handle bulk spec editor save (uniform changes applied to all selected)
  const handleBulkEditorSave = useCallback(async (changes: Partial<PlantingSpec>) => {
    if (!activePlanId) {
      setAddToPlanMessage({
        type: 'error',
        text: 'Select an active plan first to edit specs',
      });
      return;
    }
    const selectedSpecs = sortedCrops.filter(c => selectedCropIds.has(c.id));
    const updates = selectedSpecs.map(c => ({
      specId: c.id,
      changes,
    }));

    const updatedCount = await bulkUpdatePlantingSpecs(updates);

    if (updatedCount === 0) {
      setAddToPlanMessage({
        type: 'error',
        text: 'No specs were updated',
      });
    } else {
      const changedFields = Object.keys(changes);
      const fieldNames = changedFields.map(f => {
        if (f === 'defaultMarketSplit') return 'market split';
        return f;
      }).join(', ');
      setAddToPlanMessage({
        type: 'success',
        text: `Updated ${fieldNames} on ${updatedCount} spec${updatedCount !== 1 ? 's' : ''}`,
      });
    }
    setShowBulkEditor(false);
    deselectAll();
  }, [activePlanId, selectedCropIds, sortedCrops, bulkUpdatePlantingSpecs, deselectAll]);

  // Handle bulk tag add/remove (per-spec merge in parent, modal just emits intent)
  const handleBulkTagChanges = useCallback(async (add: string[], remove: string[]) => {
    if (!activePlanId) return;
    const selectedSpecs = sortedCrops.filter(c => selectedCropIds.has(c.id));
    const removeSet = new Set(remove.map(t => t.toLowerCase()));

    const updates = selectedSpecs.map(spec => {
      let tags = [...(spec.tags ?? [])];
      if (remove.length > 0) {
        tags = tags.filter(t => !removeSet.has(t.toLowerCase()));
      }
      if (add.length > 0) {
        const existing = new Set(tags.map(t => t.toLowerCase()));
        for (const tag of add) {
          if (!existing.has(tag.toLowerCase())) {
            tags.push(tag);
            existing.add(tag.toLowerCase());
          }
        }
      }
      return { specId: spec.id, changes: { tags } };
    });

    const updatedCount = await bulkUpdatePlantingSpecs(updates);
    if (updatedCount > 0) {
      setAddToPlanMessage({
        type: 'success',
        text: `Updated tags on ${updatedCount} spec${updatedCount !== 1 ? 's' : ''}`,
      });
    }
    setShowBulkEditor(false);
    deselectAll();
  }, [activePlanId, selectedCropIds, sortedCrops, bulkUpdatePlantingSpecs, deselectAll]);

  return (
    <div className="flex h-full">
      {/* Collapsible Filter Pane */}
      <div
        className={`flex-shrink-0 bg-white border-r border-gray-200 flex flex-col transition-all duration-200 ${
          filterPaneOpen ? '' : 'w-10'
        }`}
        style={{ width: filterPaneOpen ? filterPaneWidth : 40 }}
      >
        {filterPaneOpen ? (
          <>
            {/* Filter pane header */}
            <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700 text-sm">Filters</span>
                {activeFilterCount > 0 && (
                  <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-800 rounded-full">
                    {activeFilterCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className="text-xs text-red-600 hover:text-red-800 px-2 py-1"
                  >
                    Clear all
                  </button>
                )}
                <button
                  onClick={() => setFilterPaneOpen(false)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                  title="Collapse filters"
                >
                  ◀
                </button>
              </div>
            </div>

            {/* Search with DSL support */}
            <div className="px-3 py-2 border-b border-gray-100">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search specs..."
                sortFields={getSortFieldNames(plantingSpecSearchConfig)}
                filterFields={getFilterFieldNames(plantingSpecSearchConfig)}
                width="w-full"
              />
            </div>

            {/* Column filter search */}
            <div className="px-3 py-2 border-b border-gray-100">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter columns..."
                  value={sidebarColumnSearch}
                  onChange={(e) => setSidebarColumnSearch(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 pr-7 placeholder:text-gray-600"
                />
                {sidebarColumnSearch && (
                  <button
                    onClick={() => setSidebarColumnSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                  >
                    ×
                  </button>
                )}
              </div>
              {sidebarColumnSearch && (
                <div className="text-xs text-blue-600 mt-1">
                  Showing {displayColumns.length} of {visibleColumns.size} columns
                </div>
              )}
            </div>

            {/* Filter list - visible columns first, then hidden */}
            <div className="flex-1 overflow-y-auto">
              {filterPaneColumns.map((col, idx) => {
                const meta = columnMeta[col];
                if (!meta) return null;
                const isVisible = visibleColumns.has(col);
                const isFirstHidden = !isVisible && (idx === 0 || visibleColumns.has(filterPaneColumns[idx - 1]));

                return (
                  <div key={col}>
                    {isFirstHidden && (
                      <div className="px-3 py-2 bg-gray-100 border-y border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Hidden Columns
                      </div>
                    )}
                    <div className={`px-3 py-2 border-b border-gray-50 ${!isVisible ? 'bg-gray-50' : ''}`}>
                      <label className={`block text-xs font-medium mb-1 truncate ${isVisible ? 'text-gray-600' : 'text-gray-400'}`} title={col}>
                        {col}
                      </label>
                      <FilterInput
                        type={meta.type}
                        options={meta.options}
                        range={meta.range}
                        value={columnFilters[col]}
                        onChange={(v) => updateColumnFilter(col, v)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Resize handle */}
            <div
              onMouseDown={handlePaneResizeStart}
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-green-400 bg-transparent"
              style={{ right: 0 }}
            />
          </>
        ) : (
          <button
            onClick={() => setFilterPaneOpen(true)}
            className="flex-1 flex flex-col items-center justify-start pt-4 text-gray-400 hover:text-gray-600 hover:bg-gray-50"
            title="Expand filters"
          >
            <span className="text-lg">▶</span>
            <span className="text-xs mt-2 writing-mode-vertical" style={{ writingMode: 'vertical-rl' }}>
              Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
            </span>
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3">
          <span className="text-sm text-gray-700">
            {sortedCrops.length} of {displayCrops.length}
          </span>
          {addingToPlan && (
            <span className="text-sm text-blue-600 animate-pulse">Adding to plan...</span>
          )}
          {sortColumn && (
            <span className="text-sm text-green-600">
              Sorted by {sortColumn} ({sortDirection})
              <button
                onClick={() => { setSortColumn(null); setSortDirection(null); }}
                className="ml-1 text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </span>
          )}
          {/* Favorites filter toggle */}
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`flex items-center gap-1.5 px-2 py-1 text-sm rounded transition-colors ${
              showFavoritesOnly
                ? 'bg-amber-100 text-amber-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            title={showFavoritesOnly ? 'Show all specs' : 'Show only favorites'}
          >
            <span className={showFavoritesOnly ? 'text-amber-500' : 'text-gray-400'}>★</span>
            <span>Favorites</span>
            {favoritesCount > 0 && (
              <span className="text-xs text-gray-400">({favoritesCount})</span>
            )}
          </button>
          {/* Show deprecated toggle */}
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDeprecated}
              onChange={(e) => setShowDeprecated(e.target.checked)}
              className="rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            <span>Show deprecated</span>
            {deprecatedCount > 0 && (
              <span className="text-xs text-gray-400">({deprecatedCount})</span>
            )}
          </label>
          <div className="flex-1" />
          {/* Freeze columns control */}
          <div className="flex items-center gap-1.5 text-sm text-gray-700">
            <span>Freeze:</span>
            <select
              value={frozenColumnCount}
              onChange={(e) => setFrozenColumnCount(Number(e.target.value))}
              className="px-2 py-1 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
            >
              <option value={0}>None</option>
              {[1, 2, 3, 4, 5].map(n => (
                <option key={n} value={n}>{n} col{n > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setShowColumnManager(true)}
            className="px-3 py-1.5 text-sm text-gray-900 bg-gray-100 hover:bg-gray-200 rounded"
          >
            Columns ({visibleColumns.size}/{allColumns.length})
          </button>
          <button
            onClick={resetColumns}
            className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded"
            title="Reset columns to defaults"
          >
            Reset
          </button>
          <button
            onClick={() => {
              if (!activePlanId) {
                setAddToPlanMessage({
                  type: 'error',
                  text: 'Select an active plan first to create custom specs',
                });
                return;
              }
              setShowCreateSpec(true);
            }}
            className="px-3 py-1.5 text-sm text-white bg-green-600 hover:bg-green-700 rounded"
            title="Create a custom planting spec for your plan"
          >
            + Custom Spec
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 bg-white overflow-hidden">
          {/* Header */}
          <div ref={headerContainerRef} className="overflow-hidden border-b border-gray-200">
            <div style={{ width: totalWidth + 80, minWidth: '100%' }}>
              <div className="flex bg-gray-50" style={{ height: HEADER_HEIGHT }}>
                {/* Checkbox column - always sticky */}
                <div
                  className="w-10 flex-shrink-0 px-2 flex items-center justify-center border-r border-gray-100 bg-gray-50"
                  style={{ position: 'sticky', left: 0, zIndex: 3 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedCropIds.size > 0 && selectedCropIds.size === sortedCrops.length}
                    onChange={(e) => e.target.checked ? selectAllVisible() : deselectAll()}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    title={selectedCropIds.size === sortedCrops.length ? "Deselect all" : "Select all visible"}
                  />
                </div>
                {/* Actions column - always sticky */}
                <div
                  className="w-10 flex-shrink-0 px-2 flex items-center justify-center border-r border-gray-100 bg-gray-50"
                  style={{ position: 'sticky', left: 40, zIndex: 3 }}
                >
                  <span className="text-xs text-gray-600">+</span>
                </div>
                {displayColumns.map((col, colIndex) => {
                  const isFrozen = frozenColumns.has(col);
                  const leftOffset = getFrozenLeftOffset(col, colIndex);
                  const isLastFrozen = isFrozen && colIndex === frozenColumnCount - 1;
                  return (
                    <div
                      key={col}
                      draggable
                      onDragStart={(e) => handleDragStart(e, col)}
                      onDragOver={(e) => handleDragOver(e, col)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, col)}
                      onDragEnd={handleDragEnd}
                      style={{
                        width: getColumnWidth(col),
                        minWidth: getColumnWidth(col),
                        ...(isFrozen && {
                          position: 'sticky',
                          left: 40 + 40 + (leftOffset ?? 0), // checkbox (w-10=40px) + actions (w-10=40px) + offset
                          zIndex: 2,
                        }),
                      }}
                      className={`relative px-1.5 py-3 text-left text-xs font-medium ${getHeaderTextClass(col)} uppercase tracking-wider border-r border-gray-100 last:border-r-0 group cursor-grab select-none flex items-center min-h-[3rem] ${
                        dragOverColumn === col
                          ? 'bg-green-100 border-l-2 border-l-green-500'
                          : activeEditColumn === col
                            ? 'bg-blue-200 border-b-2 border-b-blue-500'
                            : isFrozen
                              ? 'bg-gray-100'
                              : getColumnBgClass(col, true)
                      } ${draggedColumn === col ? 'opacity-50' : ''} ${isLastFrozen ? 'shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]' : ''}`}
                      onClick={() => handleSort(col)}
                    >
                      <span className="leading-tight break-words">
                        {getColumnDisplayName(col)}
                        {sortColumn === col && <span className="ml-1 text-green-600">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                      </span>
                      {/* Hover overlay with sort/hide buttons */}
                      <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 bg-gradient-to-l from-white via-white/90 to-transparent pl-4">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSort(col); }}
                          className="text-gray-500 hover:text-green-600"
                          title="Sort"
                        >
                          {sortColumn === col ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); hideColumn(col); }}
                          className="text-gray-500 hover:text-red-500"
                          title="Hide column"
                        >
                          ×
                        </button>
                      </div>
                      {/* Resize handle */}
                      <div
                        onMouseDown={(e) => handleResizeStart(e, col)}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-green-400 group-hover:bg-gray-300"
                        style={{ marginRight: -1 }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Body */}
          <div
            ref={tableContainerRef}
            className="overflow-auto"
            style={{ height: 'calc(100% - 40px)' }}
            onScroll={handleBodyScroll}
            onBlur={(e) => {
              // Clear active column/row when focus leaves all editable cells
              // Use relatedTarget to check where focus is going
              const goingTo = e.relatedTarget as HTMLElement | null;
              if (!goingTo) {
                // Focus left the window entirely
                setActiveEditColumn(null);
                setActiveEditRow(null);
              } else {
                // Check if focus is going to another editable cell
                const editCell = goingTo.closest('[data-edit-col]');
                if (!editCell) {
                  setActiveEditColumn(null);
                  setActiveEditRow(null);
                }
              }
            }}
          >
            {catalogLoading ? (
              <div className="flex items-center justify-center text-gray-600 h-full">
                <span className="animate-pulse">Loading catalog...</span>
              </div>
            ) : !isPlanLoaded ? (
              <div className="flex flex-col items-center justify-center text-gray-600 h-full gap-4">
                <p>Select a plan to view planting specs</p>
                <button
                  onClick={() => router.push('/plans')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Go to Plans
                </button>
              </div>
            ) : sortedCrops.length === 0 ? (
              <div className="flex items-center justify-center text-gray-600 h-full">
                No crops match your filters
              </div>
            ) : (
            <div style={{ width: totalWidth + 80, minWidth: '100%' }}>
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const crop = sortedCrops[virtualRow.index];
                  const isSelected = selectedCropIds.has(crop.id);
                  // Use name as key since it's guaranteed unique within a plan's catalog
                  const rowKey = crop.name || `row-${virtualRow.index}`;
                  return (
                    <div
                      key={rowKey}
                      onClick={() => setSelectedCropId(crop.id === selectedCropId ? null : crop.id)}
                      className={`flex cursor-pointer hover:bg-gray-50 border-b border-gray-100 group ${
                        activeEditRow === virtualRow.index
                          ? 'ring-2 ring-inset ring-blue-400 bg-blue-50/50'
                          : selectedCropId === crop.id
                            ? 'bg-green-50'
                            : isSelected
                              ? 'bg-blue-50'
                              : ''
                      } ${crop.deprecated ? 'opacity-50' : ''}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: ROW_HEIGHT,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {/* Checkbox - always sticky */}
                      <div
                        className="w-10 shrink-0 px-2 flex items-center justify-center border-r border-gray-50 bg-white"
                        style={{ position: 'sticky', left: 0, zIndex: 2 }}
                        onClick={(e) => toggleCropSelection(crop.id, e)}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </div>
                      {/* Quick add button - always sticky */}
                      <div
                        className="w-10 shrink-0 px-2 flex items-center justify-center border-r border-gray-50 bg-white"
                        style={{ position: 'sticky', left: 40, zIndex: 2 }}
                      >
                        <button
                          onClick={(e) => handleQuickAdd(crop, e)}
                          className="w-6 h-6 flex items-center justify-center rounded bg-blue-100 text-blue-600 hover:bg-blue-200 text-sm font-medium"
                          title={`Add ${crop.crop} to plan`}
                        >
                          +
                        </button>
                      </div>
                      {displayColumns.map((col, colIndex) => {
                        const isFrozen = frozenColumns.has(col);
                        const leftOffset = getFrozenLeftOffset(col, colIndex);
                        const isLastFrozen = isFrozen && colIndex === frozenColumnCount - 1;

                        // For name column, add validation status indicator
                        const isNameCol = col === 'name';
                        const validation = isNameCol ? validatePlantingSpec(crop as PlantingSpec) : null;
                        const hasIssues = validation && validation.status !== 'ok';

                        // Check if this column is editable (always editable, no edit mode toggle needed)
                        const baseEditableConfig = EDITABLE_COLUMNS[col];
                        // Resolve dynamic options from column values for comboboxes
                        const editableConfig = baseEditableConfig ? {
                          ...baseEditableConfig,
                          options: baseEditableConfig.dynamicOptions
                            ? dynamicOptionsMap[baseEditableConfig.dynamicOptions]
                            : baseEditableConfig.options,
                        } : undefined;
                        const isEditable = !!editableConfig;
                        const cellValue = crop[col as keyof PlantingSpec];

                        return (
                          <div
                            key={col}
                            data-edit-row={isEditable ? virtualRow.index : undefined}
                            data-edit-col={isEditable ? col : undefined}
                            style={{
                              width: getColumnWidth(col),
                              minWidth: getColumnWidth(col),
                              ...(isFrozen && {
                                position: 'sticky',
                                left: 40 + 40 + (leftOffset ?? 0), // checkbox (w-10=40px) + actions (w-10=40px) + offset
                                zIndex: 1,
                              }),
                            }}
                            className={`px-3 py-2 text-sm whitespace-nowrap border-r border-gray-50 last:border-r-0 truncate flex items-center gap-1.5 ${
                              activeEditColumn === col
                                ? 'bg-blue-100'
                                : isFrozen
                                  ? 'bg-white'
                                  : getColumnBgClass(col)
                            } ${isLastFrozen ? 'shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]' : ''} ${
                              hasIssues
                                ? validation.status === 'error'
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                                : 'text-gray-900'
                            }`}
                            title={hasIssues ? `${crop[col as keyof PlantingSpec]}\n\nIssues:\n• ${validation.issues.join('\n• ')}` : String(crop[col as keyof PlantingSpec] ?? '')}
                          >
                            {/* Favorite star for name column */}
                            {isNameCol && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSpecFavorite(crop.id);
                                }}
                                className={`shrink-0 transition-colors ${
                                  crop.isFavorite
                                    ? 'text-amber-400 hover:text-amber-500'
                                    : 'text-gray-300 hover:text-gray-500'
                                }`}
                                title={crop.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                              >
                                ★
                              </button>
                            )}
                            {/* Validation indicator for name column */}
                            {isNameCol && hasIssues && (
                              <span
                                className={`shrink-0 ${
                                  validation.status === 'error'
                                    ? 'text-red-500'
                                    : 'text-amber-500'
                                }`}
                                title={validation.issues.join('\n')}
                              >
                                {validation.status === 'error' ? (
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </span>
                            )}
                            {/* Editable cell or display value */}
                            {isEditable && editableConfig.type === 'seedSource' ? (
                              <InlineSeedSourceSelect
                                value={crop.defaultSeedSource}
                                cropName={crop.crop}
                                varieties={varieties ?? {}}
                                seedMixes={seedMixes ?? {}}
                                onChange={(value: SeedSource | undefined) => handleCellChange(crop.id, 'defaultSeedSource', value)}
                                onFocus={() => {
                                  setActiveEditColumn(col);
                                  setActiveEditRow(virtualRow.index);
                                }}
                                onAddMix={addSeedMix}
                                allVarieties={varieties}
                                crops={crops}
                                onAddVariety={addVariety}
                              />
                            ) : isEditable && editableConfig.type === 'tags' ? (
                              <div className="w-full" onClick={(e) => e.stopPropagation()}>
                                <TagInput
                                  tags={crop.tags ?? []}
                                  onChange={(tags) => handleCellChange(crop.id, 'tags', tags)}
                                  suggestions={dynamicOptionsMap.tags}
                                  compact
                                />
                              </div>
                            ) : isEditable ? (
                              <EditableCell
                                value={cellValue}
                                config={editableConfig}
                                onChange={(value) => handleCellChange(crop.id, col, value)}
                                hasChanges={false}
                                onFocus={() => {
                                  setActiveEditColumn(col);
                                  setActiveEditRow(virtualRow.index);
                                }}
                              />
                            ) : (
                              <span className="truncate">{formatCellValue(
                                col === 'yieldPerHarvest' ? crop.yieldPerHarvestDisplay
                                  : col === 'totalYield' ? crop.totalYieldDisplay
                                  : crop[col as keyof PlantingSpec],
                                col
                              )}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
            )}
          </div>
        </div>
      </div>

      {/* Column Manager Modal */}
      {showColumnManager && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
          <div className="bg-white rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Manage Columns</h2>
              <button onClick={() => setShowColumnManager(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            <div className="px-4 py-3 border-b border-gray-200 space-y-3">
              <input
                type="text"
                placeholder="Search columns..."
                value={columnSearch}
                onChange={(e) => setColumnSearch(e.target.value)}
                className="w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 placeholder:text-gray-600"
                autoFocus
              />
              <div className="flex gap-2 flex-wrap">
                {(['all', 'visible', 'hidden'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setColumnFilter(f)}
                    className={`px-3 py-1 text-sm rounded-md ${
                      columnFilter === f ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {f === 'all' ? `All (${allColumns.length})` : f === 'visible' ? `Visible (${visibleColumns.size})` : `Hidden (${allColumns.length - visibleColumns.size})`}
                  </button>
                ))}
                <div className="flex-1" />
                <button onClick={resetColumns} className="px-3 py-1 text-sm text-blue-600 hover:underline">Reset all</button>
              </div>

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <span className="text-sm text-gray-700 py-1">{filteredColumns.length} columns:</span>
                <button onClick={selectAllShown} className="px-2 py-1 text-sm bg-green-50 text-green-700 hover:bg-green-100 rounded">Select all shown</button>
                <button onClick={deselectAllShown} className="px-2 py-1 text-sm bg-red-50 text-red-700 hover:bg-red-100 rounded">Deselect all shown</button>
                <div className="flex-1" />
                <button onClick={() => setVisibleColumns(new Set(allColumns))} className="px-2 py-1 text-sm text-gray-600 hover:text-gray-900">Show all</button>
                <button onClick={() => setVisibleColumns(new Set())} className="px-2 py-1 text-sm text-gray-600 hover:text-gray-900">Hide all</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              <div className="grid grid-cols-2 gap-1">
                {filteredColumns.map(col => (
                  <label
                    key={col}
                    className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer ${
                      visibleColumns.has(col) ? 'bg-green-50 hover:bg-green-100' : 'bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(col)}
                      onChange={() => toggleColumn(col)}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className={`text-sm truncate ${visibleColumns.has(col) ? 'text-gray-900' : 'text-gray-600'}`}>{getColumnDisplayName(col)}</span>
                  </label>
                ))}
              </div>
              {filteredColumns.length === 0 && <div className="text-center text-gray-700 py-8">No columns match</div>}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end">
              <button onClick={() => setShowColumnManager(false)} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail panel */}
      {selectedCrop && (
        <div className="fixed right-4 top-20 w-96 max-h-[calc(100vh-100px)] bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden" style={{ zIndex: Z_INDEX.DETAIL_PANEL }}>
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-green-50">
            <div>
              <h2 className="font-semibold text-gray-900">{selectedCrop.crop}</h2>
              <p className="text-xs text-gray-600 font-mono">{selectedCrop.id}</p>
            </div>
            <button onClick={() => setSelectedCropId(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
          </div>
          {/* Action buttons */}
          <div className="px-4 py-2 border-b border-gray-100 flex gap-2">
            <button
              onClick={() => { setCropsToAdd([selectedCrop]); setShowAddToPlan(true); }}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Add to Plan
            </button>
            <button
              onClick={() => handleEditSpec(selectedCrop)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              title="Edit this spec in the active plan's catalog"
            >
              Edit
            </button>
            <button
              onClick={() => setShowGddExplorer(true)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              title="Explore GDD timing for this spec"
              disabled={!gdd.isLoaded || !selectedCrop.productYields?.length}
            >
              GDD
            </button>
          </div>
          <div className="overflow-y-auto max-h-[calc(100vh-300px)]">
            <div className="p-4 space-y-1">
              {allColumns.map(key => {
                const value = key === 'yieldPerHarvest'
                  ? selectedCrop.yieldPerHarvestDisplay
                  : key === 'totalYield'
                  ? selectedCrop.totalYieldDisplay
                  : selectedCrop[key as keyof PlantingSpec];
                return (
                  <div key={key} className="flex py-1 border-b border-gray-50 last:border-0">
                    <span className="text-xs text-gray-600 w-36 flex-shrink-0 truncate" title={key}>{key}</span>
                    <span className="text-sm text-gray-900 break-all">{formatCellValue(value, key)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Delete button at bottom */}
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
            <button
              onClick={() => handleDeleteSpec(selectedCrop)}
              className="w-full px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors"
            >
              Delete Spec
            </button>
          </div>
        </div>
      )}

      {/* Add to Plan Modal */}
      {showAddToPlan && cropsToAdd.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
          <div className="bg-white rounded-lg shadow-xl w-[400px] max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Add to Plan</h2>
              <button
                onClick={() => { setShowAddToPlan(false); setCropsToAdd([]); }}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-4">
              {cropsToAdd.length === 1 ? (
                <p className="text-sm text-gray-600 mb-4">
                  Add <strong>{cropsToAdd[0].crop}</strong> to a plan. The selected plan will become your active plan.
                </p>
              ) : (
                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-2">
                    Add <strong>{cropsToAdd.length} crops</strong> to a plan. The selected plan will become your active plan.
                  </p>
                  <div className="max-h-24 overflow-y-auto text-xs text-gray-600 bg-gray-50 rounded p-2">
                    {cropsToAdd.map(c => c.crop).join(', ')}
                  </div>
                </div>
              )}

              {planList.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-700 mb-4">No plans found.</p>
                  <button
                    onClick={() => {
                      setShowAddToPlan(false);
                      setCropsToAdd([]);
                      router.push('/plans');
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    Create a Plan
                  </button>
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {planList.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => handleAddToPlan(plan.id)}
                      disabled={addingToPlan}
                      className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-50"
                    >
                      <div className="font-medium text-gray-900">{plan.name}</div>
                      <div className="text-xs text-gray-600">{plan.cropCount} crops</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => { setShowAddToPlan(false); setCropsToAdd([]); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating selection action bar */}
      {selectedCropIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-3 bg-gray-900 text-white rounded-lg shadow-xl flex items-center gap-4" style={{ zIndex: Z_INDEX.FLOATING_ACTION_BAR }}>
          <span className="text-sm">
            <strong>{selectedCropIds.size}</strong> crop{selectedCropIds.size !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handleAddSelectedToPlan}
            className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 rounded transition-colors"
          >
            Add to Plan
          </button>
          <button
            onClick={handleBulkFavorite}
            className="px-3 py-1.5 text-sm font-medium bg-amber-500 hover:bg-amber-600 rounded transition-colors"
          >
            ★ Favorite
          </button>
          <button
            onClick={() => setShowBulkEditor(true)}
            className="px-3 py-1.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 rounded transition-colors"
          >
            Bulk Edit
          </button>
          {selectedCropIds.size >= 2 && (
            <button
              onClick={() => setShowCompare(true)}
              className="px-3 py-1.5 text-sm font-medium bg-cyan-600 hover:bg-cyan-700 rounded transition-colors"
            >
              Compare
            </button>
          )}
          {selectedCropIds.size === 1 && (
            <>
              <button
                onClick={() => {
                  const crop = sortedCrops.find(c => selectedCropIds.has(c.id));
                  if (crop) handleEditSpec(crop);
                }}
                className="px-3 py-1.5 text-sm font-medium bg-purple-600 hover:bg-purple-700 rounded transition-colors"
              >
                Edit
              </button>
              <button
                onClick={handleCopySelected}
                className="px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 rounded transition-colors"
              >
                Copy
              </button>
            </>
          )}
          <button
            onClick={handleBulkDelete}
            className="px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 rounded transition-colors"
          >
            Delete
          </button>
          <button
            onClick={deselectAll}
            className="px-3 py-1.5 text-sm font-medium bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Toast notification */}
      {addToPlanMessage && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 ${
            addToPlanMessage.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
          style={{ zIndex: Z_INDEX.TOAST }}
        >
          <span>{addToPlanMessage.text}</span>
          {addToPlanMessage.type === 'success' && addToPlanMessage.planId && (
            <button
              onClick={() => router.push(`/timeline/${addToPlanMessage.planId}`)}
              className="px-2 py-1 text-sm bg-white/20 hover:bg-white/30 rounded"
            >
              View Plan
            </button>
          )}
          <button
            onClick={() => setAddToPlanMessage(null)}
            className="text-white/80 hover:text-white text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}

      {/* Create Custom Spec Modal */}
      <PlantingSpecCreator
        isOpen={showCreateSpec}
        onClose={() => { setShowCreateSpec(false); setCopySourceSpec(null); }}
        onSave={handleSaveCustomSpec}
        availableSpecs={displayCrops as PlantingSpec[]}
        existingNames={existingNames}
        varieties={varieties}
        seedMixes={seedMixes}
        products={products}
        markets={markets}
        crops={crops}
        initialSourceSpec={copySourceSpec as PlantingSpec | null}
        lastFrostDate={lastFrostDate}
      />

      {/* Edit Spec Modal */}
      <PlantingSpecEditor
        isOpen={showEditSpec}
        spec={specToEdit}
        onClose={() => { setShowEditSpec(false); setSpecToEdit(null); }}
        onSave={handleSaveEditedSpec}
        mode="edit"
        existingNames={existingNames}
        varieties={varieties}
        seedMixes={seedMixes}
        products={products}
        markets={markets}
        crops={crops}
        lastFrostDate={lastFrostDate}
      />

      {/* GDD Explorer Modal */}
      {showGddExplorer && selectedCrop && gdd.isLoaded && gdd.tempData && (
        <GddExplorerModal
          spec={selectedCrop}
          products={products ?? {}}
          baseTemp={(() => {
            // Get base temp from crop entity, or default to 50°F
            const cropEntity = crops?.[selectedCrop.cropId ?? ''];
            return cropEntity?.gddBaseTemp ?? 50;
          })()}
          upperTemp={crops?.[selectedCrop.cropId ?? '']?.gddUpperTemp}
          growingStructure={selectedCrop.growingStructure as 'field' | 'greenhouse' | 'high-tunnel' | undefined}
          tempData={gdd.tempData}
          planYear={planYear}
          onClose={() => setShowGddExplorer(false)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && specsToDelete.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
          <div className="bg-white rounded-lg shadow-xl w-[400px] max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Confirm Delete</h2>
              <button
                onClick={handleCancelDelete}
                className="text-gray-400 hover:text-gray-600 text-xl"
                disabled={isDeleting}
              >
                ×
              </button>
            </div>

            <div className="p-4">
              {specsToDelete.length === 1 ? (
                <p className="text-sm text-gray-600 mb-4">
                  Are you sure you want to delete <strong>{specsToDelete[0].name}</strong>?
                  This cannot be undone.
                </p>
              ) : (
                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-2">
                    Are you sure you want to delete <strong>{specsToDelete.length} specs</strong>?
                    This cannot be undone.
                  </p>
                  <div className="max-h-32 overflow-y-auto text-xs text-gray-600 bg-gray-50 rounded p-2 border border-gray-200">
                    {specsToDelete.map(c => c.name).join(', ')}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={handleCancelDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Deleting...
                  </>
                ) : (
                  `Delete ${specsToDelete.length === 1 ? 'Spec' : `${specsToDelete.length} Specs`}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Spec Editor Modal */}
      {showBulkEditor && markets && (
        <BulkSpecEditorModal
          isOpen={true}
          markets={markets}
          selectedCount={selectedCropIds.size}
          allTags={dynamicOptionsMap.tags}
          selectedTagCounts={(() => {
            const counts: Record<string, number> = {};
            sortedCrops.filter(c => selectedCropIds.has(c.id)).forEach(spec => {
              (spec.tags ?? []).forEach(tag => { counts[tag] = (counts[tag] ?? 0) + 1; });
            });
            return counts;
          })()}
          onClose={() => setShowBulkEditor(false)}
          onSave={handleBulkEditorSave}
          onTagChanges={handleBulkTagChanges}
        />
      )}

      {/* Compare specs modal */}
      {showCompare && (
        <CompareSpecsModal
          isOpen={true}
          specs={sortedCrops.filter(c => selectedCropIds.has(c.id)) as PlantingSpec[]}
          onClose={() => setShowCompare(false)}
          products={products}
        />
      )}

      {/* Resize overlays */}
      {resizingColumn && <div className="fixed inset-0 cursor-col-resize" style={{ zIndex: Z_INDEX.RESIZE_OVERLAY }} />}
      {resizingPane && <div className="fixed inset-0 cursor-col-resize" style={{ zIndex: Z_INDEX.RESIZE_OVERLAY }} />}
    </div>
  );
}

// Filter input component
function FilterInput({
  type,
  options,
  range,
  value,
  onChange,
}: {
  type: 'boolean' | 'number' | 'categorical' | 'text';
  options?: string[];
  range?: { min: number; max: number };
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  if (type === 'boolean') {
    return (
      <select
        value={value === 'true' ? 'true' : value === 'false' ? 'false' : ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
      >
        <option value="">Any</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  if (type === 'categorical' && options) {
    const selectedValues = Array.isArray(value) ? value : [];
    const toggleOption = (opt: string) => {
      if (selectedValues.includes(opt)) {
        const newValues = selectedValues.filter(v => v !== opt);
        onChange(newValues.length > 0 ? newValues : null);
      } else {
        onChange([...selectedValues, opt]);
      }
    };
    const clearAll = () => onChange(null);
    const selectAll = () => onChange([...options]);

    return (
      <div className="space-y-1">
        {/* Quick actions */}
        <div className="flex gap-2 text-xs">
          <button
            onClick={selectAll}
            className="text-blue-600 hover:text-blue-800"
            type="button"
          >
            All
          </button>
          <button
            onClick={clearAll}
            className="text-gray-500 hover:text-gray-700"
            type="button"
          >
            Clear
          </button>
          {selectedValues.length > 0 && (
            <span className="text-gray-400">({selectedValues.length})</span>
          )}
        </div>
        {/* Checkbox list */}
        <div className="max-h-32 overflow-y-auto border border-gray-200 rounded bg-white">
          {options.map(opt => (
            <label
              key={opt}
              className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                checked={selectedValues.includes(opt)}
                onChange={() => toggleOption(opt)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className={`truncate ${opt === NONE_VALUE ? 'text-gray-400 italic' : 'text-gray-700'}`}>
                {opt === NONE_VALUE ? '(None)' : opt}
              </span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'number' && range) {
    const rangeVal = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
    return (
      <div className="flex gap-1 items-center">
        <input
          type="number"
          placeholder={String(range.min)}
          value={rangeVal.min ?? ''}
          onChange={(e) => onChange({ ...rangeVal, min: e.target.value ? Number(e.target.value) : undefined })}
          className="w-full px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 placeholder:text-gray-600"
        />
        <span className="text-gray-600 text-xs">to</span>
        <input
          type="number"
          placeholder={String(range.max)}
          value={rangeVal.max ?? ''}
          onChange={(e) => onChange({ ...rangeVal, max: e.target.value ? Number(e.target.value) : undefined })}
          className="w-full px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 placeholder:text-gray-600"
        />
      </div>
    );
  }

  // Text filter
  return (
    <input
      type="text"
      placeholder="Contains..."
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 placeholder:text-gray-600"
    />
  );
}

// ComboBox component with Excel-like ghost text autocomplete
function ComboBox({
  value,
  options,
  onChange,
  hasChanges,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
}: {
  value: string;
  options: string[];
  onChange: (value: string | undefined) => void;
  hasChanges: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [ghostActive, setGhostActive] = useState(true);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({ display: 'none' });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter options based on input (prefix matching)
  const filteredOptions = useMemo(() => {
    if (!inputValue) return options;
    const lower = inputValue.toLowerCase();
    return options.filter(opt => opt.toLowerCase().startsWith(lower));
  }, [options, inputValue]);

  // Calculate ghost text (completion portion only)
  const ghostText = useMemo(() => {
    if (!ghostActive || !inputValue || filteredOptions.length === 0) return '';
    const match = filteredOptions[0];
    if (!match.toLowerCase().startsWith(inputValue.toLowerCase())) return '';
    return match.slice(inputValue.length);
  }, [ghostActive, inputValue, filteredOptions]);

  // Full value = typed + ghost
  const fullValue = inputValue + ghostText;

  // Sync input with external value changes
  useEffect(() => {
    setInputValue(value);
    setGhostActive(true);
  }, [value]);

  // Accept the current value (typed + ghost) and save
  const acceptValue = useCallback(() => {
    const valueToSave = fullValue || undefined;
    if (valueToSave !== value) {
      onChange(valueToSave);
    }
    setInputValue(fullValue);
    setGhostActive(true);
  }, [fullValue, value, onChange]);

  // Navigate then accept - navigate FIRST while DOM is still in original state
  const acceptAndNavigate = useCallback((direction: 'up' | 'down') => {
    // Navigate before state changes trigger re-render
    if (inputRef.current) {
      moveFocusVerticalDirect(inputRef.current, direction);
    }
    acceptValue();
    setIsOpen(false);
  }, [acceptValue]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acceptAndNavigate('down');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acceptAndNavigate('up');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Navigate before state changes trigger re-render
      if (inputRef.current) {
        moveFocusVerticalDirect(inputRef.current, 'down');
      }
      acceptValue();
      setIsOpen(false);
    } else if (e.key === 'Tab') {
      // Accept value (browser handles focus move to next cell)
      acceptValue();
      setIsOpen(false);
    } else if (e.key === 'Backspace') {
      if (ghostText) {
        // Clear ghost only, don't delete typed chars
        e.preventDefault();
        setGhostActive(false);
      }
      // else: normal backspace behavior
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setInputValue(value); // Reset to original
      setGhostActive(true);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setGhostActive(true); // Re-enable ghost when typing
    setIsOpen(true);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (!listRef.current?.contains(document.activeElement)) {
        acceptValue();
        setIsOpen(false);
        onBlurProp?.();
      }
    }, 100);
  };

  const handleFocus = () => {
    setIsOpen(true);
    setGhostActive(true);
    onFocusProp?.();
  };

  const baseClass = `w-full px-1 py-0.5 text-sm border rounded ${
    hasChanges ? 'bg-yellow-50 border-yellow-300' : 'border-gray-300 bg-white'
  }`;

  // Update dropdown position when opened (in effect, not during render)
  useLayoutEffect(() => {
    if (isOpen && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 120),
        zIndex: 9999,
      });
    } else {
      setDropdownStyle({ display: 'none' });
    }
  }, [isOpen]);

  return (
    <div className="relative w-full" onClick={(e) => e.stopPropagation()}>
      {/* Actual input */}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={baseClass}
        autoComplete="off"
      />
      {/* Ghost text overlay */}
      {ghostText && (
        <div className="absolute inset-0 pointer-events-none px-1 py-0.5 text-sm overflow-hidden flex items-center">
          <span className="invisible">{inputValue}</span>
          <span className="text-gray-400">{ghostText}</span>
        </div>
      )}
      {/* Dropdown for visual feedback */}
      {isOpen && filteredOptions.length > 0 && typeof document !== 'undefined' && createPortal(
        <div
          ref={listRef}
          style={dropdownStyle}
          className="max-h-40 overflow-auto bg-white border border-gray-300 rounded shadow-lg"
        >
          {filteredOptions.map((opt, idx) => (
            <div
              key={opt}
              data-option
              className={`px-2 py-1 text-sm cursor-pointer ${
                idx === 0 ? 'bg-blue-100' : 'hover:bg-gray-100'
              }`}
              onMouseDown={() => {
                onChange(opt);
                setInputValue(opt);
                setIsOpen(false);
                setGhostActive(true);
              }}
            >
              {opt}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// Inline seed source selector for table cells
function InlineSeedSourceSelect({
  value,
  cropName,
  varieties,
  seedMixes,
  onChange,
  onFocus,
  onAddMix,
  allVarieties,
  crops,
  onAddVariety,
}: {
  value: SeedSource | undefined;
  cropName: string;
  varieties: Record<string, VarietyOption>;
  seedMixes: Record<string, SeedMixOption>;
  onChange: (value: SeedSource | undefined) => void;
  onFocus?: () => void;
  onAddMix?: (mix: import('@/lib/entities/seed-mix').SeedMix) => void;
  allVarieties?: Record<string, import('@/lib/entities/variety').Variety>;
  crops?: Record<string, { id: string; name: string }>;
  onAddVariety?: (variety: import('@/lib/entities/variety').Variety) => void;
}) {
  return (
    <div className="w-full" onClick={(e) => e.stopPropagation()} onFocus={onFocus}>
      <SeedSourceSelect
        cropName={cropName}
        value={value}
        onChange={onChange}
        varieties={varieties}
        seedMixes={seedMixes}
        placeholder="(None)"
        compact
        onAddMix={onAddMix}
        allVarieties={allVarieties}
        crops={crops}
        onAddVariety={onAddVariety}
      />
    </div>
  );
}

// EditableCell component for inline editing
function EditableCell({
  value,
  config,
  onChange,
  hasChanges,
  onFocus,
  onBlur,
}: {
  value: unknown;
  config: { type: EditType; options?: string[] };
  onChange: (value: unknown) => void;
  hasChanges: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const baseClass = `w-full px-1 py-0.5 text-sm border rounded ${
    hasChanges ? 'bg-yellow-50 border-yellow-300' : 'border-gray-300'
  }`;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Move to next row
      if (inputRef.current) {
        moveFocusVerticalDirect(inputRef.current, 'down');
      }
    }
  };

  if (config.type === 'select' && config.options) {
    return (
      <ComboBox
        value={String(value ?? '')}
        options={config.options}
        onChange={(v) => onChange(v)}
        hasChanges={hasChanges}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    );
  }

  if (config.type === 'number') {
    return (
      <input
        ref={inputRef}
        type="number"
        value={value != null ? String(value) : ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        className={`${baseClass} w-16`}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value || undefined)}
      onKeyDown={handleKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      className={baseClass}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// formatValue and formatColumnHeader are now imported from spec-explorer-columns.ts
