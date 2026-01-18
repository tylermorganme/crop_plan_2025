/**
 * Market Entity
 *
 * Represents a sales channel (Direct, Wholesale, U-Pick, etc.).
 * Each market has its own pricing on products via Product.prices[marketId].
 * Supports soft delete via active flag.
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * A sales channel for farm products.
 */
export interface Market {
  /** Unique identifier (UUID) */
  id: string;

  /** Display name (e.g., "Direct", "Wholesale", "U-Pick") */
  name: string;

  /** Order in UI displays */
  displayOrder: number;

  /** Soft delete flag - inactive markets are hidden but preserved */
  active: boolean;
}

/**
 * Market split defines percentage allocation across markets.
 * Keys are market IDs, values are percentages (0-100).
 * Should sum to 100 but not strictly enforced.
 */
export type MarketSplit = Record<string, number>;

/**
 * Input for creating a new market.
 */
export interface CreateMarketInput {
  name: string;
  displayOrder?: number;
  active?: boolean;
}

// =============================================================================
// CRUD FUNCTIONS
// =============================================================================

/**
 * Generate a UUID for markets.
 */
function generateMarketUuid(): string {
  return crypto.randomUUID();
}

/**
 * Create a new market with a generated UUID.
 */
export function createMarket(input: CreateMarketInput): Market {
  return {
    id: generateMarketUuid(),
    name: input.name.trim(),
    displayOrder: input.displayOrder ?? 0,
    active: input.active ?? true,
  };
}

/**
 * Clone a market (for plan copying).
 * Preserves the ID since markets are plan-level entities.
 */
export function cloneMarket(market: Market): Market {
  return { ...market };
}

/**
 * Clone all markets from a plan.
 */
export function cloneMarkets(markets: Record<string, Market>): Record<string, Market> {
  const result: Record<string, Market> = {};
  for (const [id, market] of Object.entries(markets)) {
    result[id] = cloneMarket(market);
  }
  return result;
}

// =============================================================================
// LOOKUP HELPERS
// =============================================================================

/**
 * Get all active markets, sorted by display order.
 */
export function getActiveMarkets(markets: Record<string, Market>): Market[] {
  return Object.values(markets)
    .filter(m => m.active)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Get the first active market (used as default when no market split is specified).
 */
export function getDefaultMarket(markets: Record<string, Market>): Market | undefined {
  return getActiveMarkets(markets)[0];
}

// =============================================================================
// DEFAULT MARKETS
// =============================================================================

/** Well-known market IDs for the default markets */
export const DEFAULT_MARKET_IDS = {
  DIRECT: 'market-direct',
  WHOLESALE: 'market-wholesale',
  UPICK: 'market-upick',
} as const;

/**
 * Create default markets for a new plan.
 * Uses stable IDs so products.json can reference them.
 * Returns a Record keyed by ID.
 */
export function createDefaultMarkets(): Record<string, Market> {
  return {
    [DEFAULT_MARKET_IDS.DIRECT]: {
      id: DEFAULT_MARKET_IDS.DIRECT,
      name: 'Direct',
      displayOrder: 0,
      active: true,
    },
    [DEFAULT_MARKET_IDS.WHOLESALE]: {
      id: DEFAULT_MARKET_IDS.WHOLESALE,
      name: 'Wholesale',
      displayOrder: 1,
      active: true,
    },
    [DEFAULT_MARKET_IDS.UPICK]: {
      id: DEFAULT_MARKET_IDS.UPICK,
      name: 'U-Pick',
      displayOrder: 2,
      active: true,
    },
  };
}
