/**
 * Column schema for SpecExplorer - single source of truth for all column metadata.
 *
 * Uses TanStack Table v8 meta property pattern to consolidate:
 * - Display name (header)
 * - Default width
 * - Default visibility
 * - Edit configuration (type, options)
 * - Value formatting
 * - Source type (static/calculated/mixed)
 * - Sort configuration
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { PlantingSpec } from '@/lib/planting-specs';
import columnAnalysis from '@/data/column-analysis.json';

// =============================================================================
// Types
// =============================================================================

export type ColumnSourceType = 'static' | 'calculated' | 'mixed' | 'empty' | 'unknown';

export type EditType = 'select' | 'text' | 'number' | 'seedSource';

/** Dynamic option key - options are derived from existing values in the data */
export type DynamicOptionKey = 'crop' | 'irrigation' | 'trellisType' | 'category' | 'growingStructure' | 'rowCover';

export interface EditConfig {
  type: EditType;
  /** Static options for select type */
  options?: string[];
  /** Dynamic options derived from column values at runtime */
  dynamicOptions?: DynamicOptionKey;
}

export interface ColumnMeta {
  /** Display name for column header (defaults to column id) */
  displayName?: string;
  /** Default width in pixels */
  defaultWidth: number;
  /** Show column by default */
  defaultVisible: boolean;
  /** Edit configuration (if editable) */
  edit?: EditConfig;
  /** Value formatter function */
  format?: (value: unknown) => string;
  /** Source type from Excel analysis */
  sourceType: ColumnSourceType;
  /** Is this column sortable */
  sortable: boolean;
}

// Extended PlantingSpec type with computed fields
export type CropWithRevenue = PlantingSpec & {
  revenuePerBed?: number | null;
  maxYieldPerWeek?: string;
  minYieldPerWeek?: string;
  inUse?: boolean;
  yieldPerHarvestDisplay?: string;
  totalYieldDisplay?: string;
  productsDisplay?: string;
  defaultSeedSourceDisplay?: string;
};

// =============================================================================
// Build source type lookup from column-analysis.json
// =============================================================================

const sourceTypeLookup: Record<string, ColumnSourceType> = {};
columnAnalysis.columns.forEach((col: { header: string; type: string }) => {
  sourceTypeLookup[col.header] = col.type as ColumnSourceType;
});

function getSourceType(columnId: string): ColumnSourceType {
  return sourceTypeLookup[columnId] ?? 'unknown';
}

// =============================================================================
// Formatters
// =============================================================================

function formatDefault(value: unknown): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'boolean') return value ? '✓' : '–';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
  }
  return String(value);
}

function formatCurrency(value: unknown): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'number') {
    return '$' + value.toFixed(2);
  }
  return formatDefault(value);
}

function formatBoolean(value: unknown): string {
  if (value === true) return '✓';
  return '–';
}

// =============================================================================
// Column Schema Definition
// =============================================================================

/**
 * Master column schema - defines ALL columns with their metadata.
 * Order in this array is the default column order.
 */
