/**
 * Migration Script: JSON.gz → SQLite
 *
 * Converts existing plan files from gzipped JSON to SQLite databases.
 *
 * Usage: npx ts-node scripts/migrate-to-sqlite.ts
 *
 * What it does:
 * 1. Reads all *.json.gz files from data/plans/
 * 2. Decompresses and parses each plan
 * 3. Creates a SQLite database for each plan
 * 4. Rebuilds the plan index
 * 5. Optionally archives the old files
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join } from 'path';
import { savePlan, rebuildPlanIndex, type PlanSummary } from '../src/lib/sqlite-storage';
import type { Plan } from '../src/lib/entities/plan';
import { migratePlan } from '../src/lib/migrations';

const PLANS_DIR = join(process.cwd(), 'data', 'plans');
const ARCHIVE_DIR = join(PLANS_DIR, 'archive');

interface MigrationResult {
  planId: string;
  name: string;
  success: boolean;
  error?: string;
}

/**
 * Decompress and parse a gzipped JSON file.
 */
function loadGzippedJson<T>(filePath: string): T {
  const compressed = readFileSync(filePath);
  const decompressed = gunzipSync(compressed);
  return JSON.parse(decompressed.toString('utf-8'));
}

/**
 * Extract plan from the old PlanData format.
 * Old format: { plan: Plan, past: [], future: [] }
 */
function extractPlan(data: unknown): Plan {
  if (typeof data === 'object' && data !== null && 'plan' in data) {
    return (data as { plan: Plan }).plan;
  }
  // If it's already just a plan
  return data as Plan;
}

/**
 * Migrate a single plan file to SQLite.
 */
function migratePlanFile(filePath: string): MigrationResult {
  const fileName = filePath.split('/').pop()!;
  const planId = fileName.replace('.json.gz', '');

  try {
    // Load the old format
    const data = loadGzippedJson(filePath);
    let plan = extractPlan(data);

    // Run schema migrations if needed
    plan = migratePlan(plan);

    // Ensure plan ID matches file name
    if (plan.id !== planId) {
      console.warn(`  Plan ID mismatch: file=${planId}, plan.id=${plan.id}. Using file name.`);
      plan.id = planId;
    }

    // Save to SQLite
    savePlan(planId, plan);

    return {
      planId,
      name: plan.metadata?.name ?? planId,
      success: true,
    };
  } catch (error) {
    return {
      planId,
      name: planId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Archive old files by moving them to archive/ subdirectory.
 */
function archiveOldFiles(planIds: string[]): void {
  if (!existsSync(ARCHIVE_DIR)) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  for (const planId of planIds) {
    // Archive main plan file
    const mainFile = join(PLANS_DIR, `${planId}.json.gz`);
    if (existsSync(mainFile)) {
      renameSync(mainFile, join(ARCHIVE_DIR, `${planId}.json.gz`));
    }

    // Archive snapshots file
    const snapshotsFile = join(PLANS_DIR, `${planId}.snapshots.json.gz`);
    if (existsSync(snapshotsFile)) {
      renameSync(snapshotsFile, join(ARCHIVE_DIR, `${planId}.snapshots.json.gz`));
    }

    // Archive checkpoints file
    const checkpointsFile = join(PLANS_DIR, `${planId}.checkpoints.json`);
    if (existsSync(checkpointsFile)) {
      renameSync(checkpointsFile, join(ARCHIVE_DIR, `${planId}.checkpoints.json`));
    }
  }
}

/**
 * Main migration function.
 */
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('SQLite Migration Script');
  console.log('='.repeat(60));
  console.log();

  // Find all plan files
  const files = readdirSync(PLANS_DIR)
    .filter(f => f.endsWith('.json.gz') && !f.includes('.snapshots') && !f.includes('.checkpoints'))
    .map(f => join(PLANS_DIR, f));

  console.log(`Found ${files.length} plan files to migrate.`);
  console.log();

  if (files.length === 0) {
    console.log('No plans to migrate.');
    return;
  }

  // Migrate each plan
  const results: MigrationResult[] = [];
  for (const file of files) {
    const fileName = file.split('/').pop()!;
    process.stdout.write(`Migrating ${fileName}... `);

    const result = migratePlanFile(file);
    results.push(result);

    if (result.success) {
      console.log(`✓ ${result.name}`);
    } else {
      console.log(`✗ ${result.error}`);
    }
  }

  console.log();

  // Summary
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log('='.repeat(60));
  console.log('Migration Summary');
  console.log('='.repeat(60));
  console.log(`  Succeeded: ${succeeded.length}`);
  console.log(`  Failed: ${failed.length}`);
  console.log();

  if (failed.length > 0) {
    console.log('Failed migrations:');
    for (const f of failed) {
      console.log(`  - ${f.planId}: ${f.error}`);
    }
    console.log();
  }

  // Rebuild index
  console.log('Rebuilding plan index...');
  const index: PlanSummary[] = rebuildPlanIndex();
  console.log(`Index rebuilt with ${index.length} plans.`);
  console.log();

  // Archive old files
  if (succeeded.length > 0) {
    console.log('Archiving old files...');
    archiveOldFiles(succeeded.map(r => r.planId));
    console.log(`Moved ${succeeded.length} plan file sets to archive/.`);
  }

  console.log();
  console.log('Migration complete!');
}

// Run
main().catch(console.error);
