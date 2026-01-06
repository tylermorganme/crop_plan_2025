/**
 * Formula Dependency Graph (DAG) Walker
 *
 * Walks the dependency graph extracted from Excel formulas to:
 * - Find all inputs needed to compute a field
 * - Identify static inputs (source of truth) vs calculated fields
 * - Determine calculation order
 *
 * Run with: npx tsx src/lib/formula-dag.ts [field]
 */

import formulaData from '../../tools/excel-analysis/formula-analysis.json';
import columnData from '../data/column-analysis.json';

interface FormulaColumn {
  column: string;
  header: string;
  formula: string;
  dependsOnColumns: string[];
  dependsOnConstants: string[];
  dependsOnTables: string[];
}

interface ColumnInfo {
  column: string;
  header: string;
  type: 'static' | 'calculated' | 'mixed' | 'empty';
  datatype: string;
  entity: string;
}

interface FormulaData {
  totalCalculatedColumns: number;
  columns: FormulaColumn[];
}

interface ColumnData {
  columns: ColumnInfo[];
}

// Build lookup maps
const formulaByHeader = new Map<string, FormulaColumn>();
const columnByHeader = new Map<string, ColumnInfo>();

for (const col of (formulaData as FormulaData).columns) {
  formulaByHeader.set(col.header, col);
}

for (const col of (columnData as ColumnData).columns) {
  columnByHeader.set(col.header, col);
}

/**
 * Get the type of a field (static, calculated, mixed, empty)
 */
export function getFieldType(fieldName: string): string {
  const col = columnByHeader.get(fieldName);
  return col?.type ?? 'unknown';
}

/**
 * Get the entity of a field (crop, product, planting, mixed)
 */
export function getFieldEntity(fieldName: string): string {
  const col = columnByHeader.get(fieldName);
  return col?.entity ?? 'unknown';
}

/**
 * Get direct dependencies for a field (one level)
 */
export function getDirectDependencies(fieldName: string): {
  columns: string[];
  constants: string[];
  tables: string[];
} {
  const formula = formulaByHeader.get(fieldName);
  if (!formula) {
    return { columns: [], constants: [], tables: [] };
  }
  return {
    columns: formula.dependsOnColumns,
    constants: formula.dependsOnConstants,
    tables: formula.dependsOnTables,
  };
}

/**
 * Recursively get ALL dependencies for a field (full DAG walk)
 * Returns fields in topological order (dependencies first)
 */
export function getAllDependencies(fieldName: string, visited = new Set<string>()): {
  columns: Set<string>;
  constants: Set<string>;
  tables: Set<string>;
  order: string[];  // Topological order
} {
  const result = {
    columns: new Set<string>(),
    constants: new Set<string>(),
    tables: new Set<string>(),
    order: [] as string[],
  };

  function walk(field: string) {
    if (visited.has(field)) return;
    visited.add(field);

    const deps = getDirectDependencies(field);

    // Add constants and tables
    deps.constants.forEach(c => result.constants.add(c));
    deps.tables.forEach(t => result.tables.add(t));

    // Recursively walk column dependencies
    for (const dep of deps.columns) {
      result.columns.add(dep);
      walk(dep);
    }

    // Add this field to the order (after dependencies)
    result.order.push(field);
  }

  walk(fieldName);
  return result;
}

/**
 * Find all static inputs needed to calculate a field
 * (leaf nodes in the dependency tree)
 */
export function getStaticInputs(fieldName: string): string[] {
  const deps = getAllDependencies(fieldName);
  const staticInputs: string[] = [];

  // The field itself if it has no dependencies
  if (deps.columns.size === 0) {
    const type = getFieldType(fieldName);
    if (type === 'static' || type === 'mixed') {
      return [fieldName];
    }
    return [];
  }

  // Check each dependency
  for (const col of deps.columns) {
    const colDeps = getDirectDependencies(col);
    const type = getFieldType(col);

    // Leaf node: static or has no column dependencies
    if (type === 'static' || colDeps.columns.length === 0) {
      staticInputs.push(col);
    }
  }

  return staticInputs;
}

