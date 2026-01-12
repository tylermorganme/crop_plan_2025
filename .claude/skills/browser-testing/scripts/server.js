#!/usr/bin/env node
/**
 * Browser Testing Server
 *
 * A lightweight HTTP server that provides browser automation using Playwright.
 * Mirrors the @playwright/mcp tool definitions exactly for consistency.
 *
 * Usage:
 *   node server.js [--port PORT] [--headless]
 *
 * The server maintains a persistent browser session until explicitly closed.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// Try to load playwright, give helpful error if not installed
let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  console.error('Playwright not installed. Run setup:');
  console.error('  cd .claude/skills/browser-testing && npm run setup');
  process.exit(1);
}

// Configuration
const DEFAULT_PORT = 8787;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const OUTPUT_DIR = '.claude-playwright'; // Screenshots, snapshots, etc.

// Global state
let browser = null;
let context = null;
let page = null;
let idleTimer = null;
let consoleMessages = [];
let networkRequests = [];

// Parse command line args
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : DEFAULT_PORT;

// Headless logic matches Microsoft's MCP:
// - Default to headed (visible browser)
// - Use headless on Linux without a display (CI/server environments)
// - Allow explicit override via --headless or --headed flags
const hasExplicitHeadless = args.includes('--headless');
const hasExplicitHeaded = args.includes('--headed');
const isLinuxNoDisplay = process.platform === 'linux' && !process.env.DISPLAY;
const headless = hasExplicitHeadless ? true : hasExplicitHeaded ? false : isLinuxNoDisplay;

// Reset idle timer
function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    console.log('Idle timeout reached, closing browser...');
    await closeBrowser();
    process.exit(0);
  }, IDLE_TIMEOUT_MS);
}

// Initialize browser
async function initBrowser() {
  if (browser) return;

  browser = await chromium.launch({ headless });
  context = await browser.newContext();
  page = await context.newPage();

  // Capture console messages
  page.on('console', msg => {
    consoleMessages.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now()
    });
  });

  // Capture network requests
  page.on('request', request => {
    networkRequests.push({
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      timestamp: Date.now()
    });
  });

  console.log('Browser initialized');
}

// Close browser
async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
    consoleMessages = [];
    networkRequests = [];
    console.log('Browser closed');
  }
}

// Get accessibility snapshot using Playwright's internal _snapshotForAI API
// This is the same API that Microsoft's MCP uses
async function getSnapshot() {
  if (!page) throw new Error('No page open. Navigate first.');

  // Use Playwright's internal API - same as Microsoft MCP
  const snapshot = await page._snapshotForAI({ track: 'response' });

  return {
    snapshot: snapshot.full || '',
    incremental: snapshot.incremental
  };
}

// Find element by ref using aria-ref selector (same as Microsoft MCP)
async function findElementByRef(ref) {
  // Use Playwright's aria-ref selector - same as Microsoft MCP
  return page.locator(`aria-ref=${ref}`);
}

// Tool handlers - mirror MCP exactly
const tools = {
  // Navigation
  async browser_navigate({ url }) {
    await initBrowser();
    await page.goto(url, { waitUntil: 'networkidle' });
    consoleMessages = [];
    networkRequests = [];
    const { snapshot } = await getSnapshot();
    return {
      url: page.url(),
      title: await page.title(),
      snapshot
    };
  },

  async browser_navigate_back() {
    if (!page) throw new Error('No page open');
    await page.goBack({ waitUntil: 'networkidle' });
    const { snapshot } = await getSnapshot();
    return { url: page.url(), snapshot };
  },

  // Snapshots
  async browser_snapshot({ filename }) {
    if (!page) throw new Error('No page open. Navigate first.');
    const { snapshot } = await getSnapshot();

    if (filename) {
      fs.writeFileSync(filename, snapshot);
      return { saved: filename };
    }

    return { snapshot };
  },

  async browser_take_screenshot({ type = 'png', filename, element, ref, fullPage }) {
    if (!page) throw new Error('No page open. Navigate first.');

    const options = { type };
    if (fullPage) options.fullPage = true;

    let target = page;
    if (ref) {
      target = await findElementByRef(ref);
    }

    // Default to OUTPUT_DIR if no path specified
    let finalFilename = filename || `page-${Date.now()}.${type}`;
    if (!filename || !path.isAbsolute(filename)) {
      // Ensure output directory exists
      if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      }
      finalFilename = path.join(OUTPUT_DIR, filename || `page-${Date.now()}.${type}`);
    }

    await target.screenshot({ ...options, path: finalFilename });

    return {
      screenshot: finalFilename,
      fullPath: path.resolve(finalFilename)
    };
  },

  // Interactions
  async browser_click({ element, ref, doubleClick, button = 'left', modifiers }) {
    if (!page) throw new Error('No page open');
    const locator = await findElementByRef(ref);

    const options = { button };
    if (modifiers) options.modifiers = modifiers;

    if (doubleClick) {
      await locator.dblclick(options);
    } else {
      await locator.click(options);
    }

    await page.waitForLoadState('networkidle').catch(() => {});
    const { snapshot } = await getSnapshot();
    return { clicked: element, snapshot };
  },

  async browser_hover({ element, ref }) {
    if (!page) throw new Error('No page open');
    const locator = await findElementByRef(ref);
    await locator.hover();
    const { snapshot } = await getSnapshot();
    return { hovered: element, snapshot };
  },

  async browser_type({ element, ref, text, submit, slowly }) {
    if (!page) throw new Error('No page open');
    const locator = await findElementByRef(ref);

    if (slowly) {
      await locator.pressSequentially(text);
    } else {
      await locator.fill(text);
    }

    if (submit) {
      await locator.press('Enter');
      await page.waitForLoadState('networkidle').catch(() => {});
    }

    const { snapshot } = await getSnapshot();
    return { typed: text, into: element, snapshot };
  },

  async browser_fill_form({ fields }) {
    if (!page) throw new Error('No page open');

    for (const field of fields) {
      const locator = await findElementByRef(field.ref);

      if (field.type === 'checkbox') {
        if (field.value === 'true') {
          await locator.check();
        } else {
          await locator.uncheck();
        }
      } else if (field.type === 'combobox') {
        await locator.selectOption(field.value);
      } else {
        await locator.fill(field.value);
      }
    }

    const { snapshot } = await getSnapshot();
    return { filled: fields.length, snapshot };
  },

  async browser_select_option({ element, ref, values }) {
    if (!page) throw new Error('No page open');
    const locator = await findElementByRef(ref);
    await locator.selectOption(values);
    const { snapshot } = await getSnapshot();
    return { selected: values, in: element, snapshot };
  },

  async browser_press_key({ key }) {
    if (!page) throw new Error('No page open');
    await page.keyboard.press(key);
    const { snapshot } = await getSnapshot();
    return { pressed: key, snapshot };
  },

  async browser_drag({ startElement, startRef, endElement, endRef }) {
    if (!page) throw new Error('No page open');
    const source = await findElementByRef(startRef);
    const target = await findElementByRef(endRef);
    await source.dragTo(target);
    const { snapshot } = await getSnapshot();
    return { dragged: startElement, to: endElement, snapshot };
  },

  // JavaScript evaluation
  async browser_evaluate({ function: fn, element, ref }) {
    if (!page) throw new Error('No page open');

    let result;
    if (ref) {
      const locator = await findElementByRef(ref);
      const handle = await locator.elementHandle();
      result = await page.evaluate(new Function('return ' + fn)(), handle);
    } else {
      result = await page.evaluate(new Function('return ' + fn)());
    }

    return { result };
  },

  async browser_run_code({ code }) {
    if (!page) throw new Error('No page open');
    const fn = new Function('page', `return (${code})(page)`);
    const result = await fn(page);
    const { snapshot } = await getSnapshot();
    return { result, snapshot };
  },

  // Console and network
  async browser_console_messages({ level = 'info' }) {
    const levels = ['error', 'warning', 'info', 'debug'];
    const minLevel = levels.indexOf(level);

    const typeMap = {
      'error': 0,
      'warning': 1,
      'warn': 1,
      'info': 2,
      'log': 2,
      'debug': 3
    };

    const filtered = consoleMessages.filter(msg => {
      const msgLevel = typeMap[msg.type] ?? 2;
      return msgLevel <= minLevel;
    });

    return { messages: filtered };
  },

  async browser_network_requests({ includeStatic = false }) {
    const staticTypes = ['image', 'font', 'stylesheet', 'media'];

    let filtered = networkRequests;
    if (!includeStatic) {
      filtered = networkRequests.filter(r => !staticTypes.includes(r.resourceType));
    }

    return { requests: filtered };
  },

  // Waiting
  async browser_wait_for({ time, text, textGone }) {
    if (!page) throw new Error('No page open');

    if (time) {
      await page.waitForTimeout(time * 1000);
      return { waited: `${time} seconds` };
    }

    if (text) {
      await page.waitForSelector(`text=${text}`, { state: 'visible' });
      return { found: text };
    }

    if (textGone) {
      await page.waitForSelector(`text=${textGone}`, { state: 'hidden' });
      return { gone: textGone };
    }

    throw new Error('Must specify time, text, or textGone');
  },

  // Dialogs
  async browser_handle_dialog({ accept, promptText }) {
    // This needs to be set up before the dialog appears
    // For now, just return guidance
    return {
      note: 'Dialog handling should be set up before triggering the dialog. Use browser_run_code to set up a dialog handler.'
    };
  },

  // File upload
  async browser_file_upload({ paths }) {
    if (!page) throw new Error('No page open');

    // Expect a file chooser to be triggered
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      // The click that triggers it should happen before this call
    ]).catch(() => [null]);

    if (fileChooser && paths) {
      await fileChooser.setFiles(paths);
      return { uploaded: paths };
    }

    return { note: 'Click on file input first, then call browser_file_upload' };
  },

  // Tabs
  async browser_tabs({ action, index }) {
    if (!context) throw new Error('No browser open');

    const pages = context.pages();

    if (action === 'list') {
      return {
        tabs: pages.map((p, i) => ({
          index: i,
          url: p.url(),
          title: p.title,
          active: p === page
        }))
      };
    }

    if (action === 'new') {
      page = await context.newPage();
      return { created: context.pages().length - 1 };
    }

    if (action === 'close') {
      const targetIndex = index ?? pages.indexOf(page);
      await pages[targetIndex].close();
      if (pages[targetIndex] === page) {
        page = context.pages()[0] || null;
      }
      return { closed: targetIndex };
    }

    if (action === 'select') {
      if (index === undefined) throw new Error('index required for select');
      page = pages[index];
      return { selected: index };
    }

    throw new Error(`Unknown action: ${action}`);
  },

  // Browser management
  async browser_resize({ width, height }) {
    if (!page) throw new Error('No page open');
    await page.setViewportSize({ width, height });
    return { resized: { width, height } };
  },

  async browser_close() {
    await closeBrowser();
    return { closed: true };
  },

  async browser_install() {
    // Browser is installed via: npx playwright install chromium
    return {
      note: 'Run: npx playwright install chromium',
      installed: false
    };
  },

  // Server management
  async server_status() {
    return {
      browserOpen: browser !== null,
      pageUrl: page ? page.url() : null,
      consoleMessages: consoleMessages.length,
      networkRequests: networkRequests.length
    };
  },

  async server_shutdown() {
    await closeBrowser();
    setTimeout(() => process.exit(0), 100);
    return { shuttingDown: true };
  }
};

// HTTP server
const server = http.createServer(async (req, res) => {
  resetIdleTimer();

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parse URL
  const url = new URL(req.url, `http://localhost:${port}`);
  const toolName = url.pathname.slice(1); // Remove leading /

  // GET /status - quick status check
  if (req.method === 'GET' && toolName === 'status') {
    const status = await tools.server_status();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return;
  }

  // POST /<tool_name> - execute tool
  if (req.method === 'POST') {
    const tool = tools[toolName];

    if (!tool) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown tool: ${toolName}` }));
      return;
    }

    // Parse body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let params = {};
    if (body) {
      try {
        params = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }
    }

    try {
      const result = await tool(params);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET / - list available tools
  if (req.method === 'GET' && toolName === '') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      tools: Object.keys(tools),
      port,
      headless
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`Browser testing server running on http://localhost:${port}`);
  console.log(`Headless: ${headless}`);
  console.log(`Idle timeout: ${IDLE_TIMEOUT_MS / 1000 / 60} minutes`);
  console.log('\nAvailable tools:');
  Object.keys(tools).forEach(t => console.log(`  POST /${t}`));
  resetIdleTimer();
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});
