/**
 * Shared search DSL parsing utilities.
 * Used by CropTimeline, Plantings page, and Overview page.
 *
 * DSL format:
 * - Plain text: matches against searchable fields
 * - -term: negation (excludes matches)
 * - field:value: field-specific filter (e.g., category:root)
 * - -field:value: negated field filter
 * - s:field or sort:field: sort ascending by field
 * - s:field:desc or sort:field:desc: sort descending by field
 */

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
  cropConfigId?: string;
  resource?: string;
  crop?: string;
  notes?: string;
  plantingMethod?: string;
  groupId?: string;
  growingStructure?: string;
}): string {
  return [
    crop.name,
    crop.category,
    crop.cropConfigId,
    crop.resource,
    crop.crop,
    crop.notes,
    crop.plantingMethod,
    crop.groupId,
    crop.growingStructure,
  ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Filter crops by search terms using the standard searchable fields.
 * Supports negation with - prefix.
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
