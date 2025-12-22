"""
Use the 'formulas' library to build a proper dependency graph from the Excel workbook.
This library can parse Excel formulas (including structured table references) and
build a complete dependency DAG.
"""

import formulas
from formulas.excel import ExcelModel
import json

print("Loading Excel workbook with formulas library...")
print("This may take a moment as it parses all formulas...\n")

# Load the workbook
try:
    xl_model = ExcelModel().loads("Crop Plan 2025 V20.xlsm").finish()
    print("Workbook loaded successfully!")
except Exception as e:
    print(f"Error loading workbook: {e}")
    raise

# Get available sheets
print(f"\nSheets in workbook: {list(xl_model.books.keys())}")

# Try to get the Bed Plan sheet info
print("\n" + "="*80)
print("EXPLORING THE MODEL")
print("="*80)

# Check what's available in the model
print(f"\nModel type: {type(xl_model)}")
print(f"Model attributes: {[a for a in dir(xl_model) if not a.startswith('_')]}")

# Try to access the dependency graph
if hasattr(xl_model, 'dsp'):
    dsp = xl_model.dsp
    print(f"\nDispatcher (dsp) found!")
    print(f"DSP type: {type(dsp)}")
    print(f"DSP attributes: {[a for a in dir(dsp) if not a.startswith('_')][:20]}...")

# Try to get nodes and edges
if hasattr(xl_model, 'dsp') and hasattr(xl_model.dsp, 'nodes'):
    nodes = xl_model.dsp.nodes
    print(f"\nNumber of nodes in graph: {len(nodes)}")

    # Find nodes related to Bed Plan
    bed_plan_nodes = [n for n in nodes if 'Bed Plan' in str(n)]
    print(f"Bed Plan nodes: {len(bed_plan_nodes)}")

    if bed_plan_nodes:
        print("\nSample Bed Plan nodes:")
        for node in bed_plan_nodes[:20]:
            print(f"  {node}")

# Try to trace a specific cell
print("\n" + "="*80)
print("TRACING SPECIFIC CELLS")
print("="*80)

# Let's try to trace End of Harvest for row 6
target_cells = [
    "'Bed Plan'!AJ6",  # End of Harvest (col 36)
    "'Bed Plan'!AE6",  # Expected End of Harvest (col 31)
    "'Bed Plan'!AD6",  # Beginning of Harvest (col 30)
    "'Bed Plan'!AB6",  # Expected Beginning of Harvest (col 28)
    "'Bed Plan'!Z6",   # TP or DS Date (col 26)
    "'Bed Plan'!P6",   # Start Date (col 16)
]

for cell in target_cells:
    print(f"\n--- Checking {cell} ---")
    try:
        # Try to get the formula for this cell
        if cell in xl_model.dsp.nodes:
            node_data = xl_model.dsp.nodes[cell]
            print(f"  Node data: {node_data}")
    except Exception as e:
        print(f"  Error: {e}")

# Let's try to use the calculate functionality to see the dependency chain
print("\n" + "="*80)
print("DEPENDENCY CHAIN ANALYSIS")
print("="*80)

try:
    # Get the graph structure
    if hasattr(xl_model.dsp, 'get_sub_dsp'):
        print("Can get sub-dispatcher")

    # Try to get predecessors
    if hasattr(xl_model.dsp, 'pred'):
        pred = xl_model.dsp.pred
        print(f"Predecessors dict available with {len(pred)} entries")

        # Find predecessors for End of Harvest
        for key in pred:
            if 'AJ6' in str(key) or 'End of Harvest' in str(key):
                print(f"\nPredecessors of {key}:")
                for p in pred[key]:
                    print(f"  <- {p}")

except Exception as e:
    print(f"Error exploring dependencies: {e}")

# Try the dmap (dependency map)
print("\n" + "="*80)
print("EXPLORING DEPENDENCY MAP")
print("="*80)

try:
    if hasattr(xl_model, 'calculate'):
        print("Calculate method available")

    # Try to get the entire formula structure
    if hasattr(xl_model, 'books'):
        for book_name, book in xl_model.books.items():
            print(f"\nBook: {book_name}")
            if hasattr(book, 'sheets'):
                for sheet_name, sheet in book.sheets.items():
                    if 'Bed' in sheet_name:
                        print(f"  Sheet: {sheet_name}")
                        if hasattr(sheet, 'formulas'):
                            print(f"    Has formulas attribute")
                        if hasattr(sheet, 'cells'):
                            print(f"    Cells: {len(sheet.cells) if sheet.cells else 0}")

except Exception as e:
    print(f"Error: {e}")

# Let's try to visualize
print("\n" + "="*80)
print("ATTEMPTING GRAPH VISUALIZATION")
print("="*80)

try:
    # Try to save the graph
    if hasattr(xl_model.dsp, 'plot'):
        print("Plot method available - attempting to generate graph...")
        # This might create a graphviz visualization
        # xl_model.dsp.plot(workflow=True).render('formula_dag', view=False)

    # Try to get edges
    if hasattr(xl_model.dsp, 'dmap'):
        dmap = xl_model.dsp.dmap
        print(f"Dependency map has {len(dmap)} entries")

except Exception as e:
    print(f"Error with visualization: {e}")

# Final attempt - just dump what we can find
print("\n" + "="*80)
print("RAW STRUCTURE DUMP")
print("="*80)

try:
    # Get all nodes that are formulas (not just values)
    formula_nodes = []
    value_nodes = []

    for node, data in xl_model.dsp.nodes.items():
        if isinstance(node, str) and ('!' in node or '=' in str(data)):
            formula_nodes.append((node, data))
        else:
            value_nodes.append(node)

    print(f"Formula-like nodes: {len(formula_nodes)}")
    print(f"Other nodes: {len(value_nodes)}")

    # Show some formula nodes from Bed Plan
    print("\nBed Plan formula nodes (first 30):")
    bp_formulas = [(n, d) for n, d in formula_nodes if 'Bed Plan' in str(n)]
    for node, data in bp_formulas[:30]:
        print(f"  {node}: {type(data).__name__}")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
