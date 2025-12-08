/**
 * Simple Crop Planner - Modeless Dialog Version
 * Uses currentonly scope for Marketplace compatibility
 *
 * Required columns (by header name): Name, Start Date, End Date, Resource, _id
 */

// Default column names (can be overridden via settings)
const DEFAULT_COLUMNS = {
  name: 'Name',
  start: 'Start Date',
  end: 'End Date',
  resource: 'Resource',
  id: '_id'
};

// Alternative resource column names to check if exact match not found
const RESOURCE_COLUMN_NAMES = ['Resource', 'Bed', 'Bed 1', 'Location', 'Assignment'];

/**
 * Get saved column settings or defaults
 */
function getColumnSettings() {
  const props = PropertiesService.getDocumentProperties();
  const saved = props.getProperty('columnSettings');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      return DEFAULT_COLUMNS;
    }
  }
  return DEFAULT_COLUMNS;
}

/**
 * Save column settings
 */
function saveColumnSettings(settings) {
  const props = PropertiesService.getDocumentProperties();
  props.setProperty('columnSettings', JSON.stringify(settings));
  return { success: true };
}

/**
 * Get column indices by header names
 * Returns object with standardized keys: Name, Start, End, Resource, ID
 * Uses saved column settings to find the right columns
 */
function getColumnMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const settings = getColumnSettings();
  const map = {};

  // Build a header index for quick lookup
  const headerIndex = {};
  headers.forEach((header, index) => {
    const h = String(header).trim();
    headerIndex[h] = index;
    headerIndex[h.toLowerCase()] = index; // Also lowercase for fallback
  });

  // Map each column using settings
  map['Name'] = headerIndex[settings.name] !== undefined ? headerIndex[settings.name] : headerIndex[settings.name.toLowerCase()];
  map['Start'] = headerIndex[settings.start] !== undefined ? headerIndex[settings.start] : headerIndex[settings.start.toLowerCase()];
  map['End'] = headerIndex[settings.end] !== undefined ? headerIndex[settings.end] : headerIndex[settings.end.toLowerCase()];
  map['ID'] = headerIndex[settings.id] !== undefined ? headerIndex[settings.id] : headerIndex[settings.id.toLowerCase()];

  // For Resource, try exact match first, then alternatives
  if (headerIndex[settings.resource] !== undefined) {
    map['Resource'] = headerIndex[settings.resource];
  } else if (headerIndex[settings.resource.toLowerCase()] !== undefined) {
    map['Resource'] = headerIndex[settings.resource.toLowerCase()];
  } else {
    // Try alternative resource column names
    for (const name of RESOURCE_COLUMN_NAMES) {
      if (headerIndex[name] !== undefined) {
        map['Resource'] = headerIndex[name];
        break;
      }
    }
  }

  return map;
}

/**
 * Ensure the _id column exists, create if not
 */
function ensureIdColumn(sheet) {
  const settings = getColumnSettings();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let idColIndex = headers.findIndex(h => String(h).trim() === settings.id);

  if (idColIndex === -1) {
    // Add _id column at the end
    const newCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, newCol).setValue(settings.id);
    return newCol - 1; // 0-based index
  }

  return idColIndex;
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Crop Planner')
    .addItem('Open Planner', 'showPlanner')
    .addSeparator()
    .addItem('Column Settings...', 'showColumnSettings')
    .addItem('Setup ID Column', 'setupIdColumn')
    .addItem('Setup Resources Sheet', 'setupResourcesSheet')
    .addToUi();
}

/**
 * Show column settings dialog
 */
function showColumnSettings() {
  const html = HtmlService.createHtmlOutputFromFile('Settings')
    .setWidth(400)
    .setHeight(350);
  SpreadsheetApp.getUi().showModalDialog(html, 'Column Settings');
}

/**
 * Get available column headers from the active sheet
 */
function getSheetHeaders() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.map(h => String(h).trim()).filter(h => h);
}

function showPlanner() {
  showPlannerWithSize(1200, 800);
}

function showPlannerWithSize(width, height) {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setWidth(width)
    .setHeight(height);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Crop Planner');
}

/**
 * Setup: Add ID column header, hide it, and protect it
 */
function setupIdColumn() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // Ensure column exists
  const idColIndex = ensureIdColumn(sheet);
  const idColNum = idColIndex + 1; // 1-based for Sheets API

  // Generate IDs for any rows that don't have one
  ensureAllRowsHaveIds();

  // Hide the column
  sheet.hideColumns(idColNum);

  // Protect the column (users can't edit, but script can)
  const protection = sheet.getRange(1, idColNum, sheet.getMaxRows(), 1).protect();
  protection.setDescription('Crop Planner IDs - Do not edit');
  protection.setWarningOnly(true);

  SpreadsheetApp.getUi().alert('ID column setup complete. The _id column is now hidden and protected.');
}

/**
 * Generate a simple unique ID
 */
