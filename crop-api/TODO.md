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

### Remove duplicate code between crop-calculations.ts and entities/crop-config.ts
jscpd found ~100 duplicate lines. After migration is complete, delete `crop-calculations.ts` and use `entities/crop-config.ts` as the single source.

### Add jscpd to CI
```bash
npx jscpd src/lib --min-lines 10 --threshold 3
```
Fails if duplication exceeds 3%.

## State Migration (Step 2 - DONE)

See `.claude/plans/state-migration.md` for full plan.

- [x] Make `beds` required (build from template on create)
- [x] Make `cropCatalog` required (copy from stock on create)
- [x] Undo/redo stores full `Plan` snapshots (not `TimelineCrop[][]`)
- [x] Add `validatePlan()` call on load/save

### Step 3: Store `Planting[]` instead of `TimelineCrop[]`
- [ ] Implement `collapseToPlantings()` function
- [ ] Update timeline-data.ts to expand Planting[] → TimelineCrop[] for display
- [ ] Migrate existing plans on load
