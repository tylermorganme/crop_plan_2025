/**
 * API client and SSE connection - uses Next.js API routes.
 */

import type { Column, Stats } from './store';

const API_BASE = '/api';

// Generic fetch wrapper
async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(API_BASE + endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

// API methods
export async function fetchColumns(table: string): Promise<Column[]> {
  return apiFetch<Column[]>(`/columns?table=${table}`);
}

export async function fetchEdges(): Promise<{ data: { id: string; source: string; target: string } }[]> {
  return apiFetch('/edges');
}

export async function fetchStats(table: string): Promise<{ stats: Stats }> {
  return apiFetch(`/stats?table=${table}`);
}

export async function updateColumn(
  id: string,
  updates: Partial<Pick<Column, 'verified' | 'remove' | 'has_issue' | 'implemented' | 'skip' | 'notes' | 'code_field'>>
): Promise<Column> {
  return apiFetch(`/columns/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function resetDatabase(): Promise<void> {
  await apiFetch('/reset', { method: 'POST' });
}

// SSE connection
export type SSECallback = (event: {
  type: 'column-updated' | 'bulk-updated';
  data: Partial<Column> & { id: string };
}) => void;

export function connectSSE(onMessage: SSECallback, onConnect?: () => void, onError?: () => void) {
  const eventSource = new EventSource(API_BASE + '/events');

  eventSource.onopen = () => {
    onConnect?.();
  };

  eventSource.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      onMessage(parsed);
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  };

  eventSource.onerror = () => {
    onError?.();
  };

  return () => eventSource.close();
}
