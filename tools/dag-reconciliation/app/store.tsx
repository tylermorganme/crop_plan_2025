'use client';

/**
 * Application state store using React context + useReducer.
 * Single source of truth for all UI state.
 * UI preferences (filters, table, selection) persist to localStorage.
 */

import { createContext, useContext, useReducer, useEffect } from 'react';
import type { ReactNode, Dispatch } from 'react';

const UI_STATE_KEY = 'dag-reconciliation-ui';

// Types
export type ColumnStatus = 'include' | 'skip' | 'remove' | null;

export interface Column {
  id: string;
  header: string;
  col_num: number;
  col_letter: string;
  table_name: string;
  classification: 'INPUT' | 'CALCULATED' | 'MIXED' | 'EMPTY';
  level: number;
  formula: string | null;
  variance: number;
  formula_count: number;
  value_count: number;
  unique_formulas: number;
  depends_on: string[];
  external_deps: string[];
  // Audit fields
  verified: boolean;
  status: ColumnStatus;  // Replaces remove/skip - null means not yet decided
  has_issue: boolean;
  implemented: boolean;
  notes: string;
  code_field: string | null;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
}

export interface Stats {
  total: number;
  verified: number;
  pending: number;
  issues: number;
  removed: number;
}

export type StatusFilter = 'all' | 'pending' | 'verified' | 'unverified' | 'issues' | 'skip' | 'remove';
export type TypeFilter = 'INPUT' | 'CALCULATED' | 'MIXED' | 'variance' | null;

export interface AppState {
  // Data
  columns: Column[];
  edges: Edge[];
  stats: Stats;

  // UI State
  currentTable: 'crops' | 'bedplan';
  selectedColumnId: string | null;
  statusFilter: StatusFilter;
  typeFilter: TypeFilter;
  levelFilter: number | null;

  // Connection
  connected: boolean;
  loading: boolean;
}

// Actions
export type Action =
  | { type: 'SET_COLUMNS'; payload: Column[] }
  | { type: 'SET_EDGES'; payload: Edge[] }
  | { type: 'SET_STATS'; payload: Stats }
  | { type: 'SET_TABLE'; payload: 'crops' | 'bedplan' }
  | { type: 'SELECT_COLUMN'; payload: string | null }
  | { type: 'SET_STATUS_FILTER'; payload: StatusFilter }
  | { type: 'SET_TYPE_FILTER'; payload: TypeFilter }
  | { type: 'SET_LEVEL_FILTER'; payload: number | null }
  | { type: 'UPDATE_COLUMN'; payload: Partial<Column> & { id: string } }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean };

// Initial state
const initialState: AppState = {
  columns: [],
  edges: [],
  stats: { total: 0, verified: 0, pending: 0, issues: 0, removed: 0 },
  currentTable: 'crops',
  selectedColumnId: null,
  statusFilter: 'all',
  typeFilter: null,
  levelFilter: null,
  connected: false,
  loading: true,
};

// UI state that we persist to localStorage
interface PersistedUIState {
  currentTable: 'crops' | 'bedplan';
  selectedColumnId: string | null;
  statusFilter: StatusFilter;
  typeFilter: TypeFilter;
  levelFilter: number | null;
}

function loadPersistedState(): Partial<PersistedUIState> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(UI_STATE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

function savePersistedState(state: AppState) {
  const toSave: PersistedUIState = {
    currentTable: state.currentTable,
    selectedColumnId: state.selectedColumnId,
    statusFilter: state.statusFilter,
    typeFilter: state.typeFilter,
    levelFilter: state.levelFilter,
  };
  localStorage.setItem(UI_STATE_KEY, JSON.stringify(toSave));
}

// Reducer
function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_COLUMNS':
      return { ...state, columns: action.payload, loading: false };

    case 'SET_EDGES':
      return { ...state, edges: action.payload };

    case 'SET_STATS':
      return { ...state, stats: action.payload };

    case 'SET_TABLE':
      return {
        ...state,
        currentTable: action.payload,
        selectedColumnId: null,
        loading: true,
      };

    case 'SELECT_COLUMN':
      return { ...state, selectedColumnId: action.payload };

    case 'SET_STATUS_FILTER':
      return { ...state, statusFilter: action.payload };

    case 'SET_TYPE_FILTER':
      return { ...state, typeFilter: action.payload };

    case 'SET_LEVEL_FILTER':
      return { ...state, levelFilter: action.payload };

    case 'UPDATE_COLUMN': {
      const newColumns = state.columns.map(col =>
        col.id === action.payload.id ? { ...col, ...action.payload } : col
      );
      return { ...state, columns: newColumns };
    }

    case 'SET_CONNECTED':
      return { ...state, connected: action.payload };

    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    default:
      return state;
  }
}

// Context
const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);

// Provider component
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Load persisted UI state after mount (avoids hydration mismatch)
  useEffect(() => {
    const persisted = loadPersistedState();
    if (persisted.currentTable) {
      dispatch({ type: 'SET_TABLE', payload: persisted.currentTable });
    }
    if (persisted.statusFilter) {
      dispatch({ type: 'SET_STATUS_FILTER', payload: persisted.statusFilter });
    }
    if (persisted.typeFilter !== undefined) {
      dispatch({ type: 'SET_TYPE_FILTER', payload: persisted.typeFilter });
    }
    if (persisted.levelFilter !== undefined) {
      dispatch({ type: 'SET_LEVEL_FILTER', payload: persisted.levelFilter });
    }
    if (persisted.selectedColumnId) {
      dispatch({ type: 'SELECT_COLUMN', payload: persisted.selectedColumnId });
    }
  }, []);

  // Save UI state to localStorage whenever it changes
  useEffect(() => {
    savePersistedState(state);
  }, [state.currentTable, state.selectedColumnId, state.statusFilter, state.typeFilter, state.levelFilter]);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}

// Hooks
export function useAppState() {
  const state = useContext(StateContext);
  if (!state) throw new Error('useAppState must be used within StoreProvider');
  return state;
}

export function useDispatch() {
  const dispatch = useContext(DispatchContext);
  if (!dispatch) throw new Error('useDispatch must be used within StoreProvider');
  return dispatch;
}

// Selector hooks
export function useSelectedColumn() {
  const { columns, selectedColumnId } = useAppState();
  return columns.find(c => c.id === selectedColumnId) || null;
}

export function useLevels() {
  const { columns } = useAppState();
  return [...new Set(columns.map(c => c.level))].sort((a, b) => a - b);
}
