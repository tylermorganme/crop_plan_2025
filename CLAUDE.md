# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **crop planning webapp** for a small organic farm (1.5 acres, 92 beds). Built with Next.js, it provides a visual timeline for planning and managing crop plantings.

Reference data was originally sourced from an Excel workbook (`Crop Plan 2025 V20.xlsm`) containing ~340 planting configurations.

## Architecture

### Data Model

```
Planting[] (storage)
    ↓ expandPlantingsToTimelineCrops()
TimelineCrop[] (display)
    ↓
CropTimeline Component
```

Key entities in `src/lib/entities/`:
- **Plan** - Contains plantings[], beds, cropCatalog, metadata
- **Planting** - A single planting decision (configId, fieldStartDate, startBed, bedFeet)
- **CropConfig** - Static crop configuration from catalog (DTM, spacing, season, etc.)
- **TimelineCrop** - Computed display format for timeline rendering

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/plan-store.ts` | Zustand store for plan state management |
| `src/lib/timeline-data.ts` | Expands Planting[] → TimelineCrop[] |
| `src/lib/slim-planting.ts` | Planting creation and computation |
| `src/lib/entities/` | Core type definitions |
| `src/components/CropTimeline.tsx` | Main timeline visualization |
| `src/data/crops.json` | Crop catalog (340 configurations) |

## Development Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Type check
npx tsc --noEmit
```

## Key Concepts

- **Planting**: A single decision to grow a crop (one entry even if spanning multiple beds)
- **TimelineCrop**: Display format - one entry per bed for timeline rendering
- **CropConfig**: Static configuration (DTM, spacing, seasons) from the crop catalog
- **Bed**: A 50-foot growing bed (92 total on the farm)
- **Crop Year**: Plans span crop years, not calendar years - overwintering crops carry forward
