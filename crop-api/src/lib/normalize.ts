/**
 * Normalization Script
 *
 * Transforms flat crop data into normalized Crop, Product, and PlantingConfig entities.
 *
 * Run with: npx tsx src/lib/normalize.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  CropEntity,
  ProductEntity,
  PlantingConfigEntity,
  ProductSequence,
  NormalizedData,
  TrayStage,
  PlantingType,
  DtmMethod,
  ProductPrice,
  ProductLaborTimes,
} from './types/entities';

// =============================================================================
// LOAD SOURCE DATA
// =============================================================================

interface FlatCrop {
  id: string;
  Identifier: string;
  Crop: string;
  Variety: string;
  Product: string;
  Category: string;
  'Common Name': string | null;
  'Growing Structure': string;
  'Planting Method': string;
  DS: boolean;
  TP: boolean;
  PI: boolean;
  Rows: number | null;
  Spacing: number | null;
  'Row Cover': string | null;
  'DTG Lower': number | null;
  'DTG Upper': number | null;
  DTG: number | null;
  'DTM Lower': number | null;
  'DTM Upper': number | null;
  DTM: number | null;
  'Days in Cells': number | null;
  'Days In Field': number | null;
  'Tray Size': number | null;
  'Tray Size 2': number | null;
  'Tray Size 3': number | null;
  'Days in Tray 1': number | null;
  'Days in Tray 2': number | null;
  'Days in Tray 3': number | null;
  STH: number | null;
  'Normal Method': string | null;
  Harvests: number | null;
  'Days Between Harvest': number | null;
  'Harvest Window': number | null;
  'Units Per Harvest': number | null;
  'Holding Window': number | null;
  Unit: string | null;
  Food: boolean;
  'Direct Price': number | null;
  'Wholesale Price': number | null;
  Notes: string | null;
  '2024 Note': string | null;
  Sp: boolean;
  Su: boolean;
  Fa: boolean;
  Wi: boolean;
  OW: boolean;
  [key: string]: unknown;
}

interface FlatProduct {
  ID: string;
  Crop: string;
  Product: string;
  Unit: string;
  Target: boolean;
  'Wash Type': string | null;
  'Wash Factor': number | null;
  'Per Crate': number | null;
  'Units Per Pack': number | null;
  'Packing Container': string | null;
  'Packaging Cost': number | null;
  'Holding Period': number | null;
  'Marketing (hr)': number | null;
  'Bunch (s)': number | null;
  'Harvest (s)': number | null;
  'Haul (s)': number | null;
  'Wash (s)': number | null;
  'Condition (s)': number | null;
  'Trim (s)': number | null;
  'Pack (s)': number | null;
  'Clean (s)': number | null;
  'Rehandle (s)': number | null;
  'Market Transport (s)': number | null;
  CSA: string | null;
  'CSA Portion': number | null;
  'Market Price': number | null;
  [key: string]: unknown;
}

function loadFlatCrops(): FlatCrop[] {
  const dataPath = path.join(__dirname, '../data/crops.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  return data.crops;
}

function loadFlatProducts(): FlatProduct[] {
  const dataPath = path.join(__dirname, '../data/products.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  return data.products;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateId(parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .map(p => String(p).toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .join('-');
}

/**
 * Generate a product ID that matches the format from the products sheet.
 * The sheet uses Crop+Product+Unit concatenated (e.g., "AmaranthMature LeafBunch").
 */
function generateProductId(crop: string, product: string, unit: string): string {
  return `${crop}${product}${unit}`;
}

function mergeNotes(...notes: (string | null | undefined)[]): string | null {
  const parts = notes.filter(Boolean) as string[];
  return parts.length > 0 ? parts.join('\n\n') : null;
}

function determinePlantingType(crop: FlatCrop): PlantingType {
  // PI = Perennial/Permanent planting
  if (crop.PI) return 'perennial';
  // DS = Direct Seed
  if (crop.DS && !crop.TP) return 'direct_seed';
  // TP = Transplant (default if not DS)
  return 'transplant';
}

function determineDtmMethod(crop: FlatCrop): DtmMethod | null {
  const method = crop['Normal Method'];
  if (!method) return null;

  const lower = method.toLowerCase();
  if (lower.includes('direct') || lower.includes('ds')) return 'from_direct_seed';
  if (lower.includes('transplant') || lower.includes('tp')) return 'from_transplant';
  if (lower.includes('seed')) return 'from_seeding';
  return null;
}

