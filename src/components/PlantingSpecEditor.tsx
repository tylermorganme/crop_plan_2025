'use client';

import { useState, useEffect, useRef } from 'react';
import { usePlanStore } from '@/lib/plan-store';
import {
  type PlantingSpec,
  type TrayStage,
  type ProductYield,
  type TimingSettings,
  calculateDaysInCells,
  calculateSeedToHarvest,
  calculatePlantingMethod,
  calculateHarvestWindow,
  createBlankConfig,
  evaluateYieldForDisplay,
  DEFAULT_TRANSPLANT_SHOCK_DAYS,
  DEFAULT_ASSUMED_TRANSPLANT_AGE,
} from '@/lib/entities/planting-specs';
import type { Variety } from '@/lib/entities/variety';
import type { SeedMix } from '@/lib/entities/seed-mix';
import type { Product } from '@/lib/entities/product';
import type { Market, MarketSplit } from '@/lib/entities/market';
import type { Crop } from '@/lib/entities/crop';
import { getMarketSplitTotal, validateMarketSplit, getActiveMarkets } from '@/lib/entities/market';
import { weeksFromFrost, targetFromWeeks } from '@/lib/date-utils';
import { Z_INDEX } from '@/lib/z-index';
import { SeedSourceSelect } from './SeedSourceSelect';

/** Standard tray sizes (cells per tray) */
const TRAY_SIZES = [9, 18, 21, 50, 72, 128, 400] as const;

/** User-facing growing method choices */
type GrowingMethod = 'direct-seed' | 'transplant' | 'perennial';

interface PlantingSpecEditorProps {
  isOpen: boolean;
  /** The spec to edit (required in edit mode, optional in create mode) */
  spec: PlantingSpec | null;
  onClose: () => void;
  onSave: (updated: PlantingSpec) => void;
  /** Mode: 'edit' for editing existing spec, 'create' for creating new one */
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
  /** Crop entities for linking crop name to cropId (for colors) */
  crops?: Record<string, Crop>;
  /** Last frost date for weeks-from-frost calculation (MM-DD format, e.g., "04-01") */
  lastFrostDate?: string;
  /** Plan-level timing settings (optional, uses defaults if not provided) */
  timingSettings?: Partial<TimingSettings>;
}


/**
 * Derive the growing method from existing crop data.
 * - If perennial flag is set → perennial
 * - If has tray stages → transplant
 * - Otherwise → direct seed
 */
function deriveGrowingMethod(crop: Partial<PlantingSpec>, trayStages: TrayStage[]): GrowingMethod {
  if (crop.perennial) return 'perennial';
  if (trayStages.length > 0) return 'transplant';
  return 'direct-seed';
}

/** Describes data that will be removed when saving */
interface DataRemovalInfo {
  trayStages?: number;  // Number of tray stages to remove
  perennial?: boolean;  // Will remove perennial flag
  dtmBasis?: string; // Will remove dtmBasis
}

/**
 * Check what data would be removed based on current growing method selection.
 * Returns null if no data will be removed.
 */
