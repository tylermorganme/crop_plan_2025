'use client';

import { useState, useMemo } from 'react';
import type { Crop } from '@/lib/entities/crop';
import { DEFAULT_CROP_COLOR } from '@/lib/entities/crop';

interface CropColorEditorProps {
  crops: Record<string, Crop>;
  onUpdateCrop: (cropId: string, updates: { bgColor?: string; textColor?: string }) => void;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Calculate relative luminance for a color (0-1 scale).
 * Used to automatically suggest text color based on background.
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

export default function CropColorEditor({
  crops,
  onUpdateCrop,
  isOpen,
  onClose,
}: CropColorEditorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCrop, setEditingCrop] = useState<string | null>(null);

  // Sort crops alphabetically by name
  const sortedCrops = useMemo(() => {
    return Object.values(crops).sort((a, b) => a.name.localeCompare(b.name));
  }, [crops]);

  // Filter crops by search query
  const filteredCrops = useMemo(() => {
    if (!searchQuery.trim()) return sortedCrops;
    const query = searchQuery.toLowerCase().trim();
    return sortedCrops.filter(crop =>
      crop.name.toLowerCase().includes(query)
    );
  }, [sortedCrops, searchQuery]);

  const handleBgColorChange = (cropId: string, newColor: string) => {
    const textColor = getContrastingTextColor(newColor);
    onUpdateCrop(cropId, { bgColor: newColor, textColor });
  };

  const handleTextColorChange = (cropId: string, newColor: string) => {
    onUpdateCrop(cropId, { textColor: newColor });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Crop Colors</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b flex-shrink-0">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search crops..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Crop list */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredCrops.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {searchQuery ? 'No matching crops found' : 'No crops defined'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filteredCrops.map((crop) => (
                <div
                  key={crop.id}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                >
                  {/* Color preview chip */}
                  <div
                    className="w-16 px-2 py-1 rounded text-xs font-medium text-center truncate flex-shrink-0"
                    style={{
                      backgroundColor: crop.bgColor || DEFAULT_CROP_COLOR.bg,
                      color: crop.textColor || DEFAULT_CROP_COLOR.text,
                    }}
                    title={crop.name}
                  >
                    {crop.name.length > 8 ? crop.name.slice(0, 8) + '...' : crop.name}
                  </div>

                  {/* Crop name */}
                  <span className="text-sm text-gray-700 flex-1 truncate">
                    {crop.name}
                  </span>

                  {/* Color pickers */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Background color picker */}
                    <div className="relative">
                      <input
                        type="color"
                        value={crop.bgColor || DEFAULT_CROP_COLOR.bg}
                        onChange={(e) => handleBgColorChange(crop.id, e.target.value)}
                        className="w-7 h-7 cursor-pointer rounded border border-gray-300"
                        title="Background color"
                      />
                    </div>

                    {/* Text color picker (expandable) */}
                    {editingCrop === crop.id ? (
                      <div className="relative">
                        <input
                          type="color"
                          value={crop.textColor || DEFAULT_CROP_COLOR.text}
                          onChange={(e) => handleTextColorChange(crop.id, e.target.value)}
                          onBlur={() => setEditingCrop(null)}
                          className="w-7 h-7 cursor-pointer rounded border border-gray-300"
                          title="Text color"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingCrop(crop.id)}
                        className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded border border-gray-300 hover:bg-gray-100"
                        title="Edit text color"
                      >
                        <span className="text-xs">T</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-between items-center flex-shrink-0 rounded-b-lg">
          <span className="text-sm text-gray-500">
            {filteredCrops.length} crop{filteredCrops.length === 1 ? '' : 's'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
