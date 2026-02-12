/**
 * Entities Module
 *
 * Canonical types for the crop planning system.
 * One entity = one file = one type.
 *
 * Import from here:
 *   import { type Plan, type Planting, validatePlan } from '@/lib/entities';
 */

// Bed entity
export type { Bed, BedGroup, ResourceGroup, BedsFromTemplateResult } from './bed';
export {
  ROW_LENGTHS,
  getBedGroup,
  getBedNumber,
  getBedLength,
  getBedLengthFromId,
  buildBedLengthsFromTemplate,
  generateBedUuid,
  createBed,
  createBedGroup,
  createBedsFromTemplate,
  deriveResources,
  deriveGroups,
  cloneBed,
  cloneBedGroup,
  cloneBeds,
  cloneBedGroups,
} from './bed';

// Planting entity
export type { Planting, PlantingOverrides, PlantingActuals, CreatePlantingInput } from './planting';
export {
  generatePlantingId,
  initializePlantingIdCounter,
  createPlanting,
  clonePlanting,
  getEffectiveSeedSource,
  applyDefaultSeedSource,
} from './planting';

// Planting sequence entity
export type { PlantingSequence, CreateSequenceInput } from './planting-sequence';
export {
  generateSequenceId,
  initializeSequenceIdCounter,
  createSequence,
  cloneSequence,
  computeSequenceDate,
} from './planting-sequence';

// Planting spec entity
export type {
  PlantingSpec,
  TrayStage,
  PlantingMethod,
  CropCalculated,
  ProductYield,
} from './planting-specs';
export {
  calculateDaysInCells,
  calculateSeedToHarvest,
  calculatePlantingMethod,
  calculateHarvestWindow,
  calculateCropFields,
  getTimelineConfig,
  generateConfigId,
  createBlankConfig,
  copyConfig,
  clonePlantingSpec,
  clonePlantingCatalog,
  // Product-aware calculations
  getPrimarySeedToHarvest,
  calculateAggregateHarvestWindow,
  calculateProductSeedToHarvest,
  calculateProductHarvestWindow,
  calculateProductEndDay,
  calculateCropEndDay,
  calculateFieldOccupationDays,
} from './planting-specs';

// Seed search entity (OMRI compliance)
export type { SeedSearchRecord } from './seed-search';
export { getSeedSearchId, createSeedSearch, isSeedSearchComplete } from './seed-search';

// Plan entity
export type {
  PlanMetadata,
  PlanChange,
  Plan,
  PlanFile,
  TimelineCrop,
} from './plan';
export {
  CURRENT_SCHEMA_VERSION,
  PlanValidationError,
  validatePlan,
  isValidPlan,
  getResources,
  getGroups,
  migratePlan,
} from './plan';
