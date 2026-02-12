'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePlanStore, initializePlanStore } from '@/lib/plan-store';
import { createSeedSearch, getSeedSearchId, isSeedSearchComplete } from '@/lib/entities/seed-search';
import type { SeedSearchRecord } from '@/lib/entities/seed-search';
import type { Variety } from '@/lib/entities/variety';
import { getEffectiveSeedSource } from '@/lib/entities/planting';
import { Z_INDEX } from '@/lib/z-index';
import AppHeader from '@/components/AppHeader';
import { FastEditTable, type ColumnDef } from '@/components/FastEditTable';

// Stable empty refs
const EMPTY_VARIETIES: Record<string, Variety> = {};
const EMPTY_SEED_SEARCHES: Record<string, SeedSearchRecord> = {};

type SortKey = 'crop' | 'varietyName' | 'supplier' | 'dtm' | 'status';
type SortDir = 'asc' | 'desc';

/** Joined row type for FastEditTable display */
interface SeedSearchRow {
  id: string;
  varietyId: string;
  year: number;
  crop: string;
  varietyName: string;
  supplier: string;
  dtm: number | undefined;
  website: string | undefined;
  source1: string;
  source2: string;
  source3: string;
  uniqueQualities: string;
  untreated: boolean;
  untreatedProof: string;
  nonGmo: boolean;
  nonGmoProof: string;
  isComplete: boolean;
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

/** Enriched export row with variety context for readability */
interface ExportRow {
  crop: string;
  varietyName: string;
  supplier: string;
  varietyId: string;
  year: number;
  source1: string;
  source2: string;
  source3: string;
  uniqueQualities: string;
  untreated: boolean;
  untreatedProof: string;
  nonGmo: boolean;
  nonGmoProof: string;
}

// =============================================================================
// Message Template
// =============================================================================

const DEFAULT_SEED_SEARCH_TEMPLATE = `Hi {{company}},

I'm an organic farmer planning my {{year}} season. I'm purchasing the following {{seedCount}} varieties from you and need to confirm whether they are untreated and non-GMO for our NOP/OMRI organic compliance records:

{{seedList}}

I understand that these seeds are not certified organic. If you could confirm the untreated and non-GMO status of these varieties I would really appreciate it.

Thank you!`;

interface CompanySeedEntry {
  crop: string;
  varietyName: string;
  website?: string;
}

function renderSeedSearchMessage(
  template: string,
  company: string,
  year: number,
  seeds: CompanySeedEntry[],
): string {
  const seedList = seeds
    .map((s) => {
      const base = `- ${s.crop}: ${s.varietyName}`;
      return s.website ? `${base} ${s.website}` : base;
    })
    .join('\n');

  return template
    .replace(/\{\{company\}\}/g, company)
    .replace(/\{\{year\}\}/g, String(year))
    .replace(/\{\{seedList\}\}/g, seedList)
    .replace(/\{\{seedCount\}\}/g, String(seeds.length));
}

/** Convert plain text message to HTML with clickable links and proper paragraphs */
function plainTextToHtml(text: string): string {
  return text.split(/\n\n+/).map((para) => {
    let html = para
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(
      /(https?:\/\/[^\s<&]+)/g,
      '<a href="$1">$1</a>',
    );
    html = html.replace(/\n/g, '<br>');
    return `<p>${html}</p>`;
  }).join('');
}

/** Copy message as rich text (HTML with clickable links) */
async function copyRichText(plainText: string): Promise<void> {
  const html = plainTextToHtml(plainText);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      }),
    ]);
  } catch {
    // Fallback: hidden DOM selection
    const el = document.createElement('div');
    el.innerHTML = html;
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand('copy');
    sel?.removeAllRanges();
    document.body.removeChild(el);
  }
}

// =============================================================================
// Source Search Links
// =============================================================================

const SEED_SOURCES = [
  { label: 'J', name: "Johnny's Seeds", url: (q: string) => `https://www.johnnyseeds.com/search/?q=${q}&search-button=&lang=en_US` },
  { label: 'O', name: 'Osborne Seed', url: (q: string) => `https://www.osborneseed.com/search?q=${q}` },
  { label: 'HM', name: 'High Mowing Seeds', url: (q: string) => `https://www.highmowingseeds.com/catalogsearch/result/?q=${q}` },
] as const;

