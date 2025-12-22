// Test the new multi-bed rendering approach
const bedPlanData = require('../crop-api/src/data/bed-plan.json');

const SHORT_ROWS = ['F', 'J'];
const STANDARD_BED_FT = 50;
const SHORT_BED_FT = 20;

function getBedRow(bed) {
  let row = '';
  for (const char of bed) {
    if (char.match(/[A-Za-z]/)) {
      row += char;
    } else {
      break;
    }
  }
  return row;
}

function getBedNumber(bed) {
  const match = bed.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function getBedSizeFt(bed) {
  const row = getBedRow(bed);
  return SHORT_ROWS.includes(row) ? SHORT_BED_FT : STANDARD_BED_FT;
}

function calculateRowSpan(bedsNeeded, startBed, bedGroups) {
  if (bedsNeeded <= 0) {
    return { spanBeds: [startBed] };
  }

  const row = getBedRow(startBed);
  const bedSizeFt = getBedSizeFt(startBed);

  const feetNeeded = bedsNeeded * STANDARD_BED_FT;
  const bedsInRow = Math.ceil(feetNeeded / bedSizeFt);

  const rowBeds = (bedGroups[row] || []).sort((a, b) => getBedNumber(a) - getBedNumber(b));

  const startIndex = rowBeds.findIndex(b => b === startBed);
  if (startIndex === -1) {
    return { spanBeds: [startBed] };
  }

  const spanBeds = [];
  for (let i = 0; i < bedsInRow && startIndex + i < rowBeds.length; i++) {
    spanBeds.push(rowBeds[startIndex + i]);
  }

  if (spanBeds.length === 0) {
    spanBeds.push(startBed);
  }

  return { spanBeds };
}

// Show what the timeline entries would look like
console.log('Multi-bed crops with individual entries:\n');

const testCases = [
  { name: 'Peas', beds: 3, startBed: 'I1' },
  { name: 'Tomato', beds: 1.5, startBed: 'H1' },
  { name: 'Onion', beds: 1.5, startBed: 'F2' },
  { name: 'Potato', beds: 2, startBed: 'F3' },
];

for (const test of testCases) {
  const { spanBeds } = calculateRowSpan(test.beds, test.startBed, bedPlanData.bedGroups);
  console.log(`${test.name} (${test.beds} beds starting at ${test.startBed}):`);
  spanBeds.forEach((bed, i) => {
    console.log(`  Entry ${i + 1}: bed=${bed}, indicator="${i + 1}/${spanBeds.length}"`);
  });
  console.log('');
}
