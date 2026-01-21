/**
 * Crop Config Entity
 *
 * Represents a planting configuration - how a specific crop variety is grown.
 * Includes timing calculations for deriving harvest dates from config data.
 *
 * KEY CONCEPT: normalMethod vs plantingMethod
 *
 * normalMethod (input) = How DTM is defined for this crop variety:
 *   - "from-seeding": DTM is from direct seeding in field (seed packet says "60 days from sowing")
 *   - "from-transplant": DTM is from transplant in field (seed packet says "60 days from transplant")
 *   - "total-time": DTM is total time from seeding a TRANSPLANT to harvest (from growers/books,
 *          includes greenhouse time and transplant shock in the total)
 *
 * plantingMethod (calculated) = How you're actually growing it:
 *   - "direct-seed": Direct seeding (no tray stages)
 *   - "transplant": Transplanting (has tray stages)
 *   - "perennial": Perennial (persists across seasons)
 *
 * These are independent! A crop with normalMethod "from-seeding" can still be grown as
 * transplants if you add tray stages.
 */

// =============================================================================
// TYPES
// =============================================================================

/** A single tray stage in the greenhouse */
export interface TrayStage {
  /** Days spent in this tray */
  days: number;
  /** Number of cells per tray (e.g., 128, 72, 50) */
  cellsPerTray?: number;
}

/** Planting method - how the crop is actually grown */
export type PlantingMethod = 'direct-seed' | 'transplant' | 'perennial';

/**
 * ProductYield - Links a CropConfig to a Product with yield and timing info.
 *
 * Each ProductYield represents one product that this crop configuration produces,
 * with its own timing (DTM, harvest pattern) and yield formula.
 *
 * Example: Garlic config might have two ProductYields:
 * - Scapes: DTM 180, 1 harvest
 * - Bulbs: DTM 220, 1 harvest
 */
export interface ProductYield {
  /** Reference to Product in plan.products */
  productId: string;

  /** Days to maturity for THIS product (same meaning as CropConfig.dtm) */
  dtm: number;

  /** How many times this product is harvested */
  numberOfHarvests: number;

  /** Days between harvests (only if numberOfHarvests > 1) */
  daysBetweenHarvest?: number;

  /** Yield formula for this product (uses same context as CropConfig) */
  yieldFormula?: string;

  /** Buffer days for this product's initial harvest window */
  harvestBufferDays?: number;

  /** Post-harvest field days (typically only on last product to harvest) */
  postHarvestFieldDays?: number;
}

/**
 * Crop configuration - what we store in crop-config-template.json and plan.cropCatalog.
 *
 * This is the "planting recipe" - all the data needed to calculate
 * timing and display for a specific way of growing a crop variety.
 */
export interface CropConfig {
  /** Unique identifier (e.g., "arugula-baby-leaf-field-ds-sp") */
  id: string;

  /** Human-readable identifier matching legacy data */
  identifier: string;

  /** Crop family (e.g., "Arugula", "Tomato") */
  crop: string;

  /** Category for color coding (e.g., "Green", "Brassica") */
  category?: string;

  /**
   * Materialized search text for efficient filtering.
   * Contains concatenated searchable fields: identifier, crop, product names, category.
   * Pre-computed at import/creation time to avoid repeated lookups during filtering.
   */
  searchText?: string;

  // ---- Spacing ----

  /** Number of rows per bed */
  rows?: number;

  /** In-row spacing in inches */
  spacing?: number;

  /** Growing structure: "field", "greenhouse", "high-tunnel" */
  growingStructure?: 'field' | 'greenhouse' | 'high-tunnel';

  /** How DTM is measured: from-seeding, from-transplant, or total-time */
  normalMethod?: 'from-seeding' | 'from-transplant' | 'total-time';

  // ---- Timing Inputs ----

  /**
   * @deprecated Use productYields[].dtm instead.
   * Days to maturity (meaning depends on normalMethod).
   * Legacy field kept for backwards compatibility with old saved plans.
   */
  dtm?: number;

  /** Days from seeding to germination (shared across all products) */
  daysToGermination?: number;

  /**
   * @deprecated Calculated from productYields now.
   * Base harvest window in days (before adjustments).
   */
  harvestWindow?: number;

  /** Greenhouse tray stages (empty = direct seeded) */
  trayStages?: TrayStage[];

  // ---- Status ----

