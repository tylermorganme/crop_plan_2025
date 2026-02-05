'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import type { PlantingSpec, TimingSettings } from '@/lib/entities/planting-specs';
import { copyConfig } from '@/lib/entities/planting-specs';
import type { Variety } from '@/lib/entities/variety';
import type { SeedMix } from '@/lib/entities/seed-mix';
import type { Product } from '@/lib/entities/product';
import type { Market } from '@/lib/entities/market';
import type { Crop } from '@/lib/entities/crop';
import PlantingSpecEditor from './PlantingSpecEditor';
import { Z_INDEX } from '@/lib/z-index';

interface PlantingSpecCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (spec: PlantingSpec) => void;
  /** All available specs to copy from */
  availableSpecs: PlantingSpec[];
  /** Existing identifiers in the plan's catalog (for uniqueness validation) */
  existingIdentifiers: string[];
  /** Varieties available for default seed source selection */
  varieties?: Record<string, Variety>;
  /** Seed mixes available for default seed source selection */
  seedMixes?: Record<string, SeedMix>;
  /** Products available for yield/revenue linking */
  products?: Record<string, Product>;
  /** Markets available for market split selection */
  markets?: Record<string, Market>;
  /** Crop entities for linking crop name to cropId (for colors) */
  crops?: Record<string, Crop>;
  /** Optional: Pre-select a spec to copy (skips the choose step) */
  initialSourceSpec?: PlantingSpec | null;
  /** Last frost date for weeks-from-frost calculation (ISO date string) */
  lastFrostDate?: string;
  /** Plan-level timing settings (optional, uses defaults if not provided) */
  timingSettings?: Partial<TimingSettings>;
}

type Step = 'choose' | 'edit';
type CreateMode = 'blank' | 'copy';

/**
 * Modal for creating a new PlantingSpec.
 * Two-step flow:
 * 1. Choose to start blank or copy from existing
 * 2. Edit the spec in PlantingSpecEditor
 */
export default function PlantingSpecCreator({
  isOpen,
  onClose,
  onSave,
  availableSpecs,
  existingIdentifiers,
  varieties,
  seedMixes,
  products,
  markets,
  crops,
  initialSourceSpec,
  lastFrostDate,
  timingSettings,
}: PlantingSpecCreatorProps) {
  const [step, setStep] = useState<Step>('choose');
  const [createMode, setCreateMode] = useState<CreateMode>('blank');
  const [sourceSpec, setSourceSpec] = useState<PlantingSpec | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Track if we opened with a pre-selected source (affects back button behavior)
  const openedWithSourceRef = useRef(false);

  // Handle initialSourceSpec changes - when provided, skip to edit step
  useEffect(() => {
    if (isOpen && initialSourceSpec != null) {
      openedWithSourceRef.current = true;
      // Use RAF to defer state updates and avoid flushSync warnings
      requestAnimationFrame(() => {
        setCreateMode('copy');
        setSourceSpec(copyConfig(initialSourceSpec));
        setStep('edit');
      });
    } else if (isOpen && initialSourceSpec == null) {
      openedWithSourceRef.current = false;
    }
  }, [isOpen, initialSourceSpec]);

  // Filter specs for copy selection
  const filteredSpecs = useMemo(() => {
    if (!searchQuery.trim()) return availableSpecs.slice(0, 50); // Show first 50 by default
    const query = searchQuery.toLowerCase();
    return availableSpecs
      .filter((s: PlantingSpec) =>
        // Use searchText if available, otherwise fall back to key fields
        s.searchText?.toLowerCase().includes(query) ||
        s.identifier.toLowerCase().includes(query) ||
        s.crop.toLowerCase().includes(query) ||
        s.category?.toLowerCase().includes(query)
      )
      .slice(0, 50);
  }, [availableSpecs, searchQuery]);

  // Reset state when modal closes
  const handleClose = () => {
    setStep('choose');
    setCreateMode('blank');
    setSourceSpec(null);
    setSearchQuery('');
    openedWithSourceRef.current = false;
    onClose();
  };

  // Handle starting blank
  const handleStartBlank = () => {
    setCreateMode('blank');
    setSourceSpec(null);
    setStep('edit');
  };

  // Handle selecting a spec to copy
  const handleSelectSpec = (spec: PlantingSpec) => {
    setCreateMode('copy');
    setSourceSpec(copyConfig(spec));
    setStep('edit');
  };

  // Handle save from editor
  const handleSave = (spec: PlantingSpec) => {
    onSave(spec);
    handleClose();
  };

  // Handle going back to choose step (or close if opened with initial source)
  const handleBack = () => {
    if (openedWithSourceRef.current) {
      // Opened via Copy button - close instead of going back
      handleClose();
    } else {
      setStep('choose');
      setSourceSpec(null);
    }
  };

  if (!isOpen) return null;

  // Step 2: Edit mode - show the PlantingSpecEditor
  if (step === 'edit') {
    return (
      <PlantingSpecEditor
        isOpen={true}
        spec={sourceSpec}
        onClose={handleBack}
        onSave={handleSave}
        mode="create"
        existingIdentifiers={existingIdentifiers}
        varieties={varieties}
        seedMixes={seedMixes}
        products={products}
        markets={markets}
        crops={crops}
        lastFrostDate={lastFrostDate}
        timingSettings={timingSettings}
      />
    );
  }

  // Step 1: Choose mode
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Create Custom Spec</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 flex-1 overflow-y-auto">
          <p className="text-sm text-gray-600 mb-6">
            Create a new planting spec for your plan. You can start from scratch or copy an existing spec.
          </p>

          {/* Option cards */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <button
              onClick={handleStartBlank}
              className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left"
            >
              <div className="text-2xl mb-2">+</div>
              <div className="font-semibold text-gray-900">Start Blank</div>
              <div className="text-sm text-gray-600">Create a new spec from scratch with default values</div>
            </button>
            <div className="p-4 border-2 border-blue-500 bg-blue-50 rounded-lg">
              <div className="text-2xl mb-2">&#8599;</div>
              <div className="font-semibold text-gray-900">Copy Existing</div>
              <div className="text-sm text-gray-600">Start from an existing spec and modify it</div>
            </div>
          </div>

          {/* Spec search and list for copy mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select a spec to copy:
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, crop, variant, or product..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
              autoFocus
            />
            <div className="border border-gray-200 rounded-md max-h-64 overflow-y-auto">
              {filteredSpecs.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">
                  No specs found matching &quot;{searchQuery}&quot;
                </div>
              ) : (
                filteredSpecs.map((spec) => (
                  <button
                    key={spec.id}
                    onClick={() => handleSelectSpec(spec)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
                  >
                    <div className="font-medium text-gray-900 text-sm">{spec.identifier}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {[spec.category, spec.growingStructure, spec.dtmBasis].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                ))
              )}
            </div>
            {filteredSpecs.length === 50 && !searchQuery && (
              <p className="text-xs text-gray-500 mt-2">
                Showing first 50 specs. Use search to find more.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end shrink-0">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
