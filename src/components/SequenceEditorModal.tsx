'use client';

import { useState, useEffect, useMemo } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { Z_INDEX } from '@/lib/z-index';
import { computeSequenceDate } from '@/lib/entities/planting-sequence';
import type { Planting } from '@/lib/entities/planting';
import type { PlantingSequence } from '@/lib/entities/planting-sequence';
import type { PlantingSpec } from '@/lib/entities/planting-specs';
import type { Bed } from '@/lib/entities/bed';

interface SequenceEditorModalProps {
  isOpen: boolean;
  sequence: PlantingSequence;
  plantings: Planting[];
  specs: Record<string, PlantingSpec>;
  beds: Record<string, Bed>;
  onClose: () => void;
  onUpdateOffset: (newOffsetDays: number) => void;
  onUpdateName: (newName: string | undefined) => void;
  onUnlinkPlanting: (plantingId: string) => void;
  onReorderSlots: (newSlotAssignments: { plantingId: string; slot: number }[]) => void;
}

interface SlotInfo {
  slot: number;
  planting: Planting | undefined;
  computedDate: string;
  cropName: string;
  bedName: string | null;
}

export default function SequenceEditorModal({
  isOpen,
  sequence,
  plantings,
  specs,
  beds,
  onClose,
  onUpdateOffset,
  onUpdateName,
  onUnlinkPlanting,
  onReorderSlots,
}: SequenceEditorModalProps) {
  const [name, setName] = useState(sequence.name ?? '');
  const [offsetDays, setOffsetDays] = useState(sequence.offsetDays);

  // Reset form when modal opens or sequence changes
  useEffect(() => {
    if (isOpen) {
      setName(sequence.name ?? '');
      setOffsetDays(sequence.offsetDays);
    }
  }, [isOpen, sequence]);

  // Find anchor planting (slot 0)
  const anchor = useMemo(() => {
    return plantings.find(p => p.sequenceSlot === 0);
  }, [plantings]);

  // Build slot info list with computed dates
  const slots = useMemo(() => {
    if (!anchor) return [];

    // Find max slot number
    const maxSlot = Math.max(...plantings.map(p => p.sequenceSlot ?? 0));

    // Build slots array from 0 to maxSlot, showing gaps
    const slotList: SlotInfo[] = [];
    for (let slot = 0; slot <= maxSlot; slot++) {
      const planting = plantings.find(p => p.sequenceSlot === slot);
      const computedDate = slot === 0
        ? anchor.fieldStartDate
        : computeSequenceDate(
            anchor.fieldStartDate,
            slot,
            offsetDays,
            planting?.overrides?.additionalDaysInField ?? 0
          );

      let cropName = '';
      if (planting) {
        const spec = specs[planting.specId];
        cropName = spec?.identifier ?? spec?.crop ?? planting.specId;
      }

      let bedName: string | null = null;
      if (planting?.startBed) {
        bedName = beds[planting.startBed]?.name ?? null;
      }

      slotList.push({
        slot,
        planting,
        computedDate,
        cropName,
        bedName,
      });
    }

    return slotList;
  }, [plantings, anchor, offsetDays, specs, beds]);

  // Check if offset has changed
  const offsetChanged = offsetDays !== sequence.offsetDays;
  const nameChanged = (name.trim() || undefined) !== (sequence.name ?? undefined);
  const hasChanges = offsetChanged || nameChanged;

  const handleSave = () => {
    if (offsetChanged) {
      onUpdateOffset(offsetDays);
    }
    if (nameChanged) {
      onUpdateName(name.trim() || undefined);
    }
    onClose();
  };

  const handleMoveUp = (slot: number) => {
    if (slot <= 1) return; // Can't move anchor or slot 1 up

    const currentPlanting = slots.find(s => s.slot === slot)?.planting;
    const previousSlot = slots.find(s => s.slot === slot - 1);

    if (!currentPlanting) return;

    const newAssignments: { plantingId: string; slot: number }[] = [];

    // Swap slots
    if (previousSlot?.planting) {
      newAssignments.push({ plantingId: previousSlot.planting.id, slot: slot });
    }
    newAssignments.push({ plantingId: currentPlanting.id, slot: slot - 1 });

    // Keep other plantings unchanged
    for (const p of plantings) {
      if (p.id !== currentPlanting.id && p.id !== previousSlot?.planting?.id) {
        newAssignments.push({ plantingId: p.id, slot: p.sequenceSlot ?? 0 });
      }
    }

    onReorderSlots(newAssignments);
  };

  const handleMoveDown = (slot: number) => {
    if (slot === 0) return; // Can't move anchor
    const maxSlot = slots.length - 1;
    if (slot >= maxSlot) return; // Already at bottom

    const currentPlanting = slots.find(s => s.slot === slot)?.planting;
    const nextSlot = slots.find(s => s.slot === slot + 1);

    if (!currentPlanting) return;

    const newAssignments: { plantingId: string; slot: number }[] = [];

    // Swap slots
    if (nextSlot?.planting) {
      newAssignments.push({ plantingId: nextSlot.planting.id, slot: slot });
    }
    newAssignments.push({ plantingId: currentPlanting.id, slot: slot + 1 });

    // Keep other plantings unchanged
    for (const p of plantings) {
      if (p.id !== currentPlanting.id && p.id !== nextSlot?.planting?.id) {
        newAssignments.push({ plantingId: p.id, slot: p.sequenceSlot ?? 0 });
      }
    }

    onReorderSlots(newAssignments);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Edit Sequence</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-grow">
          {/* Sequence info */}
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="inline-flex items-center px-2 py-1 bg-purple-100 text-purple-800 rounded font-medium">
              {sequence.id}
            </span>
            <span>{plantings.length} plantings</span>
          </div>

          {/* Name input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sequence name <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Spring Cilantro"
              className="w-full px-3 py-2 text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Offset input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Days between each planting
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="365"
                value={offsetDays}
                onChange={(e) => setOffsetDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 7)))}
                className="w-24 px-3 py-2 text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <span className="text-sm text-gray-500">days (1-365)</span>
              {offsetChanged && (
                <span className="text-xs text-amber-600 font-medium ml-2">
                  (dates will update)
                </span>
              )}
            </div>
          </div>

          {/* Plantings list */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Plantings
            </label>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
              {slots.map((slotInfo) => (
                <div
                  key={slotInfo.slot}
                  className={`p-3 flex items-center gap-3 ${
                    slotInfo.planting ? 'bg-white' : 'bg-gray-50'
                  }`}
                >
                  {/* Slot number badge */}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 ${
                      slotInfo.slot === 0
                        ? 'bg-purple-100 text-purple-800'
                        : slotInfo.planting
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    #{slotInfo.slot + 1}
                  </div>

                  {/* Planting info */}
                  {slotInfo.planting ? (
                    <div className="flex-grow min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 truncate">
                          {slotInfo.cropName}
                        </span>
                        <span className="text-xs text-gray-500">
                          {slotInfo.planting.id}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 flex items-center gap-2">
                        <span>
                          {isValid(parseISO(slotInfo.computedDate))
                            ? format(parseISO(slotInfo.computedDate), 'MMM d, yyyy')
                            : slotInfo.computedDate}
                        </span>
                        {slotInfo.bedName && (
                          <>
                            <span className="text-gray-400">·</span>
                            <span>Bed {slotInfo.bedName}</span>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-grow text-gray-400 italic">
                      Empty slot
                    </div>
                  )}

                  {/* Actions */}
                  {slotInfo.planting && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Move up/down buttons */}
                      {slotInfo.slot > 0 && (
                        <>
                          <button
                            onClick={() => handleMoveUp(slotInfo.slot)}
                            disabled={slotInfo.slot <= 1}
                            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move up"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleMoveDown(slotInfo.slot)}
                            disabled={slotInfo.slot >= slots.length - 1}
                            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move down"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </>
                      )}
                      {/* Unlink button */}
                      <button
                        onClick={() => {
                          if (confirm(`Remove ${slotInfo.cropName} from this sequence?`)) {
                            onUnlinkPlanting(slotInfo.planting!.id);
                          }
                        }}
                        className="p-1 text-gray-400 hover:text-red-500"
                        title="Remove from sequence"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Date preview when offset changes */}
          {offsetChanged && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="text-sm font-medium text-amber-800 mb-2">
                Preview with new offset
              </div>
              <div className="flex flex-wrap gap-2">
                {slots.filter(s => s.planting).slice(0, 6).map((s) => (
                  <span
                    key={s.slot}
                    className={`inline-flex items-center px-2 py-1 rounded text-xs ${
                      s.slot === 0
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    #{s.slot + 1}: {format(parseISO(s.computedDate), 'MMM d')}
                  </span>
                ))}
                {slots.filter(s => s.planting).length > 6 && (
                  <span className="text-xs text-amber-600">
                    ...and {slots.filter(s => s.planting).length - 6} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3 rounded-b-lg flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            {hasChanges ? 'Cancel' : 'Close'}
          </button>
          {hasChanges && (
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Save Changes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
