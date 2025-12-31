const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3456;

// Initialize SQLite database
const db = new Database(path.join(__dirname, 'reconciliation.db'));

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
    notes TEXT DEFAULT '',
    code_field TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_table ON columns(table_name);
  CREATE INDEX IF NOT EXISTS idx_level ON columns(level);
`);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Load graph data and seed DB if empty
function seedDatabase() {
  const count = db.prepare('SELECT COUNT(*) as count FROM columns').get().count;
  if (count > 0) {
    console.log(`Database has ${count} columns`);
    return;
  }

  const graphPath = path.join(__dirname, 'graph-data.json');
  if (!fs.existsSync(graphPath)) {
    console.log('No graph-data.json found, run build-cytoscape-graph.js first');
    return;
  }

  const graphData = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  const insert = db.prepare(`
    INSERT OR REPLACE INTO columns (
      id, table_name, col_num, col_letter, header, classification, level,
      formula, variance, formula_count, value_count, unique_formulas,
      depends_on, external_deps, is_leaf, is_root
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((nodes) => {
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

// API Routes

// Get all columns for a table
app.get('/api/columns', (req, res) => {
  const { table, level, classification, status } = req.query;

  let sql = 'SELECT * FROM columns WHERE 1=1';
  const params = [];

  if (table) {
    sql += ' AND table_name = ?';
    params.push(table === 'crops' ? 'Crops' : 'BedPlan');
  }
  if (level !== undefined) {
    sql += ' AND level = ?';
    params.push(parseInt(level));
  }
  if (classification) {
    sql += ' AND classification = ?';
    params.push(classification);
  }
  if (status === 'pending') {
    sql += ' AND verified = 0 AND remove = 0 AND has_issue = 0';
  } else if (status === 'verified') {
    sql += ' AND verified = 1';
  } else if (status === 'issues') {
    sql += ' AND has_issue = 1';
  } else if (status === 'remove') {
    sql += ' AND remove = 1';
  }

  sql += ' ORDER BY col_num';

  const rows = db.prepare(sql).all(...params);

  // Parse JSON fields
  rows.forEach(row => {
    row.depends_on = JSON.parse(row.depends_on || '[]');
    row.external_deps = JSON.parse(row.external_deps || '[]');
  });

  res.json(rows);
});

// Get single column
app.get('/api/columns/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM columns WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  row.depends_on = JSON.parse(row.depends_on || '[]');
  row.external_deps = JSON.parse(row.external_deps || '[]');
  res.json(row);
});

// Update column audit state
app.patch('/api/columns/:id', (req, res) => {
  const { verified, remove, has_issue, implemented, notes, code_field } = req.body;

  const updates = [];
  const params = [];

  if (verified !== undefined) { updates.push('verified = ?'); params.push(verified ? 1 : 0); }
  if (remove !== undefined) { updates.push('remove = ?'); params.push(remove ? 1 : 0); }
  if (has_issue !== undefined) { updates.push('has_issue = ?'); params.push(has_issue ? 1 : 0); }
  if (implemented !== undefined) { updates.push('implemented = ?'); params.push(implemented ? 1 : 0); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (code_field !== undefined) { updates.push('code_field = ?'); params.push(code_field); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);

  const sql = `UPDATE columns SET ${updates.join(', ')} WHERE id = ?`;
  const result = db.prepare(sql).run(...params);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.json({ success: true });
});

// Bulk update
app.post('/api/columns/bulk', (req, res) => {
  const { ids, ...fields } = req.body;

  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: 'ids array required' });
  }

  const updates = [];
  const baseParams = [];

  if (fields.verified !== undefined) { updates.push('verified = ?'); baseParams.push(fields.verified ? 1 : 0); }
  if (fields.remove !== undefined) { updates.push('remove = ?'); baseParams.push(fields.remove ? 1 : 0); }
  if (fields.has_issue !== undefined) { updates.push('has_issue = ?'); baseParams.push(fields.has_issue ? 1 : 0); }
  if (fields.implemented !== undefined) { updates.push('implemented = ?'); baseParams.push(fields.implemented ? 1 : 0); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');

  const placeholders = ids.map(() => '?').join(',');
  const sql = `UPDATE columns SET ${updates.join(', ')} WHERE id IN (${placeholders})`;

  const result = db.prepare(sql).run(...baseParams, ...ids);
  res.json({ success: true, updated: result.changes });
});

// Get stats
app.get('/api/stats', (req, res) => {
  const { table } = req.query;

  let whereClause = '';
  const params = [];
  if (table) {
    whereClause = 'WHERE table_name = ?';
    params.push(table === 'crops' ? 'Crops' : 'BedPlan');
  }

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(verified) as verified,
      SUM(remove) as removed,
      SUM(has_issue) as issues,
      SUM(implemented) as implemented,
      COUNT(*) - SUM(verified) - SUM(remove) - SUM(has_issue) as pending
    FROM columns ${whereClause}
  `).get(...params);

  const byLevel = db.prepare(`
    SELECT level, COUNT(*) as count,
      SUM(verified) as verified,
      SUM(remove) as removed
    FROM columns ${whereClause}
    GROUP BY level ORDER BY level
  `).all(...params);

  const byClassification = db.prepare(`
    SELECT classification, COUNT(*) as count,
      SUM(verified) as verified,
      SUM(remove) as removed
    FROM columns ${whereClause}
    GROUP BY classification
  `).all(...params);

  res.json({ stats, byLevel, byClassification });
});

// Get edges for graph
app.get('/api/edges', (req, res) => {
  const graphPath = path.join(__dirname, 'graph-data.json');
  if (!fs.existsSync(graphPath)) {
    return res.json([]);
  }
  const graphData = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  res.json(graphData.elements.edges);
});

// Reset database (re-seed from graph-data.json)
app.post('/api/reset', (req, res) => {
  db.prepare('DELETE FROM columns').run();
  seedDatabase();
  res.json({ success: true });
});

// Start server
seedDatabase();
app.listen(PORT, () => {
  console.log(`DAG Reconciliation server running at http://localhost:${PORT}`);
  console.log(`\nAPI endpoints:`);
  console.log(`  GET  /api/columns?table=crops&level=0&status=pending`);
  console.log(`  GET  /api/columns/:id`);
  console.log(`  PATCH /api/columns/:id  { verified, remove, has_issue, notes }`);
  console.log(`  POST /api/columns/bulk  { ids: [...], verified: true }`);
  console.log(`  GET  /api/stats?table=crops`);
  console.log(`  GET  /api/edges`);
  console.log(`  POST /api/reset`);
});
