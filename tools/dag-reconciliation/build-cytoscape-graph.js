/**
 * Build a Cytoscape.js graph from DAG JSON files.
 *
 * Usage:
 *   node build-cytoscape-graph.js
 *
 * Outputs: graph-data.json (Cytoscape elements format)
 */

const fs = require('fs');
const path = require('path');

// Convert column number to Excel letter (1=A, 27=AA, etc.)
function colNumToLetter(num) {
  let letter = '';
  while (num > 0) {
    const mod = (num - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    num = Math.floor((num - 1) / 26);
  }
  return letter;
}

function loadDAG(filename) {
  const filepath = path.join(__dirname, filename);
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function buildGraph(dagData, tablePrefix = '') {
  const columns = dagData.columns;
  const nodes = [];
  const edges = [];

  // Build header -> col mapping
  const headerToCol = {};
  for (const [colNum, info] of Object.entries(columns)) {
    headerToCol[info.header] = colNum;
  }

  // Compute levels (with cycle detection)
  const levels = {};
  const computing = new Set(); // Track nodes being computed to detect cycles

  function getLevel(colNum) {
    if (levels[colNum] !== undefined) return levels[colNum];

    // Cycle detection
    if (computing.has(colNum)) {
      console.warn(`Cycle detected at column ${colNum}`);
      return 0;
    }
    computing.add(colNum);

    const info = columns[colNum];
    if (!info) {
      computing.delete(colNum);
      return 0;
    }

    const deps = info.depends_on || [];
    const external = info.external_deps || [];

    if (deps.length === 0) {
      levels[colNum] = external.length > 0 ? 1 : 0;
      computing.delete(colNum);
      return levels[colNum];
    }

    const depCols = deps
      .map(d => headerToCol[d])
      .filter(d => d && columns[d]);

    if (depCols.length === 0) {
      levels[colNum] = external.length > 0 ? 1 : 0;
      computing.delete(colNum);
      return levels[colNum];
    }

    const maxDep = Math.max(...depCols.map(d => getLevel(d)));
    levels[colNum] = maxDep + 1;
    computing.delete(colNum);
    return levels[colNum];
  }

  // Compute all levels first
  for (const colNum of Object.keys(columns)) {
    getLevel(colNum);
  }

  // Find max level for normalization
  const maxLevel = Math.max(...Object.values(levels));

  // Build nodes
  for (const [colNum, info] of Object.entries(columns)) {
    const level = levels[colNum];
    const nodeId = tablePrefix ? `${tablePrefix}_${colNum}` : colNum;

    // Determine if this is a leaf (nothing depends on it)
    const isLeaf = !Object.values(columns).some(other =>
      (other.depends_on || []).includes(info.header)
    );

    // Determine if this is a root (depends on nothing internal)
    const deps = (info.depends_on || [])
      .map(d => headerToCol[d])
      .filter(d => d && columns[d]);
    const isRoot = deps.length === 0;

    // Get more details from original DAG data
    const formulaCount = info.formula_rows || 0;
    const valueCount = info.value_rows || 0;
    const uniqueFormulas = info.unique_formulas || (info.base_formula ? 1 : 0);

    nodes.push({
      data: {
        id: nodeId,
        label: info.header,
        col: parseInt(colNum),
        colLetter: colNumToLetter(parseInt(colNum)),
        table: dagData.table || 'Unknown',
        classification: info.classification,
        level: level,
        maxLevel: maxLevel,
        // Formula details
        formula: info.base_formula || null,
        variance: info.variance_pct || 0,
        formulaCount: formulaCount,
        valueCount: valueCount,
        uniqueFormulas: uniqueFormulas,
        // Dependencies
        dependsOnNames: info.depends_on || [],
        externalDeps: info.external_deps || [],
        // Flags
        isLeaf: isLeaf,
        isRoot: isRoot,
        hasVariance: (info.variance_pct || 0) > 0,
        isMixed: info.classification === 'MIXED',
        isEmpty: info.classification === 'EMPTY',
        // Reconciliation fields (independent flags)
        verified: false,      // Have we reviewed this column?
        remove: false,        // Should this be removed/ignored?
        hasIssue: false,      // Found a problem needing resolution
        implemented: false,   // Has code implementation
        notes: '',            // Free-form notes
        codeField: null,      // Maps to this field in TypeScript
      }
    });

    // Build edges (dependencies)
    for (const depName of (info.depends_on || [])) {
      const depCol = headerToCol[depName];
      if (depCol && columns[depCol]) {
        const sourceId = tablePrefix ? `${tablePrefix}_${depCol}` : depCol;
        edges.push({
          data: {
            id: `${sourceId}->${nodeId}`,
            source: sourceId,
            target: nodeId,
          }
        });
      }
    }
  }

  return { nodes, edges };
}

function main() {
  // Load DAGs
  const cropsDAG = loadDAG('crops-dag.json');
  const bedplanDAG = loadDAG('bedplan-dag.json');

  // Build graphs
  const cropsGraph = buildGraph(cropsDAG, 'crops');
  const bedplanGraph = buildGraph(bedplanDAG, 'bedplan');

  // Combine
  const combined = {
    elements: {
      nodes: [...cropsGraph.nodes, ...bedplanGraph.nodes],
      edges: [...cropsGraph.edges, ...bedplanGraph.edges],
    },
    metadata: {
      generated: new Date().toISOString(),
      tables: {
        crops: {
          nodeCount: cropsGraph.nodes.length,
          edgeCount: cropsGraph.edges.length,
        },
        bedplan: {
          nodeCount: bedplanGraph.nodes.length,
          edgeCount: bedplanGraph.edges.length,
        }
      }
    }
  };

  // Also create separate files
  const cropsOnly = {
    elements: { nodes: cropsGraph.nodes, edges: cropsGraph.edges },
    metadata: { table: 'Crops', generated: new Date().toISOString() }
  };

  fs.writeFileSync(
    path.join(__dirname, 'graph-data.json'),
    JSON.stringify(combined, null, 2)
  );

  fs.writeFileSync(
    path.join(__dirname, 'crops-graph.json'),
    JSON.stringify(cropsOnly, null, 2)
  );

  console.log(`Generated graph-data.json:`);
  console.log(`  Crops: ${cropsGraph.nodes.length} nodes, ${cropsGraph.edges.length} edges`);
  console.log(`  BedPlan: ${bedplanGraph.nodes.length} nodes, ${bedplanGraph.edges.length} edges`);
  console.log(`  Total: ${combined.elements.nodes.length} nodes, ${combined.elements.edges.length} edges`);
}

main();
