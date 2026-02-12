/**
 * Seed Search Entity (OMRI Organic Compliance)
 *
 * Records documenting that organic alternatives were searched
 * before using non-organic seed. OMRI requires at least 3 sources.
 * Records are per-variety, per-year and stored on the Plan object.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface SeedSearchRecord {
  /** Composite key: `${varietyId}__${year}` */
  id: string;
  /** Reference to Variety.id */
  varietyId: string;
  /** Crop year (from plan.metadata.year) */
  year: number;
  /** First source searched */
  source1: string;
  /** Second source searched */
  source2: string;
  /** Third source searched */
  source3: string;
  /** Why this non-organic variety is unique/necessary */
  uniqueQualities: string;
  /** Whether the seed is untreated */
  untreated: boolean;
  /** Where proof of untreated status was found */
  untreatedProof: string;
  /** Whether the seed is non-GMO */
  nonGmo: boolean;
  /** Where proof of non-GMO status was found */
  nonGmoProof: string;
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/** Generate composite key for a seed search record */
export function getSeedSearchId(varietyId: string, year: number): string {
  return `${varietyId}__${year}`;
}

/** Create a new SeedSearchRecord (empty stub or populated) */
export function createSeedSearch(input: {
  varietyId: string;
  year: number;
  source1?: string;
  source2?: string;
  source3?: string;
  uniqueQualities?: string;
  untreated?: boolean;
  untreatedProof?: string;
  nonGmo?: boolean;
  nonGmoProof?: string;
}): SeedSearchRecord {
  const id = getSeedSearchId(input.varietyId, input.year);
  return {
    id,
    varietyId: input.varietyId,
    year: input.year,
    source1: input.source1 ?? '',
    source2: input.source2 ?? '',
    source3: input.source3 ?? '',
    uniqueQualities: input.uniqueQualities ?? '',
    untreated: input.untreated ?? false,
    untreatedProof: input.untreatedProof ?? '',
    nonGmo: input.nonGmo ?? false,
    nonGmoProof: input.nonGmoProof ?? '',
  };
}

/** Check if a record is complete (all 3 sources filled) */
export function isSeedSearchComplete(record: SeedSearchRecord): boolean {
  return !!(record.source1.trim() && record.source2.trim() && record.source3.trim());
}
