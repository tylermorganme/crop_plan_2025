#!/usr/bin/env node
/**
 * Setup script for browser-testing skill
 *
 * Creates output directory and ensures .gitignore is in place.
 * Run this after npm install.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, '.claude-playwright');
const GITIGNORE_PATH = path.join(PROJECT_ROOT, '.gitignore');
const GITIGNORE_ENTRY = '.claude-playwright/';

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Created output directory: ${OUTPUT_DIR}`);
} else {
  console.log(`Output directory exists: ${OUTPUT_DIR}`);
}

// Add to .gitignore if not present
if (fs.existsSync(GITIGNORE_PATH)) {
  const content = fs.readFileSync(GITIGNORE_PATH, 'utf8');
  if (!content.includes(GITIGNORE_ENTRY)) {
    const newContent = content.trimEnd() + '\n\n# Browser testing skill output\n' + GITIGNORE_ENTRY + '\n';
    fs.writeFileSync(GITIGNORE_PATH, newContent);
    console.log(`Added ${GITIGNORE_ENTRY} to .gitignore`);
  } else {
    console.log(`.gitignore already contains ${GITIGNORE_ENTRY}`);
  }
} else {
  // Create .gitignore with entry
  fs.writeFileSync(GITIGNORE_PATH, `# Browser testing skill output\n${GITIGNORE_ENTRY}\n`);
  console.log(`Created .gitignore with ${GITIGNORE_ENTRY}`);
}

console.log('Setup complete.');
