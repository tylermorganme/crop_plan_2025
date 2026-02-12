'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePlanStore, initializePlanStore } from '@/lib/plan-store';
import { createVariety, getSeedsPerGram, type Variety, type DensityUnit } from '@/lib/entities/variety';
import { getEffectiveSeedSource } from '@/lib/entities/planting';
import { Z_INDEX } from '@/lib/z-index';
import AppHeader from '@/components/AppHeader';
import { FastEditTable, ColumnDef } from '@/components/FastEditTable';
import { SearchInput } from '@/components/SearchInput';
import { parseSearchQuery, matchesFilter, type SearchConfig } from '@/lib/search-dsl';
import { varietySearchConfig, getFilterFieldNames, getSortFieldNames } from '@/lib/search-configs';

// Stable empty object reference to avoid SSR hydration issues
const EMPTY_VARIETIES: Record<string, Variety> = {};

type SortKey = 'crop' | 'name' | 'supplier' | 'organic' | 'used' | 'dtm' | 'density' | 'densityPct';
type SortDir = 'asc' | 'desc';

/** Sort fields valid for variety DSL sorting */
const VARIETY_SORT_FIELDS = new Set<string>([
  ...getSortFieldNames(varietySearchConfig),
  'name', 'dtm', 'density', 'densityPct', 'used',
]);

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
  variety: (Variety | Omit<Variety, 'id'>) | null;
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
      id: variety && 'id' in variety ? variety.id : undefined,
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
  }, [form, variety, onSave]);

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

// =============================================================================
// Export / Import Helpers
// =============================================================================

/** Fields exported for LLM handoff — omit internal IDs */
interface ExportVariety {
  crop: string;
  name: string;
  supplier: string;
  organic?: boolean;
  pelleted?: boolean;
  dtm?: number;
  density?: number;
  densityUnit?: string;
  website?: string;
  notes?: string;
  alreadyOwn?: boolean;
}