function buildTraySequence(crop: FlatCrop): TrayStage[] {
  const stages: TrayStage[] = [];

  // First tray stage (seeding)
  if (crop['Tray Size'] && crop['Days in Tray 1']) {
    stages.push({
      stageType: 'seed',
      traySize: crop['Tray Size'],
      daysInStage: crop['Days in Tray 1'],
    });
  }

  // Second tray stage (prick out)
  if (crop['Tray Size 2'] && crop['Days in Tray 2']) {
    stages.push({
      stageType: 'prick_out',
      traySize: crop['Tray Size 2'],
      daysInStage: crop['Days in Tray 2'],
    });
  }

  // Third tray stage (pot up)
  if (crop['Tray Size 3'] && crop['Days in Tray 3']) {
    stages.push({
      stageType: 'pot_up',
      traySize: crop['Tray Size 3'],
      daysInStage: crop['Days in Tray 3'],
    });
  }

  return stages;
}

// =============================================================================
// NORMALIZATION FUNCTIONS
// =============================================================================

/**
 * Build a lookup of DTM data from flat crops.
 * Returns two lookups:
 * - byCropFamily: first DTM found for each crop family (for Crop.dtm)
 * - byProduct: DTM keyed by Crop+Product+Unit (for Product.dtm override)
 */
function buildDtmLookups(flatCrops: FlatCrop[]): {
  byCropFamily: Map<string, number>;
  byProduct: Map<string, { dtm: number | null; dtmLower: number | null; dtmUpper: number | null }>;
} {
  const byCropFamily = new Map<string, number>();
  const byProduct = new Map<string, { dtm: number | null; dtmLower: number | null; dtmUpper: number | null }>();

  for (const fc of flatCrops) {
    // Crop family DTM (first one found)
    if (!byCropFamily.has(fc.Crop) && fc.DTM != null) {
      byCropFamily.set(fc.Crop, fc.DTM);
    }

    // Product-specific DTM
    const productKey = `${fc.Crop}|${fc.Product}|${fc.Unit}`;
    if (!byProduct.has(productKey) && fc.DTM != null) {
      byProduct.set(productKey, {
        dtm: fc.DTM,
        dtmLower: fc['DTM Lower'] ?? null,
        dtmUpper: fc['DTM Upper'] ?? null,
      });
    }
  }

  return { byCropFamily, byProduct };
}

function normalizeProducts(
  flatProducts: FlatProduct[]
): Map<string, ProductEntity> {
  const products = new Map<string, ProductEntity>();

  for (const fp of flatProducts) {
    const id = fp.ID || generateId([fp.Crop, fp.Product, fp.Unit]);

    // Build prices array
    const prices: ProductPrice[] = [];
    if (fp['Market Price']) {
      prices.push({ marketType: 'direct', price: fp['Market Price'] });
    }

    // Build labor times
    const laborTimes: ProductLaborTimes = {
      bunch: fp['Bunch (s)'] ?? null,
      harvest: fp['Harvest (s)'] ?? null,
      haul: fp['Haul (s)'] ?? null,
      wash: fp['Wash (s)'] ?? null,
      condition: fp['Condition (s)'] ?? null,
      trim: fp['Trim (s)'] ?? null,
      pack: fp['Pack (s)'] ?? null,
      clean: fp['Clean (s)'] ?? null,
      rehandle: fp['Rehandle (s)'] ?? null,
      marketTransport: fp['Market Transport (s)'] ?? null,
      marketingHours: fp['Marketing (hr)'] ?? null,
    };

    // Products contain sales/handling data only - NO DTM
    // Timing lives in ProductSequence.harvestStartDays (config-specific)
    const product: ProductEntity = {
      id,
      cropFamily: fp.Crop,
      name: fp.Product,
      unit: fp.Unit,
      isFood: true, // Products sheet doesn't have this, default true
      holdingWindow: fp['Holding Period'] ?? null,
      prices,
      washType: fp['Wash Type'] ?? null,
      washFactor: fp['Wash Factor'] ?? null,
      perCrate: fp['Per Crate'] ?? null,
      unitsPerPack: fp['Units Per Pack'] ?? null,
      packingContainer: fp['Packing Container'] ?? null,
      packagingCost: fp['Packaging Cost'] ?? null,
      laborTimes,
      csaAvailability: fp.CSA ?? null,
      csaPortion: fp['CSA Portion'] ?? null,
    };

    products.set(id, product);
  }

  return products;
}

