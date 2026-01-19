#!/usr/bin/env node
/**
 * Add seed source data to bed-template.json
 *
 * Reads: tmp/seed_sources_from_excel.json
 * Updates: src/data/bed-template.json
 *
 * Adds seedSourceName and seedSourceSupplier fields to each assignment.
 */

const fs = require('fs');
const path = require('path');

const SEED_SOURCES_PATH = path.join(__dirname, '..', 'tmp', 'seed_sources_from_excel.json');
const BED_PLAN_PATH = path.join(__dirname, '..', 'src', 'data', 'bed-template.json');

function main() {
  // Read seed sources
  console.log('Reading seed sources...');
  if (!fs.existsSync(SEED_SOURCES_PATH)) {
    console.error('ERROR: Run scripts/extract-seed-sources.py first');
    process.exit(1);
  }
  const seedSourcesData = JSON.parse(fs.readFileSync(SEED_SOURCES_PATH, 'utf8'));
  const seedSources = seedSourcesData.seedSources;
  console.log(`  Loaded ${Object.keys(seedSources).length} seed source assignments`);

  // Read bed plan
  console.log('Reading bed plan...');
  const bedPlan = JSON.parse(fs.readFileSync(BED_PLAN_PATH, 'utf8'));
  console.log(`  Loaded ${bedPlan.assignments.length} assignments`);

  // Add seed source info to each assignment
  let matched = 0;
  let unmatched = 0;
  const unmatchedIds = [];

  for (const assignment of bedPlan.assignments) {
    const source = seedSources[assignment.identifier];
    if (source) {
      assignment.seedSourceName = source.variety;
      assignment.seedSourceSupplier = source.supplier;
      assignment.seedSourceIsMix = source.isMix;
      matched++;
    } else {
      unmatched++;
      unmatchedIds.push(assignment.identifier);
    }
  }

  console.log(`\nMatched: ${matched}`);
  console.log(`Unmatched: ${unmatched}`);

  if (unmatchedIds.length > 0 && unmatchedIds.length <= 20) {
    console.log('Unmatched identifiers:', unmatchedIds.join(', '));
  }

  // Write updated bed plan
  fs.writeFileSync(BED_PLAN_PATH, JSON.stringify(bedPlan, null, 2) + '\n');
  console.log(`\nWrote ${BED_PLAN_PATH}`);

  // Show some examples
  console.log('\nSample updated assignments:');
  bedPlan.assignments.slice(0, 5).forEach(a => {
    const type = a.seedSourceIsMix ? 'MIX' : 'VAR';
    const supplier = a.seedSourceSupplier || '-';
    console.log(`  ${a.identifier}: [${type}] ${a.seedSourceName || 'NONE'} (${supplier})`);
  });
}

main();
