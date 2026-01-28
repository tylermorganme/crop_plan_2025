'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { usePlanStore } from '@/lib/plan-store';
import { DEFAULT_CROP_COLOR, getCropId } from '@/lib/entities/crop';
import type { Crop } from '@/lib/entities/crop';
import AppHeader from '@/components/AppHeader';

/**
 * Calculate relative luminance for a color (0-1 scale).
 */
function getLuminance(hex: string): number {
  const rgb = hex.replace('#', '').match(/.{2}/g);
  if (!rgb || rgb.length !== 3) return 0.5;

  const [r, g, b] = rgb.map(c => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Get a contrasting text color (black or white) for a given background.
 */
function getContrastingTextColor(bgColor: string): string {
  return getLuminance(bgColor) > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Get unique background colors from crops for filtering.
 */
function getUniqueBgColors(crops: Crop[]): string[] {
  const colors = new Set<string>();
  for (const crop of crops) {
    colors.add(crop.bgColor);
  }
  return Array.from(colors).sort();
}

/**
 * Get unique text colors from crops for filtering.
 */
function getUniqueTextColors(crops: Crop[]): string[] {
  const colors = new Set<string>();
  for (const crop of crops) {
    colors.add(crop.textColor);
  }
  return Array.from(colors).sort();
}

/**
 * Unified color picker with bg/text color inputs and copy-from dropdown.
 * Use onColorChange for atomic updates (both colors at once), or
 * onBgColorChange/onTextColorChange for separate callbacks.
 */
function CropColorPicker({
  bgColor,
  textColor,
  onColorChange,
  onBgColorChange,
  onTextColorChange,
  crops,
  excludeId,
  showPreview = false,
  previewText = 'Preview',
}: {
  bgColor: string;
  textColor: string;
  onColorChange?: (bgColor: string, textColor: string) => void;
  onBgColorChange?: (color: string) => void;
  onTextColorChange?: (color: string) => void;
  crops: Crop[];
  excludeId?: string;
  showPreview?: boolean;
  previewText?: string;
}) {
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  const [copyFromSearch, setCopyFromSearch] = useState('');

  const filteredCrops = crops
    .filter(c => !excludeId || c.id !== excludeId)
    .filter(c => !copyFromSearch || c.name.toLowerCase().includes(copyFromSearch.toLowerCase()));

  const handleBgChange = (newBg: string) => {
    const newText = getContrastingTextColor(newBg);
    if (onColorChange) {
      onColorChange(newBg, newText);
    } else {
      onBgColorChange?.(newBg);
      onTextColorChange?.(newText);
    }
  };

  const handleTextChange = (newText: string) => {
    if (onColorChange) {
      onColorChange(bgColor, newText);
    } else {
      onTextColorChange?.(newText);
    }
  };

  const handleCopyFrom = (crop: Crop) => {
    if (onColorChange) {
      onColorChange(crop.bgColor, crop.textColor);
    } else {
      onBgColorChange?.(crop.bgColor);
      onTextColorChange?.(crop.textColor);
    }
    setCopyFromOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={bgColor}
        onChange={(e) => handleBgChange(e.target.value)}
        className="w-8 h-8 cursor-pointer rounded border border-gray-300"
        title="Background color"
      />
      <input
        type="color"
        value={textColor}
        onChange={(e) => handleTextChange(e.target.value)}
        className="w-8 h-8 cursor-pointer rounded border border-gray-300"
        title="Text color"
      />
      {showPreview && (
        <div
          className="px-3 py-1 rounded text-sm font-medium"
          style={{ backgroundColor: bgColor, color: textColor }}
        >
          {previewText}
        </div>
      )}
      {/* Copy from dropdown */}
      <div className="relative">
        <button
          onClick={() => {
            setCopyFromOpen(!copyFromOpen);
            setCopyFromSearch('');
          }}
          className="text-xs border border-gray-300 rounded px-2 py-1 text-gray-600 bg-white cursor-pointer hover:border-gray-400 hover:bg-gray-50"
          title="Copy colors from another crop"
        >
          Copy from...
        </button>
        {copyFromOpen && (
          <>
            {/* Backdrop to close dropdown */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setCopyFromOpen(false)}
            />
            {/* Dropdown menu */}
            <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg min-w-56">
              {/* Search input */}
              <div className="p-2 border-b border-gray-100">
                <input
                  type="text"
                  value={copyFromSearch}
                  onChange={(e) => setCopyFromSearch(e.target.value)}
                  placeholder="Search crops..."
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              {/* Crop list */}
              <div className="max-h-48 overflow-auto py-1">
                {filteredCrops.map(c => (
                  <button
                    key={c.id}
                    onClick={() => handleCopyFrom(c)}
                    className="w-full px-3 py-1.5 text-left hover:bg-gray-100 flex items-center gap-2"
                  >
                    <span
                      className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{ backgroundColor: c.bgColor, color: c.textColor }}
                    >
                      {c.name}
                    </span>
                  </button>
                ))}
                {filteredCrops.length === 0 && (
                  <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CropsPage() {
  const params = useParams();
  const planId = params.planId as string;

  const {
    currentPlan,
    loadPlanById,
    updateCrop,
    addCropEntity,
    deleteCropEntity,
    bulkUpdateCropEntities,
  } = usePlanStore();

  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [bgColorFilter, setBgColorFilter] = useState<string | null>(null);
  const [textColorFilter, setTextColorFilter] = useState<string | null>(null);
  const [editingCropId, setEditingCropId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [newCropName, setNewCropName] = useState('');

  // Multi-select state
  const [selectedCropIds, setSelectedCropIds] = useState<Set<string>>(new Set());
  const [bulkBgColor, setBulkBgColor] = useState('#4a9d4a');
  const [bulkTextColor, setBulkTextColor] = useState('#ffffff');


  // Load plan on mount
  useEffect(() => {
    if (planId) {
      loadPlanById(planId).then(() => setIsLoading(false));
    }
  }, [planId, loadPlanById]);

  // Sort crops alphabetically
  const sortedCrops = useMemo(() => {
    if (!currentPlan?.crops) return [];
    return Object.values(currentPlan.crops).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [currentPlan?.crops]);

  // Get unique colors for filters
  const uniqueBgColors = useMemo(() => getUniqueBgColors(sortedCrops), [sortedCrops]);
  const uniqueTextColors = useMemo(() => getUniqueTextColors(sortedCrops), [sortedCrops]);

  // Filter crops by search and colors
  const filteredCrops = useMemo(() => {
    let result = sortedCrops;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(crop =>
        crop.name.toLowerCase().includes(query)
      );
    }

    if (bgColorFilter) {
      result = result.filter(crop => crop.bgColor === bgColorFilter);
    }

    if (textColorFilter) {
      result = result.filter(crop => crop.textColor === textColorFilter);
    }

    return result;
  }, [sortedCrops, searchQuery, bgColorFilter, textColorFilter]);

  // Count crops by usage in configs
  const cropUsage = useMemo(() => {
    if (!currentPlan) return new Map<string, number>();
    const usage = new Map<string, number>();

    if (currentPlan.cropCatalog) {
      for (const config of Object.values(currentPlan.cropCatalog)) {
        const cropId = getCropId(config.crop);
        usage.set(cropId, (usage.get(cropId) || 0) + 1);
      }
    }

    return usage;
  }, [currentPlan]);

  // Clear selection when filter changes
  useEffect(() => {
    setSelectedCropIds(new Set());
  }, [searchQuery, bgColorFilter, textColorFilter]);

  // Note: CropColorPicker handles auto-contrast internally, so these just pass through
  const handleColorChange = (cropId: string, bgColor: string, textColor: string) => {
    updateCrop(cropId, { bgColor, textColor });
  };

  const handleStartRename = (crop: Crop) => {
    setEditingCropId(crop.id);
    setEditingName(crop.name);
  };

  const handleSaveRename = () => {
    if (editingCropId && editingName.trim()) {
      updateCrop(editingCropId, { name: editingName.trim() });
    }
    setEditingCropId(null);
    setEditingName('');
  };

  const handleCancelRename = () => {
    setEditingCropId(null);
    setEditingName('');
  };

  const handleAddCrop = () => {
    if (!newCropName.trim()) return;

    const name = newCropName.trim();
    const id = getCropId(name);

    if (currentPlan?.crops?.[id]) {
      alert(`Crop "${name}" already exists`);
      return;
    }

    addCropEntity({
      id,
      name,
      bgColor: DEFAULT_CROP_COLOR.bg,
      textColor: DEFAULT_CROP_COLOR.text,
    });

    setNewCropName('');
  };

  const handleDeleteCrop = (crop: Crop) => {
    const usageCount = cropUsage.get(crop.id) || 0;
    if (usageCount > 0) {
      alert(`Cannot delete "${crop.name}" - it's used by ${usageCount} crop config(s)`);
      return;
    }

    if (confirm(`Delete crop "${crop.name}"?`)) {
      deleteCropEntity(crop.id);
    }
  };

  // Multi-select handlers
  const toggleSelect = (cropId: string) => {
    setSelectedCropIds(prev => {
      const next = new Set(prev);
      if (next.has(cropId)) {
        next.delete(cropId);
      } else {
        next.add(cropId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedCropIds(new Set(filteredCrops.map(c => c.id)));
  };

  const selectNone = () => {
    setSelectedCropIds(new Set());
  };

  const handleBulkColorChange = async () => {
    if (selectedCropIds.size === 0) return;

    const updates = Array.from(selectedCropIds).map(cropId => ({
      cropId,
      changes: {
        bgColor: bulkBgColor,
        textColor: bulkTextColor,
      },
    }));

    await bulkUpdateCropEntities(updates);
    setSelectedCropIds(new Set());
  };

  if (isLoading) {
    return (
      <>
        <AppHeader />
        <div className="h-[calc(100vh-51px)] flex items-center justify-center bg-gray-50">
          <div className="text-gray-500">Loading crops...</div>
        </div>
      </>
    );
  }

  if (!currentPlan) {
    return (
      <>
        <AppHeader />
        <div className="h-[calc(100vh-51px)] flex items-center justify-center bg-gray-50">
          <div className="text-gray-500">Plan not found</div>
        </div>
      </>
    );
  }

  const hasSelection = selectedCropIds.size > 0;

  const hasFilters = searchQuery || bgColorFilter || textColorFilter;

  return (
    <>
      <AppHeader />
      <div className="h-[calc(100vh-49px)] bg-gray-50 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="bg-white border-b px-4 py-2 flex items-center gap-3 flex-wrap flex-shrink-0">
          <h1 className="text-lg font-semibold text-gray-900">Crops</h1>
          <span className="text-sm text-gray-500">{filteredCrops.length}/{sortedCrops.length}</span>

          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="px-2 py-1 border rounded text-sm w-40"
          />

          {/* Background filter */}
          {uniqueBgColors.length > 1 && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">Bg:</span>
              {uniqueBgColors.map((color) => (
                <button
                  key={color}
                  onClick={() => setBgColorFilter(bgColorFilter === color ? null : color)}
                  className={`w-4 h-4 rounded flex-shrink-0 ${
                    bgColorFilter === color
                      ? 'ring-2 ring-blue-500 ring-offset-1'
                      : 'border border-gray-400 hover:border-gray-600'
                  }`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          )}

          {/* Text filter */}
          {uniqueTextColors.length > 1 && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">Text:</span>
              {uniqueTextColors.map((color) => (
                <button
                  key={color}
                  onClick={() => setTextColorFilter(textColorFilter === color ? null : color)}
                  className={`w-4 h-4 rounded flex-shrink-0 ${
                    textColorFilter === color
                      ? 'ring-2 ring-blue-500 ring-offset-1'
                      : 'border border-gray-400 hover:border-gray-600'
                  }`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          )}

          {hasFilters && (
            <button
              onClick={() => {
                setSearchQuery('');
                setBgColorFilter(null);
                setTextColorFilter(null);
              }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          )}

          <div className="flex-1" />

          <input
            type="text"
            value={newCropName}
            onChange={(e) => setNewCropName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newCropName.trim()) handleAddCrop();
            }}
            placeholder="Add crop..."
            className="px-2 py-1 border rounded text-sm w-32"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-xl mx-auto px-4 py-4">

          {/* Bulk Action Bar */}
          {hasSelection && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 flex items-center gap-4 flex-wrap">
              <div className="text-sm font-medium text-blue-900">
                {selectedCropIds.size} selected
              </div>

              <span className="text-sm text-blue-700">Set color:</span>
              <CropColorPicker
                bgColor={bulkBgColor}
                textColor={bulkTextColor}
                onBgColorChange={setBulkBgColor}
                onTextColorChange={setBulkTextColor}
                crops={sortedCrops}
                showPreview
              />

              <button
                onClick={handleBulkColorChange}
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Apply Color
              </button>

              <div className="flex-1" />

              <button
                onClick={selectNone}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Clear selection
              </button>
            </div>
          )}


          {/* Crops List */}
          <div className="bg-white rounded-lg border border-gray-200">
            {/* Select all header */}
            {filteredCrops.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-gray-50">
                <input
                  type="checkbox"
                  checked={selectedCropIds.size === filteredCrops.length && filteredCrops.length > 0}
                  onChange={() => {
                    if (selectedCropIds.size === filteredCrops.length) {
                      selectNone();
                    } else {
                      selectAll();
                    }
                  }}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-500">
                  {selectedCropIds.size === filteredCrops.length ? 'Deselect all' : 'Select all'}
                </span>
              </div>
            )}

            {filteredCrops.length === 0 ? (
              <div className="text-center text-gray-500 py-12">
                {searchQuery || bgColorFilter || textColorFilter ? 'No matching crops found' : 'No crops defined yet'}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredCrops.map((crop) => {
                  const usageCount = cropUsage.get(crop.id) || 0;
                  const isEditing = editingCropId === crop.id;
                  const isSelected = selectedCropIds.has(crop.id);

                  return (
                    <div
                      key={crop.id}
                      className={`flex items-center gap-4 px-4 py-3 hover:bg-gray-50 ${
                        isSelected ? 'bg-blue-50' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(crop.id)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />

                      {/* Crop name as colored badge (editable) */}
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename();
                            if (e.key === 'Escape') handleCancelRename();
                          }}
                          onBlur={handleSaveRename}
                          className="px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none"
                          autoFocus
                        />
                      ) : (
                        <div
                          className="px-3 py-1 rounded text-sm font-medium cursor-pointer hover:opacity-80"
                          style={{ backgroundColor: crop.bgColor, color: crop.textColor }}
                          onClick={() => handleStartRename(crop)}
                          title="Click to rename"
                        >
                          {crop.name}
                        </div>
                      )}

                      {/* Usage count */}
                      {usageCount > 0 && (
                        <span className="text-xs text-gray-500">
                          {usageCount} config{usageCount !== 1 ? 's' : ''}
                        </span>
                      )}

                      {/* GDD Temps (Base / Upper) */}
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500">GDD:</span>
                        <input
                          type="number"
                          value={crop.gddBaseTemp ?? ''}
                          onChange={(e) => {
                            const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                            updateCrop(crop.id, { gddBaseTemp: val });
                          }}
                          placeholder="—"
                          className="w-10 px-1 py-0.5 text-xs border border-gray-300 rounded text-center focus:outline-none focus:border-blue-500"
                          title="GDD base temperature (°F). Min temp for growth."
                        />
                        <span className="text-xs text-gray-400">/</span>
                        <input
                          type="number"
                          value={crop.gddUpperTemp ?? ''}
                          onChange={(e) => {
                            const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                            updateCrop(crop.id, { gddUpperTemp: val });
                          }}
                          placeholder="—"
                          className="w-10 px-1 py-0.5 text-xs border border-gray-300 rounded text-center focus:outline-none focus:border-blue-500"
                          title="GDD upper temperature (°F). Max temp for growth."
                        />
                        <span className="text-xs text-gray-400">°F</span>
                      </div>

                      <div className="flex-1" />

                      {/* Color picker */}
                      <CropColorPicker
                        bgColor={crop.bgColor}
                        textColor={crop.textColor}
                        onColorChange={(bg, text) => handleColorChange(crop.id, bg, text)}
                        crops={sortedCrops}
                        excludeId={crop.id}
                      />

                      {/* Delete button */}
                      <button
                        onClick={() => handleDeleteCrop(crop)}
                        disabled={usageCount > 0}
                        className={`p-1.5 rounded flex-shrink-0 ${
                          usageCount > 0
                            ? 'text-gray-300 cursor-not-allowed'
                            : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                        }`}
                        title={usageCount > 0 ? `Cannot delete - used in ${usageCount} config(s)` : 'Delete crop'}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
