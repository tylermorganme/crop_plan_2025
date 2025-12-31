'use client';

/**
 * DAG Graph visualization using dagre layout + SVG rendering.
 * Supports pan (drag) and zoom (wheel).
 *
 * Performance: Layout is memoized and only recomputed when graph structure changes.
 * Pan/zoom uses CSS transforms for smooth 60fps interaction.
 */

import dagre from 'dagre';
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useAppState, useDispatch } from '../store';
import type { Column } from '../store';

const TRANSFORM_STORAGE_KEY = 'dag-graph-transform';

// Colors matching the original React app
const classColors: Record<string, string> = {
  INPUT: '#2d8659',
  CALCULATED: '#3b82c4',
  MIXED: '#c97a3a',
  EMPTY: '#6b7280',
};

// Status indicator colors
const STATUS = {
  verified: '#22c55e',    // Green checkmark
  removed: '#ef4444',     // Red X
  skip: '#eab308',        // Yellow skip
  issue: '#f97316',       // Orange warning
  implemented: '#22c55e', // Green for alternating border
  variance: '#eab308',    // Yellow for variance border
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

// Load transform from localStorage (client-side only)
function loadTransform(table: string): { x: number; y: number; scale: number } | null {
  try {
    const stored = localStorage.getItem(`${TRANSFORM_STORAGE_KEY}-${table}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number' && typeof parsed.scale === 'number') {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

const DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 1 };

export function DAGGraph() {
  const dispatch = useDispatch();
  const { columns, edges: storeEdges, currentTable, selectedColumnId, statusFilter } = useAppState();

  // Pan and zoom state - use refs for values needed during drag to avoid re-renders
  // Start with default to avoid hydration mismatch, then load from localStorage
  const [transform, setTransform] = useState(DEFAULT_TRANSFORM);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const containerRef = useRef<HTMLDivElement>(null);
  const initialLoadRef = useRef(false);

  // Load transform from localStorage after mount (avoids hydration mismatch)
  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      const saved = loadTransform(currentTable);
      if (saved) {
        setTransform(saved);
      }
    }
  }, [currentTable]);

  // Load transform when table changes
  useEffect(() => {
    const saved = loadTransform(currentTable);
    if (saved) {
      setTransform(saved);
    } else {
      setTransform(DEFAULT_TRANSFORM);
    }
  }, [currentTable]);

  // Persist transform to localStorage when it changes (skip initial render)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    localStorage.setItem(`${TRANSFORM_STORAGE_KEY}-${currentTable}`, JSON.stringify(transform));
  }, [transform, currentTable]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as SVGElement;
    if (target.closest('g[data-node]')) return;

    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX - transformRef.current.x,
      y: e.clientY - transformRef.current.y,
    };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setTransform(t => ({
      ...t,
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    }));
  }, [isPanning]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;

    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setTransform(t => {
        const newScale = Math.min(Math.max(t.scale * delta, 0.2), 3);
        return {
          scale: newScale,
          x: mouseX - (mouseX - t.x) * (newScale / t.scale),
          y: mouseY - (mouseY - t.y) * (newScale / t.scale),
        };
      });
    }
  }, []);

  // Filter to current table - memoized
  const tableColumns = useMemo(
    () => columns.filter(c => c.id.startsWith(currentTable)),
    [columns, currentTable]
  );

  const tableEdges = useMemo(
    () => storeEdges.filter(e => e.source.startsWith(currentTable) && e.target.startsWith(currentTable)),
    [storeEdges, currentTable]
  );

  // Memoize the expensive dagre layout computation
  const layout = useMemo(
    () => computeLayout(tableColumns, tableEdges),
    [tableColumns, tableEdges]
  );

  // Memoize filtered IDs
  // Filter logic is independent of status (include/skip/remove)
  // Status only affects the icon shown, not whether the node matches a filter
  const filteredIds = useMemo(() => {
    return new Set(
      columns.filter(col => {
        switch (statusFilter) {
          case 'pending':
            // Pending = not verified, no issue, and no status decision made yet
            return !col.verified && !col.has_issue && col.status === null;
          case 'verified':
            return col.verified;
          case 'unverified':
            return !col.verified;
          case 'issues':
            return col.has_issue;
          case 'skip':
            return col.status === 'skip';
          case 'remove':
            return col.status === 'remove';
          default:
            return true;
        }
      }).map(c => c.id)
    );
  }, [columns, statusFilter]);

  // Memoize node position map
  const nodePositions = useMemo(() => {
    const map = new Map<string, LayoutNode>();
    layout.nodes.forEach(n => map.set(n.id, n));
    return map;
  }, [layout.nodes]);

  // Memoize SVG bounds
  const { bounds, svgWidth, svgHeight } = useMemo(() => {
    let b = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
    if (layout.nodes.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      layout.nodes.forEach(n => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
      });
      b = { minX: minX - 50, minY: minY - 50, maxX: maxX + 50, maxY: maxY + 50 };
    }
    return {
      bounds: b,
      svgWidth: b.maxX - b.minX,
      svgHeight: b.maxY - b.minY,
    };
  }, [layout.nodes]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-w-0 h-full bg-[#0c0c12] overflow-hidden"
      style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
    >
      <svg
        width="100%"
        height="100%"
        style={{ display: 'block' }}
      >
        {/* Transform group for pan/zoom - GPU accelerated */}
        <g
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
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

        {/* Nodes */}
        {layout.nodes.map(node => {
          // Always get fresh column data
          const col = columns.find(c => c.id === node.id) || node.col;
          const isFiltered = filteredIds.has(col.id);
          const isSelected = col.id === selectedColumnId;

          const backgroundColor = classColors[col.classification] || '#666';
          // Only the sidebar filter affects opacity
          const opacity = isFiltered ? 1 : 0.15;

          // Determine border style
          let borderColor = '#2a2a35';
          let borderWidth = 1;
          let strokeDasharray = 'none';

          if (col.implemented) {
            // Alternating green/white dashed border for implemented
            borderColor = STATUS.implemented;
            borderWidth = 2;
            strokeDasharray = '4,4';
          } else if (col.variance > 0) {
            // Yellow border for variance
            borderColor = STATUS.variance;
            borderWidth = 2;
          }

          // Icon size for status indicators
          const iconSize = 10;
          const iconPadding = 3;

          return (
            <g
              key={node.id}
              data-node="true"
              transform={`translate(${node.x}, ${node.y})`}
              style={{ cursor: 'pointer', opacity }}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: 'SELECT_COLUMN', payload: col.id });
              }}
            >
              {/* Main node rectangle */}
              <rect
                width={node.width}
                height={node.height}
                rx={4}
                fill={backgroundColor}
                stroke={borderColor}
                strokeWidth={borderWidth}
                strokeDasharray={strokeDasharray}
              />

              {/* Implemented: overlay white dashes on top of green */}
              {col.implemented && (
                <rect
                  width={node.width}
                  height={node.height}
                  rx={4}
                  fill="none"
                  stroke="white"
                  strokeWidth={2}
                  strokeDasharray="4,4"
                  strokeDashoffset={4}
                />
              )}

              {/* Selection highlight */}
              {isSelected && (
                <rect
                  x={-3}
                  y={-3}
                  width={node.width + 6}
                  height={node.height + 6}
                  rx={6}
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth={2}
                />
              )}

              {/* Verified: Green checkmark in top-left */}
              {col.verified && col.status !== 'remove' && (
                <g transform={`translate(${iconPadding}, ${iconPadding})`}>
                  <circle cx={iconSize/2} cy={iconSize/2} r={iconSize/2} fill={STATUS.verified} />
                  <path
                    d={`M${iconSize*0.25},${iconSize*0.5} L${iconSize*0.45},${iconSize*0.7} L${iconSize*0.75},${iconSize*0.3}`}
                    stroke="white"
                    strokeWidth={1.5}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              )}

              {/* Removed: Red X in top-right */}
              {col.status === 'remove' && (
                <g transform={`translate(${node.width - iconSize - iconPadding}, ${iconPadding})`}>
                  <circle cx={iconSize/2} cy={iconSize/2} r={iconSize/2} fill={STATUS.removed} />
                  <path
                    d={`M${iconSize*0.3},${iconSize*0.3} L${iconSize*0.7},${iconSize*0.7} M${iconSize*0.7},${iconSize*0.3} L${iconSize*0.3},${iconSize*0.7}`}
                    stroke="white"
                    strokeWidth={1.5}
                    fill="none"
                    strokeLinecap="round"
                  />
                </g>
              )}

              {/* Skip: Yellow skip icon in top-right */}
              {col.status === 'skip' && (
                <g transform={`translate(${node.width - iconSize - iconPadding}, ${iconPadding})`}>
                  <circle cx={iconSize/2} cy={iconSize/2} r={iconSize/2} fill={STATUS.skip} />
                  <path
                    d={`M${iconSize*0.35},${iconSize*0.3} L${iconSize*0.65},${iconSize*0.5} L${iconSize*0.35},${iconSize*0.7}`}
                    stroke="white"
                    strokeWidth={1.5}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              )}

              {/* Has Issue: Orange warning in bottom-left */}
              {col.has_issue && (
                <g transform={`translate(${iconPadding}, ${node.height - iconSize - iconPadding})`}>
                  <path
                    d={`M${iconSize/2},${iconSize*0.15} L${iconSize*0.9},${iconSize*0.85} L${iconSize*0.1},${iconSize*0.85} Z`}
                    fill={STATUS.issue}
                  />
                  <text
                    x={iconSize/2}
                    y={iconSize*0.75}
                    textAnchor="middle"
                    fill="white"
                    fontSize={7}
                    fontWeight="bold"
                  >
                    !
                  </text>
                </g>
              )}

              {/* Node label */}
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
        </g>
      </svg>
    </div>
  );
}
