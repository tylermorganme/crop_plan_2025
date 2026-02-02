/**
 * Tests for GDD-staggered sequence calculations.
 *
 * These tests verify that:
 * 1. GDD calculations are consistent between drag and render paths
 * 2. Harvest dates remain evenly spaced when dragging sequences
 * 3. The reference date (targetFieldDate vs anchorFieldStartDate) produces correct GDD values
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  createGddCache,
  getDailyCache,
  getCumulativeTable,
  findHarvestDate,
  findPlantDate,
  getGddForDays,
  makeCacheKey,
  type GddCache,
  type GddCacheKey,
} from '../gdd-cache';
// Note: computeSequenceDateWithGddStagger uses require() which doesn't work in ESM tests,
// so we reimplement the logic directly in test helper functions.
import type { TemperatureHistory } from '../gdd';

// Create mock temperature data for testing
// Using realistic midwest US temperatures
function createMockTempData(): TemperatureHistory {
  const daily: Array<{ date: string; tmax: number; tmin: number }> = [];

  // Generate 2 years of data (2025 and 2026)
  for (let year = 2025; year <= 2026; year++) {
    for (let month = 1; month <= 12; month++) {
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // Simulate seasonal temperature variation
        // Peak in July (month 7), coldest in January (month 1)
        const dayOfYear = Math.floor((new Date(dateStr).getTime() - new Date(year, 0, 0).getTime()) / 86400000);
        const seasonalFactor = Math.sin((dayOfYear - 80) * Math.PI / 182.5); // Peak around day 172 (June 21)

        // Base temps: winter low ~25F, summer high ~85F
        const avgTemp = 55 + 30 * seasonalFactor;
        const spread = 15; // Daily variation

        daily.push({
          date: dateStr,
          tmax: Math.round(avgTemp + spread / 2),
          tmin: Math.round(avgTemp - spread / 2),
        });
      }
    }
  }

  return {
    location: { lat: 40.0, lon: -89.0, name: 'Mock Location' },
    fetchedAt: new Date().toISOString(),
    daily,
  };
}

describe('GDD Cache Fundamentals', () => {
  let gddCache: GddCache;
  let cacheKey: GddCacheKey;

  beforeAll(() => {
    const tempData = createMockTempData();
    gddCache = createGddCache(tempData);
    cacheKey = makeCacheKey(50, undefined, 0); // Base temp 50F, no ceiling, no structure offset
  });

  it('builds daily cache correctly', () => {
    const dailyCache = getDailyCache(gddCache, cacheKey);
    expect(dailyCache.byDate.size).toBeGreaterThan(0);

    // Check a summer day has more GDD than winter day
    const summerGdd = dailyCache.byDate.get('2025-07-15') ?? 0;
    const winterGdd = dailyCache.byDate.get('2025-01-15') ?? 0;
    expect(summerGdd).toBeGreaterThan(winterGdd);
  });

  it('builds cumulative table correctly', () => {
    const table = getCumulativeTable(gddCache, 2025, cacheKey);
    expect(table.year).toBe(2025);
    expect(table.cumulativeGdd.length).toBe(367); // 0-366 indices

    // Cumulative should always increase
    for (let i = 2; i <= 366; i++) {
      expect(table.cumulativeGdd[i]).toBeGreaterThanOrEqual(table.cumulativeGdd[i - 1]);
    }
  });

  it('findHarvestDate returns a later date', () => {
    const plantDate = '2025-05-01';
    const gddNeeded = 1000;

    const harvestDate = findHarvestDate(gddCache, plantDate, gddNeeded, cacheKey);
    expect(harvestDate).not.toBeNull();
    expect(new Date(harvestDate!).getTime()).toBeGreaterThan(new Date(plantDate).getTime());
  });

  it('findPlantDate returns an earlier date', () => {
    const harvestDate = '2025-08-01';
    const gddNeeded = 1000;

    const plantDate = findPlantDate(gddCache, harvestDate, gddNeeded, cacheKey);
    expect(plantDate).not.toBeNull();
    expect(new Date(plantDate!).getTime()).toBeLessThan(new Date(harvestDate).getTime());
  });

  it('findHarvestDate and findPlantDate are inverses', () => {
    const startDate = '2025-05-15';
    const gddNeeded = 800;

    // Forward: plant -> harvest
    const harvestDate = findHarvestDate(gddCache, startDate, gddNeeded, cacheKey);
    expect(harvestDate).not.toBeNull();

    // Reverse: harvest -> plant (should get back to original)
    const recoveredPlantDate = findPlantDate(gddCache, harvestDate!, gddNeeded, cacheKey);
    expect(recoveredPlantDate).not.toBeNull();

    // Log for debugging
    console.log(`Original plant: ${startDate}`);
    console.log(`Harvest: ${harvestDate}`);
    console.log(`Recovered plant: ${recoveredPlantDate}`);

    const diff = Math.abs(
      new Date(recoveredPlantDate!).getTime() - new Date(startDate).getTime()
    ) / 86400000;
    console.log(`Diff: ${diff} days`);

    // Should be within 1 day due to GDD accumulation boundaries
    // NOTE: If this fails, it indicates a fundamental issue with the GDD inverse functions!
    expect(diff).toBeLessThanOrEqual(1);
  });

  it('diagnose inverse function asymmetry', () => {
    // Test multiple dates and GDD values to understand the pattern
    const testCases = [
      { date: '2025-04-01', gdd: 500 },
      { date: '2025-05-01', gdd: 800 },
      { date: '2025-06-01', gdd: 1000 },
      { date: '2025-07-01', gdd: 1200 },
    ];

    console.log('\n=== Inverse Function Analysis ===');
    for (const { date, gdd } of testCases) {
      const harvest = findHarvestDate(gddCache, date, gdd, cacheKey);
      if (!harvest) continue;

      const recoveredPlant = findPlantDate(gddCache, harvest, gdd, cacheKey);
      if (!recoveredPlant) continue;

      const diff = Math.round(
        (new Date(recoveredPlant).getTime() - new Date(date).getTime()) / 86400000
      );

      // Also check the actual GDD accumulated
      const actualGddForward = getGddForDays(
        gddCache,
        date,
        Math.round((new Date(harvest).getTime() - new Date(date).getTime()) / 86400000),
        cacheKey
      );

      const daysToHarvest = Math.round(
        (new Date(harvest).getTime() - new Date(date).getTime()) / 86400000
      );

      console.log(`Plant: ${date}, GDD needed: ${gdd}`);
      console.log(`  Harvest: ${harvest} (${daysToHarvest} days)`);
      console.log(`  Actual GDD accumulated: ${actualGddForward}`);
      console.log(`  Recovered plant: ${recoveredPlant} (diff: ${diff} days)`);
      console.log('');
    }
  });

  it('deep dive into GDD table values', () => {
    // Look at the actual cumulative values around a specific case
    const plantDate = '2025-05-01';
    const gddNeeded = 800;

    const plant = new Date(plantDate);
    const year = plant.getFullYear();
    const table = getCumulativeTable(gddCache, year, cacheKey);

    // Get day of year for May 1
    const plantDoy = Math.floor((plant.getTime() - new Date(year, 0, 0).getTime()) / 86400000);

    console.log('\n=== Cumulative GDD Table Debug ===');
    console.log(`Plant date: ${plantDate}, DOY: ${plantDoy}`);
    console.log(`Cumulative GDD at plant DOY: ${table.cumulativeGdd[plantDoy]}`);
    console.log(`Cumulative GDD at plant DOY - 1: ${table.cumulativeGdd[plantDoy - 1]}`);

    // What findHarvestDate does
    const plantGdd = table.cumulativeGdd[plantDoy];
    const targetGdd = plantGdd + gddNeeded;
    console.log(`\nFindHarvestDate calculation:`);
    console.log(`  plantGdd (cumulative[${plantDoy}]): ${plantGdd}`);
    console.log(`  gddNeeded: ${gddNeeded}`);
    console.log(`  targetGdd (plantGdd + gddNeeded): ${targetGdd}`);

    // Find harvest date
    const harvest = findHarvestDate(gddCache, plantDate, gddNeeded, cacheKey);
    const harvestDoy = harvest
      ? Math.floor((new Date(harvest).getTime() - new Date(year, 0, 0).getTime()) / 86400000)
      : null;

    console.log(`\n  Harvest found: ${harvest}, DOY: ${harvestDoy}`);
    if (harvestDoy) {
      console.log(`  Cumulative GDD at harvest DOY: ${table.cumulativeGdd[harvestDoy]}`);
      console.log(`  Actual GDD from plant to harvest: ${table.cumulativeGdd[harvestDoy] - plantGdd}`);
    }

    // What findPlantDate does with the harvest date
    if (harvest && harvestDoy) {
      console.log(`\nFindPlantDate calculation:`);
      const harvestGdd = table.cumulativeGdd[harvestDoy];
      const reverseTargetGdd = harvestGdd - gddNeeded;
      console.log(`  harvestGdd (cumulative[${harvestDoy}]): ${harvestGdd}`);
      console.log(`  gddNeeded: ${gddNeeded}`);
      console.log(`  reverseTargetGdd (harvestGdd - gddNeeded): ${reverseTargetGdd}`);
      console.log(`  Original plantGdd was: ${plantGdd}`);
      console.log(`  Difference (reverseTargetGdd - plantGdd): ${reverseTargetGdd - plantGdd}`);

      // Find some days around the target
      console.log(`\n  Days around reverseTargetGdd (${reverseTargetGdd}):`);
      for (let doy = plantDoy - 5; doy <= plantDoy + 2; doy++) {
        console.log(`    DOY ${doy}: cumulative = ${table.cumulativeGdd[doy]}`);
      }

      const recoveredPlant = findPlantDate(gddCache, harvest, gddNeeded, cacheKey);
      const recoveredDoy = recoveredPlant
        ? Math.floor((new Date(recoveredPlant).getTime() - new Date(year, 0, 0).getTime()) / 86400000)
        : null;
      console.log(`\n  Recovered plant date: ${recoveredPlant}, DOY: ${recoveredDoy}`);
    }
  });
});

// Tests that use computeSequenceDateWithGddStagger are skipped because it uses
// require() which doesn't work in the vitest ESM environment.
// Instead, we test the underlying logic directly.

describe('GDD Stagger Logic (Direct)', () => {
  let gddCache: GddCache;
  let cacheKey: GddCacheKey;

  beforeAll(() => {
    const tempData = createMockTempData();
    gddCache = createGddCache(tempData);
    cacheKey = makeCacheKey(50, undefined, 0);
  });

  /**
   * Reimplementation of computeSequenceDateWithGddStagger for testing.
   * This matches the logic in planting-sequence.ts.
   */
  function computeSequenceDateWithGddStaggerDirect(
    anchorFieldStartDate: string,
    slot: number,
    offsetDays: number,
    fieldDaysToHarvest: number,
    targetFieldDate: string | undefined,
    planYear: number,
  ): string | null {
    // Slot 0 is the anchor - its planting date is fixed
    if (slot === 0) {
      return anchorFieldStartDate;
    }

    // Calculate GDD needed (same logic as getGddForFieldDays)
    let referenceDate = anchorFieldStartDate;
    if (targetFieldDate && planYear) {
      const [month, day] = targetFieldDate.split('-').map(Number);
      referenceDate = `${planYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    const gddNeeded = getGddForDays(gddCache, referenceDate, fieldDaysToHarvest, cacheKey)
      ?? fieldDaysToHarvest * 15;

    // Step 1: Calculate anchor's harvest date
    const anchorHarvestDate = findHarvestDate(gddCache, anchorFieldStartDate, gddNeeded, cacheKey);
    if (!anchorHarvestDate) return null;

    // Step 2: Calculate target harvest date for this slot
    const anchorHarvest = new Date(anchorHarvestDate);
    const targetHarvestDays = slot * offsetDays;
    anchorHarvest.setDate(anchorHarvest.getDate() + targetHarvestDays);
    const targetHarvestDate = anchorHarvest.toISOString().split('T')[0];

    // Step 3: Reverse lookup - what plant date achieves the target harvest?
    const plantDate = findPlantDate(gddCache, targetHarvestDate, gddNeeded, cacheKey);

    return plantDate;
  }

  it('slot 0 (anchor) returns the anchor date unchanged', () => {
    const result = computeSequenceDateWithGddStaggerDirect(
      '2025-05-01', 0, 14, 60, '05-01', 2025
    );
    expect(result).toBe('2025-05-01');
  });

  it('follower slots are calculated from anchor harvest', () => {
    const slot1Date = computeSequenceDateWithGddStaggerDirect(
      '2025-05-01', 1, 14, 60, '05-01', 2025
    );
    const slot2Date = computeSequenceDateWithGddStaggerDirect(
      '2025-05-01', 2, 14, 60, '05-01', 2025
    );

    expect(slot1Date).not.toBeNull();
    expect(slot2Date).not.toBeNull();

    console.log(`Anchor: 2025-05-01`);
    console.log(`Slot 1: ${slot1Date}`);
    console.log(`Slot 2: ${slot2Date}`);

    // Slot 1 should be later than anchor
    expect(new Date(slot1Date!).getTime()).toBeGreaterThan(new Date('2025-05-01').getTime());

    // Slot 2 should be later than slot 1
    expect(new Date(slot2Date!).getTime()).toBeGreaterThan(new Date(slot1Date!).getTime());
  });

  it('harvest dates are evenly spaced by offsetDays', () => {
    const offsetDays = 14;
    const anchorDate = '2025-05-01';
    const fieldDaysToHarvest = 60;

    // Get planting dates for slots 0, 1, 2
    const plantDates = [0, 1, 2].map(slot =>
      computeSequenceDateWithGddStaggerDirect(anchorDate, slot, offsetDays, fieldDaysToHarvest, '05-01', 2025)
    );

    expect(plantDates.every(d => d !== null)).toBe(true);

    // Calculate GDD needed (same as the function does internally)
    const gddNeeded = getGddForDays(gddCache, '2025-05-01', fieldDaysToHarvest, cacheKey)!;

    console.log(`GDD needed: ${gddNeeded}`);
    console.log(`Plant dates: ${plantDates.join(', ')}`);

    // Calculate harvest dates from each planting date
    const harvestDates = plantDates.map(plantDate =>
      findHarvestDate(gddCache, plantDate!, gddNeeded, cacheKey)
    );

    expect(harvestDates.every(d => d !== null)).toBe(true);

    console.log(`Harvest dates: ${harvestDates.join(', ')}`);

    // Check spacing between harvests
    for (let i = 1; i < harvestDates.length; i++) {
      const prevHarvest = new Date(harvestDates[i - 1]!);
      const currHarvest = new Date(harvestDates[i]!);
      const daysBetween = Math.round((currHarvest.getTime() - prevHarvest.getTime()) / 86400000);

      console.log(`Slot ${i-1} -> ${i}: ${daysBetween} days between harvests`);

      // Should be exactly offsetDays apart (or very close due to GDD quantization)
      expect(Math.abs(daysBetween - offsetDays)).toBeLessThanOrEqual(1);
    }
  });

  it('dragging to earlier date maintains harvest spacing', () => {
    const offsetDays = 14;
    const fieldDaysToHarvest = 60;

    // Original anchor date
    const originalAnchorDate = '2025-05-15';

    // Get original harvest dates
    const originalPlantDates = [0, 1, 2].map(slot =>
      computeSequenceDateWithGddStaggerDirect(originalAnchorDate, slot, offsetDays, fieldDaysToHarvest, '05-01', 2025)
    );

    const gddNeeded = getGddForDays(gddCache, '2025-05-01', fieldDaysToHarvest, cacheKey)!;

    const originalHarvestDates = originalPlantDates.map(d =>
      findHarvestDate(gddCache, d!, gddNeeded, cacheKey)
    );

    console.log('\n=== Original Schedule ===');
    console.log(`Plant dates: ${originalPlantDates.join(', ')}`);
    console.log(`Harvest dates: ${originalHarvestDates.join(', ')}`);

    // Now simulate dragging anchor 10 days earlier
    const newAnchorDate = '2025-05-05';

    const newPlantDates = [0, 1, 2].map(slot =>
      computeSequenceDateWithGddStaggerDirect(newAnchorDate, slot, offsetDays, fieldDaysToHarvest, '05-01', 2025)
    );

    const newHarvestDates = newPlantDates.map(d =>
      findHarvestDate(gddCache, d!, gddNeeded, cacheKey)
    );

    console.log('\n=== After Dragging Anchor 10 Days Earlier ===');
    console.log(`Plant dates: ${newPlantDates.join(', ')}`);
    console.log(`Harvest dates: ${newHarvestDates.join(', ')}`);

    // Check that harvest spacing is maintained
    for (let i = 1; i < newHarvestDates.length; i++) {
      const prevHarvest = new Date(newHarvestDates[i - 1]!);
      const currHarvest = new Date(newHarvestDates[i]!);
      const daysBetween = Math.round((currHarvest.getTime() - prevHarvest.getTime()) / 86400000);

      console.log(`Slot ${i-1} -> ${i}: ${daysBetween} days between harvests`);

      expect(Math.abs(daysBetween - offsetDays)).toBeLessThanOrEqual(2);
    }
  });
});

describe('Drag vs Render Path Consistency', () => {
  let gddCache: GddCache;
  let cacheKey: GddCacheKey;

  beforeAll(() => {
    const tempData = createMockTempData();
    gddCache = createGddCache(tempData);
    cacheKey = makeCacheKey(50, undefined, 0);
  });

  /**
   * Simulates the drag path calculation from page.tsx
   */
  function simulateDragPath(
    draggedPlantingDate: string,
    draggedSlot: number,
    offsetDays: number,
    fieldDaysToHarvest: number,
    referenceDate: string, // For gddNeeded calculation
  ): Map<number, string> {
    // Calculate gddNeeded from reference date (same as drag path)
    const gddNeeded = getGddForDays(gddCache, referenceDate, fieldDaysToHarvest, cacheKey)
      ?? fieldDaysToHarvest * 15;

    // Calculate dragged planting's harvest date
    const draggedHarvestDate = findHarvestDate(gddCache, draggedPlantingDate, gddNeeded, cacheKey);
    if (!draggedHarvestDate) {
      throw new Error('Could not calculate dragged harvest date');
    }

    const results = new Map<number, string>();

    // Calculate dates for all slots (simulating 3-slot sequence)
    for (let slot = 0; slot <= 2; slot++) {
      const slotDiff = slot - draggedSlot;
      const targetHarvestDays = slotDiff * offsetDays;

      // Calculate target harvest date for this slot
      const targetHarvestDate = new Date(draggedHarvestDate);
      targetHarvestDate.setDate(targetHarvestDate.getDate() + targetHarvestDays);
      const targetHarvestStr = targetHarvestDate.toISOString().split('T')[0];

      // Reverse lookup: what plant date achieves this harvest?
      const plantDate = findPlantDate(gddCache, targetHarvestStr, gddNeeded, cacheKey);
      if (plantDate) {
        results.set(slot, plantDate);
      }
    }

    return results;
  }

  /**
   * Simulates the render path calculation from timeline-data.ts -> planting-sequence.ts
   * Reimplemented directly to avoid require() issues in tests.
   */
  function simulateRenderPath(
    anchorFieldStartDate: string,
    offsetDays: number,
    fieldDaysToHarvest: number,
    targetFieldDate: string | undefined,
    planYear: number,
  ): Map<number, string> {
    const results = new Map<number, string>();

    // Calculate GDD needed (same logic as getGddForFieldDays)
    let referenceDate = anchorFieldStartDate;
    if (targetFieldDate && planYear) {
      const [month, day] = targetFieldDate.split('-').map(Number);
      referenceDate = `${planYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    const gddNeeded = getGddForDays(gddCache, referenceDate, fieldDaysToHarvest, cacheKey)
      ?? fieldDaysToHarvest * 15;

    for (let slot = 0; slot <= 2; slot++) {
      if (slot === 0) {
        results.set(slot, anchorFieldStartDate);
        continue;
      }

      // Step 1: Calculate anchor's harvest date
      const anchorHarvestDate = findHarvestDate(gddCache, anchorFieldStartDate, gddNeeded, cacheKey);
      if (!anchorHarvestDate) continue;

      // Step 2: Calculate target harvest date for this slot
      const anchorHarvest = new Date(anchorHarvestDate);
      const targetHarvestDays = slot * offsetDays;
      anchorHarvest.setDate(anchorHarvest.getDate() + targetHarvestDays);
      const targetHarvestDate = anchorHarvest.toISOString().split('T')[0];

      // Step 3: Reverse lookup - what plant date achieves the target harvest?
      const plantDate = findPlantDate(gddCache, targetHarvestDate, gddNeeded, cacheKey);
      if (plantDate) {
        results.set(slot, plantDate);
      }
    }

    return results;
  }

  it('drag and render paths produce same results when targetFieldDate is set', () => {
    const anchorDate = '2025-05-01';
    const offsetDays = 14;
    const fieldDaysToHarvest = 60;
    const targetFieldDate = '05-01';
    const planYear = 2025;

    // Render path result
    const renderDates = simulateRenderPath(
      anchorDate,
      offsetDays,
      fieldDaysToHarvest,
      targetFieldDate,
      planYear
    );

    // Drag path: simulate dragging slot 0 (anchor)
    const referenceDate = `${planYear}-${targetFieldDate.padStart(5, '0')}`;
    const dragDates = simulateDragPath(
      anchorDate,
      0,
      offsetDays,
      fieldDaysToHarvest,
      referenceDate
    );

    // Compare results
    for (let slot = 0; slot <= 2; slot++) {
      const renderDate = renderDates.get(slot);
      const dragDate = dragDates.get(slot);

      expect(renderDate).not.toBeUndefined();
      expect(dragDate).not.toBeUndefined();

      // Should be the same or within 1 day
      const diff = Math.abs(
        new Date(renderDate!).getTime() - new Date(dragDate!).getTime()
      ) / 86400000;

      expect(diff).toBeLessThanOrEqual(1);
    }
  });

  it('drag and render paths produce same results when targetFieldDate is NOT set', () => {
    const anchorDate = '2025-05-01';
    const offsetDays = 14;
    const fieldDaysToHarvest = 60;

    // Render path result (no targetFieldDate - uses anchorFieldStartDate)
    const renderDates = simulateRenderPath(
      anchorDate,
      offsetDays,
      fieldDaysToHarvest,
      undefined, // No targetFieldDate
      2025
    );

    // Drag path: simulate dragging slot 0, using anchor date as reference (like our fix)
    const dragDates = simulateDragPath(
      anchorDate,
      0,
      offsetDays,
      fieldDaysToHarvest,
      anchorDate // Use anchor date as reference (consistent with render path)
    );

    // Compare results
    for (let slot = 0; slot <= 2; slot++) {
      const renderDate = renderDates.get(slot);
      const dragDate = dragDates.get(slot);

      expect(renderDate).not.toBeUndefined();
      expect(dragDate).not.toBeUndefined();

      const diff = Math.abs(
        new Date(renderDate!).getTime() - new Date(dragDate!).getTime()
      ) / 86400000;

      expect(diff).toBeLessThanOrEqual(1);
    }
  });

  it('dragging a follower recalculates anchor correctly', () => {
    const originalAnchorDate = '2025-05-01';
    const offsetDays = 14;
    const fieldDaysToHarvest = 60;
    const targetFieldDate = '05-01';
    const planYear = 2025;

    // First, get the original render dates
    const originalRenderDates = simulateRenderPath(
      originalAnchorDate,
      offsetDays,
      fieldDaysToHarvest,
      targetFieldDate,
      planYear
    );

    const originalSlot1Date = originalRenderDates.get(1)!;

    // Now simulate dragging slot 1 to 7 days earlier
    const newSlot1Date = new Date(originalSlot1Date);
    newSlot1Date.setDate(newSlot1Date.getDate() - 7);
    const newSlot1DateStr = newSlot1Date.toISOString().split('T')[0];

    // Drag path calculates new dates for all slots
    const referenceDate = `${planYear}-${targetFieldDate.padStart(5, '0')}`;
    const dragDates = simulateDragPath(
      newSlot1DateStr,
      1, // We're dragging slot 1
      offsetDays,
      fieldDaysToHarvest,
      referenceDate
    );

    // The new anchor date should be earlier than the original
    const newAnchorDate = dragDates.get(0)!;
    expect(new Date(newAnchorDate).getTime()).toBeLessThan(new Date(originalAnchorDate).getTime());

    // Now render with the new anchor date
    const newRenderDates = simulateRenderPath(
      newAnchorDate,
      offsetDays,
      fieldDaysToHarvest,
      targetFieldDate,
      planYear
    );

    // The render path's slot 1 should match what drag calculated
    const renderSlot1 = newRenderDates.get(1)!;
    const dragSlot1 = dragDates.get(1)!;

    const diff = Math.abs(
      new Date(renderSlot1).getTime() - new Date(dragSlot1).getTime()
    ) / 86400000;

    expect(diff).toBeLessThanOrEqual(1);
  });
});

