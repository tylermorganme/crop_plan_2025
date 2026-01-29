/**
 * Entity-specific search configurations for the search DSL.
 *
 * Each entity type (TimelineCrop, PlantingSpec, EnrichedPlanting) has its own
 * configuration that defines:
 * - Which fields can be filtered with field:value syntax
 * - How to build the full-text search string
 * - Field aliases and value aliases
 */

import type { SearchConfig } from './search-dsl';
import { buildCropSearchText } from './search-dsl';
import { getBedGroup } from './entities/bed';
import { calculatePlantingMethod, type PlantingSpec } from './entities/planting-specs';

// =============================================================================
// TimelineCrop Search Config
// =============================================================================

/**
 * Fields expected for TimelineCrop-based filtering.
 * This is a subset of TimelineCrop that the filter functions need.
 */
export interface TimelineCropFilterable {
  resource?: string;
  category?: string;
  plantingMethod?: string;
  crop?: string;
  name?: string;
  notes?: string;
  growingStructure?: string;
  // Fields needed for buildCropSearchText
  specId?: string;
  groupId?: string;
}

/**
 * Search configuration for TimelineCrop (used by CropTimeline).
 *
 * Supported field filters:
 * - bed:value - matches bed name (resource)
 * - group:value, bedgroup:value - matches bed group (A, B, C, etc.)
 * - category:value - matches crop category
 * - method:value - matches planting method (ds, tp, perennial)
 * - crop:value - matches crop name or display name
 * - notes:value - matches notes field
 * - structure:value - matches growing structure (field, gh, ht)
 */
export const timelineCropSearchConfig: SearchConfig<TimelineCropFilterable> = {
  fields: [
    {
      name: 'bed',
      getValue: (c) => c.resource,
    },
    {
      name: 'group',
      aliases: ['bedgroup'],
      getValue: (c) => c.resource ? getBedGroup(c.resource) : undefined,
    },
    {
      name: 'category',
      getValue: (c) => c.category,
    },
    {
      name: 'method',
      getValue: (c) => c.plantingMethod,
    },
    {
      name: 'crop',
      getValue: (c) => c.crop ?? c.name,
    },
    {
      name: 'notes',
      getValue: (c) => c.notes,
    },
    {
      name: 'structure',
      getValue: (c) => c.growingStructure,
    },
  ],
  buildSearchText: buildCropSearchText,
};

// =============================================================================
// EnrichedPlanting Search Config (Plantings Page)
// =============================================================================

/**
 * Fields expected for EnrichedPlanting-based filtering.
 * The plantings page uses different field names than TimelineCrop.
 */
export interface EnrichedPlantingFilterable {
  bedName?: string;
  category?: string;
  method?: string;
  cropName?: string;
  identifier?: string;
  notes?: string;
  growingStructure?: string;
  // Additional fields for search text
  id?: string;
  sequenceDisplay?: string;
}

/**
 * Search configuration for EnrichedPlanting (used by Plantings page).
 *
 * Same field filters as TimelineCrop but accesses different properties.
 */
export const enrichedPlantingSearchConfig: SearchConfig<EnrichedPlantingFilterable> = {
  fields: [
    {
      name: 'bed',
      getValue: (p) => p.bedName,
    },
    {
      name: 'group',
      aliases: ['bedgroup'],
      getValue: (p) => p.bedName ? getBedGroup(p.bedName) : undefined,
    },
    {
      name: 'category',
      getValue: (p) => p.category,
    },
    {
      name: 'method',
      getValue: (p) => p.method,
    },
    {
      name: 'crop',
      getValue: (p) => p.cropName ?? p.identifier,
    },
    {
      name: 'notes',
      getValue: (p) => p.notes,
    },
    {
      name: 'structure',
      getValue: (p) => p.growingStructure,
    },
  ],
  buildSearchText: (p) => [
    p.cropName,
    p.category,
    p.identifier,
    p.bedName,
    p.id,
    p.notes,
    p.method,
    p.sequenceDisplay,
    p.growingStructure,
  ].filter(Boolean).join(' ').toLowerCase(),
};

// =============================================================================
// PlantingSpec Search Config (SpecExplorer)
// =============================================================================

/**
 * Build searchable text from a PlantingSpec.
 * Includes all key fields concatenated together for plain-text matching.
 */
export function buildSpecSearchText(spec: PlantingSpec): string {
  const fields = [
    spec.identifier,
    spec.crop,
    spec.category,
    spec.growingStructure,
    calculatePlantingMethod(spec),
  ].filter((f): f is string => Boolean(f));

  // Add product names from productYields
  if (spec.productYields) {
    spec.productYields.forEach(py => {
      if (py.productId) fields.push(py.productId);
    });
  }

  return fields.join(' ').toLowerCase();
}

/**
 * Search configuration for PlantingSpec (used by SpecExplorer).
 *
 * Supported field filters:
 * - crop:value - matches crop name
 * - category:value - matches category
 * - method:value - matches planting method with aliases (ds, tp, p)
 * - structure:value - matches growing structure
 * - product:value - matches any product in productYields (array search)
 * - deprecated:true/false - matches deprecated status (boolean)
 * - favorite:true/false - matches isFavorite status (boolean)
 */
export const plantingSpecSearchConfig: SearchConfig<PlantingSpec> = {
  fields: [
    {
      name: 'crop',
      getValue: (s) => s.crop,
    },
    {
      name: 'category',
      getValue: (s) => s.category,
    },
    {
      name: 'method',
      matchType: 'custom',
      valueAliases: {
        'ds': 'direct seed',
        'direct': 'direct seed',
        'directseed': 'direct seed',
        'tp': 'transplant',
        'p': 'perennial',
      },
      getValue: (s) => calculatePlantingMethod(s),
      customMatch: (s, value) => {
        const method = calculatePlantingMethod(s).toLowerCase();
        return method === value || method.includes(value);
      },
    },
    {
      name: 'structure',
      getValue: (s) => s.growingStructure,
    },
    {
      name: 'product',
      matchType: 'array-includes',
      getValue: (s) => s.productYields?.map(py => py.productId ?? '').filter(Boolean) ?? [],
    },
    {
      name: 'deprecated',
      matchType: 'equals',
      getValue: (s) => !!s.deprecated,
    },
    {
      name: 'favorite',
      matchType: 'equals',
      getValue: (s) => !!s.isFavorite,
    },
  ],
  buildSearchText: buildSpecSearchText,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract filter field names from a search config.
 * Useful for populating SearchInput's filterFields prop.
 */
export function getFilterFieldNames<T>(config: SearchConfig<T>): string[] {
  const names: string[] = [];
  for (const field of config.fields) {
    names.push(field.name);
    if (field.aliases) {
      names.push(...field.aliases);
    }
  }
  return names;
}

/**
 * Get sort field names from a search config.
 * By default, all filter fields are also sortable.
 */
export function getSortFieldNames<T>(config: SearchConfig<T>): string[] {
  return config.fields.map(f => f.name);
}
