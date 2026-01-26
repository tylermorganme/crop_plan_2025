'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { usePlanStore } from '@/lib/plan-store';
import { DEFAULT_CROP_COLOR, getCropId, getCropColors } from '@/lib/entities/crop';
import { getColorDefId } from '@/lib/entities/color-def';
import type { Crop } from '@/lib/entities/crop';
import type { ColorDef } from '@/lib/entities/color-def';
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

export default function CropsPage() {
  const params = useParams();
  const planId = params.planId as string;

  const {
    currentPlan,
    loadPlanById,
    updateCrop,
    addCropEntity,
    deleteCropEntity,
    addColorDef,
    updateColorDef,
    deleteColorDef,
  } = usePlanStore();

  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCropId, setEditingCropId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [showAddCropForm, setShowAddCropForm] = useState(false);
  const [newCropName, setNewCropName] = useState('');

  // Color palette state
  const [showAddColorForm, setShowAddColorForm] = useState(false);
  const [newColorName, setNewColorName] = useState('');
  const [newColorBg, setNewColorBg] = useState('#4a9d4a');
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [editingColorName, setEditingColorName] = useState('');

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

  // Sort color definitions alphabetically
  const sortedColorDefs = useMemo(() => {
    if (!currentPlan?.colorDefs) return [];
    return Object.values(currentPlan.colorDefs).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [currentPlan?.colorDefs]);

  // Filter crops by search
  const filteredCrops = useMemo(() => {
    if (!searchQuery.trim()) return sortedCrops;
    const query = searchQuery.toLowerCase().trim();
    return sortedCrops.filter(crop =>
      crop.name.toLowerCase().includes(query)
    );
  }, [sortedCrops, searchQuery]);

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

  // Count crops using each color definition
  const colorDefUsage = useMemo(() => {
    if (!currentPlan?.crops) return new Map<string, number>();
    const usage = new Map<string, number>();

    for (const crop of Object.values(currentPlan.crops)) {
      if (crop.colorDefId) {
        usage.set(crop.colorDefId, (usage.get(crop.colorDefId) || 0) + 1);
      }
    }

    return usage;
  }, [currentPlan?.crops]);

  // Get resolved colors for a crop (handles colorDefId)
  const getResolvedColors = (crop: Crop) => {
    return getCropColors(currentPlan?.crops, crop.name, currentPlan?.colorDefs);
  };

  const handleBgColorChange = (cropId: string, newColor: string) => {
    const textColor = getContrastingTextColor(newColor);
    // Clear colorDefId when setting custom color
    updateCrop(cropId, { bgColor: newColor, textColor, colorDefId: null });
  };

  const handleTextColorChange = (cropId: string, newColor: string) => {
    updateCrop(cropId, { textColor: newColor });
  };

  const handleColorDefSelect = (cropId: string, colorDefId: string | null) => {
    updateCrop(cropId, { colorDefId });
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

  // Color definition handlers
  const handleAddColorDef = () => {
    if (!newColorName.trim()) return;

    const name = newColorName.trim();
    const id = getColorDefId(name);

    if (currentPlan?.colorDefs?.[id]) {
      alert(`Color "${name}" already exists`);
      return;
    }

    addColorDef({
      id,
      name,
      bgColor: newColorBg,
      textColor: getContrastingTextColor(newColorBg),
    });

    setNewColorName('');
    setNewColorBg('#4a9d4a');
    setShowAddColorForm(false);
  };

  const handleColorDefBgChange = (colorDefId: string, newColor: string) => {
    const textColor = getContrastingTextColor(newColor);
    updateColorDef(colorDefId, { bgColor: newColor, textColor });
  };

  const handleStartColorRename = (colorDef: ColorDef) => {
    setEditingColorId(colorDef.id);
    setEditingColorName(colorDef.name);
  };

  const handleSaveColorRename = () => {
    if (editingColorId && editingColorName.trim()) {
      updateColorDef(editingColorId, { name: editingColorName.trim() });
    }
    setEditingColorId(null);
    setEditingColorName('');
  };

  const handleDeleteColorDef = (colorDef: ColorDef) => {
    const usageCount = colorDefUsage.get(colorDef.id) || 0;
    if (usageCount > 0) {
      alert(`Cannot delete "${colorDef.name}" - it's used by ${usageCount} crop(s)`);
      return;
    }

    if (confirm(`Delete color "${colorDef.name}"?`)) {
      deleteColorDef(colorDef.id);
    }
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

  return (
    <>
      <AppHeader />
      <div className="h-[calc(100vh-51px)] flex bg-gray-50">
        {/* Main Content - Crops */}
        <div className="flex-1 overflow-auto px-6 py-8">
          {/* Page Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Crops</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage crop colors and assign named color palettes
            </p>
          </div>

          {/* Search and Add */}
          <div className="flex items-center gap-4 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search crops..."
              className="flex-1 max-w-sm px-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => setShowAddCropForm(true)}
              className="px-3 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50"
            >
              Add Crop
            </button>
          </div>

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
            {filteredCrops.length === 0 ? (
              <div className="text-center text-gray-500 py-12">
                {searchQuery ? 'No matching crops found' : 'No crops defined yet'}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredCrops.map((crop) => {
                  const usageCount = cropUsage.get(crop.id) || 0;
                  const isEditing = editingCropId === crop.id;
                  const resolvedColors = getResolvedColors(crop);
                  const hasColorDef = !!crop.colorDefId;

                  return (
                    <div
                      key={crop.id}
                      className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50"
                    >
                      {/* Color preview chip */}
                      <div
                        className="w-24 px-3 py-1.5 rounded text-sm font-medium text-center truncate flex-shrink-0"
                        style={{
                          backgroundColor: resolvedColors.bg,
                          color: resolvedColors.text,
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

                      {/* Color selection - dropdown or custom */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <select
                          value={crop.colorDefId || ''}
                          onChange={(e) => handleColorDefSelect(crop.id, e.target.value || null)}
                          className="px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[120px]"
                        >
                          <option value="">Custom</option>
                          {sortedColorDefs.map((cd) => (
                            <option key={cd.id} value={cd.id}>
                              {cd.name}
                            </option>
                          ))}
                        </select>

                        {/* Show color pickers only for custom colors */}
                        {!hasColorDef && (
                          <>
                            <input
                              type="color"
                              value={crop.bgColor || DEFAULT_CROP_COLOR.bg}
                              onChange={(e) => handleBgColorChange(crop.id, e.target.value)}
                              className="w-8 h-8 cursor-pointer rounded border border-gray-300"
                              title="Background color"
                            />
                            <input
                              type="color"
                              value={crop.textColor || DEFAULT_CROP_COLOR.text}
                              onChange={(e) => handleTextColorChange(crop.id, e.target.value)}
                              className="w-8 h-8 cursor-pointer rounded border border-gray-300"
                              title="Text color"
                            />
                          </>
                        )}
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
          </div>
        </div>

        {/* Right Side Panel - Color Palette */}
        <div className="w-80 border-l border-gray-200 bg-white overflow-auto">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Color Palette</h2>
              <button
                onClick={() => setShowAddColorForm(true)}
                className="px-2 py-1 text-xs font-medium text-blue-600 border border-blue-600 rounded hover:bg-blue-50"
              >
                Add
              </button>
            </div>

            {/* Add Color Form */}
            {showAddColorForm && (
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 mb-4">
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newColorName}
                    onChange={(e) => setNewColorName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddColorDef();
                      if (e.key === 'Escape') setShowAddColorForm(false);
                    }}
                    placeholder="Name (e.g., Cucurbit)"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={newColorBg}
                      onChange={(e) => setNewColorBg(e.target.value)}
                      className="w-10 h-10 cursor-pointer rounded border border-gray-300"
                    />
                    <div
                      className="flex-1 px-3 py-2 rounded text-sm font-medium text-center"
                      style={{
                        backgroundColor: newColorBg,
                        color: getContrastingTextColor(newColorBg),
                      }}
                    >
                      Preview
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddColorDef}
                      disabled={!newColorName.trim()}
                      className="flex-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setShowAddColorForm(false);
                        setNewColorName('');
                      }}
                      className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Color Definitions */}
            {sortedColorDefs.length === 0 ? (
              <div className="text-center text-gray-500 py-8 text-sm">
                No colors defined yet
              </div>
            ) : (
              <div className="space-y-2">
                {sortedColorDefs.map((colorDef) => {
                  const usageCount = colorDefUsage.get(colorDef.id) || 0;
                  const isEditing = editingColorId === colorDef.id;

                  return (
                    <div
                      key={colorDef.id}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 group"
                    >
                      {/* Color swatch */}
                      <div
                        className="w-12 h-8 rounded text-xs font-medium flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: colorDef.bgColor,
                          color: colorDef.textColor,
                        }}
                      >
                        Aa
                      </div>

                      {/* Name and usage */}
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingColorName}
                            onChange={(e) => setEditingColorName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveColorRename();
                              if (e.key === 'Escape') {
                                setEditingColorId(null);
                                setEditingColorName('');
                              }
                            }}
                            onBlur={handleSaveColorRename}
                            className="w-full px-2 py-0.5 text-sm border border-blue-500 rounded focus:outline-none"
                            autoFocus
                          />
                        ) : (
                          <div
                            className="text-sm font-medium text-gray-900 truncate cursor-pointer hover:text-blue-600"
                            onClick={() => handleStartColorRename(colorDef)}
                          >
                            {colorDef.name}
                          </div>
                        )}
                        {usageCount > 0 && (
                          <div className="text-xs text-gray-400">
                            {usageCount} crop{usageCount !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>

                      {/* Color picker */}
                      <input
                        type="color"
                        value={colorDef.bgColor}
                        onChange={(e) => handleColorDefBgChange(colorDef.id, e.target.value)}
                        className="w-6 h-6 cursor-pointer rounded border border-gray-300 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      />

                      {/* Delete button */}
                      <button
                        onClick={() => handleDeleteColorDef(colorDef)}
                        disabled={usageCount > 0}
                        className={`p-1 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${
                          usageCount > 0
                            ? 'text-gray-300 cursor-not-allowed'
                            : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                        }`}
                        title={usageCount > 0 ? `Cannot delete - used by ${usageCount} crop(s)` : 'Delete color'}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
    </>
  );
}