function buildSearchQuery(crop: string, varietyName: string): string {
  return encodeURIComponent(`${varietyName} ${crop}`).replace(/%20/g, '+');
}

// =============================================================================
// Company Message Dropdown
// =============================================================================

interface CompanyEntry {
  displayName: string;
  seeds: CompanySeedEntry[];
}

function CompanyMessageDropdown({
  companies,
  year,
  template,
  onEditTemplate,
  onToast,
}: {
  companies: CompanyEntry[];
  year: number;
  template: string;
  onEditTemplate: () => void;
  onToast: (msg: string, type: 'error' | 'success' | 'info') => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCompanyClick = async (company: CompanyEntry) => {
    const message = renderSeedSearchMessage(template, company.displayName, year, company.seeds);
    await copyRichText(message);
    onToast(`Copied message for ${company.displayName} (${company.seeds.length} seeds)`, 'success');
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={companies.length === 0}
        className="px-3 py-1 text-sm text-gray-700 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Confirm untreated/non-GMO status with a supplier"
      >
        Message Supplier
      </button>

      {isOpen && (
        <div
          className="absolute left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 max-h-80 overflow-auto"
          style={{ zIndex: Z_INDEX.DROPDOWN }}
        >
          <div className="py-1">
            {companies.map((company) => (
              <button
                key={company.displayName}
                onClick={() => handleCompanyClick(company)}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex justify-between items-center"
              >
                <span className="text-gray-900">{company.displayName}</span>
                <span className="text-xs text-gray-400">{company.seeds.length}</span>
              </button>
            ))}
          </div>
          <div className="border-t">
            <button
              onClick={() => { onEditTemplate(); setIsOpen(false); }}
              className="w-full px-4 py-2 text-left text-sm text-blue-600 hover:bg-blue-50"
            >
              Edit Template...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Template Editor Modal
// =============================================================================

function TemplateEditorModal({
  template,
  onSave,
  onClose,
}: {
  template: string;
  onSave: (template: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(template);

  const preview = useMemo(() => {
    const sampleSeeds: CompanySeedEntry[] = [
      { crop: 'Tomato', varietyName: 'Sungold F1', website: 'https://johnnyseeds.com/sungold' },
      { crop: 'Turnip', varietyName: 'Hakurei', website: 'https://johnnyseeds.com/hakurei' },
      { crop: 'Lettuce', varietyName: 'Salanova Mix', website: 'https://johnnyseeds.com/salanova' },
    ];
    return renderSeedSearchMessage(text, "Johnny's Selected Seeds", 2025, sampleSeeds);
  }, [text]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: Z_INDEX.MODAL }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[80vh]">
        <div className="px-4 py-3 border-b flex justify-between items-center flex-shrink-0">
          <h2 className="font-semibold text-gray-900">Edit Message Template</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
        </div>
        <div className="p-4 flex-1 overflow-auto space-y-3">
          <p className="text-sm text-gray-600">
            Available variables:{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">{'{{company}}'}</code>{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">{'{{year}}'}</code>{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">{'{{seedList}}'}</code>{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">{'{{seedCount}}'}</code>
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-40 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <div>
            <div className="text-xs text-gray-500 mb-1">Preview:</div>
            <pre className="text-sm bg-gray-50 p-3 rounded-md whitespace-pre-wrap border text-gray-700">
              {preview}
            </pre>
          </div>
        </div>
        <div className="px-4 py-3 border-t flex justify-between flex-shrink-0">
          <button
            onClick={() => setText(DEFAULT_SEED_SEARCH_TEMPLATE)}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
          >
            Reset to Default
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
              Cancel
            </button>
            <button
              onClick={() => { onSave(text); onClose(); }}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700"
            >
              Save Template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Import Modal
function ImportModal({
  onImport,
  onClose,
}: {
  onImport: (json: string) => Promise<{ updated: number }>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ updated: number } | null>(null);

  const handleImport = async () => {
    setError('');
    setResult(null);
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : parsed.seedSearches;
      if (!Array.isArray(arr)) {
        setError('Expected a JSON array or an object with a "seedSearches" array.');
        return;
      }
      for (let i = 0; i < arr.length; i++) {
        if (!arr[i].varietyId || !arr[i].year) {
          setError(`Row ${i + 1} is missing required fields (varietyId, year).`);
          return;
        }
      }
      const res = await onImport(JSON.stringify(arr));
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
          <h2 className="font-semibold text-gray-900">Import Seed Search Records</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
        </div>
        <div className="p-4 flex-1 overflow-auto space-y-3">
          <p className="text-sm text-gray-600">
            Paste a JSON array of seed search records. Each needs at minimum: <code className="text-xs bg-gray-100 px-1 rounded">varietyId</code>, <code className="text-xs bg-gray-100 px-1 rounded">year</code>.
            Records with the same varietyId+year will be upserted (merged).
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-48 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
            placeholder={'[{"varietyId": "V_tomato|sungold|johnnys", "year": 2025, "source1": "...", ...}]'}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {result && (
            <p className="text-sm text-green-600">
              Done — {result.updated} records upserted.
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
              disabled={!text.trim()}
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

export default function SeedSearchPage() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('crop');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [openInNewWindow, setOpenInNewWindow] = useState(true);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isTemplateEditorOpen, setIsTemplateEditorOpen] = useState(false);

  // Store hooks
  const varieties = usePlanStore((s) => s.currentPlan?.varieties ?? EMPTY_VARIETIES);
  const plantings = usePlanStore((s) => s.currentPlan?.plantings);
  const specs = usePlanStore((s) => s.currentPlan?.specs);
  const seedMixes = usePlanStore((s) => s.currentPlan?.seedMixes);
  const seedSearches = usePlanStore((s) => s.currentPlan?.seedSearches ?? EMPTY_SEED_SEARCHES);
  const planYear = usePlanStore((s) => s.currentPlan?.metadata.year);
  const hasPlan = usePlanStore((s) => s.currentPlan !== null);
  const updateSeedSearch = usePlanStore((s) => s.updateSeedSearch);
  const bulkUpdateSeedSearches = usePlanStore((s) => s.bulkUpdateSeedSearches);
  const seedSearchMessageTemplate = usePlanStore((s) => s.currentPlan?.seedSearchMessageTemplate);
  const updateSeedSearchMessageTemplate = usePlanStore((s) => s.updateSeedSearchMessageTemplate);

  // Track whether we've already auto-created stubs for this year to avoid re-triggering
  const stubsCreatedForYear = useRef<number | null>(null);

  useEffect(() => {
    initializePlanStore().then(() => setIsLoaded(true));
  }, []);

  // Default to plan year once loaded
  useEffect(() => {
    if (planYear && selectedYear === null) {
      setSelectedYear(planYear);
    }
  }, [planYear, selectedYear]);

  const effectiveYear = selectedYear ?? planYear ?? new Date().getFullYear();

  // Build set of non-organic variety IDs used in plantings
  const nonOrganicUsedVarietyIds = useMemo(() => {
    const ids = new Set<string>();
    if (!plantings || !specs) return ids;
    for (const planting of plantings) {
      const spec = specs[planting.specId];
      const source = getEffectiveSeedSource(planting, spec?.defaultSeedSource);
      if (source?.type === 'variety') {
        const v = varieties[source.id];
        if (v && !v.organic) ids.add(source.id);
      } else if (source?.type === 'mix' && seedMixes) {
        const mix = seedMixes[source.id];
        if (mix) {
          for (const comp of mix.components) {
            const v = varieties[comp.varietyId];
            if (v && !v.organic) ids.add(comp.varietyId);
          }
        }
      }
    }
    return ids;
  }, [plantings, specs, seedMixes, varieties]);

  // Auto-create stubs for missing records
  useEffect(() => {
    if (!isLoaded || nonOrganicUsedVarietyIds.size === 0) return;
    if (stubsCreatedForYear.current === effectiveYear) return;

    const missing: SeedSearchRecord[] = [];
    for (const vid of nonOrganicUsedVarietyIds) {
      const id = getSeedSearchId(vid, effectiveYear);
      if (!seedSearches[id]) {
        missing.push(createSeedSearch({ varietyId: vid, year: effectiveYear }));
      }
    }
    if (missing.length > 0) {
      bulkUpdateSeedSearches(missing);
    }
    stubsCreatedForYear.current = effectiveYear;
  }, [isLoaded, nonOrganicUsedVarietyIds, effectiveYear, seedSearches, bulkUpdateSeedSearches]);

  // Build display rows by joining variety data with seed search records
  const rows: SeedSearchRow[] = useMemo(() => {
    const result: SeedSearchRow[] = [];
    for (const vid of nonOrganicUsedVarietyIds) {
      const variety = varieties[vid];
      if (!variety) continue;
      const searchId = getSeedSearchId(vid, effectiveYear);
      const record = seedSearches[searchId];
      result.push({
        id: searchId,
        varietyId: vid,
        year: effectiveYear,
        crop: variety.crop,
        varietyName: variety.name,
        supplier: variety.supplier,
        dtm: variety.dtm,
        website: variety.website,
        source1: record?.source1 ?? '',
        source2: record?.source2 ?? '',
        source3: record?.source3 ?? '',
        uniqueQualities: record?.uniqueQualities ?? '',
        untreated: record?.untreated ?? false,
        untreatedProof: record?.untreatedProof ?? '',
        nonGmo: record?.nonGmo ?? false,
        nonGmoProof: record?.nonGmoProof ?? '',
        isComplete: record ? isSeedSearchComplete(record) : false,
      });
    }
    return result;
  }, [nonOrganicUsedVarietyIds, varieties, seedSearches, effectiveYear]);

  // Sort rows
  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'crop':
          cmp = a.crop.localeCompare(b.crop) || a.varietyName.localeCompare(b.varietyName);
          break;
        case 'varietyName':
          cmp = a.varietyName.localeCompare(b.varietyName);
          break;
        case 'supplier':
          cmp = a.supplier.localeCompare(b.supplier);
          break;
        case 'dtm':
          cmp = (a.dtm ?? 999) - (b.dtm ?? 999);
          break;
        case 'status':
          cmp = (a.isComplete ? 1 : 0) - (b.isComplete ? 1 : 0);
          break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [rows, sortKey, sortDir]);

  // Year options: plan year + any other years present in seed search records
  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    if (planYear) years.add(planYear);
    for (const record of Object.values(seedSearches)) {
      years.add(record.year);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [planYear, seedSearches]);

  // Completion stats
  const completedCount = rows.filter((r) => r.isComplete).length;
  const totalCount = rows.length;

  // Group by supplier — only include seeds where untreated or nonGmo is unconfirmed
  const companyList: CompanyEntry[] = useMemo(() => {
    const bySupplier = new Map<string, { display: string; seeds: CompanySeedEntry[] }>();
    for (const row of rows) {
      const supplier = row.supplier.trim();
      if (!supplier) continue;
      // Only include seeds that still need confirmation
      if (row.untreated && row.nonGmo) continue;
      const key = supplier.toLowerCase();
      if (!bySupplier.has(key)) {
        bySupplier.set(key, { display: supplier, seeds: [] });
      }
      bySupplier.get(key)!.seeds.push({
        crop: row.crop,
        varietyName: row.varietyName,
        website: row.website,
      });
    }
    return Array.from(bySupplier.values())
      .sort((a, b) => a.display.localeCompare(b.display))
      .map((entry) => ({ displayName: entry.display, seeds: entry.seeds }));
  }, [rows]);

  const handleSaveTemplate = useCallback((template: string) => {
    updateSeedSearchMessageTemplate(template);
    setToast({ message: 'Message template saved', type: 'success' });
  }, [updateSeedSearchMessageTemplate]);

  const handleSort = useCallback((key: string) => {
    const typedKey = key as SortKey;
    if (sortKey === typedKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(typedKey);
      setSortDir('asc');
    }
  }, [sortKey]);

  const handleCellChange = useCallback(
    async (_rowKey: string, columnKey: string, newValue: string, row: SeedSearchRow) => {
      const searchId = row.id;
      const existing = seedSearches[searchId];
      // Build record from existing or create fresh
      const record: SeedSearchRecord = existing
        ? { ...existing, [columnKey]: newValue }
        : {
            ...createSeedSearch({ varietyId: row.varietyId, year: row.year }),
            [columnKey]: newValue,
          };
      await updateSeedSearch(record);
    },
    [seedSearches, updateSeedSearch]
  );

  const toggleBoolField = useCallback(
    async (row: SeedSearchRow, field: 'untreated' | 'nonGmo') => {
      const searchId = row.id;
      const existing = seedSearches[searchId];
      const record: SeedSearchRecord = existing
        ? { ...existing, [field]: !existing[field] }
        : {
            ...createSeedSearch({ varietyId: row.varietyId, year: row.year }),
            [field]: true,
          };
      await updateSeedSearch(record);
    },
    [seedSearches, updateSeedSearch]
  );

  const buildExportRows = useCallback((): ExportRow[] => {
    return sortedRows.map((r) => ({
      crop: r.crop,
      varietyName: r.varietyName,
      supplier: r.supplier,
      varietyId: r.varietyId,
      year: r.year,
      source1: r.source1,
      source2: r.source2,
      source3: r.source3,
      uniqueQualities: r.uniqueQualities,
      untreated: r.untreated,
      untreatedProof: r.untreatedProof,
      nonGmo: r.nonGmo,
      nonGmoProof: r.nonGmoProof,
    }));
  }, [sortedRows]);

  const handleExport = useCallback(() => {
    const exported = buildExportRows();
    downloadJson(exported, `seed-search-${effectiveYear}.json`);
    setToast({ message: `Exported ${exported.length} records`, type: 'success' });
  }, [buildExportRows, effectiveYear]);

  const handleCopyToClipboard = useCallback(async () => {
    const exported = buildExportRows();
    await navigator.clipboard.writeText(JSON.stringify(exported, null, 2));
    setToast({ message: `Copied ${exported.length} records to clipboard`, type: 'success' });
  }, [buildExportRows]);

  const handleImport = useCallback(async (json: string): Promise<{ updated: number }> => {
    const arr = JSON.parse(json) as Record<string, unknown>[];
    const records: SeedSearchRecord[] = arr.map((raw) => {
      const varietyId = String(raw.varietyId);
      const year = Number(raw.year);
      const id = getSeedSearchId(varietyId, year);
      // Merge with existing record if present
      const existing = seedSearches[id];
      return {
        id,
        varietyId,
        year,
        source1: String(raw.source1 ?? existing?.source1 ?? ''),
        source2: String(raw.source2 ?? existing?.source2 ?? ''),
        source3: String(raw.source3 ?? existing?.source3 ?? ''),
        uniqueQualities: String(raw.uniqueQualities ?? existing?.uniqueQualities ?? ''),
        untreated: typeof raw.untreated === 'boolean' ? raw.untreated : (existing?.untreated ?? false),
        untreatedProof: String(raw.untreatedProof ?? existing?.untreatedProof ?? ''),
        nonGmo: typeof raw.nonGmo === 'boolean' ? raw.nonGmo : (existing?.nonGmo ?? false),
        nonGmoProof: String(raw.nonGmoProof ?? existing?.nonGmoProof ?? ''),
      };
    });
    await bulkUpdateSeedSearches(records);
    setToast({ message: `Imported ${records.length} records`, type: 'success' });
    return { updated: records.length };
  }, [seedSearches, bulkUpdateSeedSearches]);

  const handleFillSources = useCallback(async (row: SeedSearchRow) => {
    const existing = seedSearches[row.id];
    if (existing?.source1 && existing?.source2 && existing?.source3) return;
    const record: SeedSearchRecord = {
      ...(existing ?? createSeedSearch({ varietyId: row.varietyId, year: row.year })),
      source1: existing?.source1 || "Johnny's Selected Seeds",
      source2: existing?.source2 || 'High Mowing Organic Seeds',
      source3: existing?.source3 || 'Osborne Seed',
    };
    await updateSeedSearch(record);
  }, [seedSearches, updateSeedSearch]);

  // Column definitions
  const columns: ColumnDef<SeedSearchRow>[] = useMemo(() => [
    {
      key: 'crop',
      header: 'Crop',
      width: 100,
      sortable: true,
      sticky: true,
      getValue: (r) => r.crop,
    },
    {
      key: 'varietyName',
      header: 'Variety',
      width: 160,
      sortable: true,
      sticky: true,
      getValue: (r) => r.varietyName,
      render: (r) => (
        <div className="px-2 text-sm font-medium truncate h-full flex items-center" title={r.varietyName}>
          {r.varietyName}
        </div>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      width: 120,
      sortable: true,
      sticky: true,
      getValue: (r) => r.supplier,
    },
    {
      key: 'dtm',
      header: 'DTM',
      width: 60,
      sortable: true,
      align: 'right' as const,
      getValue: (r) => r.dtm,
      render: (r) => (
        <div className="px-2 text-sm text-right h-full flex items-center justify-end text-gray-500">
          {r.dtm ?? '—'}
        </div>
      ),
    },
    {
      key: 'source1',
      header: 'Source 1',
      width: 180,
      editable: { type: 'text', placeholder: '—' },
      getValue: (r) => r.source1,
    },
    {
      key: 'source2',
      header: 'Source 2',
      width: 180,
      editable: { type: 'text', placeholder: '—' },
      getValue: (r) => r.source2,
    },
    {
      key: 'source3',
      header: 'Source 3',
      width: 180,
      editable: { type: 'text', placeholder: '—' },
      getValue: (r) => r.source3,
    },
    {
      key: 'uniqueQualities',
      header: 'Unique Qualities',
      width: 220,
      editable: { type: 'text', placeholder: '—' },
      getValue: (r) => r.uniqueQualities,
    },
    {
      key: 'untreated',
      header: 'UT',
      width: 40,
      getValue: (r) => r.untreated ? 1 : 0,
      render: (r) => (
        <div
          className="h-full flex items-center justify-center cursor-pointer hover:bg-gray-50"
          onClick={() => toggleBoolField(r, 'untreated')}
          title="Untreated"
        >
          {r.untreated
            ? <span className="text-green-600 text-xs">✓</span>
            : <span className="text-gray-300 text-xs">-</span>}
        </div>
      ),
    },
    {
      key: 'untreatedProof',
      header: 'UT Proof',
      width: 160,
      editable: { type: 'text', placeholder: '—' },
      getValue: (r) => r.untreatedProof,
    },
    {
      key: 'nonGmo',
      header: 'NGM',
      width: 40,
      getValue: (r) => r.nonGmo ? 1 : 0,
      render: (r) => (
        <div
          className="h-full flex items-center justify-center cursor-pointer hover:bg-gray-50"
          onClick={() => toggleBoolField(r, 'nonGmo')}
          title="Non-GMO"
        >
          {r.nonGmo
            ? <span className="text-green-600 text-xs">✓</span>
            : <span className="text-gray-300 text-xs">-</span>}
        </div>
      ),
    },
    {
      key: 'nonGmoProof',
      header: 'NGM Proof',
      width: 160,
      editable: { type: 'text', placeholder: '—' },
      getValue: (r) => r.nonGmoProof,
    },
    {
      key: 'status',
      header: '✓',
      width: 40,
      sortable: true,
      getValue: (r) => r.isComplete ? 1 : 0,
      render: (r) => (
        <div className="h-full flex items-center justify-center">
          {r.isComplete
            ? <span className="text-green-600 text-xs">✓</span>
            : <span className="text-gray-300 text-xs">-</span>}
        </div>
      ),
    },
  ], [openInNewWindow, toggleBoolField]);

  // Loading / no plan states
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

  return (
    <>
      <AppHeader />
      <div className="h-[calc(100vh-49px)] bg-gray-50 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-wrap flex-shrink-0">
          <h1 className="text-lg font-semibold text-gray-900">Seed Search</h1>
          <span className="text-sm text-gray-500">
            {completedCount}/{totalCount} complete
          </span>

          <select
            value={effectiveYear}
            onChange={(e) => {
              setSelectedYear(Number(e.target.value));
              stubsCreatedForYear.current = null;
            }}
            className="px-2 py-1 text-sm border border-gray-300 rounded-md"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          <CompanyMessageDropdown
            companies={companyList}
            year={effectiveYear}
            template={seedSearchMessageTemplate ?? DEFAULT_SEED_SEARCH_TEMPLATE}
            onEditTemplate={() => setIsTemplateEditorOpen(true)}
            onToast={(msg, type) => setToast({ message: msg, type })}
          />

          <div className="flex-1" />

          <button onClick={handleCopyToClipboard} className="px-3 py-1 text-sm text-gray-700 border rounded hover:bg-gray-50" title="Copy seed search records to clipboard">
            Copy
          </button>
          <button onClick={handleExport} className="px-3 py-1 text-sm text-gray-700 border rounded hover:bg-gray-50" title="Export seed search records as JSON file">
            Export
          </button>
          <button onClick={() => setIsImportOpen(true)} className="px-3 py-1 text-sm text-gray-700 border rounded hover:bg-gray-50" title="Import seed search records from JSON">
            Import
          </button>

          <button
            onClick={() => setOpenInNewWindow(v => !v)}
            className={`px-3 py-1 text-sm border rounded ${openInNewWindow ? 'bg-blue-50 border-blue-400 text-blue-700' : 'text-gray-700 border-gray-300 hover:bg-gray-50'}`}
            title={openInNewWindow ? 'Search links open in new window' : 'Search links open in same tab'}
          >
            {openInNewWindow ? '↗ New Window' : '→ Same Tab'}
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 bg-white overflow-hidden p-4">
          <div className="h-full border border-gray-200 rounded-lg overflow-hidden">
            <FastEditTable
              data={sortedRows}
              rowKey={(r) => r.id}
              columns={columns}
              rowHeight={32}
              headerHeight={36}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              onCellChange={handleCellChange}
              emptyMessage={totalCount === 0 ? 'No non-organic varieties in use.' : 'No matches'}
              renderActions={(r) => {
                const q = buildSearchQuery(r.crop, r.varietyName);
                const open = (url: string) => openInNewWindow
                  ? window.open(url, '_blank', 'width=1024,height=768')
                  : window.open(url, '_self');
                return (
                  <>
                    {r.website ? (
                      <a
                        href={r.website}
                        target={openInNewWindow ? '_blank' : '_self'}
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          if (openInNewWindow) {
                            e.preventDefault();
                            window.open(r.website!, '_blank', 'width=1024,height=768');
                          }
                        }}
                        className="px-1 py-0.5 text-xs text-blue-600 hover:bg-blue-50 rounded"
                        title={r.website}
                      >
                        🔗
                      </a>
                    ) : (
                      <span className="px-1 py-0.5 text-xs text-gray-300">—</span>
                    )}
                    <button
                      onClick={() => open(`https://www.google.com/search?q=${encodeURIComponent(`organic ${r.crop} ${r.varietyName} seed`)}`)}
                      className="px-1 py-0.5 text-xs text-green-600 hover:bg-green-50 rounded"
                      title={`Google: organic ${r.crop} ${r.varietyName} seed`}
                    >
                      🌱
                    </button>
                    {SEED_SOURCES.map((src) => (
                      <button
                        key={src.label}
                        onClick={() => open(src.url(q))}
                        className="px-1 py-0.5 text-xs font-medium text-purple-600 hover:bg-purple-50 rounded"
                        title={`Search ${src.name}: ${r.varietyName} ${r.crop}`}
                      >
                        {src.label}
                      </button>
                    ))}
                    {!r.isComplete && (
                      <button
                        onClick={() => handleFillSources(r)}
                        className="px-1 py-0.5 text-xs font-medium text-orange-600 hover:bg-orange-50 rounded"
                        title="Fill sources with Johnny's, High Mowing, Osborne"
                      >
                        Fill
                      </button>
                    )}
                  </>
                );
              }}
              actionsWidth={160}
            />
          </div>
        </div>
      </div>

      {isImportOpen && (
        <ImportModal
          onImport={handleImport}
          onClose={() => setIsImportOpen(false)}
        />
      )}

      {isTemplateEditorOpen && (
        <TemplateEditorModal
          template={seedSearchMessageTemplate ?? DEFAULT_SEED_SEARCH_TEMPLATE}
          onSave={handleSaveTemplate}
          onClose={() => setIsTemplateEditorOpen(false)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
