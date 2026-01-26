'use client';

import { useState, useEffect, useRef } from 'react';
import {
  type CropConfig,
  type TrayStage,
  type ProductYield,
  calculateDaysInCells,
  calculateSeedToHarvest,
  calculatePlantingMethod,
  calculateHarvestWindow,
  createBlankConfig,
  evaluateYieldForDisplay,
} from '@/lib/entities/crop-config';
import type { Variety } from '@/lib/entities/variety';
import type { SeedMix } from '@/lib/entities/seed-mix';
import type { Product } from '@/lib/entities/product';
import type { Market, MarketSplit } from '@/lib/entities/market';
import { getMarketSplitTotal, validateMarketSplit, getActiveMarkets } from '@/lib/entities/market';
import { weeksFromFrost, targetFromWeeks } from '@/lib/date-utils';
import { Z_INDEX } from '@/lib/z-index';

/** Standard tray sizes (cells per tray) */
const TRAY_SIZES = [9, 18, 21, 50, 72, 128, 400] as const;

/** User-facing growing method choices */
type GrowingMethod = 'direct-seed' | 'transplant' | 'perennial';

interface CropConfigEditorProps {
  isOpen: boolean;
  /** The crop to edit (required in edit mode, optional in create mode) */
  crop: CropConfig | null;
  onClose: () => void;
  onSave: (updated: CropConfig) => void;
  /** Mode: 'edit' for editing existing config, 'create' for creating new one */
  mode?: 'edit' | 'create';
  /** Optional validation: check if identifier already exists */
  existingIdentifiers?: string[];
  /** Varieties available for default seed source selection */
  varieties?: Record<string, Variety>;
  /** Seed mixes available for default seed source selection */
  seedMixes?: Record<string, SeedMix>;
  /** Products available for yield/revenue linking */
  products?: Record<string, Product>;
  /** Markets available for market split selection */
  markets?: Record<string, Market>;
  /** Last frost date for weeks-from-frost calculation (MM-DD format, e.g., "04-01") */
  lastFrostDate?: string;
}

/**
 * Derive the growing method from existing crop data.
 * - If perennial flag is set → perennial
 * - If has tray stages → transplant
 * - Otherwise → direct seed
 */
function deriveGrowingMethod(crop: Partial<CropConfig>, trayStages: TrayStage[]): GrowingMethod {
  if (crop.perennial) return 'perennial';
  if (trayStages.length > 0) return 'transplant';
  return 'direct-seed';
}

/** Describes data that will be removed when saving */
interface DataRemovalInfo {
  trayStages?: number;  // Number of tray stages to remove
  perennial?: boolean;  // Will remove perennial flag
  normalMethod?: string; // Will remove normalMethod
}

/**
 * Check what data would be removed based on current growing method selection.
 * Returns null if no data will be removed.
 */
function getDataRemovalInfo(
  growingMethod: GrowingMethod,
  trayStages: TrayStage[],
  formData: Partial<CropConfig>
): DataRemovalInfo | null {
  const info: DataRemovalInfo = {};

  if (growingMethod === 'direct-seed') {
    // DS removes: tray stages, perennial flag
    if (trayStages.length > 0) {
      info.trayStages = trayStages.length;
    }
    if (formData.perennial) {
      info.perennial = true;
    }
  } else if (growingMethod === 'transplant') {
    // Transplant removes: perennial flag (keeps tray stages)
    if (formData.perennial) {
      info.perennial = true;
    }
  } else if (growingMethod === 'perennial') {
    // Perennial removes: normalMethod (timing section not shown)
    // But keeps tray stages for establishment
    if (formData.normalMethod) {
      info.normalMethod = formData.normalMethod;
    }
  }

  // Return null if nothing will be removed
  return Object.keys(info).length > 0 ? info : null;
}

/**
 * Build human-readable description of what will be removed
 */
function formatRemovalDescription(info: DataRemovalInfo): string[] {
  const items: string[] = [];

  if (info.trayStages) {
    items.push(`${info.trayStages} tray stage${info.trayStages > 1 ? 's' : ''}`);
  }
  if (info.perennial) {
    items.push('perennial flag');
  }
  if (info.normalMethod) {
    const methodLabels: Record<string, string> = {
      'from-seeding': 'DTM measurement basis (from seeding)',
      'from-transplant': 'DTM measurement basis (from transplant)',
      'total-time': 'DTM measurement basis (full seed-to-harvest)',
    };
    items.push(methodLabels[info.normalMethod] || info.normalMethod);
  }

  return items;
}

// =============================================================================
// YIELD FORMULA HELPERS
// =============================================================================

/** Template definition for common yield formula patterns */
interface FormulaTemplate {
  label: string;
  description: string;
  /** Formula with ___ as placeholder for rate */
  template: string;
  /** Character positions for selection [start, end] relative to where rate goes */
  ratePosition: { prefix: string; suffix: string };
}

