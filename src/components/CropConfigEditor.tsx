'use client';

import { useState, useEffect, useRef } from 'react';
import {
  type CropConfig,
  type TrayStage,
  calculateDaysInCells,
  calculateSTH,
  calculatePlantingMethod,
  calculateHarvestWindow,
  createBlankConfig,
} from '@/lib/entities/crop-config';
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
      'DS': 'DTM measurement basis (from seeding)',
      'TP': 'DTM measurement basis (from transplant)',
      'X': 'DTM measurement basis (full seed-to-harvest)',
    };
    items.push(methodLabels[info.normalMethod] || info.normalMethod);
  }

  return items;
}

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
}: CropConfigEditorProps) {
  // Form state - initialize from crop when opened
  const [formData, setFormData] = useState<Partial<CropConfig>>({});
  const [trayStages, setTrayStages] = useState<TrayStage[]>([]);
  const [growingMethod, setGrowingMethod] = useState<GrowingMethod>('direct-seed');
  const [showRemovalConfirm, setShowRemovalConfirm] = useState(false);
  const [pendingRemovalInfo, setPendingRemovalInfo] = useState<DataRemovalInfo | null>(null);
  const [identifierError, setIdentifierError] = useState<string | null>(null);
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
        setTimeout(() => identifierInputRef.current?.focus(), 0);
      }
    }
  }, [crop, isOpen, mode]);

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
  const sth = calculateSTH(previewCrop, daysInCells);
  const plantingMethod = calculatePlantingMethod(previewCrop);
  const harvestWindow = calculateHarvestWindow(previewCrop);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.identifier?.trim() || !formData.crop?.trim()) return;

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

  const updateField = <K extends keyof CropConfig>(field: K, value: CropConfig[K]) => {
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
            {mode === 'create' ? 'Create Crop Configuration' : 'Edit Crop Configuration'}
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
                  <div className="text-xs text-blue-600">STH</div>
                  <div className="text-sm font-semibold text-blue-900">{sth}</div>
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
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Variant</label>
                  <input
                    type="text"
                    value={formData.variant || ''}
                    onChange={(e) => updateField('variant', e.target.value || undefined)}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Product</label>
                  <input
                    type="text"
                    value={formData.product || ''}
                    onChange={(e) => updateField('product', e.target.value || undefined)}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    onChange={(e) => updateField('growingStructure', e.target.value || undefined)}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select...</option>
                    <option value="Field">Field</option>
                    <option value="Caterpillar">Caterpillar</option>
                    <option value="High Tunnel">High Tunnel</option>
                    <option value="Greenhouse">Greenhouse</option>
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

            {/* Harvest Section */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b">Harvest</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Days Between Harvest</label>
                  <input
                    type="number"
                    value={formData.daysBetweenHarvest ?? ''}
                    onChange={(e) => updateNumberField('daysBetweenHarvest', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Number of Harvests</label>
                  <input
                    type="number"
                    value={formData.numberOfHarvests ?? ''}
                    onChange={(e) => updateNumberField('numberOfHarvests', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Harvest Buffer Days</label>
                  <input
                    type="number"
                    value={formData.harvestBufferDays ?? ''}
                    onChange={(e) => updateNumberField('harvestBufferDays', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Post-Harvest Field Days</label>
                  <input
                    type="number"
                    value={formData.postHarvestFieldDays ?? ''}
                    onChange={(e) => updateNumberField('postHarvestFieldDays', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">e.g., tuber curing time</p>
                </div>
              </div>
            </section>

            {/* Yield Section */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b">Yield</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Yield Per Harvest</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.yieldPerHarvest ?? ''}
                    onChange={(e) => updateNumberField('yieldPerHarvest', e.target.value)}
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Yield Unit</label>
                  <input
                    type="text"
                    value={formData.yieldUnit || ''}
                    onChange={(e) => updateField('yieldUnit', e.target.value || undefined)}
                    placeholder="lb, bunch, head, stem..."
                    className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </section>

            {/* ========== METHOD-SPECIFIC FIELDS ========== */}

            {/* Timing Section - for DS and Transplant */}
            {growingMethod !== 'perennial' && (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b">Timing</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">DTM Measured From</label>
                    <select
                      value={formData.normalMethod || ''}
                      onChange={(e) => updateField('normalMethod', e.target.value as 'DS' | 'TP' | 'X' | undefined)}
                      className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select...</option>
                      <option value="DS">From seeding (seed packet)</option>
                      <option value="TP">From transplant date (seed packet)</option>
                      <option value="X">Full seed-to-harvest (grower/book)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      {growingMethod === 'direct-seed'
                        ? 'Usually DS for direct-seeded crops'
                        : 'How the DTM source measured timing'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">DTM (Days to Maturity)</label>
                    <input
                      type="number"
                      value={formData.dtm ?? ''}
                      onChange={(e) => updateNumberField('dtm', e.target.value)}
                      className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
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

                {/* Assumed Transplant Days - only relevant for TP normalMethod */}
                {formData.normalMethod === 'TP' && (
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

            {/* Perennial Timing Section */}
            {growingMethod === 'perennial' && (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-1 border-b">Harvest Timing</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">DTM (Days to First Harvest)</label>
                    <input
                      type="number"
                      value={formData.dtm ?? ''}
                      onChange={(e) => updateNumberField('dtm', e.target.value)}
                      className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Days from season start to first harvest</p>
                  </div>
                </div>
              </section>
            )}

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
          <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!formData.identifier?.trim() || !formData.crop?.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mode === 'create' ? 'Create Config' : 'Save Changes'}
            </button>
          </div>
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
