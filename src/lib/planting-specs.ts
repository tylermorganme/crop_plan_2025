/**
 * Planting Specs Utilities
 *
 * Functions for accessing the stock planting specs from the template file.
 * These are used when creating new plans or looking up stock data.
 */

import specsData from '@/data/planting-spec-template.json';
import {
  type PlantingSpec,
  calculateDaysInCells,
  calculatePlantingMethod,
  getPrimarySeedToHarvest,
  calculateAggregateHarvestWindow,
} from './entities/planting-specs';

// Re-export types for convenience
export type { PlantingSpec };

interface SpecsData {
  crops: PlantingSpec[];
}

const data = specsData as SpecsData;

/**
 * Get all stock planting specs.
 */
export function getAllSpecs(): PlantingSpec[] {
  return data.crops;
}

/**
 * @deprecated Use getAllSpecs instead
 */
export function getAllCrops(): PlantingSpec[] {
  return getAllSpecs();
}

/**
 * Find a spec by its unique ID.
 */
export function getSpecById(id: string): PlantingSpec | undefined {
  return data.crops.find(c => c.id === id);
}

/**
 * @deprecated Use getSpecById instead
 */
export function getCropById(id: string): PlantingSpec | undefined {
  return getSpecById(id);
}

/**
 * Find a spec by its human-readable identifier.
 */
export function getSpecByIdentifier(identifier: string): PlantingSpec | undefined {
  return data.crops.find(c => c.identifier === identifier);
}

/**
 * @deprecated Use getSpecByIdentifier instead
 */
export function getCropByIdentifier(identifier: string): PlantingSpec | undefined {
  return getSpecByIdentifier(identifier);
}

export function getMetadata() {
  return {
    totalSpecs: data.crops.length,
    /** @deprecated Use totalSpecs instead */
    totalCrops: data.crops.length,
  };
}

/**
 * Get unique values for a field (useful for filters).
 */
export function getUniqueValues(field: keyof PlantingSpec): string[] {
  const values = new Set<string>();
  for (const spec of data.crops) {
    const val = spec[field];
    if (val !== null && val !== undefined && val !== '') {
      values.add(String(val));
    }
  }
  return Array.from(values).sort();
}

/**
 * Search specs by text using searchText field or key fields.
 */
export function searchSpecs(query: string): PlantingSpec[] {
  const q = query.toLowerCase();
  return data.crops.filter(spec =>
    // Use searchText if available (materialized), otherwise fall back to fields
    spec.searchText?.toLowerCase().includes(q) ||
    spec.identifier?.toLowerCase().includes(q) ||
    spec.crop?.toLowerCase().includes(q) ||
    spec.category?.toLowerCase().includes(q)
  );
}

/**
 * @deprecated Use searchSpecs instead
 */
export function searchCrops(query: string): PlantingSpec[] {
  return searchSpecs(query);
}

/**
 * Filter specs by multiple criteria.
 */
export function filterSpecs(filters: {
  crop?: string;
  category?: string;
  growingStructure?: string;
  plantingMethod?: 'direct-seed' | 'transplant' | 'perennial';
  deprecated?: boolean;
}): PlantingSpec[] {
  return data.crops.filter(spec => {
    if (filters.crop && spec.crop !== filters.crop) return false;
    if (filters.category && spec.category !== filters.category) return false;
    if (filters.growingStructure && spec.growingStructure !== filters.growingStructure) return false;
    if (filters.plantingMethod && calculatePlantingMethod(spec) !== filters.plantingMethod) return false;
    if (filters.deprecated !== undefined && spec.deprecated !== filters.deprecated) return false;
    return true;
  });
}

/**
 * @deprecated Use filterSpecs instead
 */
export function filterCrops(filters: {
  crop?: string;
  category?: string;
  growingStructure?: string;
  plantingMethod?: 'direct-seed' | 'transplant' | 'perennial';
  deprecated?: boolean;
}): PlantingSpec[] {
  return filterSpecs(filters);
}

/**
 * Get calculated values for a planting spec.
 * Uses product-aware calculations if productYields exists.
 */
export function getSpecCalculations(spec: PlantingSpec) {
  const daysInCells = calculateDaysInCells(spec);
  return {
    daysInCells,
    seedToHarvest: getPrimarySeedToHarvest(spec),
    plantingMethod: calculatePlantingMethod(spec),
    harvestWindow: calculateAggregateHarvestWindow(spec),
  };
}

/**
 * @deprecated Use getSpecCalculations instead
 */
export function getCropCalculations(spec: PlantingSpec) {
  return getSpecCalculations(spec);
}
