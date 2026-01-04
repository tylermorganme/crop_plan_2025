/**
 * Z-index constants for consistent layering across the app.
 *
 * Each layer group has 100 indices of headroom for future additions.
 *
 * Layers (from bottom to top):
 * - 0-99:     Base content
 * - 100-199:  Timeline internal elements (crops, labels, headers)
 * - 200-299:  Sticky UI (app header, sticky rows)
 * - 300-399:  Dropdowns, tooltips, popovers
 * - 400-499:  Modals and slide-out panels
 * - 500+:     Toast notifications (always on top)
 */
export const Z_INDEX = {
  // Base content (0-99)
  BASE: 0,

  // Timeline elements (100-199)
  TIMELINE_CROP: 100,
  TIMELINE_CROP_HOVER: 110,
  TIMELINE_CROP_SELECTED: 120,
  TIMELINE_STICKY_LABEL: 130,
  TIMELINE_RESIZE_HANDLE: 140,
  TIMELINE_UNASSIGNED_LANE: 150,
  TIMELINE_UNASSIGNED_LABEL: 155,
  TIMELINE_HEADER: 160,
  TIMELINE_DRAG_PREVIEW: 180,

  // Sticky UI (200-299)
  APP_HEADER: 200,

  // Dropdowns, tooltips, popovers (300-399)
  DROPDOWN: 300,
  TOOLTIP: 310,
  POPOVER: 320,

  // Floating action bars (350-399)
  FLOATING_ACTION_BAR: 350,
  DETAIL_PANEL: 360,

  // Modals and panels (400-499)
  MODAL_BACKDROP: 400,
  MODAL: 410,
  PANEL: 420,
  MODAL_CONFIRM: 430, // Confirmation dialogs that appear over other modals
  RESIZE_OVERLAY: 450, // Full-screen overlay for resize operations

  // Toast notifications (500+)
  TOAST: 500,
} as const;

export type ZIndexKey = keyof typeof Z_INDEX;
