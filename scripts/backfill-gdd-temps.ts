#!/usr/bin/env npx tsx
/**
 * Backfill GDD temperatures to all crops in all plans.
 *
 * Reads researched GDD data from src/data/gdd-temperatures.json and updates
 * the crops in each plan with gddBaseTemp and gddUpperTemp values.
 *
 * Data is in Celsius, converts to Fahrenheit for storage.
 *
 * Usage: npx tsx scripts/backfill-gdd-temps.ts [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// Paths
const DATA_DIR = path.join(process.cwd(), 'data', 'plans');
const GDD_DATA_PATH = path.join(process.cwd(), 'src', 'data', 'gdd-temperatures.json');
const INDEX_PATH = path.join(DATA_DIR, 'index.json');

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

interface PlanIndex {
  id: string;
  name: string;
}

interface Crop {
  id: string;
  name: string;
  bgColor: string;
  textColor: string;
  gddBaseTemp?: number;
  gddUpperTemp?: number;
}

interface Plan {
  crops?: Record<string, Crop>;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
    console.log('🔍 DRY RUN - no changes will be made\n');
  }

  // Load GDD data
  if (!fs.existsSync(GDD_DATA_PATH)) {
    console.error(`GDD data file not found: ${GDD_DATA_PATH}`);
    process.exit(1);
  }

  const gddData: GddDataFile = JSON.parse(fs.readFileSync(GDD_DATA_PATH, 'utf-8'));
  console.log(`📊 Loaded GDD data for ${Object.keys(gddData.crops).length} crops\n`);

  // Build lookup map (crop_id -> temps in Fahrenheit)
  const gddLookup = new Map<string, { base: number | null; upper: number | null }>();
  for (const [cropId, data] of Object.entries(gddData.crops)) {
    gddLookup.set(cropId, {
      base: data.base !== null ? celsiusToFahrenheit(data.base) : null,
      upper: data.upper !== null ? celsiusToFahrenheit(data.upper) : null,
    });
  }

  // Load plan index
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`Plan index not found: ${INDEX_PATH}`);
    process.exit(1);
  }

  const planIndex: PlanIndex[] = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  console.log(`📁 Found ${planIndex.length} plans\n`);

  let totalUpdated = 0;
  let totalPlans = 0;

  for (const planInfo of planIndex) {
    const dbPath = path.join(DATA_DIR, `${planInfo.id}.db`);

    if (!fs.existsSync(dbPath)) {
      console.log(`⚠️  Skipping ${planInfo.name} - database not found`);
      continue;
    }

    const db = new Database(dbPath);

    try {
      // Read current plan data
      const row = db.prepare('SELECT data FROM plan WHERE id = ?').get('main') as { data: string } | undefined;

      if (!row) {
        console.log(`⚠️  Skipping ${planInfo.name} - no plan data`);
        continue;
      }

      const plan: Plan = JSON.parse(row.data);

      if (!plan.crops) {
        console.log(`⚠️  Skipping ${planInfo.name} - no crops`);
        continue;
      }

      let updated = 0;
      const updates: string[] = [];

      for (const [cropId, crop] of Object.entries(plan.crops)) {
        const gddTemps = gddLookup.get(cropId);

        if (!gddTemps) {
          continue; // No GDD data for this crop
        }

        let changed = false;

        // Only update if not already set and we have data
        if (crop.gddBaseTemp === undefined && gddTemps.base !== null) {
          crop.gddBaseTemp = gddTemps.base;
          changed = true;
        }

        if (crop.gddUpperTemp === undefined && gddTemps.upper !== null) {
          crop.gddUpperTemp = gddTemps.upper;
          changed = true;
        }

        if (changed) {
          updated++;
          updates.push(`  ${crop.name}: base=${gddTemps.base}°F, upper=${gddTemps.upper}°F`);
        }
      }

      if (updated > 0) {
        totalUpdated += updated;
        totalPlans++;

        console.log(`\n✅ ${planInfo.name}: updating ${updated} crops`);
        if (updates.length <= 10) {
          updates.forEach(u => console.log(u));
        } else {
          updates.slice(0, 5).forEach(u => console.log(u));
          console.log(`  ... and ${updates.length - 5} more`);
        }

        if (!dryRun) {
          // Save updated plan data
          db.prepare('UPDATE plan SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(JSON.stringify(plan), 'main');
        }
      } else {
        console.log(`⏭️  ${planInfo.name}: no updates needed`);
      }
    } finally {
      db.close();
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Summary: Updated ${totalUpdated} crops across ${totalPlans} plans`);

  if (dryRun) {
    console.log('\n🔍 This was a dry run. Run without --dry-run to apply changes.');
  }
}

main().catch(console.error);
