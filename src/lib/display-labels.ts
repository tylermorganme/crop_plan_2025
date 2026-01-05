/**
 * Centralized Display Labels
 *
 * Single source of truth for converting internal codes to human-readable display text.
 * This module standardizes how field names and enum values are presented in the UI.
 *
 * NAMING CONVENTIONS:
 * - Internal codes use lowercase-hyphenated format: 'direct-seed', 'from-seeding'
 * - Field names use camelCase: 'plantingsPerBed', 'daysBetweenHarvest'
 * - Display labels use Title Case with spaces: 'Direct Seed', 'Days Between Harvest'
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/** Planting method - how the crop is actually grown */
export type PlantingMethod = 'direct-seed' | 'transplant' | 'perennial';

/** Normal method - how DTM was measured for this crop */
export type NormalMethod = 'from-seeding' | 'from-transplant' | 'total-time';

/** Growing structure - where the crop is grown */
export type GrowingStructure = 'field' | 'greenhouse' | 'high-tunnel';

// =============================================================================
// LABEL MAPS
// =============================================================================

/** Display labels for planting methods */
export const PLANTING_METHOD_LABELS: Record<PlantingMethod, string> = {
  'direct-seed': 'Direct Seed',
  'transplant': 'Transplant',
  'perennial': 'Perennial',
};

/** Display labels for normal methods (how DTM was measured) */
export const NORMAL_METHOD_LABELS: Record<NormalMethod, string> = {
  'from-seeding': 'From Seeding',
  'from-transplant': 'From Transplant',
  'total-time': 'Total Time',
};

/** Display labels for growing structures */
export const GROWING_STRUCTURE_LABELS: Record<GrowingStructure, string> = {
  'field': 'Field',
  'greenhouse': 'Greenhouse',
  'high-tunnel': 'High Tunnel',
};

/** Display labels for formula variables */
export const FORMULA_VARIABLE_LABELS: Record<string, string> = {
  plantingsPerBed: 'Plantings per Bed',
  daysBetweenHarvest: 'Days Between Harvest',
  bedFeet: 'Bed Length (ft)',
  harvests: 'Number of Harvests',
  rows: 'Number of Rows',
  spacing: 'In-row Spacing (in)',
  seeds: 'Seeds per Bed',
  seedToHarvest: 'Seed to Harvest',
  daysToMaturity: 'Days to Maturity',
  daysInCells: 'Days in Greenhouse',
  harvestWindow: 'Harvest Window',
};

/** Display labels for common field names */
export const FIELD_LABELS: Record<string, string> = {
  // Core identifiers
  identifier: 'Identifier',
  crop: 'Crop',
  variant: 'Variant',
  product: 'Product',
  category: 'Category',

  // Methods and structure
  plantingMethod: 'Planting Method',
  normalMethod: 'DTM Measured From',
  growingStructure: 'Growing Structure',

  // Timing fields
  dtm: 'Days to Maturity',
  daysToGermination: 'Days to Germination',
  daysInCells: 'Days in Greenhouse',
  seedToHarvest: 'Seed to Harvest',
  harvestWindow: 'Harvest Window',
  targetFieldDate: 'Target Field Date',

  // Harvest fields
  numberOfHarvests: 'Number of Harvests',
  daysBetweenHarvest: 'Days Between Harvest',
  harvestBufferDays: 'Harvest Buffer Days',
  postHarvestFieldDays: 'Post-Harvest Field Days',

  // Yield fields
  yieldFormula: 'Yield Formula',
  yieldUnit: 'Yield Unit',
  yieldPerHarvest: 'Yield per Harvest',

  // Spacing fields
  rows: 'Rows',
  spacing: 'In-row Spacing',
  plantingsPerBed: 'Plantings per Bed',

  // Status
  deprecated: 'Deprecated',
  perennial: 'Perennial',
};

// =============================================================================
// FORMATTER FUNCTIONS
// =============================================================================

/**
 * Format a planting method code to display text.
 * Returns the code itself if not recognized (graceful fallback).
 */
export function formatPlantingMethod(code: string | undefined): string {
  if (!code) return '–';
  return PLANTING_METHOD_LABELS[code as PlantingMethod] ?? code;
}

/**
 * Format a normal method code to display text.
 * Returns the code itself if not recognized (graceful fallback).
 */
export function formatNormalMethod(code: string | undefined): string {
  if (!code) return '–';
  return NORMAL_METHOD_LABELS[code as NormalMethod] ?? code;
}

/**
 * Format a growing structure code to display text.
 * Returns the code itself if not recognized (graceful fallback).
 */
export function formatGrowingStructure(code: string | undefined): string {
  if (!code) return '–';
  return GROWING_STRUCTURE_LABELS[code as GrowingStructure] ?? code;
}

/**
 * Format a formula variable name to display text.
 * Returns the variable name itself if not recognized.
 */
export function formatFormulaVariable(name: string): string {
  return FORMULA_VARIABLE_LABELS[name] ?? name;
}

/**
 * Format a field name to display text.
 * First checks FIELD_LABELS, then falls back to camelCase → Title Case conversion.
 */
export function formatFieldName(fieldName: string): string {
  // Check explicit labels first
  if (FIELD_LABELS[fieldName]) {
    return FIELD_LABELS[fieldName];
  }

  // Fall back to camelCase → Title Case conversion
  return fieldName
    .replace(/([A-Z])/g, ' $1')  // Add space before capitals
    .replace(/^./, s => s.toUpperCase())  // Capitalize first letter
    .trim();
}

/**
 * Format any value for display.
 * Handles null, undefined, booleans, and numbers.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'boolean') return value ? '✓' : '–';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
  }
  return String(value);
}

// =============================================================================
// OPTION LISTS (for select dropdowns)
// =============================================================================

/** Options for planting method select */
export const PLANTING_METHOD_OPTIONS = Object.entries(PLANTING_METHOD_LABELS).map(
  ([value, label]) => ({ value, label })
);

/** Options for normal method select */
export const NORMAL_METHOD_OPTIONS = Object.entries(NORMAL_METHOD_LABELS).map(
  ([value, label]) => ({ value, label })
);

/** Options for growing structure select */
export const GROWING_STRUCTURE_OPTIONS = Object.entries(GROWING_STRUCTURE_LABELS).map(
  ([value, label]) => ({ value, label })
);
