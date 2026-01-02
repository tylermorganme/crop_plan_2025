# TODO

## Code Quality

### Transaction wrapper for undo batching
Currently each mutation (moveCrop, updateCropDates, etc.) creates its own undo entry. When multiple operations should be a single undo (e.g., drag that changes both dates and bed), we get multiple entries.

**Solution:** Create a `withTransaction()` wrapper that batches mutations:
```typescript
await withTransaction(async () => {
  updateCropDates(groupId, start, end);
  moveCrop(groupId, newBed);
}); // Single undo entry
```

### Add jscpd to CI
```bash
npx jscpd src/lib --min-lines 10 --threshold 3
```
Fails if duplication exceeds 3%.

## State Migration (COMPLETE)

See `.claude/plans/state-migration.md` for full plan.

### Step 2 ✅
- [x] Make `beds` required (build from template on create)
- [x] Make `cropCatalog` required (copy from stock on create)
- [x] Undo/redo stores full `Plan` snapshots (not `TimelineCrop[][]`)
- [x] Add `validatePlan()` call on load/save

### Step 3 ✅
- [x] `collapseToPlantings()` in slim-planting.ts
- [x] `expandPlantingsToTimelineCrops()` in timeline-data.ts
- [x] Migrate existing plans on load (loadPlanById)
- [x] All mutations work with plantings[]

### Step 4 ✅
- [x] Delete `lib/types/entities.ts` (and dead code: dtm-conversion.ts, normalize.ts)
- [x] Centralize `getBedLengthFromId` (removed duplicates from timeline-data, CropTimeline)
- [x] Clean up re-exports

### Final cleanup ✅
- [x] Remove `crops` field from Plan type (old plans deleted)
- [x] Delete `crop-calculations.ts` (use `entities/crop-config.ts` as single source)
