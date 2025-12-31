/**
 * Main App component - wires up data fetching, SSE, and layout.
 */

import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { StoreProvider, useAppState, useDispatch } from './store';
import { fetchColumns, fetchEdges, fetchStats, connectSSE } from './api';
import { Sidebar } from './components/Sidebar';
import { DAGGraph } from './components/DAGGraph';
import { Inspector } from './components/Inspector';
import './App.css';

function AppContent() {
  const dispatch = useDispatch();
  const { currentTable } = useAppState();

  // Fetch initial data
  useEffect(() => {
    async function loadData() {
      dispatch({ type: 'SET_LOADING', payload: true });

      try {
        // Fetch edges once (they're shared between tables)
        const edgesData = await fetchEdges();
        dispatch({
          type: 'SET_EDGES',
          payload: edgesData.map(e => ({
            id: e.data.id,
            source: e.data.source,
            target: e.data.target,
          })),
        });

        // Fetch columns and stats for current table
        const [columns, statsData] = await Promise.all([
          fetchColumns(currentTable),
          fetchStats(currentTable),
        ]);

        dispatch({ type: 'SET_COLUMNS', payload: columns });
        dispatch({ type: 'SET_STATS', payload: statsData.stats });
      } catch (e) {
        console.error('Failed to load data:', e);
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }

    loadData();
  }, [currentTable, dispatch]);

  // SSE connection
  useEffect(() => {
    const disconnect = connectSSE(
      (event) => {
        if (event.type === 'column-updated') {
          dispatch({
            type: 'UPDATE_COLUMN',
            payload: event.data,
          });
          // Also refresh stats
          fetchStats(currentTable).then(s => {
            dispatch({ type: 'SET_STATS', payload: s.stats });
          });
        } else if (event.type === 'bulk-updated') {
          // Refetch all data
          fetchColumns(currentTable).then(cols => {
            dispatch({ type: 'SET_COLUMNS', payload: cols });
          });
          fetchStats(currentTable).then(s => {
            dispatch({ type: 'SET_STATS', payload: s.stats });
          });
        }
      },
      () => dispatch({ type: 'SET_CONNECTED', payload: true }),
      () => dispatch({ type: 'SET_CONNECTED', payload: false })
    );

    return disconnect;
  }, [currentTable, dispatch]);

  return (
    <div className="app">
      <Sidebar />
      <main className="graph-container">
        <DAGGraph />
      </main>
      <Inspector />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ReactFlowProvider>
        <AppContent />
      </ReactFlowProvider>
    </StoreProvider>
  );
}
