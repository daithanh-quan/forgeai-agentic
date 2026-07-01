# Phase 6 Quality Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an enforceable review/validation gate (`forgeai-init --check-review`) so a task cannot be accepted/closed without real validation evidence and a completed reviewer scorecard.

**Architecture:** A new `bin/lib/review.ts` checker reuses the existing lifecycle journal parser (`listTaskJournalFiles`, `parseTaskJournal`) and markdown-table helpers (`splitTableRow`, `cleanTableCell`). It validates journals in gated states against real evidence rows and a filled scorecard file, printing `formatStatus` lines and setting an exit code exactly like `runCheckCodeGraph`. New markdown templates (scorecard, quality-gates workflow, pre-merge checklist, CI example) ship under `templates/`. The flag is wired into the CLI dispatcher and `--check-all`.

**Tech Stack:** TypeScript (ESM, `tsx`), Node.js built-in `node:test` runner, no new dependencies.

## Global Constraints

- No new runtime dependencies. Node built-ins only.
- Checkers print via `formatStatus(status, label)` (16-char padded status) and set `process.exitCode = 1` on failure; a passing run leaves the exit code at 0.
- Every file added under `templates/.ai/...` is copied by `runInit` into every project AND required to exist by `runCheck` — this is intended for harness files.
- Reuse existing helpers; do not duplicate table/journal parsing.
- Gated lifecycle states are exactly: `review | revision | acceptance | delivery | closed`.
- Valid recommendations/verdicts are exactly: `Approve | Request changes | Needs human decision` (compared case-insensitively).
- Valid evidence results are exactly: `pass | fail | skipped` (case-insensitively).
- Commit messages follow Conventional Commits and end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- All work stays on branch `feat/phase-6-quality-gates`.

## File Structure

- Create `templates/.ai/state/reviews/_template.md` — reviewer scorecard template.
- Create `templates/.ai/workflows/quality-gates.md` — when the gate applies + procedure.
- Create `templates/.ai/workflows/pre-merge-checklist.md` — GitHub/GitLab/Bitbucket/local checklist.
- Create `templates/.ai/ci/github-actions.example.yml` — CI running the checks.
- Create `bin/lib/review.ts` — `runCheckReview()` + parsing helpers.
- Modify `bin/lib/context.ts` — add `checkReview` flag.
- Modify `bin/forgeai-init.ts` — dispatch `--check-review`.
- Modify `bin/lib/init.ts` — document flag in `usage()`; preserve real scorecards on upgrade.
- Modify `bin/lib/check.ts` — include review gate in `runCheckAll()`.
- Modify `templates/.ai/workflows/delegated-assignment.md` — require validation evidence in results.
- Modify `templates/.ai/WORKFLOW.md` — §8 points at scorecard + gate + checklist.
- Modify `templates/.ai/README.md` — list the new workflow/scorecard files.
- Modify `.ai/MEMORY.md` — record Phase 4 dropped and Phase 6 delivered.
- Create `test/review.test.ts` — CLI-level smoke tests for the gate.

---

### Task 1: Add quality-gate templates (scorecard, workflow, checklist, CI)

**Files:**
- Create: `templates/.ai/state/reviews/_template.md`
- Create: `templates/.ai/workflows/quality-gates.md`
- Create: `templates/.ai/workflows/pre-merge-checklist.md`
- Create: `templates/.ai/ci/github-actions.example.yml`
- Test: reuse `test/check.test.ts` (existing "initialization copies the template files" style) via a new assertion added in this task.

**Interfaces:**
- Consumes: nothing.
- Produces: the four template files that `bin/lib/review.ts` (Task 2) requires at
  `.ai/state/reviews/_template.md`, `.ai/workflows/quality-gates.md`,
  `.ai/workflows/pre-merge-checklist.md`. The scorecard format defines the
  labels the checker parses: an `Unresolved blockers:` line and a `Verdict:` line.

- [ ] **Step 1: Create the scorecard template**

Create `templates/.ai/state/reviews/_template.md`:

