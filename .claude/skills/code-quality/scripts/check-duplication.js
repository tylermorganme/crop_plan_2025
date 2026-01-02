#!/usr/bin/env node
/**
 * Duplication Detection Script
 *
 * Finds copy-pasted code blocks using jscpd.
 * Usage: node check-duplication.js [path] [--threshold N] [--min-lines N]
 */

const { execSync } = require('child_process');
const path = require('path');

// Parse arguments
const args = process.argv.slice(2);
let targetPath = 'src/';
let threshold = 5;
let minLines = 10;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--threshold' && args[i + 1]) {
    threshold = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--min-lines' && args[i + 1]) {
    minLines = parseInt(args[i + 1], 10);
    i++;
  } else if (!args[i].startsWith('--')) {
    targetPath = args[i];
  }
}

console.log(`\n📋 Checking for code duplication in: ${targetPath}`);
console.log(`   Min lines: ${minLines}, Threshold: ${threshold}%\n`);

try {
  // Check if jscpd is available
  try {
    execSync('npx jscpd --version', { stdio: 'pipe' });
  } catch {
    console.log('Installing jscpd...');
    execSync('npm install -g jscpd', { stdio: 'inherit' });
  }

  // Run jscpd
  const cmd = `npx jscpd "${targetPath}" --min-lines ${minLines} --threshold ${threshold} --reporters console`;

  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(output);
    console.log('✅ Duplication check passed');
    process.exit(0);
  } catch (error) {
    // jscpd exits with code 1 if threshold exceeded
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);

    if (error.status === 1) {
      console.log(`\n❌ Duplication exceeds ${threshold}% threshold`);
      process.exit(1);
    }
    throw error;
  }
} catch (error) {
  console.error('Error running duplication check:', error.message);
  process.exit(1);
}
