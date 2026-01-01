---
name: ast-query
description: Query TypeScript codebase structure. Use when asking "what does X contain?", "where is X defined?", "what calls X?", or exploring type/interface/function definitions. Answers structural questions by parsing actual code.
---

# AST Query

Query TypeScript code structure without reading files manually.

## Usage

```bash
# What fields does an interface have?
node crop-api/scripts/ast-query.js "Plan"

# Find a function signature
node crop-api/scripts/ast-query.js "validatePlan"

# Find all matching definitions
node crop-api/scripts/ast-query.js "Bed"

# Find what calls a function
node crop-api/scripts/ast-query.js "validatePlan" --callers
```

## Output

Compact, greppable format:
```
interface: Plan (src/lib/entities/plan.ts:45)
  id: string
  schemaVersion: number
  metadata: PlanMetadata
  beds: Record<string, Bed>
  cropCatalog: Record<string, CropConfig>
  plantings: Planting[]
```

## When to Use

- Understanding type structure before modifying code
- Finding where something is defined
- Checking function signatures
- Discovering related types (query "Bed" finds Bed, BedSpanInfo, getBedLength, etc.)
