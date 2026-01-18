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

// =============================================================================
// MARKET SPLIT HELPERS
// =============================================================================

/**
 * Default market split - 100% Direct.
 * Used when no split is specified.
 */
export const DEFAULT_MARKET_SPLIT: MarketSplit = {
  [DEFAULT_MARKET_IDS.DIRECT]: 100,
};

/**
 * Calculate the total of all percentages in a market split.
 */
export function getMarketSplitTotal(split: MarketSplit): number {
  return Object.values(split).reduce((sum, pct) => sum + (pct || 0), 0);
}

/**
 * Check if a market split totals exactly 100%.
 */
export function isMarketSplitValid(split: MarketSplit): boolean {
  return Math.abs(getMarketSplitTotal(split) - 100) < 0.01;
}

/**
 * Normalize a market split to always sum to 100%.
 * Treats values as ratios - e.g., 50:30:140 becomes ~23:14:64.
 *
 * @param split - The market split to normalize
 * @returns A new MarketSplit that sums to exactly 100
 */
export function normalizeMarketSplit(split: MarketSplit): MarketSplit {
  const total = getMarketSplitTotal(split);
  if (total === 0) {
    // Avoid division by zero - return default split
    return { ...DEFAULT_MARKET_SPLIT };
  }

  const normalized: MarketSplit = {};
  for (const [marketId, pct] of Object.entries(split)) {
    // Round to 2 decimal places to avoid floating point weirdness
    normalized[marketId] = Math.round((pct / total) * 100 * 100) / 100;
  }
  return normalized;
}

/**
 * Get the allocation for a specific market from a split.
 * Returns a decimal (0-1) suitable for multiplication.
 *
 * If the split doesn't sum to 100%, values are treated as ratios.
 *
 * @param split - The market split
 * @param marketId - The market to get allocation for
 * @returns Decimal allocation (0-1)
 */
export function getMarketAllocation(split: MarketSplit, marketId: string): number {
  const total = getMarketSplitTotal(split);
  if (total === 0) return 0;

  const pct = split[marketId] ?? 0;
  return pct / total;
}

/**
 * Format a market split for display.
 * Shows warning icon if not exactly 100%.
 *
 * @param split - The market split
 * @param markets - Available markets (for names)
 * @returns Formatted string like "Direct: 60%, Wholesale: 40%"
 */
export function formatMarketSplit(
  split: MarketSplit,
  markets: Record<string, Market>
): string {
  const parts: string[] = [];
  for (const [marketId, pct] of Object.entries(split)) {
    if (pct > 0) {
      const name = markets[marketId]?.name ?? marketId;
      parts.push(`${name}: ${pct}%`);
    }
  }
  return parts.join(', ') || 'None';
}

/**
 * Get validation status for a market split.
 * Returns null if valid, or a warning message.
 */
export function validateMarketSplit(split: MarketSplit): string | null {
  const total = getMarketSplitTotal(split);
  if (total === 0) {
    return 'No market allocation specified';
  }
  if (Math.abs(total - 100) >= 0.01) {
    return `Total is ${total}%, not 100% (will be treated as ratio)`;
  }
  return null;
}
