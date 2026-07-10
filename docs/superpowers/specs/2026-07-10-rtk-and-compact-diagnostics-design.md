# RTK First-Class Integration & Compact Diagnostics Design

Date: 2026-07-10

## Point 1 — RTK as First-Class Integration

### What changes
Add a `## RTK Integration` section to `README.md` covering:
- What RTK is and when to install it
- Command table: which `rtk` wrapper to use and why
- Fallback path: use `--status-summary`, `--diff-summary`, `--test-summary` if RTK is absent

Templates (`RULES.md`, `WORKFLOW.md`) already have correct guidance — no changes needed.

## Point 2 — Compact Diagnostics CLI

### New file: `bin/lib/diagnostics.ts`

Three exported functions, one file (shared `spawnSync` and formatting logic):

| Flag | Command run internally | Output |
|---|---|---|
| `--status-summary` | `git status --short` + `git log -1 --oneline` | Markdown: branch, staged/unstaged counts, file list |
| `--diff-summary` | `git diff --stat HEAD` | Markdown: changed files table + net lines |
| `--test-summary` | Auto-detect scripts from `package.json` (typecheck → lint → test → build) | Markdown: per-command pass/fail + truncated stderr on failure |

### Wiring
- `bin/lib/context.ts`: export `statusSummary`, `diffSummary`, `testSummary` flags
- `bin/forgeai-init.ts`: dispatch to the three functions
- `bin/lib/init.ts` `usage()`: document all three flags

### Tests: `test/diagnostics.test.ts`
- `--status-summary` outputs markdown with branch and file counts in a temp git repo
- `--diff-summary` outputs markdown with changed files
- `--test-summary` auto-detects and runs scripts, reports pass/fail
- all three: graceful output when git is not initialised or package.json is absent

### README section placement
After `### Compact Delegation Context`, before `## Model Routing`.
