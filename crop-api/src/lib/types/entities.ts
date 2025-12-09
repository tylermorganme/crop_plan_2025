/**
 * Normalized Entity Types for Crop Planning
 *
 * Four core entities:
 * - CropEntity: The plant variety (crop-level data that doesn't change based on how you grow it)
 * - ProductEntity: What is harvested and sold (pricing, labor, handling - NO DTM)
 * - ProductSequence: Links a planting config to a product with harvest timing (DTM lives here)
 * - PlantingConfigEntity: How a crop is planted (structure, spacing, tray sequence)
 *
 * Key insight: DTM is config-specific, not product-specific. The same product (e.g., "Cherry Tomatoes")
 * can have wildly different DTMs depending on the planting config (55 days for determinate field,
 * 90 days for indeterminate greenhouse). ProductSequence.harvestStartDays captures this.
 */

// =============================================================================
// CROP ENTITY
// =============================================================================

/**
 * The base plant information, independent of how it's grown or what's harvested.
 *
 * DTM hierarchy:
 * - Crop.dtm: General/default DTM for this crop family
 * - Product.dtm: Can override if product has different maturity (defaults to crop's DTM)
 * - ProductSequence.harvestStartDays: Actual days for specific config (growing conditions vary)
 */
export interface CropEntity {
  /** Unique identifier (generated) */
  id: string;

  /** The variety name (renamed from "Variety") */
  name: string;

  /** The crop family - e.g., "Tomato", "Pepper" (from "Crop" column) */
  cropFamily: string;

  /** Category - e.g., "Vegetable", "Herb", "Flower" */
  category: string;

  /** Display name - optional, auto-calculated with manual override (from "Common Name") */
  displayName: string | null;

  /** Row cover preference - AMAP = "as much as possible" */
  rowCover: string | null;

  /** Days to germination (lower bound) */
  dtgLower: number | null;

  /** Days to germination (upper bound) */
  dtgUpper: number | null;

  /** Days to germination (calculated midpoint) */
  dtg: number | null;

  /** General/default days to maturity for this crop family */
  dtm: number | null;

  /** General crop notes (merged from multiple note fields) */
  notes: string | null;

  /** Product IDs associated with this crop */
  productIds: string[];
}

// =============================================================================
// PRODUCT ENTITY
// =============================================================================

/**
 * Market-specific pricing for a product.
 *
 * Design decision: Default to year-round pricing. Seasonal pricing windows
 * are supported but not required - most products just need a single price.
 */
export interface ProductPrice {
  /** Market type - "direct", "wholesale", "farmers_market", etc. */
  marketType: string;

  /** Price per unit */
  price: number;

  /** Optional: Start of pricing window (e.g., "Jun 1"). Omit for year-round. */
  windowStart?: string;

  /** Optional: End of pricing window (e.g., "Sep 1"). Omit for year-round. */
  windowEnd?: string;
}

/**
 * Labor times for handling a product (all in seconds unless noted)
 */
export interface ProductLaborTimes {
  /** Bunching time per unit */
  bunch: number | null;

  /** Harvest time per unit */
  harvest: number | null;

  /** Haul time per unit */
  haul: number | null;

  /** Wash time per unit */
  wash: number | null;

  /** Conditioning time per unit */
  condition: number | null;

  /** Trim time per unit */
  trim: number | null;

  /** Pack time per unit */
  pack: number | null;

  /** Clean time per unit */
  clean: number | null;

  /** Rehandle time per unit */
  rehandle: number | null;

  /** Market transport time per unit */
  marketTransport: number | null;

  /** Marketing hours (hours, not seconds) */
  marketingHours: number | null;
}

/**
 * What is harvested and sold from a crop.
 *
 * Products contain sales, handling, and labor data - NOT timing/DTM.
 * Timing lives in ProductSequence.harvestStartDays (config-specific).
 *
 * One crop family can produce multiple products (garlic → bulb, scapes, seed).
 */
export interface ProductEntity {
  /** Unique identifier (composite: Crop + Product + Unit) */
  id: string;

  /** Links to crop family (e.g., "Garlic", "Tomato") */
  cropFamily: string;

  /** Product name - e.g., "Bulb", "Scapes", "Mature Leaf" */
  name: string;

  /** Unit of sale - bunch, lb, each, etc. */
  unit: string;

  /** Is this a food product? */
  isFood: boolean;

