/**
 * Crop Entity
 *
 * Represents a crop type with its display colors.
 * Colors are sourced from Excel cell formatting during import.
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * A crop with configurable colors and GDD settings for timeline display.
 */
export interface Crop {
  /** Unique identifier (deterministic: derived from name) */
  id: string;

  /** Crop name (e.g., "Tomato") */
  name: string;

  /** Background color (hex, e.g., "#ff5050") */
  bgColor: string;

  /** Text color (hex, e.g., "#ffffff") */
  textColor: string;

  /**
   * GDD base temperature (°F).
   * The minimum temperature below which the plant doesn't accumulate heat units.
   * If not set, uses category defaults: 40°F for cool season (Brassica, Lettuce, etc.)
   * and 50°F for warm season (Tomato, Pepper, etc.).
   */
  gddBaseTemp?: number;

  /**
   * GDD upper/ceiling temperature (°F).
   * The maximum temperature above which additional heat doesn't contribute to growth.
   * Temps above this are capped to prevent over-crediting hot days.
   * If not set, uses category defaults: ~85°F for cool season, ~90°F for warm season.
   */
  gddUpperTemp?: number;
}

/**
 * Input for creating a new crop.
 */
export interface CreateCropInput {
  name: string;
  bgColor?: string;
  textColor?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default color for crops without specified colors */
export const DEFAULT_CROP_COLOR = {
  bg: '#78909c',
  text: '#ffffff',
};

// =============================================================================
// KEY GENERATION
// =============================================================================

/**
 * Generate a deterministic crop ID from the name.
 * Used for deduplication and lookups.
 *
 * @param name - Crop name
 * @returns Normalized ID in format "crop_lowercase-name"
 */
export function getCropId(name: string): string {
  return `crop_${name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')}`;
}

// =============================================================================
// CRUD FUNCTIONS
// =============================================================================

/**
 * Create a new crop with a deterministic ID.
 */
export function createCrop(input: CreateCropInput): Crop {
  const id = getCropId(input.name);

  return {
    id,
    name: input.name.trim(),
    bgColor: input.bgColor ?? DEFAULT_CROP_COLOR.bg,
    textColor: input.textColor ?? DEFAULT_CROP_COLOR.text,
  };
}

/**
 * Clone a crop (for plan copying).
 * Crops are immutable so this just returns a shallow copy.
 */
export function cloneCrop(crop: Crop): Crop {
  return { ...crop };
}

/**
 * Clone a crops record (for plan copying).
 */
export function cloneCrops(crops: Record<string, Crop>): Record<string, Crop> {
  const cloned: Record<string, Crop> = {};
  for (const [id, crop] of Object.entries(crops)) {
    cloned[id] = cloneCrop(crop);
  }
  return cloned;
}

// =============================================================================
// LOOKUP HELPERS
// =============================================================================

/**
 * Find a crop by name.
 *
 * @param crops - Crops record to search
 * @param name - Crop name to find
 * @returns Matching crop or undefined
 */
export function findCropByName(
  crops: Record<string, Crop>,
  name: string
): Crop | undefined {
  const id = getCropId(name);
  return crops[id];
}

/**
 * Get crop colors by name, with fallback to default.
 *
 * @param crops - Crops record to search
 * @param name - Crop name to find
 * @returns Colors object with bg and text
 */
export function getCropColors(
  crops: Record<string, Crop> | undefined,
  name: string
): { bg: string; text: string } {
  if (!crops) {
    return DEFAULT_CROP_COLOR;
  }

  const crop = findCropByName(crops, name);
  if (crop) {
    return { bg: crop.bgColor, text: crop.textColor };
  }

  return DEFAULT_CROP_COLOR;
}

/**
 * Get crop colors by ID (preferred for stable linking).
 *
 * @param crops - Crops record to search
 * @param cropId - Crop ID (e.g., "crop_tomato")
 * @returns Colors object with bg and text
 */
export function getCropColorsById(
  crops: Record<string, Crop> | undefined,
  cropId: string | undefined
): { bg: string; text: string } {
  if (!crops || !cropId) {
    return DEFAULT_CROP_COLOR;
  }

  const crop = crops[cropId];
  if (crop) {
    return { bg: crop.bgColor, text: crop.textColor };
  }

  return DEFAULT_CROP_COLOR;
}

/**
 * Get all unique crop names from a crops record.
 */
export function getCropNames(crops: Record<string, Crop>): string[] {
  return Object.values(crops).map((c) => c.name);
}
