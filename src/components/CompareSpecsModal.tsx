'use client';

import React, { useState, useMemo } from 'react';
import { Z_INDEX } from '@/lib/z-index';
import type { PlantingSpec, ProductYield, TrayStage } from '@/lib/entities/planting-specs';
import type { Product } from '@/lib/entities/product';
import type { SeedSource } from '@/lib/entities/planting';

interface CompareSpecsModalProps {
  isOpen: boolean;
  specs: PlantingSpec[];
  onClose: () => void;
  products?: Record<string, Product>;
}

interface FieldGroup {
  name: string;
  fields: FieldDef[];
}

interface FieldDef {
  key: keyof PlantingSpec | string;
  label: string;
  format?: (value: unknown, spec: PlantingSpec, products?: Record<string, Product>) => string;
}

// Field definitions organized by group
const FIELD_GROUPS: FieldGroup[] = [
  {
    name: 'Identity',
    fields: [
      { key: 'identifier', label: 'Identifier' },
      { key: 'crop', label: 'Crop' },
      { key: 'category', label: 'Category' },
    ],
  },
  {
    name: 'Spacing',
    fields: [
      { key: 'rows', label: 'Rows/bed' },
      { key: 'spacing', label: 'In-row spacing', format: (v) => v ? `${v}"` : '—' },
      { key: 'growingStructure', label: 'Structure' },
      { key: 'irrigation', label: 'Irrigation' },
      { key: 'trellisType', label: 'Trellis' },
      { key: 'rowCover', label: 'Row Cover' },
    ],
  },
  {
    name: 'Timing',
    fields: [
      { key: 'normalMethod', label: 'DTM Method' },
      { key: 'dtm', label: 'DTM (legacy)' },
      { key: 'daysToGermination', label: 'Days to Germination' },
      { key: 'assumedTransplantDays', label: 'Assumed TP Days' },
      {
        key: 'trayStages',
        label: 'Tray Stages',
        format: (v) => {
          const stages = v as TrayStage[] | undefined;
          if (!stages?.length) return '—';
          return stages.map((s, i) => `${i + 1}: ${s.days}d ${s.cellsPerTray ? `(${s.cellsPerTray}-cell)` : ''}`).join(', ');
        },
      },
    ],
  },
  {
    name: 'Harvest & Yield',
    fields: [
      {
        key: 'productYields',
        label: 'Product Yields',
        format: (v, _spec, products) => {
          const yields = v as ProductYield[] | undefined;
          if (!yields?.length) return '—';
          return yields.map((py) => {
            const product = products?.[py.productId];
            const name = product ? `${product.product} (${product.unit})` : py.productId;
            const harvests = py.numberOfHarvests > 1
              ? `${py.numberOfHarvests}x @ ${py.daysBetweenHarvest || 0}d`
              : '1x';
            return `${name}: DTM ${py.dtm}, ${harvests}`;
          }).join(' | ');
        },
      },
      { key: 'harvestWindow', label: 'Harvest Window (legacy)' },
      { key: 'numberOfHarvests', label: '# Harvests (legacy)' },
      { key: 'daysBetweenHarvest', label: 'Days Between (legacy)' },
      { key: 'yieldFormula', label: 'Yield Formula (legacy)' },
    ],
  },
  {
    name: 'Seed',
    fields: [
      { key: 'seedsPerBed', label: 'Seeds/Bed' },
      { key: 'seedsPerPlanting', label: 'Seeds/Planting' },
      { key: 'safetyFactor', label: 'Safety Factor', format: (v) => v ? `${v}x` : '—' },
      { key: 'seedingFactor', label: 'Seeding Factor', format: (v) => v ? `${v}x` : '—' },
      {
        key: 'defaultSeedSource',
        label: 'Default Seed Source',
        format: (v) => {
          const src = v as SeedSource | undefined;
          if (!src) return '—';
          if (src.type === 'variety') return `Variety: ${src.id}`;
          if (src.type === 'mix') return `Mix: ${src.id}`;
          return '—';
        },
      },
    ],
  },
  {
    name: 'Market',
    fields: [
      {
        key: 'defaultMarketSplit',
        label: 'Default Market Split',
        format: (v) => {
          const split = v as PlantingSpec['defaultMarketSplit'];
          if (!split) return '—';
          return Object.entries(split)
            .filter(([, pct]) => pct > 0)
            .map(([market, pct]) => `${market}: ${pct}%`)
            .join(', ');
        },
      },
    ],
  },
  {
    name: 'Status',
    fields: [
      { key: 'deprecated', label: 'Deprecated', format: (v) => v ? 'Yes' : 'No' },
      { key: 'perennial', label: 'Perennial', format: (v) => v ? 'Yes' : 'No' },
      { key: 'isFavorite', label: 'Favorite', format: (v) => v ? 'Yes' : 'No' },
      { key: 'targetFieldDate', label: 'Target Field Date' },
      {
        key: 'createdAt',
        label: 'Created At',
        format: (v) => v ? new Date(v as string).toLocaleString() : '—',
      },
      {
        key: 'updatedAt',
        label: 'Updated At',
        format: (v) => v ? new Date(v as string).toLocaleString() : '—',
      },
    ],
  },
];

