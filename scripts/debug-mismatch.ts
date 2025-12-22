import { calculateFromBedPlanAssignment } from '../crop-api/src/lib/crop-timing-calculator';
import data from '../crop-api/src/data/bed-plan.json';

const targets = ['GAR533', 'GAR534', 'GAR535', 'LET012', 'LET013'];

for (const id of targets) {
  const assignment = (data as any).assignments.find((x: any) => x.identifier === id);
  if (!assignment) continue;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${id}: ${assignment.crop}`);
  console.log('='.repeat(60));

  console.log('\nInputs:');
  console.log('  fixedFieldStartDate:', assignment.fixedFieldStartDate);
  console.log('  actualTpOrDsDate:', assignment.actualTpOrDsDate);
  console.log('  daysInCells:', assignment.daysInCells);
  console.log('  dtm:', assignment.dtm);
  console.log('  harvestWindow:', assignment.harvestWindow);
  console.log('  additionalDaysOfHarvest:', assignment.additionalDaysOfHarvest);

  const result = calculateFromBedPlanAssignment(assignment);

  console.log('\nCalculated:');
  console.log('  startDate:', result?.startDate?.toISOString().split('T')[0]);
  console.log('  tpOrDsDate:', result?.tpOrDsDate?.toISOString().split('T')[0]);
  console.log('  expectedBeginningOfHarvest:', result?.expectedBeginningOfHarvest?.toISOString().split('T')[0]);
  console.log('  expectedEndOfHarvest:', result?.expectedEndOfHarvest?.toISOString().split('T')[0]);
  console.log('  endDate:', result?.endDate?.toISOString().split('T')[0]);

  console.log('\nExpected from Excel:');
  console.log('  startDate:', assignment.startDate?.split('T')[0]);
  console.log('  endOfHarvest:', assignment.endOfHarvest?.split('T')[0]);
  console.log('  expectedEndOfHarvest:', assignment.expectedEndOfHarvest?.split('T')[0]);
}
