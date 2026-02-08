/**
 * Shared search DSL parsing utilities.
 * Used by CropTimeline, Plantings page, SpecExplorer, and Overview page.
 *
 * DSL format:
 * - Plain text: matches against searchable fields
 * - -term: negation (excludes matches)
 * - field:value: field-specific filter (e.g., category:root)
 * - -field:value: negated field filter
 * - s:field or sort:field: sort ascending by field
 * - s:field:desc or sort:field:desc: sort descending by field
 */

// =============================================================================
// Generic Filter Types
// =============================================================================

/** How to match a field value against the search term */
export type FieldMatchType = 'includes' | 'equals' | 'array-includes' | 'custom';

/**
 * Definition of a single filter field.
 * Used to define how field:value searches work for a specific entity type.
 */
export interface FilterFieldDef<T> {
  /** The field name users type (e.g., "bed", "category", "deprecated") */
  name: string;

  /** Alternative names for this field (e.g., ["group", "bedGroup"] for bed group) */
  aliases?: string[];

  /** How to match: includes (default), equals, array-includes, or custom */
  matchType?: FieldMatchType;

  /**
   * Extract the value from the entity to match against.
   * Returns string, boolean, or string[] depending on matchType.
   */
  getValue: (entity: T) => string | boolean | string[] | undefined;

  /**
   * Optional value aliases that expand the search term.
   * E.g., { "tp": "transplant", "ds": "direct seed" }
   */
  valueAliases?: Record<string, string>;

  /**
   * Custom matcher for complex logic (when matchType is 'custom').
   * Return true if entity matches the given value.
   */
  customMatch?: (entity: T, value: string) => boolean;
}

/**
 * Complete search configuration for an entity type.
 * Defines both the filterable fields and how to build search text.
 */
export interface SearchConfig<T> {
  /** Filter field definitions */
  fields: FilterFieldDef<T>[];

  /** Build full-text search string for plain text matching */
  buildSearchText: (entity: T) => string;
}

// =============================================================================
// Query Parsing
// =============================================================================

export interface ParsedSearchQuery<TSortField extends string = string> {
  /** Sort field from s:field directive, or null if no sort specified */
  sortField: TSortField | null;
  /** Sort direction, defaults to 'asc' */
  sortDir: 'asc' | 'desc';
  /** Filter terms (excluding sort directives) */
  filterTerms: string[];
}

/**
 * Parse a search query string, extracting sort directives and filter terms.
 * Matches the DSL used in CropTimeline.
 *
 * @param searchQuery - The raw search query string
 * @param validSortFields - Optional set of valid sort field names for validation
 * @returns Parsed query with sortField, sortDir, and filterTerms
 */
export function parseSearchQuery<TSortField extends string = string>(
  searchQuery: string,
  validSortFields?: Set<TSortField>
): ParsedSearchQuery<TSortField> {
  let sortField: TSortField | null = null;
  let sortDir: 'asc' | 'desc' = 'asc';
  const filterTerms: string[] = [];

  if (!searchQuery.trim()) {
    return { sortField, sortDir, filterTerms };
  }

  const allTerms = searchQuery.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);
  const sortPattern = /^(?:sort|s):(\w+)(?::(asc|desc))?$/i;

  for (const term of allTerms) {
    const sortMatch = term.match(sortPattern);
    if (sortMatch) {
      const field = sortMatch[1].toLowerCase() as TSortField;
      const dir = (sortMatch[2]?.toLowerCase() as 'asc' | 'desc') || 'asc';
      // Only accept if no validation set provided, or field is in the set
      if (!validSortFields || validSortFields.has(field)) {
        sortField = field;
        sortDir = dir;
      }
    } else {
      filterTerms.push(term);
    }
  }

  return { sortField, sortDir, filterTerms };
}

/**
 * Build searchable text from a TimelineCrop (or any object with these fields).
 * This is the canonical definition of what fields are searchable.
 * All views should use this for consistency.
 */
