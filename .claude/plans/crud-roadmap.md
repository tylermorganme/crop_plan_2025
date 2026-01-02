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
  - [ ] Edit planting details modal (configId, bedFeet, overrides, notes)
- [x] Delete - `deleteCrop` (timeline context menu)

### Planting Enhancements
- [x] Add planting from timeline (+ button in row header)
- [ ] Duplicate planting (for successions)
- [ ] Bulk edit selected plantings

## Bed
- [x] Read - Timeline rows
- [ ] Create - Add new bed
- [ ] Update - Rename bed, change length, change group
- [ ] Delete - Remove bed

## Future Considerations
- [ ] Checkpoint/version management UI
- [ ] Import/export individual configs or plantings
- [ ] Undo history browser