  /** Whether this config is deprecated */
  deprecated?: boolean;

  /** Whether crop is perennial (persists across seasons) */
  perennial?: boolean;

  // ---- Advanced Timing ----

  /**
   * Assumed transplant age (days) when DTM was measured for TP crops.
   * Default: 30 days. Override per-crop if known.
   */
  assumedTransplantDays?: number;

  /**
   * @deprecated Use productYields[].daysBetweenHarvest instead.
   * Days between harvests (for multiple harvest crops).
   */
  daysBetweenHarvest?: number;

  /**
   * @deprecated Use productYields[].numberOfHarvests instead.
   * Number of harvests over the production period.
   */
  numberOfHarvests?: number;

  // ---- Yield Model ----
  // Formula-based yield calculation with arbitrary expressions.
  // See docs/yield-calculation-design.md for full explanation.

  /**
   * @deprecated Use productYields[].yieldFormula instead.
   * Yield formula as an expression string.
   * Legacy field kept for backwards compatibility with old saved plans.
   */
  yieldFormula?: string;

  /**
   * @deprecated Unit now comes from Product entity.
   * Unit of measure for yield (lb, bunch, head, etc.)
   */
  yieldUnit?: string;

  // ---- Seed-based yield (for shallots, etc.) ----

  /** Seeds per bed for seed-based yield calculations */
  seedsPerBed?: number;

  /** Seeds per planting/transplant */
  seedsPerPlanting?: number;

  /** Safety factor for extra cells/trays (typically 1.1-1.3) */
  safetyFactor?: number;

  /** Seeding factor for multi-seeding per cell (typically 1, sometimes 2) */
  seedingFactor?: number;

  // ---- Legacy yield field (for backwards compatibility during migration) ----

  /**
   * @deprecated Use yieldFormula instead.
   * Pre-calculated yield per harvest for a standard 50ft bed.
   */
  yieldPerHarvest?: number;

  /**
   * @deprecated Use productYields[].postHarvestFieldDays instead.
   * Days crop occupies bed after last harvest (e.g., tuber curing).
   */
  postHarvestFieldDays?: number;

  /**
   * @deprecated Use productYields[].harvestBufferDays instead.
   * Buffer days for initial harvest window.
   */
  harvestBufferDays?: number;

  // ---- Scheduling ----

  /**
   * Target field date as month-day (format: "MM-DD") for default scheduling.
   * When adding a planting, this is combined with the plan year to set fieldStartDate.
   */
  targetFieldDate?: string;

  // ---- Default Seed Source ----

  /**
   * Default seed variety or mix for this crop config.
   * When creating new plantings, this is auto-assigned if set.
   * Can be overridden per-planting.
   */
  defaultSeedSource?: import('./planting').SeedSource;

  /**
   * Default market split for this crop config.
   * Defines how revenue is allocated across markets (Direct, Wholesale, U-Pick).
   * When creating new plantings, this is auto-assigned if set.
   * Can be overridden per-planting.
   */
  defaultMarketSplit?: import('./market').MarketSplit;

  // ---- Products & Timing ----

  /**
   * Products this config produces with timing and yield info.
   *
   * REQUIRED: At least one product must be specified for timing calculations.
   *
   * Each ProductYield has its own DTM, harvest pattern, and yield formula.
   * The crop's bed occupation is determined by the latest-finishing product.
   * Harvest window spans from first harvest of any product to last harvest of any product.
   */
  productYields?: ProductYield[];
}

