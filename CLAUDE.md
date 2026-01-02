# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a prototype **crop planning system** for a small organic farm (1.5 acres, 92 beds). The project has two main components: 

1. **Excel Workbook** (`Crop Plan 2025 V20.xlsm`) - A comprehensive farm management tool with VBA macros, containing ~340 planting configurations, seed ordering, task scheduling, and revenue projections
2. **Google Sheets Add-on** (`google-sheets-addon/`) - A Gantt-style visual planner that syncs bidirectionally with spreadsheet data



## Architecture

### Google Sheets Add-on

The add-on uses a **data provider abstraction** pattern for development flexibility:

```
Sidebar.html
├── mockProvider (for local browser testing)
└── googleProvider (wraps google.script.run)
```

Key architectural decisions:
- **Polling engine**: Uses client-side JavaScript polling (~100ms in production) via `google.script.run` to bypass the 60 reads/minute external API quota
- **OAuth scope**: Uses `spreadsheets.currentonly` to avoid Google's security assessment requirements for Marketplace publishing
- **Modeless dialog**: Opens as a floating window that can be positioned on a second monitor while editing the sheet

Files:
- `Code.gs` - Server-side Apps Script (column mapping, data CRUD, user preferences)
- `Sidebar.html` - Single-file client with all CSS/JS (timeline rendering, drag-drop, zoom)
- `Settings.html` - Column configuration dialog
- `appsscript.json` - Manifest with OAuth scopes

### Excel Workbook Data Flow

```
Crop Chart (340 planting configurations)
    ↓ filter & copy identifiers
Bed Plan (this year's ~138 plantings)
    ↓ VBA generates shapes
Crop Map (visual Gantt calendar)
    ↓ VBA syncs back
Bed Plan → Reports (seed orders, tasks, schedules)
```

Key sheets: Config, Crop Chart, Bed Plan, Crop Map, Varieties (731 entries), Seed Mixes

## Development Commands

### Google Sheets Add-on

```bash
# Deploy to Apps Script (requires clasp authentication)
cd google-sheets-addon
clasp push

# Login to clasp
clasp login
```

Local development: Open `Sidebar.html` directly in a browser - it detects the non-Google environment and uses mock data.

### Testing the Add-on

1. In Google Sheet: Extensions > Apps Script > Deploy > Test deployments
2. Install on test account
3. Reload sheet, access via Crop Planner menu

## Key Concepts

- **Planting Configuration**: A specific way to grow a crop (e.g., "Tomato (Cherry) - Fresh / Field TP Su" captures crop, product type, structure, method, season)
- **Seed Mixes**: Named compositions (e.g., "Lettuce Mix" = 30% Salanova, 40% Romaine, 30% Butterhead) that Power Query explodes for seed calculations
- **Crop Year**: Plan spans crop years, not calendar years - overwintering crops carry forward
- **Bidirectional Sync**: Drag shapes on Crop Map to assign beds, VBA syncs assignments back to Bed Plan

## Column Configuration

The add-on uses configurable column mapping (stored in DocumentProperties):
- Default columns: Name, Start Date, End Date, Bed, _id
- The _id column is auto-generated, hidden, and protected for stable row identification across edits

## User Preferences

Stored per-user in UserProperties:
- `zoomIndex` - Timeline zoom level (2yr, 1yr, 6mo, 3mo, 1mo)
- `viewMode` - overlap or stacked
- `scrollDate` - Last scroll position
- `collapsedGroups` - Collapsed resource groups
- `unassignedSectionHeight` - Staging area height