function varietyToExport(v: Variety): ExportVariety {
  const out: ExportVariety = {
    crop: v.crop,
    name: v.name,
    supplier: v.supplier,
  };
  if (v.organic) out.organic = true;
  if (v.pelleted) out.pelleted = true;
  if (v.dtm) out.dtm = v.dtm;
  if (v.density) out.density = v.density;
  if (v.densityUnit) out.densityUnit = v.densityUnit;
  if (v.website) out.website = v.website;
  if (v.notes) out.notes = v.notes;
  if (v.alreadyOwn) out.alreadyOwn = true;
  return out;
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const TEMPLATE_VARIETIES: ExportVariety[] = [
  {
    crop: 'Tomato',
    name: 'Example Variety',
    supplier: 'Example Supplier',
    organic: true,
    dtm: 75,
    density: 8000,
    densityUnit: 'oz',
    website: 'https://example.com/product',
    notes: 'Optional notes',
  },
  {
    crop: 'Lettuce',
    name: 'Another Variety',
    supplier: 'Another Supplier',
    organic: false,
    pelleted: true,
    density: 1,
    densityUnit: 'ct',
  },
];

// Optional fields that can be toggled for import
const IMPORT_FIELDS = [
  { key: 'organic', label: 'Organic' },
  { key: 'pelleted', label: 'Pelleted' },
  { key: 'dtm', label: 'DTM' },
  { key: 'density', label: 'Density' },
  { key: 'densityUnit', label: 'Density Unit' },
  { key: 'website', label: 'Website' },
  { key: 'notes', label: 'Notes' },
  { key: 'alreadyOwn', label: 'Already Own' },
] as const;

type ImportFieldKey = typeof IMPORT_FIELDS[number]['key'];

// Import Modal
function ImportModal({
  onImport,
  onClose,
}: {
  onImport: (json: string) => Promise<{ added: number; updated: number }>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null);
  const [enabledFields, setEnabledFields] = useState<Set<ImportFieldKey>>(new Set());

  // Detect which optional fields are present in the pasted data
  const detectedFields = useMemo((): Set<ImportFieldKey> => {
    if (!text.trim()) return new Set();
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : parsed.varieties;
      if (!Array.isArray(arr) || arr.length === 0) return new Set();
      const found = new Set<ImportFieldKey>();
      for (const row of arr) {
        for (const { key } of IMPORT_FIELDS) {
          if (row[key] !== undefined) found.add(key);
        }
      }
      return found;
    } catch {
      return new Set();
    }
  }, [text]);

  const toggleField = (key: ImportFieldKey) => {
    setEnabledFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (enabledFields.size === detectedFields.size) {
      setEnabledFields(new Set());
    } else {
      setEnabledFields(new Set(detectedFields));
    }
  };

  const handleImport = async () => {
    setError('');
    setResult(null);
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : parsed.varieties;
      if (!Array.isArray(arr)) {
        setError('Expected a JSON array or an object with a "varieties" array.');
        return;
      }
      for (let i = 0; i < arr.length; i++) {
        if (!arr[i].crop || !arr[i].name || !arr[i].supplier) {
          setError(`Row ${i + 1} is missing required fields (crop, name, supplier).`);
          return;
        }
      }
      // Strip fields that aren't enabled
      const filtered = arr.map((row: Record<string, unknown>) => {
        const out: Record<string, unknown> = {
          crop: row.crop,
          name: row.name,
          supplier: row.supplier,
        };
        for (const key of enabledFields) {
          if (row[key] !== undefined) out[key] = row[key];
        }
        return out;
      });
      const res = await onImport(JSON.stringify(filtered));
      setResult(res);
    } catch (e) {
      setError(e instanceof SyntaxError ? 'Invalid JSON.' : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: Z_INDEX.MODAL }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[80vh]">
        <div className="px-4 py-3 border-b flex justify-between items-center flex-shrink-0">
          <h2 className="font-semibold text-gray-900">Import Varieties</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
        </div>
        <div className="p-4 flex-1 overflow-auto space-y-3">
          <p className="text-sm text-gray-600">
            Paste a JSON array of varieties. Each needs at minimum: <code className="text-xs bg-gray-100 px-1 rounded">crop</code>, <code className="text-xs bg-gray-100 px-1 rounded">name</code>, <code className="text-xs bg-gray-100 px-1 rounded">supplier</code>.
            Matching varieties (same crop+name+supplier) will be updated; new ones added.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-48 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder={'[{"crop": "Tomato", "name": "Gold Nugget", "supplier": "Johnnys", ...}]'}
          />
          {/* Field selection */}
          {detectedFields.size > 0 && (
            <div className="border border-gray-200 rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Fields to update:</span>
                <button onClick={toggleAll} className="text-xs text-blue-600 hover:text-blue-700">
                  {enabledFields.size === detectedFields.size ? 'Select None' : 'Select All'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {IMPORT_FIELDS.map(({ key, label }) => {
                  const present = detectedFields.has(key);
                  if (!present) return null;
                  const enabled = enabledFields.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleField(key)}
                      className={`px-2 py-1 text-xs rounded border transition-colors ${
                        enabled
                          ? 'bg-blue-50 border-blue-300 text-blue-700'
                          : 'bg-gray-50 border-gray-200 text-gray-400'
                      }`}
                    >
                      {enabled ? '✓ ' : ''}{label}
                    </button>
                  );
                })}
              </div>
              {enabledFields.size === 0 && (
                <p className="text-xs text-amber-600">No fields selected — only new varieties will be added, existing ones won't be updated.</p>
              )}
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {result && (
            <p className="text-sm text-green-600">
              Done — {result.added} added, {result.updated} updated.
            </p>
          )}
        </div>
        <div className="px-4 py-3 border-t flex justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={!text.trim() || !detectedFields.size}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:bg-blue-300"
            >
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VarietiesPage() {

  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [editingVariety, setEditingVariety] = useState<Variety | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('crop');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [openInNewWindow, setOpenInNewWindow] = useState(true);
  const [isCloning, setIsCloning] = useState(false);

  // Store hooks - now using plan store
  const varieties = usePlanStore((state) => state.currentPlan?.varieties ?? EMPTY_VARIETIES);
  const plantings = usePlanStore((state) => state.currentPlan?.plantings);
  const specs = usePlanStore((state) => state.currentPlan?.specs);
  const seedMixes = usePlanStore((state) => state.currentPlan?.seedMixes);
  const hasPlan = usePlanStore((state) => state.currentPlan !== null);
  const addVariety = usePlanStore((state) => state.addVariety);
  const updateVariety = usePlanStore((state) => state.updateVariety);
  const deleteVariety = usePlanStore((state) => state.deleteVariety);
  const importVarieties = usePlanStore((state) => state.importVarieties);

  // Initialize store
  useEffect(() => {
    initializePlanStore().then(() => setIsLoaded(true));
  }, []);

  // Build set of variety IDs used by any planting (via seedSource, spec defaultSeedSource, or mix components)
  const usedVarietyIds = useMemo(() => {
    const ids = new Set<string>();
    if (!plantings || !specs) return ids;
    for (const planting of plantings) {
      const spec = specs[planting.specId];
      const source = getEffectiveSeedSource(planting, spec?.defaultSeedSource);
      if (source?.type === 'variety') {
        ids.add(source.id);
      } else if (source?.type === 'mix' && seedMixes) {
        const mix = seedMixes[source.id];
        if (mix) {
          for (const component of mix.components) {
            ids.add(component.varietyId);
          }
        }
      }
    }
    return ids;
  }, [plantings, specs, seedMixes]);

  // Extended search config with 'used' field (depends on plan data)
  const extendedSearchConfig: SearchConfig<Variety> = useMemo(() => ({
    ...varietySearchConfig,
    fields: [
      ...varietySearchConfig.fields,
      {
        name: 'used',
        matchType: 'equals' as const,
        getValue: (v: Variety) => usedVarietyIds.has(v.id),
      },
    ],
  }), [usedVarietyIds]);

  // Parse search query for filter terms and sort directives
  const parsedSearch = useMemo(
    () => parseSearchQuery(searchQuery, VARIETY_SORT_FIELDS),
    [searchQuery]
  );

  // DSL sort overrides column header sort
  const effectiveSortKey = (parsedSearch.sortField as SortKey) ?? sortKey;
  const effectiveSortDir = parsedSearch.sortField ? parsedSearch.sortDir : sortDir;

  // Filter field + sort field names for SearchInput autocomplete
  const filterFieldNames = useMemo(() => getFilterFieldNames(extendedSearchConfig), [extendedSearchConfig]);
  const sortFieldNames = useMemo(() => [...new Set([...getSortFieldNames(extendedSearchConfig), 'name', 'dtm', 'density', 'densityPct', 'used'])], [extendedSearchConfig]);

  // Compute average seeds/gram grouped by crop + pelleted status
  // (pelleted seeds are much less dense, so comparing them to non-pelleted is misleading)
  const cropAvgSeedsPerGram = useMemo(() => {
    const byGroup = new Map<string, number[]>();
    for (const v of Object.values(varieties)) {
      const spg = getSeedsPerGram(v);
      if (spg === undefined) continue;
      const key = `${v.crop}|${v.pelleted ? 'pelleted' : 'raw'}`;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(spg);
    }
    const avgs: Record<string, number> = {};
    for (const [key, values] of byGroup) {
      if (values.length > 0) {
        avgs[key] = values.reduce((a, b) => a + b, 0) / values.length;
      }
    }
    return avgs;
  }, [varieties]);

  // Filter and sort varieties
  const filteredVarieties = useMemo(() => {
    let result = Object.values(varieties);

    // DSL-based filtering
    if (parsedSearch.filterTerms.length > 0) {
      result = result.filter((v) => matchesFilter(v, parsedSearch.filterTerms, extendedSearchConfig));
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (effectiveSortKey) {
        case 'crop': cmp = a.crop.localeCompare(b.crop); break;
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'supplier': cmp = (a.supplier || '').localeCompare(b.supplier || ''); break;
        case 'organic': cmp = (a.organic ? 1 : 0) - (b.organic ? 1 : 0); break;
        case 'used': cmp = (usedVarietyIds.has(a.id) ? 1 : 0) - (usedVarietyIds.has(b.id) ? 1 : 0); break;
        case 'dtm': cmp = (a.dtm || 0) - (b.dtm || 0); break;
        case 'density': cmp = (a.density || 0) - (b.density || 0); break;
        case 'densityPct': {
          const aPct = (() => { const spg = getSeedsPerGram(a); const avg = cropAvgSeedsPerGram[a.crop]; return spg !== undefined && avg ? spg / avg : 0; })();
          const bPct = (() => { const spg = getSeedsPerGram(b); const avg = cropAvgSeedsPerGram[b.crop]; return spg !== undefined && avg ? spg / avg : 0; })();
          cmp = aPct - bPct;
          break;
        }
      }
      return effectiveSortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [varieties, parsedSearch.filterTerms, extendedSearchConfig, effectiveSortKey, effectiveSortDir, usedVarietyIds, cropAvgSeedsPerGram]);

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
        <div
          className="h-full flex items-center justify-center cursor-pointer hover:bg-gray-50"
          onClick={() => updateVariety({ ...v, organic: !v.organic })}
        >
          {v.organic
            ? <span className="text-green-600 text-xs">✓</span>
            : <span className="text-gray-300 text-xs">-</span>}
        </div>
      ),
    },
    {
      key: 'used',
      header: 'Used',
      width: 50,
      sortable: true,
      getValue: (v) => usedVarietyIds.has(v.id) ? 1 : 0,
      render: (v) => (
        <div className="h-full flex items-center justify-center">
          {usedVarietyIds.has(v.id)
            ? <span className="text-green-600 text-xs">✓</span>
            : <span className="text-gray-300 text-xs">-</span>}
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
      key: 'densityPct',
      header: '% Avg',
      width: 70,
      sortable: true,
      align: 'right',
      getValue: (v) => {
        const spg = getSeedsPerGram(v);
        const key = `${v.crop}|${v.pelleted ? 'pelleted' : 'raw'}`;
        const avg = cropAvgSeedsPerGram[key];
        if (spg === undefined || !avg) return null;
        return Math.round((spg / avg) * 100);
      },
      render: (v) => {
        const spg = getSeedsPerGram(v);
        const key = `${v.crop}|${v.pelleted ? 'pelleted' : 'raw'}`;
        const avg = cropAvgSeedsPerGram[key];
        if (spg === undefined || !avg) {
          return <div className="px-2 text-sm text-gray-400 text-right h-full flex items-center justify-end">—</div>;
        }
        const pct = Math.round((spg / avg) * 100);
        const color = pct < 50 || pct > 200 ? 'text-red-600 font-medium' : pct < 75 || pct > 133 ? 'text-amber-600' : 'text-gray-700';
        return (
          <div className={`px-2 text-sm text-right h-full flex items-center justify-end ${color}`} title={`${pct}% of ${v.pelleted ? 'pelleted' : ''} ${v.crop} avg (${Math.round(avg)} seeds/g)`}>
            {pct}%
          </div>
        );
      },
    },
    {
      key: 'pelleted',
      header: 'Pell',
      width: 50,
      getValue: (v) => v.pelleted ? 1 : 0,
      render: (v) => (
        <div
          className="h-full flex items-center justify-center cursor-pointer hover:bg-gray-50"
          onClick={() => updateVariety({ ...v, pelleted: !v.pelleted })}
        >
          {v.pelleted
            ? <span className="text-purple-600 text-xs">✓</span>
            : <span className="text-gray-300 text-xs">-</span>}
        </div>
      ),
    },
    {
      key: 'alreadyOwn',
      header: 'Own',
      width: 50,
      getValue: (v) => v.alreadyOwn ? 1 : 0,
      render: (v) => (
        <div
          className="h-full flex items-center justify-center cursor-pointer hover:bg-gray-50"
          onClick={() => updateVariety({ ...v, alreadyOwn: !v.alreadyOwn })}
        >
          {v.alreadyOwn
            ? <span className="text-blue-600 text-xs">✓</span>
            : <span className="text-gray-300 text-xs">-</span>}
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
            <a
              href={v.website}
              target={openInNewWindow ? '_blank' : '_self'}
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline text-xs"
              onClick={openInNewWindow ? (e) => {
                e.preventDefault();
                window.open(v.website!, '_blank', 'width=1024,height=768');
              } : undefined}
            >
              Link
            </a>
          )}
        </div>
      ),
    },
  ], [updateVariety, usedVarietyIds, openInNewWindow, cropAvgSeedsPerGram]);

  const handleSaveVariety = useCallback(
    async (variety: Variety) => {
      if (editingVariety && !isCloning) {
        await updateVariety(variety);
        setToast({ message: 'Updated', type: 'success' });
      } else {
        await addVariety(variety);
        setToast({ message: isCloning ? 'Cloned' : 'Added', type: 'success' });
      }
      setIsEditorOpen(false);
      setEditingVariety(null);
      setIsCloning(false);
    },
    [editingVariety, isCloning, addVariety, updateVariety]
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

  const handleExportUsed = useCallback(() => {
    const usedVarieties = Object.values(varieties)
      .filter((v) => usedVarietyIds.has(v.id))
      .sort((a, b) => a.crop.localeCompare(b.crop) || a.name.localeCompare(b.name))
      .map(varietyToExport);
    downloadJson(usedVarieties, 'varieties-used.json');
    setToast({ message: `Exported ${usedVarieties.length} used varieties`, type: 'success' });
  }, [varieties, usedVarietyIds]);

  const handleExportFiltered = useCallback(() => {
    const exported = filteredVarieties.map(varietyToExport);
    downloadJson(exported, 'varieties-export.json');
    setToast({ message: `Exported ${exported.length} varieties`, type: 'success' });
  }, [filteredVarieties]);

  const handleDownloadTemplate = useCallback(() => {
    downloadJson(TEMPLATE_VARIETIES, 'varieties-template.json');
  }, []);

  const handleImport = useCallback(async (json: string) => {
    const parsed = JSON.parse(json);
    const arr = Array.isArray(parsed) ? parsed : parsed.varieties;
    const result = await importVarieties(arr);
    setToast({ message: `Imported: ${result.added} added, ${result.updated} updated`, type: 'success' });
    return result;
  }, [importVarieties]);

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

  // For cloning: strip the id so createVariety generates a fresh one
  const editorVariety = isCloning && editingVariety
    ? (() => { const { id: _, ...rest } = editingVariety; return { ...rest, name: `${rest.name} (copy)` }; })()
    : editingVariety;

  return (
    <>
      <AppHeader />
      <div className="h-[calc(100vh-49px)] bg-gray-50 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-wrap flex-shrink-0">
          <h1 className="text-lg font-semibold text-gray-900">Varieties</h1>
          <span className="text-sm text-gray-500">{filteredVarieties.length}/{varietyCount}</span>

          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search varieties..."
            sortFields={sortFieldNames}
            filterFields={filterFieldNames}
            width="w-64"
          />

          <div className="flex-1" />

          <button
            onClick={() => setOpenInNewWindow(v => !v)}
            className={`px-3 py-1 text-sm border rounded ${openInNewWindow ? 'bg-blue-50 border-blue-400 text-blue-700' : 'text-gray-700 border-gray-300 hover:bg-gray-50'}`}
            title={openInNewWindow ? 'Search links open in new window' : 'Search links open in same tab'}
          >
            {openInNewWindow ? '↗ New Window' : '→ Same Tab'}
          </button>

          <button onClick={handleExportUsed} className="px-3 py-1 text-sm text-gray-700 border rounded hover:bg-gray-50" title="Export varieties used in plan as JSON">
            Export Used
          </button>
          <button onClick={handleExportFiltered} className="px-3 py-1 text-sm text-gray-700 border rounded hover:bg-gray-50" title="Export currently filtered varieties as JSON">
            Export Filtered
          </button>
          <button onClick={() => setIsImportOpen(true)} className="px-3 py-1 text-sm text-gray-700 border rounded hover:bg-gray-50" title="Import varieties from JSON">
            Import
          </button>
          <button onClick={handleDownloadTemplate} className="px-3 py-1 text-sm text-gray-700 border rounded hover:bg-gray-50" title="Download JSON template">
            Template
          </button>
          <button onClick={handleLoadStock} className="px-3 py-1 text-sm text-gray-700 border rounded hover:bg-gray-50">
            Reset to Stock
          </button>
          <button
            onClick={() => { setEditingVariety(null); setIsCloning(false); setIsEditorOpen(true); }}
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
              sortKey={effectiveSortKey}
              sortDir={effectiveSortDir}
              onSort={handleSort}
              onCellChange={handleCellChange}
              emptyMessage={varietyCount === 0 ? 'No varieties loaded.' : 'No matches'}
              renderActions={(v) => (
                <>
                  <button
                    onClick={() => {
                      const url = `https://www.google.com/search?q=${encodeURIComponent(`${v.supplier} ${v.crop} ${v.name} seeds`)}`;
                      openInNewWindow ? window.open(url, '_blank', 'width=1024,height=768') : window.open(url, '_self');
                    }}
                    className="px-1 py-0.5 text-xs text-blue-600 hover:bg-blue-50 rounded"
                    title={`Search: ${v.supplier} ${v.crop} ${v.name} seeds`}
                  >
                    🔍
                  </button>
                  <button
                    onClick={() => {
                      const url = `https://www.google.com/search?q=${encodeURIComponent(`organic ${v.crop} ${v.name} seed`)}`;
                      openInNewWindow ? window.open(url, '_blank', 'width=1024,height=768') : window.open(url, '_self');
                    }}
                    className="px-1 py-0.5 text-xs text-green-600 hover:bg-green-50 rounded"
                    title={`Search: organic ${v.crop} ${v.name} seed`}
                  >
                    🌱
                  </button>
                  <button
                    onClick={() => { setEditingVariety(v); setIsCloning(false); setIsEditorOpen(true); }}
                    className="px-1 py-0.5 text-xs text-gray-600 hover:bg-gray-200 rounded"
                    title="Edit variety"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => { setEditingVariety(v); setIsCloning(true); setIsEditorOpen(true); }}
                    className="px-1 py-0.5 text-xs text-gray-600 hover:bg-gray-200 rounded"
                    title="Clone variety"
                  >
                    Clone
                  </button>
                  <button
                    onClick={() => handleDeleteVariety(v)}
                    className="px-1 py-0.5 text-xs text-red-600 hover:bg-red-50 rounded"
                  >
                    ×
                  </button>
                </>
              )}
              actionsWidth={160}
            />
          </div>
        </div>

        {isEditorOpen && (
          <VarietyEditor
            variety={editorVariety}
            onSave={handleSaveVariety}
            onClose={() => { setIsEditorOpen(false); setEditingVariety(null); setIsCloning(false); }}
          />
        )}

        {isImportOpen && (
          <ImportModal
            onImport={handleImport}
            onClose={() => setIsImportOpen(false)}
          />
        )}

        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </>
  );
}
