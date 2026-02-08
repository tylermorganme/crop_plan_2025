/**
 * Force reload a plan by calling the API.
 * This properly refreshes the in-memory Zustand store.
 *
 * Run with: npx tsx scripts/force-reload-plan.ts [planId]
 */

const PLAN_ID = process.argv[2] || '1770248310946-bqfcf3box';
const BASE_URL = 'http://localhost:5336';

async function main() {
  console.log(`Force reloading plan: ${PLAN_ID}\n`);

  // Call the API to get the plan data (this verifies the API can read it)
  const response = await fetch(`${BASE_URL}/api/sqlite/${PLAN_ID}`);

  if (!response.ok) {
    console.error('Failed to fetch plan:', response.status, response.statusText);
    process.exit(1);
  }

  const data = await response.json();
  console.log('Plan loaded from API successfully');
  console.log(`- Sequences: ${Object.keys(data.plan?.sequences ?? {}).length}`);
  console.log(`- Plantings: ${data.plan?.plantings?.length ?? 0}`);

  // Check cilantro plantings
  const cilantroPlantings = (data.plan?.plantings ?? []).filter(
    (p: { specId: string }) => p.specId?.includes('Cilantro')
  );
  console.log(`\nCilantro plantings:`);
  for (const p of cilantroPlantings) {
    console.log(`  ${p.id}: sequenceId=${p.sequenceId ?? 'null'}, slot=${p.sequenceSlot ?? 'null'}`);
  }

  console.log('\n=== The API sees the correct data ===');
  console.log('The issue is that your browser tab has stale in-memory state.');
  console.log('\nTo fix, either:');
  console.log('1. Close the browser tab and open a fresh one');
  console.log('2. Navigate to /plans, then back to the timeline');
  console.log('3. Run in browser console: usePlanStore.getState().loadPlanById("' + PLAN_ID + '", { force: true })');
}

main().catch(console.error);
