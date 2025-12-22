/**
 * Plan Data Types
 *
 * Core types for editable crop plans with undo/redo support.
 */

/** A single crop entry on the timeline (may be one of several beds for a planting) */
export interface TimelineCrop {
  id: string;
  name: string;
  startDate: string;  // ISO date
  endDate: string;    // ISO date
  resource: string;   // Bed assignment (empty = unassigned)
  category?: string;
  bgColor?: string;
  textColor?: string;
  /** Total feet needed for this planting */
  feetNeeded?: number;
  structure?: string;
  plantingId?: string;
  /** Total number of beds this crop occupies */
  totalBeds: number;
  /** Which bed number this is (1-indexed) in the sequence */
  bedIndex: number;
  /** The base planting ID for grouping related bed entries */
  groupId: string;
  /** Feet of this bed actually used by the crop */
  feetUsed?: number;
  /** Total feet capacity of this bed */
  bedCapacityFt?: number;
  /** Harvest start date (ISO date) - when harvest window begins */
  harvestStartDate?: string;
  /** Planting method: DS (Direct Seed), TP (Transplant), PE (Perennial) */
  plantingMethod?: 'DS' | 'TP' | 'PE';
}

/** A group of beds (e.g., row "A" contains beds A1-A8) */
export interface ResourceGroup {
  name: string | null;
  beds: string[];
}

/** Info about each bed in a span, including how much is used */
export interface BedSpanInfo {
  bed: string;
  feetUsed: number;
  bedCapacityFt: number;
}

/** Metadata about a saved plan */
export interface PlanMetadata {
  id: string;
  name: string;
  createdAt: number;
  lastModified: number;
  description?: string;
}

/** A single change entry for undo history */
export interface PlanChange {
  id: string;
  timestamp: number;
  type: 'move' | 'date_change' | 'delete' | 'create' | 'batch';
  description: string;
  /** Affected crop group IDs */
  groupIds: string[];
}

/** Complete saveable plan state */
export interface Plan {
  /** Unique plan identifier */
  id: string;
  /** Plan metadata */
  metadata: PlanMetadata;
  /** Current crop state */
  crops: TimelineCrop[];
  /** Available resources (beds) */
  resources: string[];
  /** Resource grouping */
  groups: ResourceGroup[];
  /** Change history (for persistence) */
  changeLog: PlanChange[];
}

/** State for the plan store */
export interface PlanState {
  /** Current plan being edited */
  currentPlan: Plan | null;
  /** Past states for undo */
  past: TimelineCrop[][];
  /** Future states for redo */
  future: TimelineCrop[][];
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Loading/saving state */
  isLoading: boolean;
  /** Last auto-save timestamp */
  lastSaved: number | null;
}

/** Actions available on the plan store */
export interface PlanActions {
  // Plan lifecycle
  loadPlan: (plan: Plan) => void;
  createNewPlan: (name: string, crops: TimelineCrop[], resources: string[], groups: ResourceGroup[]) => void;
  resetPlan: () => void;

  // Crop mutations (all create undo points)
  moveCrop: (groupId: string, newResource: string, bedSpanInfo?: BedSpanInfo[]) => void;
  updateCropDates: (groupId: string, startDate: string, endDate: string) => void;
  deleteCrop: (groupId: string) => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Persistence
  markSaved: () => void;
  markDirty: () => void;
}

export type PlanStore = PlanState & PlanActions;
