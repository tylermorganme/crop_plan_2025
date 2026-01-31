/**
 * Find all duplicate spec IDs across all plans
 */

import { loadPlan } from '../src/lib/sqlite-storage';
import { readdirSync } from 'fs';

const plansDir = './data/plans';
const dbFiles = readdirSync(plansDir).filter(f => f.endsWith('.db') && f !== 'main.db');

for (const dbFile of dbFiles) {
  const planId = dbFile.replace('.db', '');
  try {
    const plan = loadPlan(planId);
    if (!plan?.specs) continue;

    // Group specs by ID
    const byId: Record<string, string[]> = {};
    for (const [identifier, spec] of Object.entries(plan.specs)) {
      const id = (spec as any).id;
      if (!byId[id]) byId[id] = [];
      byId[id].push(identifier);
    }

    // Find duplicates
    const duplicates = Object.entries(byId).filter(([, identifiers]) => identifiers.length > 1);
    if (duplicates.length > 0) {
      console.log('Plan:', (plan.metadata as any)?.name || planId);
      for (const [id, identifiers] of duplicates) {
        console.log('  Duplicate ID:', id);
        for (const ident of identifiers) {
          console.log('    -', ident);
        }
      }
    }
  } catch (e: any) {
    console.error('Error loading', planId, e.message);
  }
}
console.log('Done scanning.');
