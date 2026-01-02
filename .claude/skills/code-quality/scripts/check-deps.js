#!/usr/bin/env node
/**
 * Unused Dependencies Detection Script
 *
 * Finds packages in package.json that aren't imported anywhere.
 * Usage: node check-deps.js [path]
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Parse arguments
const args = process.argv.slice(2);
let targetPath = '.';

for (const arg of args) {
  if (!arg.startsWith('--')) {
    targetPath = arg;
  }
}

// Resolve to absolute path
targetPath = path.resolve(targetPath);

const packageJsonPath = path.join(targetPath, 'package.json');

if (!fs.existsSync(packageJsonPath)) {
  console.error(`❌ No package.json found at: ${packageJsonPath}`);
  process.exit(1);
}

console.log(`\n📦 Checking for unused dependencies in: ${targetPath}\n`);

try {
  // Check if depcheck is available
  try {
    execSync('npx depcheck --version', { stdio: 'pipe' });
  } catch {
    console.log('Installing depcheck...');
    execSync('npm install -g depcheck', { stdio: 'inherit' });
  }

  // Run depcheck with common ignores for Next.js projects
  const ignores = [
    '@types/*',
    'typescript',
    'eslint',
    'eslint-*',
    'prettier',
    'autoprefixer',
    'postcss',
    'tailwindcss',
  ].join(',');

  const cmd = `npx depcheck "${targetPath}" --ignores="${ignores}"`;

  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      cwd: targetPath,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(output || 'No unused dependencies found.');
    console.log('\n✅ Dependency check passed');
    process.exit(0);
  } catch (error) {
    // depcheck outputs to stdout even on "failure" (unused deps found)
    if (error.stdout) {
      console.log(error.stdout);

      // Check if there are actually unused deps
      const hasUnused = error.stdout.includes('Unused dependencies') ||
                        error.stdout.includes('Unused devDependencies');

      if (hasUnused) {
        console.log('\n⚠️  Unused dependencies found (review above)');
        // Exit 0 - unused deps are warnings, not failures
        process.exit(0);
      }
    }
    if (error.stderr) console.error(error.stderr);
    throw error;
  }
} catch (error) {
  console.error('Error running dependency check:', error.message);
  process.exit(1);
}
