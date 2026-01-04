# CRUD Roadmap

Feature checklist for full CRUD support across all entities.

## Plan
- [x] Create - `createNewPlan`
- [x] Read - `loadPlanById`, plan list
- [x] Update - `renamePlan`
- [x] Delete - `deletePlanFromLibrary`

## CropConfig
- [x] Create - `addCropConfig` + `CropConfigCreator` UI
- [x] Read - Explorer table
- [x] Update - `updateCropConfig` + `CropConfigEditor` UI
- [x] Delete - `deleteCropConfigs` + Explorer multi-select delete

## Planting
- [x] Create - `addPlanting` (from Explorer "Add to Plan")
- [x] Read - Timeline display
- [x] Update (partial):
  - [x] Move to bed (drag in timeline)
  - [x] Change dates (drag horizontally)
  - [x] Edit planting details (bedFeet, overrides, notes in inspector)
- [x] Delete - `deleteCrop` (timeline context menu)

### Planting Enhancements
- [x] Add planting from timeline (+ button in row header)
- [x] Duplicate planting (inspector button)
- [ ] Bulk edit selected plantings

## Bed
- [x] Read - Timeline rows, Beds management page
- [x] Create - Add bed to group (inline form)
- [x] Update - Rename bed, drag to reorder, move between groups
- [x] Delete - Remove bed (with planting handling)

## BedGroup
- [x] Read - Beds management page
- [x] Create - Add new group
- [x] Update - Rename group, drag to reorder
- [x] Delete - Remove empty group

## Future Considerations
- [ ] Checkpoint/version management UI
- [ ] Import/export individual configs or plantings
- [ ] Undo history browser

## Analytics & Warnings
- [ ] Conflict/overlap warnings ("you'll have X lb of Y in week Z")
- [ ] Bed capacity visualization (over-allocation/gaps)
- [ ] Actual date tracking (plan vs reality variance)