function normalizeCropsAndConfigs(
  flatCrops: FlatCrop[],
  productsByFamily: Map<string, string[]>,
  dtmByCropFamily: Map<string, number>
): {
  crops: Map<string, CropEntity>;
  configs: Map<string, PlantingConfigEntity>;
  sequences: Map<string, ProductSequence>;
} {
  const crops = new Map<string, CropEntity>();
  const configs = new Map<string, PlantingConfigEntity>();
  const sequences = new Map<string, ProductSequence>();

  // Group flat crops by crop family + variety to create crop entities
  const cropGroups = new Map<string, FlatCrop[]>();
  for (const fc of flatCrops) {
    const key = `${fc.Crop}|${fc.Variety}`;
    if (!cropGroups.has(key)) {
      cropGroups.set(key, []);
    }
    cropGroups.get(key)!.push(fc);
  }

  // Create crop entities
  for (const [key, group] of cropGroups) {
    const first = group[0];
    const cropId = generateId([first.Crop, first.Variety]);

    // Merge notes from all configs of this crop
    const allNotes: string[] = [];
    for (const fc of group) {
      if (fc.Notes) allNotes.push(fc.Notes);
      if (fc['2024 Note']) allNotes.push(`2024: ${fc['2024 Note']}`);
    }

    const crop: CropEntity = {
      id: cropId,
      name: first.Variety,
      cropFamily: first.Crop,
      category: first.Category,
      displayName: first['Common Name'] ?? null,
      rowCover: first['Row Cover'] ?? null,
      dtgLower: first['DTG Lower'] ?? null,
      dtgUpper: first['DTG Upper'] ?? null,
      dtg: first.DTG ?? null,
      dtm: dtmByCropFamily.get(first.Crop) ?? null,
      notes: allNotes.length > 0 ? [...new Set(allNotes)].join('\n\n') : null,
      productIds: productsByFamily.get(first.Crop) ?? [],
    };

    crops.set(cropId, crop);

    // Create planting config and product sequence for each flat crop row
    for (const fc of group) {
      const configId = fc.id; // Use original flat ID as config ID
      // Use the same ID format as the products sheet (Crop+Product+Unit concatenated)
      const productId = generateProductId(fc.Crop, fc.Product, fc.Unit ?? '');

      const config: PlantingConfigEntity = {
        id: configId,
        cropId,
        quickDescription: fc.Identifier,
        growingStructure: fc['Growing Structure'],
        plantingType: determinePlantingType(fc),
        isPerennial: fc.PI ?? false,
        establishmentYears: null, // Not tracked in current data
        rows: fc.Rows ?? null,
        spacing: fc.Spacing ?? null,
        traySequence: buildTraySequence(fc),
        dtmMethod: determineDtmMethod(fc),
        sth: fc.STH ?? null,
        // Calculated fields
        daysInCells: fc['Days in Cells'] ?? undefined,
        daysInField: fc['Days In Field'] ?? undefined,
        harvestWindow: fc['Harvest Window'] ?? undefined,
        // Legacy fields (kept for backward compatibility)
        productId: productId || null,
        dtmLower: fc['DTM Lower'] ?? null,
        dtmUpper: fc['DTM Upper'] ?? null,
        dtm: fc.DTM ?? null,
        harvests: fc.Harvests ?? null,
        daysBetweenHarvest: fc['Days Between Harvest'] ?? null,
        unitsPerHarvest: fc['Units Per Harvest'] ?? null,
      };

      configs.set(configId, config);

      // Create ProductSequence for this config
      // Each flat crop row represents one config → one product relationship
      if (productId) {
        const sequenceId = `${configId}-seq-1`;
        const sequence: ProductSequence = {
          id: sequenceId,
          plantingConfigId: configId,
          productId,
          // harvestStartDays = DTM (days from planting to first harvest)
          harvestStartDays: fc.DTM ?? 0,
          harvestCount: fc.Harvests ?? 1,
          daysBetweenHarvest: fc['Days Between Harvest'] ?? null,
          yieldPerHarvest: fc['Units Per Harvest'] ?? null,
        };
        sequences.set(sequenceId, sequence);
      }
    }
  }

  return { crops, configs, sequences };
}

// =============================================================================
// MAIN
// =============================================================================

