/**
 * Stock Data Module
 *
 * Loads and transforms stock varieties, seed mixes, and products from JSON files.
 * Used when creating new plans from template.
 *
 * The JSON files contain raw data without IDs. This module:
 * 1. Creates Variety entities with generated IDs
 * 2. Resolves seed mix variety references to actual IDs
 * 3. Creates SeedMix entities with generated IDs
 * 4. Creates Product entities with deterministic IDs
 */

import varietiesData from '@/data/varieties.json';
import seedMixesData from '@/data/seed-mixes.json';
import productsData from '@/data/products.json';
import { createVariety, getVarietyKey, type Variety, type CreateVarietyInput } from './entities/variety';
import { createSeedMix, type SeedMix, type CreateSeedMixInput } from './entities/seed-mix';
import { createProduct, type Product, type CreateProductInput } from './entities/product';

// =============================================================================
// TYPES
// =============================================================================

interface VarietiesData {
  _generated?: string;
  _source?: string;
  varieties: CreateVarietyInput[];
}

/** Component as stored in seed-mixes.json (before variety ID resolution) */
interface JsonSeedMixComponent {
  percent: number;
  _varietyCrop?: string;
  _varietyName?: string;
  _varietySupplier?: string;
}

/** Seed mix as stored in seed-mixes.json (before variety ID resolution) */
interface JsonSeedMix {
  name: string;
  crop: string;
  components: JsonSeedMixComponent[];
  notes?: string;
}

interface SeedMixesData {
  _generated?: string;
  _source?: string;
  seedMixes: JsonSeedMix[];
}

// =============================================================================
// STOCK DATA LOADING
// =============================================================================

// Cache the processed stock data
let cachedVarieties: Record<string, Variety> | null = null;
let cachedSeedMixes: Record<string, SeedMix> | null = null;
let cachedProducts: Record<string, Product> | null = null;

/**
 * Get all stock varieties as a Record keyed by ID.
 * Creates IDs on first access and caches the result.
 */
export function getStockVarieties(): Record<string, Variety> {
  if (cachedVarieties) return cachedVarieties;

  const data = varietiesData as VarietiesData;
  const varieties: Record<string, Variety> = {};

  for (const input of data.varieties) {
    const variety = createVariety(input);
    varieties[variety.id] = variety;
  }

  cachedVarieties = varieties;
  return varieties;
}

/**
 * Get all stock seed mixes as a Record keyed by ID.
 * Resolves variety references using the stock varieties.
 * Creates IDs on first access and caches the result.
 */
export function getStockSeedMixes(): Record<string, SeedMix> {
  if (cachedSeedMixes) return cachedSeedMixes;

  const data = seedMixesData as SeedMixesData;
  const varieties = getStockVarieties();

  // Build variety lookup by content key
  const varietyByKey = new Map<string, string>();
  for (const v of Object.values(varieties)) {
    varietyByKey.set(getVarietyKey(v), v.id);
  }

  const seedMixes: Record<string, SeedMix> = {};
  let unresolvedCount = 0;

  for (const raw of data.seedMixes) {
    // Resolve variety references
    const resolvedComponents: { varietyId: string; percent: number }[] = [];

    for (const comp of raw.components) {
      if (comp._varietyCrop && comp._varietyName) {
        const varietyKey = `${comp._varietyCrop}|${comp._varietyName}|${comp._varietySupplier || ''}`.toLowerCase().trim();
        const varietyId = varietyByKey.get(varietyKey);

        if (varietyId) {
          resolvedComponents.push({ varietyId, percent: comp.percent });
        } else {
          unresolvedCount++;
          // Skip unresolved varieties
        }
      }
    }

    const input: CreateSeedMixInput = {
      name: raw.name,
      crop: raw.crop,
      components: resolvedComponents,
      notes: raw.notes,
    };

    const mix = createSeedMix(input);
    seedMixes[mix.id] = mix;
  }

  if (unresolvedCount > 0) {
    console.warn(`[stock-data] ${unresolvedCount} variety references could not be resolved`);
  }

  cachedSeedMixes = seedMixes;
  return seedMixes;
}

/**
 * Get all stock products as a Record keyed by ID.
 * Products have deterministic IDs based on crop|product|unit.
 * Creates entities on first access and caches the result.
 */
export function getStockProducts(): Record<string, Product> {
  if (cachedProducts) return cachedProducts;

  const data = productsData as CreateProductInput[];
  const products: Record<string, Product> = {};

  for (const input of data) {
    const product = createProduct(input);
    products[product.id] = product;
  }

  cachedProducts = products;
  return products;
}

/**
 * Get stock data stats for debugging.
 */
export function getStockDataStats() {
  const varieties = getStockVarieties();
  const seedMixes = getStockSeedMixes();
  const products = getStockProducts();

  return {
    varietyCount: Object.keys(varieties).length,
    seedMixCount: Object.keys(seedMixes).length,
    productCount: Object.keys(products).length,
    varietyCrops: new Set(Object.values(varieties).map((v) => v.crop)).size,
    seedMixCrops: new Set(Object.values(seedMixes).map((m) => m.crop)).size,
    productCrops: new Set(Object.values(products).map((p) => p.crop)).size,
  };
}
