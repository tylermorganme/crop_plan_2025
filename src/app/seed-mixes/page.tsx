'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePlanStore, initializePlanStore } from '@/lib/plan-store';
import { createSeedMix, type SeedMix, type SeedMixComponent } from '@/lib/entities/seed-mix';
import type { Variety } from '@/lib/entities/variety';
import { Z_INDEX } from '@/lib/z-index';

// Stable empty object references to avoid SSR hydration issues
const EMPTY_VARIETIES: Record<string, Variety> = {};
const EMPTY_SEED_MIXES: Record<string, SeedMix> = {};

const ROW_HEIGHT = 32;
const EXPANDED_COMPONENT_HEIGHT = 24;
const HEADER_HEIGHT = 36;

type SortKey = 'crop' | 'name' | 'components';
type SortDir = 'asc' | 'desc';

// Convert weights to percentages (e.g., [2, 1, 1] -> [0.5, 0.25, 0.25])
function weightsToPercents(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return weights.map(() => 0);
  return weights.map((w) => w / total);
}

// Convert percentages to simplified weights (find common factor)
function percentsToWeights(percents: number[]): number[] {
  // Find approximate simple ratios
  const multipliers = [1, 2, 3, 4, 5, 6, 8, 10, 12];
  for (const mult of multipliers) {
    const weights = percents.map((p) => Math.round(p * mult));
    const reconstructed = weightsToPercents(weights);
    const maxError = Math.max(...percents.map((p, i) => Math.abs(p - reconstructed[i])));
    if (maxError < 0.01) return weights;
  }
  // Fallback: just round to nearest integer assuming sum ~= 100
  return percents.map((p) => Math.round(p * 10));
}

// Format weights for display (e.g., "2:1:1")
function formatWeights(components: SeedMixComponent[]): string {
  if (components.length === 0) return '';
  const weights = percentsToWeights(components.map((c) => c.percent));
  return weights.join(':');
}

