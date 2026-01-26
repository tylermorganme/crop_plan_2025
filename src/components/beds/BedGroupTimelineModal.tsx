'use client';

import { useMemo } from 'react';
import { parseISO } from 'date-fns';
import type { BedGroup, Bed } from '@/lib/entities';
import type { TimelineCrop, CropBoxDisplayConfig } from '@/lib/entities/plan';
import type { CropConfig } from '@/lib/entities/crop-config';
import type { Product } from '@/lib/entities/product';
import { DEFAULT_CROP_COLOR } from '@/lib/entities/crop';
import { Z_INDEX } from '@/lib/z-index';
import { calculateStacking, type StackableItem } from '@/lib/timeline-stacking';
import {
  resolveTemplate,
  DEFAULT_HEADER_TEMPLATE,
  DEFAULT_DESCRIPTION_TEMPLATE,
  type CropForDisplay,
} from '@/components/CropBoxDisplayEditor';

// =============================================================================
// TYPES
// =============================================================================

interface BedGroupTimelineModalProps {
  group: BedGroup;
  beds: Bed[];
  crops: TimelineCrop[];
  planYear: number;
  onClose: () => void;
  /** Crop box display configuration for text formatting */
  cropBoxDisplay?: CropBoxDisplayConfig;
  /** Crop catalog for template resolution */
  cropCatalog?: Record<string, CropConfig>;
  /** Products for template resolution */
  products?: Record<string, Product>;
}

interface CropBlock extends StackableItem {
  name: string;
  bgColor: string;
  textColor: string;
  /** Original crop data for template resolution */
  crop: TimelineCrop;
}

// =============================================================================
// UTILITIES
// =============================================================================

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/**
 * Convert a date to a percentage of the year (0-100).
 */
function dateToYearPercent(dateStr: string, year: number): number {
  const date = parseISO(dateStr);
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);
  const yearDuration = yearEnd.getTime() - yearStart.getTime();
  const elapsed = date.getTime() - yearStart.getTime();
  return Math.max(0, Math.min(100, (elapsed / yearDuration) * 100));
}

// =============================================================================
// COMPONENT
// =============================================================================

export default function BedGroupTimelineModal({
  group,
  beds,
  crops,
  planYear,
  onClose,
  cropBoxDisplay,
  cropCatalog,
  products,
}: BedGroupTimelineModalProps) {
  // Sort beds by displayOrder
  const sortedBeds = useMemo(
    () => [...beds].sort((a, b) => a.displayOrder - b.displayOrder),
    [beds]
  );

  // Group crops by bed name
  const cropsByBed = useMemo(() => {
    const map = new Map<string, TimelineCrop[]>();
    for (const crop of crops) {
      if (!crop.resource) continue;
      const list = map.get(crop.resource) ?? [];
      list.push(crop);
      map.set(crop.resource, list);
    }
    return map;
  }, [crops]);

  // Process each bed's crops with stacking
  const bedRows = useMemo(() => {
    return sortedBeds.map((bed) => {
      const bedCrops = cropsByBed.get(bed.name) ?? [];

      // Convert to blocks with percentages
      const blocks: CropBlock[] = bedCrops.map((crop) => {
        const startPercent = dateToYearPercent(crop.startDate, planYear);
        const endPercent = dateToYearPercent(crop.endDate, planYear);
        return {
          id: crop.id,
          start: startPercent,
          end: endPercent,
          name: crop.name,
          bgColor: crop.bgColor || DEFAULT_CROP_COLOR.bg,
          textColor: crop.textColor || DEFAULT_CROP_COLOR.text,
          crop, // Store original for template resolution
        };
      });

      // Calculate stacking
      const stacked = calculateStacking(blocks, { allowTouching: true });

      return {
        bed,
        crops: stacked.items,
        maxLevel: stacked.maxLevel,
      };
    });
  }, [sortedBeds, cropsByBed, planYear]);

  // Calculate row height based on max stacking (1.5x standard height)
  const ROW_HEIGHT = 54;
  const CROP_PADDING = 2;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: Z_INDEX.MODAL }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">
            {group.name} Timeline
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Timeline content */}
        <div className="flex-1 overflow-auto">
          {/* Month headers */}
          <div className="sticky top-0 bg-white border-b z-10">
            <div className="flex">
              {/* Bed label column */}
              <div className="w-16 shrink-0 px-2 py-1 text-xs text-gray-500 font-medium border-r bg-gray-50">
                Bed
              </div>
              {/* Month columns */}
              <div className="flex-1 flex">
                {MONTHS.map((month, i) => (
                  <div
                    key={i}
                    className="flex-1 text-center text-xs text-gray-500 font-medium py-1 border-r last:border-r-0"
                  >
                    {month}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bed rows */}
          <div>
            {bedRows.map(({ bed, crops: stackedCrops, maxLevel }, rowIndex) => {
              const rowHeight = Math.max(ROW_HEIGHT, maxLevel * (ROW_HEIGHT - 8));
              const cropHeight = maxLevel > 1
                ? (rowHeight - CROP_PADDING * 2) / maxLevel
                : rowHeight - CROP_PADDING * 2;

              return (
                <div
                  key={bed.id}
                  className={`flex border-b ${rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                  style={{ height: rowHeight }}
                >
                  {/* Bed label */}
                  <div className="w-16 shrink-0 px-2 flex items-center text-sm font-medium text-gray-700 border-r bg-inherit">
                    {bed.name}
                  </div>

                  {/* Timeline area */}
                  <div className="flex-1 relative">
                    {/* Month grid lines */}
                    <div className="absolute inset-0 flex pointer-events-none">
                      {MONTHS.map((_, i) => (
                        <div key={i} className="flex-1 border-r border-gray-100 last:border-r-0" />
                      ))}
                    </div>

                    {/* Crop blocks */}
                    {stackedCrops.map((block) => {
                      const width = block.end - block.start;
                      const top = CROP_PADDING + block.stackLevel * cropHeight;
                      const headerText = resolveTemplate(
                        cropBoxDisplay?.headerTemplate ?? DEFAULT_HEADER_TEMPLATE,
                        block.crop as CropForDisplay,
                        { cropCatalog, products }
                      );
                      const descText = resolveTemplate(
                        cropBoxDisplay?.descriptionTemplate ?? DEFAULT_DESCRIPTION_TEMPLATE,
                        block.crop as CropForDisplay,
                        { cropCatalog, products }
                      );

                      return (
                        <div
                          key={block.id}
                          className="absolute rounded text-xs overflow-hidden whitespace-nowrap px-1 flex flex-col justify-center border"
                          style={{
                            left: `${block.start}%`,
                            width: `${Math.max(0.5, width)}%`,
                            top,
                            height: cropHeight - 2,
                            backgroundColor: block.bgColor,
                            color: block.textColor,
                            borderColor: block.textColor,
                          }}
                          title={`${headerText}\n${descText}`}
                        >
                          {width > 3 && (
                            <>
                              <div className="text-sm font-bold truncate leading-tight">{headerText}</div>
                              {cropHeight > 30 && (
                                <div className="text-xs opacity-90 truncate leading-tight">{descText}</div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Empty state */}
          {sortedBeds.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              No beds in this group
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t bg-gray-50 rounded-b-lg flex items-center justify-between shrink-0">
          <div className="text-sm text-gray-600">
            {sortedBeds.length} bed{sortedBeds.length !== 1 ? 's' : ''} · {crops.length} planting{crops.length !== 1 ? 's' : ''}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