describe('GDD Reference Date Impact', () => {
  let gddCache: GddCache;
  let cacheKey: GddCacheKey;

  beforeAll(() => {
    const tempData = createMockTempData();
    gddCache = createGddCache(tempData);
    cacheKey = makeCacheKey(50, undefined, 0);
  });

  it('same calendar days produce different GDD in different seasons', () => {
    const daysToMature = 30;

    // GDD accumulated over 30 days starting in early spring vs peak summer
    // Using shorter period and more extreme seasonal difference
    const earlySpringGdd = getGddForDays(gddCache, '2025-03-15', daysToMature, cacheKey);
    const peakSummerGdd = getGddForDays(gddCache, '2025-06-15', daysToMature, cacheKey);

    expect(earlySpringGdd).not.toBeNull();
    expect(peakSummerGdd).not.toBeNull();

    // Peak summer should have more GDD than early spring
    expect(peakSummerGdd!).toBeGreaterThan(earlySpringGdd!);

    console.log(`Early Spring (Mar 15): ${earlySpringGdd} GDD over ${daysToMature} days`);
    console.log(`Peak Summer (Jun 15): ${peakSummerGdd} GDD over ${daysToMature} days`);
  });

  it('using wrong reference date causes harvest date drift', () => {
    const fieldDaysToHarvest = 60;
    const anchorDate = '2025-06-01';

    // GDD calculated from the CORRECT reference (target field date in spring)
    const correctGdd = getGddForDays(gddCache, '2025-05-01', fieldDaysToHarvest, cacheKey)!;

    // GDD calculated from the WRONG reference (using anchor date in early summer)
    const wrongGdd = getGddForDays(gddCache, anchorDate, fieldDaysToHarvest, cacheKey)!;

    // The wrong GDD should be higher (summer has more heat)
    expect(wrongGdd).toBeGreaterThan(correctGdd);

    // Calculate harvest dates using each GDD
    const correctHarvest = findHarvestDate(gddCache, anchorDate, correctGdd, cacheKey)!;
    const wrongHarvest = findHarvestDate(gddCache, anchorDate, wrongGdd, cacheKey)!;

    // Wrong GDD -> later harvest (needs more heat to accumulate)
    expect(new Date(wrongHarvest).getTime()).toBeGreaterThan(new Date(correctHarvest).getTime());

    const diffDays = Math.round(
      (new Date(wrongHarvest).getTime() - new Date(correctHarvest).getTime()) / 86400000
    );

    console.log(`Correct GDD (from 05-01): ${correctGdd} -> harvest ${correctHarvest}`);
    console.log(`Wrong GDD (from 06-01): ${wrongGdd} -> harvest ${wrongHarvest}`);
    console.log(`Difference: ${diffDays} days`);

    expect(diffDays).toBeGreaterThan(0);
  });
});