/** Calculated crop values (derived at runtime) */
export interface CropCalculated {
  /** Days spent in greenhouse trays (sum of all tray stage days) */
  daysInCells: number;
  /** Seed To Harvest - total days from seeding to first harvest */
  seedToHarvest: number;
  /** How the crop is actually grown: direct-seed, transplant, or perennial */
  plantingMethod: PlantingMethod;
  /** Duration of harvest period in days */
  harvestWindow: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Transplant shock / Direct seed establishment compensation (days).
 *
 * Johnny's Seeds reference: "subtract about 14 days for days to maturity
 * from transplant" when converting TP timing to DS timing.
 */
const PLANTING_METHOD_DELTA_DAYS = 14;

/**
 * Default assumed transplant age (days) for TP crops.
 * ~4 weeks, a rough middle-ground assumption.
 */
const DEFAULT_ASSUMED_TRANSPLANT_DAYS = 30;

// =============================================================================
// CALCULATIONS
// =============================================================================

/**
 * Calculate Days in Cells from tray stages.
 * This is the total time spent in greenhouse before transplanting.
 */
export function calculateDaysInCells(crop: CropConfig): number {
  if (!crop.trayStages || crop.trayStages.length === 0) {
    return 0;
  }
  return crop.trayStages.reduce((sum, stage) => sum + (stage.days ?? 0), 0);
}

/**
 * Calculate Seed To Harvest based on normalMethod.
 *
 * Converts the user-entered DTM into total time from seeding to harvest,
 * accounting for how DTM was measured vs how the crop is being grown.
 */
export function calculateSeedToHarvest(crop: CropConfig, daysInCells: number): number {
  const method = crop.normalMethod ?? 'total-time';
  const dtm = crop.dtm ?? 0;
  const dtg = crop.daysToGermination ?? 0;
  const isTransplant = daysInCells > 0;

  switch (method) {
    case 'from-seeding':
      // DTM is measured from emergence (germination)
      // direct: dtg + dtm
      // transplant: dtg + dtm + shock
      return dtg + dtm + (isTransplant ? PLANTING_METHOD_DELTA_DAYS : 0);

    case 'from-transplant': {
      // DTM is measured from transplant date (in-field time only)
      // transplant: daysInCells + dtm
      // direct: assumedDays + dtm - delta
      const assumedDays = crop.assumedTransplantDays ?? DEFAULT_ASSUMED_TRANSPLANT_DAYS;
      return isTransplant
        ? daysInCells + dtm
        : assumedDays + dtm - PLANTING_METHOD_DELTA_DAYS;
    }

    case 'total-time':
      // DTM is total time from seeding a transplant to harvest
      // transplant: dtm (use as-is)
      // direct: dtm - delta (no shock = faster)
      return dtm - (isTransplant ? 0 : PLANTING_METHOD_DELTA_DAYS);

    default:
      return dtm;
  }
}

/**
 * Calculate Planting Method from tray stages and perennial flag.
 */
export function calculatePlantingMethod(crop: CropConfig): PlantingMethod {
  if (crop.perennial) {
    return 'perennial';
  }
  const daysInCells = calculateDaysInCells(crop);
  return daysInCells === 0 ? 'direct-seed' : 'transplant';
}

// =============================================================================
// YIELD FORMULA EVALUATION
// =============================================================================

/** Standard bed length for yield comparisons */
const STANDARD_BED_LENGTH = 50;

/** Available variables for yield formulas */
export interface YieldFormulaContext {
  /** Plantings per bed (calculated from spacing × rows × bedFeet) */
  plantingsPerBed: number;
  /** Bed length in feet */
  bedFeet: number;
  /** Number of harvests */
  harvests: number;
  /** Days between harvest */
  daysBetweenHarvest: number;
  /** Number of rows */
  rows: number;
  /** In-row spacing (inches) */
  spacing: number;
  /** Seeds per bed (for seed-based crops) */
  seeds: number;
  /** Seed to harvest days (for time-based formulas) */
  seedToHarvest: number;
  /** Days to maturity */
  daysToMaturity: number;
  /** Days in greenhouse (tray stages) */
  daysInCells: number;
  /** Harvest window in days */
  harvestWindow: number;
}

/** Result of formula evaluation */
export interface YieldFormulaResult {
  /** Calculated value, or null if formula is invalid/missing */
  value: number | null;
  /** Error message if evaluation failed */
  error?: string;
  /** Warning messages (non-fatal issues) */
  warnings: string[];
}

/**
 * Calculate Plants Per Bed for a given bed length.
 *
 * Formula: (12 / inRowSpacing) * rows * bedFeet
 * The 12 converts inches to feet (12 inches/foot).
 */
export function calculatePlantsPerBed(
  inRowSpacing: number,
  rows: number,
  bedFeet: number
): number {
  if (!inRowSpacing || inRowSpacing <= 0 || !rows || rows <= 0) {
    return 0;
  }
  return (12 / inRowSpacing) * rows * bedFeet;
}

/**
 * Tokenize a yield formula string.
 * Returns tokens: numbers, variables, operators, parentheses.
 */
function tokenize(formula: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < formula.length) {
    const char = formula[i];

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Number (including decimals)
    if (/[0-9.]/.test(char)) {
      let num = '';
      while (i < formula.length && /[0-9.]/.test(formula[i])) {
        num += formula[i];
        i++;
      }
      tokens.push(num);
      continue;
    }

    // Variable (letters)
    if (/[a-zA-Z_]/.test(char)) {
      let varName = '';
      while (i < formula.length && /[a-zA-Z0-9_]/.test(formula[i])) {
        varName += formula[i];
        i++;
      }
      tokens.push(varName);
      continue;
    }

    // Operators and parentheses
    if (/[+\-*/()]/.test(char)) {
      tokens.push(char);
      i++;
      continue;
    }

    // Unknown character - skip it
    i++;
  }