  /** Days product remains fresh after harvest */
  holdingWindow: number | null;

  // --- Pricing ---

  /** Market-specific prices (default: single year-round price) */
  prices: ProductPrice[];

  // --- Handling ---

  /** Wash type - "None", "Light", "Heavy", etc. */
  washType: string | null;

  /** Wash factor multiplier */
  washFactor: number | null;

  /** Units per crate */
  perCrate: number | null;

  /** Units per pack */
  unitsPerPack: number | null;

  /** Packing container type */
  packingContainer: string | null;

  /** Packaging cost per unit */
  packagingCost: number | null;

  /** Labor times for handling */
  laborTimes: ProductLaborTimes;

  /** CSA availability - "Yes", "No", "Maybe" */
  csaAvailability: string | null;

  /** CSA portion size */
  csaPortion: number | null;
}

// =============================================================================
// PRODUCT SEQUENCE
// =============================================================================

/**
 * Links a planting configuration to a product with harvest timing.
 *
 * This is the key concept: a single planting can produce multiple products,
 * each with different harvest timing. Examples:
 *
 * Garlic (Fall Field Planting):
 *   - Scapes: harvest_start_days=240, harvest_count=1
 *   - Fresh Bulb: harvest_start_days=260, harvest_count=1
 *
 * Overwintered Cabbage (user creates 3 sequences):
 *   - Fall leaves: harvest_start_days=60, harvest_count=4, days_between_harvest=7
 *   - Spring leaves: harvest_start_days=240, harvest_count=4, days_between_harvest=7
 *   - Heads: harvest_start_days=270, harvest_count=1
 *
 * Design decisions:
 * - No harvest_end needed: calculated from start + (count-1) * interval
 * - No complex harvest types: just count + interval covers all cases
 * - No is_destructive flag: if you're short-circuiting a bed, why model it?
 * - User decides which products to model for a given planting
 */
export interface ProductSequence {
  /** Unique identifier */
  id: string;

  /** Foreign key to PlantingConfigEntity */
  plantingConfigId: string;

  /** Foreign key to ProductEntity */
  productId: string;

  /** Days from planting to first harvest of this product */
  harvestStartDays: number;

  /** Number of harvests (1 = single harvest, >1 = recurring) */
  harvestCount: number;

  /**
   * Days between harvests.
   * UI: Only shown when harvestCount > 1 (progressive disclosure)
   */
  daysBetweenHarvest: number | null;

  /** Units harvested each time */
  yieldPerHarvest: number | null;
}

// =============================================================================
// PLANTING CONFIGURATION ENTITY
// =============================================================================

/**
 * A stage in the tray sequence (seed → prick out → pot up → transplant).
 * UI: Only shown for transplant planting type (progressive disclosure).
 */
export interface TrayStage {
  /** Stage type - "seed", "prick_out", "pot_up" */
  stageType: 'seed' | 'prick_out' | 'pot_up';

  /** Cells per tray (e.g., 128, 72, 50) */
  traySize: number;

  /** Days in this stage before next stage or transplant */
  daysInStage: number;
}

/**
 * Planting type enumeration.
 *
 * Note: Perennial is a planting configuration choice, not a crop property.
 * Same crop can be grown as annual or perennial (e.g., strawberries, some herbs).
 */
export type PlantingType = 'direct_seed' | 'transplant' | 'perennial';

/**
 * DTM method - where the "days to maturity" is measured from.
 * Used for converting between different DTM conventions.
 */
export type DtmMethod = 'from_direct_seed' | 'from_transplant' | 'from_seeding';

/**
 * Specific parameters for how a crop is planted and grown.
 *
 * Design decisions:
 * - DTM moved to ProductEntity (maturity depends on product, not config)
 * - Harvest timing moved to ProductSequence (multiple products per planting)
 * - Perennial is a config choice, not a crop property
 *
 * Progressive disclosure (UI principle):
 * - traySequence: Only shown for plantingType='transplant'
 * - Direct seed fields: Only shown for plantingType='direct_seed'
 * - establishmentYears: Only shown for plantingType='perennial'
 *
 * Bed lifecycle: A bed is "done" when the last ProductSequence completes
 * (latest harvestStartDays + (harvestCount-1) * daysBetweenHarvest).
 */
export interface PlantingConfigEntity {
  /** Unique identifier */
  id: string;

  /** Foreign key to CropEntity */
  cropId: string;