/**
 * Print dependency tree for a field (for debugging/exploration)
 */
export function printDependencyTree(fieldName: string, indent = 0): void {
  const prefix = '  '.repeat(indent);
  const type = getFieldType(fieldName);
  const entity = getFieldEntity(fieldName);

  console.log(`${prefix}${fieldName} [${type}, ${entity}]`);

  const deps = getDirectDependencies(fieldName);

  if (deps.constants.length > 0) {
    console.log(`${prefix}  constants: ${deps.constants.join(', ')}`);
  }
  if (deps.tables.length > 0) {
    console.log(`${prefix}  tables: ${deps.tables.join(', ')}`);
  }

  for (const col of deps.columns) {
    printDependencyTree(col, indent + 1);
  }
}

/**
 * Get all fields classified as static inputs
 */
export function getAllStaticFields(): string[] {
  return (columnData as ColumnData).columns
    .filter(c => c.type === 'static')
    .map(c => c.header);
}

/**
 * Get all calculated fields
 */
export function getAllCalculatedFields(): string[] {
  return (columnData as ColumnData).columns
    .filter(c => c.type === 'calculated')
    .map(c => c.header);
}

/**
 * Get fields by entity
 */
export function getFieldsByEntity(entity: string): string[] {
  return (columnData as ColumnData).columns
    .filter(c => c.entity === entity)
    .map(c => c.header);
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Show summary
    console.log('='.repeat(60));
    console.log('FORMULA DEPENDENCY GRAPH');
    console.log('='.repeat(60));
    console.log();

    const staticFields = getAllStaticFields();
    const calculatedFields = getAllCalculatedFields();

    console.log(`Static inputs: ${staticFields.length}`);
    console.log(`Calculated fields: ${calculatedFields.length}`);
    console.log();

    // Show key timing fields
    const timingFields = [
      'Target Sewing Date',
      'Target Field Date',
      'Target Harvest Data',
      'Target End of Harvest',
      'STH',
      'DTM',
      'Days in Cells',
      'Harvest window',
    ];

    console.log('KEY TIMING FIELDS:');
    console.log('-'.repeat(40));
    for (const field of timingFields) {
      const type = getFieldType(field);
      const entity = getFieldEntity(field);
      const deps = getDirectDependencies(field);
      console.log(`${field.padEnd(25)} [${type}, ${entity}]`);
      if (deps.columns.length > 0) {
        console.log(`  depends on: ${deps.columns.join(', ')}`);
      }
      if (deps.constants.length > 0) {
        console.log(`  constants: ${deps.constants.join(', ')}`);
      }
    }
    console.log();

    // Show usage
    console.log('Usage: npx tsx src/lib/formula-dag.ts [field]');
    console.log('Example: npx tsx src/lib/formula-dag.ts "Target Harvest Data"');
  } else {
    const fieldName = args.join(' ');

    console.log('='.repeat(60));
    console.log(`DEPENDENCY TREE: ${fieldName}`);
    console.log('='.repeat(60));
    console.log();

    printDependencyTree(fieldName);

    console.log();
    console.log('STATIC INPUTS NEEDED:');
    console.log('-'.repeat(40));
    const inputs = getStaticInputs(fieldName);
    for (const input of inputs) {
      const entity = getFieldEntity(input);
      console.log(`  ${input} [${entity}]`);
    }

    console.log();
    console.log('CALCULATION ORDER:');
    console.log('-'.repeat(40));
    const deps = getAllDependencies(fieldName);
    for (const field of deps.order) {
      const type = getFieldType(field);
      console.log(`  ${field} [${type}]`);
    }

    if (deps.constants.size > 0) {
      console.log();
      console.log('GLOBAL CONSTANTS:');
      console.log('-'.repeat(40));
      for (const c of deps.constants) {
        console.log(`  ${c}`);
      }
    }
  }
}
