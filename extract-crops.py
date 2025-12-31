#!/usr/bin/env python3
"""
Extract crop data from the Crop Chart sheet in the Excel workbook.
Creates a JSON file matching the format of crops.json.old for comparison.
"""

import openpyxl
import json
import hashlib
from datetime import datetime, date

# Custom JSON encoder for datetime objects
class DateTimeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        return super().default(obj)

def fmt_value(val):
    """Format a cell value for JSON output"""
    if val is None:
        return None
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    return val

def generate_id(identifier):
    """Generate a stable ID from the identifier string"""
    h = hashlib.md5(identifier.encode()).hexdigest()[:8]
    return f"crop_{h}"

# Load the workbook
print("Loading workbook...")
wb = openpyxl.load_workbook("Crop Plan 2025 V20.xlsm", data_only=True)

# Read the Crop Chart sheet
ws = wb["Crop Chart"]

# Get headers from row 2
headers = []
for col in range(1, ws.max_column + 1):
    header = ws.cell(row=2, column=col).value
    headers.append(header)

print(f"Found {len(headers)} columns")

# Extract crop data starting from row 3
crops = []
for row in range(3, ws.max_row + 1):
    identifier = ws.cell(row=row, column=1).value  # Column A = Identifier
    if not identifier:
        continue

    crop = {"id": generate_id(identifier)}

    for col, header in enumerate(headers, start=1):
        if header:
            value = ws.cell(row=row, column=col).value
            crop[header] = fmt_value(value)

    crops.append(crop)

print(f"Extracted {len(crops)} crops")

# Save to JSON
output_path = "crop-api/src/data/crops_from_excel.json"
with open(output_path, "w") as f:
    json.dump({"crops": crops}, f, indent=2, cls=DateTimeEncoder)

print(f"Saved to {output_path}")

# Show sample
print("\nSample crop:")
print(json.dumps(crops[0], indent=2)[:500])
