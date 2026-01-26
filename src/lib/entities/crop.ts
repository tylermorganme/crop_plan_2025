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
 * A crop with configurable colors for timeline display.
 */
export interface Crop {
  /** Unique identifier (deterministic: derived from name) */
  id: string;

  /** Crop name (e.g., "Tomato") */
  name: string;

  /** Background color (hex, e.g., "#ff5050"). Used if colorDefId is not set. */
  bgColor: string;

  /** Text color (hex, e.g., "#ffffff"). Used if colorDefId is not set. */
  textColor: string;

  /** Optional reference to a named color definition. Takes precedence over bgColor/textColor. */
  colorDefId?: string;
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
 * Resolves colorDefId reference if present.
 *
 * @param crops - Crops record to search
 * @param name - Crop name to find
 * @param colorDefs - Optional color definitions for resolving colorDefId references
 * @returns Colors object with bg and text
 */
export function getCropColors(
  crops: Record<string, Crop> | undefined,
  name: string,
  colorDefs?: Record<string, import('./color-def').ColorDef>
): { bg: string; text: string } {
  if (!crops) {
    return DEFAULT_CROP_COLOR;
  }

  const crop = findCropByName(crops, name);
  if (crop) {
    // If crop references a color definition, use that
    if (crop.colorDefId && colorDefs) {
      const colorDef = colorDefs[crop.colorDefId];
      if (colorDef) {
        return { bg: colorDef.bgColor, text: colorDef.textColor };
      }
    }
    // Otherwise use crop's direct colors
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