  return tokens;
}

/**
 * Parse and evaluate a yield formula safely.
 *
 * Supports: numbers, variables, +, -, *, /, parentheses
 * Does NOT support: function calls, assignments, or any other operations
 *
 * Uses a simple recursive descent parser for safety.
 */
export function evaluateYieldFormula(
  formula: string,
  context: YieldFormulaContext
): YieldFormulaResult {
  const warnings: string[] = [];

  if (!formula || formula.trim() === '') {
    return { value: null, warnings };
  }

  const tokens = tokenize(formula);
  if (tokens.length === 0) {
    return { value: null, error: 'Empty formula', warnings };
  }

  let pos = 0;
  const usedVariables = new Set<string>();

  // Helper to get current token
  const peek = (): string | undefined => tokens[pos];
  const consume = (): string => tokens[pos++];

  // Recursive descent parser
  function parseExpression(): number {
    let left = parseTerm();

    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }

    return left;
  }

  function parseTerm(): number {
    let left = parseFactor();

    while (peek() === '*' || peek() === '/') {
      const op = consume();
      const right = parseFactor();
      if (op === '/') {
        if (right === 0) {
          throw new Error('Division by zero');
        }
        left = left / right;
      } else {
        left = left * right;
      }
    }

    return left;
  }

  function parseFactor(): number {
    const token = peek();

    if (token === undefined) {
      throw new Error('Unexpected end of formula');
    }

    // Parentheses
    if (token === '(') {
      consume(); // consume '('
      const result = parseExpression();
      if (peek() !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      consume(); // consume ')'
      return result;
    }

    // Unary minus
    if (token === '-') {
      consume();
      return -parseFactor();
    }

    // Number
    if (/^[0-9.]/.test(token)) {
      consume();
      const num = parseFloat(token);
      if (isNaN(num)) {
        throw new Error(`Invalid number: ${token}`);
      }
      return num;
    }

    // Variable
    if (/^[a-zA-Z_]/.test(token)) {
      consume();
      usedVariables.add(token);

      // Check if it's a known variable
      if (!(token in context)) {
        throw new Error(`Unknown variable: ${token}`);
      }

      const value = context[token as keyof YieldFormulaContext];
      if (typeof value !== 'number') {
        throw new Error(`Variable ${token} is not a number`);
      }
      return value;
    }

    throw new Error(`Unexpected token: ${token}`);
  }

  try {
    const result = parseExpression();

    // Check for leftover tokens
    if (pos < tokens.length) {
      return {
        value: null,
        error: `Unexpected token: ${tokens[pos]}`,
        warnings,
      };
    }

    // Generate warnings
    if (!usedVariables.has('harvests') && context.harvests > 1) {
      warnings.push(
        "Formula doesn't use 'harvests' - yield will be the same regardless of harvest count"
      );
    }

    if (result < 0) {
      warnings.push('Formula produces negative yield');
    }

    if (!isFinite(result)) {
      return { value: null, error: 'Formula produces infinite result', warnings };
    }

    return { value: result, warnings };
  } catch (e) {
    return {
      value: null,
      error: e instanceof Error ? e.message : 'Unknown error',
      warnings,
    };
  }
}

/**
 * Build a YieldFormulaContext from a CropConfig and bed length.
 */
