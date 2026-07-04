# Phase 7 — Memory & Knowledge Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the `MEMORY.md` template around the sections agents need and add a `--check-memory` gate that flags dead path references (FAIL), leftover TODOs, over-age entries, and malformed decision entries (WARN).

**Architecture:** A new `bin/lib/memory.ts` checker follows the `bin/lib/security.ts` pattern — exported pure helpers plus a `runCheckMemory()` entry point — wired into `bin/forgeai-init.ts` via a `--check-memory` flag and appended to `runCheckAll()`. Configuration is one inline HTML-comment directive in `MEMORY.md` (`<!-- forgeai-memory: max-age-days=180 -->`); no new config file.

**Tech Stack:** TypeScript (Node built-ins only: `node:fs`, `node:path`), `node:test` + tsx for tests, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-03-phase-7-memory-knowledge-management-design.md`

## Global Constraints

- Zero new runtime dependencies; checker stays offline (no network calls).
- Only dead path references may exit non-zero; all structural signals are WARN-only (upgraded repos keep old formats — the gate must not hard-fail them).
- Default age threshold is exactly `180` days; directive key is exactly `max-age-days`.
- The shipped `templates/.ai/MEMORY.md` must produce zero FAILs against the checker (warns are expected and intentional).
- `--upgrade` behavior for `MEMORY.md` is untouched (it already preserves populated files).
- All commits are made by the human. Every "Checkpoint" step means: STOP, report what changed, and ask the human to commit with the suggested message. Never run `git commit`.
- Tests run with `npm test` (whole suite) or `npx tsx --test test/memory.test.ts` (one file). The existing suite has 85 passing tests; it must stay green.

---

### Task 1: Checker skeleton and `--check-memory` flag

**Files:**
- Create: `bin/lib/memory.ts`
- Create: `test/memory.test.ts`
- Modify: `bin/lib/context.ts` (after line 29, `checkSecurity`)
- Modify: `bin/forgeai-init.ts` (imports + dispatch chain around line 45)
- Modify: `bin/lib/init.ts` (usage text: command list ~line 20, options block ~line 52)

**Interfaces:**
- Consumes: `root` from `bin/lib/context.js`; `formatStatus` from `bin/lib/utils.js`; test helpers `cli`, `runTs`, `ExecError` from `test/helpers.js`.
- Produces: `runCheckMemory(): void` (used by Task 6's `runCheckAll`); `MemoryFinding` type `{ severity: 'fail' | 'warn'; location: string; detail: string }` and the internal `collectFindings(text: string): MemoryFinding[]` seam that Tasks 2–4 extend. CLI output starts with the line `ForgeAI memory check` and ends with a `Result: ...` line.

- [ ] **Step 1: Write the failing tests**

Create `test/memory.test.ts`:

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

// Writes a .ai/MEMORY.md fixture without running a full init.
export function writeMemory(target: string, content: string): void {
  fs.mkdirSync(path.join(target, '.ai'), { recursive: true });
  fs.writeFileSync(path.join(target, '.ai', 'MEMORY.md'), content);
}

export function runCheckMemoryCli(target: string): { output: string; failed: boolean } {
  try {
    const output = runTs(cli, ['--check-memory'], {
      cwd: target,
      env: { ...process.env, PATH: '' }
    });
    return { output, failed: false };
  } catch (error) {
    const execError = error as ExecError;
    return { output: String(execError.stdout ?? ''), failed: true };
  }
}

test('check-memory passes on a minimal populated memory file', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-ok-'));

  try {
    writeMemory(target, '# Project Memory\n\n## Commands\n\n- Build: run the standard build.\n');

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /ForgeAI memory check/);
    assert.match(output, /ok\s+no stale-memory signals detected/);
    assert.match(output, /Result: memory check passed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory fails when .ai/MEMORY.md is missing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-missing-'));

  try {
    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, true);
    assert.match(output, /fail\s+\.ai\/MEMORY\.md not found/);
    assert.match(output, /Result: memory check failed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/memory.test.ts`