export function normalize(): NormalizedData {
  console.log('Loading source data...');
  const flatCrops = loadFlatCrops();
  const flatProducts = loadFlatProducts();

  console.log(`  ${flatCrops.length} flat crop records`);
  console.log(`  ${flatProducts.length} flat product records`);

  // Build DTM lookups from flat crops (products sheet doesn't have DTM)
  console.log('\nBuilding DTM lookups from crops...');
  const { byCropFamily: dtmByCropFamily, byProduct: dtmByProduct } = buildDtmLookups(flatCrops);
  console.log(`  ${dtmByCropFamily.size} crop family DTM entries`);
  console.log(`  ${dtmByProduct.size} product-specific DTM entries`);

  // Normalize products (no DTM - timing lives in ProductSequence)
  console.log('\nNormalizing products...');
  const products = normalizeProducts(flatProducts);
  console.log(`  ${products.size} products`);

  // Build index of productIds by crop family
  const productsByFamily = new Map<string, string[]>();
  for (const [id, product] of products) {
    if (!productsByFamily.has(product.cropFamily)) {
      productsByFamily.set(product.cropFamily, []);
    }
    productsByFamily.get(product.cropFamily)!.push(id);
  }

  // Normalize crops, configs, and sequences
  console.log('\nNormalizing crops, planting configs, and product sequences...');
  const { crops, configs, sequences } = normalizeCropsAndConfigs(flatCrops, productsByFamily, dtmByCropFamily);
  console.log(`  ${crops.size} crops`);
  console.log(`  ${configs.size} planting configs`);
  console.log(`  ${sequences.size} product sequences`);

  // Count crops with DTM
  const cropsWithDtm = Array.from(crops.values()).filter(c => c.dtm != null).length;
  console.log(`  ${cropsWithDtm} crops have DTM`);

  // Build indexes
  const cropFamilyIndex: Record<string, string[]> = {};
  for (const [id, crop] of crops) {
    if (!cropFamilyIndex[crop.cropFamily]) {
      cropFamilyIndex[crop.cropFamily] = [];
    }
    cropFamilyIndex[crop.cropFamily].push(id);
  }

  const productByCropFamilyIndex: Record<string, string[]> = {};
  for (const [family, productIds] of productsByFamily) {
    productByCropFamilyIndex[family] = productIds;
  }

  // Build sequences by config index
  const sequencesByConfigIndex: Record<string, string[]> = {};
  for (const [id, seq] of sequences) {
    if (!sequencesByConfigIndex[seq.plantingConfigId]) {
      sequencesByConfigIndex[seq.plantingConfigId] = [];
    }
    sequencesByConfigIndex[seq.plantingConfigId].push(id);
  }

  // Convert maps to records
  const normalizedData: NormalizedData = {
    meta: {
      extractedAt: new Date().toISOString(),
      sourceFile: 'Crop Plan 2025 V20.xlsm',
      version: '2.0.0', // Bumped version for ProductSequence support
    },
    crops: Object.fromEntries(crops),
    products: Object.fromEntries(products),
    plantingConfigs: Object.fromEntries(configs),
    productSequences: Object.fromEntries(sequences),
    cropFamilyIndex,
    productByCropFamilyIndex,
    sequencesByConfigIndex,
  };

  return normalizedData;
}

// Run if executed directly
if (require.main === module) {
  const data = normalize();

  // Print summary
  console.log('\n=== SUMMARY ===');
  console.log(`Crops: ${Object.keys(data.crops).length}`);
  console.log(`Products: ${Object.keys(data.products).length}`);
  console.log(`Planting Configs: ${Object.keys(data.plantingConfigs).length}`);
  console.log(`Product Sequences: ${Object.keys(data.productSequences).length}`);
  console.log(`Crop Families: ${Object.keys(data.cropFamilyIndex).length}`);

  // Save to file
  const outputPath = path.join(__dirname, '../data/normalized.json');
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  // Print a sample: find a multi-harvest crop for interesting data
  const multiHarvestSeq = Object.values(data.productSequences).find(s => s.harvestCount > 1);
  if (multiHarvestSeq) {
    const config = data.plantingConfigs[multiHarvestSeq.plantingConfigId];
    const crop = data.crops[config.cropId];
    const product = data.products[multiHarvestSeq.productId];

    console.log('\n=== SAMPLE: MULTI-HARVEST CROP ===');
    console.log(`Crop: ${crop.cropFamily} - ${crop.name} (DTM: ${crop.dtm})`);
    console.log(`Config: ${config.quickDescription}`);
    console.log(`Product: ${product?.name} (${product?.unit})`);
    console.log(`\nProductSequence (timing lives here):`);
    console.log(JSON.stringify(multiHarvestSeq, null, 2));
  }
}