export function buildYieldContext(
  crop: CropConfig,
  bedFeet: number,
  rowsOverride?: number,
  spacingOverride?: number
): YieldFormulaContext {
  // Use overrides, then crop values, then defaults
  const rows = rowsOverride ?? crop.rows ?? 1;
  const spacing = spacingOverride ?? crop.spacing ?? 12;
  const plantingsPerBed = calculatePlantsPerBed(spacing, rows, bedFeet);
  const daysInCells = calculateDaysInCells(crop);
  const seedToHarvest = calculateSeedToHarvest(crop, daysInCells);
  const harvestWindow = calculateHarvestWindow(crop);

  return {
    plantingsPerBed,
    bedFeet,
    harvests: crop.numberOfHarvests ?? 1,
    daysBetweenHarvest: crop.daysBetweenHarvest ?? 7,
    rows,
    spacing,
    seeds: crop.seedsPerBed ?? 0,
    seedToHarvest,
    daysToMaturity: crop.dtm ?? 0,
    daysInCells,
    harvestWindow,
  };
}

/**
 * Calculate total yield for a crop config at a given bed length.
 *
 * Priority order:
 * 1. yieldFormula - expression-based calculation
 * 2. yieldPerHarvest (legacy) - old per-harvest value × harvests
 *
 * Returns null if no yield data is available.
 */
export function calculateTotalYield(
  crop: CropConfig,
  bedFeet: number,
  rows?: number,
  inRowSpacing?: number
): number | null {
  // 1. Try formula-based yield
  if (crop.yieldFormula) {
    const context = buildYieldContext(crop, bedFeet, rows, inRowSpacing);
    const result = evaluateYieldFormula(crop.yieldFormula, context);
    if (result.value !== null) {
      return result.value;
    }
  }

  // 2. Fall back to legacy yieldPerHarvest
  // Legacy field is yield per harvest for 50ft bed, scale and multiply by harvests
  if (crop.yieldPerHarvest !== undefined) {
    const scaleFactor = bedFeet / STANDARD_BED_LENGTH;
    const harvests = crop.numberOfHarvests ?? 1;
    return crop.yieldPerHarvest * harvests * scaleFactor;
  }

  return null;
}

/**
 * Calculate yield per harvest for a crop config at a given bed length.
 */
export function calculateYieldPerHarvest(
  crop: CropConfig,
  bedFeet: number,
  rows?: number,
  inRowSpacing?: number
): number | null {
  const total = calculateTotalYield(crop, bedFeet, rows, inRowSpacing);
  if (total === null) return null;

  const harvests = crop.numberOfHarvests ?? 1;
  return total / harvests;
}

/**
 * Calculate standardized total yield for a 50ft bed.
 * Used for comparing configs in Explorer.
 */
export function calculateStandardYield(
  crop: CropConfig,
  rows?: number,
  inRowSpacing?: number
): number | null {
  return calculateTotalYield(crop, STANDARD_BED_LENGTH, rows, inRowSpacing);
}

/**
 * Evaluate a yield formula and return detailed result for UI display.
 * Includes the calculated value, any errors, and warnings.
 */
export function evaluateYieldForDisplay(
  crop: CropConfig,
  rows?: number,
  inRowSpacing?: number
): YieldFormulaResult & { context: YieldFormulaContext } {
  const context = buildYieldContext(
    crop,
    STANDARD_BED_LENGTH,
    rows,
    inRowSpacing
  );

  if (!crop.yieldFormula) {
    // Check for legacy field
    if (crop.yieldPerHarvest !== undefined) {
      const harvests = crop.numberOfHarvests ?? 1;
      return {
        value: crop.yieldPerHarvest * harvests,
        warnings: ['Using legacy yieldPerHarvest field'],
        context,
      };
    }
    return { value: null, warnings: [], context };
  }

  const result = evaluateYieldFormula(crop.yieldFormula, context);
  return { ...result, context };
}

// =============================================================================
// SIMPLE MODE FORMULA BUILDERS
// =============================================================================

/** Yield basis options for simple mode */
export type YieldBasis = 'plant' | 'foot' | '100ft' | 'seed';

/**
 * Build a yield formula from simple mode inputs.
 *
 * @param basis - What the yield rate is based on (plant, foot, 100ft, seed)
 * @param rate - The yield rate value
 * @param perHarvest - If true, rate is per harvest (multiply by harvests)
 */
export function buildYieldFormula(
  basis: YieldBasis,
  rate: number,
  perHarvest: boolean
): string {
  let baseExpr: string;

  switch (basis) {
    case 'plant':
      baseExpr = `plantingsPerBed * ${rate}`;
      break;
    case 'foot':
      baseExpr = `bedFeet * ${rate}`;
      break;
    case '100ft':
      baseExpr = `(bedFeet / 100) * ${rate}`;
      break;
    case 'seed':
      baseExpr = `seeds * ${rate}`;
      break;
  }

  if (perHarvest) {
    return `${baseExpr} * harvests`;
  } else {
    return baseExpr;
  }
}

