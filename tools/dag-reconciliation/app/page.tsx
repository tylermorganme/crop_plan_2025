'use client';

/**
 * DAG Reconciliation Tool - Main Page
 * Visualizes Excel spreadsheet column dependencies for migration.
 */

import { useEffect } from 'react';
import { StoreProvider, useDispatch, useAppState } from './store';
import { fetchColumns, fetchEdges, fetchStats, connectSSE } from './api';
import { DAGGraph } from './components/DAGGraph';
import { Sidebar } from './components/Sidebar';
import { Inspector } from './components/Inspector';
import { ColumnData } from './components/ColumnData';

function AppContent() {
  const dispatch = useDispatch();
  const { currentTable } = useAppState();

  useEffect(() => {
    // Load initial data
    async function loadData() {
      dispatch({ type: 'SET_LOADING', payload: true });

      try {
        const [columns, edgesRaw, statsData] = await Promise.all([
          fetchColumns(currentTable),
          fetchEdges(),
          fetchStats(currentTable),
        ]);

        dispatch({ type: 'SET_COLUMNS', payload: columns });
        dispatch({
          type: 'SET_EDGES',
          payload: edgesRaw.map(e => ({
            id: e.data.id,
            source: e.data.source,
            target: e.data.target,
          })),
        });
        dispatch({ type: 'SET_STATS', payload: statsData.stats });
      } catch (e) {
        console.error('Failed to load data:', e);
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }

    loadData();
  }, [currentTable, dispatch]);

  useEffect(() => {
    // Connect SSE for live updates
    const disconnect = connectSSE(
      (event) => {
        if (event.type === 'column-updated') {
          dispatch({ type: 'UPDATE_COLUMN', payload: event.data });
        }
      },
      () => dispatch({ type: 'SET_CONNECTED', payload: true }),
      () => dispatch({ type: 'SET_CONNECTED', payload: false })
    );

    return disconnect;
  }, [dispatch]);

  return (
    <div className="flex w-full h-screen overflow-hidden">
      <Sidebar />
      <DAGGraph />
      <Inspector />
      <ColumnData />
    </div>
  );
}

export default function Home() {
  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  );
}
