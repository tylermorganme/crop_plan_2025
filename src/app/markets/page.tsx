'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { usePlanStore, initializePlanStore } from '@/lib/plan-store';
import { type Market } from '@/lib/entities/market';
import { Z_INDEX } from '@/lib/z-index';
import AppHeader from '@/components/AppHeader';

// Stable empty object reference to avoid SSR hydration issues
const EMPTY_MARKETS: Record<string, Market> = {};

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 36;

type SortKey = 'name' | 'displayOrder' | 'active';
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

// Market Editor Modal - simplified, just name
function MarketEditor({
  market,
  onSave,
  onClose,
}: {
  market: Market | null;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(market?.name ?? '');

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim());
  }, [name, onSave]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: Z_INDEX.MODAL }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-gray-900">
            {market ? 'Edit Market' : 'Add Market'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-2 py-1.5 border rounded text-sm"
              placeholder="e.g., Farmers Market"
              required
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:bg-blue-300"
            >
              {market ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MarketsPage() {
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [editingMarket, setEditingMarket] = useState<Market | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('displayOrder');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Store hooks
  const markets = usePlanStore((state) => state.currentPlan?.markets ?? EMPTY_MARKETS);
  const hasPlan = usePlanStore((state) => state.currentPlan !== null);
  const addMarket = usePlanStore((state) => state.addMarket);
  const updateMarket = usePlanStore((state) => state.updateMarket);
  const deactivateMarket = usePlanStore((state) => state.deactivateMarket);
  const reactivateMarket = usePlanStore((state) => state.reactivateMarket);

  // Initialize store
  useEffect(() => {
    initializePlanStore().then(() => setIsLoaded(true));
  }, []);

  // Filter and sort markets
  const filteredMarkets = useMemo(() => {
    let result = Object.values(markets);

    // Filter by active status
    if (!showInactive) {
      result = result.filter(m => m.active);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((m) => m.name.toLowerCase().includes(q));
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'displayOrder': cmp = a.displayOrder - b.displayOrder; break;
        case 'active': cmp = (a.active ? 0 : 1) - (b.active ? 0 : 1); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [markets, showInactive, searchQuery, sortKey, sortDir]);

  // Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: filteredMarkets.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const handleSaveMarket = useCallback(
    async (name: string) => {
      if (editingMarket) {
        await updateMarket(editingMarket.id, { name });
        setToast({ message: 'Market updated', type: 'success' });
      } else {
        await addMarket(name);
        setToast({ message: 'Market added', type: 'success' });
      }
      setIsEditorOpen(false);
      setEditingMarket(null);
    },
    [editingMarket, addMarket, updateMarket]
  );

  const handleToggleActive = useCallback(
    async (market: Market) => {
      if (market.active) {
        await deactivateMarket(market.id);
        setToast({ message: `${market.name} deactivated`, type: 'info' });
      } else {
        await reactivateMarket(market.id);
        setToast({ message: `${market.name} reactivated`, type: 'success' });
      }
    },
    [deactivateMarket, reactivateMarket]
  );

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setShowInactive(false);
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

  const totalCount = Object.keys(markets).length;
  const activeCount = Object.values(markets).filter(m => m.active).length;
  const hasFilters = searchQuery || showInactive;

  return (
    <>
      <AppHeader />
      <div className="h-[calc(100vh-49px)] bg-gray-50 flex flex-col overflow-hidden">
        {/* Toolbar */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-wrap flex-shrink-0">
        <h1 className="text-lg font-semibold text-gray-900">Markets</h1>
        <span className="text-sm text-gray-500">
          {showInactive ? `${filteredMarkets.length}/${totalCount}` : `${activeCount} active`}
        </span>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search..."
          className="px-2 py-1 border rounded text-sm w-40"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show inactive
        </label>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>
        )}

        <div className="flex-1" />

        <button
          onClick={() => { setEditingMarket(null); setIsEditorOpen(true); }}
          className="px-3 py-1 text-sm text-white bg-blue-600 rounded hover:bg-blue-700"
        >
          + Add Market
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 bg-white overflow-hidden flex flex-col">
        {filteredMarkets.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            {totalCount === 0 ? 'No markets configured.' : 'No matches'}
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="bg-gray-100 border-b flex-shrink-0" style={{ height: HEADER_HEIGHT }}>
              <div className="flex items-center h-full px-2">
                <div className="w-64 px-2"><SortHeader label="Name" sortKeyName="name" /></div>
                <div className="w-24 px-2 text-center"><SortHeader label="Order" sortKeyName="displayOrder" /></div>
                <div className="w-24 px-2 text-center"><SortHeader label="Status" sortKeyName="active" /></div>
                <div className="flex-1 px-2"></div>
                <div className="w-32 px-2"></div>
              </div>
            </div>

            {/* Body */}
            <div ref={tableContainerRef} className="flex-1 overflow-auto">
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const m = filteredMarkets[virtualRow.index];
                  return (
                    <div
                      key={m.id}
                      className={`flex items-center border-b border-gray-100 hover:bg-gray-50 group ${
                        !m.active ? 'opacity-60' : ''
                      }`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: ROW_HEIGHT,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <div className="w-64 px-2 text-sm font-medium truncate" title={m.name}>
                        {m.name}
                      </div>
                      <div className="w-24 px-2 text-sm text-gray-600 text-center">
                        {m.displayOrder}
                      </div>
                      <div className="w-24 px-2 text-center">
                        <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                          m.active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {m.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="flex-1 px-2"></div>
                      <div className="w-32 px-2 flex gap-1 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={() => { setEditingMarket(m); setIsEditorOpen(true); }}
                          className="px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleActive(m)}
                          className={`px-2 py-0.5 text-xs rounded ${
                            m.active
                              ? 'text-orange-600 hover:bg-orange-50'
                              : 'text-green-600 hover:bg-green-50'
                          }`}
                        >
                          {m.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {isEditorOpen && (
        <MarketEditor
          market={editingMarket}
          onSave={handleSaveMarket}
          onClose={() => { setIsEditorOpen(false); setEditingMarket(null); }}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
    </>
  );
}