  /** Auto-generated description (renamed from "Identifier") */
  quickDescription: string;

  /** Growing structure - "GH", "Field", "HT", etc. */
  growingStructure: string;

  /** How the crop is planted */
  plantingType: PlantingType;

  /** Is this configuration treating the crop as a perennial? */
  isPerennial: boolean;

  /**
   * Years before full production (for perennial configs).
   * UI: Only shown when plantingType='perennial'
   */
  establishmentYears: number | null;

  /** Rows per bed */
  rows: number | null;

  /** In-row spacing (inches) */
  spacing: number | null;

  /**
   * Sequence of tray stages before field transplant.
   * UI: Only shown when plantingType='transplant'
   */
  traySequence: TrayStage[];

  /**
   * What DTM is measured from (for conversion between conventions).
   * The actual DTM values live on ProductEntity.
   */
  dtmMethod: DtmMethod | null;

  /** Seed-to-harvest adjustment for DTM method differences */
  sth: number | null;

  // --- Calculated fields (derived at runtime, not stored) ---

  /** Total days in cells (sum of traySequence) - CALCULATED */
  daysInCells?: number;

  /** Days in field - CALCULATED from product sequences */
  daysInField?: number;

  /** Harvest window in days - CALCULATED from product sequences */
  harvestWindow?: number;

  /** Plantings per bed - CALCULATED from rows, spacing, bed length */
  plantingsPerBed?: number;

  // --- Legacy fields (kept for migration, will be removed) ---

  /** @deprecated Use ProductSequence instead */
  productId?: string | null;

  /** @deprecated DTM now lives on ProductEntity */
  dtmLower?: number | null;

  /** @deprecated DTM now lives on ProductEntity */
  dtmUpper?: number | null;

  /** @deprecated DTM now lives on ProductEntity */
  dtm?: number | null;

  /** @deprecated Use ProductSequence.harvestCount instead */
  harvests?: number | null;

  /** @deprecated Use ProductSequence.daysBetweenHarvest instead */
  daysBetweenHarvest?: number | null;

  /** @deprecated Use ProductSequence.yieldPerHarvest instead */
  unitsPerHarvest?: number | null;
}

// =============================================================================
// PLANTING SCHEDULE ENTITY (Future - for actual plan instances)
// =============================================================================

/**
 * An actual planting instance in a plan year.
 * Links a PlantingConfig to specific dates and quantities.
 */
export interface PlantingScheduleEntity {
  /** Unique identifier */
  id: string;

  /** Foreign key to PlantingConfigEntity */
  configId: string;

  /** Plan year */
  year: number;

  /** Target sow/seed date */
  targetSowDate: string;

  /** Target transplant date (if applicable) */
  targetTransplantDate: string | null;

  /** Expected first harvest date */
  targetHarvestStart: string | null;

  /** Number of beds planned */
  bedsPlanned: number;

  /** Which succession this is (1, 2, 3...) */
  successionNumber: number;

  /** Notes specific to this planting */
  notes: string | null;
}

// =============================================================================
// NORMALIZED DATA STRUCTURE
// =============================================================================

/**
 * The complete normalized data structure.
 *
 * Workflow for creating a new PlantingConfig:
 * 1. Select Crop (or create new) - crop-level data (DTG, row cover) comes for free
 * 2. Configure Planting - structure, rows, spacing, tray sequence
 * 3. Add ProductSequences - pick products, set timing/yields, DTM comes from product
 *
 * "Copy from existing" flow:
 * - Pick a similar planting config as template
 * - All sequences copied, user tweaks what differs
 */
export interface NormalizedData {
  /** Extraction metadata */
  meta: {
    extractedAt: string;
    sourceFile: string;
    version: string;
  };

  /** All crops indexed by id */
  crops: Record<string, CropEntity>;

  /** All products indexed by id */
  products: Record<string, ProductEntity>;

  /** All planting configurations indexed by id */
  plantingConfigs: Record<string, PlantingConfigEntity>;

  /** All product sequences indexed by id */
  productSequences: Record<string, ProductSequence>;

  /** Index: cropFamily -> cropIds */
  cropFamilyIndex: Record<string, string[]>;

  /** Index: cropFamily -> productIds */
  productByCropFamilyIndex: Record<string, string[]>;

  /** Index: plantingConfigId -> productSequenceIds */
  sequencesByConfigIndex: Record<string, string[]>;
}
