'use client';

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { createVariety, type Variety, type DensityUnit } from '@/lib/entities/variety';
import { Z_INDEX } from '@/lib/z-index';

export interface VarietyEditorModalProps {
  /** Existing variety to edit, or null for creating new */
  variety: Variety | null;
  /** Pre-populate crop field (for new varieties) */
  initialCrop?: string;
  /** Called when variety is saved */
  onSave: (variety: Variety) => void;
  /** Called when modal is closed */
  onClose: () => void;
}

/**
 * Modal for creating or editing a variety.
 * Extracted as a shared component for reuse.
 */
export function VarietyEditorModal({
  variety,
  initialCrop,
  onSave,
  onClose,
}: VarietyEditorModalProps) {
  const [form, setForm] = useState({
    crop: variety?.crop ?? initialCrop ?? '',
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

  // Use portal to escape any parent stacking context
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: Z_INDEX.MODAL + 30 }} // Higher than SeedMixEditorModal
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
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
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-sm resize-none"
            placeholder="Notes (optional)"
            rows={2}
          />
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
    </div>,
    document.body
  );
}

export default VarietyEditorModal;
