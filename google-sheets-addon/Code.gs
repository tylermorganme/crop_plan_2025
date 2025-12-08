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

  // Skip header row
  const crops = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const name = row[cols['Name']];
    const start = row[cols['Start']];
    const end = row[cols['End']];

    if (name && start && end) {
      crops.push({
        id: row[cols['ID']] || '',
        rowIndex: i + 1,
        name: name,
        startDate: start instanceof Date ? start.toISOString() : start,
        endDate: end instanceof Date ? end.toISOString() : end,
        resource: cols['Resource'] !== undefined ? String(row[cols['Resource']] || '').trim() : ''
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
 * Get list of available resources from the Resource column
 * Returns unique values found + 'Unassigned' at the end
 * Also checks for a 'Resources' sheet or named range for predefined options
 */
function getResources() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const cols = getColumnMap(sheet);

  // First, try to get resources from a "Resources" sheet (if it exists)
  const resourceSheet = ss.getSheetByName('Resources');
  if (resourceSheet) {
    const lastRow = resourceSheet.getLastRow();
    if (lastRow >= 1) {
      const values = resourceSheet.getRange(1, 1, lastRow, 1).getValues();
      const resources = values.map(r => r[0]).filter(v => v && typeof v === 'string' && v.trim());
      if (resources.length > 0) {
        if (!resources.includes('Unassigned')) {
          resources.push('Unassigned');
        }
        return resources;
      }
    }
  }

  // If no Resource column in main sheet, return defaults
  if (cols['Resource'] === undefined) {
    return ['Bed 1', 'Bed 2', 'Bed 3', 'Bed 4', 'Bed 5', 'Unassigned'];
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return ['Bed 1', 'Bed 2', 'Bed 3', 'Bed 4', 'Bed 5', 'Unassigned'];
  }

  const resourceColNum = cols['Resource'] + 1;
  const values = sheet.getRange(2, resourceColNum, lastRow - 1, 1).getValues();

  // Collect unique non-empty resource values
  const resourceSet = new Set();
  for (const row of values) {
    const val = row[0];
    // Handle both strings and numbers
    if (val !== null && val !== undefined && val !== '') {
      const strVal = String(val).trim();
      if (strVal) {
        resourceSet.add(strVal);
      }
    }
  }

  // If no resources found in data, return defaults
  if (resourceSet.size === 0) {
    return ['Bed 1', 'Bed 2', 'Bed 3', 'Bed 4', 'Bed 5', 'Unassigned'];
  }

  // Convert to sorted array and add Unassigned at the end
  const resources = Array.from(resourceSet).sort();
  resources.push('Unassigned');

  return resources;
}
