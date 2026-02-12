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
import type { Variety } from './entities/variety';
import type { SeedMix } from './entities/seed-mix';

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
  tags?: string[];
  specTags?: string[];
  growingStructure?: string;
  irrigation?: string;
  rowCover?: string;
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
 * - tag:value - matches planting tags
 * - spectag:value - matches spec tags
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
    {
      name: 'irrigation',
      getValue: (c) => c.irrigation,
    },
    {
      name: 'rowcover',
      aliases: ['rowCover'],
      getValue: (c) => c.rowCover,
    },
    {
      name: 'tag',
      aliases: ['tags'],
      matchType: 'array-includes',
      getValue: (c) => c.tags,
    },
    {
      name: 'spectag',
      aliases: ['spectags'],
      matchType: 'array-includes',
      getValue: (c) => c.specTags,
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
  name?: string;
  notes?: string;
  tags?: string[];
  specTags?: string[];
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
      getValue: (p) => p.cropName ?? p.name,
    },
    {
      name: 'notes',
      getValue: (p) => p.notes,
    },
    {
      name: 'structure',
      getValue: (p) => p.growingStructure,
    },
    {
      name: 'tag',
      aliases: ['tags'],
      matchType: 'array-includes',
      getValue: (p) => p.tags,
    },
    {
      name: 'spectag',
      aliases: ['spectags'],
      matchType: 'array-includes',
      getValue: (p) => p.specTags,
    },
  ],
  buildSearchText: (p) => [
    p.cropName,
    p.category,
    p.name,
    p.bedName,
    p.id,
    p.notes,
    p.method,
    p.sequenceDisplay,
    p.growingStructure,
    ...(p.tags ?? []),
    ...(p.specTags ?? []),
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
    spec.name,
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

  // Add tags
  if (spec.tags) {
    spec.tags.forEach(t => fields.push(t));
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
    {
      name: 'tag',
      aliases: ['tags'],
      matchType: 'array-includes',
      getValue: (s) => s.tags ?? [],
    },
  ],
  buildSearchText: buildSpecSearchText,
};

// =============================================================================
// SeedMix Search Config (Seed Mixes Page)
// =============================================================================

/**
 * Build searchable text from a SeedMix.
 */
export function buildSeedMixSearchText(m: SeedMix): string {
  return [
    m.crop,
    m.name,
    m.notes,
  ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Search configuration for SeedMix (used by Seed Mixes page).
 *
 * Supported field filters:
 * - crop:value - matches crop name
 * - name:value - matches mix name
 * - notes:value - matches notes
 *
 * The 'used' field filter is injected at runtime since it depends on plan data.
 */
export const seedMixSearchConfig: SearchConfig<SeedMix> = {
  fields: [
    {
      name: 'crop',
      getValue: (m) => m.crop,
    },
    {
      name: 'name',
      getValue: (m) => m.name,
    },
    {
      name: 'notes',
      getValue: (m) => m.notes,
    },
  ],
  buildSearchText: buildSeedMixSearchText,
};

// =============================================================================
// Variety Search Config (Varieties Page)
// =============================================================================

/**
 * Build searchable text from a Variety.
 */
export function buildVarietySearchText(v: Variety): string {
  return [
    v.crop,
    v.name,
    v.supplier,
    v.notes,
  ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Search configuration for Variety (used by Varieties page).
 *
 * Supported field filters:
 * - crop:value - matches crop name
 * - name:value - matches variety name
 * - supplier:value - matches supplier
 * - organic:true/false - matches organic status
 * - pelleted:true/false - matches pelleted status
 * - owned:true/false - matches alreadyOwn status
 * - unit:value - matches density unit (oz, g, lb, ct)
 *
 * The 'used' field filter is injected at runtime since it depends on plan data.
 */
export const varietySearchConfig: SearchConfig<Variety> = {
  fields: [
    {
      name: 'crop',
      getValue: (v) => v.crop,
    },
    {
      name: 'name',
      aliases: ['variety'],
      getValue: (v) => v.name,
    },
    {
      name: 'supplier',
      getValue: (v) => v.supplier,
    },
    {
      name: 'organic',
      aliases: ['org'],
      matchType: 'equals',
      getValue: (v) => !!v.organic,
    },
    {
      name: 'pelleted',
      aliases: ['pell'],
      matchType: 'equals',
      getValue: (v) => !!v.pelleted,
    },
    {
      name: 'owned',
      aliases: ['own'],
      matchType: 'equals',
      getValue: (v) => !!v.alreadyOwn,
    },
    {
      name: 'unit',
      matchType: 'equals',
      getValue: (v) => v.densityUnit ?? '',
    },
  ],
  buildSearchText: buildVarietySearchText,
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
