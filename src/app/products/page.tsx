'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePlanStore, initializePlanStore } from '@/lib/plan-store';
import { createProduct, getProductKey, type Product, type CreateProductInput } from '@/lib/entities/product';
import { getActiveMarkets, type Market } from '@/lib/entities/market';
import { Z_INDEX } from '@/lib/z-index';
import AppHeader from '@/components/AppHeader';
import { FastEditTable, type ColumnDef } from '@/components/FastEditTable';

// Stable empty object reference to avoid SSR hydration issues
const EMPTY_PRODUCTS: Record<string, Product> = {};
const EMPTY_MARKETS: Record<string, Market> = {};
const EMPTY_SPECS: Record<string, import('@/lib/entities/planting-specs').PlantingSpec> = {};

type SortKey = string;
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
    holdingWindow: product?.holdingWindow?.toString() ?? '',
    portionSize: product?.portionSize?.toString() ?? '',
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

    const holdingWindow = form.holdingWindow ? parseInt(form.holdingWindow, 10) : undefined;
    const portionSize = form.portionSize ? parseFloat(form.portionSize) : undefined;

    // When editing, preserve the original ID; when creating, generate a new one
    const savedProduct: Product = product
      ? {
          ...product,
          crop: form.crop.trim(),
          product: form.product.trim(),
          unit: form.unit.trim(),
          prices,
          holdingWindow: holdingWindow && !isNaN(holdingWindow) ? holdingWindow : undefined,
          portionSize: portionSize && !isNaN(portionSize) ? portionSize : undefined,
        }
      : createProduct({
          crop: form.crop.trim(),
          product: form.product.trim(),
          unit: form.unit.trim(),
          prices,
          holdingWindow: holdingWindow && !isNaN(holdingWindow) ? holdingWindow : undefined,
          portionSize: portionSize && !isNaN(portionSize) ? portionSize : undefined,
        });

    onSave(savedProduct);
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
            <input
              type="number"
              min="0"
              value={form.holdingWindow}
              onChange={(e) => setForm({ ...form, holdingWindow: e.target.value })}
              className="px-2 py-1.5 border rounded text-sm w-full"
              placeholder="Hold (days)"
            />
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.portionSize}
              onChange={(e) => setForm({ ...form, portionSize: e.target.value })}
              className="px-2 py-1.5 border rounded text-sm w-full"
              placeholder="CSA Portion"
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Store hooks - using plan store
  const products = usePlanStore((state) => state.currentPlan?.products ?? EMPTY_PRODUCTS);
  const marketsRecord = usePlanStore((state) => state.currentPlan?.markets ?? EMPTY_MARKETS);
  const specs = usePlanStore((state) => state.currentPlan?.specs ?? EMPTY_SPECS);
  const hasPlan = usePlanStore((state) => state.currentPlan !== null);
  const addProduct = usePlanStore((state) => state.addProduct);
  const updateProduct = usePlanStore((state) => state.updateProduct);
  const deleteProduct = usePlanStore((state) => state.deleteProduct);
  const importProducts = usePlanStore((state) => state.importProducts);

  // Count how many specs reference each product
  const specCountByProduct = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const spec of Object.values(specs)) {
      if (spec.productYields) {
        for (const py of spec.productYields) {
          if (py.productId) {
            counts[py.productId] = (counts[py.productId] ?? 0) + 1;
          }
        }
      }
    }
    return counts;
  }, [specs]);

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
        case 'holdingWindow': cmp = (a.holdingWindow || 0) - (b.holdingWindow || 0); break;
        case 'portionSize': cmp = (a.portionSize || 0) - (b.portionSize || 0); break;
        case 'specCount': cmp = (specCountByProduct[a.id] || 0) - (specCountByProduct[b.id] || 0); break;
        default:
          // Sort by market price (sortKey is market ID)
          cmp = (a.prices?.[sortKey] || 0) - (b.prices?.[sortKey] || 0);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [products, filterCrop, filterUnit, searchQuery, sortKey, sortDir, specCountByProduct]);

  // Build column definitions (static + dynamic market columns)
  const columns: ColumnDef<Product>[] = useMemo(() => {
    const cols: ColumnDef<Product>[] = [
      {
        key: 'crop',
        header: 'Crop',
        width: 160,
        sortable: true,
        editable: { type: 'text' },
        getValue: (p) => p.crop,
      },
      {
        key: 'product',
        header: 'Product',
        width: 200,
        sortable: true,
        editable: { type: 'text' },
        getValue: (p) => p.product,
      },
      {
        key: 'unit',
        header: 'Unit',
        width: 100,
        sortable: true,
        editable: { type: 'text' },
        getValue: (p) => p.unit,
      },
      {
        key: 'holdingWindow',
        header: 'Hold',
        width: 80,
        sortable: true,
        align: 'right',
        editable: { type: 'number', min: 0 },
        getValue: (p) => p.holdingWindow,
        format: (p) => p.holdingWindow ? `${p.holdingWindow}d` : '',
      },
      {
        key: 'portionSize',
        header: 'CSA Portion',
        width: 100,
        sortable: true,
        align: 'right',
        editable: { type: 'number', min: 0, step: 0.1 },
        getValue: (p) => p.portionSize,
        format: (p) => p.portionSize ? `${p.portionSize}` : '',
      },
      {
        key: 'specCount',
        header: 'Specs',
        width: 60,
        sortable: true,
        align: 'right',
        getValue: (p) => specCountByProduct[p.id] ?? 0,
        format: (p) => {
          const count = specCountByProduct[p.id] ?? 0;
          return count > 0 ? String(count) : '';
        },
      },
    ];

    // Add a column for each active market
    for (const market of activeMarkets) {
      cols.push({
        key: `price_${market.id}`,
        header: market.name,
        width: 100,
        sortable: true,
        align: 'right',
        editable: { type: 'number', min: 0, step: 0.01 },
        getValue: (p) => p.prices?.[market.id],
        format: (p) => {
          const price = p.prices?.[market.id];
          return price !== undefined ? `$${price.toFixed(2)}` : '';
        },
      });
    }

    return cols;
  }, [activeMarkets, specCountByProduct]);

  const handleSort = useCallback((key: string) => {
    // Map price_xxx keys back to market IDs for sorting
    const actualKey = key.startsWith('price_') ? key.replace('price_', '') : key;
    if (sortKey === actualKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(actualKey);
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
      const specCount = specCountByProduct[product.id] ?? 0;
      const warningMsg = specCount > 0
        ? `Delete "${product.crop} - ${product.product}"?\n\nWarning: ${specCount} spec(s) reference this product and will have orphaned references.`
        : `Delete "${product.crop} - ${product.product}"?`;
      if (!confirm(warningMsg)) return;
      await deleteProduct(product.id);
      setToast({ message: 'Deleted', type: 'info' });
    },
    [deleteProduct, specCountByProduct]
  );

  // Handle cell changes from FastEditTable
  const handleCellChange = useCallback(
    async (_rowKey: string, columnKey: string, newValue: string, product: Product) => {
      const updatedProduct = { ...product, prices: { ...product.prices } };
      const trimmedValue = newValue.trim();

      // Handle identity fields (crop, product, unit) - check for duplicates
      if (columnKey === 'crop' || columnKey === 'product' || columnKey === 'unit') {
        if (!trimmedValue) {
          setToast({ message: `${columnKey} cannot be empty`, type: 'error' });
          return;
        }

        // Build the new key to check for duplicates
        const newCrop = columnKey === 'crop' ? trimmedValue : product.crop;
        const newProduct = columnKey === 'product' ? trimmedValue : product.product;
        const newUnit = columnKey === 'unit' ? trimmedValue : product.unit;
        const newKey = getProductKey(newCrop, newProduct, newUnit);
        const oldKey = getProductKey(product.crop, product.product, product.unit);

        // Check if another product already has this key
        if (newKey !== oldKey) {
          const duplicate = Object.values(products).find(
            p => p.id !== product.id && getProductKey(p.crop, p.product, p.unit) === newKey
          );
          if (duplicate) {
            setToast({ message: `Product "${newCrop} - ${newProduct} (${newUnit})" already exists`, type: 'error' });
            return;
          }
        }

        updatedProduct[columnKey] = trimmedValue;
      } else if (columnKey === 'holdingWindow') {
        const parsed = parseInt(newValue, 10);
        updatedProduct.holdingWindow = !isNaN(parsed) && parsed > 0 ? parsed : undefined;
      } else if (columnKey === 'portionSize') {
        const parsed = parseFloat(newValue);
        updatedProduct.portionSize = !isNaN(parsed) && parsed > 0 ? parsed : undefined;
      } else if (columnKey.startsWith('price_')) {
        const marketId = columnKey.replace('price_', '');
        const parsed = parseFloat(newValue);
        if (!isNaN(parsed) && parsed > 0) {
          updatedProduct.prices[marketId] = parsed;
        } else {
          delete updatedProduct.prices[marketId];
        }
      }

      await updateProduct(updatedProduct);
    },
    [updateProduct, products]
  );

  const handleLoadStock = useCallback(async () => {
    try {
      const response = await import('@/data/products-template.json');
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

  // Clear selection when filters change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [searchQuery, filterCrop, filterUnit]);

  // Bulk delete selected products
  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;

    // Count specs that reference selected products
    let totalSpecs = 0;
    for (const id of selectedIds) {
      totalSpecs += specCountByProduct[id] ?? 0;
    }

    const warningMsg = totalSpecs > 0
      ? `Delete ${selectedIds.size} product(s)?\n\nWarning: ${totalSpecs} spec(s) reference these products and will have orphaned references.`
      : `Delete ${selectedIds.size} product(s)?`;
    if (!confirm(warningMsg)) return;

    for (const id of selectedIds) {
      await deleteProduct(id);
    }
    setSelectedIds(new Set());
    setToast({ message: `Deleted ${selectedIds.size} products`, type: 'info' });
  }, [selectedIds, deleteProduct, specCountByProduct]);

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

  // Map sortKey back to column key for FastEditTable
  const tableSortKey = sortKey.startsWith('price_') ? sortKey :
    activeMarkets.some(m => m.id === sortKey) ? `price_${sortKey}` : sortKey;

  return (
    <>
      <AppHeader />
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

        {/* Selection Bar */}
        {selectedIds.size > 0 && (
          <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center gap-4 flex-shrink-0">
            <span className="text-sm font-medium text-blue-900">
              {selectedIds.size} selected
            </span>
            <button
              onClick={handleBulkDelete}
              className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded"
            >
              Delete
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Clear selection
            </button>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 bg-white overflow-hidden">
          <FastEditTable
            data={filteredProducts}
            rowKey={(p) => p.id}
            columns={columns}
            sortKey={tableSortKey}
            sortDir={sortDir}
            onSort={handleSort}
            onCellChange={handleCellChange}
            selectable
            selectedKeys={selectedIds}
            onSelectionChange={setSelectedIds}
            emptyMessage={productCount === 0 ? 'No products loaded.' : 'No matches'}
            renderActions={(p) => (
              <>
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
              </>
            )}
          />
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
    </>
  );
}