Expected: both tests FAIL — without the flag the CLI falls through to `runInit()`, so the output is init output, not `ForgeAI memory check` (the first test's `assert.match` fails; the second fails because init succeeds instead of exiting non-zero).

- [ ] **Step 3: Create `bin/lib/memory.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { root } from './context.js';
import { formatStatus } from './utils.js';

export type MemoryFinding = { severity: 'fail' | 'warn'; location: string; detail: string };

export const MEMORY_RELATIVE_PATH = '.ai/MEMORY.md';

// Tasks 2-4 extend this with the individual stale-memory signals.
export function collectFindings(text: string): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  void text;
  return findings;
}

export function runCheckMemory(): void {
  console.log('ForgeAI memory check');
  console.log('');

  const memoryPath = path.join(root, MEMORY_RELATIVE_PATH);
  if (!fs.existsSync(memoryPath)) {
    console.log(formatStatus('fail', `${MEMORY_RELATIVE_PATH} not found`));
    console.log('');
    console.log('Result: memory check failed. Run npx forgeai-agentic-init to install the harness.');
    process.exitCode = 1;
    return;
  }

  const text = fs.readFileSync(memoryPath, 'utf8');
  const findings = collectFindings(text);

  if (findings.length === 0) {
    console.log(formatStatus('ok', 'no stale-memory signals detected'));
  } else {
    for (const finding of findings) {
      console.log(formatStatus(finding.severity, `${finding.location}: ${finding.detail}`));
    }
  }

  console.log('');
  if (findings.some((finding) => finding.severity === 'fail')) {
    console.log('Result: memory check failed. Fix or remove entries that reference missing paths.');
    process.exitCode = 1;
    return;
  }
  if (findings.length > 0) {
    console.log(
      'Result: memory check passed with warnings. Re-validate stale entries, fill TODOs, and prune superseded knowledge.'
    );
    return;
  }
  console.log('Result: memory check passed.');
}
```

- [ ] **Step 4: Wire the flag**

In `bin/lib/context.ts`, after the `checkSecurity` export (line 29):

```ts
export const checkMemory = args.has('--check-memory');
```

In `bin/forgeai-init.ts`: add `checkMemory` to the `./lib/context.js` import list, add `import { runCheckMemory } from './lib/memory.js';` next to the other `runCheck*` imports, and add this branch directly after the `checkSecurity` line (line 45):

```ts
else if (checkMemory) runCheckMemory();
```

In `bin/lib/init.ts` usage text: add `  forgeai-init --check-memory` after the `--check-security` line in the command list, and add to the options block after the `--check-security` description:

```text
  --check-memory
                Validate .ai/MEMORY.md for stale knowledge (dead path
                references, leftover TODOs, over-age entries, malformed
                decision entries).
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test test/memory.test.ts`
Expected: 2 pass, 0 fail.

- [ ] **Step 6: Checkpoint — human commits**

Report the change and suggest: `feat(memory): add --check-memory command skeleton`

---

### Task 2: Dead path reference signal (the only FAIL)

**Files:**
- Modify: `bin/lib/memory.ts`
- Test: `test/memory.test.ts`

**Interfaces:**
- Produces: `findDeadPathRefs(text: string, rootDir: string): MemoryFinding[]` and helper `looksLikeRepoPath(token: string): boolean` (not exported). `collectFindings` gains a `rootDir` parameter: `collectFindings(text: string, rootDir: string): MemoryFinding[]` — `runCheckMemory` passes `root`.

- [ ] **Step 1: Write the failing tests**

Append to `test/memory.test.ts`:

```ts
test('check-memory fails on a dead path reference', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-deadpath-'));

  try {
    writeMemory(target, '# Project Memory\n\n## Coding conventions\n\n- API clients live in `src/api/client.ts`.\n');

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, true);
    assert.match(output, /fail\s+\.ai\/MEMORY\.md:5: references missing path `src\/api\/client\.ts`/);
    assert.match(output, /Result: memory check failed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory accepts existing paths and skips non-path tokens', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-livepath-'));

  try {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'index.ts'), 'export {};\n');
    writeMemory(
      target,
      [
        '# Project Memory',
        '',
        '## Coding conventions',
        '',
        '- Entry point is `src/index.ts:1`.',
        '- Feature APIs follow `src/features/*/*Api.ts`.',
        '- Placeholders like `<service-name>` and `TODO.md` patterns are skipped.',
        '- Packages like `@types/node` and URLs like `https://example.com/a.ts` are skipped.',
        '- Commands like `npm run build` are skipped.',
        ''
      ].join('\n')
    );

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.doesNotMatch(output, /references missing path/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

Note: `TODO.md` is skipped by the path heuristic (contains `TODO`) but the literal `TODO` text will produce a WARN once Task 3 lands; this test only asserts no dead-path failure.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/memory.test.ts`
Expected: the dead-path test FAILS (check currently passes — no signal implemented); the skip test passes vacuously.

- [ ] **Step 3: Implement the signal**

Add to `bin/lib/memory.ts` (above `collectFindings`):

```ts
const PATH_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml|py|rb|go|rs|java|kt|swift|sh|bash|zsh|ps1|css|scss|html|sql|toml|txt)$/i;

// A token counts as a repo path only when it has a known source extension or
// a trailing slash (directory reference). Everything ambiguous is skipped so
// prose, commands, package names, globs, and placeholders never fail the gate.
function looksLikeRepoPath(token: string): boolean {
  if (token.includes('*') || token.includes('<') || token.includes(' ')) return false;
  if (token.includes('TODO') || token.includes('YYYY')) return false;
  if (token.startsWith('-') || token.startsWith('@') || token.startsWith('/') || token.startsWith('~')) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return false;
  const withoutLineRef = token.replace(/:\d+([-,]\d+)?$/, '');
  if (withoutLineRef.endsWith('/')) return true;
  return PATH_EXTENSIONS.test(withoutLineRef);
}

export function findDeadPathRefs(text: string, rootDir: string): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const token = match[1].trim();
      if (!looksLikeRepoPath(token)) continue;
      const cleaned = token.replace(/^\.\//, '').replace(/:\d+([-,]\d+)?$/, '');
      if (!fs.existsSync(path.join(rootDir, cleaned))) {
        findings.push({
          severity: 'fail',
          location: `${MEMORY_RELATIVE_PATH}:${index + 1}`,
          detail: `references missing path \`${token}\``
        });
      }
    }
  });
  return findings;
}
```

Change `collectFindings` and its call site in `runCheckMemory`:

```ts
export function collectFindings(text: string, rootDir: string): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  findings.push(...findDeadPathRefs(text, rootDir));
  return findings;
}
```

```ts
  const findings = collectFindings(text, root);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/memory.test.ts`
Expected: 4 pass, 0 fail.

- [ ] **Step 5: Checkpoint — human commits**

Suggest: `feat(memory): fail check-memory on dead path references`

---

### Task 3: TODO, age-threshold, and directive signals

**Files:**
- Modify: `bin/lib/memory.ts`
- Test: `test/memory.test.ts`

**Interfaces:**
- Produces: `parseMaxAgeDays(text: string): { maxAgeDays: number; warning: string | null }`, `findTodoPlaceholders(text: string): MemoryFinding[]`, `findStaleEntries(text: string, maxAgeDays: number, now: Date): MemoryFinding[]`, exported constants `DEFAULT_MAX_AGE_DAYS = 180` and `DATED_HEADING` (regex matching `### YYYY-MM-DD — Title` with em-dash or hyphen). Task 4 reuses `DATED_HEADING`.

- [ ] **Step 1: Write the failing tests**

Append to `test/memory.test.ts`:

```ts
test('check-memory warns on TODO placeholders without failing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-todo-'));

  try {
    writeMemory(target, '# Project Memory\n\n## Business rules\n\n- TODO: Rule that must not be broken.\n');

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md:5: unfilled TODO placeholder/);
    assert.match(output, /Result: memory check passed with warnings\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory warns on entries older than the age threshold', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-stale-'));

  try {
    writeMemory(
      target,
      [
        '# Project Memory',
        '',
        '## Architecture decisions',
        '',
        '### 2020-01-01 — Ancient decision',
        '',
        '- **Decision:** Something old.',
        '- **Why:** Reasons.',
        '- **Impact:** Still assumed.',
        ''
      ].join('\n')
    );

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md:5: entry dated 2020-01-01 is older than 180 days/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory respects the max-age-days directive', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-directive-'));

  try {
    writeMemory(
      target,
      [
        '<!-- forgeai-memory: max-age-days=100000 -->',
        '# Project Memory',
        '',
        '## Architecture decisions',
        '',
        '### 2020-01-01 — Ancient but accepted',
        '',
        '- **Decision:** Something old.',
        '- **Why:** Reasons.',
        '- **Impact:** Still assumed.',
        ''
      ].join('\n')
    );

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.doesNotMatch(output, /is older than/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-memory warns and falls back on an invalid directive value', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-badvalue-'));

  try {
    writeMemory(
      target,
      '<!-- forgeai-memory: max-age-days=soon -->\n# Project Memory\n\n## Commands\n\n- Build: standard.\n'
    );

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md: invalid forgeai-memory max-age-days value "soon"; using default 180/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/memory.test.ts`
Expected: the TODO, stale-entry, and invalid-directive tests FAIL (no warns emitted yet); the directive-respected test passes vacuously.

- [ ] **Step 3: Implement the signals**

Add to `bin/lib/memory.ts`:

```ts
export const DEFAULT_MAX_AGE_DAYS = 180;
export const DATED_HEADING = /^###\s+(\d{4}-\d{2}-\d{2})\s+[—-]\s+(.+)$/;
const DIRECTIVE_PATTERN = /<!--\s*forgeai-memory:\s*([^>]*?)\s*-->/;

export function parseMaxAgeDays(text: string): { maxAgeDays: number; warning: string | null } {
  const directive = text.match(DIRECTIVE_PATTERN);
  if (!directive) return { maxAgeDays: DEFAULT_MAX_AGE_DAYS, warning: null };
  const value = directive[1].match(/max-age-days\s*=\s*(\S+)/);
  if (!value) return { maxAgeDays: DEFAULT_MAX_AGE_DAYS, warning: null };
  const parsed = Number(value[1]);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      maxAgeDays: DEFAULT_MAX_AGE_DAYS,
      warning: `invalid forgeai-memory max-age-days value "${value[1]}"; using default ${DEFAULT_MAX_AGE_DAYS}`
    };
  }
  return { maxAgeDays: parsed, warning: null };
}

export function findTodoPlaceholders(text: string): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (/\bTODO\b/.test(line)) {
      findings.push({
        severity: 'warn',
        location: `${MEMORY_RELATIVE_PATH}:${index + 1}`,
        detail: 'unfilled TODO placeholder'
      });
    }
  });
  return findings;
}

export function findStaleEntries(text: string, maxAgeDays: number, now: Date): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  text.split(/\r?\n/).forEach((line, index) => {
    const heading = line.match(DATED_HEADING);
    if (!heading) return;
    const entryTime = Date.parse(heading[1]);
    if (Number.isNaN(entryTime) || entryTime >= cutoff) return;
    findings.push({
      severity: 'warn',
      location: `${MEMORY_RELATIVE_PATH}:${index + 1}`,
      detail: `entry dated ${heading[1]} is older than ${maxAgeDays} days; re-validate or prune`
    });
  });
  return findings;
}
```

Extend `collectFindings`:

```ts
export function collectFindings(text: string, rootDir: string): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  const { maxAgeDays, warning } = parseMaxAgeDays(text);
  if (warning) findings.push({ severity: 'warn', location: MEMORY_RELATIVE_PATH, detail: warning });
  findings.push(
    ...findDeadPathRefs(text, rootDir),
    ...findTodoPlaceholders(text),
    ...findStaleEntries(text, maxAgeDays, new Date())
  );
  return findings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/memory.test.ts`
Expected: 8 pass, 0 fail.

- [ ] **Step 5: Checkpoint — human commits**

Suggest: `feat(memory): warn on TODOs and over-age entries with directive override`

---

### Task 4: Malformed decision-entry signal

**Files:**
- Modify: `bin/lib/memory.ts`
- Test: `test/memory.test.ts`

**Interfaces:**
- Consumes: `DATED_HEADING` from Task 3.
- Produces: `findMalformedEntries(text: string): MemoryFinding[]` — scans only the `## Architecture decisions` section.

- [ ] **Step 1: Write the failing tests**

Append to `test/memory.test.ts`:

```ts
test('check-memory warns on malformed decision entries', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-malformed-'));

  try {
    writeMemory(
      target,
      [
        '# Project Memory',
        '',
        '## Architecture decisions',
        '',
        '### We picked a database',
        '',
        '- We use SQLite.',
        '',
        '### 2026-07-01 — Missing fields',
        '',
        '- **Decision:** Use SQLite.',
        '',
        '## Commands',
        '',
        '### No date needed here',
        '',
        '- Build: standard.',
        ''
      ].join('\n')
    );

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md:5: decision heading does not match "### YYYY-MM-DD — Title"/);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md:9: decision entry is missing \*\*Why:\*\*/);
    assert.match(output, /warn\s+\.ai\/MEMORY\.md:9: decision entry is missing \*\*Impact:\*\*/);
    assert.doesNotMatch(output, /:15:/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

The final assertion pins the section boundary: the dateless `### No date needed here` heading at line 15 sits under `## Commands` and must not be flagged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/memory.test.ts`
Expected: the new test FAILS (no malformed-entry warns emitted).

- [ ] **Step 3: Implement the signal**

Add to `bin/lib/memory.ts`:

```ts
export function findMalformedEntries(text: string): MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  const lines = text.split(/\r?\n/);
  let inDecisions = false;
  let entryStart = -1;
  let entryBody: string[] = [];

  const flushEntry = () => {
    if (entryStart === -1) return;
    const body = entryBody.join('\n');
    for (const field of ['Decision', 'Why', 'Impact']) {
      if (!body.includes(`**${field}:**`)) {
        findings.push({
          severity: 'warn',
          location: `${MEMORY_RELATIVE_PATH}:${entryStart + 1}`,
          detail: `decision entry is missing **${field}:**`
        });
      }
    }
    entryStart = -1;
    entryBody = [];
  };

  lines.forEach((line, index) => {
    if (/^##\s/.test(line)) {
      flushEntry();
      inDecisions = /^##\s+Architecture decisions\b/.test(line);
      return;
    }
    if (!inDecisions) return;
    if (/^###\s/.test(line)) {
      flushEntry();
      if (!DATED_HEADING.test(line)) {
        findings.push({
          severity: 'warn',
          location: `${MEMORY_RELATIVE_PATH}:${index + 1}`,
          detail: 'decision heading does not match "### YYYY-MM-DD — Title"'
        });
        return;
      }
      entryStart = index;
      return;
    }
    if (entryStart !== -1) entryBody.push(line);
  });
  flushEntry();
  return findings;
}
```

Add `...findMalformedEntries(text)` as the last spread in `collectFindings`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/memory.test.ts`
Expected: 9 pass, 0 fail. Then run `npm test` — all existing tests still pass.