/**
 * Try to parse a formula back into simple mode inputs.
 * Returns null if the formula doesn't match a simple pattern.
 */
export function parseSimpleFormula(
  formula: string
): { basis: YieldBasis; rate: number; perHarvest: boolean } | null {
  if (!formula) return null;

  // Normalize whitespace
  const f = formula.replace(/\s+/g, ' ').trim();

  // Pattern: plantingsPerBed * rate [* harvests]
  let match = f.match(/^plantingsPerBed \* ([\d.]+)(?: \* harvests)?$/);
  if (match) {
    return {
      basis: 'plant',
      rate: parseFloat(match[1]),
      perHarvest: f.includes('* harvests'),
    };
  }

  // Pattern: bedFeet * rate [* harvests]
  match = f.match(/^bedFeet \* ([\d.]+)(?: \* harvests)?$/);
  if (match) {
    return {
      basis: 'foot',
      rate: parseFloat(match[1]),
      perHarvest: f.includes('* harvests'),
    };
  }

  // Pattern: (bedFeet / 100) * rate [* harvests]
  match = f.match(/^\(bedFeet \/ 100\) \* ([\d.]+)(?: \* harvests)?$/);
  if (match) {
    return {
      basis: '100ft',
      rate: parseFloat(match[1]),
      perHarvest: f.includes('* harvests'),
    };
  }

  // Pattern: seeds * rate [* harvests]
  match = f.match(/^seeds \* ([\d.]+)(?: \* harvests)?$/);
  if (match) {
    return {
      basis: 'seed',
      rate: parseFloat(match[1]),
      perHarvest: f.includes('* harvests'),
    };
  }

  return null; // Doesn't match a simple pattern
}

/**
 * Get display-friendly name for a yield basis.
 */
export function getYieldBasisLabel(basis: YieldBasis): string {
  switch (basis) {
    case 'plant':
      return 'per plant';
    case 'foot':
      return 'per foot';
    case '100ft':
      return 'per 100ft';
    case 'seed':
      return 'per seed';
  }
}

/**
 * Calculate Harvest Window from number of harvests and days between harvests.
 *
 * Formula: (numberOfHarvests - 1) * daysBetweenHarvest + harvestBufferDays + postHarvestFieldDays
 */
export function calculateHarvestWindow(crop: CropConfig): number {
  const harvests = crop.numberOfHarvests ?? 1;
  const daysBetween = crop.daysBetweenHarvest ?? 0;
  const buffer = crop.harvestBufferDays ?? 0;
  const postHarvest = crop.postHarvestFieldDays ?? 0;

  // Single harvest crops just get the buffer + post-harvest time
  if (harvests <= 1 || daysBetween === 0) {
    return buffer + postHarvest;
  }

  return (harvests - 1) * daysBetween + buffer + postHarvest;
}

// =============================================================================
// PER-PRODUCT CALCULATIONS
// =============================================================================

/**
 * Calculate Seed To Harvest for a specific ProductYield.
 *
 * Uses the product's DTM with the CropConfig's normalMethod and daysInCells,
 * since growing method (transplant vs direct) is shared across all products.
 */
export function calculateProductSeedToHarvest(
  productYield: ProductYield,
  crop: CropConfig,
  daysInCells: number
): number {
  const method = crop.normalMethod ?? 'total-time';
  const dtm = productYield.dtm;
  const dtg = crop.daysToGermination ?? 0;
  const isTransplant = daysInCells > 0;

  switch (method) {
    case 'from-seeding':
      return dtg + dtm + (isTransplant ? PLANTING_METHOD_DELTA_DAYS : 0);

    case 'from-transplant': {
      const assumedDays = crop.assumedTransplantDays ?? DEFAULT_ASSUMED_TRANSPLANT_DAYS;
      return isTransplant
        ? daysInCells + dtm
        : assumedDays + dtm - PLANTING_METHOD_DELTA_DAYS;
    }

    case 'total-time':
      return dtm - (isTransplant ? 0 : PLANTING_METHOD_DELTA_DAYS);

    default:
      return dtm;
  }
}

