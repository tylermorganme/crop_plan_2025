/**
 * Crop name normalization mapping.
 *
 * Maps variant spellings, typos, and alternative names to canonical crop names.
 * Used by both build-varieties.js and build-seed-mixes.js for consistency.
 */

// Map from variant/typo -> canonical name
const CROP_NAME_ALIASES = {
  // Typos
  'arugala': 'Arugula',
  'bachellor\'s button': 'Bachelor\'s Button',
  'rubeckia': 'Rudbeckia',
  'kholrabi': 'Kohlrabi',

  // Singular/plural variations
  'marigold': 'Marigolds',
  'sunflower': 'Sunflowers',
  'dahlia': 'Dahlias',

  // Ampersand/word variations
  'pansy & viola': 'Pansy And Violas',
  'pansy and viola': 'Pansy And Violas',
  'pansies & violas': 'Pansy And Violas',

  // Subcategory consolidation (when needed)
  // 'squash - winter': 'Squash',
  // 'squash - summer': 'Summer Squash',
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
