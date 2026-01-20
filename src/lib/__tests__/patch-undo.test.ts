import { describe, it, expect } from 'vitest';
import { enablePatches, produceWithPatches, applyPatches, type Patch } from 'immer';

// Enable patches globally for these tests
enablePatches();

// =============================================================================
// IMMER PATCHES TESTS
// =============================================================================

describe('immer patches', () => {
  it('produceWithPatches generates correct patches for simple edit', () => {
    const original = { name: 'Original', count: 0 };

    const [nextState, patches, inversePatches] = produceWithPatches(original, (draft) => {
      draft.name = 'Updated';
    });

    expect(nextState.name).toBe('Updated');
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      op: 'replace',
      path: ['name'],
      value: 'Updated',
    });
    expect(inversePatches[0]).toMatchObject({
      op: 'replace',
      path: ['name'],
      value: 'Original',
    });
  });

  it('applyPatches with inverse restores original state', () => {
    const original = { name: 'Original', count: 5 };

    const [nextState, _patches, inversePatches] = produceWithPatches(original, (draft) => {
      draft.name = 'Changed';
      draft.count = 10;
    });

    expect(nextState.name).toBe('Changed');
    expect(nextState.count).toBe(10);

    const restored = applyPatches(nextState, inversePatches);

    expect(restored.name).toBe('Original');
    expect(restored.count).toBe(5);
  });

  it('patches work for nested object changes', () => {
    const original = {
      metadata: {
        name: 'Plan',
        year: 2025,
      },
      settings: {
        theme: 'light',
      },
    };

    const [nextState, patches, inversePatches] = produceWithPatches(original, (draft) => {
      draft.metadata.name = 'Updated Plan';
      draft.settings.theme = 'dark';
    });

    expect(nextState.metadata.name).toBe('Updated Plan');
    expect(patches).toHaveLength(2);

    // Restore
    const restored = applyPatches(nextState, inversePatches);
    expect(restored.metadata.name).toBe('Plan');
    expect(restored.settings.theme).toBe('light');
  });

  it('patches work for array add operation', () => {
    const original = { items: ['a', 'b'] };

    const [nextState, patches, inversePatches] = produceWithPatches(original, (draft) => {
      draft.items.push('c');
    });

    expect(nextState.items).toEqual(['a', 'b', 'c']);
    expect(patches[0]).toMatchObject({
      op: 'add',
      path: ['items', 2],
      value: 'c',
    });

    const restored = applyPatches(nextState, inversePatches);
    expect(restored.items).toEqual(['a', 'b']);
  });

  it('patches work for array remove operation', () => {
    const original = { items: ['a', 'b', 'c'] };

    const [nextState, patches, inversePatches] = produceWithPatches(original, (draft) => {
      draft.items.splice(1, 1); // Remove 'b'
    });

    expect(nextState.items).toEqual(['a', 'c']);

    const restored = applyPatches(nextState, inversePatches);
    expect(restored.items).toEqual(['a', 'b', 'c']);
  });

  it('patches work for complex array object operations', () => {
    interface Planting {
      id: string;
      crop: string;
      bedFeet: number;
    }

    const original: { plantings: Planting[] } = {
      plantings: [
        { id: 'P1', crop: 'Tomato', bedFeet: 50 },
        { id: 'P2', crop: 'Lettuce', bedFeet: 25 },
      ],
    };

    // Add a new planting
    const [afterAdd, _addPatches, addInverse] = produceWithPatches(original, (draft) => {
      draft.plantings.push({ id: 'P3', crop: 'Carrot', bedFeet: 30 });
    });

    expect(afterAdd.plantings).toHaveLength(3);

    // Modify existing planting
    const [afterModify, _modifyPatches, modifyInverse] = produceWithPatches(afterAdd, (draft) => {
      draft.plantings[0].bedFeet = 100;
    });

    expect(afterModify.plantings[0].bedFeet).toBe(100);

    // Undo modify
    const undoModify = applyPatches(afterModify, modifyInverse);
    expect(undoModify.plantings[0].bedFeet).toBe(50);

    // Undo add
    const undoAdd = applyPatches(undoModify, addInverse);
    expect(undoAdd.plantings).toHaveLength(2);
    expect(undoAdd.plantings.map((p) => p.id)).toEqual(['P1', 'P2']);
  });
});

// =============================================================================
// UNDO/REDO STACK TESTS
// =============================================================================

interface PatchEntry {
  patches: Patch[];
  inversePatches: Patch[];
  description: string;
}

/**
 * Simple undo/redo implementation for testing.
 * This mirrors what we'll build in the store.
 */
class UndoRedoStack<T extends object> {
  private current: T;
  private history: PatchEntry[] = [];
  private future: PatchEntry[] = [];
  private maxHistorySize: number;

  constructor(initial: T, maxHistorySize = 50) {
    this.current = initial;
    this.maxHistorySize = maxHistorySize;
  }

