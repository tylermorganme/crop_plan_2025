/**
 * DAG Graph visualization - simple HTML/CSS, no libraries.
 * Direct DOM, no intermediate state, no memoization issues.
 */

import dagre from 'dagre';
import { useAppState, useDispatch } from '../store';
import type { Column } from '../store';

// Colors
const classColors: Record<string, string> = {
  INPUT: '#2d8659',
  CALCULATED: '#3b82c4',
  MIXED: '#c97a3a',
  EMPTY: '#6b7280',
};

const statusColors = {
  verified: '#00ff88',
  issue: '#ff3366',
  variance: '#ffee00',
  skip: '#a855f7',
  none: '#2a2a35',
};

interface LayoutNode {
  id: string;
  col: Column;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

function computeLayout(
  columns: Column[],
  edges: { source: string; target: string }[]
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 30, ranksep: 50 });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeHeight = 28;

  // Build a map for column lookup
  const colMap = new Map<string, Column>();
  columns.forEach(col => {
    const width = 20 + col.header.length * 7;
    g.setNode(col.id, { width, height: nodeHeight });
    colMap.set(col.id, col);
  });

  edges.forEach(e => {
    g.setEdge(e.source, e.target);
  });

  dagre.layout(g);

  const layoutNodes: LayoutNode[] = [];
  g.nodes().forEach(nodeId => {
    const node = g.node(nodeId);
    const col = colMap.get(nodeId);
    if (node && col) {
      layoutNodes.push({
        id: nodeId,
        col,
        x: node.x - node.width / 2,
        y: node.y - node.height / 2,
        width: node.width,
        height: node.height,
      });
    }
  });

  const layoutEdges: LayoutEdge[] = edges.map((e, i) => ({
    id: `edge-${i}`,
    source: e.source,
    target: e.target,
  }));

  return { nodes: layoutNodes, edges: layoutEdges };
}

export function DAGGraph() {
  const dispatch = useDispatch();
  const { columns, edges: storeEdges, currentTable, selectedColumnId, statusFilter } = useAppState();

  // DEBUG: Log when component renders and what columns look like
  console.log('DAGGraph render:', {
    statusFilter,
    columnsCount: columns.length,
    sampleCol: columns[0] ? { id: columns[0].id, verified: columns[0].verified } : null,
  });

  // Compute filtered IDs directly - no caching, no stale data
  const filteredIds = new Set(
    columns.filter(col => {
      // Apply current filter logic inline
      let passesStatus = true;
      switch (statusFilter) {
        case 'pending':
          passesStatus = !col.verified && !col.remove && !col.has_issue && !col.skip;
          break;
        case 'verified':
          passesStatus = col.verified && !col.remove;
          break;
        case 'unverified':
          passesStatus = !col.verified && !col.remove;
          break;
        case 'issues':
          passesStatus = col.has_issue;
          break;
        case 'skip':
          passesStatus = col.skip;
          break;
        case 'remove':
          passesStatus = col.remove;
          break;
      }
      return passesStatus;
    }).map(c => c.id)
  );

  // Filter to current table - computed fresh each render
  const tableColumns = columns.filter(c => c.id.startsWith(currentTable));

  const tableEdges = (() => {
    const prefix = currentTable + '_';
    return storeEdges.filter(
      e => e.source.startsWith(prefix) && e.target.startsWith(prefix)
    );
  })();

  // Compute layout - this is expensive but we need fresh data
  const layout = computeLayout(tableColumns, tableEdges);

  // Build node position map for edge drawing
  const nodePositions = new Map<string, LayoutNode>();
  layout.nodes.forEach(n => nodePositions.set(n.id, n));

  // Compute SVG bounds
  let bounds = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  if (layout.nodes.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    layout.nodes.forEach(n => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    });
    bounds = { minX: minX - 50, minY: minY - 50, maxX: maxX + 50, maxY: maxY + 50 };
  }

  const svgWidth = bounds.maxX - bounds.minX;
  const svgHeight = bounds.maxY - bounds.minY;

  return (
    <div style={{ width: '100%', height: '100%', background: '#0c0c12', overflow: 'auto' }}>
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`${bounds.minX} ${bounds.minY} ${svgWidth} ${svgHeight}`}
        style={{ display: 'block' }}
      >
        {/* Edges */}
        {layout.edges.map(edge => {
          const source = nodePositions.get(edge.source);
          const target = nodePositions.get(edge.target);
          if (!source || !target) return null;

          const x1 = source.x + source.width / 2;
          const y1 = source.y + source.height;
          const x2 = target.x + target.width / 2;
          const y2 = target.y;

          return (
            <line
              key={edge.id}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#444"
              strokeWidth={1}
            />
          );
        })}

        {/* Nodes - always read fresh column data from columns array */}
        {layout.nodes.map(node => {
          // CRITICAL: Always get fresh column data from the source of truth
          const col = columns.find(c => c.id === node.id) || node.col;
          const isFiltered = filteredIds.has(col.id);
          const isSelected = col.id === selectedColumnId;

          const backgroundColor = classColors[col.classification] || '#666';

          let borderColor = statusColors.none;
          let borderWidth = 1;

          if (col.has_issue) {
            borderColor = statusColors.issue;
            borderWidth = 3;
          } else if (col.verified) {
            borderColor = statusColors.verified;
            borderWidth = 3;
          } else if (col.skip) {
            borderColor = statusColors.skip;
            borderWidth = 3;
          } else if (col.variance > 0) {
            borderColor = statusColors.variance;
            borderWidth = 2;
          }

          const opacity = col.remove ? 0.4 : isFiltered ? 1 : 0.15;

          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              style={{ cursor: 'pointer', opacity }}
              onClick={() => dispatch({ type: 'SELECT_COLUMN', payload: col.id })}
            >
              <rect
                width={node.width}
                height={node.height}
                rx={4}
                fill={backgroundColor}
                stroke={borderColor}
                strokeWidth={borderWidth}
                strokeDasharray={borderWidth > 1 ? '4,2' : 'none'}
              />
              {isSelected && (
                <rect
                  x={-2}
                  y={-2}
                  width={node.width + 4}
                  height={node.height + 4}
                  rx={6}
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth={2}
                />
              )}
              <text
                x={node.width / 2}
                y={node.height / 2 + 4}
                textAnchor="middle"
                fill="#fff"
                fontSize={11}
                fontFamily="JetBrains Mono, monospace"
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
              >
                {col.header}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