/**
 * Calculate Harvest Window for a specific ProductYield.
 */
export function calculateProductHarvestWindow(productYield: ProductYield): number {
  const harvests = productYield.numberOfHarvests;
  const daysBetween = productYield.daysBetweenHarvest ?? 0;
  const buffer = productYield.harvestBufferDays ?? 0;
  const postHarvest = productYield.postHarvestFieldDays ?? 0;

  if (harvests <= 1 || daysBetween === 0) {
    return buffer + postHarvest;
  }

  return (harvests - 1) * daysBetween + buffer + postHarvest;
}

/**
 * Calculate when a product's harvest period ends (days from seeding).
 */
export function calculateProductEndDay(
  productYield: ProductYield,
  crop: CropConfig,
  daysInCells: number
): number {
  const seedToHarvest = calculateProductSeedToHarvest(productYield, crop, daysInCells);
  const harvestWindow = calculateProductHarvestWindow(productYield);
  return seedToHarvest + harvestWindow;
}

/**
 * Calculate the aggregate crop end date across all products.
 *
 * Returns the latest end day among all products (when the bed is finally free).
 * This is measured from SEEDING (includes greenhouse time).
 * Requires productYields to be populated - no legacy fallback.
 */
export function calculateCropEndDay(crop: CropConfig): number {
  if (!crop.productYields || crop.productYields.length === 0) {
    // Return 0 for crops without products (will show as invalid in UI)
    return 0;
  }

  const daysInCells = calculateDaysInCells(crop);

  return Math.max(
    ...crop.productYields.map(py => calculateProductEndDay(py, crop, daysInCells))
  );
}

/**
 * Calculate how many days a crop occupies the bed (field days only).
 *
 * This is the time from transplant/field-start to crop end, excluding greenhouse time.
 * Used for bed efficiency calculations ($/day/100ft).
 *
 * For transplants: cropEndDay - daysInCells
 * For direct seed: cropEndDay (daysInCells is 0)
 */
export function calculateFieldOccupationDays(crop: CropConfig): number {
  const cropEndDay = calculateCropEndDay(crop);
  if (cropEndDay === 0) return 0;

  const daysInCells = calculateDaysInCells(crop);
  return cropEndDay - daysInCells;
}

/**
 * Calculate the total harvest window across all products.
 *
 * This is the time from the first product's first harvest to the last product's last harvest.
 * Useful for timeline display showing the overall harvest period.
 *
 * Requires productYields to be populated - no legacy fallback.
 */
export function calculateAggregateHarvestWindow(crop: CropConfig): number {
  if (!crop.productYields || crop.productYields.length === 0) {
    // Return 0 for crops without products (will show as invalid in UI)
    return 0;
  }

  const daysInCells = calculateDaysInCells(crop);

  // Find earliest first harvest and latest last harvest
  let earliestFirstHarvest = Infinity;
  let latestLastHarvest = 0;

  for (const py of crop.productYields) {
    const seedToHarvest = calculateProductSeedToHarvest(py, crop, daysInCells);
    const harvestWindow = calculateProductHarvestWindow(py);
    const endDay = seedToHarvest + harvestWindow;

    earliestFirstHarvest = Math.min(earliestFirstHarvest, seedToHarvest);
    latestLastHarvest = Math.max(latestLastHarvest, endDay);
  }

  return latestLastHarvest - earliestFirstHarvest;
}

/**
 * Get the primary (earliest) product's seed-to-harvest.
 *
 * Returns the time from seeding to the first harvest of any product.
 * Requires productYields to be populated - no legacy fallback.
 */
export function getPrimarySeedToHarvest(crop: CropConfig): number {
  if (!crop.productYields || crop.productYields.length === 0) {
    // Return 0 for crops without products (will show as invalid in UI)
    return 0;
  }

  const daysInCells = calculateDaysInCells(crop);

  // Use the earliest harvesting product as "primary"
  let earliest = Infinity;
  for (const py of crop.productYields) {
    const sth = calculateProductSeedToHarvest(py, crop, daysInCells);
    earliest = Math.min(earliest, sth);
  }
  return earliest === Infinity ? 0 : earliest;
}

/**
 * Calculate all derived timing fields for a crop.
 *
 * If productYields exists, uses the primary (earliest) product for seedToHarvest
 * and the aggregate harvest window across all products.
 */
