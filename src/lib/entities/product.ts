/**
 * Product Entity
 *
 * Represents a sellable product (e.g., "Tomato - Slicing - lb").
 * Products are unique by crop + product name + unit.
 * Used for revenue calculations and seed order planning.
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * A product that can be sold from the farm.
 */
export interface Product {
  /** Unique identifier (deterministic: derived from crop|product|unit) */
  id: string;

  /** Crop name this product comes from (e.g., "Tomato") */
  crop: string;

  /** Product type/name (e.g., "Slicing", "Cherry", "Bunched") */
  product: string;

  /** Unit of sale (e.g., "lb", "bunch", "pint") */
  unit: string;

  /** Price for direct sales (farmers market, CSA) */
  directPrice?: number;

  /** Price for wholesale sales */
  wholesalePrice?: number;
}

/**
 * Input for creating a new product.
 */
export interface CreateProductInput {
  crop: string;
  product: string;
  unit: string;
  directPrice?: number;
  wholesalePrice?: number;
}

// =============================================================================
// KEY GENERATION
// =============================================================================

/**
 * Generate a deterministic product key from crop, product, and unit.
 * Used for deduplication and lookups.
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
 * Create a new product with a deterministic ID.
 */
export function createProduct(input: CreateProductInput): Product {
  const id = getProductKey(input.crop, input.product, input.unit);

  return {
    id,
    crop: input.crop.trim(),
    product: input.product.trim(),
    unit: input.unit.trim(),
    directPrice: input.directPrice,
    wholesalePrice: input.wholesalePrice,
  };
}

/**
 * Clone a product (for plan copying).
 * Products are immutable so this just returns a shallow copy.
 */
export function cloneProduct(product: Product): Product {
  return { ...product };
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
// LOOKUP HELPERS
// =============================================================================

/**
 * Find a product matching a crop and unit.
 * Used to look up product info for a CropConfig based on its crop and yieldUnit.
 *
 * @param products - Products record to search
 * @param crop - Crop name to match
 * @param unit - Unit to match (typically from CropConfig.yieldUnit)
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
