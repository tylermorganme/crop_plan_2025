#!/usr/bin/env npx tsx
/**
 * Add GDD temperatures to crops-template.json
 *
 * Reads researched GDD data from src/data/gdd-temperatures.json and merges
 * the base/upper temps into src/data/crops-template.json.
 *
 * Data is in Celsius, converts to Fahrenheit for storage.
 *
 * Usage: npx tsx scripts/add-gdd-temps-to-template.ts
 */

import fs from 'fs';
import path from 'path';

const CROPS_TEMPLATE_PATH = path.join(process.cwd(), 'src', 'data', 'crops-template.json');
const GDD_DATA_PATH = path.join(process.cwd(), 'src', 'data', 'gdd-temperatures.json');

// Celsius to Fahrenheit
function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9/5) + 32);
}

interface GddCropData {
  name: string;
  base: number | null;
  upper: number | null;
  confidence: string;
  notes: string;
  source: string;
}

interface GddDataFile {
  _metadata: {
    description: string;
    generated: string;
    units: string;
  };
  crops: Record<string, GddCropData>;
}

interface Crop {
  id: string;
  name: string;
  bgColor: string;
  textColor: string;
  gddBaseTemp?: number;
  gddUpperTemp?: number;
}

async function main() {
  // Load GDD data
  if (!fs.existsSync(GDD_DATA_PATH)) {
    console.error(`GDD data file not found: ${GDD_DATA_PATH}`);
    process.exit(1);
  }

  const gddData: GddDataFile = JSON.parse(fs.readFileSync(GDD_DATA_PATH, 'utf-8'));
  console.log(`📊 Loaded GDD data for ${Object.keys(gddData.crops).length} crops\n`);

  // Load crops template
  if (!fs.existsSync(CROPS_TEMPLATE_PATH)) {
    console.error(`Crops template not found: ${CROPS_TEMPLATE_PATH}`);
    process.exit(1);
  }

  const crops: Crop[] = JSON.parse(fs.readFileSync(CROPS_TEMPLATE_PATH, 'utf-8'));
  console.log(`🌱 Loaded ${crops.length} crops from template\n`);

  let updated = 0;
  let notFound = 0;

  for (const crop of crops) {
    const gddInfo = gddData.crops[crop.id];

    if (!gddInfo) {
      notFound++;
      continue;
    }

    let changed = false;

    if (gddInfo.base !== null) {
      crop.gddBaseTemp = celsiusToFahrenheit(gddInfo.base);
      changed = true;
    }

    if (gddInfo.upper !== null) {
      crop.gddUpperTemp = celsiusToFahrenheit(gddInfo.upper);
      changed = true;
    }

    if (changed) {
      updated++;
      console.log(`✅ ${crop.name}: base=${crop.gddBaseTemp}°F, upper=${crop.gddUpperTemp}°F`);
    }
  }

  // Save updated template
  fs.writeFileSync(CROPS_TEMPLATE_PATH, JSON.stringify(crops, null, 2) + '\n');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Summary: Updated ${updated} crops with GDD temps`);
  console.log(`⚠️  ${notFound} crops had no GDD data available`);
  console.log(`\n✅ Saved to ${CROPS_TEMPLATE_PATH}`);
}

main().catch(console.error);