export function calculateCropFields(crop: CropConfig): CropCalculated {
  const daysInCells = calculateDaysInCells(crop);
  const plantingMethod = calculatePlantingMethod(crop);

  // Use product-aware calculations if productYields exists
  const seedToHarvest = getPrimarySeedToHarvest(crop);
  const harvestWindow = calculateAggregateHarvestWindow(crop);

  return {
    daysInCells,
    seedToHarvest,
    plantingMethod,
    harvestWindow,
  };
}

/**
 * Get the primary product name from a CropConfig.
 * Returns the first product's name from productYields, or 'General' if none.
 *
 * @param crop - The crop config
 * @param products - Optional product lookup map (keyed by productId)
 */
export function getPrimaryProductName(
  crop: CropConfig,
  products?: Record<string, { product: string }>
): string {
  if (!crop.productYields?.length || !products) {
    return 'General';
  }
  const firstYield = crop.productYields[0];
  const product = products[firstYield.productId];
  return product?.product ?? 'General';
}

/**
 * Get the config needed for timeline calculations from a crop.
 * Combines stored inputs with calculated values.
 *
 * Uses product-aware calculations if productYields exists.
 *
 * @param crop - The crop config
 * @param products - Optional product lookup map for deriving product name
 */
export function getTimelineConfig(
  crop: CropConfig,
  products?: Record<string, { product: string }>
): {
  crop: string;
  product: string;
  category: string;
  growingStructure: string;
  plantingMethod: PlantingMethod;
  seedToHarvest: number; // Total seed-to-harvest days
  harvestWindow: number;
  daysInCells: number;
} {
  const calculated = calculateCropFields(crop);

  return {
    crop: crop.crop,
    product: getPrimaryProductName(crop, products),
    category: crop.category ?? '',
    growingStructure: crop.growingStructure ?? 'field',
    plantingMethod: calculated.plantingMethod,
    seedToHarvest: calculated.seedToHarvest,
    harvestWindow: calculated.harvestWindow,
    daysInCells: calculated.daysInCells,
  };
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Generate a unique ID for a custom crop config.
 * Format: custom_{timestamp}_{random}
 */
export function generateConfigId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `custom_${timestamp}_${random}`;
}

/**
 * Create a blank CropConfig with sensible defaults.
 * Used when creating a new config from scratch.
 */
export function createBlankConfig(): CropConfig {
  return {
    id: generateConfigId(),
    identifier: '',
    crop: '',
    category: '',
    growingStructure: 'field',
    normalMethod: 'from-seeding',
    dtm: 60,
    daysToGermination: 7,
    harvestWindow: 7,
    harvestBufferDays: 7,
    numberOfHarvests: 1,
    daysBetweenHarvest: 0,
    trayStages: [],
    deprecated: false,
    perennial: false,
  };
}

/**
 * Generate a suggested name for a copied config.
 * If name ends with (N), increments to (N+1). Otherwise appends (1).
 */
function generateCopyName(name: string): string {
  const match = name.match(/^(.+?)\s*\((\d+)\)$/);
  if (match) {
    const base = match[1];
    const num = parseInt(match[2], 10);
    return `${base} (${num + 1})`;
  }
  return `${name} (1)`;
}

/**
 * Create a copy of an existing CropConfig for modification.
 * Generates a new ID and suggests a new identifier with (N) suffix.
 */
export function copyConfig(source: CropConfig): CropConfig {
  return {
    ...source,
    id: generateConfigId(),
    identifier: generateCopyName(source.identifier),
  };
}

/**
 * Clone a CropConfig for inclusion in a plan's local catalog.
 * Creates a deep copy preserving all fields including identifier.
 *
 * Use this when importing configs from master catalog to plan-local catalog.
 */
export function cloneCropConfig(source: CropConfig): CropConfig {
  // Deep copy to avoid mutations affecting master catalog
  return JSON.parse(JSON.stringify(source));
}

/**
 * Clone multiple CropConfigs into a catalog keyed by identifier.
 * Use this for bulk import from master catalog to plan-local catalog.
 */
export function cloneCropCatalog(
  sources: CropConfig[]
): Record<string, CropConfig> {
  const catalog: Record<string, CropConfig> = {};
  for (const source of sources) {
    catalog[source.identifier] = cloneCropConfig(source);
  }
  return catalog;
}
