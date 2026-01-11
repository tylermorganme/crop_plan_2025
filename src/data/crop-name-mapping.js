/**
 * Crop name normalization mapping.
 *
 * Maps variant spellings, typos, and alternative names to canonical crop names.
 * Used by both build-varieties.js and build-seed-mixes.js for consistency.
 */

// Map from variant/typo -> canonical name
// These should map to exact CropConfig.crop values
const CROP_NAME_ALIASES = {
  // Typos and spelling variations
  'arugala': 'Arugula',
  'bachelor\'s button': 'Bachellor\'s Button',  // Config has the typo
  'rubeckia': 'Rudbeckia',
  'kholrabi': 'Kohlrabi',
  'radish- winter': 'Radish',  // Typo with hyphen

  // Singular/plural variations
  'marigold': 'Marigolds',
  'sunflower': 'Sunflower',
  'sunflowers': 'Sunflower',
  'dahlia': 'Dahlia',
  'dahlias': 'Dahlia',
  'snapdragon': 'Snapdragons',
  'shallot': 'Shallots',
  'fava beans': 'Fava Bean',
  'butterfly flower': 'Butterfly Flowers',
  'pea': 'Peas',
  'peas': 'Peas',

  // Ampersand/word variations
  'pansy & viola': 'Pansy and Violas',
  'pansy and viola': 'Pansy and Violas',
  'pansies & violas': 'Pansy and Violas',
  'pansy and violas': 'Pansy and Violas',  // Case normalization

  // Trailing space in config
  'corn': 'Corn ',

  // Extra words
  'malabar spinach mix': 'Malabar Spinach',

  // Subcategory to base crop consolidation
  'cabbage - chinese': 'Cabbage',
  'pepper - hot': 'Pepper',
  'pepper - sweet': 'Pepper',
  'pepper - shishito': 'Pepper',
  'squash - winter': 'Squash',
  'squash - summer': 'Summer Squash',
  'radish - winter': 'Radish',
};

/**
 * Normalize a crop name using the alias mapping.
 * Applies title case and then checks for known aliases.
 *
 * @param {string} name - Raw crop name from Excel
 * @returns {string} - Canonical crop name
 */
function normalizeCropName(name) {
  if (!name) return '';

  // First apply title case
  const titleCased = name.trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  // Check for alias (case-insensitive)
  const lowerKey = titleCased.toLowerCase();
  if (CROP_NAME_ALIASES[lowerKey]) {
    return CROP_NAME_ALIASES[lowerKey];
  }

  return titleCased;
}

/**
 * Get all known canonical crop names for reference.
 */
function getCanonicalNames() {
  return Object.values(CROP_NAME_ALIASES);
}

module.exports = {
  CROP_NAME_ALIASES,
  normalizeCropName,
  getCanonicalNames,
};
