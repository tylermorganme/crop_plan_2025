'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

// =============================================================================
// Types
// =============================================================================

export interface VirtualizedChartGridProps<T> {
  /** Items to render in the grid */
  items: T[];
  /** Render function for each item */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Width of each item including gap (default: 220) */
  itemWidth?: number;
  /** Height of each item including gap (default: 160) */
  itemHeight?: number;
  /** Gap between items (default: 16) */
  gap?: number;
  /** Additional className for the container */
  className?: string;
}

// =============================================================================
// VirtualizedChartGrid Component
// =============================================================================

export function VirtualizedChartGrid<T>({
  items,
  renderItem,
  itemWidth = 220,
  itemHeight = 160,
  gap = 16,
  className = '',
}: VirtualizedChartGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // Calculate layout
  const columnsPerRow = Math.max(1, Math.floor(containerWidth / itemWidth));
  const rowCount = Math.ceil(items.length / columnsPerRow);

  // Track container width with ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Set initial width
    setContainerWidth(container.clientWidth);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        setContainerWidth(width);
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Virtualize rows
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => itemHeight,
    overscan: 2,
  });

  // Get items for a specific row
  const getRowItems = useCallback(
    (rowIndex: number) => {
      const startIndex = rowIndex * columnsPerRow;
      return items.slice(startIndex, startIndex + columnsPerRow);
    },
    [items, columnsPerRow]
  );

  if (items.length === 0) {
    return (
      <div className={`flex items-center justify-center h-full text-gray-500 ${className}`}>
        No items to display
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-auto h-full ${className}`}
    >
      <div
        style={{
          height: rowVirtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const rowItems = getRowItems(virtualRow.index);
          const startIndex = virtualRow.index * columnsPerRow;

          return (
            <div
              key={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: itemHeight,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'flex',
                gap: gap,
                paddingLeft: gap / 2,
                paddingRight: gap / 2,
              }}
            >
              {rowItems.map((item, i) => (
                <div
                  key={startIndex + i}
                  style={{
                    width: itemWidth - gap,
                    height: itemHeight - gap,
                    flexShrink: 0,
                  }}
                >
                  {renderItem(item, startIndex + i)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualizedChartGrid;