- [ ] **Step 5: Checkpoint — human commits**

Suggest: `feat(memory): warn on malformed decision entries`

---

### Task 5: Restructured `MEMORY.md` template

**Files:**
- Rewrite: `templates/.ai/MEMORY.md`
- Test: `test/memory.test.ts`

**Interfaces:**
- Consumes: the full checker from Tasks 1–4.
- Produces: the template every fresh `npx forgeai-agentic-init` ships. Constraint from the spec: example paths must be globs or `<placeholder>` forms the checker skips, or paths that exist in a fresh install — zero FAILs against the checker.

- [ ] **Step 1: Write the failing test**

Append to `test/memory.test.ts`:

```ts
test('freshly initialized template passes check-memory with only warns', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-fresh-'));

  try {
    runTs(cli, [], { cwd: target, env: { ...process.env, PATH: '' } });

    const { output, failed } = runCheckMemoryCli(target);

    assert.equal(failed, false);
    assert.match(output, /unfilled TODO placeholder/);
    assert.match(output, /Result: memory check passed with warnings\./);

    const template = fs.readFileSync(path.join(target, '.ai', 'MEMORY.md'), 'utf8');
    assert.match(template, /<!-- forgeai-memory: max-age-days=180 -->/);
    assert.match(template, /## Recurring bugs & pitfalls/);
    assert.match(template, /## Commands/);
    assert.match(template, /## Test strategy/);
    assert.match(template, /## Ownership/);
    assert.match(template, /## Deployment notes/);
    assert.doesNotMatch(template, /Jira|Trello|External integrations/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/memory.test.ts`