function getDataRemovalInfo(
  growingMethod: GrowingMethod,
  trayStages: TrayStage[],
  formData: Partial<PlantingSpec>
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
    // Perennial removes: dtmBasis (timing section not shown)
    // But keeps tray stages for establishment
    if (formData.dtmBasis) {
      info.dtmBasis = formData.dtmBasis;
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
  if (info.dtmBasis) {
    const basisLabels: Record<string, string> = {
      'ds-from-germination-to-harvest': 'DTM basis (from germination)',
      'tp-from-planting-to-harvest': 'DTM basis (from transplant)',
      'tp-from-seeding-to-harvest': 'DTM basis (full seed-to-harvest)',
    };
    items.push(basisLabels[info.dtmBasis] || info.dtmBasis);
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
 * Modal editor for PlantingSpec data.
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
export default function PlantingSpecEditor({
  isOpen,
  spec,
  onClose,
  onSave,
  mode = 'edit',
  existingIdentifiers = [],
  varieties = {},
  seedMixes = {},
  products = {},
  markets = {},
  crops = {},
  lastFrostDate,
  timingSettings,
}: PlantingSpecEditorProps) {
  // Read timing settings directly from store for live updates (cross-tab sync)
  const storeMetadata = usePlanStore((s) => s.currentPlan?.metadata);
  // Prefer store values, fall back to props, then defaults
  const transplantShockDays = storeMetadata?.transplantShockDays ?? timingSettings?.transplantShockDays ?? DEFAULT_TRANSPLANT_SHOCK_DAYS;
  const defaultTransplantAge = storeMetadata?.defaultTransplantAge ?? timingSettings?.defaultTransplantAge ?? DEFAULT_ASSUMED_TRANSPLANT_AGE;
  // Form state - initialize from spec when opened
  const [formData, setFormData] = useState<Partial<PlantingSpec>>({});
  const [trayStages, setTrayStages] = useState<TrayStage[]>([]);
  const [growingMethod, setGrowingMethod] = useState<GrowingMethod>('direct-seed');
  const [showRemovalConfirm, setShowRemovalConfirm] = useState(false);
  const [pendingRemovalInfo, setPendingRemovalInfo] = useState<DataRemovalInfo | null>(null);
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [errorsClickedOpen, setErrorsClickedOpen] = useState(false);
  const [showDtmHelp, setShowDtmHelp] = useState(false);
  const identifierInputRef = useRef<HTMLInputElement>(null);

  // Reset form when spec changes or modal opens
  useEffect(() => {
    if (isOpen) {
      // In create mode with no spec, start with blank spec
      const sourceSpec = spec ?? (mode === 'create' ? createBlankConfig() : null);
      if (sourceSpec) {
        setFormData({ ...sourceSpec });
        const stages = sourceSpec.trayStages ? [...sourceSpec.trayStages] : [];
        setTrayStages(stages);
        setGrowingMethod(deriveGrowingMethod(sourceSpec, stages));
        setShowRemovalConfirm(false);
        setPendingRemovalInfo(null);
        setIdentifierError(null);
        setProductError(null);
        setErrorsExpanded(false);
        setErrorsClickedOpen(false);
        setTimeout(() => identifierInputRef.current?.focus(), 0);
      }
    }
  }, [spec, isOpen, mode]);

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
   * Build the final planting spec based on selected growing method.
   * This trims data that doesn't apply to the selected method.
   */
  const buildFinalCrop = (): PlantingSpec => {
    const base = { ...formData };

    if (growingMethod === 'direct-seed') {
      // Remove tray stages and perennial flag
      delete base.perennial;
      return {
        ...base,
        trayStages: undefined,
      } as PlantingSpec;
    } else if (growingMethod === 'transplant') {
      // Remove perennial flag, keep tray stages
      delete base.perennial;
      return {
        ...base,
        trayStages: trayStages.length > 0 ? trayStages : undefined,
      } as PlantingSpec;
    } else {
      // Perennial: set flag, remove dtmBasis, keep tray stages for establishment
      delete base.dtmBasis;
      return {
        ...base,
        perennial: true,
        trayStages: trayStages.length > 0 ? trayStages : undefined,
      } as PlantingSpec;
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
    const originalIdentifier = spec?.identifier;
    const isNewIdentifier = mode === 'create' || identifierToCheck !== originalIdentifier;

    if (isNewIdentifier && existingIdentifiers.includes(identifierToCheck)) {
      setIdentifierError(`A spec with identifier "${identifierToCheck}" already exists`);
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

  const updateField = <K extends keyof PlantingSpec>(field: K, value: PlantingSpec[K] | undefined) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateNumberField = (field: keyof PlantingSpec, value: string) => {
    const num = value === '' ? undefined : parseFloat(value);
    updateField(field, num as PlantingSpec[typeof field]);
  };

  // Look up cropId by name (case-insensitive) for color linking
  const lookupCropId = (cropName: string): string | undefined => {
    if (!cropName) return undefined;
    const normalizedName = cropName.trim().toLowerCase();
    for (const crop of Object.values(crops)) {
      if (crop.name.toLowerCase() === normalizedName) {
        return crop.id;
      }
    }
    return undefined;
  };

  // Update crop name and auto-link to cropId
  const updateCropName = (value: string) => {
    const cropId = lookupCropId(value);
    setFormData(prev => ({
      ...prev,
      crop: value,
      cropName: value, // Keep both in sync
      cropId: cropId,
    }));
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

  // In edit mode, require spec. In create mode, we generate a blank one.
  if (!isOpen) return null;
  if (mode === 'edit' && !spec) return null;

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
              ? 'Create Planting Spec'
              : `Edit Planting Spec${formData.identifier ? ` for ${formData.identifier}` : ''}`}
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
                    onChange={(e) => updateCropName(e.target.value)}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  {formData.crop && !formData.cropId && (
                    <p className="text-xs text-amber-600 mt-1">
                      No matching crop entity found - colors won&apos;t be applied
                    </p>
                  )}
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
                    min="0.1"
                    step="any"
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
                  <SeedSourceSelect
                    cropName={formData.crop ?? ''}
                    value={formData.defaultSeedSource}
                    varieties={varieties}
                    seedMixes={seedMixes}
                    onChange={(source) => updateField('defaultSeedSource', source)}
                    placeholder="None (assign manually)"
                  />
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
                        {/* Product header with selector and remove button */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-500">#{index + 1}</span>
                            {(() => {
                              // Get all products for this crop (for the dropdown)
                              const cropName = formData.crop?.toLowerCase().trim();
                              const matchingProducts = Object.values(products).filter(
                                (p) => p.crop.toLowerCase().trim() === cropName
                              );

                              if (matchingProducts.length <= 1) {
                                // Only one product available, show as static text
                                return (
                                  <span className="font-medium text-sm text-gray-900">
                                    {product ? `${product.product} (${product.unit})` : py.productId}
                                  </span>
                                );
                              }

                              // Multiple products available, show dropdown
                              return (
                                <select
                                  value={py.productId}
                                  onChange={(e) => {
                                    const updated = [...(formData.productYields ?? [])];
                                    updated[index] = { ...py, productId: e.target.value };
                                    updateField('productYields', updated);
                                  }}
                                  className="px-2 py-1 text-sm font-medium text-gray-900 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  {matchingProducts.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.product} ({p.unit})
                                    </option>
                                  ))}
                                </select>
                              );
                            })()}
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
                            const result = evaluateYieldForDisplay({ ...formData, yieldFormula: py.yieldFormula, numberOfHarvests: py.numberOfHarvests } as PlantingSpec);
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
                              const unit = product?.unit ?? 'units';
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
                    <div className="flex items-center gap-1 mb-1">
                      <label className="block text-xs font-medium text-gray-600">DTM Measured From</label>
                      <button
                        type="button"
                        onClick={() => setShowDtmHelp(true)}
                        className="w-4 h-4 rounded-full bg-gray-200 text-gray-600 hover:bg-blue-100 hover:text-blue-700 text-xs font-bold flex items-center justify-center"
                        title="Learn about DTM measurement options"
                      >
                        ?
                      </button>
                    </div>
                    <select
                      value={formData.dtmBasis || ''}
                      onChange={(e) => updateField('dtmBasis', e.target.value as 'ds-from-germination-to-harvest' | 'tp-from-planting-to-harvest' | 'tp-from-seeding-to-harvest' | undefined)}
                      className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select...</option>
                      <option value="ds-from-germination-to-harvest">Direct Seed: From Germination</option>
                      <option value="tp-from-planting-to-harvest">Transplant: From Planting</option>
                      <option value="tp-from-seeding-to-harvest">Transplant: From Seeding</option>
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

                {/* Assumed Transplant Days - only relevant for tp-from-planting-to-harvest dtmBasis */}
                {formData.dtmBasis === 'tp-from-planting-to-harvest' && (
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
                      {mode === 'create' ? 'Create Spec' : 'Save Changes'}
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

      {/* DTM Measurement Help Modal */}
      {showDtmHelp && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL_CONFIRM }}>
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowDtmHelp(false)}
          />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">Understanding DTM Measurement</h2>
              <button
                onClick={() => setShowDtmHelp(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
              >
                &times;
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-4 overflow-y-auto flex-1 text-sm text-gray-700 space-y-5">
              <section>
                <h3 className="font-semibold text-gray-900 mb-2">What is DTM?</h3>
                <p className="mb-2">
                  &quot;Days to Maturity&quot; (DTM) always measures the time until the <strong>first harvest</strong> of
                  a crop from some point in time. But what that starting point is varies quite a bit depending on
                  where you&apos;re sourcing your information.
                </p>
                <p className="mb-3">
                  In general, people get this number from their <strong>seed seller</strong> or from their
                  <strong> own records</strong>. Seed sellers typically list DTM assuming either direct seeding
                  or transplanting—and which one they assume depends on the crop. Sometimes they explicitly state
                  which, but often they don&apos;t. Always consult your seed seller&apos;s literature to understand
                  what their numbers represent.
                </p>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-3">
                  <div className="text-xs text-amber-800">
                    <strong className="text-amber-900">What seed sellers typically mean:</strong> The amount of time
                    there was a green plant in the field before it was harvested. They exclude germination time, and
                    for transplants they also exclude greenhouse/prop room time.
                  </div>
                </div>
                <p>
                  We also support a third, non-standard method that we find useful for generating assumptions
                  from your own farming records: measuring from when you seed a transplant all the way to harvest.
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-gray-900 mb-2">The Three Options</h3>
                <div className="space-y-4">
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="text-blue-900 mb-1"><span className="font-bold">Direct Seed:</span> <span className="font-bold">From Germination</span> to First Harvest</div>
                    <p className="text-blue-800 text-xs mb-2">
                      The number represents days from when a direct-seeded crop germinates to first harvest.
                    </p>
                    <p className="text-blue-700 text-xs">
                      This is what seed sellers typically mean when they assume a crop will be direct seeded.
                      The count starts after the seed sprouts in the field—does not include germination time.
                    </p>
                    <p className="text-blue-600 text-xs mt-1 italic">
                      Example: Arugula listed as &quot;25 days&quot; means 25 days from emergence to harvest.
                    </p>
                    <details className="mt-2 pt-2 border-t border-blue-200">
                      <summary className="text-blue-700 text-xs cursor-pointer hover:text-blue-900">
                        See how we use this internally
                      </summary>
                      <div className="mt-2 text-blue-700 text-xs space-y-2">
                        <p className="text-blue-600">
                          We calculate <strong>Seed to Harvest</strong> (total days from seeding to first harvest) based on how you actually grow it:
                        </p>
                        <div className="bg-blue-100/50 rounded p-2 space-y-3">
                          <div>
                            <div className="font-bold">If you grow as direct seed:</div>
                            <div className="font-mono mt-1 ml-2">Days to Germination + DTM</div>
                          </div>
                          <div>
                            <div className="font-bold">If you grow as transplant:</div>
                            <div className="font-mono mt-1 ml-2">Days to Germination + DTM + Shock Adjustment</div>
                          </div>
                        </div>
                      </div>
                    </details>
                  </div>

                  <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
                    <div className="text-purple-900 mb-1"><span className="font-bold">Transplant:</span> <span className="font-bold">From Planting</span> to First Harvest</div>
                    <p className="text-purple-800 text-xs mb-2">
                      The number represents days from when a transplant goes into the ground to first harvest.
                    </p>
                    <p className="text-purple-700 text-xs">
                      This is what seed sellers typically mean when they assume a crop will be transplanted.
                      The count starts when the plug is planted in the field, not when it was seeded.
                    </p>
                    <p className="text-purple-600 text-xs mt-1 italic">
                      Example: Tomatoes listed as &quot;69 days from transplant&quot; means 69 days after planting a start.
                    </p>
                    <p className="text-purple-500 text-xs mt-2">
                      When using this option, we also need the <strong>Assumed Transplant Age</strong>—how
                      old the transplant was assumed to be. There&apos;s a big difference between a tiny
                      200-cell plug vs. a 4-inch pot. You can often estimate this from how many weeks before
                      planting the seller recommends starting seeds (e.g., &quot;3 weeks before planting&quot; = 21 days).
                    </p>
                    <details className="mt-2 pt-2 border-t border-purple-200">
                      <summary className="text-purple-700 text-xs cursor-pointer hover:text-purple-900">
                        See how we use this internally
                      </summary>
                      <div className="mt-2 text-purple-700 text-xs space-y-2">
                        <p className="text-purple-600">
                          We calculate <strong>Seed to Harvest</strong> (total days from seeding to first harvest) based on how you actually grow it:
                        </p>
                        <div className="bg-purple-100/50 rounded p-2 space-y-3">
                          <div>
                            <div className="font-bold">If you grow as transplant:</div>
                            <div className="font-mono mt-1 ml-2">Days in Greenhouse + DTM</div>
                          </div>
                          <div>
                            <div className="font-bold">If you grow as direct seed:</div>
                            <div className="font-mono mt-1 ml-2">Assumed Transplant Age + DTM − Shock Adjustment</div>
                          </div>
                        </div>
                      </div>
                    </details>
                  </div>

                  <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
                    <div className="text-purple-900 mb-1"><span className="font-bold">Transplant:</span> <span className="font-bold">From Seeding</span> to First Harvest</div>
                    <p className="text-purple-800 text-xs mb-2">
                      The number represents total days from seeding a transplant to first harvest.
                    </p>
                    <p className="text-purple-700 text-xs">
                      This non-standard option is useful when working from your own records. It includes
                      greenhouse time, transplant shock, and field time—the entire journey from when seeds
                      go into trays to when you harvest.
                    </p>
                    <p className="text-purple-600 text-xs mt-1 italic">
                      Example: Your records show tomatoes take &quot;115 days&quot; from seeding trays to first harvest.
                    </p>
                    <details className="mt-2 pt-2 border-t border-purple-200">
                      <summary className="text-purple-700 text-xs cursor-pointer hover:text-purple-900">
                        See how we use this internally
                      </summary>
                      <div className="mt-2 text-purple-700 text-xs space-y-2">
                        <p className="text-purple-600">
                          We calculate <strong>Seed to Harvest</strong> (total days from seeding to first harvest) based on how you actually grow it:
                        </p>
                        <div className="bg-purple-100/50 rounded p-2 space-y-3">
                          <div>
                            <div className="font-bold">If you grow as transplant:</div>
                            <div className="font-mono mt-1 ml-2">DTM <span className="font-sans text-purple-500">(already includes everything)</span></div>
                          </div>
                          <div>
                            <div className="font-bold">If you grow as direct seed:</div>
                            <div className="font-mono mt-1 ml-2">DTM − Shock Adjustment</div>
                          </div>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <p className="text-amber-800 text-sm">
                    <strong>Note:</strong> None of this applies to perennials, which are assumed to be mature plants already in the ground.
                  </p>
                </div>
                <p className="mt-4">
                  What matters is that the number you input represents what you think it does. Whether it came
                  from a seed supplier or your own records, you&apos;re free to input that number however you see
                  fit—just make sure the software knows what it represents.
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-gray-900 mb-2">Understanding Transplant Shock</h3>
                <p className="mb-2">
                  Crops that are transplanted actually take <strong>slightly longer overall</strong> than
                  crops grown directly from seed—from the time they&apos;re seeded to harvest. This is because
                  their growth is limited while in the cell, and they experience some shock from
                  being disturbed during transplanting.
                </p>
                <p className="mb-2">
                  However, transplants spend <strong>less time in the field</strong>. What you gain by
                  transplanting is giving them a head start before the weather is good enough outside.
                </p>
                <p className="text-sm text-gray-500">
                  If you take DTM measured for a direct-seeded crop and assume you can just subtract
                  the propagation time, you&apos;ll underestimate the actual field time. We account
                  for this with a &quot;transplant shock adjustment.&quot; The default is 14 days to be
                  conservative—many plants treated well only experience a few days of difference.
                </p>
              </section>

              <section className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-1">Current Plan Settings</h3>
                <div className="text-sm text-gray-600 space-y-1">
                  <div className="flex justify-between">
                    <span>Transplant shock adjustment:</span>
                    <span className="font-mono text-gray-900">{transplantShockDays} days</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Default assumed transplant age:</span>
                    <span className="font-mono text-gray-900">{defaultTransplantAge} days</span>
                  </div>
                </div>
                <p className="text-sm text-gray-500 mt-2">
                  You can override the assumed transplant age per-spec below this dropdown when using
                  the &quot;Transplant&quot; option. Plan-level defaults can be changed in Settings.
                </p>
              </section>

              <section className="bg-green-50 rounded-lg p-4 border border-green-200">
                <h3 className="font-semibold text-green-900 mb-2">Why go to all this trouble?</h3>
                <p className="text-green-800 text-sm mb-2">
                  Market gardeners often plant crops unconventionally. While a commercial grower might always
                  direct seed or always transplant a particular crop, there can be good reasons in a market
                  garden context to do the exact opposite.
                </p>
                <p className="text-green-800 text-sm mb-2">
                  As you can see, trying to do this math in your head can be daunting.
                </p>
                <p className="text-green-700 text-sm font-medium">
                  Our goal is to let you put in whatever information you have—whether from seed catalogs,
                  your own records, or anywhere else—and then plant it however you&apos;d like.
                </p>
              </section>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t bg-gray-50 rounded-b-lg shrink-0">
              <button
                type="button"
                onClick={() => setShowDtmHelp(false)}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
