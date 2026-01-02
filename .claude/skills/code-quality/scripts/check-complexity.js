#!/usr/bin/env node
/**
 * Complexity Analysis Script
 *
 * Reports functions exceeding cyclomatic complexity thresholds.
 * Uses a simple heuristic based on control flow statements.
 *
 * Usage: node check-complexity.js [path] [--max-complexity N]
 */

const fs = require('fs');
const path = require('path');

// Parse arguments
const args = process.argv.slice(2);
let targetPath = 'src/';
let maxComplexity = 10;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max-complexity' && args[i + 1]) {
    maxComplexity = parseInt(args[i + 1], 10);
    i++;
  } else if (!args[i].startsWith('--')) {
    targetPath = args[i];
  }
}

console.log(`\n🔍 Checking code complexity in: ${targetPath}`);
console.log(`   Max complexity threshold: ${maxComplexity}\n`);

// Control flow keywords that increase complexity
const complexityKeywords = [
  /\bif\s*\(/g,
  /\belse\s+if\s*\(/g,
  /\bfor\s*\(/g,
  /\bwhile\s*\(/g,
  /\bswitch\s*\(/g,
  /\bcase\s+/g,
  /\bcatch\s*\(/g,
  /\?\s*[^:]+\s*:/g,  // Ternary operator
  /&&/g,
  /\|\|/g,
];

// File extensions to check
const extensions = ['.ts', '.tsx', '.js', '.jsx'];

// Results
const complexFunctions = [];

function countComplexity(code) {
  let complexity = 1; // Base complexity
  for (const pattern of complexityKeywords) {
    const matches = code.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }
  return complexity;
}

function extractFunctions(content, filePath) {
  const results = [];

  // Match function declarations and arrow functions
  // This is a simplified heuristic - not a full parser
  const functionPatterns = [
    // function name() { ... }
    /function\s+(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g,
    // const name = (...) => { ... }
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>\s*\{/g,
    // const name = function() { ... }
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?function\s*\([^)]*\)\s*\{/g,
    // Method: name() { ... } or name: function() { ... }
    /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/gm,
  ];

  // Split into lines for tracking
  const lines = content.split('\n');

  for (const pattern of functionPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const funcName = match[1];
      const startIndex = match.index;

      // Find the function body by counting braces
      let braceCount = 0;
      let inString = false;
      let stringChar = '';
      let bodyStart = content.indexOf('{', startIndex);
      let bodyEnd = bodyStart;

      for (let i = bodyStart; i < content.length; i++) {
        const char = content[i];
        const prevChar = content[i - 1];

        // Handle strings
        if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            inString = false;
          }
        }

        if (!inString) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
          if (braceCount === 0) {
            bodyEnd = i;
            break;
          }
        }
      }

      const body = content.substring(bodyStart, bodyEnd + 1);
      const complexity = countComplexity(body);

      // Get line number
      const lineNumber = content.substring(0, startIndex).split('\n').length;

      if (complexity > maxComplexity) {
        results.push({
          name: funcName,
          file: filePath,
          line: lineNumber,
          complexity,
        });
      }
    }
  }

  return results;
}

function walkDirectory(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`❌ Directory not found: ${dir}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules and hidden directories
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        walkDirectory(fullPath);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (extensions.includes(ext)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const results = extractFunctions(content, fullPath);
        complexFunctions.push(...results);
      }
    }
  }
}

// Run analysis
walkDirectory(targetPath);

// Sort by complexity (highest first)
complexFunctions.sort((a, b) => b.complexity - a.complexity);

// Output results
if (complexFunctions.length === 0) {
  console.log(`✅ No functions exceed complexity threshold of ${maxComplexity}`);
  process.exit(0);
}

console.log(`Found ${complexFunctions.length} functions exceeding threshold:\n`);
console.log('Complexity | File:Line | Function');
console.log('-'.repeat(60));

for (const func of complexFunctions) {
  const relPath = path.relative(process.cwd(), func.file);
  console.log(`    ${String(func.complexity).padStart(2)}     | ${relPath}:${func.line} | ${func.name}`);
}

console.log(`\n⚠️  ${complexFunctions.length} functions exceed complexity threshold of ${maxComplexity}`);
console.log('Consider refactoring these functions to reduce complexity.');
process.exit(0); // Warning, not failure