Expected: FAILS — the current template lacks the directive and new sections and still contains the Jira table.

- [ ] **Step 3: Rewrite the template**

Replace the full contents of `templates/.ai/MEMORY.md` with:

```markdown
<!-- forgeai-memory: max-age-days=180 -->

# Project Memory

This file is durable project memory. Only record information that is
expected to remain true for weeks or months. Every agent session reads this
file before making changes, so a wrong entry here silently misleads all
future work.

## How to use this file

- Add an entry when the team makes a decision future agents must remember.
- Do not store temporary task notes here; use `.ai/state/CURRENT.md`.
- Date decision entries as `### YYYY-MM-DD — Title`. The directive at the
  top of this file sets when entries are flagged for re-validation by
  `npx forgeai-agentic-init --check-memory` (default: 180 days).
- When the checker flags an entry, re-validate it: update the date if it
  still holds, rewrite it if it changed, delete it if it is superseded.
  See `.ai/workflows/memory-management.md`.

## Architecture decisions

### YYYY-MM-DD — Decision title

- **Decision:** TODO
- **Why:** TODO
- **Impact:** TODO

## Coding conventions

- TODO: Example: feature API clients follow `src/features/*/*Api.ts`.
- TODO: Example: shared UI components live under a `<components-dir>` folder.
- TODO: Example: use named exports for utilities.

