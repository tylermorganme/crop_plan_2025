'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { createSeedMix, type SeedMix, type SeedMixComponent } from '@/lib/entities/seed-mix';
import type { Variety } from '@/lib/entities/variety';
import { Z_INDEX } from '@/lib/z-index';
import { SearchableSelect, type SelectOption } from './SearchableSelect';
import { VarietyEditorModal } from './VarietyEditorModal';

// Convert weights to percentages (e.g., [2, 1, 1] -> [0.5, 0.25, 0.25])
function weightsToPercents(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return weights.map(() => 0);
  return weights.map((w) => w / total);
}

// Convert percentages to simplified weights (find common factor)
function percentsToWeights(percents: number[]): number[] {
  const multipliers = [1, 2, 3, 4, 5, 6, 8, 10, 12];
  for (const mult of multipliers) {
    const weights = percents.map((p) => Math.round(p * mult));
    const reconstructed = weightsToPercents(weights);
    const maxError = Math.max(...percents.map((p, i) => Math.abs(p - reconstructed[i])));
    if (maxError < 0.01) return weights;
  }
  return percents.map((p) => Math.round(p * 10));
}

// Format weights for display (e.g., "2:1:1")
function formatWeights(components: SeedMixComponent[]): string {
  if (components.length === 0) return '';
  const weights = percentsToWeights(components.map((c) => c.percent));
  return weights.join(':');
}

// Component row in editor - auto-growing form style
function ComponentRow({
  varietyId,
  weight,
  varietyOptions,
  onUpdateVariety,
  onUpdateWeight,
  onRemove,
  isBlank,
  onAddVariety,
}: {
  varietyId: string;
  weight: number;
  varietyOptions: SelectOption[];
  onUpdateVariety: (varietyId: string) => void;
  onUpdateWeight: (weight: number) => void;
  onRemove: () => void;
  isBlank: boolean;
  onAddVariety?: () => void;
}) {
  return (
    <div className={`flex items-center gap-2 py-1 ${isBlank ? 'opacity-60' : ''}`}>
      <div className="flex-1 min-w-0">
        <SearchableSelect
          value={varietyId}
          onChange={onUpdateVariety}
          options={varietyOptions}
          placeholder={isBlank ? 'Search variety...' : 'Select variety...'}
          emptyMessage="No matching varieties"
          onAdd={onAddVariety}
          addLabel="Add Variety"
        />
      </div>
      <input
        type="number"
        value={weight}
        onChange={(e) => onUpdateWeight(parseInt(e.target.value, 10) || 1)}
        className="w-16 px-2 py-1 border rounded text-sm text-center flex-shrink-0"
        min={1}
        title="Weight (relative)"
        disabled={isBlank}
      />
      {!isBlank && (
        <button type="button" onClick={onRemove} className="px-2 py-1 text-red-600 hover:bg-red-50 rounded text-sm flex-shrink-0">×</button>
      )}
      {isBlank && <div className="w-7 flex-shrink-0" />}
    </div>
  );
}

export interface SeedMixEditorModalProps {
  /** Existing mix to edit, or null for creating new */
  mix: SeedMix | null;
  /** All varieties in the plan */
  varieties: Record<string, Variety>;
  /** All crops (for crop dropdown) */
  crops: Record<string, { id: string; name: string }>;
  /** Pre-selected crop name (for new mixes) */
  initialCrop?: string;
  /** Called when mix is saved */
  onSave: (mix: SeedMix) => void;
  /** Called when modal is closed */
  onClose: () => void;
  /** Called when a new variety is added - if provided, shows "Add Variety" button */
  onAddVariety?: (variety: Variety) => void;
}

/**
 * Modal for creating or editing a seed mix.
 * Extracted as a shared component for reuse in SeedSourceSelect.
 */
