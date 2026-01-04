#!/usr/bin/env node

/**
 * Code quality check: Detects z-index values that don't use the Z_INDEX enum.
 *
 * This script scans the codebase for hardcoded z-index values that should use
 * the centralized Z_INDEX constants from src/lib/z-index.ts.
 *
 * Usage: node scripts/check-z-index.js
 *
 * Exit codes:
 *   0 - All z-indices use the enum
 *   1 - Found hardcoded z-index values
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const Z_INDEX_FILE = 'src/lib/z-index.ts';

// Patterns that indicate hardcoded z-index values
const PATTERNS = [
  // Tailwind classes: z-10, z-50, z-[100]
  /\bz-\d+\b/g,
  /\bz-\[\d+\]/g,
  // Inline styles: zIndex: 50, zIndex: "50"
  /zIndex:\s*["']?\d+["']?/g,
  // CSS-in-JS: 'z-index': 50, zIndex: 50
  /['"]?z-index['"]?\s*:\s*["']?\d+["']?/g,
];

// Files/patterns to skip
const SKIP_PATTERNS = [
  /node_modules/,
  /\.next/,
  /dist/,
  Z_INDEX_FILE, // Skip the z-index definition file itself
  /\.d\.ts$/,
  /\.json$/,
  /\.md$/,
];

function shouldSkip(filePath) {
  return SKIP_PATTERNS.some(pattern => {
    if (typeof pattern === 'string') {
      return filePath.includes(pattern);
    }
    return pattern.test(filePath);
  });
}

function findFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (shouldSkip(fullPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      findFiles(fullPath, files);
    } else if (/\.(tsx?|jsx?|css)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    for (const pattern of PATTERNS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(line)) !== null) {
        violations.push({
          file: path.relative(process.cwd(), filePath),
          line: lineNum + 1,
          column: match.index + 1,
          match: match[0],
          context: line.trim(),
        });
      }
    }
  }

  return violations;
}

function main() {
  console.log('Checking for hardcoded z-index values...\n');

  const files = findFiles(SRC_DIR);
  const allViolations = [];

  for (const file of files) {
    const violations = checkFile(file);
    allViolations.push(...violations);
  }

  if (allViolations.length === 0) {
    console.log('✓ All z-index values use the Z_INDEX enum.\n');
    console.log(`Checked ${files.length} files.`);
    process.exit(0);
  }

  console.log(`✗ Found ${allViolations.length} hardcoded z-index value(s):\n`);

  // Group by file
  const byFile = {};
  for (const v of allViolations) {
    if (!byFile[v.file]) {
      byFile[v.file] = [];
    }
    byFile[v.file].push(v);
  }

  for (const [file, violations] of Object.entries(byFile)) {
    console.log(`${file}:`);
    for (const v of violations) {
      console.log(`  Line ${v.line}: ${v.match}`);
      console.log(`    ${v.context}`);
    }
    console.log();
  }

  console.log('Fix: Import Z_INDEX from "@/lib/z-index" and use the appropriate constant.');
  console.log('     e.g., z-50 → style={{ zIndex: Z_INDEX.MODAL }}');

  process.exit(1);
}

main();