function generateId() {
  return 'crop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Ensure all data rows have unique IDs
 * Detects and fixes duplicates (e.g., from copy-paste)
 */
function ensureAllRowsHaveIds() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return; // No data rows

  // Find ID column by header
  const idColIndex = ensureIdColumn(sheet);
  const idColNum = idColIndex + 1; // 1-based

  const idRange = sheet.getRange(2, idColNum, lastRow - 1, 1);
  const ids = idRange.getValues();
  let changed = false;

  // Track seen IDs to detect duplicates
  const seenIds = new Set();

  for (let i = 0; i < ids.length; i++) {
    const currentId = ids[i][0];

    // Generate new ID if empty OR if duplicate
    if (!currentId || seenIds.has(currentId)) {
      ids[i][0] = generateId();
      changed = true;
    }

    seenIds.add(ids[i][0]);
  }

  if (changed) {
    idRange.setValues(ids);
  }
}

/**
 * Get crop data from the active sheet
 * Finds columns by header name, not position
 */
function getCropData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const settings = getColumnSettings();

  // Ensure all rows have IDs first
  ensureAllRowsHaveIds();

  const data = sheet.getDataRange().getValues();
  const cols = getColumnMap(sheet);

  // Validate required columns exist
  const required = ['Name', 'Start', 'End', 'ID'];
  const requiredLabels = [settings.name, settings.start, settings.end, settings.id];
  for (let i = 0; i < required.length; i++) {
    if (cols[required[i]] === undefined) {
      throw new Error('Missing required column: ' + requiredLabels[i] + '. Go to Crop Planner > Column Settings to configure.');
    }
  }

  // Get the Name column range for colors (data rows only, skip header)
  const lastRow = sheet.getLastRow();
  const nameColNum = cols['Name'] + 1; // 1-based
  let nameBackgrounds = [];
  let nameFontColors = [];

  if (lastRow > 1) {
    const nameRange = sheet.getRange(2, nameColNum, lastRow - 1, 1);
    nameBackgrounds = nameRange.getBackgrounds();
    nameFontColors = nameRange.getFontColors();
  }

  // Skip header row
  const crops = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const name = row[cols['Name']];
    const start = row[cols['Start']];
    const end = row[cols['End']];

    if (name && start && end) {
      // Get colors for this row (i-1 because nameBackgrounds is 0-indexed from row 2)
      const bgColor = nameBackgrounds[i - 1] ? nameBackgrounds[i - 1][0] : null;
      const textColor = nameFontColors[i - 1] ? nameFontColors[i - 1][0] : null;

      crops.push({
        id: row[cols['ID']] || '',
        rowIndex: i + 1,
        name: name,
        startDate: start instanceof Date ? start.toISOString() : start,
        endDate: end instanceof Date ? end.toISOString() : end,
        resource: cols['Resource'] !== undefined ? String(row[cols['Resource']] || '').trim() : '',
        bgColor: bgColor && bgColor !== '#ffffff' ? bgColor : null,
        textColor: textColor || null
      });
    }
  }

  return crops;
}

/**
 * Find row by ID and update resource
 */
function updateCropResource(cropId, resource) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  const cols = getColumnMap(sheet);

  if (cols['ID'] === undefined) {
    return { success: false, error: 'No ID column found' };
  }
  if (cols['Resource'] === undefined) {
    return { success: false, error: 'No Resource column found' };
  }

  const idColIndex = cols['ID'];
  const resourceColNum = cols['Resource'] + 1; // 1-based for Sheets API

  // Find the row with this ID
  for (let i = 1; i < data.length; i++) {
    if (data[i][idColIndex] === cropId) {
      sheet.getRange(i + 1, resourceColNum).setValue(resource);
      return { success: true, row: i + 1 };
    }
  }

  return { success: false, error: 'Crop not found: ' + cropId };
}

/**
 * Get all planner data in one call (resources + crops)
 * Reduces round-trips for faster sync
 */
function getPlannerData() {
  return {
    resources: getResources(),
    crops: getCropData()
  };
}

/**
 * Get user preferences (per-user, persists across sessions)
 */
function getUserPreferences() {
  const props = PropertiesService.getUserProperties();
  const saved = props.getProperty('plannerPrefs');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      return {};
    }
  }
  return {};
}

/**
 * Save user preferences
 */
function saveUserPreferences(prefs) {
  const props = PropertiesService.getUserProperties();
  // Merge with existing preferences
  const existing = getUserPreferences();
  const merged = { ...existing, ...prefs };
  props.setProperty('plannerPrefs', JSON.stringify(merged));
  return { success: true };
}

/**
 * Get list of available resources, optionally with group information
 * Returns an object with:
 *   - resources: flat array of resource names (for backward compatibility)
 *   - groups: array of { name, beds: [] } for grouped display
 *
 * Resources sheet format (if exists):
 *   Column A: Group name
 *   Column B: Bed/Resource name
 *   Row 1: Headers (Group, Bed)
 */
