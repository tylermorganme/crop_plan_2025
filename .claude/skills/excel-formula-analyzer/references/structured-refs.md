# Excel Structured Table References

## Overview

When data is formatted as an Excel Table (Insert > Table), formulas can use structured references instead of cell addresses. These are more readable and automatically adjust when rows are added/removed.

## Syntax Patterns

### Basic Column Reference

```
TableName[ColumnName]
```

References the entire column. Example: `=SUM(Sales[Amount])` sums all values in the Amount column.

### Same-Row Reference (Most Common)

```
TableName[[#This Row],[ColumnName]]
```

References a specific column in the current row. This is the pattern used for row-by-row calculations.

Example in row 10:
- `=BedPlan[[#This Row],[DTM]]` references the DTM value in row 10

### Special Item Specifiers

| Specifier | Meaning |
|-----------|---------|
| `[#All]` | Entire table including headers and totals |
| `[#Data]` | Data rows only (no headers/totals) |
| `[#Headers]` | Header row only |
| `[#Totals]` | Totals row only |
| `[#This Row]` | Current row only |

### Multiple Columns

```
TableName[[Column1]:[Column5]]
```

References a range of columns from Column1 to Column5.

### Combining Specifiers

```
TableName[[#Headers],[Column1]:[Column3]]
```

References headers for columns 1-3.

## Parsing with Python Regex

### Pattern for Same-Row References

```python
import re

# Pattern: TableName[[#This Row],[Column Name]]
# Use re.escape(table_name) to handle special characters
pattern = rf"{re.escape(table_name)}\[\[#This Row\],\[([^\]]+)\]\]"

formula = "=BedPlan[[#This Row],[DTM]] + BedPlan[[#This Row],[Harvest Window]]"
matches = re.findall(pattern.replace("table_name", "BedPlan"), formula)
# Result: ['DTM', 'Harvest Window']
```

### Pattern for Full Column References

```python
# Pattern: TableName[Column Name] (not nested brackets)
pattern = rf"{re.escape(table_name)}\[([^\[\]]+)\]"

formula = "=XLOOKUP(A1, BedPlan[Identifier], BedPlan[End of Harvest])"
# Result: ['Identifier', 'End of Harvest']
```

### Complete Parser Function

```python
import re

def parse_structured_refs(formula, table_name):
    """Extract all column references from a formula."""
    if not formula or not str(formula).startswith("="):
        return []

    refs = []

    # Same-row: Table[[#This Row],[Column]]
    same_row_pattern = rf"{re.escape(table_name)}\[\[#This Row\],\[([^\]]+)\]\]"
    refs.extend(re.findall(same_row_pattern, str(formula)))

    # Column: Table[Column]
    col_pattern = rf"{re.escape(table_name)}\[([^\[\]]+)\]"
    refs.extend(re.findall(col_pattern, str(formula)))

    return list(set(refs))
```

## Common Gotchas

### 1. Column Names with Special Characters

Column names containing `]`, `[`, `#`, `'`, or `@` must be escaped:
- `'` becomes `''`
- Other special chars require the column name to be enclosed in brackets

### 2. Space Sensitivity

Spaces in column names are preserved exactly:
- `[My Column]` is different from `[MyColumn]`

### 3. XLOOKUP and MATCH References

When XLOOKUP or MATCH references another row's data, it uses column-only syntax:

```
=XLOOKUP(
    BedPlan[[#This Row],[Follows Crop]],  -- Look for this value
    BedPlan[Identifier],                   -- In this column (all rows)
    BedPlan[Expected End of Harvest]       -- Return from this column
)
```

This creates a cross-row dependency that's important for the DAG.

### 4. Header vs Data References

```
=BedPlan[Column]          -- References data rows only
=BedPlan[[#All],[Column]] -- Includes header and totals
```

### 5. Table Name Escaping

When parsing, always use `re.escape(table_name)` to handle table names that might contain regex special characters.

## Building a Header Map

To resolve column names to column numbers:

```python
def build_header_map(ws, header_row):
    """Build bidirectional header mapping."""
    headers = {}      # name -> column number
    col_to_header = {}  # column number -> name

    for col in range(1, ws.max_column + 1):
        val = ws.cell(row=header_row, column=col).value
        if val:
            headers[val] = col
            col_to_header[col] = val

    return headers, col_to_header
```

## Finding the Table Name

If the table name is unknown, check these locations:
1. **Excel UI**: Click in the table, look at "Table Design" tab for the table name
2. **openpyxl**: Iterate `ws.tables` to find table objects and their names
3. **Formulas**: Look at existing formulas in the sheet for the table name prefix

```python
# List all tables in a worksheet
for table_name, table in ws.tables.items():
    print(f"Table: {table_name}, Range: {table.ref}")
```