```markdown
# Review Scorecard Template

Copy this file to `.ai/state/reviews/<task-id>.md` when a task enters the
`review` state. The review gate (`forgeai-init --check-review`) requires a
completed scorecard, plus real validation evidence in the task journal, before
a gated task can move to `acceptance` or `closed`.

- Task ID: `TASK-YYYYMMDD-short-slug`
- Reviewer: `TODO`
- Date: `YYYY-MM-DD`

## Scorecard

| Dimension | Rating | Notes |
| --- | --- | --- |
| Correctness | `pass \| concern \| fail` | TODO |
| Scope control | `pass \| concern \| fail` | TODO |
| Security | `pass \| concern \| fail` | TODO |
| Tests/validation | `pass \| concern \| fail` | TODO |
| Maintainability | `pass \| concern \| fail` | TODO |
| Release risk | `pass \| concern \| fail` | TODO |

Unresolved blockers: TODO (list blocker findings, or `none`)

Verdict: TODO (Approve | Request changes | Needs human decision)
```

- [ ] **Step 2: Create the quality-gates workflow**

Create `templates/.ai/workflows/quality-gates.md`:

```markdown
# Quality Gates

This workflow makes the review/validation step enforceable, not a prose claim.

## When the gate applies

The review gate applies to any task journal in a gated lifecycle state:
`review`, `revision`, `acceptance`, `delivery`, or `closed`. Run:

```bash
forgeai-init --check-review
```

The gate is also part of `forgeai-init --check-all` and the CI example in
`.ai/ci/github-actions.example.yml`.

## What the gate requires

A gated journal passes only when all of the following exist:

1. **Real validation evidence.** The journal's *Commands And Validation* table
   has at least one real row (not the template placeholder) with a result of
   `pass`, `fail`, or `skipped`. Any evidence type counts: unit test,
   integration test, e2e, or a manual-QA note. A bare `Approve`/`pass` word
   with an empty table does not count.
2. **A review finding.** The journal's *Review Findings* table has at least one
   real row with a recommendation of `Approve`, `Request changes`, or
   `Needs human decision`.
3. **A completed scorecard.** A file `.ai/state/reviews/<task-id>.md` exists,
   contains no `TODO`, and declares a `Verdict:` of one of the three valid
   values. Copy it from `.ai/state/reviews/_template.md`.
4. **Blocker consistency.** If the scorecard verdict is `Approve`, its
   `Unresolved blockers:` line must be `none`.

## Procedure

1. When a task enters `review`, copy the scorecard template to
   `.ai/state/reviews/<task-id>.md` and fill all six dimensions.
2. Record every validation command and its result in the journal's
   *Commands And Validation* table.
3. Record the review recommendation in the journal's *Review Findings* table.
4. Set the scorecard `Verdict:` and resolve or list unresolved blockers.
5. Run `forgeai-init --check-review` and fix any reported gaps before moving to
   `acceptance` or `closed`.

## Escalation

If the reviewer returns `Request changes`, send the concrete findings back to
the implementing model once. If the second attempt still fails, the current
model fixes the issue locally or escalates the remaining decision to the human.
Do not set the verdict to `Approve` while blockers remain unresolved.
```

- [ ] **Step 3: Create the pre-merge checklist**

Create `templates/.ai/workflows/pre-merge-checklist.md`:

```markdown
# Pre-Merge Checklist

Run before requesting merge. The review gate (`forgeai-init --check-review`)
covers evidence and scorecard; this checklist covers the surrounding hygiene.

## All repositories

- [ ] `forgeai-init --check-all` passes (harness, codegraph, lifecycle, profile,
      review gate).
- [ ] Lint, typecheck, and tests pass, or the reason they could not run is
      documented in the journal.
- [ ] Scope matches the task; no unrelated files changed.
- [ ] Scorecard `Verdict:` is set and consistent with unresolved blockers.
- [ ] Delivery notes list changed files, validation, risks, and follow-up.

## GitHub

- [ ] Branch pushed and PR opened with the delivery summary.
- [ ] Required status checks green.
- [ ] At least one approving review or documented human decision.

## GitLab

- [ ] MR opened with the delivery summary.
- [ ] Pipeline green.
- [ ] Approvals satisfied.

## Bitbucket

- [ ] PR opened with the delivery summary.
- [ ] Pipelines green.
- [ ] Required reviewers approved.

## Local-only (no remote)

- [ ] Commits are Conventional-Commit formatted on a semantic branch.
- [ ] Report the exact push/PR command for the human to run after connecting a
      remote.
```

- [ ] **Step 4: Create the CI example**

Create `templates/.ai/ci/github-actions.example.yml`:

```yaml
# Example GitHub Actions workflow that runs the ForgeAI quality gates.
# Copy to .github/workflows/forgeai.yml and adjust the lint/test steps.
name: ForgeAI Quality Gates

on:
  pull_request:
  push:
    branches: [main]

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: ForgeAI harness + review gate
        run: npx forgeai-agentic-init@latest --check-all --skip-update-check
      - name: ForgeAI git state
        run: npx forgeai-agentic-init@latest --check-git --skip-update-check
      # - name: Lint
      #   run: npm run lint
      # - name: Typecheck
      #   run: npm run typecheck
      # - name: Tests
      #   run: npm test
```

- [ ] **Step 5: Add an assertion that init copies the new templates**

In `test/check.test.ts`, find the test that asserts initialization copies
template files (it inits a temp dir with `runTs(cli, [], { cwd: target })`).
Add these assertions inside that test's `try` block, after the existing
`assert.equal(...)` file-existence checks:

```typescript
    assert.equal(fs.existsSync(path.join(target, '.ai', 'state', 'reviews', '_template.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'quality-gates.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'pre-merge-checklist.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'ci', 'github-actions.example.yml')), true);
```

If `test/check.test.ts` has no such test, add the assertions to the
"initialization copies the template files" test in `test/lifecycle.test.ts`
instead (same `target` variable and imports).

- [ ] **Step 6: Run the suite to verify templates are copied**

Run: `npm test`
Expected: PASS, including the new file-existence assertions. (`--check` requires
every template file to exist; the newly added templates are copied by init, so
existing check tests stay green.)

- [ ] **Step 7: Commit**

```bash
git add templates/.ai/state/reviews/_template.md templates/.ai/workflows/quality-gates.md templates/.ai/workflows/pre-merge-checklist.md templates/.ai/ci/github-actions.example.yml test/check.test.ts test/lifecycle.test.ts
git commit -m "feat: add Phase 6 quality-gate templates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Implement the review-gate checker and wire the CLI flag

**Files:**
- Create: `bin/lib/review.ts`
- Modify: `bin/lib/context.ts` (add flag after line 27, `checkAll`)
- Modify: `bin/forgeai-init.ts` (import + dispatch)
- Modify: `bin/lib/init.ts` (`usage()` text)
- Test: `test/review.test.ts`

**Interfaces:**
- Consumes: `listTaskJournalFiles(): string[]`, `parseTaskJournal(relativePath): { taskId, currentState, ... }` from `bin/lib/lifecycle.ts`; `splitTableRow(line): string[]`, `cleanTableCell(value): string` from `bin/lib/sessions.ts`; `formatStatus(status, label): string` from `bin/lib/utils.ts`; `root` from `bin/lib/context.ts`.
- Produces: `runCheckReview(): void`; helpers `extractTableRows(content, heading): string[][]`, `extractLabeledValue(content, label): string`, `isRealEvidenceRow(cells): boolean`, `isRealFindingRow(cells): boolean`; constant `gatedReviewStates: string[]`.

- [ ] **Step 1: Write the failing test**

Create `test/review.test.ts`:

```typescript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

const ENV = { ...process.env, FORGEAI_SKIP_UPDATE_CHECK: '1' };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function initProject(): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-review-'));
  runTs(cli, [], { cwd: target, env: ENV });
  return target;
}

function writeJournal(
  target: string,
  opts: { id?: string; state?: string; evidence?: string; finding?: string } = {}
): void {
  const id = opts.id ?? 'TASK-20260701-profile-edit';
  const state = opts.state ?? 'review';
  const evidence =
    opts.evidence ??
    `| ${today()} | \`npm test -- profile\` | pass | 8 unit tests |`;
  const finding =
    opts.finding ??
    `| ${today()} | Codex | Approve | none | resolved |`;
  const content = [
    '# Task Journal',
    '',
    '## Identity',
    '',
    `- Task ID: \`${id}\``,
    '- Task type: `feature`',
    `- Current state: \`${state}\``,
    `- Last updated: \`${today()}\``,
    '- Stale status: `fresh`',
    '',
    '## Commands And Validation',
    '',
    '| Date | Command/check | Result | Notes |',
    '| --- | --- | --- | --- |',
    evidence,
    '',
    '## Review Findings',
    '',
    '| Date | Reviewer | Status | Findings | Resolution |',
    '| --- | --- | --- | --- | --- |',
    finding,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(target, '.ai', 'state', 'tasks', `${id}.md`), content);
}