export function SeedMixEditorModal({
  mix,
  varieties,
  crops,
  initialCrop,
  onSave,
  onClose,
  onAddVariety,
}: SeedMixEditorModalProps) {
  const [name, setName] = useState(mix?.name ?? '');
  const [crop, setCrop] = useState(mix?.crop ?? initialCrop ?? '');
  const [notes, setNotes] = useState(mix?.notes ?? '');
  const [showVarietyEditor, setShowVarietyEditor] = useState(false);

  // Store components as [{varietyId, weight}] - weights are integers
  const [components, setComponents] = useState<{ varietyId: string; weight: number }[]>(() => {
    if (!mix?.components) return [];
    const weights = percentsToWeights(mix.components.map((c) => c.percent));
    return mix.components.map((c, i) => ({ varietyId: c.varietyId, weight: weights[i] }));
  });

  // Get all varieties as SelectOption[] (mixes can contain varieties from any crop)
  const varietyOptions = useMemo((): SelectOption[] => {
    return Object.values(varieties)
      .sort((a, b) => {
        // Sort by crop, then by name
        const cropCmp = a.crop.localeCompare(b.crop);
        return cropCmp !== 0 ? cropCmp : a.name.localeCompare(b.name);
      })
      .map((v) => ({
        value: v.id,
        label: `${v.crop}: ${v.name}`,
        secondary: v.supplier || undefined,
        group: v.crop,
      }));
  }, [varieties]);

  // Get unique crops from crops entity (primary) merged with any from varieties (fallback)
  const uniqueCrops = useMemo(() => {
    const cropNames = new Set<string>();
    // Add crops from crops entity
    for (const c of Object.values(crops)) {
      cropNames.add(c.name);
    }
    // Also add any crops from varieties (in case varieties reference crops not in entity)
    for (const v of Object.values(varieties)) {
      cropNames.add(v.crop);
    }
    return Array.from(cropNames).sort();
  }, [crops, varieties]);

  // Auto-growing: always keep one blank row at the end
  const handleUpdateVariety = useCallback((index: number, varietyId: string) => {
    const newComponents = [...components];
    const isLastRow = index === components.length - 1;
    const wasBlank = !newComponents[index]?.varietyId;

    newComponents[index] = { ...newComponents[index], varietyId };

    if (isLastRow && wasBlank && varietyId) {
      newComponents.push({ varietyId: '', weight: 1 });
    }

    setComponents(newComponents);
  }, [components]);

  const handleUpdateWeight = useCallback((index: number, weight: number) => {
    const newComponents = [...components];
    newComponents[index] = { ...newComponents[index], weight };
    setComponents(newComponents);
  }, [components]);

  const handleRemoveComponent = useCallback((index: number) => {
    const nonBlankCount = components.filter(c => c.varietyId).length;
    if (!components[index].varietyId && nonBlankCount === 0) return;

    let newComponents = components.filter((_, i) => i !== index);

    if (newComponents.length === 0 || newComponents[newComponents.length - 1].varietyId) {
      newComponents.push({ varietyId: '', weight: 1 });
    }

    setComponents(newComponents);
  }, [components]);

  // Ensure there's always a blank row when crop changes
  useEffect(() => {
    if (crop && varietyOptions.length > 0) {
      if (components.length === 0 || components[components.length - 1].varietyId) {
        setComponents(prev => [...prev, { varietyId: '', weight: 1 }]);
      }
    }
  }, [crop, varietyOptions.length]);

  const handleEqualWeights = useCallback(() => {
    setComponents(components.map((c) => ({ ...c, weight: 1 })));
  }, [components]);

  const filledComponents = useMemo(() => components.filter(c => c.varietyId), [components]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !crop.trim()) return;

    const validComponents = components.filter((c) => c.varietyId);
    const weights = validComponents.map((c) => c.weight);
    const percents = weightsToPercents(weights);

    const newMix = createSeedMix({
      id: mix?.id,
      name: name.trim(),
      crop: crop.trim(),
      components: validComponents.map((c, i) => ({
        varietyId: c.varietyId,
        percent: percents[i],
      })),
      notes: notes.trim() || undefined,
    });

    onSave(newMix);
  }, [name, crop, notes, components, mix?.id, onSave]);

  const isValid = name.trim() && crop.trim() && filledComponents.length > 0;

  // Use portal to escape any parent stacking context (e.g., table cells)
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: Z_INDEX.MODAL + 20 }} // Higher than other modals to appear on top
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto overflow-x-hidden">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-gray-900">
            {mix ? 'Edit Seed Mix' : 'Create Seed Mix'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3 overflow-hidden">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-2 py-1.5 border rounded text-sm"
              placeholder="Mix Name *"
              required
              autoFocus
            />
            <select
              value={crop}
              onChange={(e) => { setCrop(e.target.value); setComponents([]); }}
              className="px-2 py-1.5 border rounded text-sm"
              required
            >
              <option value="">Select crop *</option>
              {uniqueCrops.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Components */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-700">
                Components {filledComponents.length > 0 && `(${formatWeights(filledComponents.map((c, i) => ({ varietyId: c.varietyId, percent: weightsToPercents(filledComponents.map(x => x.weight))[i] })))})`}
              </span>
              {filledComponents.length > 1 && (
                <button type="button" onClick={handleEqualWeights} className="text-xs text-blue-600 hover:underline">
                  Equal weights
                </button>
              )}
            </div>

            {!crop ? (
              <p className="text-xs text-gray-500 italic py-2">Select a crop first.</p>
            ) : varietyOptions.length === 0 ? (
              <p className="text-xs text-gray-500 italic py-2">No varieties for {crop}.</p>
            ) : (
              <div className="border rounded p-2 bg-gray-50 space-y-1 overflow-hidden">
                {components.map((component, index) => (
                  <ComponentRow
                    key={index}
                    varietyId={component.varietyId}
                    weight={component.weight}
                    varietyOptions={varietyOptions}
                    onUpdateVariety={(id) => handleUpdateVariety(index, id)}
                    onUpdateWeight={(w) => handleUpdateWeight(index, w)}
                    onRemove={() => handleRemoveComponent(index)}
                    isBlank={!component.varietyId}
                    onAddVariety={onAddVariety ? () => setShowVarietyEditor(true) : undefined}
                  />
                ))}
              </div>
            )}
          </div>

          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-2 py-1.5 border rounded text-sm"
            placeholder="Notes (optional)"
          />

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
              Cancel
            </button>
            <button type="submit" disabled={!isValid} className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:bg-blue-300">
              {mix ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>

      {/* Variety Editor Modal */}
      {showVarietyEditor && onAddVariety && (
        <VarietyEditorModal
          variety={null}
          initialCrop={crop}
          onSave={(newVariety) => {
            onAddVariety(newVariety);
            setShowVarietyEditor(false);
          }}
          onClose={() => setShowVarietyEditor(false)}
        />
      )}
    </div>,
    document.body
  );
}

export default SeedMixEditorModal;