/** Available formula variables with descriptions */
const FORMULA_VARIABLES = [
  { name: 'plantingsPerBed', description: 'Plants per bed (rows × spacing × bedFeet)' },
  { name: 'bedFeet', description: 'Bed length in feet (default: 50)' },
  { name: 'harvests', description: 'Number of harvests' },
  { name: 'seeds', description: 'Seeds per bed' },
  { name: 'daysBetweenHarvest', description: 'Days between harvests' },
  { name: 'rows', description: 'Number of rows' },
  { name: 'spacing', description: 'In-row spacing (inches)' },
] as const;

const VALID_VARIABLE_NAMES = FORMULA_VARIABLES.map(v => v.name);

/**
 * Find similar variable name suggestions for typos.
 * Uses simple lowercase prefix/substring matching.
 */
function findSimilarVariables(typo: string): string[] {
  const lower = typo.toLowerCase();
  const suggestions: string[] = [];

  for (const name of VALID_VARIABLE_NAMES) {
    const nameLower = name.toLowerCase();
    // Check if it's a prefix match or substring match
    if (nameLower.startsWith(lower) || lower.startsWith(nameLower.slice(0, 3))) {
      suggestions.push(name);
    } else if (nameLower.includes(lower) || lower.includes(nameLower.slice(0, 4))) {
      suggestions.push(name);
    }
  }

  return suggestions;
}

/**
 * Extract unknown variable name from error message.
 */
function extractUnknownVariable(error: string): string | null {
  // Match patterns like "Unknown variable: plantingPerBed" or "Variable plantingPerBed is not defined"
  const match = error.match(/(?:Unknown variable|Variable)\W+(\w+)/i);
  return match ? match[1] : null;
}