  get state(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get historyLength(): number {
    return this.history.length;
  }

  mutate(mutator: (draft: T) => void, description: string): void {
    const [nextState, patches, inversePatches] = produceWithPatches(this.current, mutator);

    this.current = nextState;
    this.history.push({ patches, inversePatches, description });
    this.future = []; // Clear redo stack on new action

    // Enforce history limit
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  undo(): boolean {
    if (!this.canUndo) return false;

    const entry = this.history.pop()!;
    this.current = applyPatches(this.current, entry.inversePatches);
    this.future.push(entry);

    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;

    const entry = this.future.pop()!;
    this.current = applyPatches(this.current, entry.patches);
    this.history.push(entry);

    return true;
  }
}

describe('undo/redo', () => {
  interface TestState {
    name: string;
    count: number;
    items: string[];
  }

  const createInitialState = (): TestState => ({
    name: 'Initial',
    count: 0,
    items: [],
  });

  it('undo restores previous state', () => {
    const stack = new UndoRedoStack(createInitialState());

    stack.mutate((draft) => {
      draft.name = 'Changed';
    }, 'Change name');

    expect(stack.state.name).toBe('Changed');

    stack.undo();

    expect(stack.state.name).toBe('Initial');
  });

  it('redo restores undone state', () => {
    const stack = new UndoRedoStack(createInitialState());

    stack.mutate((draft) => {
      draft.name = 'Changed';
    }, 'Change name');

    stack.undo();
    expect(stack.state.name).toBe('Initial');

    stack.redo();
    expect(stack.state.name).toBe('Changed');
  });

  it('new action clears redo stack', () => {
    const stack = new UndoRedoStack(createInitialState());

    stack.mutate((draft) => {
      draft.name = 'First';
    }, 'First change');

    stack.mutate((draft) => {
      draft.name = 'Second';
    }, 'Second change');

    stack.undo(); // Back to 'First'
    expect(stack.canRedo).toBe(true);

    stack.mutate((draft) => {
      draft.name = 'New Branch';
    }, 'New change');

    expect(stack.canRedo).toBe(false);
    expect(stack.state.name).toBe('New Branch');
  });

  it('undo at empty history does nothing', () => {
    const stack = new UndoRedoStack(createInitialState());

    const result = stack.undo();

    expect(result).toBe(false);
    expect(stack.state.name).toBe('Initial');
  });

  it('redo at empty future does nothing', () => {
    const stack = new UndoRedoStack(createInitialState());

    stack.mutate((draft) => {
      draft.name = 'Changed';
    }, 'Change');

    const result = stack.redo();

    expect(result).toBe(false);
    expect(stack.state.name).toBe('Changed');
  });

  it('multiple undos in sequence work correctly', () => {
    const stack = new UndoRedoStack(createInitialState());

    stack.mutate((draft) => {
      draft.count = 1;
    }, 'Set to 1');

    stack.mutate((draft) => {
      draft.count = 2;
    }, 'Set to 2');

    stack.mutate((draft) => {
      draft.count = 3;
    }, 'Set to 3');

    expect(stack.state.count).toBe(3);

    stack.undo();
    expect(stack.state.count).toBe(2);

    stack.undo();
    expect(stack.state.count).toBe(1);

    stack.undo();
    expect(stack.state.count).toBe(0);

    // Can't undo further
    expect(stack.undo()).toBe(false);
    expect(stack.state.count).toBe(0);
  });

  it('history limit enforced', () => {
    const maxHistory = 3;
    const stack = new UndoRedoStack(createInitialState(), maxHistory);

    // Add more items than the limit
    for (let i = 1; i <= 5; i++) {
      stack.mutate((draft) => {
        draft.count = i;
      }, `Set to ${i}`);
    }

    expect(stack.state.count).toBe(5);
    expect(stack.historyLength).toBe(maxHistory);

    // Can only undo 3 times
    stack.undo(); // 5 -> 4
    stack.undo(); // 4 -> 3
    stack.undo(); // 3 -> 2
    expect(stack.state.count).toBe(2);

    // Can't undo further (history was truncated)
    expect(stack.undo()).toBe(false);
    expect(stack.state.count).toBe(2);
  });

  it('complex undo/redo sequence', () => {
    const stack = new UndoRedoStack(createInitialState());

    stack.mutate((draft) => {
      draft.items.push('a');
    }, 'Add a');

    stack.mutate((draft) => {
      draft.items.push('b');
    }, 'Add b');

    stack.mutate((draft) => {
      draft.items.push('c');
    }, 'Add c');

    expect(stack.state.items).toEqual(['a', 'b', 'c']);

    stack.undo();
    expect(stack.state.items).toEqual(['a', 'b']);

    stack.undo();
    expect(stack.state.items).toEqual(['a']);

    stack.redo();
    expect(stack.state.items).toEqual(['a', 'b']);

    stack.mutate((draft) => {
      draft.items.push('d');
    }, 'Add d instead');

    expect(stack.state.items).toEqual(['a', 'b', 'd']);
    expect(stack.canRedo).toBe(false); // Future was cleared
  });
});
