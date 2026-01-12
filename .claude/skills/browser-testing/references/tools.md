# Tools Reference

All tools mirror [@playwright/mcp](https://github.com/microsoft/playwright-mcp) exactly.

## Navigation

**browser_navigate** - Navigate to a URL
```json
{"url": "http://localhost:3000"}
```

**browser_navigate_back** - Go back to the previous page

## Snapshots

**browser_snapshot** - Capture accessibility snapshot of the current page, this is better than screenshot
```json
{"filename": "snapshot.md"}  // optional, saves to file
```

**browser_take_screenshot** - Take a screenshot of the current page. You can't perform actions based on the screenshot, use browser_snapshot for actions.
```json
{
  "type": "png",           // or "jpeg"
  "filename": "shot.png",  // optional
  "fullPage": true,        // optional
  "element": "Header",     // optional, with ref
  "ref": "e0"              // optional, screenshot specific element
}
```

## Interactions

**browser_click** - Perform click on a web page
```json
{
  "element": "Human-readable element description",
  "ref": "e7",
  "doubleClick": false,   // optional
  "button": "left",       // optional: left, right, middle
  "modifiers": ["Shift"]  // optional: Alt, Control, Meta, Shift
}
```

**browser_hover** - Hover over element on page
```json
{"element": "Menu item", "ref": "e3"}
```

**browser_type** - Type text into editable element
```json
{
  "element": "Email input",
  "ref": "e5",
  "text": "test@example.com",
  "submit": true,   // optional, press Enter after
  "slowly": false   // optional, type one char at a time
}
```

**browser_fill_form** - Fill multiple form fields
```json
{
  "fields": [
    {"name": "Email", "type": "textbox", "ref": "e5", "value": "test@example.com"},
    {"name": "Password", "type": "textbox", "ref": "e6", "value": "secret"},
    {"name": "Remember", "type": "checkbox", "ref": "e8", "value": "true"}
  ]
}
```

**browser_select_option** - Select an option in a dropdown
```json
{
  "element": "Country dropdown",
  "ref": "e10",
  "values": ["USA"]  // can be multiple for multi-select
}
```

**browser_press_key** - Press a key on the keyboard
```json
{"key": "Enter"}  // ArrowLeft, ArrowRight, Tab, Escape, etc.
```

**browser_drag** - Perform drag and drop between two elements
```json
{
  "startElement": "Draggable item",
  "startRef": "e5",
  "endElement": "Drop zone",
  "endRef": "e10"
}
```

## JavaScript

**browser_evaluate** - Evaluate JavaScript expression on page or element
```json
{"function": "() => document.title"}
{"function": "(el) => el.textContent", "element": "Header", "ref": "e0"}
```

**browser_run_code** - Run Playwright code snippet
```json
{"code": "async (page) => { await page.getByRole('button', { name: 'Submit' }).click(); return await page.title(); }"}
```

## Debug

**browser_console_messages** - Returns all console messages
```json
{"level": "info"}  // error, warning, info, debug
```

**browser_network_requests** - Returns all network requests since loading the page
```json
{"includeStatic": false}  // set true to include images, fonts, etc.
```

## Wait

**browser_wait_for** - Wait for text to appear or disappear or a specified time to pass
```json
{"time": 2}           // wait 2 seconds
{"text": "Success"}   // wait for text to appear
{"textGone": "Loading..."}  // wait for text to disappear
```

## Tabs

**browser_tabs** - List, create, close, or select a browser tab
```json
{"action": "list"}
{"action": "new"}
{"action": "close", "index": 1}
{"action": "select", "index": 0}
```

## Browser

**browser_resize** - Resize the browser window
```json
{"width": 1280, "height": 720}
```

**browser_close** - Close the page

**browser_install** - Install the browser. Run: `npx playwright install chromium`

## Server

**server_status** - Check if browser is open, current URL

**server_shutdown** - Stop the server and close browser