function formatValue(
  value: unknown,
  fieldDef: FieldDef,
  spec: PlantingSpec,
  products?: Record<string, Product>
): string {
  if (fieldDef.format) {
    return fieldDef.format(value, spec, products);
  }
  if (value === undefined || value === null || value === '') {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length ? JSON.stringify(value) : '—';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function getFieldValue(spec: PlantingSpec, key: string): unknown {
  return (spec as unknown as Record<string, unknown>)[key];
}

export default function CompareSpecsModal({
  isOpen,
  specs,
  onClose,
  products,
}: CompareSpecsModalProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Track which fields have differences
  const fieldDiffs = useMemo(() => {
    const diffs = new Set<string>();
    for (const group of FIELD_GROUPS) {
      for (const field of group.fields) {
        const values = specs.map((c) => {
          const val = getFieldValue(c, field.key);
          return formatValue(val, field, c, products);
        });
        // Check if all values are the same
        const unique = new Set(values);
        if (unique.size > 1) {
          diffs.add(field.key);
        }
      }
    }
    return diffs;
  }, [specs, products]);

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen || specs.length < 2) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: Z_INDEX.MODAL }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Modal */}
      <div
        className="relative bg-white rounded-lg shadow-xl w-full max-w-5xl mx-4 max-h-[85vh] flex flex-col"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">
            Compare Specs ({specs.length})
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="sticky top-0 bg-white">
                <th className="text-left p-2 border-b-2 border-gray-300 font-medium text-gray-600 min-w-[180px]">
                  Field
                </th>
                {specs.map((spec) => (
                  <th
                    key={spec.id}
                    className="text-left p-2 border-b-2 border-gray-300 font-medium text-gray-900 min-w-[180px]"
                  >
                    {spec.identifier || spec.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FIELD_GROUPS.map((group) => {
                const isCollapsed = collapsedGroups.has(group.name);
                // Check if any field in group has differences
                const groupHasDiffs = group.fields.some((f) => fieldDiffs.has(f.key));

                return (
                  <React.Fragment key={group.name}>
                    {/* Group header */}
                    <tr
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => toggleGroup(group.name)}
                    >
                      <td
                        colSpan={specs.length + 1}
                        className="py-2 px-2 font-semibold text-gray-700 bg-gray-100 border-t border-gray-200"
                      >
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-gray-400">
                            {isCollapsed ? '▶' : '▼'}
                          </span>
                          {group.name}
                          {groupHasDiffs && (
                            <span className="text-xs font-normal text-amber-600">
                              (has differences)
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>

                    {/* Field rows */}
                    {!isCollapsed &&
                      group.fields.map((field) => {
                        const hasDiff = fieldDiffs.has(field.key);

                        return (
                          <tr key={field.key} className="hover:bg-gray-50">
                            <td className="p-2 border-b border-gray-100 text-gray-600 font-medium">
                              {field.label}
                            </td>
                            {specs.map((spec) => {
                              const value = getFieldValue(spec, field.key);
                              const formatted = formatValue(value, field, spec, products);

                              return (
                                <td
                                  key={spec.id}
                                  className={`p-2 border-b border-gray-100 ${
                                    hasDiff ? 'bg-amber-50' : ''
                                  }`}
                                >
                                  <span className="text-gray-900 break-words">
                                    {formatted}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-between items-center shrink-0 rounded-b-lg">
          <div className="text-sm text-gray-500">
            <span className="inline-block w-3 h-3 bg-amber-50 border border-amber-200 mr-1 align-middle"></span>
            Cells with differences are highlighted
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
