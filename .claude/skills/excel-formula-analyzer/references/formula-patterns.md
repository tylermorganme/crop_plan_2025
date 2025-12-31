# Common Excel Formula Patterns and Code Equivalents

## Overview

This reference documents common Excel formula patterns and their equivalent implementations in TypeScript/Python.

## COALESCE Pattern

Excel doesn't have a native COALESCE, so it's implemented with IF/ISBLANK:

### Excel
```
=IF(ISBLANK(ActualValue), PlannedValue, ActualValue)
```

Or using IF with empty string check:
```
=IF(ActualValue="", PlannedValue, ActualValue)
```

### TypeScript
```typescript
// Using nullish coalescing (preferred)
const value = actualValue ?? plannedValue;

// Or explicit null check
const value = actualValue !== null && actualValue !== undefined
  ? actualValue
  : plannedValue;
```

### Python
```python
# Using or (careful: treats 0 and "" as falsy)
value = actual_value or planned_value

# Using explicit None check (preferred)
value = actual_value if actual_value is not None else planned_value
```

## Date Arithmetic

### Excel
```
=StartDate + 30                    -- Add 30 days
=EndDate - StartDate               -- Days between
=DATE(YEAR(A1), MONTH(A1)+1, 1)    -- First of next month
```

### TypeScript
```typescript
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function daysBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / msPerDay);
}
```

### Python
```python
from datetime import timedelta

def add_days(date, days):
    return date + timedelta(days=days)

def days_between(start, end):
    return (end - start).days
```

## XLOOKUP / VLOOKUP

### Excel
```
=XLOOKUP(SearchValue, LookupArray, ReturnArray, IfNotFound)
=VLOOKUP(SearchValue, TableRange, ColIndex, FALSE)
```

### TypeScript
```typescript
function xlookup<T, R>(
  searchValue: T,
  lookupArray: T[],
  returnArray: R[],
  ifNotFound: R | null = null
): R | null {
  const index = lookupArray.indexOf(searchValue);
  return index >= 0 ? returnArray[index] : ifNotFound;
}

// With Map for better performance
const lookupMap = new Map(
  data.map(row => [row.identifier, row])
);
const result = lookupMap.get(searchValue);
```

### Python
```python
def xlookup(search_value, lookup_list, return_list, if_not_found=None):
    try:
        index = lookup_list.index(search_value)
        return return_list[index]
    except ValueError:
        return if_not_found

# With dict for better performance
lookup_dict = {row['identifier']: row for row in data}
result = lookup_dict.get(search_value)
```

## Conditional Calculations

### Excel
```
=IF(Condition, TrueValue, FalseValue)
=IF(A1>0, A1*2, 0)
=IF(AND(A1>0, B1>0), A1+B1, 0)
=IF(OR(A1="Yes", B1="Yes"), "Pass", "Fail")
```

### TypeScript
```typescript
// Simple ternary
const value = condition ? trueValue : falseValue;

// Complex conditions
const value = a > 0 && b > 0 ? a + b : 0;
const result = a === "Yes" || b === "Yes" ? "Pass" : "Fail";
```

### Python
```python
# Ternary
value = true_value if condition else false_value

# Complex
value = a + b if a > 0 and b > 0 else 0
result = "Pass" if a == "Yes" or b == "Yes" else "Fail"
```

## Nested IFs (CHOOSE alternative)

### Excel
```
=IF(Type="A", ValueA, IF(Type="B", ValueB, IF(Type="C", ValueC, Default)))
```

### TypeScript
```typescript
// Object lookup (cleaner)
const values: Record<string, number> = {
  A: valueA,
  B: valueB,
  C: valueC
};
const result = values[type] ?? defaultValue;

// Or switch
switch (type) {
  case "A": return valueA;
  case "B": return valueB;
  case "C": return valueC;
  default: return defaultValue;
}
```

### Python
```python
# Dict lookup
values = {"A": value_a, "B": value_b, "C": value_c}
result = values.get(type, default_value)

# Or match (Python 3.10+)
match type:
    case "A": result = value_a
    case "B": result = value_b
    case "C": result = value_c
    case _: result = default_value
```

## Blank/Empty Handling

### Excel
```
=IF(ISBLANK(A1), Default, A1)
=IF(A1="", Default, A1)
=IFERROR(A1/B1, 0)
```

### TypeScript
```typescript
// Nullish coalescing for null/undefined
const value = input ?? defaultValue;

// For empty strings too
const value = input || defaultValue;

// Error handling
let result: number;
try {
  result = a / b;
} catch {
  result = 0;
}
// Or: const result = b !== 0 ? a / b : 0;
```

### Python
```python
# None check
value = input if input is not None else default_value

# Falsy check (includes empty string, 0)
value = input or default_value

# Error handling
try:
    result = a / b
except ZeroDivisionError:
    result = 0
```

## Array/Range Functions

### Excel
```
=SUM(A1:A10)
=AVERAGE(A1:A10)
=MAX(A1:A10)
=MIN(A1:A10)
=COUNT(A1:A10)
=COUNTIF(A1:A10, ">5")
```

### TypeScript
```typescript
const sum = arr.reduce((a, b) => a + b, 0);
const avg = sum / arr.length;
const max = Math.max(...arr);
const min = Math.min(...arr);
const count = arr.filter(x => x != null).length;
const countIf = arr.filter(x => x > 5).length;
```

### Python
```python
total = sum(arr)
avg = sum(arr) / len(arr)
maximum = max(arr)
minimum = min(arr)
count = len([x for x in arr if x is not None])
count_if = len([x for x in arr if x > 5])
```

## Dependency Levels

When translating Excel formulas to code, organize by dependency level:

```
Level 0 (Inputs):     Raw data, no dependencies
Level 1:              Formulas depending only on inputs
Level 2:              Formulas depending on Level 1
...
Level N (Outputs):    Final calculated values
```

Example calculation chain:

```typescript
// Level 0: Inputs
const fixedFieldStartDate = data.fixedFieldStartDate;
const daysInCells = data.daysInCells;
const dtm = data.dtm;
const harvestWindow = data.harvestWindow;

// Level 1: First calculations
const plannedGhStart = subtractDays(fixedFieldStartDate, daysInCells);

// Level 2: Resolved dates
const ghStartDate = data.actualGhDate ?? plannedGhStart;

// Level 3: Harvest calculations
const expectedBeginHarvest = addDays(ghStartDate, dtm);

// Level 4: Final output
const expectedEndHarvest = addDays(expectedBeginHarvest, harvestWindow);
```
