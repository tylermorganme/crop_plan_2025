/**
 * ColorDef Entity
 *
 * Named color definitions that can be referenced by multiple crops.
 * Allows changing all crops of a category (e.g., "Cucurbits") at once.
 */

export interface ColorDef {
  /** Unique ID (e.g., "color_cucurbit") */
  id: string;

  /** Display name (e.g., "Cucurbit") */
  name: string;

  /** Background color (hex) */
  bgColor: string;

  /** Text color (hex) */
  textColor: string;
}

/**
 * Generate a deterministic ID for a color definition from its name.
 */
export function getColorDefId(name: string): string {
  return `color_${name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')}`;
}

/**
 * Default color for new color definitions.
 */
export const DEFAULT_COLOR_DEF: Pick<ColorDef, 'bgColor' | 'textColor'> = {
  bgColor: '#78909c',
  textColor: '#ffffff',
};

/**
 * Create a new color definition.
 */
export function createColorDef(
  name: string,
  bgColor: string = DEFAULT_COLOR_DEF.bgColor,
  textColor: string = DEFAULT_COLOR_DEF.textColor
): ColorDef {
  return {
    id: getColorDefId(name),
    name,
    bgColor,
    textColor,
  };
}

/**
 * Clone a color definition with a new ID.
 */
export function cloneColorDef(colorDef: ColorDef, newName?: string): ColorDef {
  const name = newName || `${colorDef.name} (copy)`;
  return {
    ...colorDef,
    id: getColorDefId(name),
    name,
  };
}
