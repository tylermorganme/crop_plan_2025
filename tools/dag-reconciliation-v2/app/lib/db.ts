/**
 * Database singleton for the DAG reconciliation tool.
 * Uses better-sqlite3 for synchronous SQLite access.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Database path - store in the dag-reconciliation directory alongside graph-data.json
const DB_PATH = path.join(process.cwd(), '..', 'dag-reconciliation', 'reconciliation.db');
const GRAPH_DATA_PATH = path.join(process.cwd(), '..', 'dag-reconciliation', 'graph-data.json');

// Singleton database instance
let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS columns (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        col_num INTEGER NOT NULL,
        col_letter TEXT,
        header TEXT NOT NULL,
        classification TEXT,
        level INTEGER,
        formula TEXT,
        variance REAL DEFAULT 0,
        formula_count INTEGER DEFAULT 0,
        value_count INTEGER DEFAULT 0,
        unique_formulas INTEGER DEFAULT 0,
        depends_on TEXT,
        external_deps TEXT,
        is_leaf INTEGER DEFAULT 0,
        is_root INTEGER DEFAULT 0,
        -- Audit fields
        verified INTEGER DEFAULT 0,
        remove INTEGER DEFAULT 0,
        has_issue INTEGER DEFAULT 0,
        implemented INTEGER DEFAULT 0,
        skip INTEGER DEFAULT 0,
        notes TEXT DEFAULT '',
        code_field TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_table ON columns(table_name);
      CREATE INDEX IF NOT EXISTS idx_level ON columns(level);
    `);

    // Migration: add skip column if it doesn't exist
    try {
      db.exec(`ALTER TABLE columns ADD COLUMN skip INTEGER DEFAULT 0`);
    } catch {
      // Column already exists
    }

    // Seed database if empty
    seedDatabase(db);
  }

  return db;
}

function seedDatabase(db: Database.Database) {
  const count = db.prepare('SELECT COUNT(*) as count FROM columns').get() as { count: number };
  if (count.count > 0) {
    return;
  }

  if (!fs.existsSync(GRAPH_DATA_PATH)) {
    console.log('No graph-data.json found at', GRAPH_DATA_PATH);
    return;
  }

  const graphData = JSON.parse(fs.readFileSync(GRAPH_DATA_PATH, 'utf-8'));
  const insert = db.prepare(`
    INSERT OR REPLACE INTO columns (
      id, table_name, col_num, col_letter, header, classification, level,
      formula, variance, formula_count, value_count, unique_formulas,
      depends_on, external_deps, is_leaf, is_root
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((nodes: Array<{ data: Record<string, unknown> }>) => {
    for (const node of nodes) {
      const d = node.data;
      insert.run(
        d.id,
        d.table,
        d.col,
        d.colLetter || '',
        d.label,
        d.classification,
        d.level,
        d.formula || '',
        d.variance || 0,
        d.formulaCount || 0,
        d.valueCount || 0,
        d.uniqueFormulas || 0,
        JSON.stringify(d.dependsOnNames || []),
        JSON.stringify(d.externalDeps || []),
        d.isLeaf ? 1 : 0,
        d.isRoot ? 1 : 0
      );
    }
  });

  insertMany(graphData.elements.nodes);
  console.log(`Seeded ${graphData.elements.nodes.length} columns`);
}

export function getGraphEdges(): Array<{ data: { id: string; source: string; target: string } }> {
  if (!fs.existsSync(GRAPH_DATA_PATH)) {
    return [];
  }
  const graphData = JSON.parse(fs.readFileSync(GRAPH_DATA_PATH, 'utf-8'));
  return graphData.elements.edges;
}

// SSE clients management
const sseClients = new Set<ReadableStreamDefaultController>();

export function addSSEClient(controller: ReadableStreamDefaultController) {
  sseClients.add(controller);
}

export function removeSSEClient(controller: ReadableStreamDefaultController) {
  sseClients.delete(controller);
}

export function broadcastUpdate(type: string, data: unknown) {
  const message = `data: ${JSON.stringify({ type, data, timestamp: Date.now() })}\n\n`;
  for (const controller of sseClients) {
    try {
      controller.enqueue(new TextEncoder().encode(message));
    } catch {
      sseClients.delete(controller);
    }
  }
}