const FORMULA_TEMPLATES: FormulaTemplate[] = [
  {
    label: 'Per plant',
    description: 'Yield based on plants per bed',
    template: 'plantsPerBed * ___ * harvests',
    ratePosition: { prefix: 'plantsPerBed * ', suffix: ' * harvests' },
  },
  {
    label: 'Per 100ft',
    description: 'Area-based (greens, microgreens)',
    template: '(bedFeet / 100) * ___ * harvests',
    ratePosition: { prefix: '(bedFeet / 100) * ', suffix: ' * harvests' },
  },
  {
    label: 'Per foot',
    description: 'Linear foot of bed',
    template: 'bedFeet * ___ * harvests',
    ratePosition: { prefix: 'bedFeet * ', suffix: ' * harvests' },
  },
  {
    label: 'Per seed',
    description: 'Seed-based (shallots, garlic)',
    template: 'seeds * ___',
    ratePosition: { prefix: 'seeds * ', suffix: '' },
  },
  {
    label: 'None',
    description: 'Cover crop, no production',
    template: '0',
    ratePosition: { prefix: '', suffix: '' },
  },
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Modal editor for CropConfig data.
 * Shows all stored fields as editable inputs, plus calculated fields as read-only.
 *
 * The form separates two orthogonal concepts:
 * 1. Growing Method (DS/Transplant/Perennial) - determines which fields to show
 * 2. DTM Measurement Basis - how the seed packet defines days to maturity
 *
 * Data preservation strategy:
 * - Switching growing methods only changes field visibility, not data
 * - All data is preserved until Save is clicked
 * - At save time, if data will be removed, a confirmation dialog is shown
 */
export default function CropConfigEditor({
  isOpen,
  crop,
  onClose,
  onSave,
  mode = 'edit',
  existingIdentifiers = [],
  varieties = {},
  seedMixes = {},
  products = {},
  markets = {},
  lastFrostDate,
}: CropConfigEditorProps) {
  // Form state - initialize from crop when opened
  const [formData, setFormData] = useState<Partial<CropConfig>>({});
  const [trayStages, setTrayStages] = useState<TrayStage[]>([]);
  const [growingMethod, setGrowingMethod] = useState<GrowingMethod>('direct-seed');
  const [showRemovalConfirm, setShowRemovalConfirm] = useState(false);
  const [pendingRemovalInfo, setPendingRemovalInfo] = useState<DataRemovalInfo | null>(null);
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [errorsClickedOpen, setErrorsClickedOpen] = useState(false);
  const identifierInputRef = useRef<HTMLInputElement>(null);

  // Reset form when crop changes or modal opens
  useEffect(() => {
    if (isOpen) {
      // In create mode with no crop, start with blank config
      const sourceConfig = crop ?? (mode === 'create' ? createBlankConfig() : null);
      if (sourceConfig) {
        setFormData({ ...sourceConfig });
        const stages = sourceConfig.trayStages ? [...sourceConfig.trayStages] : [];
        setTrayStages(stages);
        setGrowingMethod(deriveGrowingMethod(sourceConfig, stages));
        setShowRemovalConfirm(false);
        setPendingRemovalInfo(null);
        setIdentifierError(null);
        setProductError(null);
        setErrorsExpanded(false);
        setErrorsClickedOpen(false);
        setTimeout(() => identifierInputRef.current?.focus(), 0);
      }
    }
  }, [crop, isOpen, mode]);

  // Auto-collapse errors panel when issues are fixed (drop to 1 or 0)
  const currentErrorCount =
    (!formData.identifier?.trim() ? 1 : 0) +
    (!formData.crop?.trim() ? 1 : 0) +
    (!formData.productYields || formData.productYields.length === 0 ? 1 : 0);
  useEffect(() => {
    if (currentErrorCount <= 1) {
      setErrorsExpanded(false);
      setErrorsClickedOpen(false);
    }
  }, [currentErrorCount]);

  // Handle growing method changes - just change visibility, don't modify data
  const handleGrowingMethodChange = (method: GrowingMethod) => {
    setGrowingMethod(method);
    // Note: We don't modify formData or trayStages here - just change which fields are visible
    // Data is only trimmed at save time with user confirmation
  };

  /**
   * Build the final crop config based on selected growing method.
   * This trims data that doesn't apply to the selected method.
   */
  const buildFinalCrop = (): CropConfig => {
    const base = { ...formData };

    if (growingMethod === 'direct-seed') {
      // Remove tray stages and perennial flag
      delete base.perennial;
      return {
        ...base,
        trayStages: undefined,
      } as CropConfig;
    } else if (growingMethod === 'transplant') {
      // Remove perennial flag, keep tray stages
      delete base.perennial;
      return {
        ...base,
        trayStages: trayStages.length > 0 ? trayStages : undefined,
      } as CropConfig;
    } else {
      // Perennial: set flag, remove normalMethod, keep tray stages for establishment
      delete base.normalMethod;
      return {
        ...base,
        perennial: true,
        trayStages: trayStages.length > 0 ? trayStages : undefined,
      } as CropConfig;
    }
  };

  // Calculate derived values for preview - use the final crop shape
  const previewCrop = buildFinalCrop();
  const daysInCells = calculateDaysInCells(previewCrop);
  const seedToHarvest = calculateSeedToHarvest(previewCrop, daysInCells);
  const plantingMethod = calculatePlantingMethod(previewCrop);
  const harvestWindow = calculateHarvestWindow(previewCrop);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.identifier?.trim() || !formData.crop?.trim()) return;

    // Require at least one product
    if (!formData.productYields || formData.productYields.length === 0) {
      setProductError('At least one product is required for timing calculations');
      return;
    }
    setProductError(null);

    // In create mode (or when identifier changed), check for duplicates
    const identifierToCheck = formData.identifier.trim();
    const originalIdentifier = crop?.identifier;
    const isNewIdentifier = mode === 'create' || identifierToCheck !== originalIdentifier;

    if (isNewIdentifier && existingIdentifiers.includes(identifierToCheck)) {
      setIdentifierError(`A config with identifier "${identifierToCheck}" already exists`);
      identifierInputRef.current?.focus();
      return;
    }
    setIdentifierError(null);

    // Check if any data will be removed
    const removalInfo = getDataRemovalInfo(growingMethod, trayStages, formData);

    if (removalInfo) {
      // Show confirmation dialog
      setPendingRemovalInfo(removalInfo);
      setShowRemovalConfirm(true);
    } else {
      // No data removal, save directly
      onSave(buildFinalCrop());
    }
  };

  const handleConfirmSave = () => {
    setShowRemovalConfirm(false);
    setPendingRemovalInfo(null);
    onSave(buildFinalCrop());
  };

  const handleCancelSave = () => {
    setShowRemovalConfirm(false);
    setPendingRemovalInfo(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const updateField = <K extends keyof CropConfig>(field: K, value: CropConfig[K] | undefined) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateNumberField = (field: keyof CropConfig, value: string) => {
    const num = value === '' ? undefined : parseFloat(value);
    updateField(field, num as CropConfig[typeof field]);
  };

  const addTrayStage = () => {
    setTrayStages(prev => [...prev, { days: 14, cellsPerTray: 128 }]);
  };

  const removeTrayStage = (index: number) => {
    setTrayStages(prev => prev.filter((_, i) => i !== index));
  };

  const updateTrayStage = (index: number, field: keyof TrayStage, value: number) => {
    setTrayStages(prev => prev.map((stage, i) =>
      i === index ? { ...stage, [field]: value } : stage
    ));
  };

  // In edit mode, require crop. In create mode, we generate a blank one.
  if (!isOpen) return null;
  if (mode === 'edit' && !crop) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">
            {mode === 'create'
              ? 'Create Crop Configuration'
              : `Edit Crop Configuration${formData.identifier ? ` for ${formData.identifier}` : ''}`}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Form - scrollable */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          {/* Sticky Header: Calculated Values + Growing Method Selector */}
          <div className="shrink-0 border-b border-gray-200">
            {/* Calculated Values */}
            <div className="px-6 py-2 bg-blue-50 border-b border-blue-100">
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-blue-600">Days in Cells</div>
                  <div className="text-sm font-semibold text-blue-900">{daysInCells}</div>
                </div>
                <div>
                  <div className="text-xs text-blue-600">Seed to Harvest</div>
                  <div className="text-sm font-semibold text-blue-900">{seedToHarvest}</div>
                </div>
                <div>
                  <div className="text-xs text-blue-600">Method</div>
                  <div className="text-sm font-semibold text-blue-900">{plantingMethod}</div>
                </div>
                <div>
                  <div className="text-xs text-blue-600">Harvest Window</div>
                  <div className="text-sm font-semibold text-blue-900">{harvestWindow}d</div>
                </div>
              </div>
            </div>

            {/* Growing Method Selector */}
            <div className="px-6 py-3 bg-gray-50">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleGrowingMethodChange('direct-seed')}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border-2 transition-colors ${
                    growingMethod === 'direct-seed'
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold">Direct Seed</div>
                </button>
                <button
                  type="button"
                  onClick={() => handleGrowingMethodChange('transplant')}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border-2 transition-colors ${
                    growingMethod === 'transplant'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold">Transplant</div>
                </button>
                <button
                  type="button"
                  onClick={() => handleGrowingMethodChange('perennial')}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border-2 transition-colors ${
                    growingMethod === 'perennial'
                      ? 'border-purple-500 bg-purple-50 text-purple-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold">Perennial</div>
                </button>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 space-y-6 overflow-y-auto flex-1">
            {/* ========== COMMON FIELDS (all growing methods) ========== */}

            {/* Identity Section */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b">Identity</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Identifier *</label>
                  <input
                    ref={identifierInputRef}
                    type="text"
                    value={formData.identifier || ''}
                    onChange={(e) => {
                      updateField('identifier', e.target.value);
                      if (identifierError) setIdentifierError(null);
                    }}
                    className={`w-full px-3 py-2 text-sm text-gray-900 border rounded-md focus:outline-none focus:ring-2 ${
                      identifierError
                        ? 'border-red-500 focus:ring-red-500'
                        : 'border-gray-300 focus:ring-blue-500'
                    }`}
                    required
                  />
                  {identifierError && (
                    <p className="text-xs text-red-600 mt-1">{identifierError}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Crop *</label>
                  <input
                    type="text"
                    value={formData.crop || ''}
                    onChange={(e) => updateField('crop', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
            </section>

            {/* Classification Section */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b">Classification</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <input
                    type="text"
                    value={formData.category || ''}
                    onChange={(e) => updateField('category', e.target.value || undefined)}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Growing Structure</label>
                  <select
                    value={formData.growingStructure || ''}
                    onChange={(e) => updateField('growingStructure', (e.target.value || undefined) as 'field' | 'greenhouse' | 'high-tunnel' | undefined)}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select...</option>
                    <option value="field">Field</option>
                    <option value="greenhouse">Greenhouse</option>
                    <option value="high-tunnel">High Tunnel</option>
                  </select>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.deprecated || false}
                      onChange={(e) => updateField('deprecated', e.target.checked || undefined)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Deprecated</span>
                  </label>
                </div>
              </div>
            </section>

            {/* Planting Layout Section */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b">Planting Layout</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Rows per Bed</label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={formData.rows ?? ''}
                    onChange={(e) => updateNumberField('rows', e.target.value)}
                    placeholder="e.g., 3"
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Number of planting rows across the bed</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">In-Row Spacing (inches)</label>
                  <input
                    type="number"
                    min="1"
                    max="72"
                    value={formData.spacing ?? ''}
                    onChange={(e) => updateNumberField('spacing', e.target.value)}
                    placeholder="e.g., 12"
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Space between plants within a row</p>
                </div>
              </div>
              {/* Show calculated plants per bed when both values are set */}
              {formData.rows && formData.spacing && (
                <div className="mt-3 p-2 bg-blue-50 rounded text-sm text-blue-700">
                  <span className="font-medium">
                    {Math.floor((12 / formData.spacing) * formData.rows * 50)} plants per 50ft bed
                  </span>
                  <span className="text-blue-500 ml-2">
                    ({formData.rows} rows × {Math.floor(12 / formData.spacing)} plants/row/ft × 50ft)
                  </span>
                </div>
              )}
            </section>

            {/* Scheduling Section */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b">Scheduling</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Target Field Date</label>
                  <input
                    type="text"
                    value={formData.targetFieldDate ?? ''}
                    onChange={(e) => updateField('targetFieldDate', e.target.value || undefined)}
                    placeholder="4/15 or 04-15"
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Default date when adding this crop</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Weeks from Last Frost</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={weeksFromFrost(formData.targetFieldDate, lastFrostDate) ?? ''}
                      onChange={(e) => {
                        const weeks = parseInt(e.target.value, 10);
                        if (isNaN(weeks)) {
                          updateField('targetFieldDate', undefined);
                          return;
                        }
                        const target = targetFromWeeks(lastFrostDate, weeks);
                        if (target) {
                          updateField('targetFieldDate', target);
                        }
                      }}
                      placeholder={lastFrostDate ? '0' : 'Set frost date'}
                      disabled={!lastFrostDate}
                      className="w-20 px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                    <span className="text-sm text-gray-500 self-center">
                      {lastFrostDate ? (
                        <>weeks (frost: {lastFrostDate})</>
                      ) : (
                        <span className="text-amber-600">No frost date set in plan</span>
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Negative = before frost, Positive = after frost
                  </p>
                </div>
              </div>
            </section>

            {/* Default Seed Source Section */}
            {(Object.keys(varieties).length > 0 || Object.keys(seedMixes).length > 0) && (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b">Default Seed Source</h3>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Default Variety/Mix for New Plantings
                  </label>
                  <select
                    value={
                      formData.defaultSeedSource
                        ? `${formData.defaultSeedSource.type}:${formData.defaultSeedSource.id}`
                        : ''
                    }
                    onChange={(e) => {
                      if (!e.target.value) {
                        updateField('defaultSeedSource', undefined);
                      } else {
                        const [type, id] = e.target.value.split(':') as ['variety' | 'mix', string];
                        updateField('defaultSeedSource', { type, id });
                      }
                    }}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">None (assign manually)</option>
                    {(() => {
                      const cropName = formData.crop ?? '';
                      const currentId = formData.defaultSeedSource?.id;
                      // Hide deprecated unless currently selected
                      const matchingVarieties = Object.values(varieties).filter(
                        (v) => v.crop === cropName && (!v.deprecated || v.id === currentId)
                      );
                      const matchingMixes = Object.values(seedMixes).filter(
                        (m) => m.crop === cropName && (!m.deprecated || m.id === currentId)
                      );

                      if (matchingVarieties.length === 0 && matchingMixes.length === 0) {
                        return (
                          <option disabled>No varieties or mixes for "{formData.crop}"</option>
                        );
                      }

                      return (
                        <>
                          {matchingVarieties.length > 0 && (
                            <optgroup label="Varieties">
                              {matchingVarieties.map((v) => (
                                <option key={v.id} value={`variety:${v.id}`}>
                                  {v.name}
                                  {v.supplier ? ` (${v.supplier})` : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {matchingMixes.length > 0 && (
                            <optgroup label="Seed Mixes">
                              {matchingMixes.map((m) => (
                                <option key={m.id} value={`mix:${m.id}`}>
                                  {m.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </>
                      );
                    })()}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    When set, new plantings of this crop will automatically use this variety/mix.
                  </p>
                </div>
              </section>
            )}

            {/* Default Market Split Section */}
            {Object.keys(markets).length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b">Default Market Split</h3>
                <div className="space-y-3">
                  {(() => {
                    const activeMarkets = getActiveMarkets(markets);
                    const currentSplit = formData.defaultMarketSplit ?? {};
                    const total = getMarketSplitTotal(currentSplit);
                    const validationWarning = validateMarketSplit(currentSplit);

                    return (
                      <>
                        <div className="grid grid-cols-3 gap-3">
                          {activeMarkets.map((market) => (
                            <div key={market.id}>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                {market.name}
                              </label>
                              <div className="relative">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={currentSplit[market.id] ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                    const newSplit: MarketSplit = { ...currentSplit };
                                    if (val === undefined || val === 0) {
                                      delete newSplit[market.id];
                                    } else {
                                      newSplit[market.id] = val;
                                    }
                                    // If all zeros, clear the split entirely
                                    if (Object.values(newSplit).every(v => !v)) {
                                      updateField('defaultMarketSplit', undefined);
                                    } else {
                                      updateField('defaultMarketSplit', newSplit);
                                    }
                                  }}
                                  placeholder="0"
                                  className="w-full px-3 py-2 pr-8 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Total indicator with warning styling */}
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">
                            Total: <span className={total === 100 ? 'text-green-600 font-medium' : total === 0 ? 'text-gray-400' : 'text-amber-600 font-medium'}>{total}%</span>
                          </span>
                          {validationWarning && total > 0 && (
                            <span className="text-amber-600 flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              {total !== 100 ? `Will be treated as ${Object.entries(currentSplit).filter(([, v]) => v > 0).map(([, v]) => Math.round(v / total * 100)).join(':')} ratio` : validationWarning}
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-gray-500">
                          How revenue from this crop is split across markets. Leave blank for 100% Direct.
                        </p>
                      </>
                    );
                  })()}
                </div>
              </section>
            )}

            {/* Product & Revenue Section */}
            {Object.keys(products).length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b">
                  Products & Timing
                  <span className="text-red-500 ml-1">*</span>
                </h3>
                {productError && (
                  <p className="text-sm text-red-600 mb-3">{productError}</p>
                )}
                <div className="space-y-3">
                  {/* List of existing product yields */}
                  {(formData.productYields ?? []).map((py, index) => {
                    const product = products[py.productId];
                    return (
                      <div key={py.productId} className="p-3 bg-gray-50 rounded-md border border-gray-200">
                        {/* Product header with remove button */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-500">#{index + 1}</span>
                            <span className="font-medium text-sm text-gray-900">
                              {product ? `${product.product} (${product.unit})` : py.productId}
                            </span>
                            {product && Object.values(product.prices)[0] != null && (
                              <span className="text-xs text-green-600">${Object.values(product.prices)[0]}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...(formData.productYields ?? [])];
                              updated.splice(index, 1);
                              updateField('productYields', updated.length > 0 ? updated : undefined);
                            }}
                            className="text-red-500 hover:text-red-700 text-xs font-medium"
                          >
                            Remove
                          </button>
                        </div>

                        {/* Product timing fields */}
                        <div className="grid grid-cols-5 gap-2">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">DTM</label>
                            <input
                              type="number"
                              value={py.dtm ?? ''}
                              onChange={(e) => {
                                const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                                const updated = [...(formData.productYields ?? [])];
                                updated[index] = { ...py, dtm: val ?? 0 };
                                updateField('productYields', updated);
                              }}
                              className="w-full px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1"># Harvests</label>
                            <input
                              type="number"
                              value={py.numberOfHarvests ?? ''}
                              onChange={(e) => {
                                const val = e.target.value === '' ? 1 : parseInt(e.target.value, 10);
                                const updated = [...(formData.productYields ?? [])];
                                updated[index] = { ...py, numberOfHarvests: val };
                                updateField('productYields', updated);
                              }}
                              className="w-full px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Days Btwn</label>
                            <input
                              type="number"
                              value={py.daysBetweenHarvest ?? ''}
                              onChange={(e) => {
                                const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                                const updated = [...(formData.productYields ?? [])];
                                updated[index] = { ...py, daysBetweenHarvest: val };
                                updateField('productYields', updated);
                              }}
                              className="w-full px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Buffer</label>
                            <input
                              type="number"
                              value={py.harvestBufferDays ?? ''}
                              onChange={(e) => {
                                const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                                const updated = [...(formData.productYields ?? [])];
                                updated[index] = { ...py, harvestBufferDays: val };
                                updateField('productYields', updated);
                              }}
                              className="w-full px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Post-Harv</label>
                            <input
                              type="number"
                              value={py.postHarvestFieldDays ?? ''}
                              onChange={(e) => {
                                const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                                const updated = [...(formData.productYields ?? [])];
                                updated[index] = { ...py, postHarvestFieldDays: val };
                                updateField('productYields', updated);
                              }}
                              className="w-full px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                              title="Post-harvest field days (e.g., tuber curing)"
                            />
                          </div>
                        </div>
                        {/* Yield Formula with templates and variables */}
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <div className="flex items-center justify-between mb-2">
                            <label className="block text-xs font-medium text-gray-600">Yield Formula</label>
                            <div className="flex flex-wrap gap-1">
                              {FORMULA_TEMPLATES.map((template) => (
                                <button
                                  key={template.label}
                                  type="button"
                                  onClick={() => {
                                    const formula = template.template === '0' ? '0' : template.template.replace('___', '0');
                                    const updated = [...(formData.productYields ?? [])];
                                    updated[index] = { ...py, yieldFormula: formula };
                                    updateField('productYields', updated);
                                  }}
                                  title={template.description}
                                  className="px-1.5 py-0.5 text-[10px] font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 hover:text-gray-700 transition-colors"
                                >
                                  {template.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <input
                            type="text"
                            value={py.yieldFormula ?? ''}
                            onChange={(e) => {
                              const updated = [...(formData.productYields ?? [])];
                              updated[index] = { ...py, yieldFormula: e.target.value || undefined };
                              updateField('productYields', updated);
                            }}
                            placeholder="e.g., plantingsPerBed * 0.5 * harvests"
                            className="w-full px-2 py-1.5 text-sm font-mono text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          {/* Variable hints */}
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {FORMULA_VARIABLES.map((v) => (
                              <button
                                key={v.name}
                                type="button"
                                onClick={() => {
                                  const current = py.yieldFormula ?? '';
                                  const updated = [...(formData.productYields ?? [])];
                                  updated[index] = { ...py, yieldFormula: current + (current ? ' * ' : '') + v.name };
                                  updateField('productYields', updated);
                                }}
                                title={v.description}
                                className="px-1 py-0.5 text-[10px] font-mono text-blue-600 bg-blue-50 border border-blue-100 rounded hover:bg-blue-100 transition-colors"
                              >
                                {v.name}
                              </button>
                            ))}
                          </div>
                          {/* Formula validation */}
                          {py.yieldFormula && (() => {
                            const result = evaluateYieldForDisplay({ ...formData, yieldFormula: py.yieldFormula, numberOfHarvests: py.numberOfHarvests } as CropConfig);
                            if (result.error) {
                              const unknownVar = extractUnknownVariable(result.error);
                              const suggestions = unknownVar ? findSimilarVariables(unknownVar) : [];
                              return (
                                <div className="mt-1">
                                  <p className="text-[10px] text-red-600">{result.error}</p>
                                  {suggestions.length > 0 && (
                                    <p className="text-[10px] text-amber-600">
                                      Did you mean: {suggestions.map((s, i) => (
                                        <button
                                          key={s}
                                          type="button"
                                          onClick={() => {
                                            const newFormula = py.yieldFormula!.replace(new RegExp(`\\b${unknownVar}\\b`, 'g'), s);
                                            const updated = [...(formData.productYields ?? [])];
                                            updated[index] = { ...py, yieldFormula: newFormula };
                                            updateField('productYields', updated);
                                          }}
                                          className="font-mono text-blue-600 hover:underline"
                                        >
                                          {i > 0 ? ', ' : ''}{s}
                                        </button>
                                      ))}?
                                    </p>
                                  )}
                                </div>
                              );
                            }
                            if (result.value !== null) {
                              const unit = product?.unit ?? formData.yieldUnit ?? 'units';
                              return (
                                <p className="text-[10px] text-green-600 mt-1">
                                  = {result.value.toFixed(1)} {unit}/50ft
                                  {py.numberOfHarvests > 1 && ` (${(result.value / py.numberOfHarvests).toFixed(1)} per harvest)`}
                                </p>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </div>
                    );
                  })}

                  {/* Add Product button and selector */}
                  {(() => {
                    const cropName = formData.crop?.toLowerCase().trim();
                    const matchingProducts = Object.values(products).filter(
                      (p) => p.crop.toLowerCase().trim() === cropName
                    );
                    // Filter out already-added products
                    const existingIds = new Set((formData.productYields ?? []).map(py => py.productId));
                    const availableProducts = matchingProducts.filter(p => !existingIds.has(p.id));

                    if (matchingProducts.length === 0) {
                      return (
                        <p className="text-xs text-gray-500 italic">
                          No products defined for &quot;{formData.crop}&quot;
                        </p>
                      );
                    }

                    if (availableProducts.length === 0) {
                      return (
                        <p className="text-xs text-gray-500 italic">
                          All available products for this crop have been added
                        </p>
                      );
                    }

                    return (
                      <div className="flex items-center gap-2">
                        <select
                          id="add-product-select"
                          defaultValue=""
                          className="flex-1 px-2 py-1.5 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="" disabled>Select a product to add...</option>
                          {availableProducts.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.product} ({p.unit}) - ${Object.values(p.prices)[0] ?? 'N/A'}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const select = document.getElementById('add-product-select') as HTMLSelectElement;
                            const productId = select.value;
                            if (!productId) return;

                            // New products start empty - user must fill in timing
                            const newYield: ProductYield = {
                              productId,
                              dtm: 0,
                              numberOfHarvests: 1,
                            };
                            const updated = [...(formData.productYields ?? []), newYield];
                            updateField('productYields', updated);
                            select.value = '';
                          }}
                          className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100"
                        >
                          Add
                        </button>
                      </div>
                    );
                  })()}

                  <p className="text-xs text-gray-500">
                    Add products for revenue calculations. Each product can have its own timing and yield.
                  </p>
                </div>
              </section>
            )}

            {/* Legacy Harvest/Yield sections removed - now per-product in Products section */}

            {/* ========== METHOD-SPECIFIC FIELDS ========== */}

            {/* Timing Section - shared plant timing (not per-product) */}
            {growingMethod !== 'perennial' && (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b">Timing (Shared)</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">DTM Measured From</label>
                    <select
                      value={formData.normalMethod || ''}
                      onChange={(e) => updateField('normalMethod', e.target.value as 'from-seeding' | 'from-transplant' | 'total-time' | undefined)}
                      className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select...</option>
                      <option value="from-seeding">From seeding (seed packet)</option>
                      <option value="from-transplant">From transplant date (seed packet)</option>
                      <option value="total-time">Full seed-to-harvest (grower/book)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      How DTM values in products are measured
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Days to Germination</label>
                    <input
                      type="number"
                      value={formData.daysToGermination ?? ''}
                      onChange={(e) => updateNumberField('daysToGermination', e.target.value)}
                      className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Assumed Transplant Days - only relevant for from-transplant normalMethod */}
                {formData.normalMethod === 'from-transplant' && (
                  <div className="mt-4">
                    <div className="flex items-center gap-1 mb-1">
                      <label className="block text-xs font-medium text-gray-600">Assumed Transplant Age</label>
                      <div className="group relative">
                        <svg className="w-3.5 h-3.5 text-gray-400 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg" style={{ zIndex: Z_INDEX.TOOLTIP }}>
                          <p className="font-medium mb-1">Seed producer&apos;s assumed transplant age</p>
                          <p className="text-gray-300">
                            When a seed catalog says &quot;DTM from transplant&quot;, they measured from transplants of a certain age.
                            This is a rough assumption. Fast crops like small brassicas might be 21 days (3 weeks).
                            Larger transplants like Solanaceae (tomatoes, peppers) probably assume 42 days (6 weeks).
                          </p>
                          <p className="text-gray-400 mt-1">Default: 30 days (~4 weeks)</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={formData.assumedTransplantDays ?? ''}
                        onChange={(e) => updateNumberField('assumedTransplantDays', e.target.value)}
                        placeholder="30"
                        className="w-24 px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-xs text-gray-500">days (leave blank for default: 30)</span>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Perennial timing is per-product, no separate section needed */}

            {/* Tray Stages Section - only for transplant, or perennial with establishment */}
            {(growingMethod === 'transplant' || (growingMethod === 'perennial' && trayStages.length > 0)) && (
              <section>
                <div className="flex items-center justify-between mb-3 pb-1 border-b">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">Tray Stages (Greenhouse)</h3>
                    {growingMethod === 'perennial' && (
                      <p className="text-xs text-gray-500">For establishment year from seed</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={addTrayStage}
                    className="px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100"
                  >
                    + Add Stage
                  </button>
                </div>
                {trayStages.length === 0 ? (
                  <p className="text-sm text-gray-500 italic py-2">
                    No tray stages defined. Click &quot;+ Add Stage&quot; to add greenhouse time.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {trayStages.map((stage, index) => (
                      <div key={index} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                        <span className="text-xs text-gray-500 w-16">Stage {index + 1}</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={stage.days}
                            onChange={(e) => updateTrayStage(index, 'days', parseInt(e.target.value) || 0)}
                            className="w-16 px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-xs text-gray-600">days</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={stage.cellsPerTray ?? ''}
                            onChange={(e) => updateTrayStage(index, 'cellsPerTray', parseInt(e.target.value) || 0)}
                            className="w-20 px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">-</option>
                            {TRAY_SIZES.map(size => (
                              <option key={size} value={size}>{size}</option>
                            ))}
                          </select>
                          <span className="text-xs text-gray-600">cells/tray</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeTrayStage(index)}
                          className="ml-auto text-red-500 hover:text-red-700 text-sm"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Perennial option to add tray stages for establishment */}
            {growingMethod === 'perennial' && trayStages.length === 0 && (
              <section>
                <button
                  type="button"
                  onClick={addTrayStage}
                  className="w-full px-4 py-3 text-sm font-medium text-gray-600 bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-100"
                >
                  + Add Tray Stages (for establishment year from seed)
                </button>
              </section>
            )}
          </div>

          {/* Footer */}
          {(() => {
            // Build validation errors
            const validationErrors: string[] = [];
            if (!formData.identifier?.trim()) validationErrors.push('Identifier is required');
            if (!formData.crop?.trim()) validationErrors.push('Crop name is required');
            if (!formData.productYields || formData.productYields.length === 0) {
              validationErrors.push('At least one product is required');
            }
            const hasErrors = validationErrors.length > 0;
            const hasMultipleErrors = validationErrors.length > 1;

            return (
              <div className="shrink-0">
                {/* Expandable error panel - above footer buttons */}
                {hasMultipleErrors && errorsExpanded && (
                  <div className="px-6 py-3 bg-red-50 border-t border-red-100">
                    <ul className="space-y-1">
                      {validationErrors.map((error, i) => (
                        <li key={i} className="text-sm text-red-700 flex items-center gap-2">
                          <span className="w-1 h-1 rounded-full bg-red-400" />
                          {error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Footer bar */}
                <div className="px-6 py-4 border-t bg-gray-50 flex justify-between items-center gap-3">
                  {/* Left side: validation errors */}
                  <div className="flex items-center gap-2 min-w-0">
                    {hasErrors && !hasMultipleErrors && (
                      <span className="text-sm text-red-600 truncate">
                        {validationErrors[0]}
                      </span>
                    )}
                    {hasMultipleErrors && (
                      <button
                        type="button"
                        onClick={() => {
                          const newExpanded = !errorsExpanded;
                          setErrorsExpanded(newExpanded);
                          setErrorsClickedOpen(newExpanded);
                        }}
                        onMouseEnter={() => setErrorsExpanded(true)}
                        onMouseLeave={() => {
                          // Only collapse on mouse leave if it wasn't clicked open
                          if (!errorsClickedOpen) {
                            setErrorsExpanded(false);
                          }
                        }}
                        className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1"
                      >
                        <span>{validationErrors.length} issues</span>
                        <svg
                          className={`w-4 h-4 transition-transform ${errorsExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Right side: buttons */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={hasErrors}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {mode === 'create' ? 'Create Config' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </form>
      </div>

      {/* Data Removal Confirmation Dialog */}
      {showRemovalConfirm && pendingRemovalInfo && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL_CONFIRM }}>
          <div
            className="absolute inset-0 bg-black/50"
            onClick={handleCancelSave}
          />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900">
                  Remove Unused Data?
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  Changing to <strong>{growingMethod === 'direct-seed' ? 'Direct Seed' : growingMethod === 'transplant' ? 'Transplant' : 'Perennial'}</strong> will remove the following data:
                </p>
                <ul className="mt-2 space-y-1">
                  {formatRemovalDescription(pendingRemovalInfo).map((item, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-gray-500">
                  This cannot be undone after saving.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelSave}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Go Back
              </button>
              <button
                type="button"
                onClick={handleConfirmSave}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700"
              >
                Remove &amp; Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
