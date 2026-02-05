'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Z_INDEX } from '@/lib/z-index';
import type { SeedSource } from '@/lib/entities/planting';
import type { SeedMix } from '@/lib/entities/seed-mix';
import type { Variety } from '@/lib/entities/variety';
import { SeedMixEditorModal } from './SeedMixEditorModal';
import { VarietyEditorModal } from './VarietyEditorModal';

// =============================================================================
// Types
// =============================================================================

export interface VarietyOption {
  id: string;
  crop: string;
  name: string;
  supplier?: string;
  dtm?: number;
  deprecated?: boolean;
}

export interface SeedMixOption {
  id: string;
  crop: string;
  name: string;
  components: Array<{
    varietyId: string;
    percent: number;
  }>;
  deprecated?: boolean;
}

export interface SeedSourceSelectProps {
  /** Crop name to filter varieties/mixes */
  cropName: string;
  /** Current selected source */
  value?: SeedSource;
  /** Called when selection changes */
  onChange: (source?: SeedSource) => void;
  /** All varieties (will be filtered by crop) */
  varieties: Record<string, VarietyOption>;
  /** All seed mixes (will be filtered by crop) */
  seedMixes: Record<string, SeedMixOption>;
  /** IDs of varieties already in use (for marking) */
  usedVarietyIds?: Set<string>;
  /** IDs of mixes already in use (for marking) */
  usedMixIds?: Set<string>;
  /** Placeholder text when nothing selected */
  placeholder?: string;
  /** Additional CSS class */
  className?: string;
  /** Compact mode (smaller padding) */
  compact?: boolean;
  /** Called when a new mix is created - if provided, shows "Add Mix" button */
  onAddMix?: (mix: SeedMix) => void;
  /** All varieties for the mix editor (needed for onAddMix) */
  allVarieties?: Record<string, Variety>;
  /** All crops for the mix editor (needed for onAddMix) */
  crops?: Record<string, { id: string; name: string }>;
  /** Called when a new variety is added from mix editor */
  onAddVariety?: (variety: Variety) => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * A custom dropdown for choosing a seed source (variety or mix).
 * Supports hovering over mix options to see their components.
 */
export function SeedSourceSelect({
  cropName,
  value,
  onChange,
  varieties,
  seedMixes,
  usedVarietyIds,
  usedMixIds,
  placeholder = 'Select seed source...',
  className = '',
  compact = false,
  onAddMix,
  allVarieties,
  crops,
  onAddVariety,
}: SeedSourceSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [hoveredMixId, setHoveredMixId] = useState<string | null>(null);
  const [buttonHovered, setButtonHovered] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 200, flipUp: false });
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [showCreateMix, setShowCreateMix] = useState(false);
  const [showCreateVariety, setShowCreateVariety] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Can we show the "Add Mix" button?
  const canAddMix = onAddMix && allVarieties && crops;
  // Can we show the "Add Variety" button?
  const canAddVariety = !!onAddVariety;

  // Filter options for this crop
  const cropVarieties = Object.values(varieties).filter(
    (v) => v.crop === cropName && (!v.deprecated || (value?.type === 'variety' && value.id === v.id))
  );
  const cropMixes = Object.values(seedMixes).filter(
    (m) => m.crop === cropName && (!m.deprecated || (value?.type === 'mix' && value.id === m.id))
  );

  // Further filter by search query
  const searchLower = search.toLowerCase();
  const filteredVarieties = search
    ? cropVarieties.filter(
        (v) =>
          v.name.toLowerCase().includes(searchLower) ||
          v.supplier?.toLowerCase().includes(searchLower)
      )
    : cropVarieties;
  const filteredMixes = search
    ? cropMixes.filter((m) => m.name.toLowerCase().includes(searchLower))
    : cropMixes;

  const hasVarieties = filteredVarieties.length > 0;
  const hasMixes = filteredMixes.length > 0;

  // Get display text for current selection
  const getDisplayText = (): string => {
    if (!value) return '';
    if (value.type === 'variety') {
      const v = varieties[value.id];
      return v ? `${v.name}${v.supplier ? ` (${v.supplier})` : ''}` : 'Unknown';
    }
    if (value.type === 'mix') {
      const m = seedMixes[value.id];
      return m ? m.name : 'Unknown';
    }
    return '';
  };

  const handleOpen = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const dropdownHeight = 320; // maxHeight of dropdown
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const flipUp = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

      setDropdownPos({
        top: flipUp ? rect.top : rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 280),
        flipUp,
      });
    }
    setIsOpen(true);
    // Focus and select on next tick
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const handleClose = () => {
    setIsOpen(false);
    setHoveredMixId(null);
    setSearch('');
  };

  const handleSelect = (type: 'variety' | 'mix', id: string) => {
    onChange({ type, id });
    handleClose();
  };

  const handleSelectNone = () => {
    onChange(undefined);
    handleClose();
  };

  const handleMixHover = (mixId: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltipPos({
      top: rect.top,
      left: rect.right + 8,
    });
    setHoveredMixId(mixId);
  };

  const handleInputHover = (e: React.MouseEvent) => {
    if (value?.type === 'mix' && !isOpen) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setTooltipPos({
        top: rect.top,
        left: rect.right + 8,
      });
      setButtonHovered(true);
    }
  };

  const handleInputClick = () => {
    if (!isOpen) {
      handleOpen();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClose();
    } else if (e.key === 'Enter' && !isOpen) {
      handleOpen();
    }
  };

  // Close on escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const hoveredMix = hoveredMixId ? seedMixes[hoveredMixId] : null;
  const padding = compact ? 'px-2 py-1' : 'px-3 py-2';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? search : getDisplayText()}
          onChange={(e) => setSearch(e.target.value)}
          onClick={handleInputClick}
          onKeyDown={handleKeyDown}
          onMouseEnter={handleInputHover}
          onMouseLeave={() => setButtonHovered(false)}
          placeholder={placeholder}
          className={`w-full ${padding} pr-8 text-sm border rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
            isOpen ? 'border-blue-500' : 'border-gray-300 hover:border-gray-400'
          } ${value && !isOpen ? 'text-gray-900' : isOpen ? 'text-gray-900' : 'text-gray-500'}`}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Tooltip for hovering on selected mix (when dropdown is closed) */}
      {buttonHovered && !isOpen && value?.type === 'mix' && seedMixes[value.id] && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-48 max-w-64"
          style={{
            zIndex: Z_INDEX.MODAL + 10,
            top: tooltipPos.top,
            left: tooltipPos.left,
          }}
        >
          <div className="text-sm font-medium text-gray-800 mb-2">{seedMixes[value.id].name}</div>
          <div className="text-xs text-gray-600 space-y-1">
            {seedMixes[value.id].components.map((comp, idx) => {
              const variety = varieties[comp.varietyId];
              const pct = Math.round(comp.percent * 100);
              return (
                <div key={idx} className="flex justify-between gap-2">
                  <span className="truncate">
                    {variety ? `${variety.name}${variety.supplier ? ` (${variety.supplier})` : ''}` : comp.varietyId}
                  </span>
                  <span className="text-gray-500 flex-shrink-0">
                    {pct}% · {variety?.dtm ? `${variety.dtm}d` : '--d'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}

      {isOpen && typeof document !== 'undefined' && createPortal(
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0"
            style={{ zIndex: Z_INDEX.MODAL - 1 }}
            onClick={handleClose}
          />

          {/* Dropdown - use modal-level z-index to appear above panels */}
          <div
            className={`fixed bg-white border border-gray-200 rounded-lg shadow-lg flex ${dropdownPos.flipUp ? 'flex-col-reverse' : 'flex-col'}`}
            style={{
              zIndex: Z_INDEX.MODAL,
              ...(dropdownPos.flipUp
                ? { bottom: window.innerHeight - dropdownPos.top + 2, left: dropdownPos.left }
                : { top: dropdownPos.top, left: dropdownPos.left }),
              width: dropdownPos.width,
              minWidth: 200,
              maxHeight: 320,
            }}
          >
            {/* Scrollable list area */}
            <div className="overflow-auto flex-1">
              {/* None option - only show when not searching */}
              {!search && (
                <button
                  type="button"
                  onClick={handleSelectNone}
                  className={`w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${
                    !value ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                  }`}
                >
                  {placeholder}
                </button>
              )}

              {/* Varieties section */}
              {hasVarieties && (
                <>
                  <div className="px-3 py-1 text-xs font-medium text-gray-500 bg-gray-50 border-t border-b">
                    Varieties {search && `(${filteredVarieties.length})`}
                  </div>
                  {filteredVarieties.map((v) => {
                    const isUsed = usedVarietyIds?.has(v.id);
                    const isSelected = value?.type === 'variety' && value.id === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => handleSelect('variety', v.id)}
                        className={`w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${
                          isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                        }`}
                      >
                        {v.name}
                        {v.supplier ? ` (${v.supplier})` : ''}
                        {isUsed && <span className="text-green-600 ml-1">✓</span>}
                      </button>
                    );
                  })}
                </>
              )}

              {/* Seed Mixes section */}
              {hasMixes && (
                <>
                  <div className="px-3 py-1 text-xs font-medium text-gray-500 bg-gray-50 border-t border-b">
                    Seed Mixes {search && `(${filteredMixes.length})`}
                  </div>
                  {filteredMixes.map((m) => {
                    const isUsed = usedMixIds?.has(m.id);
                    const isSelected = value?.type === 'mix' && value.id === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleSelect('mix', m.id)}
                        onMouseEnter={(e) => handleMixHover(m.id, e)}
                        onMouseLeave={() => setHoveredMixId(null)}
                        className={`w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${
                          isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                        }`}
                      >
                        {m.name}
                        {isUsed && <span className="text-green-600 ml-1">✓</span>}
                      </button>
                    );
                  })}
                </>
              )}

              {/* No options message */}
              {!hasVarieties && !hasMixes && (
                <div className="px-3 py-2 text-sm text-gray-500 italic">
                  {search
                    ? `No matches for "${search}"`
                    : `No varieties or mixes for "${cropName}"`}
                </div>
              )}
            </div>

            {/* Fixed footer with add buttons */}
            {(canAddVariety || canAddMix) && (
              <div className="border-t flex-shrink-0">
                {canAddVariety && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateVariety(true);
                      handleClose();
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Variety
                  </button>
                )}
                {canAddMix && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateMix(true);
                      handleClose();
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-1 border-t"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create New Mix
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Tooltip for hovered mix - above the dropdown */}
          {hoveredMix && (
            <div
              className="fixed bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-48 max-w-64"
              style={{
                zIndex: Z_INDEX.MODAL + 10,
                top: tooltipPos.top,
                left: tooltipPos.left,
              }}
            >
              <div className="text-sm font-medium text-gray-800 mb-2">{hoveredMix.name}</div>
              <div className="text-xs text-gray-600 space-y-1">
                {hoveredMix.components.map((comp, idx) => {
                  const variety = varieties[comp.varietyId];
                  const pct = Math.round(comp.percent * 100);
                  return (
                    <div key={idx} className="flex justify-between gap-2">
                      <span className="truncate">
                        {variety ? `${variety.name}${variety.supplier ? ` (${variety.supplier})` : ''}` : comp.varietyId}
                      </span>
                      <span className="text-gray-500 flex-shrink-0">
                        {pct}% · {variety?.dtm ? `${variety.dtm}d` : '--d'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>,
        document.body
      )}

      {/* Create Variety Modal */}
      {showCreateVariety && canAddVariety && (
        <VarietyEditorModal
          variety={null}
          initialCrop={cropName}
          onSave={(newVariety) => {
            onAddVariety!(newVariety);
            setShowCreateVariety(false);
            // Auto-select the newly created variety
            onChange({ type: 'variety', id: newVariety.id });
          }}
          onClose={() => setShowCreateVariety(false)}
        />
      )}

      {/* Create Mix Modal */}
      {showCreateMix && canAddMix && (
        <SeedMixEditorModal
          mix={null}
          varieties={allVarieties}
          crops={crops}
          initialCrop={cropName}
          onSave={(newMix) => {
            onAddMix(newMix);
            setShowCreateMix(false);
            // Auto-select the newly created mix
            onChange({ type: 'mix', id: newMix.id });
          }}
          onClose={() => setShowCreateMix(false)}
          onAddVariety={onAddVariety}
        />
      )}
    </div>
  );
}

// =============================================================================
// With Default Toggle Variant
// =============================================================================

export interface SeedSourceSelectWithDefaultProps extends Omit<SeedSourceSelectProps, 'value' | 'onChange'> {
  /** Current custom source (when not using default) */
  customSource?: SeedSource;
  /** Whether to use the default source */
  useDefault: boolean;
  /** The default source from the spec */
  defaultSource?: SeedSource;
  /** Called when custom source changes */
  onSourceChange: (source?: SeedSource) => void;
  /** Called when useDefault toggle changes */
  onToggleDefault: (useDefault: boolean) => void;
}

/**
 * SeedSourceSelect with a "Use Default" checkbox.
 * Used when editing plantings that can inherit from their spec.
 */
export function SeedSourceSelectWithDefault({
  customSource,
  useDefault,
  defaultSource,
  onSourceChange,
  onToggleDefault,
  cropName,
  varieties,
  seedMixes,
  usedVarietyIds,
  usedMixIds,
  placeholder,
  className = '',
  compact = false,
  onAddMix,
  allVarieties,
  crops,
  onAddVariety,
}: SeedSourceSelectWithDefaultProps) {
  // Get display text for the default source
  const getSourceDisplay = (source?: SeedSource): string => {
    if (!source) return 'None';
    if (source.type === 'variety') {
      const v = varieties[source.id];
      return v ? `${v.name}${v.supplier ? ` (${v.supplier})` : ''}` : 'Unknown';
    }
    if (source.type === 'mix') {
      const m = seedMixes[source.id];
      return m ? m.name : 'Unknown';
    }
    return 'None';
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Use Default Checkbox - only show if there's a default */}
      {defaultSource && (
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={useDefault}
            onChange={(e) => onToggleDefault(e.target.checked)}
            className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <span className="text-gray-700">
            Use default: <span className="font-medium">{getSourceDisplay(defaultSource)}</span>
          </span>
        </label>
      )}

      {/* Custom source selector - only show when not using default */}
      {!useDefault && (
        <SeedSourceSelect
          cropName={cropName}
          value={customSource}
          onChange={onSourceChange}
          varieties={varieties}
          seedMixes={seedMixes}
          usedVarietyIds={usedVarietyIds}
          usedMixIds={usedMixIds}
          placeholder={placeholder}
          compact={compact}
          onAddMix={onAddMix}
          allVarieties={allVarieties}
          crops={crops}
          onAddVariety={onAddVariety}
        />
      )}

      {/* Show current default (read-only) when using default */}
      {useDefault && (
        <div className="text-sm text-gray-700 py-1">{getSourceDisplay(defaultSource)}</div>
      )}
    </div>
  );
}