export function buildCropSearchText(crop: {
  name?: string;
  category?: string;
  specId?: string;
  resource?: string;
  crop?: string;
  notes?: string;
  tags?: string[];
  specTags?: string[];
  plantingMethod?: string;
  groupId?: string;
  growingStructure?: string;
  irrigation?: string;
  rowCover?: string;
}): string {
  return [
    crop.name,
    crop.category,
    crop.specId,
    crop.resource,
    crop.crop,
    crop.notes,
    crop.plantingMethod,
    crop.groupId,
    crop.growingStructure,
    crop.irrigation,
    crop.rowCover,
    ...(crop.tags ?? []),
    ...(crop.specTags ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
}

// =============================================================================
// Generic Filter Matching
// =============================================================================

/**
 * Build a lookup map from field names/aliases to field definitions.
 */
function buildFieldMap<T>(fields: FilterFieldDef<T>[]): Map<string, FilterFieldDef<T>> {
  const map = new Map<string, FilterFieldDef<T>>();
  for (const field of fields) {
    map.set(field.name.toLowerCase(), field);
    if (field.aliases) {
      for (const alias of field.aliases) {
        map.set(alias.toLowerCase(), field);
      }
    }
  }
  return map;
}

/**
 * Match a single field against a search value.
 */
function matchField<T>(
  entity: T,
  value: string,
  fieldDef: FilterFieldDef<T>
): boolean {
  // Resolve value aliases if defined
  const resolvedValue = fieldDef.valueAliases?.[value]?.toLowerCase() ?? value;

  const matchType = fieldDef.matchType ?? 'includes';

  switch (matchType) {
    case 'includes': {
      const fieldValue = fieldDef.getValue(entity);
      if (typeof fieldValue !== 'string') return false;
      return fieldValue.toLowerCase().includes(resolvedValue);
    }

    case 'equals': {
      const fieldValue = fieldDef.getValue(entity);
      // For booleans: deprecated:true, favorite:false
      if (typeof fieldValue === 'boolean') {
        return resolvedValue === 'true' ? fieldValue : !fieldValue;
      }
      return String(fieldValue).toLowerCase() === resolvedValue;
    }

    case 'array-includes': {
      const fieldValue = fieldDef.getValue(entity);
      if (!Array.isArray(fieldValue)) return false;
      return fieldValue.some(item =>
        item.toLowerCase().includes(resolvedValue)
      );
    }

    case 'custom': {
      if (!fieldDef.customMatch) return false;
      return fieldDef.customMatch(entity, resolvedValue);
    }
  }
}

/**
 * Generic field-based filter matcher.
 * Replaces duplicated switch statements across views.
 *
 * Supports:
 * - Plain text matching against buildSearchText result
 * - Negation with - prefix
 * - Field:value matching with configurable match types
 * - Field and value aliases
 *
 * @param entity - The entity to match
 * @param filterTerms - Parsed filter terms from parseSearchQuery
 * @param config - Search configuration for the entity type
 */
export function matchesFilter<T>(
  entity: T,
  filterTerms: string[],
  config: SearchConfig<T>
): boolean {
  if (filterTerms.length === 0) return true;

  const searchText = config.buildSearchText(entity);
  const fieldMap = buildFieldMap(config.fields);

  return filterTerms.every(term => {
    const isNegated = term.startsWith('-');
    const actualTerm = isNegated ? term.slice(1) : term;

    // Check for field:value pattern
    const colonIdx = actualTerm.indexOf(':');
    if (colonIdx > 0) {
      const fieldName = actualTerm.slice(0, colonIdx).toLowerCase();
      const value = actualTerm.slice(colonIdx + 1).toLowerCase();

      const fieldDef = fieldMap.get(fieldName);
      if (fieldDef) {
        const matches = matchField(entity, value, fieldDef);
        return isNegated ? !matches : matches;
      }
      // Unknown field - fall through to plain text search
    }

    // Plain text search
    const matches = searchText.includes(actualTerm);
    return isNegated ? !matches : matches;
  });
}

// =============================================================================
// Legacy Functions (deprecated)
// =============================================================================

/**
 * Filter crops by search terms using the standard searchable fields.
 * Supports negation with - prefix.
 *
 * @deprecated Use `matchesFilter()` with a SearchConfig instead for field:value support.
 */
export function matchesCropFilter(
  crop: Parameters<typeof buildCropSearchText>[0],
  filterTerms: string[]
): boolean {
  if (filterTerms.length === 0) return true;

  const searchText = buildCropSearchText(crop);

  return filterTerms.every(term => {
    if (term.startsWith('-') && term.length > 1) {
      return !searchText.includes(term.slice(1));
    }
    return searchText.includes(term);
  });
}
