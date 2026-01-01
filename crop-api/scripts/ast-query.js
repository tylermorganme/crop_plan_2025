#!/usr/bin/env node
/**
 * AST Query Tool
 *
 * Answers structural questions about TypeScript code.
 *
 * Usage:
 *   node scripts/ast-query.js "Plan"                    # Find interface/type Plan
 *   node scripts/ast-query.js "validatePlan"            # Find function validatePlan
 *   node scripts/ast-query.js "Plan" --expand           # Show nested types too
 *   node scripts/ast-query.js "validatePlan" --callers  # Show what calls it
 *
 * Output is compact and greppable.
 */

const ts = require('typescript');
const path = require('path');
const fs = require('fs');

// Parse command line args
const args = process.argv.slice(2);
const query = args.find(a => !a.startsWith('--'));
const expand = args.includes('--expand');
const showCallers = args.includes('--callers');

if (!query) {
  console.log(`Usage: node ast-query.js <name> [--expand] [--callers]

Examples:
  node ast-query.js "Plan"           # Find interface Plan
  node ast-query.js "validatePlan"   # Find function validatePlan
  node ast-query.js "CropConfig" --expand  # Show with nested types`);
  process.exit(1);
}

// Find tsconfig.json
const projectRoot = path.resolve(__dirname, '..');
const tsconfigPath = path.join(projectRoot, 'tsconfig.json');

if (!fs.existsSync(tsconfigPath)) {
  console.error(`tsconfig.json not found at ${tsconfigPath}`);
  process.exit(1);
}

// Parse tsconfig
const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  projectRoot
);

// Create program
const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const checker = program.getTypeChecker();

// Results
const found = [];
const callers = [];

// Helper: get relative path
function relPath(fileName) {
  return path.relative(projectRoot, fileName);
}

// Helper: get line number
function getLine(node) {
  const sourceFile = node.getSourceFile();
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return line + 1;
}

// Helper: format type as string
function typeToString(type, depth = 0) {
  if (depth > 2) return '...';

  const typeStr = checker.typeToString(type);

  // Don't expand primitives or common types
  if (['string', 'number', 'boolean', 'null', 'undefined', 'void', 'any', 'unknown'].includes(typeStr)) {
    return typeStr;
  }

  return typeStr;
}

// Helper: format interface members
function formatInterfaceMembers(node, indent = '  ') {
  const lines = [];

  if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
    const members = node.members || [];
    for (const member of members) {
      if (ts.isPropertySignature(member)) {
        const name = member.name.getText();
        const optional = member.questionToken ? '?' : '';
        const type = member.type ? member.type.getText() : 'any';
        lines.push(`${indent}${name}${optional}: ${type}`);
      } else if (ts.isMethodSignature(member)) {
        const name = member.name.getText();
        lines.push(`${indent}${name}(): ...`);
      }
    }
  }

  return lines;
}

// Helper: format function signature
function formatFunctionSignature(node) {
  const name = node.name ? node.name.getText() : '<anonymous>';
  const params = node.parameters.map(p => {
    const pName = p.name.getText();
    const pType = p.type ? p.type.getText() : 'any';
    const optional = p.questionToken ? '?' : '';
    return `${pName}${optional}: ${pType}`;
  }).join(', ');
  const returnType = node.type ? node.type.getText() : 'void';
  return `${name}(${params}): ${returnType}`;
}

// Walk the AST looking for declarations
function visit(node) {
  // Check for matching interface
  if (ts.isInterfaceDeclaration(node)) {
    const name = node.name.getText();
    if (name === query || name.toLowerCase().includes(query.toLowerCase())) {
      const sourceFile = node.getSourceFile();
      const location = `${relPath(sourceFile.fileName)}:${getLine(node)}`;

      found.push({
        kind: 'interface',
        name,
        location,
        members: formatInterfaceMembers(node),
      });
    }
  }

  // Check for matching type alias
  if (ts.isTypeAliasDeclaration(node)) {
    const name = node.name.getText();
    if (name === query || name.toLowerCase().includes(query.toLowerCase())) {
      const sourceFile = node.getSourceFile();
      const location = `${relPath(sourceFile.fileName)}:${getLine(node)}`;

      const typeNode = node.type;
      let members = [];
      if (ts.isTypeLiteralNode(typeNode)) {
        members = formatInterfaceMembers(typeNode);
      }

      found.push({
        kind: 'type',
        name,
        location,
        typeText: typeNode.getText().substring(0, 100),
        members,
      });
    }
  }

  // Check for matching function
  if (ts.isFunctionDeclaration(node) && node.name) {
    const name = node.name.getText();
    if (name === query || name.toLowerCase().includes(query.toLowerCase())) {
      const sourceFile = node.getSourceFile();
      const location = `${relPath(sourceFile.fileName)}:${getLine(node)}`;

      found.push({
        kind: 'function',
        name,
        location,
        signature: formatFunctionSignature(node),
      });
    }
  }

  // Check for exported const functions (arrow functions)
  if (ts.isVariableStatement(node)) {
    const declarations = node.declarationList.declarations;
    for (const decl of declarations) {
      if (ts.isIdentifier(decl.name)) {
        const name = decl.name.getText();
        if (name === query || name.toLowerCase().includes(query.toLowerCase())) {
          if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            const sourceFile = node.getSourceFile();
            const location = `${relPath(sourceFile.fileName)}:${getLine(node)}`;

            found.push({
              kind: 'const function',
              name,
              location,
              signature: decl.type ? decl.type.getText() : '(arrow function)',
            });
          }
        }
      }
    }
  }

  // Look for callers if --callers flag
  if (showCallers && ts.isCallExpression(node)) {
    const expression = node.expression;
    if (ts.isIdentifier(expression) && expression.getText() === query) {
      const sourceFile = node.getSourceFile();
      const location = `${relPath(sourceFile.fileName)}:${getLine(node)}`;
      callers.push(location);
    }
    // Also check property access (obj.method())
    if (ts.isPropertyAccessExpression(expression) && expression.name.getText() === query) {
      const sourceFile = node.getSourceFile();
      const location = `${relPath(sourceFile.fileName)}:${getLine(node)}`;
      callers.push(location);
    }
  }

  ts.forEachChild(node, visit);
}

// Process all source files
for (const sourceFile of program.getSourceFiles()) {
  // Skip node_modules and .d.ts files
  if (sourceFile.fileName.includes('node_modules')) continue;
  if (sourceFile.fileName.endsWith('.d.ts')) continue;

  visit(sourceFile);
}

// Output results
if (found.length === 0 && callers.length === 0) {
  console.log(`No matches for "${query}"`);
  process.exit(0);
}

for (const item of found) {
  console.log(`\n${item.kind}: ${item.name} (${item.location})`);

  if (item.signature) {
    console.log(`  ${item.signature}`);
  }

  if (item.typeText && !item.members.length) {
    console.log(`  = ${item.typeText}...`);
  }

  if (item.members && item.members.length > 0) {
    for (const member of item.members) {
      console.log(member);
    }
  }
}

if (showCallers && callers.length > 0) {
  console.log(`\nCallers of ${query}:`);
  const unique = [...new Set(callers)].sort();
  for (const loc of unique) {
    console.log(`  ${loc}`);
  }
}

if (showCallers && callers.length === 0 && found.length > 0) {
  console.log(`\nNo callers found for ${query}`);
}
