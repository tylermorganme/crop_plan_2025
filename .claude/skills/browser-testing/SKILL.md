---
name: browser-testing
description: |
  Browser automation for testing and verification. Use after building or modifying web UI to verify changes work. Uses Playwright's accessibility tree, not pixel-based input. LLM-friendly: no vision models needed, operates purely on structured data. Deterministic tool application avoids ambiguity common with screenshot-based approaches.

  Triggers: testing localhost, verifying UI changes, checking if a feature works, taking screenshots, debugging console errors, testing form submission, end-to-end verification, "does it work", "let me check the browser", "test the app", browser automation, web testing.
---

# Browser Testing

Browser automation using Playwright. Provides structured accessibility snapshots for deterministic interactions.

## Quick Start

```bash
# Navigate and get snapshot
node scripts/browser.js browser_navigate '{"url": "http://localhost:3000"}'

# Snapshot returns element refs like [ref=e2], [ref=e3], etc.
# Use these refs for subsequent interactions
node scripts/browser.js browser_click '{"element": "Submit button", "ref": "e7"}'
```

## Key Concept: Refs

The `browser_navigate` and other tools return an accessibility tree with element references:

```
- generic [ref=e2]:
  - heading "Example Domain" [level=1] [ref=e3]
  - paragraph [ref=e4]: This domain is for use in...
  - link "Learn more" [ref=e6] [cursor=pointer]
```

Use these refs (`e3`, `e6`, etc.) to target elements. Refs persist across the session.

## Common Tools

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Open URL, returns snapshot |
| `browser_snapshot` | Get current accessibility tree |
| `browser_click` | Click element by ref |
| `browser_type` | Type into input by ref |
| `browser_take_screenshot` | Capture image |
| `browser_console_messages` | Get console output |
| `browser_close` | End session |

For full tool parameters, see [references/tools.md](references/tools.md).

## Workflow

1. `browser_navigate` to open page (returns snapshot with refs)
2. Find ref for target element in snapshot
3. Use ref with `browser_click`, `browser_type`, etc.
4. Each action returns updated snapshot
5. `browser_close` when done (or 30min idle timeout)

## Setup

```bash
cd .claude/skills/browser-testing
npm run setup
```
