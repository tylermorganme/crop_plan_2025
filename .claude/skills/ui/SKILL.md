---
name: ui
description: Guidance for building UI that matches existing patterns. Use before creating any new pages, forms, or components. Lists reference files for common patterns.
---

# UI Patterns Guide

**This codebase has established UI patterns. Do not invent new ones.**

Before writing ANY new UI, find an existing example and copy its structure exactly.

## Reference Files by Pattern Type

### List/Management Pages (toolbar + scrollable list)
**Reference:** `src/app/varieties/page.tsx`

Also see: `products/page.tsx`, `seed-mixes/page.tsx`, `markets/page.tsx`

These all share:
- Toolbar with title, count, search, filters, actions
- Scrollable content area
- List with selection

### Plan-Scoped Pages
**Reference:** `src/app/beds/[planId]/page.tsx`

Pages that operate on a specific plan use `[planId]` dynamic routes.

### Timeline/Visualization
**Reference:** `src/app/timeline/[planId]/page.tsx`

Complex visualization with drag-drop, selection, zoom.

### Inspectors/Detail Panels
**Reference:** `src/components/PlantingInspectorPanel.tsx`

Sliding panels for editing entity details.

## How to Find Patterns

Before implementing, search for existing examples:

```bash
# Find toolbar patterns
grep -r "bg-white border-b px-4" src/app/

# Find page layout patterns
grep -r "flex flex-col overflow-hidden" src/app/

# Find input styling
grep -r 'className="px-2 py-1 border rounded' src/app/

# Find similar components
grep -r "similar keyword" src/components/
```

## Rules

1. **Search first** - grep for similar UI before writing anything
2. **Copy exactly** - use same class names, same structure
3. **One reference** - pick ONE file as your template, follow it precisely
4. **Ask if unsure** - if no clear pattern exists, ask which file to reference
