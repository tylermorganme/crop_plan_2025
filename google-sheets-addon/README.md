# Crop Planner - Proof of Concept

Simple test of draggable "paper doll" boxes in a Google Sheets sidebar.

## Setup

1. Create a new Google Sheet
2. Add test data with headers:
   - **A1**: `Name`
   - **B1**: `Start Date`
   - **C1**: `End Date`
   - **D1**: `Resource`

3. Add some rows, e.g.:
   | Name | Start Date | End Date | Resource |
   |------|------------|----------|----------|
   | Tomatoes | 4/1/2025 | 7/15/2025 | |
   | Lettuce | 3/15/2025 | 5/1/2025 | |
   | Carrots | 4/15/2025 | 8/1/2025 | |

4. Go to **Extensions > Apps Script**

5. Delete any existing code, then create these files:
   - `Code.gs` - paste contents from Code.gs
   - `Sidebar.html` - paste contents from Sidebar.html
   - `appsscript.json` - click gear icon (Project Settings), check "Show appsscript.json", then edit it

6. Save all files (Ctrl+S)

7. Reload your spreadsheet

8. Click **Crop Planner > Open Planner** in the menu

## What It Does

- Reads rows from your sheet (Name, Start Date, End Date, Resource)
- Shows draggable boxes in resource "lanes" (Bed 1, Bed 2, etc.)
- Drag a box to a different lane to assign it to that resource
- Updates column D in the sheet when you drop

## Next Steps

This is just a proof of concept. Future versions could:
- Show boxes on a timeline (Gantt-style)
- Read resources from a config range
- Support real-time polling
- Add more crop details (variety, revenue, etc.)