// Toast notification component
function Toast({ message, type, onClose }: { message: string; type: 'error' | 'success' | 'info'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-green-600' : 'bg-blue-600';

  return (
    <div
      className={`fixed bottom-4 right-4 ${bgColor} text-white px-3 py-2 rounded shadow-lg flex items-center gap-2 text-sm`}
      style={{ zIndex: Z_INDEX.TOAST }}
    >
      <span>{message}</span>
      <button onClick={onClose} className="text-white/80 hover:text-white">&times;</button>
    </div>
  );
}

// Component row in editor - auto-growing form style
function ComponentRow({
  varietyId,
  weight,
  varieties,
  onUpdateVariety,
  onUpdateWeight,
  onRemove,
  isBlank,
}: {
  varietyId: string;
  weight: number;
  varieties: Variety[];
  onUpdateVariety: (varietyId: string) => void;
  onUpdateWeight: (weight: number) => void;
  onRemove: () => void;
  isBlank: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 py-1 ${isBlank ? 'opacity-60' : ''}`}>
      <select
        value={varietyId}
        onChange={(e) => onUpdateVariety(e.target.value)}
        className="flex-1 px-2 py-1 border rounded text-sm"
      >
        <option value="">{isBlank ? 'Add variety...' : 'Select variety...'}</option>
        {varieties.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} ({v.supplier || '?'})
          </option>
        ))}
      </select>
      <input
        type="number"
        value={weight}
        onChange={(e) => onUpdateWeight(parseInt(e.target.value, 10) || 1)}
        className="w-16 px-2 py-1 border rounded text-sm text-center"
        min={1}
        title="Weight (relative)"
        disabled={isBlank}
      />
      {!isBlank && (
        <button onClick={onRemove} className="px-2 py-1 text-red-600 hover:bg-red-50 rounded text-sm">×</button>
      )}
      {isBlank && <div className="w-7" />}
    </div>
  );
}

// Seed Mix Editor Modal
function SeedMixEditor({
  mix,
  varieties,
  onSave,
  onClose,
}: {
  mix: SeedMix | null;
  varieties: Record<string, Variety>;
  onSave: (mix: SeedMix) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(mix?.name ?? '');
  const [crop, setCrop] = useState(mix?.crop ?? '');
  const [notes, setNotes] = useState(mix?.notes ?? '');

  // Store components as [{varietyId, weight}] - weights are integers
  const [components, setComponents] = useState<{ varietyId: string; weight: number }[]>(() => {
    if (!mix?.components) return [];
    const weights = percentsToWeights(mix.components.map((c) => c.percent));
    return mix.components.map((c, i) => ({ varietyId: c.varietyId, weight: weights[i] }));
  });

  // Get varieties for the selected crop
  const cropVarieties = useMemo(() => {
    return Object.values(varieties).filter((v) => v.crop === crop);
  }, [varieties, crop]);

  // Get unique crops from varieties
  const uniqueCrops = useMemo(() => {
    const crops = new Set(Object.values(varieties).map((v) => v.crop));
    return Array.from(crops).sort();
  }, [varieties]);

  // Auto-growing: always keep one blank row at the end
  // When user fills the blank row, it becomes real and a new blank appears
  const handleUpdateVariety = useCallback((index: number, varietyId: string) => {
    const newComponents = [...components];
    const isLastRow = index === components.length - 1;
    const wasBlank = !newComponents[index]?.varietyId;

    newComponents[index] = { ...newComponents[index], varietyId };

    // If filling the last (blank) row, add a new blank row
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
    // Don't remove if it's the only blank row
    const nonBlankCount = components.filter(c => c.varietyId).length;
    if (!components[index].varietyId && nonBlankCount === 0) return;

    let newComponents = components.filter((_, i) => i !== index);

    // Ensure there's always one blank row at the end
    if (newComponents.length === 0 || newComponents[newComponents.length - 1].varietyId) {
      newComponents.push({ varietyId: '', weight: 1 });
    }

    setComponents(newComponents);
  }, [components]);

  // Ensure there's always a blank row when crop changes
  useEffect(() => {
    if (crop && cropVarieties.length > 0) {
      // If no components or last component is filled, add blank row
      if (components.length === 0 || components[components.length - 1].varietyId) {
        setComponents(prev => [...prev, { varietyId: '', weight: 1 }]);
      }
    }
  }, [crop, cropVarieties.length]);

  const handleEqualWeights = useCallback(() => {
    setComponents(components.map((c) => ({ ...c, weight: 1 })));
  }, [components]);

  // Components with a variety selected (excludes blank rows)
  const filledComponents = useMemo(() => components.filter(c => c.varietyId), [components]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !crop.trim()) return;

    // Convert weights to percentages
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

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: Z_INDEX.MODAL }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-gray-900">
            {mix ? 'Edit Seed Mix' : 'Create Seed Mix'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
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
            ) : cropVarieties.length === 0 ? (
              <p className="text-xs text-gray-500 italic py-2">No varieties for {crop}.</p>
            ) : (
              <div className="border rounded p-2 bg-gray-50 space-y-1">
                {components.map((component, index) => (
                  <ComponentRow
                    key={index}
                    varietyId={component.varietyId}
                    weight={component.weight}
                    varieties={cropVarieties}
                    onUpdateVariety={(id) => handleUpdateVariety(index, id)}
                    onUpdateWeight={(w) => handleUpdateWeight(index, w)}
                    onRemove={() => handleRemoveComponent(index)}
                    isBlank={!component.varietyId}
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
    </div>
  );
}

// Row with expandable component list
function MixRow({
  mix,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  getVariety,
}: {
  mix: SeedMix;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  getVariety: (id: string) => Variety | undefined;
}) {
  const componentDisplay = mix.components
    .map((c) => {
      const v = getVariety(c.varietyId);
      return v?.name ?? '?';
    })
    .join(', ');

  const weights = formatWeights(mix.components);

  return (
    <>
      <div
        className="flex items-center border-b border-gray-100 hover:bg-gray-50 group cursor-pointer"
        style={{ height: ROW_HEIGHT }}
        onClick={onToggle}
      >
        <div className="w-6 px-1 text-gray-400 text-xs">{isExpanded ? '▼' : '▶'}</div>
        <div className="w-32 px-2 text-sm truncate">{mix.crop}</div>
        <div className="w-48 px-2 text-sm font-medium truncate">{mix.name}</div>
        <div className="w-16 px-2 text-sm text-center text-gray-600">{mix.components.length}</div>
        <div className="w-24 px-2 text-sm text-gray-600 font-mono">{weights}</div>
        <div className="flex-1 px-2 text-sm text-gray-500 truncate">{componentDisplay}</div>
        <div className="w-20 px-2 flex gap-1 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit} className="px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200 rounded">
            Edit
          </button>
          <button onClick={onDelete} className="px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 rounded">
            ×
          </button>
        </div>
      </div>
      {isExpanded && (
        <div className="bg-gray-50 border-b border-gray-200">
          {mix.components.map((c, i) => {
            const v = getVariety(c.varietyId);
            const weights = percentsToWeights(mix.components.map((x) => x.percent));
            return (
              <div
                key={c.varietyId}
                className="flex items-center pl-10 pr-2 text-xs text-gray-600"
                style={{ height: EXPANDED_COMPONENT_HEIGHT }}
              >
                <div className="w-32">{v?.name ?? 'Unknown'}</div>
                <div className="w-24">{v?.supplier ?? '-'}</div>
                <div className="w-16 text-center font-mono">{weights[i]}</div>
                <div className="w-20 text-center">{Math.round(c.percent * 100)}%</div>
                {v?.organic && <span className="text-green-600 ml-2">Org</span>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function SeedMixesPage() {
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [editingMix, setEditingMix] = useState<SeedMix | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCrop, setFilterCrop] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('crop');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Store hooks - now using plan store
  const varieties = usePlanStore((state) => state.currentPlan?.varieties ?? EMPTY_VARIETIES);
  const seedMixes = usePlanStore((state) => state.currentPlan?.seedMixes ?? EMPTY_SEED_MIXES);
  const hasPlan = usePlanStore((state) => state.currentPlan !== null);
  const addSeedMix = usePlanStore((state) => state.addSeedMix);
  const updateSeedMix = usePlanStore((state) => state.updateSeedMix);
  const deleteSeedMix = usePlanStore((state) => state.deleteSeedMix);
  const importSeedMixes = usePlanStore((state) => state.importSeedMixes);
  const importVarieties = usePlanStore((state) => state.importVarieties);
  const getVariety = usePlanStore((state) => state.getVariety);

  // Initialize store
  useEffect(() => {
    initializePlanStore().then(() => setIsLoaded(true));
  }, []);

  // Compute unique crops
  const uniqueCrops = useMemo(() => {
    const crops = new Set(Object.values(seedMixes).map((m) => m.crop));
    return Array.from(crops).sort();
  }, [seedMixes]);

  // Filter and sort mixes
  const filteredMixes = useMemo(() => {
    let result = Object.values(seedMixes);

    if (filterCrop) result = result.filter((m) => m.crop === filterCrop);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.crop.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'crop': cmp = a.crop.localeCompare(b.crop); break;
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'components': cmp = a.components.length - b.components.length; break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [seedMixes, filterCrop, searchQuery, sortKey, sortDir]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSaveMix = useCallback(
    async (mix: SeedMix) => {
      if (editingMix) {
        await updateSeedMix(mix);
        setToast({ message: 'Updated', type: 'success' });
      } else {
        await addSeedMix(mix);
        setToast({ message: 'Created', type: 'success' });
      }
      setIsEditorOpen(false);
      setEditingMix(null);
    },
    [editingMix, addSeedMix, updateSeedMix]
  );

  const handleDeleteMix = useCallback(
    async (mix: SeedMix) => {
      if (!confirm(`Delete "${mix.name}"?`)) return;
      await deleteSeedMix(mix.id);
      setToast({ message: 'Deleted', type: 'info' });
    },
    [deleteSeedMix]
  );

  const handleLoadStock = useCallback(async () => {
    try {
      // Load varieties first (if not already loaded) so seed mix references resolve
      const varietyCount = Object.keys(varieties).length;
      if (varietyCount === 0) {
        const varietyResponse = await import('@/data/varieties-template.json');
        const varietyList = varietyResponse.varieties || [];
        await importVarieties(varietyList);
      }

      // Now load seed mixes
      const response = await import('@/data/seed-mixes-template.json');
      const mixList = response.seedMixes || [];
      const result = await importSeedMixes(mixList);

      // Report results
      if (result.unresolvedVarieties > 0) {
        setToast({
          message: `Loaded ${result.added} mixes (${result.unresolvedVarieties} unresolved varieties)`,
          type: 'info'
        });
      } else {
        setToast({ message: `Loaded ${result.added} mixes (${result.updated} updated)`, type: 'success' });
      }
    } catch {
      setToast({ message: 'Failed to load', type: 'error' });
    }
  }, [importSeedMixes, importVarieties, varieties]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setFilterCrop('');
  }, []);

  const SortHeader = ({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) => (
    <button
      onClick={() => handleSort(sortKeyName)}
      className={`text-left text-xs font-medium uppercase tracking-wide flex items-center gap-1 hover:text-gray-900 ${
        sortKey === sortKeyName ? 'text-blue-600' : 'text-gray-600'
      }`}
    >
      {label}
      {sortKey === sortKeyName && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  );

  if (!isLoaded) {
    return (
      <div className="min-h-[calc(100vh-60px)] bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!hasPlan) {
    return (
      <div className="min-h-[calc(100vh-60px)] bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">No plan loaded. Open a plan first.</div>
      </div>
    );
  }

  const mixCount = Object.keys(seedMixes).length;
  const varietyCount = Object.keys(varieties).length;
  const hasFilters = searchQuery || filterCrop;

  return (
    <div className="h-[calc(100vh-49px)] bg-gray-50 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-wrap flex-shrink-0">
        <h1 className="text-lg font-semibold text-gray-900">Seed Mixes</h1>
        <span className="text-sm text-gray-500">{filteredMixes.length}/{mixCount}</span>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search..."
          className="px-2 py-1 border rounded text-sm w-40"
        />
        <select
          value={filterCrop}
          onChange={(e) => setFilterCrop(e.target.value)}
          className="px-2 py-1 border rounded text-sm"
        >
          <option value="">All Crops</option>
          {uniqueCrops.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>
        )}

        <div className="flex-1" />

        <button onClick={handleLoadStock} className="px-3 py-1 text-sm text-gray-700 border rounded hover:bg-gray-50">
          Reset to Stock
        </button>
        <button
          onClick={() => { setEditingMix(null); setIsEditorOpen(true); }}
          disabled={varietyCount === 0}
          className="px-3 py-1 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:bg-blue-300"
          title={varietyCount === 0 ? 'Add varieties first' : undefined}
        >
          + Create
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 bg-white overflow-hidden flex flex-col">
        {varietyCount === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
            <span>Add varieties first</span>
            <a href="/varieties" className="text-blue-600 hover:underline text-sm">Go to Varieties</a>
          </div>
        ) : filteredMixes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            {mixCount === 0 ? 'No seed mixes loaded.' : 'No matches'}
          </div>
        ) : (
          <>
            {/* Header - fixed, doesn't scroll */}
            <div className="bg-gray-100 border-b flex-shrink-0" style={{ height: HEADER_HEIGHT }}>
              <div className="flex items-center h-full px-2">
                <div className="w-6"></div>
                <div className="w-32 px-2"><SortHeader label="Crop" sortKeyName="crop" /></div>
                <div className="w-48 px-2"><SortHeader label="Name" sortKeyName="name" /></div>
                <div className="w-16 px-2 text-center"><SortHeader label="#" sortKeyName="components" /></div>
                <div className="w-24 px-2 text-xs font-medium text-gray-600 uppercase">Ratio</div>
                <div className="flex-1 px-2 text-xs font-medium text-gray-600 uppercase">Varieties</div>
                <div className="w-20 px-2"></div>
              </div>
            </div>

            {/* Body - scrolls independently */}
            <div ref={tableContainerRef} className="flex-1 overflow-auto">
              {filteredMixes.map((mix) => (
                <MixRow
                  key={mix.id}
                  mix={mix}
                  isExpanded={expandedIds.has(mix.id)}
                  onToggle={() => toggleExpanded(mix.id)}
                  onEdit={() => { setEditingMix(mix); setIsEditorOpen(true); }}
                  onDelete={() => handleDeleteMix(mix)}
                  getVariety={getVariety}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {isEditorOpen && (
        <SeedMixEditor
          mix={editingMix}
          varieties={varieties}
          onSave={handleSaveMix}
          onClose={() => { setIsEditorOpen(false); setEditingMix(null); }}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
