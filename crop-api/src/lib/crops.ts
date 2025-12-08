import cropsData from '@/data/crops.json';

export interface Crop {
  id: string;
  Identifier: string;
  Crop: string;
  Variety: string;
  Product: string;
  Category: string | null;
  'Common Name': string;
  'Growing Structure': string;
  'Planting Method': string;
  Seasons: string;
  Deprecated: boolean;
  'In Plan': boolean;
  [key: string]: unknown; // Allow access to all other fields
}

export interface CropsData {
  crops: Crop[];
  headers: string[];
  extractedAt: string;
}

const data = cropsData as CropsData;

export function getAllCrops(): Crop[] {
  return data.crops;
}

export function getCropById(id: string): Crop | undefined {
  return data.crops.find(c => c.id === id);
}

export function getHeaders(): string[] {
  return data.headers.filter((h): h is string => h !== null);
}

export function getMetadata() {
  return {
    totalCrops: data.crops.length,
    extractedAt: data.extractedAt,
    headerCount: data.headers.filter(h => h !== null).length,
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
    crop.Identifier?.toLowerCase().includes(q) ||
    crop.Crop?.toLowerCase().includes(q) ||
    crop.Variety?.toLowerCase().includes(q) ||
    crop['Common Name']?.toLowerCase().includes(q) ||
    crop.Category?.toLowerCase().includes(q)
  );
}

// Filter crops by multiple criteria
export function filterCrops(filters: {
  crop?: string;
  category?: string;
  growingStructure?: string;
  plantingMethod?: string;
  season?: string;
  inPlan?: boolean;
  deprecated?: boolean;
}): Crop[] {
  return data.crops.filter(c => {
    if (filters.crop && c.Crop !== filters.crop) return false;
    if (filters.category && c.Category !== filters.category) return false;
    if (filters.growingStructure && c['Growing Structure'] !== filters.growingStructure) return false;
    if (filters.plantingMethod && c['Planting Method'] !== filters.plantingMethod) return false;
    if (filters.season && !c.Seasons?.includes(filters.season)) return false;
    if (filters.inPlan !== undefined && c['In Plan'] !== filters.inPlan) return false;
    if (filters.deprecated !== undefined && c.Deprecated !== filters.deprecated) return false;
    return true;
  });
}
