'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { usePlanStore, initializePlanStore } from '@/lib/plan-store';
import { createProduct, type Product, type CreateProductInput } from '@/lib/entities/product';
import { getActiveMarkets, type Market } from '@/lib/entities/market';
import { Z_INDEX } from '@/lib/z-index';

// Stable empty object reference to avoid SSR hydration issues
const EMPTY_PRODUCTS: Record<string, Product> = {};
const EMPTY_MARKETS: Record<string, Market> = {};

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 36;

type SortKey = 'crop' | 'product' | 'unit' | string; // string for dynamic market IDs
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

// Product Editor Modal with dynamic market prices
function ProductEditor({
  product,
  markets,
  onSave,
  onClose,
}: {
  product: Product | null;
  markets: Market[];
  onSave: (product: Product) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    crop: product?.crop ?? '',
    product: product?.product ?? '',
    unit: product?.unit ?? '',
    prices: product?.prices ?? {} as Record<string, string>,
  });

  // Initialize price form with string values
  const [priceStrings, setPriceStrings] = useState<Record<string, string>>(() => {
    const result: Record<string, string> = {};
    for (const market of markets) {
      result[market.id] = product?.prices?.[market.id]?.toString() ?? '';
    }
    return result;
  });

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!form.crop.trim() || !form.product.trim() || !form.unit.trim()) return;

    // Convert price strings to numbers
    const prices: Record<string, number> = {};
    for (const [marketId, priceStr] of Object.entries(priceStrings)) {
      const price = parseFloat(priceStr);
      if (!isNaN(price) && price > 0) {
        prices[marketId] = price;
      }
    }

    const newProduct = createProduct({
      crop: form.crop.trim(),
      product: form.product.trim(),
      unit: form.unit.trim(),
      prices,
    });

    onSave(newProduct);
  }, [form, priceStrings, onSave]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: Z_INDEX.MODAL }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-gray-900">
            {product ? 'Edit Product' : 'Add Product'}
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
              value={form.product}
              onChange={(e) => setForm({ ...form, product: e.target.value })}
              className="px-2 py-1.5 border rounded text-sm"
              placeholder="Product *"
              required
            />
            <input
              type="text"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              className="px-2 py-1.5 border rounded text-sm"
              placeholder="Unit *"
              required
            />
          </div>
          <div className="border-t pt-3">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Prices by Market</h3>
            <div className="grid grid-cols-2 gap-3">
              {markets.map((market) => (
                <div key={market.id}>
                  <label className="block text-xs text-gray-500 mb-1">{market.name} ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceStrings[market.id] ?? ''}
                    onChange={(e) => setPriceStrings({ ...priceStrings, [market.id]: e.target.value })}
                    className="w-full px-2 py-1.5 border rounded text-sm"
                    placeholder="0.00"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!form.crop.trim() || !form.product.trim() || !form.unit.trim()}
              className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:bg-blue-300"
            >
              {product ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCrop, setFilterCrop] = useState<string>('');
  const [filterUnit, setFilterUnit] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('crop');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Store hooks - using plan store
  const products = usePlanStore((state) => state.currentPlan?.products ?? EMPTY_PRODUCTS);
  const marketsRecord = usePlanStore((state) => state.currentPlan?.markets ?? EMPTY_MARKETS);
  const hasPlan = usePlanStore((state) => state.currentPlan !== null);
  const addProduct = usePlanStore((state) => state.addProduct);
  const updateProduct = usePlanStore((state) => state.updateProduct);
  const deleteProduct = usePlanStore((state) => state.deleteProduct);
  const importProducts = usePlanStore((state) => state.importProducts);

  // Get active markets sorted by display order
  const activeMarkets = useMemo(() => getActiveMarkets(marketsRecord), [marketsRecord]);

  // Initialize store
  useEffect(() => {
    initializePlanStore().then(() => setIsLoaded(true));
  }, []);

  // Compute unique values for filters
  const { uniqueCrops, uniqueUnits } = useMemo(() => {
    const crops = new Set<string>();
    const units = new Set<string>();
    Object.values(products).forEach((p) => {
      if (p.crop) crops.add(p.crop);
      if (p.unit) units.add(p.unit);
    });
    return {
      uniqueCrops: Array.from(crops).sort(),
      uniqueUnits: Array.from(units).sort(),
    };
  }, [products]);

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    let result = Object.values(products);

    if (filterCrop) result = result.filter((p) => p.crop === filterCrop);
    if (filterUnit) result = result.filter((p) => p.unit === filterUnit);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.product.toLowerCase().includes(q) ||
          p.crop.toLowerCase().includes(q) ||
          p.unit.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'crop': cmp = a.crop.localeCompare(b.crop); break;
        case 'product': cmp = a.product.localeCompare(b.product); break;
        case 'unit': cmp = a.unit.localeCompare(b.unit); break;
        default:
          // Sort by market price (sortKey is market ID)
          cmp = (a.prices?.[sortKey] || 0) - (b.prices?.[sortKey] || 0);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [products, filterCrop, filterUnit, searchQuery, sortKey, sortDir]);

  // Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: filteredProducts.length,
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

  const handleSaveProduct = useCallback(
    async (product: Product) => {
      if (editingProduct) {
        await updateProduct(product);
        setToast({ message: 'Updated', type: 'success' });
      } else {
        await addProduct(product);
        setToast({ message: 'Added', type: 'success' });
      }
      setIsEditorOpen(false);
      setEditingProduct(null);
    },
    [editingProduct, addProduct, updateProduct]
  );

  const handleDeleteProduct = useCallback(
    async (product: Product) => {
      if (!confirm(`Delete "${product.crop} - ${product.product}"?`)) return;
      await deleteProduct(product.id);
      setToast({ message: 'Deleted', type: 'info' });
    },
    [deleteProduct]
  );

  const handleLoadStock = useCallback(async () => {
    try {
      const response = await import('@/data/products.json');
      const productList = (response.default || []) as CreateProductInput[];
      const result = await importProducts(productList);
      setToast({ message: `Loaded ${result.added} products (${result.updated} updated)`, type: 'success' });
    } catch {
      setToast({ message: 'Failed to load', type: 'error' });
    }
  }, [importProducts]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setFilterCrop('');
    setFilterUnit('');
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

  // Format price for display
  const formatPrice = (price: number | undefined): string => {
    if (price === undefined || price === null) return '-';
    return `$${price.toFixed(2)}`;
  };

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

  const productCount = Object.keys(products).length;
  const hasFilters = searchQuery || filterCrop || filterUnit;

  return (
    <div className="h-[calc(100vh-49px)] bg-gray-50 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-wrap flex-shrink-0">
        <h1 className="text-lg font-semibold text-gray-900">Products</h1>
        <span className="text-sm text-gray-500">{filteredProducts.length}/{productCount}</span>

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
          value={filterUnit}
          onChange={(e) => setFilterUnit(e.target.value)}
          className="px-2 py-1 border rounded text-sm"
        >
          <option value="">All Units</option>
          {uniqueUnits.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>
        )}

        <div className="flex-1" />

        <button onClick={handleLoadStock} className="px-3 py-1 text-sm text-gray-700 border rounded hover:bg-gray-50">
          Reset to Stock
        </button>
        <button
          onClick={() => { setEditingProduct(null); setIsEditorOpen(true); }}
          className="px-3 py-1 text-sm text-white bg-blue-600 rounded hover:bg-blue-700"
        >
          + Add
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 bg-white overflow-hidden flex flex-col">
        {filteredProducts.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            {productCount === 0 ? 'No products loaded.' : 'No matches'}
          </div>
        ) : (
          <>
            {/* Header - fixed, doesn't scroll */}
            <div className="bg-gray-100 border-b flex-shrink-0" style={{ height: HEADER_HEIGHT }}>
              <div className="flex items-center h-full px-2">
                <div className="w-40 px-2"><SortHeader label="Crop" sortKeyName="crop" /></div>
                <div className="w-48 px-2"><SortHeader label="Product" sortKeyName="product" /></div>
                <div className="w-24 px-2"><SortHeader label="Unit" sortKeyName="unit" /></div>
                {activeMarkets.map((market) => (
                  <div key={market.id} className="w-24 px-2 text-right">
                    <SortHeader label={market.name} sortKeyName={market.id} />
                  </div>
                ))}
                <div className="flex-1 px-2"></div>
                <div className="w-20 px-2"></div>
              </div>
            </div>

            {/* Body - scrolls independently */}
            <div ref={tableContainerRef} className="flex-1 overflow-auto">
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const p = filteredProducts[virtualRow.index];
                  return (
                    <div
                      key={p.id}
                      className="flex items-center border-b border-gray-100 hover:bg-gray-50 group"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: ROW_HEIGHT,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <div className="w-40 px-2 text-sm truncate" title={p.crop}>{p.crop}</div>
                      <div className="w-48 px-2 text-sm font-medium truncate" title={p.product}>{p.product}</div>
                      <div className="w-24 px-2 text-sm text-gray-600 truncate" title={p.unit}>{p.unit}</div>
                      {activeMarkets.map((market) => (
                        <div key={market.id} className="w-24 px-2 text-sm text-gray-700 text-right font-mono">
                          {formatPrice(p.prices?.[market.id])}
                        </div>
                      ))}
                      <div className="flex-1 px-2"></div>
                      <div className="w-20 px-2 flex gap-1 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={() => { setEditingProduct(p); setIsEditorOpen(true); }}
                          className="px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(p)}
                          className="px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 rounded"
                        >
                          ×
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
        <ProductEditor
          product={editingProduct}
          markets={activeMarkets}
          onSave={handleSaveProduct}
          onClose={() => { setIsEditorOpen(false); setEditingProduct(null); }}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
