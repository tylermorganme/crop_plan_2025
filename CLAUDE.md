# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **crop planning webapp** for a small organic farm (1.5 acres, 92 beds). Built with Next.js, it provides a visual timeline for planning and managing crop plantings.

Reference data was originally sourced from an Excel workbook (`Crop Plan 2025 V20.xlsm`) containing ~340 planting configurations.

## Prototype

This is a prototype. No data or code is sacred. Don't waste time on doing migrations.

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Run development server (localhost:3000)
npm run build        # Build for production
npm run lint         # Run ESLint
npx tsc --noEmit     # Type check without emitting
```

## Architecture

### Data Flow

```
Planting[] (storage)
    ↓ expandPlantingsToTimelineCrops()
TimelineCrop[] (display)
    ↓
CropTimeline Component
```

**Planting** = one planting decision (stored), even if spanning multiple beds
**TimelineCrop** = one entry per bed (computed at render time for display)

### State Management

- **Zustand store** (`plan-store.ts`) - manages Plan state with immer for immutable updates
- **localStorage persistence** via `storage-adapter.ts`
- Undo/redo via full Plan snapshots

### Key Types

| Type | Purpose |
|------|---------|
| `Plan` | Root entity: plantings[], beds, cropCatalog, metadata |
| `Planting` | Storage format: configId, fieldStartDate, startBed, bedFeet |
| `TimelineCrop` | Display format: one per bed with computed dates |
| `CropConfig` | Static config from catalog (DTM, spacing, seasons) |

## Data Philosophy

**First-class workflows**: Users create their own data or ingest their own data. Import and manual creation are production paths, not dev conveniences.

**Import = shim + ingest**: Raw external data gets transformed into the expected format, then ingested through the same CRUD functions used for manual creation. Never bypass production code for import - this prevents "import-only" bugs.

**No parallel pipelines**: If there's a `createPlanting()` for manual use, import must use it too. Clone functions (`clonePlanting`, `cloneCropConfig`, etc.) compose on top of create functions.

**Current state**: We reimport base data during development. Eventually stock data may ship pre-transformed, but imports still go through production ingestion.

## Data Pipeline

crops.json is generated from Excel via:
1. extract-crops.py → crops_from_excel.json (raw dump)
2. src/data/build-minimal-crops.js → crops.json (normalized)

When adding new fields to CropConfig, update build-minimal-crops.js.

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/plan-store.ts` | Zustand store with all plan mutations |
| `src/lib/timeline-data.ts` | `getTimelineCropsFromPlan()` - expands Planting[] → TimelineCrop[] |
| `src/lib/slim-planting.ts` | `computeTimelineCrop()` - timing calculations |
| `src/lib/entities/` | Entity types and CRUD functions |
| `src/components/CropTimeline.tsx` | Main timeline visualization |
| `src/data/crops.json` | Crop catalog (340 configurations) |

### Entity CRUD Pattern

All entity creation flows through functions in `src/lib/entities/`:

| Entity | Create | Clone |
|--------|--------|-------|
| Planting | `createPlanting()` | `clonePlanting()` |
| Bed | `createBed()` | `cloneBed()`, `cloneBeds()` |
| BedGroup | `createBedGroup()` | `cloneBedGroup()`, `cloneBedGroups()` |
| CropConfig | `createBlankConfig()` | `cloneCropConfig()`, `cloneCropCatalog()` |

**Flow**: Component → CRUD function → Store method → Persistence

Clone functions compose on create (e.g., `clonePlanting` calls `createPlanting` internally).

## Key Concepts

- **Planting**: A single decision to grow a crop (one entry even if spanning multiple beds)
- **TimelineCrop**: Display format - one entry per bed for timeline rendering
- **CropConfig**: Static configuration (DTM, spacing, seasons) from the crop catalog
- **Bed**: A 50-foot growing bed (92 total on the farm)
- **Crop Year**: Plans span crop years, not calendar years - overwintering crops carry forward
