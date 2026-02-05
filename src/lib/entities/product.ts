/**
 * Product Entity
 *
 * Represents a sellable product (e.g., "Tomato - Slicing - lb").
 * Products have a unique UUID ID (durable identity) and are also unique by
 * the combination of crop + product name + unit (for deduplication).
 * Used for revenue calculations and seed order planning.
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * A product that can be sold from the farm.
 * Prices are stored per market ID in the prices record.
 */
export interface Product {
  /** Unique identifier (UUID for durable identity) */
  id: string;

  /** Crop name this product comes from (e.g., "Tomato") */
  crop: string;

  /** Reference to Crop entity ID for stable linking (populated by migration) */
  cropId?: string;

  /** Product type/name (e.g., "Slicing", "Cherry", "Bunched") */
  product: string;

  /** Unit of sale (e.g., "lb", "bunch", "pint") */
  unit: string;

  /** Prices per market - keys are market IDs, values are prices */
  prices: Record<string, number>;

  /** How long (in days) this product can be held post-harvest before sale */
  holdingWindow?: number;

  /** Typical portion size for CSA shares (in the product's unit) */
  portionSize?: number;
}

/**
 * Input for creating a new product.
 */
export interface CreateProductInput {
  crop: string;
  product: string;
  unit: string;
  prices?: Record<string, number>;
  holdingWindow?: number;
  portionSize?: number;
}

// =============================================================================
// ID AND KEY GENERATION
// =============================================================================

/**
 * Generate a unique product ID (UUID-style).
 */
export function generateProductId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return `prod_${result}`;
}

/**
 * Generate a deterministic product key from crop, product, and unit.
 * Used for uniqueness checks and deduplication during import.
 * NOT used as the product ID (products use UUIDs for durable identity).
 *
 * @param crop - Crop name
 * @param product - Product type/name
 * @param unit - Unit of sale
 * @returns Normalized key in format "crop|product|unit"
 */
export function getProductKey(crop: string, product: string, unit: string): string {
  return `${crop.toLowerCase().trim()}|${product.toLowerCase().trim()}|${unit.toLowerCase().trim()}`;
}

// =============================================================================
// CRUD FUNCTIONS
// =============================================================================

/**
 * Create a new product with a UUID.
 */
export function createProduct(input: CreateProductInput): Product {
  return {
    id: generateProductId(),
    crop: input.crop.trim(),
    product: input.product.trim(),
    unit: input.unit.trim(),
    prices: input.prices ?? {},
    holdingWindow: input.holdingWindow,
    portionSize: input.portionSize,
  };
}

/**
 * Clone a product (for plan copying).
 * Products are immutable so this just returns a shallow copy.
 */
export function cloneProduct(product: Product): Product {
  return { ...product, prices: { ...product.prices }, portionSize: product.portionSize };
}

/**
 * Clone a products record (for plan copying).
 */
export function cloneProducts(products: Record<string, Product>): Record<string, Product> {
  const cloned: Record<string, Product> = {};
  for (const [id, product] of Object.entries(products)) {
    cloned[id] = cloneProduct(product);
  }
  return cloned;
}

// =============================================================================
// PRICE HELPERS
// =============================================================================

/**
 * Get the price for a specific market.
 * Returns the market-specific price or undefined if not set.
 */
export function getProductPrice(product: Product, marketId: string): number | undefined {
  return product.prices[marketId];
}

/**
 * Get the first available price (for display when no market specified).
 * Returns the price from the first market that has a price set.
 */
export function getFirstPrice(product: Product): number | undefined {
  const prices = Object.values(product.prices);
  return prices.length > 0 ? prices[0] : undefined;
}

// =============================================================================
// LOOKUP HELPERS
// =============================================================================

/**
 * Find a product matching a crop and unit.
 * Used to look up product info for a PlantingSpec based on its crop and yieldUnit.
 *
 * @param products - Products record to search
 * @param crop - Crop name to match
 * @param unit - Unit to match (typically from PlantingSpec.yieldUnit)
 * @returns Matching product or undefined
 */
export function findProductByCropAndUnit(
  products: Record<string, Product>,
  crop: string,
  unit: string
): Product | undefined {
  const normalizedCrop = crop.toLowerCase().trim();
  const normalizedUnit = unit.toLowerCase().trim();

  return Object.values(products).find(
    p => p.crop.toLowerCase() === normalizedCrop && p.unit.toLowerCase() === normalizedUnit
  );
}

/**
 * Get all products for a specific crop.
 */
export function getProductsForCrop(
  products: Record<string, Product>,
  crop: string
): Product[] {
  const normalizedCrop = crop.toLowerCase().trim();
  return Object.values(products).filter(
    p => p.crop.toLowerCase() === normalizedCrop
  );
}
