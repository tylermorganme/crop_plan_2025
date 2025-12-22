"""
Use xlwings to trace formula precedents using Excel's native COM interface.
This approach uses Excel directly, so it can handle all formula types including
structured table references.
"""

import xlwings as xw
from collections import defaultdict
import json

print("Opening Excel workbook with xlwings...")
print("This uses Excel's COM interface for native precedent tracing.\n")

# Open Excel and the workbook
app = xw.App(visible=False)  # Run Excel in background
try:
    wb = app.books.open("Crop Plan 2025 V20.xlsm")
    ws = wb.sheets["Bed Plan"]

    print(f"Opened workbook: {wb.name}")
    print(f"Working with sheet: {ws.name}")

    # Get headers for reference
    headers = {}
    for col in range(1, 160):
        val = ws.range((5, col)).value
        if val:
            headers[col] = val

    print(f"\nFound {len(headers)} headers")

    # Function to trace precedents for a cell
    def trace_precedents(cell_addr, depth=0, max_depth=10, visited=None):
        """
        Recursively trace all precedents of a cell.
        Returns a dict with the cell and its dependencies.
        """
        if visited is None:
            visited = set()

        if depth > max_depth or cell_addr in visited:
            return None

        visited.add(cell_addr)

        cell = ws.range(cell_addr)
        formula = cell.formula

        result = {
            "address": cell_addr,
            "formula": formula if formula and str(formula).startswith("=") else None,
            "value": cell.value,
            "precedents": []
        }

        # Use Excel's native Precedents property
        try:
            # DirectPrecedents gets only immediate precedents
            precedents = cell.api.DirectPrecedents
            if precedents:
                for area in precedents.Areas:
                    for prec_cell in area.Cells:
                        prec_addr = prec_cell.Address.replace("$", "")
                        if prec_addr not in visited:
                            prec_result = trace_precedents(prec_addr, depth + 1, max_depth, visited)
                            if prec_result:
                                result["precedents"].append(prec_result)
        except Exception as e:
            # DirectPrecedents can fail for cells without precedents
            pass

        return result

    # Key columns to trace (End of Harvest is AJ, which is column 36)
    # Col 36 = AJ (End of Harvest)
    # Col 31 = AE (Expected End of Harvest)
    # Col 30 = AD (Beginning of Harvest)
    # Col 28 = AB (Expected Beginning of Harvest)
    # Col 26 = Z (TP or DS Date)
    # Col 16 = P (Start Date)

    target_cells = {
        "AJ6": "End of Harvest",
        "AE6": "Expected End of Harvest",
        "AD6": "Beginning of Harvest",
        "AB6": "Expected Beginning of Harvest",
        "Z6": "TP or DS Date",
        "P6": "Start Date",
    }

    print("\n" + "="*80)
    print("TRACING FORMULA DEPENDENCIES (Row 6)")
    print("="*80)

    all_deps = {}

    for cell_addr, name in target_cells.items():
        print(f"\n--- {name} ({cell_addr}) ---")
        cell = ws.range(cell_addr)
        formula = cell.formula
        print(f"Formula: {formula}")

        # Trace precedents
        deps = trace_precedents(cell_addr, max_depth=15)
        all_deps[cell_addr] = deps

    # Now print the dependency tree nicely
    def print_tree(node, indent=0):
        if node is None:
            return

        addr = node["address"]
        formula = node.get("formula", "")

        # Get column number and header
        col_match = addr.rstrip("0123456789")
        col_num = 0
        for i, c in enumerate(col_match):
            col_num = col_num * 26 + (ord(c.upper()) - ord('A') + 1)
        header = headers.get(col_num, "")

        prefix = "  " * indent + ("|- " if indent > 0 else "")

        if formula:
            # Truncate long formulas
            formula_short = formula[:60] + "..." if len(str(formula)) > 60 else formula
            print(f"{prefix}[{addr}] {header}: {formula_short}")
        else:
            val = node.get("value", "")
            val_str = str(val)[:30] if val else "(empty)"
            print(f"{prefix}[{addr}] {header}: VALUE = {val_str}")

        for prec in node.get("precedents", []):
            print_tree(prec, indent + 1)

    print("\n" + "="*80)
    print("DEPENDENCY TREES")
    print("="*80)

    for cell_addr, name in target_cells.items():
        print(f"\n\n{'='*60}")
        print(f"TREE FOR: {name} ({cell_addr})")
        print("="*60)
        if cell_addr in all_deps:
            print_tree(all_deps[cell_addr])

    # Save to JSON for further analysis
    def serialize_tree(node):
        if node is None:
            return None
        return {
            "address": node["address"],
            "formula": node.get("formula"),
            "precedents": [serialize_tree(p) for p in node.get("precedents", [])]
        }

    output = {cell: serialize_tree(deps) for cell, deps in all_deps.items()}

    with open("scripts/formula-dag-output.json", "w") as f:
        json.dump(output, f, indent=2, default=str)

    print("\n\nSaved dependency tree to scripts/formula-dag-output.json")

finally:
    wb.close()
    app.quit()
    print("\nExcel closed.")
