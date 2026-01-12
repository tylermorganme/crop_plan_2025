/**
 * SeedOrder Entity
 *
 * Represents a seed ordering decision for a specific variety within a plan.
 * Tracks what product to buy (weight, unit, cost) and quantity.
 *
 * Design:
 * - 1:1 with Variety within a plan (one order decision per variety per plan)
 * - Lives at plan level (each plan tracks its own orders)
 * - "Needed" seeds calculated at runtime from plantings (not stored here)
 * - Orphan orders (no matching plantings) persist but don't count toward totals
 */

import type { DensityUnit } from './variety';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Unit for seed product purchases.
 * Same as DensityUnit - seeds can be sold by weight or count.
 */
export type ProductUnit = DensityUnit;

/**
 * A seed ordering decision for a specific variety.
 *
 * Tracks what product to buy and how much, independent of planting needs.
 * This allows orders to persist across plan changes.
 */
export interface SeedOrder {
  /**
   * Unique identifier - deterministic from varietyId.
   * Format: SO_{varietyId}
   */
  id: string;

  /** Reference to the Variety this order is for */
  varietyId: string;

  /**
   * Weight/count of one product unit.
   * E.g., if buying a "1 oz packet", productWeight = 1.
   * If buying "5000 seed packet", productWeight = 5000.
   */
  productWeight?: number;

  /**
   * Unit for product measurement.
   * 'ct' for count-based products (pelleted seeds, plugs).
   */
  productUnit?: ProductUnit;

  /** Cost per product unit in dollars */
  productCost?: number;

  /**
   * Quantity of products to order.
   * Total ordered = productWeight × quantity
   */
  quantity: number;

  /**
   * Amount of seed already in inventory.
   * Combined with order amount to calculate total coverage.
   */
  haveWeight?: number;

  /**
   * Unit for haveWeight.
   */
  haveUnit?: ProductUnit;

  /** Link to supplier product page */
  productLink?: string;

  /** User notes about this order */
  notes?: string;
}

// =============================================================================
// ID FUNCTIONS
// =============================================================================

/**
 * Generate a deterministic SeedOrder ID from variety ID.
 * Format: SO_{varietyId}
 *
 * Since orders are 1:1 with varieties within a plan, the variety ID
 * uniquely identifies the order.
 */
export function getSeedOrderId(varietyId: string): string {
  return `SO_${varietyId}`;
}

/**
 * Extract the variety ID from a SeedOrder ID.
 */
export function getVarietyIdFromOrderId(orderId: string): string {
  if (!orderId.startsWith('SO_')) {
    throw new Error(`Invalid SeedOrder ID format: ${orderId}`);
  }
  return orderId.slice(3);
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Input for creating a new SeedOrder.
 */
export interface CreateSeedOrderInput {
  /** Variety ID (required - used to generate order ID) */
  varietyId: string;
  /** Product weight/count per unit */
  productWeight?: number;
  /** Product unit */
  productUnit?: ProductUnit;
  /** Cost per product */
  productCost?: number;
  /** Quantity to order */
  quantity?: number;
  /** Weight of seed already in inventory */
  haveWeight?: number;
  /** Unit for haveWeight */
  haveUnit?: ProductUnit;
  /** Product link */
  productLink?: string;
  /** Notes */
  notes?: string;
}

/**
 * Factory function for creating SeedOrder objects.
 * ID is deterministic based on varietyId.
 */
export function createSeedOrder(input: CreateSeedOrderInput): SeedOrder {
  return {
    id: getSeedOrderId(input.varietyId),
    varietyId: input.varietyId,
    productWeight: input.productWeight,
    productUnit: input.productUnit,
    productCost: input.productCost,
    quantity: input.quantity ?? 0,
    haveWeight: input.haveWeight,
    haveUnit: input.haveUnit,
    productLink: input.productLink,
    notes: input.notes,
  };
}

/**
 * Deep clone a SeedOrder (preserves ID).
 */
export function cloneSeedOrder(source: SeedOrder): SeedOrder {
  return JSON.parse(JSON.stringify(source));
}

/**
 * Clone multiple SeedOrders into a Record keyed by ID.
 */
export function cloneSeedOrders(
  sources: SeedOrder[] | Record<string, SeedOrder>
): Record<string, SeedOrder> {
  const result: Record<string, SeedOrder> = {};
  const arr = Array.isArray(sources) ? sources : Object.values(sources);
  for (const order of arr) {
    result[order.id] = cloneSeedOrder(order);
  }
  return result;
}

// =============================================================================
// CALCULATION HELPERS
// =============================================================================

/**
 * Calculate total seeds available from an order.
 * Returns undefined if order lacks density info (need variety for that).
 *
 * For orders with 'ct' (count) unit, returns the count directly.
 * For weight-based orders, caller needs variety density to convert.
 *
 * @returns { weight, unit } representing total ordered amount
 */
export function getOrderedAmount(order: SeedOrder): { weight: number; unit: ProductUnit } | undefined {
  if (order.productWeight === undefined || !order.productUnit) {
    return undefined;
  }

  return {
    weight: order.productWeight * order.quantity,
    unit: order.productUnit,
  };
}

/**
 * Get the amount already in inventory.
 * @returns { weight, unit } representing inventory amount, or undefined if not specified
 */
export function getHaveAmount(order: SeedOrder): { weight: number; unit: ProductUnit } | undefined {
  if (order.haveWeight === undefined || !order.haveUnit) {
    return undefined;
  }

  return {
    weight: order.haveWeight,
    unit: order.haveUnit,
  };
}

/**
 * Calculate total cost of an order.
 */
export function getOrderCost(order: SeedOrder): number | undefined {
  if (order.productCost === undefined) {
    return undefined;
  }
  return order.productCost * order.quantity;
}

/**
 * Format order amount for display.
 * E.g., "2 oz" or "10,000 ct"
 */
export function formatOrderAmount(order: SeedOrder): string {
  const amount = getOrderedAmount(order);
  if (!amount) {
    return 'Not specified';
  }

  if (amount.unit === 'ct') {
    return `${amount.weight.toLocaleString()} seeds`;
  }

  // Format weight nicely
  if (amount.unit === 'lb' && amount.weight >= 1) {
    return `${amount.weight.toFixed(2)} lb`;
  }
  if (amount.unit === 'oz') {
    if (amount.weight >= 16) {
      return `${(amount.weight / 16).toFixed(2)} lb`;
    }
    return `${amount.weight.toFixed(2)} oz`;
  }
  if (amount.unit === 'g') {
    if (amount.weight >= 1000) {
      return `${(amount.weight / 1000).toFixed(2)} kg`;
    }
    return `${amount.weight.toFixed(1)} g`;
  }

  return `${amount.weight} ${amount.unit}`;
}

/**
 * Format order cost for display.
 */
export function formatOrderCost(order: SeedOrder): string {
  const cost = getOrderCost(order);
  if (cost === undefined) {
    return 'No price';
  }
  return `$${cost.toFixed(2)}`;
}
