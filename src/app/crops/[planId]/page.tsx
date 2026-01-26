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
  const [showAddCropForm, setShowAddCropForm] = useState(false);
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

  const handleBgColorChange = (cropId: string, newColor: string) => {
    const textColor = getContrastingTextColor(newColor);
    updateCrop(cropId, { bgColor: newColor, textColor });
  };

  const handleTextColorChange = (cropId: string, newColor: string) => {
    updateCrop(cropId, { textColor: newColor });
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
    setShowAddCropForm(false);
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

  // When bulk bg color changes, auto-calculate text color
  const handleBulkBgColorChange = (color: string) => {
    setBulkBgColor(color);
    setBulkTextColor(getContrastingTextColor(color));
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

  return (
    <>
      <AppHeader />
      <div className="h-[calc(100vh-51px)] overflow-auto bg-gray-50">
        <div className="max-w-4xl mx-auto px-6 py-8">
          {/* Page Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Crops</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage crop colors - select multiple to bulk edit
            </p>
          </div>

          {/* Search, Filter, and Add */}
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search crops..."
              className="flex-1 min-w-[200px] max-w-sm px-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <button
              onClick={() => setShowAddCropForm(true)}
              className="px-3 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50"
            >
              Add Crop
            </button>
          </div>

          {/* Color Filters */}
          {(uniqueBgColors.length > 1 || uniqueTextColors.length > 1) && (
            <div className="flex flex-wrap gap-4 mb-4 text-sm">
              {/* Background color filter */}
              {uniqueBgColors.length > 1 && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 mr-1">Background:</span>
                  <button
                    onClick={() => setBgColorFilter(null)}
                    className={`px-2 py-0.5 rounded border text-xs ${
                      bgColorFilter === null
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                    title="Show all"
                  >
                    All
                  </button>
                  {uniqueBgColors.slice(0, 10).map((color) => (
                    <button
                      key={color}
                      onClick={() => setBgColorFilter(bgColorFilter === color ? null : color)}
                      className={`w-6 h-6 rounded border-2 ${
                        bgColorFilter === color
                          ? 'border-blue-500 ring-2 ring-blue-200'
                          : 'border-transparent hover:border-gray-300'
                      }`}
                      style={{ backgroundColor: color }}
                      title={`Filter by background ${color}`}
                    />
                  ))}
                  {uniqueBgColors.length > 10 && (
                    <span className="text-xs text-gray-400">+{uniqueBgColors.length - 10}</span>
                  )}
                </div>
              )}

              {/* Text color filter */}
              {uniqueTextColors.length > 1 && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 mr-1">Text:</span>
                  <button
                    onClick={() => setTextColorFilter(null)}
                    className={`px-2 py-0.5 rounded border text-xs ${
                      textColorFilter === null
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                    title="Show all"
                  >
                    All
                  </button>
                  {uniqueTextColors.slice(0, 10).map((color) => (
                    <button
                      key={color}
                      onClick={() => setTextColorFilter(textColorFilter === color ? null : color)}
                      className={`w-6 h-6 rounded border-2 ${
                        textColorFilter === color
                          ? 'border-blue-500 ring-2 ring-blue-200'
                          : 'border-transparent hover:border-gray-300'
                      }`}
                      style={{ backgroundColor: color }}
                      title={`Filter by text ${color}`}
                    />
                  ))}
                  {uniqueTextColors.length > 10 && (
                    <span className="text-xs text-gray-400">+{uniqueTextColors.length - 10}</span>
                  )}
                </div>
              )}

              {/* Clear filters */}
              {(bgColorFilter || textColorFilter) && (
                <button
                  onClick={() => {
                    setBgColorFilter(null);
                    setTextColorFilter(null);
                  }}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {/* Bulk Action Bar */}
          {hasSelection && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 flex items-center gap-4 flex-wrap">
              <div className="text-sm font-medium text-blue-900">
                {selectedCropIds.size} selected
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-blue-700">Set color:</span>
                <input
                  type="color"
                  value={bulkBgColor}
                  onChange={(e) => handleBulkBgColorChange(e.target.value)}
                  className="w-8 h-8 cursor-pointer rounded border border-gray-300"
                  title="Background color"
                />
                <input
                  type="color"
                  value={bulkTextColor}
                  onChange={(e) => setBulkTextColor(e.target.value)}
                  className="w-8 h-8 cursor-pointer rounded border border-gray-300"
                  title="Text color"
                />
                <div
                  className="px-3 py-1 rounded text-sm font-medium"
                  style={{ backgroundColor: bulkBgColor, color: bulkTextColor }}
                >
                  Preview
                </div>
              </div>

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

          {/* Add Crop Form */}
          {showAddCropForm && (
            <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
              <h3 className="text-sm font-medium text-gray-900 mb-3">Add New Crop</h3>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={newCropName}
                  onChange={(e) => setNewCropName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddCrop();
                    if (e.key === 'Escape') setShowAddCropForm(false);
                  }}
                  placeholder="Crop name..."
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                <button
                  onClick={handleAddCrop}
                  disabled={!newCropName.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setShowAddCropForm(false);
                    setNewCropName('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
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

                      {/* Color preview chip */}
                      <div
                        className="w-24 px-3 py-1.5 rounded text-sm font-medium text-center truncate flex-shrink-0"
                        style={{
                          backgroundColor: crop.bgColor,
                          color: crop.textColor,
                        }}
                        title={crop.name}
                      >
                        {crop.name.length > 10 ? crop.name.slice(0, 10) + '...' : crop.name}
                      </div>

                      {/* Crop name (editable) */}
                      <div className="flex-1 min-w-0">
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
                            className="w-full px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none"
                            autoFocus
                          />
                        ) : (
                          <div
                            className="text-sm text-gray-900 truncate cursor-pointer hover:text-blue-600"
                            onClick={() => handleStartRename(crop)}
                            title="Click to rename"
                          >
                            {crop.name}
                          </div>
                        )}
                        {usageCount > 0 && (
                          <div className="text-xs text-gray-500">
                            Used in {usageCount} config{usageCount !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>

                      {/* Color pickers */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <input
                          type="color"
                          value={crop.bgColor}
                          onChange={(e) => handleBgColorChange(crop.id, e.target.value)}
                          className="w-8 h-8 cursor-pointer rounded border border-gray-300"
                          title="Background color"
                        />
                        <input
                          type="color"
                          value={crop.textColor}
                          onChange={(e) => handleTextColorChange(crop.id, e.target.value)}
                          className="w-8 h-8 cursor-pointer rounded border border-gray-300"
                          title="Text color"
                        />
                      </div>

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

          {/* Summary */}
          <div className="mt-4 text-sm text-gray-500">
            {filteredCrops.length} crop{filteredCrops.length !== 1 ? 's' : ''}
            {searchQuery && ` matching "${searchQuery}"`}
            {(bgColorFilter || textColorFilter) && ' (filtered)'}
          </div>
        </div>
      </div>
    </>
  );
}
