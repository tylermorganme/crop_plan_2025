#!/usr/bin/env python3
"""
Summarize DAG JSON files and produce implementation roadmap.

Analyzes the DAG output to identify:
- True inputs (Level 0 entry points)
- Columns with formula variance (need manual review)
- Cross-table dependencies
- Implementation order by level

Usage:
    python summarize-dag.py crops-dag.json [bedplan-dag.json]
"""

import json
import sys
from collections import defaultdict


def load_dag(path):
    with open(path) as f:
        return json.load(f)


def analyze_dag(dag_data):
    """Analyze a single DAG and return summary stats."""
    columns = dag_data["columns"]

    by_class = defaultdict(list)
    with_variance = []
    with_external_deps = []

    for col_num, info in columns.items():
        col_num = int(col_num)
        header = info["header"]
        classification = info["classification"]
        variance = info.get("variance_pct", 0)
        external = info.get("external_deps", [])

        by_class[classification].append((col_num, header, info))

        if variance > 0:
            with_variance.append((col_num, header, variance, info))

        if external:
            with_external_deps.append((col_num, header, external, info))

    return {
        "by_class": by_class,
        "with_variance": with_variance,
        "with_external_deps": with_external_deps,
        "total_columns": len(columns)
    }


def compute_levels(dag_data):
    """Compute dependency levels for all columns."""
    columns = dag_data["columns"]
    header_to_col = {info["header"]: int(col) for col, info in columns.items()}

    levels = {}

    def get_level(col_num):
        if col_num in levels:
            return levels[col_num]

        col_str = str(col_num)
        if col_str not in columns:
            return 0

        info = columns[col_str]
        deps = info.get("depends_on", [])
        external = info.get("external_deps", [])

        if not deps:
            if external:
                levels[col_num] = 1  # Has external deps only
            else:
                levels[col_num] = 0  # True input
            return levels[col_num]

        # Map dependency names to column numbers
        dep_cols = [header_to_col.get(d) for d in deps if d in header_to_col]
        dep_cols = [d for d in dep_cols if d is not None]

        if not dep_cols:
            levels[col_num] = 1 if external else 0
            return levels[col_num]

        max_dep = max(get_level(d) for d in dep_cols)
        levels[col_num] = max_dep + 1
        return levels[col_num]

    for col_num in columns:
        get_level(int(col_num))

    return levels


def print_summary(name, dag_data, analysis):
    """Print summary for a single DAG."""
    print(f"\n{'='*80}")
    print(f"TABLE: {name}")
    print(f"{'='*80}")
    print(f"Total columns: {analysis['total_columns']}")

    # Classification breakdown
    print(f"\nClassification:")
    for cls in ["INPUT", "CALCULATED", "MIXED", "EMPTY"]:
        items = analysis["by_class"].get(cls, [])
        print(f"  {cls}: {len(items)}")

    # Inputs (Level 0)
    inputs = analysis["by_class"].get("INPUT", [])
    print(f"\n--- INPUT COLUMNS ({len(inputs)}) ---")
    for col, header, info in sorted(inputs):
        print(f"  [{col:3d}] {header}")

    # Columns with variance
    variance_cols = analysis["with_variance"]
    if variance_cols:
        print(f"\n--- COLUMNS WITH VARIANCE ({len(variance_cols)}) ---")
        print("  (These need manual review - formulas differ across rows)")
        for col, header, variance, info in sorted(variance_cols, key=lambda x: -x[2]):
            formula_preview = (info.get("base_formula") or "")[:50]
            print(f"  [{col:3d}] {header}: {variance}% variance")
            if formula_preview:
                print(f"        Base: {formula_preview}...")

    # External dependencies
    external_cols = analysis["with_external_deps"]
    if external_cols:
        print(f"\n--- CROSS-TABLE DEPENDENCIES ({len(external_cols)}) ---")
        for col, header, external, info in sorted(external_cols):
            print(f"  [{col:3d}] {header}")
            print(f"        → {', '.join(external)}")

    # Levels
    levels = compute_levels(dag_data)
    by_level = defaultdict(list)
    columns = dag_data["columns"]
    for col_num, level in levels.items():
        header = columns[str(col_num)]["header"]
        classification = columns[str(col_num)]["classification"]
        by_level[level].append((col_num, header, classification))

    print(f"\n--- IMPLEMENTATION ORDER (by level) ---")
    for level in sorted(by_level.keys()):
        items = by_level[level]
        print(f"\nLevel {level} ({len(items)} columns):")
        for col, header, cls in sorted(items):
            marker = f"({cls})"
            print(f"  [{col:3d}] {header} {marker}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python summarize-dag.py <dag.json> [dag2.json ...]")
        sys.exit(1)

    all_external_deps = set()

    for path in sys.argv[1:]:
        try:
            dag_data = load_dag(path)
            name = dag_data.get("table", path)
            analysis = analyze_dag(dag_data)
            print_summary(name, dag_data, analysis)

            # Collect all external deps
            for col, header, external, info in analysis["with_external_deps"]:
                all_external_deps.update(external)
        except Exception as e:
            print(f"Error loading {path}: {e}", file=sys.stderr)

    # Print cross-table dependency summary
    if all_external_deps:
        print(f"\n{'='*80}")
        print("CROSS-TABLE DEPENDENCY SUMMARY")
        print(f"{'='*80}")
        print("\nExternal columns referenced:")
        for dep in sorted(all_external_deps):
            print(f"  {dep}")


if __name__ == "__main__":
    main()
