---
name: code-quality
description: Run code quality checks including duplication detection (jscpd), unused dependency analysis (depcheck), and complexity metrics. Use when the user asks to check code quality, find duplicate code, detect copy-paste, find unused packages, or analyze code complexity.
---

# Code Quality Skill

Run automated code quality checks on the codebase.

## Available Scripts

All scripts are in `scripts/` and output results to stdout.

### Duplication Detection (jscpd)

Finds copy-pasted code blocks:

```bash
node .claude/skills/code-quality/scripts/check-duplication.js [path] [--threshold N]
```

- `path`: Directory to scan (default: `src/`)
- `--threshold N`: Fail if duplication exceeds N% (default: 5)
- `--min-lines N`: Minimum lines to consider a clone (default: 10)

### Unused Dependencies (depcheck)

Finds packages in package.json that aren't imported:

```bash
node .claude/skills/code-quality/scripts/check-deps.js [path]
```

- `path`: Project root with package.json (default: current directory)

### Complexity Analysis

Reports functions exceeding complexity thresholds:

```bash
node .claude/skills/code-quality/scripts/check-complexity.js [path] [--max-complexity N]
```

- `path`: Directory to scan (default: `src/`)
- `--max-complexity N`: Report functions exceeding this cyclomatic complexity (default: 10)

## Quick Start

Run all checks:

```bash
# From project root
node .claude/skills/code-quality/scripts/check-duplication.js crop-api/src/lib
node .claude/skills/code-quality/scripts/check-deps.js crop-api
node .claude/skills/code-quality/scripts/check-complexity.js crop-api/src/lib
```

## CI Integration

Add to CI pipeline to enforce quality gates:

```bash
# Fail if duplication > 3%
npx jscpd src/lib --min-lines 10 --threshold 3

# Fail if unused deps found
npx depcheck --ignores="@types/*"
```
