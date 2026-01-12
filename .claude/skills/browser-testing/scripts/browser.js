#!/usr/bin/env node
/**
 * Browser Testing CLI
 *
 * Command-line interface for the browser testing server.
 * Starts the server automatically if not running.
 *
 * Usage:
 *   node browser.js <tool> [params as JSON]
 *   node browser.js browser_navigate '{"url": "http://localhost:3000"}'
 *   node browser.js browser_snapshot
 *   node browser.js browser_click '{"element": "Submit button", "ref": "E5"}'
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8787;
const SERVER_SCRIPT = path.join(__dirname, 'server.js');

// Parse flags from args (--headless, --headed)
function parseFlags(args) {
  const flags = [];
  const remaining = [];
  for (const arg of args) {
    if (arg === '--headless' || arg === '--headed') {
      flags.push(arg);
    } else {
      remaining.push(arg);
    }
  }
  return { flags, args: remaining };
}

// Check if server is running
async function isServerRunning() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${PORT}/status`, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Start server in background
function startServer(flags = []) {
  console.error('Starting browser server...');

  const child = spawn('node', [SERVER_SCRIPT, ...flags], {
    detached: true,
    stdio: 'ignore'
  });

  child.unref();

  // Wait a moment for server to start
  return new Promise(resolve => setTimeout(resolve, 2000));
}

// Call a tool on the server
async function callTool(tool, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);

    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path: `/${tool}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Main
async function main() {
  const { flags, args } = parseFlags(process.argv.slice(2));

  if (args.length === 0) {
    console.log(`Browser Testing CLI

Usage:
  node browser.js [--headless|--headed] <tool> [params as JSON]

Flags:
  --headed    Force visible browser window (default on most systems)
  --headless  Force invisible browser (default on Linux without DISPLAY)

Tools:
  Navigation:
    browser_navigate      {"url": "..."}
    browser_navigate_back {}

  Snapshots:
    browser_snapshot      {"filename": "..."}  (filename optional)
    browser_take_screenshot {"filename": "...", "fullPage": true}

  Interactions:
    browser_click         {"element": "...", "ref": "E#"}
    browser_hover         {"element": "...", "ref": "E#"}
    browser_type          {"element": "...", "ref": "E#", "text": "...", "submit": true}
    browser_fill_form     {"fields": [{"name": "...", "type": "textbox", "ref": "E#", "value": "..."}]}
    browser_select_option {"element": "...", "ref": "E#", "values": ["..."]}
    browser_press_key     {"key": "Enter"}
    browser_drag          {"startElement": "...", "startRef": "E#", "endElement": "...", "endRef": "E#"}

  JavaScript:
    browser_evaluate      {"function": "() => document.title"}
    browser_run_code      {"code": "async (page) => { ... }"}

  Debug:
    browser_console_messages {"level": "info"}
    browser_network_requests {"includeStatic": false}

  Wait:
    browser_wait_for      {"time": 2} or {"text": "..."} or {"textGone": "..."}

  Tabs:
    browser_tabs          {"action": "list|new|close|select", "index": 0}

  Browser:
    browser_resize        {"width": 1280, "height": 720}
    browser_close         {}

  Server:
    server_status         {}
    server_shutdown       {}

Examples:
  node browser.js browser_navigate '{"url": "http://localhost:3000"}'
  node browser.js browser_snapshot
  node browser.js browser_click '{"element": "Submit button", "ref": "E12"}'
  node browser.js browser_type '{"element": "Email input", "ref": "E5", "text": "test@example.com"}'
`);
    return;
  }

  const tool = args[0];
  let params = {};

  if (args[1]) {
    try {
      params = JSON.parse(args[1]);
    } catch (e) {
      console.error('Error: Invalid JSON parameters');
      console.error('Expected format: \'{"key": "value"}\'');
      process.exit(1);
    }
  }

  // Ensure server is running
  const running = await isServerRunning();
  if (!running) {
    await startServer(flags);

    // Verify it started
    const nowRunning = await isServerRunning();
    if (!nowRunning) {
      console.error('Failed to start server. Try running manually:');
      console.error(`  node ${SERVER_SCRIPT}`);
      process.exit(1);
    }
  }

  try {
    const result = await callTool(tool, params);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