export const COLUMN_SCHEMA: Record<string, ColumnMeta> = {
  // Identity columns
  id: {
    displayName: 'ID',
    defaultWidth: 120,
    defaultVisible: false,
    sourceType: getSourceType('id'),
    sortable: true,
  },
  identifier: {
    displayName: 'Identifier',
    defaultWidth: 300,
    defaultVisible: true,
    sourceType: getSourceType('identifier'),
    sortable: true,
  },
  cropId: {
    displayName: 'Crop ID',
    defaultWidth: 120,
    defaultVisible: false,
    sourceType: 'static',
    sortable: true,
  },

  // Core crop info (editable)
  crop: {
    displayName: 'Crop',
    defaultWidth: 120,
    defaultVisible: true,
    edit: { type: 'select', dynamicOptions: 'crop' },
    sourceType: getSourceType('crop'),
    sortable: true,
  },
  category: {
    displayName: 'Category',
    defaultWidth: 120,
    defaultVisible: true,
    edit: { type: 'select', dynamicOptions: 'category' },
    sourceType: getSourceType('category'),
    sortable: true,
  },
  productsDisplay: {
    displayName: 'Products',
    defaultWidth: 200,
    defaultVisible: true,
    sourceType: 'calculated',
    sortable: true,
  },
  defaultSeedSourceDisplay: {
    displayName: 'Default Seed',
    defaultWidth: 180,
    defaultVisible: false,
    edit: { type: 'seedSource' },
    sourceType: 'calculated',
    sortable: true,
  },
  growingStructure: {
    displayName: 'Structure',
    defaultWidth: 120,
    defaultVisible: true,
    edit: { type: 'select', dynamicOptions: 'growingStructure' },
    sourceType: getSourceType('growingStructure'),
    sortable: true,
  },
  dtmBasis: {
    displayName: 'DTM Basis',
    defaultWidth: 120,
    defaultVisible: true,
    sourceType: getSourceType('dtmBasis'),
    sortable: true,
  },

  // Timing fields
  daysToGermination: {
    displayName: 'Days to Germ',
    defaultWidth: 100,
    defaultVisible: true,
    sourceType: getSourceType('daysToGermination'),
    sortable: true,
  },
  // Yield fields (calculated)
  totalYield: {
    displayName: 'Total Yield',
    defaultWidth: 120,
    defaultVisible: false,
    sourceType: 'calculated',
    sortable: true,
  },
  // Growing parameters (editable)
  rows: {
    displayName: 'Rows',
    defaultWidth: 60,
    defaultVisible: false,
    edit: { type: 'number' },
    sourceType: getSourceType('rows'),
    sortable: true,
  },
  spacing: {
    displayName: 'Spacing',
    defaultWidth: 70,
    defaultVisible: false,
    edit: { type: 'number' },
    sourceType: getSourceType('spacing'),
    sortable: true,
  },
  irrigation: {
    displayName: 'Irrigation',
    defaultWidth: 100,
    defaultVisible: false,
    edit: { type: 'select', dynamicOptions: 'irrigation' },
    sourceType: getSourceType('irrigation'),
    sortable: true,
  },
  trellisType: {
    displayName: 'Trellis',
    defaultWidth: 100,
    defaultVisible: false,
    edit: { type: 'select', dynamicOptions: 'trellisType' },
    sourceType: getSourceType('trellisType'),
    sortable: true,
  },
  rowCover: {
    displayName: 'Row Cover',
    defaultWidth: 100,
    defaultVisible: false,
    edit: { type: 'select', dynamicOptions: 'rowCover' },
    sourceType: getSourceType('rowCover'),
    sortable: true,
  },

  // Status fields
  deprecated: {
    displayName: 'Deprecated',
    defaultWidth: 80,
    defaultVisible: true,
    format: formatBoolean,
    sourceType: getSourceType('deprecated'),
    sortable: true,
  },
  isFavorite: {
    displayName: 'Favorite',
    defaultWidth: 80,
    defaultVisible: false,
    format: formatBoolean,
    sourceType: 'static',
    sortable: true,
  },
  inUse: {
    displayName: 'In Use',
    defaultWidth: 60,
    defaultVisible: true,
    format: formatBoolean,
    sourceType: 'calculated',
    sortable: true,
  },

  // Computed columns
  revenuePerBed: {
    displayName: 'Rev/Bed',
    defaultWidth: 100,
    defaultVisible: false,
    format: formatCurrency,
    sourceType: 'calculated',
    sortable: true,
  },
  maxYieldPerWeek: {
    displayName: 'Max Yield/Wk',
    defaultWidth: 140,
    defaultVisible: false,
    sourceType: 'calculated',
    sortable: false,
  },
  minYieldPerWeek: {
    displayName: 'Min Yield/Wk',
    defaultWidth: 140,
    defaultVisible: false,
    sourceType: 'calculated',
    sortable: false,
  },

  // Date fields
  targetFieldDate: {
    displayName: 'Target Field Date',
    defaultWidth: 110,
    defaultVisible: false,
    sourceType: getSourceType('targetFieldDate'),
    sortable: true,
  },

  // Other fields - add more as discovered
  searchText: {
    displayName: 'Search Text',
    defaultWidth: 150,
    defaultVisible: false,
    sourceType: 'calculated',
    sortable: false,
  },
};