## Business rules

- TODO: Rule that must not be broken by future agents.

## Recurring bugs & pitfalls

Record bugs or patterns that happened before so agents do not repeat them.

| Date | Pitfall | Prevention |
| --- | --- | --- |
| TODO | TODO | TODO |

## Commands

Repo-specific commands agents must use instead of guessing.

| Purpose | Command | Notes |
| --- | --- | --- |
| Build | TODO | TODO |
| Test | TODO | TODO |
| Lint | TODO | TODO |

## Test strategy

- TODO: What must be run before a change is considered validated.
- TODO: Where tests live and how new ones should be structured.
- TODO: Coverage or evidence expectations for the review gate.

## Ownership

| Area | Owner | Notes |
| --- | --- | --- |
| TODO | TODO | TODO |

## Deployment notes

- TODO: How releases are cut and what must be checked first.
- TODO: Environments and their differences.
- TODO: Rollback procedure.
```

Why this passes the checker with zero FAILs: `src/features/*/*Api.ts` contains `*` (skipped), `<components-dir>` contains `<` (skipped), `.ai/state/CURRENT.md` and `.ai/workflows/memory-management.md` exist in a fresh install (the workflow file ships in Task 6 — see ordering note below), `### YYYY-MM-DD — Decision title` contains `YYYY` so the dead-path scan ignores it (it still produces an intentional malformed-heading WARN plus TODO WARNs, which is the desired bootstrap nudge).

**Ordering note:** this template references `.ai/workflows/memory-management.md`, created in Task 6. Until Task 6 lands, the fresh-init test in Step 1 will FAIL on a dead path reference. If executing tasks strictly in order, create the workflow file in this task instead (move Task 6 Step 3 here) or execute Tasks 5 and 6 together before running the fresh-init test. Recommended: move Task 6's workflow-file creation into this task's Step 3 and treat Task 6 as wiring/docs only.

- [ ] **Step 4: Create `templates/.ai/workflows/memory-management.md`** (moved from Task 6 per the ordering note)

```markdown
# Memory Management Workflow

`.ai/MEMORY.md` is read by every agent session. This workflow keeps it
trustworthy.

## When to add an entry

- A decision is made that should hold for weeks or months (architecture,
  conventions, business rules, ownership, deployment).
- A bug or pitfall recurs and future agents must avoid it.
- A command or validation step is discovered that agents would otherwise
  guess wrong.

Do not add temporary task state (use `.ai/state/CURRENT.md`) or anything
already enforced by code, lint, or CI.

## When to prune

- The entry was superseded by a newer decision — delete or rewrite it and
  link the replacement.
- The code it describes was refactored away — delete it.
- It turned out to be wrong — delete it; a wrong memory is worse than no
  memory.

## Responding to `--check-memory` findings

| Finding | Action |
| --- | --- |
| `references missing path` (fail) | The path moved or was deleted. Fix the reference or prune the entry. Do not silence it by rewording. |
| `unfilled TODO placeholder` (warn) | Fill in real project knowledge or delete the placeholder row/section. |
| `entry dated ... older than N days` (warn) | Re-validate: still true → update the date; changed → rewrite; superseded → prune. |
| `decision heading does not match` / `missing **Decision/Why/Impact**` (warn) | Reformat the entry to `### YYYY-MM-DD — Title` with Decision/Why/Impact bullets. |

## Rule for agents

If you notice memory that contradicts the code you are reading, do not
silently obey the memory and do not silently delete it. Flag the conflict to
the human with the evidence, then update the entry once the human confirms.

Tune the re-validation window by editing the directive at the top of
`.ai/MEMORY.md`, for example `<!-- forgeai-memory: max-age-days=365 -->`.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test test/memory.test.ts`
Expected: 10 pass, 0 fail.

- [ ] **Step 6: Checkpoint — human commits**

Suggest: `feat(memory): restructure MEMORY.md template and add memory-management workflow`

---

### Task 6: `--check-all` aggregation and documentation wiring

**Files:**
- Modify: `bin/lib/check.ts:103-121` (`runCheckAll`)
- Modify: `bin/lib/init.ts` (`--check-all` option description, ~line 46)
- Modify: `templates/.ai/README.md` (read-order item 7, lines 29-33)
- Test: `test/memory.test.ts`

**Interfaces:**
- Consumes: `runCheckMemory` from `bin/lib/memory.js`.

- [ ] **Step 1: Write the failing test**

Append to `test/memory.test.ts`. The test initializes the harness first so the aggregate run is meaningful, and tolerates a non-zero exit (other sub-checks may warn/fail on a bare fixture) — it only asserts that the memory section appears in the aggregate output:

```ts
test('check-all includes the memory check', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-memory-checkall-'));

  try {
    runTs(cli, [], { cwd: target, env: { ...process.env, PATH: '' } });

    let output = '';
    try {
      output = runTs(cli, ['--check-all'], { cwd: target, env: { ...process.env, PATH: '' } });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }

    assert.match(output, /ForgeAI memory check/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/memory.test.ts`
Expected: FAILS — `--check-all` output has no `ForgeAI memory check` section.

- [ ] **Step 3: Wire `runCheckAll`**

In `bin/lib/check.ts`: add `import { runCheckMemory } from './memory.js';` alongside the other imports, then extend `runCheckAll()` after `runCheckSecurity()`:

```ts
  runCheckSecurity();
  separator();
  runCheckMemory();
```

In `bin/lib/init.ts`, update the `--check-all` description to:

```text
  --check-all   Run the harness, CodeGraph (strict), lifecycle, profile,
                review, security, and memory checks together and return one
                aggregated exit code.
```

In `templates/.ai/README.md`, extend read-order item 7 to include the new workflow (keep the existing wrapping style):

```text
7. `WORKFLOW.md`, `workflows/lifecycle-management.md`,
   `workflows/codegraph-context.md`, `workflows/quality-gates.md`,
   `workflows/pre-merge-checklist.md`, and
   `workflows/memory-management.md` — flow from task intake through closure,
   memory update, stale-task handling, graph-guided context selection, the
   enforceable review gate before merge, and stale-memory hygiene.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/memory.test.ts`
Expected: 11 pass, 0 fail. Then `npm test` — full suite green.

- [ ] **Step 5: Checkpoint — human commits**

Suggest: `feat(memory): aggregate check-memory into check-all and document it`

---

### Task 7: Self-sync, roadmap update, and changelog

**Files:**
- Modify: `.ai/MEMORY.md` (this repo — directive, roadmap move, decision entry, fix any findings)
- Create: `.ai/workflows/memory-management.md` (copy of the template)
- Modify: `.ai/README.md` (same read-order edit as the template)
- Modify: `README.md` (changelog paragraph)

**Interfaces:**
- Consumes: the complete checker. No code changes in this task.

- [ ] **Step 1: Sync the harness files**

Copy `templates/.ai/workflows/memory-management.md` to `.ai/workflows/memory-management.md` unchanged. Apply the same read-order item-7 edit from Task 6 to this repo's `.ai/README.md`.

- [ ] **Step 2: Add the directive and run the checker on this repo**

Add `<!-- forgeai-memory: max-age-days=180 -->` as the first line of `.ai/MEMORY.md`, then run:

Run: `npx tsx bin/forgeai-init.ts --check-memory`
Expected: warns are acceptable; FAILs are not. For each `references missing path` failure, apply the workflow rule: fix the path if the artifact moved, prune the entry if the artifact is gone. Re-run until exit code is 0.

- [ ] **Step 3: Update the roadmap in `.ai/MEMORY.md`**

Move the Phase 7 block from "Upcoming" to "Delivered", replacing its bullet list with:

```markdown
- **Phase 7 — memory and knowledge management** (old Phase 8, narrowed).
  Structured `MEMORY.md` template (decisions, conventions, business rules,
  recurring bugs, commands, test strategy, ownership, deployment notes) and
  a `--check-memory` stale-memory gate (dead path refs fail; TODOs, over-age
  entries, malformed decision entries warn), configured by an inline
  `forgeai-memory: max-age-days` directive and aggregated into
  `--check-all`. Context diffing was dropped (covered by git); import/export
  guidance was deferred. Artifacts: `templates/.ai/MEMORY.md`,
  `.ai/workflows/memory-management.md`, `bin/lib/memory.ts`.
```

Append a decision entry under "Architecture decisions":

```markdown
### 2026-07-03 - Phase 7 memory gate is convention-first and warn-biased

- **Decision:** `--check-memory` ships with hardcoded defaults plus a single
  inline directive (`forgeai-memory: max-age-days`) instead of a policy
  file; only dead path references fail, all structural signals warn.
- **Why:** `--upgrade` preserves populated `MEMORY.md` files, so upgraded
  repos keep old formats forever — a hard-failing format gate would block
  them. A policy file (the `security-policy.yaml` route) adds a template and
  an upgrade-preserve rule for one knob most repos never tune.
- **Impact:** New config needs for the memory gate should extend the
  directive, not add files. Structural checks must stay warn-only.
```

- [ ] **Step 4: Add the README changelog paragraph**

In `README.md`, directly above the `` `2.7.0` adds a supply-chain safety gate `` line (line 57), insert:

```markdown
`2.8.0` adds memory and knowledge management: a restructured `MEMORY.md`
template (decisions, recurring bugs, commands, test strategy, ownership,
deployment notes) and `forgeai-init --check-memory`, which fails on dead
path references and warns on TODO placeholders, over-age entries (tunable
via an inline `forgeai-memory: max-age-days` directive), and malformed
decision entries, aggregated into `--check-all`.
```

(The `2.8.0` version is the planned next minor; the human bumps `package.json` at release time as usual.)

- [ ] **Step 5: Full verification**

Run: `npx tsx bin/forgeai-init.ts --check-all`
Expected: exit code 0 on this repo (warns acceptable).

Run: `npm test`
Expected: full suite green (85 existing + 11 new = 96 tests).

- [ ] **Step 6: Checkpoint — human commits**

Suggest: `docs(memory): self-sync memory gate, deliver Phase 7 in roadmap, changelog`

---

## Self-review notes

- **Spec coverage:** template restructure (Task 5), checker with four signals and severities (Tasks 1–4), directive with fallback (Task 3), CLI flag + help (Task 1), `--check-all` (Task 6), workflow doc (Task 5, moved per ordering note), README/read-order/changelog/roadmap/self-sync (Tasks 6–7), all eight spec test scenarios are present across the task tests.
- **Known ordering hazard:** Task 5's template references the workflow file — resolved by moving the workflow-file creation into Task 5 (see ordering note); Task 6 is wiring/docs only.
