#!/usr/bin/env node
/**
 * Convert bed-template.json from bedsCount (fractions of 50ft) to bedFeet (actual feet).
 *
 * This is a one-time migration script to clean up legacy Excel import format.
 *
 * Usage: node scripts/convert-bedscount-to-bedfeet.js
 */

const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '../src/data/bed-template.json');
const LEGACY_BED_FT = 50;

function main() {
  console.log('Reading bed-template.json...');
  const data = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf-8'));

  if (!data.assignments || !Array.isArray(data.assignments)) {
    console.error('No assignments array found in template');
    process.exit(1);
  }

  let converted = 0;
  let alreadyHasBedFeet = 0;

  for (const assignment of data.assignments) {
    if (assignment.bedFeet !== undefined) {
      alreadyHasBedFeet++;
      continue;
    }

    if (assignment.bedsCount !== undefined) {
      // Convert bedsCount to bedFeet
      assignment.bedFeet = assignment.bedsCount * LEGACY_BED_FT;
      delete assignment.bedsCount;
      converted++;
    } else {
      // Default to 50ft if neither is set
      assignment.bedFeet = LEGACY_BED_FT;
      converted++;
    }
  }

  console.log(`Converted ${converted} assignments from bedsCount to bedFeet`);
  if (alreadyHasBedFeet > 0) {
    console.log(`${alreadyHasBedFeet} assignments already had bedFeet`);
  }

  // Write back
  fs.writeFileSync(TEMPLATE_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log('Wrote updated bed-template.json');

  // Verify
  const verify = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf-8'));
  const stillHasBedsCount = verify.assignments.some(a => a.bedsCount !== undefined);
  if (stillHasBedsCount) {
    console.error('ERROR: Some assignments still have bedsCount!');
    process.exit(1);
  }

  console.log('Verification passed - no bedsCount fields remain');
}

main();
