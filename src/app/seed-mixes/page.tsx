'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { usePlanStore, initializePlanStore } from '@/lib/plan-store';
import { type SeedMix, type SeedMixComponent } from '@/lib/entities/seed-mix';
import type { Variety } from '@/lib/entities/variety';
import { Z_INDEX } from '@/lib/z-index';
import AppHeader from '@/components/AppHeader';
import { FastEditTable, ColumnDef } from '@/components/FastEditTable';
import { SeedMixEditorModal } from '@/components/SeedMixEditorModal';

// Stable empty object references to avoid SSR hydration issues
const EMPTY_VARIETIES: Record<string, Variety> = {};
const EMPTY_SEED_MIXES: Record<string, SeedMix> = {};
const EMPTY_CROPS: Record<string, { id: string; name: string }> = {};

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


// Component details tooltip
function MixComponentsTooltip({
  mix,
  varieties,
  position,
}: {
  mix: SeedMix;
  varieties: Record<string, Variety>;
  position: { top: number; left: number };
}) {
  const weights = percentsToWeights(mix.components.map((c) => c.percent));

  return createPortal(
    <div
      className="fixed bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-48 max-w-72"
      style={{
        zIndex: Z_INDEX.TOOLTIP,
        top: position.top,
        left: position.left,
      }}
    >
      <div className="text-sm font-medium text-gray-800 mb-2">{mix.name}</div>
      <div className="text-xs text-gray-600 space-y-1">
        {mix.components.map((comp, idx) => {
          const variety = varieties[comp.varietyId];
          const pct = Math.round(comp.percent * 100);
          return (
            <div key={idx} className="flex justify-between gap-3">
              <span className="truncate flex-1">
                {variety ? `${variety.name}${variety.supplier ? ` (${variety.supplier})` : ''}` : comp.varietyId}
              </span>
              <span className="text-gray-500 flex-shrink-0 font-mono">{weights[idx]}</span>
              <span className="text-gray-400 flex-shrink-0 w-8 text-right">{pct}%</span>
              <span className="text-gray-400 flex-shrink-0 w-8 text-right">{variety?.dtm ? `${variety.dtm}d` : '--d'}</span>
              <span className={`flex-shrink-0 w-6 text-right ${variety?.organic ? 'text-green-600' : 'text-gray-400'}`}>{variety?.organic ? 'Org' : 'Con'}</span>
            </div>
          );
        })}
      </div>
      {mix.notes && (
        <div className="mt-2 pt-2 border-t text-xs text-gray-500 italic">{mix.notes}</div>
      )}
    </div>,
    document.body
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
  const [hoveredMix, setHoveredMix] = useState<{ mix: SeedMix; position: { top: number; left: number } } | null>(null);

  // Store hooks
  const varieties = usePlanStore((state) => state.currentPlan?.varieties ?? EMPTY_VARIETIES);
  const seedMixes = usePlanStore((state) => state.currentPlan?.seedMixes ?? EMPTY_SEED_MIXES);
  const crops = usePlanStore((state) => state.currentPlan?.crops ?? EMPTY_CROPS);
  const hasPlan = usePlanStore((state) => state.currentPlan !== null);
  const addSeedMix = usePlanStore((state) => state.addSeedMix);
  const updateSeedMix = usePlanStore((state) => state.updateSeedMix);
  const deleteSeedMix = usePlanStore((state) => state.deleteSeedMix);
  const importSeedMixes = usePlanStore((state) => state.importSeedMixes);
  const importVarieties = usePlanStore((state) => state.importVarieties);
  const getVariety = usePlanStore((state) => state.getVariety);
  const addVariety = usePlanStore((state) => state.addVariety);

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

  const handleSort = useCallback((key: string) => {
    const typedKey = key as SortKey;
    if (sortKey === typedKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(typedKey);
      setSortDir('asc');
    }
  }, [sortKey]);

  // Column definitions for FastEditTable
  const columns: ColumnDef<SeedMix>[] = useMemo(() => [
    {
      key: 'crop',
      header: 'Crop',
      width: 120,
      sortable: true,
      getValue: (m) => m.crop,
    },
    {
      key: 'name',
      header: 'Name',
      width: 180,
      sortable: true,
      getValue: (m) => m.name,
      render: (m) => (
        <div className="px-2 text-sm font-medium truncate h-full flex items-center" title={m.name}>
          {m.name}
        </div>
      ),
    },
    {
      key: 'components',
      header: '#',
      width: 50,
      sortable: true,
      align: 'right',
      getValue: (m) => m.components.length,
    },
    {
      key: 'ratio',
      header: 'Ratio',
      width: 80,
      getValue: (m) => formatWeights(m.components),
      render: (m) => (
        <div className="px-2 text-sm text-gray-600 font-mono h-full flex items-center">
          {formatWeights(m.components)}
        </div>
      ),
    },
    {
      key: 'varieties',
      header: 'Varieties',
      width: 300,
      getValue: (m) => m.components.map((c) => getVariety(c.varietyId)?.name ?? '?').join(', '),
      render: (m) => {
        const display = m.components.map((c) => getVariety(c.varietyId)?.name ?? '?').join(', ');
        return (
          <div
            className="px-2 text-sm text-gray-500 truncate h-full flex items-center cursor-help"
            onMouseEnter={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setHoveredMix({
                mix: m,
                position: { top: rect.top, left: rect.right + 8 },
              });
            }}
            onMouseLeave={() => setHoveredMix(null)}
          >
            {display}
          </div>
        );
      },
    },
    {
      key: 'notes',
      header: 'Notes',
      width: 150,
      getValue: (m) => m.notes || '',
      render: (m) => (
        <div className="px-2 text-sm text-gray-400 truncate h-full flex items-center italic" title={m.notes}>
          {m.notes}
        </div>
      ),
    },
  ], [getVariety]);

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
      const varietyCount = Object.keys(varieties).length;
      if (varietyCount === 0) {
        const varietyResponse = await import('@/data/varieties-template.json');
        const varietyList = varietyResponse.varieties || [];
        await importVarieties(varietyList);
      }

      const response = await import('@/data/seed-mixes-template.json');
      const mixList = response.seedMixes || [];
      const result = await importSeedMixes(mixList);

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

  if (!isLoaded) {
    return (
      <>
        <AppHeader />
        <div className="h-[calc(100vh-49px)] bg-gray-50 flex items-center justify-center">
          <div className="text-gray-500">Loading...</div>
        </div>
      </>
    );
  }

  if (!hasPlan) {
    return (
      <>
        <AppHeader />
        <div className="h-[calc(100vh-49px)] bg-gray-50 flex items-center justify-center">
          <div className="text-gray-500">No plan loaded. Open a plan first.</div>
        </div>
      </>
    );
  }

  const mixCount = Object.keys(seedMixes).length;
  const varietyCount = Object.keys(varieties).length;
  const hasFilters = searchQuery || filterCrop;

  return (
    <>
      <AppHeader />
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
        <div className="flex-1 bg-white overflow-hidden p-4">
          {varietyCount === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2">
              <span>Add varieties first</span>
              <a href="/varieties" className="text-blue-600 hover:underline text-sm">Go to Varieties</a>
            </div>
          ) : (
            <div className="h-full border border-gray-200 rounded-lg overflow-hidden">
              <FastEditTable
                data={filteredMixes}
                rowKey={(m) => m.id}
                columns={columns}
                rowHeight={32}
                headerHeight={36}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                emptyMessage={mixCount === 0 ? 'No seed mixes loaded.' : 'No matches'}
                renderActions={(m) => (
                  <>
                    <button
                      onClick={() => { setEditingMix(m); setIsEditorOpen(true); }}
                      className="px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200 rounded"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteMix(m)}
                      className="px-1 py-0.5 text-xs text-red-600 hover:bg-red-50 rounded"
                    >
                      ×
                    </button>
                  </>
                )}
                actionsWidth={70}
              />
            </div>
          )}
        </div>

        {isEditorOpen && (
          <SeedMixEditorModal
            mix={editingMix}
            varieties={varieties}
            crops={crops}
            onSave={handleSaveMix}
            onClose={() => { setIsEditorOpen(false); setEditingMix(null); }}
            onAddVariety={addVariety}
          />
        )}

        {/* Hover tooltip for mix components */}
        {hoveredMix && typeof document !== 'undefined' && (
          <MixComponentsTooltip
            mix={hoveredMix.mix}
            varieties={varieties}
            position={hoveredMix.position}
          />
        )}

        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </>
  );
}
