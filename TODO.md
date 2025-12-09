# Crop Planning App - TODOs

## Data Model

### Product Sequence Editor
Allow adding multiple ProductSequences to a single PlantingConfig. This enables modeling crops that produce multiple products from one planting:
- Garlic: scapes (early harvest) + bulbs (late harvest)
- Peppers: green peppers (early) + red peppers (late)
- Kale: baby leaves + mature bunches

UI needs:
- List existing sequences on a config
- Add/remove sequences
- Set harvestStartDays, harvestCount, daysBetweenHarvest, yieldPerHarvest per sequence
- Link each sequence to a Product

### Copy-from-Template Workflow
When creating a new PlantingConfig, allow user to:
1. Pick an existing config as a template
2. Clone all settings (spacing, tray sequence, product sequences, etc.)
3. Tweak as needed for the new variety/situation

This avoids re-entering all the same data for similar crops. Common use cases:
- New tomato variety with same growing method as existing one
- Same crop but different spacing for different bed width
- Experimenting with different tray sequences

## UI

### Entity-Based Editing
Update UI to work with the new entity structure (Crop, Product, PlantingConfig, ProductSequence) instead of the flat spreadsheet model.