// =============================================================================
// Derived Constants
// =============================================================================

/** Default column order (derived from schema keys) */
export const DEFAULT_COLUMN_ORDER = Object.keys(COLUMN_SCHEMA);

/** Default visible columns */
export const DEFAULT_VISIBLE_COLUMNS = Object.entries(COLUMN_SCHEMA)
  .filter(([, meta]) => meta.defaultVisible)
  .map(([id]) => id);

/** Editable columns mapping (for backward compatibility) */
export const EDITABLE_COLUMNS: Record<string, EditConfig> = Object.entries(COLUMN_SCHEMA)
  .filter(([, meta]) => meta.edit)
  .reduce((acc, [id, meta]) => {
    acc[id] = meta.edit!;
    return acc;
  }, {} as Record<string, EditConfig>);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get default width for a column
 */
export function getDefaultColumnWidth(columnId: string): number {
  const meta = COLUMN_SCHEMA[columnId];
  if (meta) return meta.defaultWidth;

  // Fallback heuristics for unknown columns
  if (columnId.toLowerCase().includes('date')) return 110;
  if (columnId.includes('yield') || columnId.includes('harvest')) return 140;
  return 120;
}

/**
 * Format a cell value for display
 */
export function formatCellValue(value: unknown, columnId: string): string {
  const meta = COLUMN_SCHEMA[columnId];
  if (meta?.format) return meta.format(value);
  return formatDefault(value);
}

/**
 * Get display name for a column header
 */
export function getColumnDisplayName(columnId: string): string {
  const meta = COLUMN_SCHEMA[columnId];
  return meta?.displayName ?? columnId;
}

/**
 * Get background color class based on column source type
 */
export function getColumnBgClass(columnId: string, isHeader: boolean = false): string {
  const meta = COLUMN_SCHEMA[columnId];
  const type = meta?.sourceType ?? 'unknown';

  if (isHeader) {
    switch (type) {
      case 'static': return 'bg-blue-100';
      case 'calculated': return 'bg-green-100';
      case 'mixed': return 'bg-amber-100';
      case 'empty': return 'bg-gray-200';
      default: return 'bg-gray-50';
    }
  }

  // Lighter colors for cells
  switch (type) {
    case 'static': return 'bg-blue-50/50';
    case 'calculated': return 'bg-green-50/50';
    case 'mixed': return 'bg-amber-50/50';
    case 'empty': return 'bg-gray-100/50';
    default: return '';
  }
}

/**
 * Check if a column is editable
 */
export function isColumnEditable(columnId: string): boolean {
  return COLUMN_SCHEMA[columnId]?.edit !== undefined;
}

/**
 * Get header text color class - blue for editable columns, gray for read-only
 */
export function getHeaderTextClass(columnId: string): string {
  return isColumnEditable(columnId) ? 'text-blue-700' : 'text-gray-700';
}

/**
 * Get edit config for a column
 */
export function getColumnEditConfig(columnId: string): EditConfig | undefined {
  return COLUMN_SCHEMA[columnId]?.edit;
}

/**
 * Get column meta, with fallback for unknown columns
 */
export function getColumnMeta(columnId: string): ColumnMeta {
  return COLUMN_SCHEMA[columnId] ?? {
    defaultWidth: 120,
    defaultVisible: false,
    sourceType: 'unknown',
    sortable: true,
  };
}

// =============================================================================
// TanStack Table Column Definitions
// =============================================================================

/**
 * Create TanStack Table column definitions from schema.
 * Call this with the list of column IDs you want to display.
 */
export function createColumnDefs(columnIds: string[]): ColumnDef<CropWithRevenue>[] {
  return columnIds.map(id => {
    const meta = getColumnMeta(id);

    return {
      id,
      accessorFn: (row) => row[id as keyof CropWithRevenue],
      header: meta.displayName ?? id,
      size: meta.defaultWidth,
      meta: meta,
      // Cell rendering handled by table component
    } as ColumnDef<CropWithRevenue>;
  });
}
