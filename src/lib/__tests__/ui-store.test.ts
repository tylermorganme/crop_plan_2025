/**
 * UI Store Tests
 *
 * Tests the Zustand UI store (selection, search, toast)
 * and cross-tab BroadcastChannel sync behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock BroadcastChannel before importing ui-store
// Uses a channel registry so all instances on the same channel name share messages
const channelRegistry = new Map<string, Set<MockBroadcastChannel>>();

class MockBroadcastChannel {
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private listeners: ((event: MessageEvent) => void)[] = [];

  constructor(name: string) {
    this.name = name;
    if (!channelRegistry.has(name)) {
      channelRegistry.set(name, new Set());
    }
    channelRegistry.get(name)!.add(this);
  }

  postMessage(data: unknown) {
    const peers = channelRegistry.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      if (peer === this) continue;
      const event = new MessageEvent('message', { data });
      for (const handler of peer.listeners) {
        handler(event);
      }
      if (peer.onmessage) {
        peer.onmessage(event);
      }
    }
  }

  addEventListener(_type: string, handler: (event: MessageEvent) => void) {
    this.listeners.push(handler);
  }

  removeEventListener(_type: string, handler: (event: MessageEvent) => void) {
    const idx = this.listeners.indexOf(handler);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  close() {
    this.listeners = [];
    this.onmessage = null;
    channelRegistry.get(this.name)?.delete(this);
  }
}

// Polyfill globals needed by ui-store (must be before import)
// window must be defined so TAB_ID isn't null and listeners register
vi.stubGlobal('window', globalThis);
vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

const makeStorage = () => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
};
vi.stubGlobal('sessionStorage', makeStorage());
vi.stubGlobal('localStorage', makeStorage());

// Now import the store (after mocks are in place)
const { useUIStore, onUIStoreSyncMessage, TAB_ID } = await import('../ui-store');

describe('UI Store - Selection', () => {
  beforeEach(() => {
    useUIStore.setState({ selectedPlantingIds: new Set<string>() });
  });

  it('selectPlanting adds an ID to the selection', () => {
    useUIStore.getState().selectPlanting('p1');
    expect(useUIStore.getState().selectedPlantingIds.has('p1')).toBe(true);
    expect(useUIStore.getState().selectedPlantingIds.size).toBe(1);
  });

  it('deselectPlanting removes an ID from the selection', () => {
    useUIStore.getState().selectPlanting('p1');
    useUIStore.getState().selectPlanting('p2');
    useUIStore.getState().deselectPlanting('p1');
    expect(useUIStore.getState().selectedPlantingIds.has('p1')).toBe(false);
    expect(useUIStore.getState().selectedPlantingIds.has('p2')).toBe(true);
  });

  it('togglePlanting adds then removes', () => {
    useUIStore.getState().togglePlanting('p1');
    expect(useUIStore.getState().selectedPlantingIds.has('p1')).toBe(true);
    useUIStore.getState().togglePlanting('p1');
    expect(useUIStore.getState().selectedPlantingIds.has('p1')).toBe(false);
  });

  it('selectMultiple adds multiple IDs', () => {
    useUIStore.getState().selectMultiple(['p1', 'p2', 'p3']);
    expect(useUIStore.getState().selectedPlantingIds.size).toBe(3);
    expect(useUIStore.getState().selectedPlantingIds.has('p1')).toBe(true);
    expect(useUIStore.getState().selectedPlantingIds.has('p2')).toBe(true);
    expect(useUIStore.getState().selectedPlantingIds.has('p3')).toBe(true);
  });

  it('selectMultiple merges with existing selection', () => {
    useUIStore.getState().selectPlanting('p1');
    useUIStore.getState().selectMultiple(['p2', 'p3']);
    expect(useUIStore.getState().selectedPlantingIds.size).toBe(3);
  });

  it('clearSelection empties the set', () => {
    useUIStore.getState().selectMultiple(['p1', 'p2', 'p3']);
    useUIStore.getState().clearSelection();
    expect(useUIStore.getState().selectedPlantingIds.size).toBe(0);
  });

  it('isSelected returns correct value', () => {
    useUIStore.getState().selectPlanting('p1');
    expect(useUIStore.getState().isSelected('p1')).toBe(true);
    expect(useUIStore.getState().isSelected('p2')).toBe(false);
  });
});

describe('UI Store - Group Selection', () => {
  beforeEach(() => {
    useUIStore.setState({ selectedPlantingIds: new Set<string>() });
  });

  it('selectGroup adds all plantingIds', () => {
    useUIStore.getState().selectGroup('g1', ['p1', 'p2', 'p3']);
    expect(useUIStore.getState().selectedPlantingIds.size).toBe(3);
  });

  it('deselectGroup removes all plantingIds', () => {
    useUIStore.getState().selectGroup('g1', ['p1', 'p2', 'p3']);
    useUIStore.getState().deselectGroup('g1', ['p1', 'p2']);
    expect(useUIStore.getState().selectedPlantingIds.size).toBe(1);
    expect(useUIStore.getState().selectedPlantingIds.has('p3')).toBe(true);
  });

  it('toggleGroup selects when not all selected', () => {
    useUIStore.getState().selectPlanting('p1');
    useUIStore.getState().toggleGroup('g1', ['p1', 'p2', 'p3']);
    expect(useUIStore.getState().selectedPlantingIds.size).toBe(3);
  });

  it('toggleGroup deselects when all already selected', () => {
    useUIStore.getState().selectGroup('g1', ['p1', 'p2', 'p3']);
    useUIStore.getState().toggleGroup('g1', ['p1', 'p2', 'p3']);
    expect(useUIStore.getState().selectedPlantingIds.size).toBe(0);
  });

  it('isGroupSelected returns true only when all are selected', () => {
    useUIStore.getState().selectPlanting('p1');
    useUIStore.getState().selectPlanting('p2');
    expect(useUIStore.getState().isGroupSelected('g1', ['p1', 'p2'])).toBe(true);
    expect(useUIStore.getState().isGroupSelected('g1', ['p1', 'p2', 'p3'])).toBe(false);
  });
});

describe('UI Store - Zustand Subscriber Notifications', () => {
  beforeEach(() => {
    useUIStore.setState({ selectedPlantingIds: new Set<string>() });
  });

  it('subscribe is notified on selectMultiple', () => {
    const listener = vi.fn();
    const unsub = useUIStore.subscribe(listener);

    useUIStore.getState().selectMultiple(['p1', 'p2']);

    // selectMultiple calls clearSelection first (broadcast) then selectMultiple
    // Both are state changes, so listener may fire multiple times
    expect(listener).toHaveBeenCalled();
    const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
    expect(lastCall[0].selectedPlantingIds.size).toBe(2);

    unsub();
  });

  it('subscribe is notified on setState (simulating cross-tab)', () => {
    const listener = vi.fn();
    const unsub = useUIStore.subscribe(listener);

    // This is what UIStoreProvider does when receiving a cross-tab message
    useUIStore.setState({
      selectedPlantingIds: new Set(['p1', 'p2', 'p3']),
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const [newState] = listener.mock.calls[0];
    expect(newState.selectedPlantingIds.size).toBe(3);

    unsub();
  });
});

describe('UI Store - Cross-Tab Sync', () => {
  beforeEach(() => {
    useUIStore.setState({ selectedPlantingIds: new Set<string>() });
  });

  it('onUIStoreSyncMessage receives selection-changed from another tab', () => {
    const callback = vi.fn();
    const unsub = onUIStoreSyncMessage(callback);

    // Simulate another tab broadcasting
    const senderChannel = new MockBroadcastChannel('ui-store-sync');
    senderChannel.postMessage({
      type: 'selection-changed',
      selectedIds: ['p1', 'p2', 'p3'],
      tabId: 'other-tab-123',
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toEqual({
      type: 'selection-changed',
      selectedIds: ['p1', 'p2', 'p3'],
      tabId: 'other-tab-123',
    });

    unsub();
    senderChannel.close();
  });

  it('full cross-tab flow: setState notifies subscribers', () => {
    const storeListener = vi.fn();
    const unsub1 = useUIStore.subscribe(storeListener);

    // Simulate what UIStoreProvider does
    const unsub2 = onUIStoreSyncMessage((message) => {
      if (message.tabId === TAB_ID) return;
      if (message.type === 'selection-changed') {
        useUIStore.setState({
          selectedPlantingIds: new Set(message.selectedIds),
        });
      }
    });

    // Another tab broadcasts selection
    const senderChannel = new MockBroadcastChannel('ui-store-sync');
    senderChannel.postMessage({
      type: 'selection-changed',
      selectedIds: ['p1', 'p2', 'p3'],
      tabId: 'other-tab-123',
    });

    // Store should be updated
    expect(useUIStore.getState().selectedPlantingIds.size).toBe(3);

    // Store subscriber should have been notified
    expect(storeListener).toHaveBeenCalled();
    const lastCall = storeListener.mock.calls[storeListener.mock.calls.length - 1];
    expect(lastCall[0].selectedPlantingIds.has('p1')).toBe(true);

    unsub1();
    unsub2();
    senderChannel.close();
  });

  it('own-tab echo filtering works in UIStoreProvider pattern', () => {
    const storeListener = vi.fn();
    const unsub1 = useUIStore.subscribe(storeListener);

    // Simulate UIStoreProvider's filtering logic
    const unsub2 = onUIStoreSyncMessage((message) => {
      // Same filtering as UIStoreProvider
      if (message.tabId === TAB_ID) return; // Ignore own tab
      if (message.type === 'selection-changed') {
        useUIStore.setState({
          selectedPlantingIds: new Set(message.selectedIds),
        });
      }
    });

    // Send from "own tab" — should be filtered out
    const senderChannel = new MockBroadcastChannel('ui-store-sync');
    senderChannel.postMessage({
      type: 'selection-changed',
      selectedIds: ['p1'],
      tabId: TAB_ID!,
    });

    // Store should NOT be updated (message was from own tab)
    expect(useUIStore.getState().selectedPlantingIds.size).toBe(0);
    // Listener should not have been called for selection
    expect(storeListener).not.toHaveBeenCalled();

    unsub1();
    unsub2();
    senderChannel.close();
  });
});

describe('UI Store - Search', () => {
  beforeEach(() => {
    useUIStore.setState({ searchQuery: '' });
  });

  it('setSearchQuery updates the query', () => {
    useUIStore.getState().setSearchQuery('crop:tomato');
    expect(useUIStore.getState().searchQuery).toBe('crop:tomato');
  });

  it('setSearchQuery notifies subscribers', () => {
    const listener = vi.fn();
    const unsub = useUIStore.subscribe(listener);
    useUIStore.getState().setSearchQuery('tag:organic');
    expect(listener).toHaveBeenCalled();
    const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
    expect(lastCall[0].searchQuery).toBe('tag:organic');
    unsub();
  });

  it('clearing search sets empty string', () => {
    useUIStore.getState().setSearchQuery('test');
    useUIStore.getState().setSearchQuery('');
    expect(useUIStore.getState().searchQuery).toBe('');
  });
});

describe('UI Store - Toast', () => {
  beforeEach(() => {
    useUIStore.setState({ toast: null });
  });

  it('setToast stores the toast', () => {
    useUIStore.getState().setToast({ message: 'Saved!', type: 'success' });
    expect(useUIStore.getState().toast).toEqual({ message: 'Saved!', type: 'success' });
  });

  it('setToast(null) clears the toast', () => {
    useUIStore.getState().setToast({ message: 'Error', type: 'error' });
    useUIStore.getState().setToast(null);
    expect(useUIStore.getState().toast).toBeNull();
  });
});
