import cropsData from '@/data/crops.json';
import {
  type CropConfig,
  calculateDaysInCells,
  calculateSTH,
  calculatePlantingMethod,
  calculateHarvestWindow,
} from './entities/crop-config';

// Re-export CropConfig as Crop for backwards compatibility
export type Crop = CropConfig;

export interface CropsData {
  crops: Crop[];
}

const data = cropsData as CropsData;

export function getAllCrops(): Crop[] {
  return data.crops;
}

export function getCropById(id: string): Crop | undefined {
  return data.crops.find(c => c.id === id);
}

export function getCropByIdentifier(identifier: string): Crop | undefined {
  return data.crops.find(c => c.identifier === identifier);
}

export function getMetadata() {
  return {
    totalCrops: data.crops.length,
  };
}

// Get unique values for a field (useful for filters)
export function getUniqueValues(field: keyof Crop): string[] {
  const values = new Set<string>();
  for (const crop of data.crops) {
    const val = crop[field];
    if (val !== null && val !== undefined && val !== '') {
      values.add(String(val));
    }
  }
  return Array.from(values).sort();
}

// Search crops by text across key fields
export function searchCrops(query: string): Crop[] {
  const q = query.toLowerCase();
  return data.crops.filter(crop =>
    crop.identifier?.toLowerCase().includes(q) ||
    crop.crop?.toLowerCase().includes(q) ||
    crop.variant?.toLowerCase().includes(q) ||
    crop.product?.toLowerCase().includes(q) ||
    crop.category?.toLowerCase().includes(q)
  );
}

// Filter crops by multiple criteria
export function filterCrops(filters: {
  crop?: string;
  category?: string;
  growingStructure?: string;
  plantingMethod?: 'DS' | 'TP' | 'PE';
  deprecated?: boolean;
}): Crop[] {
  return data.crops.filter(c => {
    if (filters.crop && c.crop !== filters.crop) return false;
    if (filters.category && c.category !== filters.category) return false;
    if (filters.growingStructure && c.growingStructure !== filters.growingStructure) return false;
    if (filters.plantingMethod && calculatePlantingMethod(c) !== filters.plantingMethod) return false;
    if (filters.deprecated !== undefined && c.deprecated !== filters.deprecated) return false;
    return true;
  });
}

// Get calculated values for a crop
export function getCropCalculations(crop: Crop) {
  const daysInCells = calculateDaysInCells(crop);
  return {
    daysInCells,
    sth: calculateSTH(crop, daysInCells),
    plantingMethod: calculatePlantingMethod(crop),
    harvestWindow: calculateHarvestWindow(crop),
  };
}