function writeScorecard(target: string, opts: { id?: string; verdict?: string; blockers?: string } = {}): void {
  const id = opts.id ?? 'TASK-20260701-profile-edit';
  const verdict = opts.verdict ?? 'Approve';
  const blockers = opts.blockers ?? 'none';
  const content = [
    `# Review Scorecard - ${id}`,
    '',
    `- Task ID: \`${id}\``,
    '- Reviewer: `Codex`',
    `- Date: \`${today()}\``,
    '',
    '## Scorecard',
    '',
    '| Dimension | Rating | Notes |',
    '| --- | --- | --- |',
    '| Correctness | pass | happy path tested |',
    '| Scope control | pass | profile only |',
    '| Security | pass | - |',
    '| Tests/validation | pass | unit + manual QA |',
    '| Maintainability | pass | - |',
    '| Release risk | pass | - |',
    '',
    `Unresolved blockers: ${blockers}`,
    '',
    `Verdict: ${verdict}`,
    ''
  ].join('\n');
  fs.mkdirSync(path.join(target, '.ai', 'state', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(target, '.ai', 'state', 'reviews', `${id}.md`), content);
}

test('review gate passes when no journals are in a gated state', () => {
  const target = initProject();
  try {
    const output = runTs(cli, ['--check-review'], { cwd: target, env: ENV });
    assert.match(output, /no task journals awaiting the review gate/);
    assert.match(output, /Result: review gate satisfied\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('review gate passes for a complete gated journal + scorecard', () => {
  const target = initProject();
  try {
    writeJournal(target);
    writeScorecard(target);
    const output = runTs(cli, ['--check-review'], { cwd: target, env: ENV });
    assert.match(output, /passes the review gate/);
    assert.match(output, /Result: review gate satisfied\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="review gate"`
(or `npm test` and read the review-gate cases)
Expected: FAIL. `--check-review` is an unknown flag, so the CLI falls through to
`runInit`; the output will not contain "review gate satisfied".

- [ ] **Step 3: Create the checker module**

Create `bin/lib/review.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { root } from './context.js';
import { formatStatus } from './utils.js';
import { splitTableRow, cleanTableCell } from './sessions.js';
import { listTaskJournalFiles, parseTaskJournal } from './lifecycle.js';

export const gatedReviewStates = ['review', 'revision', 'acceptance', 'delivery', 'closed'];
export const validRecommendations = ['approve', 'request changes', 'needs human decision'];
const validEvidenceResults = ['pass', 'fail', 'skipped'];

// Return the data rows (header and divider dropped) of the markdown table that
// appears under the given `## heading`.
export function extractTableRows(content: string, heading: string): string[][] {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start === -1) return [];

  const tableLines: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith('## ')) break;
    if (line.startsWith('|')) tableLines.push(line);
  }

  const dataLines = tableLines.filter((line) => !/^\|[\s:|-]+\|$/.test(line));
  if (dataLines.length <= 1) return [];

  return dataLines.slice(1).map((line) => splitTableRow(line).map((cell) => cleanTableCell(cell)));
}

// Read a `Label: value` line and return the trimmed value.
export function extractLabeledValue(content: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^\\s*${escaped}:\\s*(.*)$`, 'im'));
  return cleanTableCell(match?.[1] ?? '');
}

// A real evidence row is not the template placeholder and has a concrete result.
export function isRealEvidenceRow(cells: string[]): boolean {
  const [date, command, result] = cells;
  if (!date || date === 'YYYY-MM-DD') return false;
  if (!command || command === '...') return false;
  return validEvidenceResults.includes((result ?? '').toLowerCase());
}

// A real finding row is not the placeholder and carries a valid recommendation.
export function isRealFindingRow(cells: string[]): boolean {
  const [date, reviewer, status] = cells;
  if (!date || date === 'YYYY-MM-DD') return false;
  if (!reviewer || reviewer === '...') return false;
  return validRecommendations.includes((status ?? '').toLowerCase());
}

export function runCheckReview(): void {
  console.log('ForgeAI review gate check');
  console.log('');

  const requiredFiles = [
    '.ai/state/reviews/_template.md',
    '.ai/workflows/quality-gates.md',
    '.ai/workflows/pre-merge-checklist.md'
  ];
  let failures = 0;

  for (const relativePath of requiredFiles) {
    const exists = fs.existsSync(path.join(root, relativePath));
    if (!exists) failures += 1;
    console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
  }

  const gatedJournals = listTaskJournalFiles()
    .map((file) => ({ file, journal: parseTaskJournal(file), content: fs.readFileSync(path.join(root, file), 'utf8') }))
    .filter((entry) => gatedReviewStates.includes(entry.journal.currentState));

  console.log('');
  console.log('Review gate');

  if (gatedJournals.length === 0) {
    console.log(formatStatus('ok', 'no task journals awaiting the review gate'));
  }

  for (const { file, journal, content } of gatedJournals) {
    const label = `${file}${journal.taskId ? ` (${journal.taskId})` : ''}`;
    let journalFailures = 0;

    const evidenceRows = extractTableRows(content, 'Commands And Validation').filter(isRealEvidenceRow);
    if (evidenceRows.length === 0) {
      journalFailures += 1;
      console.log(formatStatus('invalid', `${file} has no real validation evidence in ${journal.currentState} state`));
    }

    const findingRows = extractTableRows(content, 'Review Findings').filter(isRealFindingRow);
    if (findingRows.length === 0) {
      journalFailures += 1;
      console.log(formatStatus('invalid', `${file} has no review finding with a recommendation`));
    }

    const scorecardRelative = journal.taskId ? `.ai/state/reviews/${journal.taskId}.md` : '';
    const scorecardAbsolute = scorecardRelative ? path.join(root, scorecardRelative) : '';

    if (!scorecardRelative || !fs.existsSync(scorecardAbsolute)) {
      journalFailures += 1;
      console.log(formatStatus('missing', `${scorecardRelative || '.ai/state/reviews/<task-id>.md'} scorecard for ${label}`));
    } else {
      const scorecard = fs.readFileSync(scorecardAbsolute, 'utf8');

      if (/\bTODO\b/.test(scorecard)) {
        journalFailures += 1;
        console.log(formatStatus('needs review', `${scorecardRelative} still contains TODO`));
      }

      const verdict = extractLabeledValue(scorecard, 'Verdict').toLowerCase();
      if (!validRecommendations.includes(verdict)) {
        journalFailures += 1;
        console.log(formatStatus('invalid', `${scorecardRelative} Verdict must be Approve, Request changes, or Needs human decision`));
      } else if (verdict === 'approve') {
        const blockers = extractLabeledValue(scorecard, 'Unresolved blockers').toLowerCase();
        if (blockers !== '' && blockers !== 'none') {
          journalFailures += 1;
          console.log(formatStatus('invalid', `${scorecardRelative} verdict Approve but unresolved blockers: ${blockers}`));
        }
      }
    }

    if (journalFailures === 0) {
      console.log(formatStatus('ok', `${label} passes the review gate`));
    }
    failures += journalFailures;
  }

  console.log('');
  if (failures > 0) {
    console.log('Result: review gate failed. Add real validation evidence and a completed scorecard before closing.');
    process.exitCode = 1;
    return;
  }

  console.log('Result: review gate satisfied.');
}
```

- [ ] **Step 4: Add the `checkReview` flag**

In `bin/lib/context.ts`, after the line `export const checkAll = args.has('--check-all');`, add:

```typescript
export const checkReview = args.has('--check-review');
```

- [ ] **Step 5: Dispatch the flag in the CLI**

In `bin/forgeai-init.ts`:

Add `checkReview` to the destructured import from `./lib/context.js` (in the
same list as `checkAll`, `check`):

```typescript
  checkAll,
  checkReview,
  check,
```

Add the import for the runner near the other `runCheck*` imports:

```typescript
import { runCheckReview } from './lib/review.js';
```

Add the dispatch branch immediately before `else if (checkAll) runCheckAll();`:

```typescript
else if (checkReview) runCheckReview();
```

(Order note: keep `checkReview` before `checkAll` only if you prefer; either
order works because the flags are distinct. Placing it before `checkAll` keeps
the check flags grouped.)

- [ ] **Step 6: Document the flag in `usage()`**

In `bin/lib/init.ts`, inside `usage()`:

Add a usage line after `  forgeai-init --check-all`:

```
  forgeai-init --check-review
```

Add an option description after the `--check-all` block:

```
  --check-review
                Validate that gated task journals carry real validation
                evidence and a completed reviewer scorecard before merge.
```

- [ ] **Step 7: Run the review-gate tests to verify they pass**

Run: `npm test -- --test-name-pattern="review gate"`
Expected: PASS for both "no journals" and "complete gated journal" cases.

- [ ] **Step 8: Add the failure-mode tests**

Append to `test/review.test.ts`:

```typescript
test('review gate fails when validation evidence is missing', () => {
  const target = initProject();
  try {
    writeJournal(target, { evidence: '| YYYY-MM-DD | ... | pass | ... |' });
    writeScorecard(target);
    assert.throws(
      () => runTs(cli, ['--check-review'], { cwd: target, env: ENV }),
      (error: ExecError) => {
        assert.match(String(error.stdout), /no real validation evidence/);
        assert.match(String(error.stdout), /Result: review gate failed\./);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('review gate fails when the scorecard is missing', () => {
  const target = initProject();
  try {
    writeJournal(target);
    assert.throws(
      () => runTs(cli, ['--check-review'], { cwd: target, env: ENV }),
      (error: ExecError) => {
        assert.match(String(error.stdout), /scorecard for/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('review gate fails when the scorecard still has TODO', () => {
  const target = initProject();
  try {
    writeJournal(target);
    const id = 'TASK-20260701-profile-edit';
    fs.mkdirSync(path.join(target, '.ai', 'state', 'reviews'), { recursive: true });
    fs.writeFileSync(
      path.join(target, '.ai', 'state', 'reviews', `${id}.md`),
      ['# Scorecard', '', 'Unresolved blockers: none', '', 'Verdict: TODO'].join('\n')
    );
    assert.throws(
      () => runTs(cli, ['--check-review'], { cwd: target, env: ENV }),
      (error: ExecError) => {
        assert.match(String(error.stdout), /still contains TODO/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('review gate fails when Approve verdict has unresolved blockers', () => {
  const target = initProject();
  try {
    writeJournal(target);
    writeScorecard(target, { verdict: 'Approve', blockers: 'missing rate limit' });
    assert.throws(
      () => runTs(cli, ['--check-review'], { cwd: target, env: ENV }),
      (error: ExecError) => {
        assert.match(String(error.stdout), /unresolved blockers/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('review gate fails when there is no valid recommendation', () => {
  const target = initProject();
  try {
    writeJournal(target, { finding: '| YYYY-MM-DD | ... | `Approve | Request changes` | ... | ... |' });
    writeScorecard(target);
    assert.throws(
      () => runTs(cli, ['--check-review'], { cwd: target, env: ENV }),
      (error: ExecError) => {
        assert.match(String(error.stdout), /no review finding with a recommendation/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 9: Run the full review test file**

Run: `npm test -- --test-name-pattern="review gate"`
Expected: PASS for all seven review-gate cases.

- [ ] **Step 10: Commit**

```bash
git add bin/lib/review.ts bin/lib/context.ts bin/forgeai-init.ts bin/lib/init.ts test/review.test.ts
git commit -m "feat: add forgeai-init --check-review quality gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Aggregate into --check-all and preserve real scorecards on upgrade

**Files:**
- Modify: `bin/lib/check.ts` (`runCheckAll`)
- Modify: `bin/lib/init.ts` (`isPreservedOnUpgrade`)
- Test: `test/review.test.ts` (add two cases)

**Interfaces:**
- Consumes: `runCheckReview` from `bin/lib/review.ts`; `isPreservedOnUpgrade(dest): boolean` in `bin/lib/init.ts`.
- Produces: `runCheckAll()` now runs the review gate; `.ai/state/reviews/<task-id>.md` (except `_template.md`) is preserved on `--upgrade`.

- [ ] **Step 1: Write the failing test for --check-all**

Append to `test/review.test.ts`:

```typescript
test('check-all includes the review gate section', () => {
  const target = initProject();
  try {
    const output = runTs(cli, ['--check-all'], { cwd: target, env: ENV });
    assert.match(output, /ForgeAI review gate check/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --test-name-pattern="check-all includes the review gate"`
Expected: FAIL — `--check-all` output does not yet contain "ForgeAI review gate check".

- [ ] **Step 3: Wire the review gate into runCheckAll**

In `bin/lib/check.ts`:

Add the import near the other check imports:

```typescript
import { runCheckReview } from './review.js';
```

In `runCheckAll()`, after the final `runCheckProfile();`, add:

```typescript
  separator();
  runCheckReview();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern="check-all includes the review gate"`
Expected: PASS.

- [ ] **Step 5: Write the failing test for upgrade preservation**

Append to `test/review.test.ts`:

```typescript
test('upgrade preserves a real scorecard but refreshes the template', () => {
  const target = initProject();
  try {
    const id = 'TASK-20260701-profile-edit';
    const reviewsDir = path.join(target, '.ai', 'state', 'reviews');
    fs.mkdirSync(reviewsDir, { recursive: true });
    fs.writeFileSync(path.join(reviewsDir, `${id}.md`), 'CUSTOM SCORECARD CONTENT\n');

    runTs(cli, ['--upgrade'], { cwd: target, env: ENV });

    assert.equal(fs.readFileSync(path.join(reviewsDir, `${id}.md`), 'utf8'), 'CUSTOM SCORECARD CONTENT\n');
    assert.equal(fs.existsSync(path.join(reviewsDir, '_template.md')), true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- --test-name-pattern="upgrade preserves a real scorecard"`
Expected: FAIL — without the preserve rule, `--upgrade` overwrites the custom
scorecard (or skips it), so the content assertion fails.

- [ ] **Step 7: Add the preserve rule**

In `bin/lib/init.ts`, inside `isPreservedOnUpgrade`, after the existing
`.ai/state/tasks/` guard block and before `return false;`, add:

```typescript
  if (/^\.ai\/state\/reviews\/.+\.md$/.test(relative) && relative !== '.ai/state/reviews/_template.md') {
    return true;
  }
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern="upgrade preserves a real scorecard"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add bin/lib/check.ts bin/lib/init.ts test/review.test.ts
git commit -m "feat: run review gate in --check-all and preserve scorecards on upgrade

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire the gate into the harness docs

**Files:**
- Modify: `templates/.ai/workflows/delegated-assignment.md`
- Modify: `templates/.ai/WORKFLOW.md`
- Modify: `templates/.ai/README.md`

**Interfaces:**
- Consumes: nothing (documentation).
- Produces: harness docs that point agents at the scorecard, the gate command, and the pre-merge checklist.

- [ ] **Step 1: Require validation evidence in delegated results**

In `templates/.ai/workflows/delegated-assignment.md`, replace the
`## Return Format` block:

```markdown
## Return Format

- Files changed.
- Concise summary.
- Validation command and result.
- Claude reviewer result: `Approve | Request changes | Needs human decision`.
- Risks, assumptions, or unresolved questions.
```

with:

```markdown
## Return Format

- Files changed.
- Concise summary.
- Validation evidence (required): each command run and its result
  (`pass | fail | skipped`). "Done" without a command and result is rejected
  by the review gate (`forgeai-init --check-review`).
- Reviewer result: `Approve | Request changes | Needs human decision`.
- Unresolved blockers, or `none`.
- Risks, assumptions, or unresolved questions.
```

- [ ] **Step 2: Point WORKFLOW §8 at the gate**

In `templates/.ai/WORKFLOW.md`, replace the paragraph that begins
`If the configured reviewer returns \`Request changes\`,` (the last paragraph of
section 8, before `## 9. Human approval`) with:

```markdown
If the configured reviewer returns `Request changes`, send the concrete
findings back to the implementing model once. If the second attempt still
fails, the current model fixes the issue locally or escalates the remaining
decision to the human.

Before moving a task from `review` to `acceptance` or `closed`, complete a
review scorecard (`.ai/state/reviews/<task-id>.md`, copied from
`.ai/state/reviews/_template.md`), record real validation evidence in the task
journal, and run `forgeai-init --check-review`. See
`.ai/workflows/quality-gates.md` and `.ai/workflows/pre-merge-checklist.md`.
```

- [ ] **Step 3: List the new files in README read order**

In `templates/.ai/README.md`, replace item 7:

```markdown
7. `WORKFLOW.md`, `workflows/lifecycle-management.md`, and
   `workflows/codegraph-context.md` — flow from task intake through closure,
   memory update, stale-task handling, and graph-guided context selection.
```

with:

```markdown
7. `WORKFLOW.md`, `workflows/lifecycle-management.md`,
   `workflows/codegraph-context.md`, `workflows/quality-gates.md`, and
   `workflows/pre-merge-checklist.md` — flow from task intake through closure,
   memory update, stale-task handling, graph-guided context selection, and the
   enforceable review gate before merge.
```

Then replace item 13:

```markdown
13. `state/tasks/_template.md` — task journal format for resumable work.
```

with:

```markdown
13. `state/tasks/_template.md` and `state/reviews/_template.md` — task journal
   and review scorecard formats for resumable, gated work.
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. `--check` still passes because every template file (including
the modified docs) exists after init.

- [ ] **Step 5: Commit**

```bash
git add templates/.ai/workflows/delegated-assignment.md templates/.ai/WORKFLOW.md templates/.ai/README.md
git commit -m "docs: wire review gate into harness workflow docs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Record the roadmap change and run final validation

**Files:**
- Modify: `.ai/MEMORY.md` (this repo's own memory, not a template)
- Test: full `npm test` + a manual gate smoke check.

**Interfaces:**
- Consumes: nothing.
- Produces: a durable memory entry that Phase 4 is dropped and Phase 6 is delivered.

- [ ] **Step 1: Add the memory entry**

In `.ai/MEMORY.md`, under `## Architecture decisions`, add a dated entry after
the most recent one (`### 2026-06-28 - Phase 2 lifecycle checker added` or the
latest present). Use today's date:

```markdown
### 2026-07-01 - Phase 4 dropped; Phase 6 quality gates delivered

- **Decision:** Drop Phase 4 (plugin/marketplace layer). Deliver Phase 6
  (quality gates) instead: `forgeai-init --check-review`, a reviewer scorecard
  template, a quality-gates workflow, a pre-merge checklist, and a CI example.
- **Why:** A Claude Code plugin would be vendor-specific (the harness is
  model-agnostic) and its workflow skill would duplicate the `.ai/` markdown
  that `CLAUDE.md` already points to, causing version drift. The review gate
  closes the missing validate/review link in the lifecycle Phase 2 built and is
  model-agnostic markdown + a Node checker.
- **Impact:** The review gate requires real validation evidence and a completed
  scorecard before a task journal in `review|revision|acceptance|delivery|
  closed` can pass. It is part of `--check-all` and the CI example. Future work
  should extend this gate (e.g. deeper OpenSpec validation) rather than adding a
  competing review-state format. Plugin/marketplace work is deferred, not
  scheduled.
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS. All prior tests plus the new review-gate tests (10 total added).

- [ ] **Step 3: Manual gate smoke check**

Run:

```bash
npx tsx bin/forgeai-init.ts --check-review --skip-update-check
```

Expected: In this repo (no task journals in a gated state under
`.ai/state/tasks/`), output ends with `Result: review gate satisfied.` and exit
code 0. Confirm with:

```bash
echo "exit: $?"
```

- [ ] **Step 4: Commit**

```bash
git add .ai/MEMORY.md
git commit -m "docs: record Phase 4 drop and Phase 6 quality-gate delivery

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

- Reviewer scorecard template -> Task 1 Step 1.
- `--check-review` checker with all four rules (evidence, finding, scorecard,
  blocker consistency) -> Task 2 Step 3.
- CLI wiring (context, dispatcher, usage) -> Task 2 Steps 4-6.
- Gated states + "no gated journals passes" -> Task 2 (constant + Step 1 test).
- Quality-gates workflow -> Task 1 Step 2.
- Pre-merge checklist (GitHub/GitLab/Bitbucket/local) -> Task 1 Step 3.
- CI example -> Task 1 Step 4.
- Delegated-assignment evidence fields -> Task 4 Step 1.
- Preserve real scorecards on upgrade -> Task 3 Steps 5-8.
- `--check-all` aggregation -> Task 3 Steps 1-4.
- Smoke tests (pass + each failure mode) -> Task 2 Steps 1/8, Task 3.
- WORKFLOW/README docs -> Task 4 Steps 2-3.
- MEMORY: Phase 4 dropped + Phase 6 delivered -> Task 5 Step 1.
- Acceptance criteria all mapped.

**Placeholder scan:** No "TBD/implement later" steps. The literal string `TODO`
appears only as intentional content in the scorecard template and as the value
the checker detects — not as an unfinished plan step.

**Type consistency:** `runCheckReview`, `extractTableRows`, `extractLabeledValue`,
`isRealEvidenceRow`, `isRealFindingRow`, `gatedReviewStates`, `validRecommendations`
are named identically across Task 2 (definition), Task 3 (import in check.ts),
and `bin/forgeai-init.ts` dispatch. Journal fields `taskId` and `currentState`
match `parseTaskJournal`'s return shape in `bin/lib/lifecycle.ts`. The
preserve regex `^\.ai\/state\/reviews\/.+\.md$` matches the reviews path used by
the checker (`.ai/state/reviews/<task-id>.md`).