function getResources() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const cols = getColumnMap(sheet);

  // Try to get resources from a "Resources" sheet (if it exists)
  const resourceSheet = ss.getSheetByName('Resources');
  if (resourceSheet) {
    const lastRow = resourceSheet.getLastRow();
    const lastCol = resourceSheet.getLastColumn();

    if (lastRow >= 2 && lastCol >= 2) {
      // Has header row and at least 2 columns - use grouped format
      const data = resourceSheet.getRange(2, 1, lastRow - 1, 2).getValues();
      const groupMap = new Map(); // group name -> array of beds
      const flatResources = [];

      for (const row of data) {
        const group = String(row[0] || '').trim();
        const bed = String(row[1] || '').trim();

        if (bed) {
          flatResources.push(bed);

          if (group) {
            if (!groupMap.has(group)) {
              groupMap.set(group, []);
            }
            groupMap.get(group).push(bed);
          } else {
            // Ungrouped beds go into a special group
            if (!groupMap.has('_ungrouped')) {
              groupMap.set('_ungrouped', []);
            }
            groupMap.get('_ungrouped').push(bed);
          }
        }
      }

      if (flatResources.length > 0) {
        // Build groups array in order they appear
        const groups = [];
        const seenGroups = new Set();

        for (const row of data) {
          const group = String(row[0] || '').trim() || '_ungrouped';
          if (!seenGroups.has(group) && groupMap.has(group)) {
            seenGroups.add(group);
            groups.push({
              name: group === '_ungrouped' ? null : group,
              beds: groupMap.get(group)
            });
          }
        }

        // Add Unassigned
        flatResources.push('Unassigned');
        groups.push({ name: null, beds: ['Unassigned'] });

        return {
          resources: flatResources,
          groups: groups
        };
      }
    } else if (lastRow >= 1 && lastCol === 1) {
      // Single column - old format, no groups
      const values = resourceSheet.getRange(1, 1, lastRow, 1).getValues();
      const resources = values.map(r => String(r[0] || '').trim()).filter(v => v);
      if (resources.length > 0) {
        if (!resources.includes('Unassigned')) {
          resources.push('Unassigned');
        }
        return {
          resources: resources,
          groups: null
        };
      }
    }
  }

  // Fall back to reading from main sheet's Resource column
  if (cols['Resource'] === undefined) {
    return {
      resources: ['Bed 1', 'Bed 2', 'Bed 3', 'Bed 4', 'Bed 5', 'Unassigned'],
      groups: null
    };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return {
      resources: ['Bed 1', 'Bed 2', 'Bed 3', 'Bed 4', 'Bed 5', 'Unassigned'],
      groups: null
    };
  }

  const resourceColNum = cols['Resource'] + 1;
  const values = sheet.getRange(2, resourceColNum, lastRow - 1, 1).getValues();

  // Collect unique non-empty resource values
  const resourceSet = new Set();
  for (const row of values) {
    const val = row[0];
    if (val !== null && val !== undefined && val !== '') {
      const strVal = String(val).trim();
      if (strVal) {
        resourceSet.add(strVal);
      }
    }
  }

  if (resourceSet.size === 0) {
    return {
      resources: ['Bed 1', 'Bed 2', 'Bed 3', 'Bed 4', 'Bed 5', 'Unassigned'],
      groups: null
    };
  }

  const resources = Array.from(resourceSet).sort();
  resources.push('Unassigned');

  return {
    resources: resources,
    groups: null
  };
}

/**
 * Create or reset the Resources sheet with Group and Bed columns
 */
function setupResourcesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let resourceSheet = ss.getSheetByName('Resources');

  if (!resourceSheet) {
    resourceSheet = ss.insertSheet('Resources');
  } else {
    // Clear existing content
    resourceSheet.clear();
  }

  // Set up headers
  resourceSheet.getRange('A1:B1').setValues([['Group', 'Bed']]);
  resourceSheet.getRange('A1:B1').setFontWeight('bold');
  resourceSheet.getRange('A1:B1').setBackground('#f3f3f3');

  // Add example data
  const exampleData = [
    ['North Field', 'Bed 1'],
    ['North Field', 'Bed 2'],
    ['North Field', 'Bed 3'],
    ['South Field', 'Bed 4'],
    ['South Field', 'Bed 5'],
    ['Greenhouse', 'GH Bed 1'],
    ['Greenhouse', 'GH Bed 2']
  ];
  resourceSheet.getRange(2, 1, exampleData.length, 2).setValues(exampleData);

  // Auto-resize columns
  resourceSheet.autoResizeColumn(1);
  resourceSheet.autoResizeColumn(2);

  SpreadsheetApp.getUi().alert(
    'Resources sheet created!\n\n' +
    'Edit the Group and Bed columns to define your beds.\n' +
    'Beds in the same group can be collapsed together in the planner.'
  );

  return { success: true };
}
