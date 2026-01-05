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
} from './planting';

// Crop config entity
export type {
  TrayStage,
  PlantingMethod,
  CropConfig,
  CropCalculated,
} from './crop-config';
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
  cloneCropConfig,
  cloneCropCatalog,
} from './crop-config';

// Plan entity
export type {
  PlanMetadata,
  PlanChange,
  Plan,
  PlanFile,
  StashEntry,
  Checkpoint,
  HistoryEntry,
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
