'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePlanStore, initializePlanStore } from '@/lib/plan-store';
import { createVariety, type Variety, type DensityUnit } from '@/lib/entities/variety';
import { Z_INDEX } from '@/lib/z-index';
import AppHeader from '@/components/AppHeader';
import { FastEditTable, ColumnDef } from '@/components/FastEditTable';

// Stable empty object reference to avoid SSR hydration issues
const EMPTY_VARIETIES: Record<string, Variety> = {};

type SortKey = 'crop' | 'name' | 'supplier' | 'organic' | 'dtm' | 'density';
type SortDir = 'asc' | 'desc';

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

// Variety Editor Modal (compact)
function VarietyEditor({
  variety,
  onSave,
  onClose,
}: {
  variety: Variety | null;
  onSave: (variety: Variety) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    crop: variety?.crop ?? '',
    name: variety?.name ?? '',
    supplier: variety?.supplier ?? '',
    organic: variety?.organic ?? false,
    pelleted: variety?.pelleted ?? false,
    pelletedApproved: variety?.pelletedApproved ?? false,
    dtm: variety?.dtm?.toString() ?? '',
    density: variety?.density?.toString() ?? '',
    densityUnit: (variety?.densityUnit ?? 'oz') as DensityUnit,
    website: variety?.website ?? '',
    notes: variety?.notes ?? '',
    alreadyOwn: variety?.alreadyOwn ?? false,
  });

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!form.crop.trim() || !form.name.trim()) return;

    const densityVal = form.density ? parseInt(form.density, 10) : undefined;

    const newVariety = createVariety({
      id: variety?.id,
      crop: form.crop.trim(),
      name: form.name.trim(),
      supplier: form.supplier.trim(),
      organic: form.organic,
      pelleted: form.pelleted,
      pelletedApproved: form.pelletedApproved,
      dtm: form.dtm ? parseInt(form.dtm, 10) : undefined,
      density: densityVal && !isNaN(densityVal) ? densityVal : undefined,
      densityUnit: densityVal && !isNaN(densityVal) ? form.densityUnit : undefined,
      website: form.website.trim() || undefined,
      notes: form.notes.trim() || undefined,
      alreadyOwn: form.alreadyOwn,
    });

    onSave(newVariety);
  }, [form, variety?.id, onSave]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: Z_INDEX.MODAL }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-gray-900">
            {variety ? 'Edit Variety' : 'Add Variety'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={form.crop}
              onChange={(e) => setForm({ ...form, crop: e.target.value })}
              className="px-2 py-1.5 border rounded text-sm"
              placeholder="Crop *"
              required
              autoFocus
            />
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="px-2 py-1.5 border rounded text-sm"
              placeholder="Variety *"
              required
            />
            <input
              type="text"
              value={form.supplier}
              onChange={(e) => setForm({ ...form, supplier: e.target.value })}
              className="px-2 py-1.5 border rounded text-sm"
              placeholder="Supplier"
            />
            <input
              type="number"
              value={form.dtm}
              onChange={(e) => setForm({ ...form, dtm: e.target.value })}
              className="px-2 py-1.5 border rounded text-sm"
              placeholder="DTM"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              value={form.density}
              onChange={(e) => setForm({ ...form, density: e.target.value })}
              className="flex-1 px-2 py-1.5 border rounded text-sm"
              placeholder="Seeds per..."
            />
            <select
              value={form.densityUnit}
              onChange={(e) => setForm({ ...form, densityUnit: e.target.value as DensityUnit })}
              className="px-2 py-1.5 border rounded text-sm"
            >
              <option value="oz">per oz</option>
              <option value="g">per g</option>
              <option value="lb">per lb</option>
              <option value="ct">count</option>
            </select>
          </div>
          <input
            type="url"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm"
            placeholder="Website URL"
          />
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.organic} onChange={(e) => setForm({ ...form, organic: e.target.checked })} className="rounded" />
              Organic
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.pelleted} onChange={(e) => setForm({ ...form, pelleted: e.target.checked })} className="rounded" />
              Pelleted
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.alreadyOwn} onChange={(e) => setForm({ ...form, alreadyOwn: e.target.checked })} className="rounded" />
              Owned
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
              Cancel
            </button>
            <button type="submit" disabled={!form.crop.trim() || !form.name.trim()} className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:bg-blue-300">
              {variety ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function VarietiesPage() {

  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [editingVariety, setEditingVariety] = useState<Variety | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCrop, setFilterCrop] = useState<string>('');
  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [filterOrganic, setFilterOrganic] = useState<boolean | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('crop');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Store hooks - now using plan store
  const varieties = usePlanStore((state) => state.currentPlan?.varieties ?? EMPTY_VARIETIES);
  const hasPlan = usePlanStore((state) => state.currentPlan !== null);
  const addVariety = usePlanStore((state) => state.addVariety);
  const updateVariety = usePlanStore((state) => state.updateVariety);
  const deleteVariety = usePlanStore((state) => state.deleteVariety);
  const importVarieties = usePlanStore((state) => state.importVarieties);

  // Initialize store
  useEffect(() => {
    initializePlanStore().then(() => setIsLoaded(true));
  }, []);

  // Compute unique values for filters
  const { uniqueCrops, uniqueSuppliers } = useMemo(() => {
    const crops = new Set<string>();
    const suppliers = new Set<string>();
    Object.values(varieties).forEach((v) => {
      if (v.crop) crops.add(v.crop);
      if (v.supplier) suppliers.add(v.supplier);
    });
    return {
      uniqueCrops: Array.from(crops).sort(),
      uniqueSuppliers: Array.from(suppliers).sort(),
    };
  }, [varieties]);

  // Filter and sort varieties
  const filteredVarieties = useMemo(() => {
    let result = Object.values(varieties);

    if (filterCrop) result = result.filter((v) => v.crop === filterCrop);
    if (filterSupplier) result = result.filter((v) => v.supplier === filterSupplier);
    if (filterOrganic !== null) result = result.filter((v) => v.organic === filterOrganic);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.crop.toLowerCase().includes(q) ||
          v.supplier?.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'crop': cmp = a.crop.localeCompare(b.crop); break;
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'supplier': cmp = (a.supplier || '').localeCompare(b.supplier || ''); break;
        case 'organic': cmp = (a.organic ? 1 : 0) - (b.organic ? 1 : 0); break;
        case 'dtm': cmp = (a.dtm || 0) - (b.dtm || 0); break;
        case 'density': cmp = (a.density || 0) - (b.density || 0); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [varieties, filterCrop, filterSupplier, filterOrganic, searchQuery, sortKey, sortDir]);

  const handleSort = useCallback((key: string) => {
    const typedKey = key as SortKey;
    if (sortKey === typedKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(typedKey);
      setSortDir('asc');
    }
  }, [sortKey]);

  // Handle cell changes from FastEditTable
  const handleCellChange = useCallback(
    async (_rowKey: string, columnKey: string, newValue: string, row: Variety) => {
      if (columnKey === 'density') {
        const val = newValue ? parseInt(newValue, 10) : undefined;
        // When setting density, ensure densityUnit is also set (default to 'oz')
        await updateVariety({
          ...row,
          density: val && !isNaN(val) ? val : undefined,
          densityUnit: val && !isNaN(val) ? (row.densityUnit || 'oz') : undefined,
        });
      } else if (columnKey === 'densityUnit') {
        // Only update unit if there's a density value
        if (row.density) {
          await updateVariety({
            ...row,
            densityUnit: newValue as DensityUnit,
          });
        }
      } else if (columnKey === 'dtm') {
        const val = newValue ? parseInt(newValue, 10) : undefined;
        await updateVariety({
          ...row,
          dtm: val && !isNaN(val) ? val : undefined,
        });
      }
    },
    [updateVariety]
  );

  // Column definitions for FastEditTable
  const columns: ColumnDef<Variety>[] = useMemo(() => [
    {
      key: 'crop',
      header: 'Crop',
      width: 120,
      sortable: true,
      getValue: (v) => v.crop,
    },
    {
      key: 'name',
      header: 'Variety',
      width: 160,
      sortable: true,
      getValue: (v) => v.name,
      render: (v) => (
        <div className="px-2 text-sm font-medium truncate h-full flex items-center" title={v.name}>
          {v.name}
        </div>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      width: 120,
      sortable: true,
      getValue: (v) => v.supplier || '',
    },
    {
      key: 'organic',
      header: 'Org',
      width: 50,
      sortable: true,
      getValue: (v) => v.organic ? 1 : 0,
      render: (v) => (
        <div className="h-full flex items-center justify-center">
          {v.organic && <span className="text-green-600 text-xs">✓</span>}
        </div>
      ),
    },
    {
      key: 'dtm',
      header: 'DTM',
      width: 70,
      sortable: true,
      align: 'right',
      editable: { type: 'number', placeholder: '—' },
      getValue: (v) => v.dtm,
    },
    {
      key: 'density',
      header: 'Density',
      width: 90,
      sortable: true,
      align: 'right',
      editable: { type: 'number', placeholder: '—' },
      getValue: (v) => v.density,
    },
    {
      key: 'densityUnit',
      header: 'Unit',
      width: 60,
      getValue: (v) => v.densityUnit || '',
      render: (v) => (
        <div className="h-full flex items-center">
          <select
            value={v.densityUnit || 'oz'}
            onChange={(e) => {
              if (v.density) {
                updateVariety({ ...v, densityUnit: e.target.value as DensityUnit });
              }
            }}
            disabled={!v.density}
            className={`w-full h-full px-1 text-sm border-0 bg-transparent focus:outline-none focus:bg-blue-50 focus:ring-1 focus:ring-blue-500 rounded ${
              !v.density ? 'text-gray-400' : ''
            }`}
          >
            <option value="oz">oz</option>
            <option value="g">g</option>
            <option value="lb">lb</option>
            <option value="ct">ct</option>
          </select>
        </div>
      ),
    },
    {
      key: 'pelleted',
      header: 'Pell',
      width: 50,
      getValue: (v) => v.pelleted ? 1 : 0,
      render: (v) => (
        <div className="h-full flex items-center justify-center">
          {v.pelleted && <span className="text-purple-600 text-xs">✓</span>}
        </div>
      ),
    },
    {
      key: 'alreadyOwn',
      header: 'Own',
      width: 50,
      getValue: (v) => v.alreadyOwn ? 1 : 0,
      render: (v) => (
        <div className="h-full flex items-center justify-center">
          {v.alreadyOwn && <span className="text-blue-600 text-xs">✓</span>}
        </div>
      ),
    },
    {
      key: 'website',
      header: 'Link',
      width: 60,
      getValue: (v) => v.website || '',
      render: (v) => (
        <div className="h-full flex items-center px-2">
          {v.website && (
            <a href={v.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">
              Link
            </a>
          )}
        </div>
      ),
    },
  ], [updateVariety]);

  const handleSaveVariety = useCallback(
    async (variety: Variety) => {
      if (editingVariety) {
        await updateVariety(variety);
        setToast({ message: 'Updated', type: 'success' });
      } else {
        await addVariety(variety);
        setToast({ message: 'Added', type: 'success' });
      }
      setIsEditorOpen(false);
      setEditingVariety(null);
    },
    [editingVariety, addVariety, updateVariety]
  );

  const handleDeleteVariety = useCallback(
    async (variety: Variety) => {
      if (!confirm(`Delete "${variety.name}"?`)) return;
      await deleteVariety(variety.id);
      setToast({ message: 'Deleted', type: 'info' });
    },
    [deleteVariety]
  );

  const handleLoadStock = useCallback(async () => {
    try {
      const response = await import('@/data/varieties-template.json');
      const varietyList = response.varieties || [];
      const result = await importVarieties(varietyList);
      setToast({ message: `Loaded ${result.added} varieties (${result.updated} updated)`, type: 'success' });
    } catch {
      setToast({ message: 'Failed to load', type: 'error' });
    }
  }, [importVarieties]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setFilterCrop('');
    setFilterSupplier('');
    setFilterOrganic(null);
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

  const varietyCount = Object.keys(varieties).length;
  const hasFilters = searchQuery || filterCrop || filterSupplier || filterOrganic !== null;

  return (
    <>
      <AppHeader />
      <div className="h-[calc(100vh-49px)] bg-gray-50 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-wrap flex-shrink-0">
          <h1 className="text-lg font-semibold text-gray-900">Varieties</h1>
          <span className="text-sm text-gray-500">{filteredVarieties.length}/{varietyCount}</span>

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
          <select
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
            className="px-2 py-1 border rounded text-sm"
          >
            <option value="">All Suppliers</option>
            {uniqueSuppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filterOrganic === null ? '' : filterOrganic ? 'y' : 'n'}
            onChange={(e) => setFilterOrganic(e.target.value === '' ? null : e.target.value === 'y')}
            className="px-2 py-1 border rounded text-sm"
          >
            <option value="">All Types</option>
            <option value="y">Organic</option>
            <option value="n">Conventional</option>
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>
          )}

          <div className="flex-1" />

          <button onClick={handleLoadStock} className="px-3 py-1 text-sm text-gray-700 border rounded hover:bg-gray-50">
            Reset to Stock
          </button>
          <button
            onClick={() => { setEditingVariety(null); setIsEditorOpen(true); }}
            className="px-3 py-1 text-sm text-white bg-blue-600 rounded hover:bg-blue-700"
          >
            + Add
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 bg-white overflow-hidden p-4">
          <div className="h-full border border-gray-200 rounded-lg overflow-hidden">
            <FastEditTable
              data={filteredVarieties}
              rowKey={(v) => v.id}
              columns={columns}
              rowHeight={32}
              headerHeight={36}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              onCellChange={handleCellChange}
              emptyMessage={varietyCount === 0 ? 'No varieties loaded.' : 'No matches'}
              renderActions={(v) => (
                <>
                  <button
                    onClick={() => { setEditingVariety(v); setIsEditorOpen(true); }}
                    className="px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200 rounded"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteVariety(v)}
                    className="px-1 py-0.5 text-xs text-red-600 hover:bg-red-50 rounded"
                  >
                    ×
                  </button>
                </>
              )}
              actionsWidth={70}
            />
          </div>
        </div>

        {isEditorOpen && (
          <VarietyEditor
            variety={editingVariety}
            onSave={handleSaveVariety}
            onClose={() => { setIsEditorOpen(false); setEditingVariety(null); }}
          />
        )}

        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </>
  );
}
