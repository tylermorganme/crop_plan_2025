'use client';

import { useSortable } from '@dnd-kit/sortable';
import type { DraggableSyntheticListeners, DraggableAttributes } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { createContext, useContext, type ReactNode } from 'react';

// Context to pass drag handle props to GroupHeader
interface DragHandleContextValue {
  listeners: DraggableSyntheticListeners;
  attributes: DraggableAttributes;
  setActivatorNodeRef: (node: HTMLElement | null) => void;
}

const DragHandleContext = createContext<DragHandleContextValue | null>(null);

export function useDragHandle() {
  return useContext(DragHandleContext);
}

interface SortableGroupItemProps {
  id: string;
  children: ReactNode;
}

export default function SortableGroupItem({ id, children }: SortableGroupItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <DragHandleContext.Provider
      value={{
        listeners,
        attributes,
        setActivatorNodeRef
      }}
    >
      <div ref={setNodeRef} style={style} data-group-id={id}>
        {children}
      </div>
    </DragHandleContext.Provider>
  );
}
