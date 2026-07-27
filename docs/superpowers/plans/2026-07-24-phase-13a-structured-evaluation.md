# Phase 13A — Structured Evaluation Records and Aggregate Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manually-entered evaluation data with structured JSON records derived from compiled-context artifacts, run records, task journals, and review scorecards, plus a terminal report over them.

**Architecture:** Stamp a `task_id` into the compiled-context artifact and the run record so evaluation data joins by a real key. A new `--evaluate --task <id>` command joins journal + scorecard + run records + artifact by that key, runs a strict consistency gate, derives an outcome from the review verdict, and writes one `EvaluationRecord`. A new `--report` command aggregates records by model tier. The legacy `--check-evaluation` path stays and is soft-deprecated.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node.js built-ins only (`node:fs`, `node:path`, `node:crypto`), `node:test` + `tsx` for tests. No new dependencies.

## Global Constraints

- Target version: **3.9.0** (from 3.8.0). Bump `package.json`, both `version` locations in `package-lock.json`, `CHANGELOG.md`, `ROADMAP.md`.
- All new schemas use `schema_version: 1`. `task_id` additions are **additive and backward compatible**: absent ⇒ read as `null`.
- **Never guess an outcome.** Any consistency-gate failure ⇒ print a specific error and exit code 1, write no record.
- No new runtime dependencies (Node built-ins only).
- ESM: every intra-repo import uses a `.js` specifier (e.g. `from './utils.js'`).
- Output style: use `formatStatus(status, label)` from `./utils.js` for status/metric lines, matching existing commands.
- Tests: `node --test` files in `test/*.test.ts`; run the full suite with `npm test` (runs typecheck + build + tests). Follow the temp-dir pattern in `test/run-record.test.ts` (`fs.mkdtempSync(path.join(os.tmpdir(), ...))`).
- The user commits every change themselves — the `git commit` steps below are for the user; an agentic worker should stage and propose the commit, and must not assume CI exists (there is none for this repo).

---

### Task 1: `isValidTaskId` helper

**Files:**
- Modify: `bin/lib/utils.ts` (add export at end)
- Test: `test/task-id.test.ts` (create)

**Interfaces:**
- Produces: `isValidTaskId(id: string): boolean` — `true` only for `TASK-` + 8 digits + `-` + a lowercase-alphanumeric slug; rejects empty and the template placeholders.

- [ ] **Step 1: Write the failing test**

Create `test/task-id.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidTaskId } from '../bin/lib/utils.js';

test('isValidTaskId accepts a well-formed task id', () => {
  assert.equal(isValidTaskId('TASK-20260724-routing-fallback'), true);
  assert.equal(isValidTaskId('TASK-20260101-a'), true);
});

test('isValidTaskId rejects placeholders and malformed ids', () => {
  assert.equal(isValidTaskId(''), false);
  assert.equal(isValidTaskId('TASK-YYYYMMDD-short-slug'), false);
  assert.equal(isValidTaskId('TASK-...'), false);
  assert.equal(isValidTaskId('TASK-2026-routing'), false); // date not 8 digits
  assert.equal(isValidTaskId('task-20260724-x'), false);   // wrong prefix case
  assert.equal(isValidTaskId('TASK-20260724-'), false);    // empty slug
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/task-id.test.ts`
Expected: FAIL — `isValidTaskId` is not exported.

- [ ] **Step 3: Add the implementation**

Append to `bin/lib/utils.ts`:

```ts
// A valid ForgeAI task id: TASK-<8 digits>-<lowercase alphanumeric slug>.
// Rejects empty strings and the journal/scorecard template placeholders.
const TASK_ID_PATTERN = /^TASK-\d{8}-[a-z0-9][a-z0-9-]*$/;

export function isValidTaskId(id: string): boolean {
  return typeof id === 'string' && TASK_ID_PATTERN.test(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/task-id.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add bin/lib/utils.ts test/task-id.test.ts
git commit -m "feat(eval): add isValidTaskId helper for task-id linkage"
```

---

### Task 2: `task_id` + `artifact_role` on the compiled-context artifact + `--compile-context --task`

**Files:**
- Modify: `bin/lib/types.ts` (`CompiledContextArtifact`)
- Modify: `bin/lib/context-compiler.ts` (`compileContext`, `compileContextExpansion`, `runCompileContext`)
- Modify: `bin/lib/router.ts` (`checkStructure`, `validateArtifact` normalization)
- Modify: `bin/lib/context.ts` (add `--task` to the eager value-validation list)
- Test: `test/context-compiler.test.ts`, `test/context-routing.test.ts`

**Interfaces:**
- Consumes: `isValidTaskId` (Task 1).
- Produces: `CompiledContextArtifact.task_id: string | null` and `artifact_role: 'primary' | 'expansion'`; `compileContext(..., options: { budget?, maxNodes?, maxDepth?, taskId?: string | null })` (returns `artifact_role: 'primary'`); `compileContextExpansion` returns `artifact_role: 'expansion'`. `validateArtifact` returns a **normalized** artifact (`task_id` defaulted to `null`, `artifact_role` to `'primary'`).

**Why the normalization ordering matters:** `computeArtifactEstimate` serializes the whole artifact, so adding `task_id`/`artifact_role` to a pre-3.9.0 artifact changes its token estimate. The estimate must be recomputed on the **raw** parsed object; normalization happens only on the returned value.

- [ ] **Step 1: Write the failing tests**

Add to `test/context-compiler.test.ts` (adapt imports/fixtures to the file's existing graph setup):

```ts
test('compileContext stamps task_id and primary role', () => {
  const artifact = compileContext(objective, curatedGraph, dependencyGraph, repoRoot, { budget: 6000, taskId: 'TASK-20260724-routing' });
  assert.equal(artifact.task_id, 'TASK-20260724-routing');
  assert.equal(artifact.artifact_role, 'primary');
});

test('compileContext defaults task_id to null', () => {
  const artifact = compileContext(objective, curatedGraph, dependencyGraph, repoRoot, { budget: 6000 });
  assert.equal(artifact.task_id, null);
  assert.equal(artifact.artifact_role, 'primary');
});
```

Add to `test/context-routing.test.ts` (exercises `checkStructure`/`validateArtifact`; adapt to its artifact-builder helper):

```ts
test('artifact validator rejects a malformed task_id', () => {
  const result = validateArtifact(writeArtifact({ ...validArtifact, task_id: 'not-a-task-id' }), repoRoot);
  assert.equal(result.status, 'invalid');
});

test('artifact validator rejects an unknown artifact_role', () => {
  const result = validateArtifact(writeArtifact({ ...validArtifact, artifact_role: 'sidecar' }), repoRoot);
  assert.equal(result.status, 'invalid');
});

test('artifact validator normalizes a legacy artifact (no task_id / artifact_role)', () => {
  // validArtifact is built WITHOUT the new fields and with an estimate computed
  // for that legacy shape, simulating a 3.8.0 artifact.
  const legacy = { ...validArtifact };
  delete (legacy as Record<string, unknown>).task_id;
  delete (legacy as Record<string, unknown>).artifact_role;
  const result = validateArtifact(writeArtifact(legacy), repoRoot);
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.equal(result.artifact.task_id, null);
    assert.equal(result.artifact.artifact_role, 'primary');
  }
});
```

(If the shared `validArtifact` fixture already includes the new fields once Step 3 lands, build the legacy fixture by recomputing its estimate on the field-less object — mirror however the test file currently recomputes/derives `estimated_tokens`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test test/context-compiler.test.ts test/context-routing.test.ts`
Expected: FAIL — new fields missing / not validated / not normalized.

- [ ] **Step 3: Add the fields to the type**

In `bin/lib/types.ts`, in `CompiledContextArtifact`, after `objective: string;`:

```ts
  objective: string;
  task_id: string | null;
  artifact_role: 'primary' | 'expansion';
```

- [ ] **Step 4: Stamp them in the compiler**

In `bin/lib/context-compiler.ts`, extend the `compileContext` options and returned literal:

```ts
export function compileContext(
  objective: string,
  curatedGraph: NonNullable<ReturnType<typeof readCuratedCodeGraph>>,
  dependencyGraph: DependencyGraph,
  repositoryRoot: string,
  options: { budget?: number; maxNodes?: number; maxDepth?: number; taskId?: string | null } = {}
): CompiledContextArtifact {
```

In the returned `artifact` literal, after `objective,`:

```ts
    objective,
    task_id: options.taskId ?? null,
    artifact_role: 'primary',
```

In `compileContextExpansion`, the returned literal **already** sets
`objective: \`[expansion] ${primary.objective}\`` (Phase 11 behavior — do NOT
change it). Add the two new fields immediately after that existing line:

```ts
    objective: `[expansion] ${primary.objective}`,
    task_id: primary.task_id,
    artifact_role: 'expansion',
```

Both fields are set **before** the estimate/fill pass runs (they are part of the artifact object it serializes), so new artifacts stay self-consistent.

- [ ] **Step 5: Wire `--task` into `runCompileContext`**

In `runCompileContext`, after the `objective` guard (import `isValidTaskId` from `./utils.js`):

```ts
  const taskIdArg = getArgValue('--task');
  if (taskIdArg !== null && !isValidTaskId(taskIdArg)) {
    process.stderr.write('Error: --task must be a valid task id (TASK-YYYYMMDD-slug).\n');
    process.exitCode = 1;
    return;
  }
```

Pass it through:

```ts
    const artifact = compileContext(objective, curatedGraph, dependencyGraph!, root, { budget, maxDepth, maxNodes, taskId: taskIdArg });
```

Add `[--task <id>]` to the usage string in the `objective` guard.

- [ ] **Step 6: Make `--task` a value-requiring flag**

In `bin/lib/context.ts`, add `--task` to the eager validation list so a bare flag fails fast:

```ts
for (const name of ['--profile', '--emit', '--adapter', '--model', '--task'] as const) {
```

- [ ] **Step 7: Validate + normalize in `router.ts`**

In `bin/lib/router.ts`, import `isValidTaskId` from `./utils.js`. **Export** the
structural validator so `--evaluate` can reuse it without the fingerprint/graph
freshness checks: rename `function checkStructure` to
`export function checkArtifactStructure` and update its single call site inside
`validateArtifact`. In that function, after the `objective` check:

```ts
  if (typeof a.objective !== 'string' || a.objective.length === 0) return 'objective must be a non-empty string';
  if (a.task_id !== null && a.task_id !== undefined && (typeof a.task_id !== 'string' || !isValidTaskId(a.task_id))) {
    return 'task_id must be null or a valid TASK-YYYYMMDD-slug string';
  }
  if (a.artifact_role !== undefined && a.artifact_role !== 'primary' && a.artifact_role !== 'expansion') {
    return "artifact_role must be 'primary' or 'expansion'";
  }
```

In `validateArtifact`, the estimate is already recomputed against the parsed object *before* the final `return { status: 'ok', artifact }`. Normalize **only** in that return so the raw shape drives the estimate:

```ts
  return {
    status: 'ok',
    artifact: { ...artifact, task_id: artifact.task_id ?? null, artifact_role: artifact.artifact_role ?? 'primary' },
  };
```

Do not move this normalization above the `computeArtifactEstimate` comparison.

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --import tsx --test test/context-compiler.test.ts test/context-routing.test.ts`
Expected: PASS. Then `npm run typecheck` — add `task_id: null, artifact_role: 'primary'` to any non-test `CompiledContextArtifact` literal the compiler flags.

- [ ] **Step 9: Commit**

```bash
git add bin/lib/types.ts bin/lib/context-compiler.ts bin/lib/router.ts bin/lib/context.ts test/context-compiler.test.ts test/context-routing.test.ts
git commit -m "feat(eval): stamp task_id and artifact_role into compiled context"
```

---

### Task 3: `task_id` on the run record + stamping at route time

**Files:**
- Modify: `bin/lib/types.ts` (`RunRecord`)
- Modify: `bin/lib/run-record.ts` (`isValidRunRecordInput`, `listRunRecords`)
- Modify: `bin/lib/api-adapter.ts` (record construction, ~line 198)
- Test: `test/run-record.test.ts` (add cases)

**Interfaces:**
- Consumes: `CompiledContextArtifact.task_id` (Task 2).
- Produces: `RunRecord.task_id: string | null`; `listRunRecords` always returns records with a non-`undefined` `task_id`.

- [ ] **Step 1: Write the failing tests**

Add to `test/run-record.test.ts` (uses the existing `makeRecord` helper and temp dir):

```ts
test('listRunRecords normalizes a pre-3.9.0 record without task_id to null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  const runsDir = path.join(dir, '.ai/state/runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const legacy = { ...makeRecord() } as Record<string, unknown>;
  delete legacy.task_id; // simulate a 3.8.0 record
  fs.writeFileSync(path.join(runsDir, 'run-legacy.json'), JSON.stringify(legacy));
  const [record] = listRunRecords(dir);
  assert.equal(record.task_id, null);
});

test('listRunRecords preserves a valid task_id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  const runsDir = path.join(dir, '.ai/state/runs');
  fs.mkdirSync(runsDir, { recursive: true });
  writeRunRecord({ ...makeRecord({ task_id: 'TASK-20260724-x' }) }, dir);
  const [record] = listRunRecords(dir);
  assert.equal(record.task_id, 'TASK-20260724-x');
});
```

Update the `makeRecord` helper to include `task_id: null` in its returned object (so the base fixture satisfies the new type).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test test/run-record.test.ts`
Expected: FAIL — `task_id` not on the type / not normalized.

- [ ] **Step 3: Add `task_id` to the type**

In `bin/lib/types.ts`, in `RunRecord`, add after `objective: string;`:

```ts
  objective: string;
  task_id: string | null;
```

- [ ] **Step 4: Accept + normalize on read**

In `bin/lib/run-record.ts`, in `isValidRunRecordInput`, add before `return true;`:

```ts
  const tid = r['task_id'];
  if (tid !== undefined && tid !== null && (typeof tid !== 'string' || tid.length === 0)) return false;
  return true;
```

In `listRunRecords`, extend the normalize push:

```ts
        records.push({
          ...(r as unknown as RunRecord),
          retry_count: (r['retry_count'] as number | undefined) ?? 0,
          task_id: (r['task_id'] as string | null | undefined) ?? null,
        });
```

- [ ] **Step 5: Stamp it at route time**

In `bin/lib/api-adapter.ts`, in the `record` object (~line 202), add `task_id` sourced from the artifact:

```ts
    artifact: artifactPath, objective: artifact.objective, task_id: artifact.task_id ?? null,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --import tsx --test test/run-record.test.ts`
Expected: PASS. Then `npm run typecheck` — fix any remaining `RunRecord` literals flagged (add `task_id: null`).

- [ ] **Step 7: Commit**

```bash
git add bin/lib/types.ts bin/lib/run-record.ts bin/lib/api-adapter.ts test/run-record.test.ts
git commit -m "feat(eval): carry task_id from artifact into run records"
```

---

### Task 4: `EvaluationRecord` type + storage module

**Files:**
- Modify: `bin/lib/types.ts` (add `EvaluationOutcome`, `EvaluationRecord`)
- Create: `bin/lib/evaluation-record.ts` (storage functions only in this task)
- Test: `test/evaluation-record.test.ts` (create)

**Interfaces:**
- Produces:
  - `EvaluationRecord` type (shape below).
  - `writeEvaluationRecord(record: EvaluationRecord, repositoryRoot: string): void` — atomic write to `.ai/state/evaluations/<task_id>.json`.
  - `readEvaluationRecord(taskId: string, repositoryRoot: string): EvaluationRecord | null`.
  - `listEvaluationRecords(repositoryRoot: string): EvaluationRecord[]` — newest-first by `generated_at`, skips malformed.

- [ ] **Step 1: Write the failing test**

Create `test/evaluation-record.test.ts`:

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeEvaluationRecord, readEvaluationRecord, listEvaluationRecords } from '../bin/lib/evaluation-record.js';
import type { EvaluationRecord } from '../bin/lib/types.js';

function makeEval(overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    kind: 'forgeai_evaluation_record',
    schema_version: 1,
    evaluation_id: 'eval-TASK-20260724-x',
    task_id: 'TASK-20260724-x',
    generated_at: '2026-07-24T00:00:00.000Z',
    outcome: 'pass',
    outcome_source: { type: 'review_scorecard', scorecard: '.ai/state/reviews/TASK-20260724-x.md', verdict: 'approve' },
    validation: { status: 'pass', evidence_count: 2, results: { pass: 2, fail: 0, skipped: 0 } },
    run_ids: ['run-1'],
    context_artifact: '.ai/state/context/TASK-20260724-x.json',
    task_journal: '.ai/state/tasks/TASK-20260724-x.md',
    tier: 'standard',
    metrics: {
      context: { selected_files: 3, excerpts: 5, omitted_candidates: 1, budget_limit_tokens: 6000, budget_estimated_tokens: 5000, budget_utilization: 0.833, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: 100, output_tokens: 20, cached_tokens: 0, latency_ms: 500, retries: 0 },
    },
    ...overrides,
  };
}
```

Add these storage-safety tests to the same file:

```ts
test('writeEvaluationRecord refuses a task_id with a path separator', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  assert.throws(() => writeEvaluationRecord(makeEval({ task_id: '../../escape' }), dir));
  assert.equal(fs.existsSync(path.join(dir, 'escape.json')), false);
});

test('readEvaluationRecord refuses a traversal task_id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  assert.equal(readEvaluationRecord('../../etc/passwd', dir), null);
});

test('a record missing metrics.calls is rejected on read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  const broken = makeEval() as Record<string, unknown>;
  delete (broken.metrics as Record<string, unknown>).calls;
  fs.writeFileSync(path.join(evalDir, 'TASK-20260724-x.json'), JSON.stringify(broken));
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir), null);
});

// Helper: write an arbitrary object to <taskId>.json and read it back.
function writeRaw(dir: string, fileTaskId: string, obj: unknown): void {
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  fs.writeFileSync(path.join(evalDir, `${fileTaskId}.json`), JSON.stringify(obj));
}

test('a record with a non-canonical generated_at is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeRaw(dir, 'TASK-20260724-x', makeEval({ generated_at: '2026-07-24' })); // not full ISO
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir), null);
});

test('a record whose evaluation_id does not match task_id is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeRaw(dir, 'TASK-20260724-x', makeEval({ evaluation_id: 'eval-wrong' }));
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir), null);
});

test('a record whose evidence_count != sum of results is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeRaw(dir, 'TASK-20260724-x', makeEval({ validation: { status: 'pass', evidence_count: 5, results: { pass: 2, fail: 0, skipped: 0 } } }));
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir), null);
});

test('listEvaluationRecords drops a record whose filename != task_id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  // Valid record content for TASK-20260724-x, but stored under a mismatched filename.
  writeRaw(dir, 'TASK-20260724-other', makeEval());
  assert.deepEqual(listEvaluationRecords(dir), []);
});

test('computeMetrics tolerates a decimal latency and the record still validates on read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  const withDecimalLatency = makeEval();
  withDecimalLatency.metrics.calls.latency_ms = 123.5;
  writeEvaluationRecord(withDecimalLatency, dir);
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir)?.metrics.calls.latency_ms, 123.5);
});

test('write then read round-trips an evaluation record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeEvaluationRecord(makeEval(), dir);
  const read = readEvaluationRecord('TASK-20260724-x', dir);
  assert.equal(read?.outcome, 'pass');
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), true);
});

test('write is idempotent — re-writing overwrites the same file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeEvaluationRecord(makeEval(), dir);
  writeEvaluationRecord(makeEval({ outcome: 'fail' }), dir);
  assert.equal(fs.readdirSync(path.join(dir, '.ai/state/evaluations')).length, 1);
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir)?.outcome, 'fail');
});

test('listEvaluationRecords skips malformed files and sorts newest first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeEvaluationRecord(makeEval({ task_id: 'TASK-20260724-a', evaluation_id: 'eval-TASK-20260724-a', generated_at: '2026-07-24T01:00:00.000Z' }), dir);
  writeEvaluationRecord(makeEval({ task_id: 'TASK-20260724-b', evaluation_id: 'eval-TASK-20260724-b', generated_at: '2026-07-24T02:00:00.000Z' }), dir);
  fs.writeFileSync(path.join(dir, '.ai/state/evaluations/broken.json'), '{ not json');
  const records = listEvaluationRecords(dir);
  assert.equal(records.length, 2);
  assert.equal(records[0].task_id, 'TASK-20260724-b');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/evaluation-record.test.ts`
Expected: FAIL — module `../bin/lib/evaluation-record.js` does not exist.

- [ ] **Step 3: Add the types**

In `bin/lib/types.ts` (after `RunRecord`), add:

```ts
export type EvaluationOutcome = 'pass' | 'fail' | 'partial';

export type EvaluationRecord = {
  kind: 'forgeai_evaluation_record';
  schema_version: 1;
  evaluation_id: string;
  task_id: string;
  generated_at: string;
  outcome: EvaluationOutcome;
  outcome_source: { type: 'review_scorecard'; scorecard: string; verdict: string };
  validation: {
    status: 'pass' | 'fail' | 'partial';
    evidence_count: number;
    results: { pass: number; fail: number; skipped: number };
  };
  run_ids: string[];
  context_artifact: string | null;
  task_journal: string;
  tier: string;
  metrics: {
    context: {
      selected_files: number;
      excerpts: number;
      omitted_candidates: number;
      budget_limit_tokens: number;
      budget_estimated_tokens: number;
      budget_utilization: number;
      expansion_rounds: number;
      context_escapes: number | null;
    };
    calls: {
      model_calls: number;
      input_tokens: number;
      output_tokens: number;
      cached_tokens: number;
      latency_ms: number;
      retries: number;
    };
  };
};
```

- [ ] **Step 4: Create the storage module**

Create `bin/lib/evaluation-record.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { EvaluationRecord } from './types.js';
import { formatStatus, isValidTaskId } from './utils.js';

const EVAL_DIR = '.ai/state/evaluations';

export function evaluationDir(repositoryRoot: string): string {
  return path.join(repositoryRoot, EVAL_DIR);
}

export function writeEvaluationRecord(record: EvaluationRecord, repositoryRoot: string): void {
  // Guard against path traversal: task_id is interpolated into the filename.
  if (!isValidTaskId(record.task_id)) {
    throw new Error(`refusing to write evaluation record with invalid task_id: ${record.task_id}`);
  }
  const dir = evaluationDir(repositoryRoot);
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, `${record.task_id}.json`);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(tmpPath, finalPath);
}

function isNonNegativeNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}
function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isValidEvaluationRecord(raw: unknown): raw is EvaluationRecord {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (r['kind'] !== 'forgeai_evaluation_record' || r['schema_version'] !== 1) return false;
  if (typeof r['task_id'] !== 'string' || !isValidTaskId(r['task_id'])) return false;
  // evaluation_id is deterministic and must match its task_id.
  if (r['evaluation_id'] !== `eval-${r['task_id']}`) return false;
  // generated_at must be a canonical round-trippable ISO timestamp.
  if (typeof r['generated_at'] !== 'string' || new Date(r['generated_at']).toISOString() !== r['generated_at']) return false;
  if (!['pass', 'fail', 'partial'].includes(r['outcome'] as string)) return false;
  if (typeof r['tier'] !== 'string') return false;
  if (!Array.isArray(r['run_ids']) || !r['run_ids'].every((id) => typeof id === 'string')) return false;
  if (r['context_artifact'] !== null && typeof r['context_artifact'] !== 'string') return false;
  if (typeof r['task_journal'] !== 'string') return false;

  const src = r['outcome_source'] as Record<string, unknown> | undefined;
  if (!src || src['type'] !== 'review_scorecard' || typeof src['scorecard'] !== 'string' || typeof src['verdict'] !== 'string') return false;

  const val = r['validation'] as Record<string, unknown> | undefined;
  if (!val || !['pass', 'fail', 'partial'].includes(val['status'] as string) || !isNonNegativeInt(val['evidence_count'])) return false;
  const vr = val['results'] as Record<string, unknown> | undefined;
  if (!vr || !isNonNegativeInt(vr['pass']) || !isNonNegativeInt(vr['fail']) || !isNonNegativeInt(vr['skipped'])) return false;
  // evidence_count must equal the sum of its parts.
  if ((val['evidence_count'] as number) !== (vr['pass'] as number) + (vr['fail'] as number) + (vr['skipped'] as number)) return false;

  const metrics = r['metrics'] as Record<string, unknown> | undefined;
  if (!metrics) return false;
  const ctx = metrics['context'] as Record<string, unknown> | undefined;
  if (!ctx) return false;
  // budget_utilization is a real ratio; the rest are non-negative integers.
  if (!isNonNegativeNumber(ctx['budget_utilization'])) return false;
  for (const f of ['selected_files', 'excerpts', 'omitted_candidates', 'budget_limit_tokens', 'budget_estimated_tokens', 'expansion_rounds']) {
    if (!isNonNegativeInt(ctx[f])) return false;
  }
  if (ctx['context_escapes'] !== null && !isNonNegativeInt(ctx['context_escapes'])) return false;
  const calls = metrics['calls'] as Record<string, unknown> | undefined;
  if (!calls) return false;
  // latency_ms is a non-negative real (RunRecord.latency_ms permits decimals);
  // the rest are non-negative integers.
  if (!isNonNegativeNumber(calls['latency_ms'])) return false;
  for (const f of ['model_calls', 'input_tokens', 'output_tokens', 'cached_tokens', 'retries']) {
    if (!isNonNegativeInt(calls[f])) return false;
  }
  return true;
}

export function readEvaluationRecord(taskId: string, repositoryRoot: string): EvaluationRecord | null {
  if (!isValidTaskId(taskId)) return null; // guard traversal before building a path
  const filePath = path.join(evaluationDir(repositoryRoot), `${taskId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isValidEvaluationRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function listEvaluationRecords(repositoryRoot: string): EvaluationRecord[] {
  const dir = evaluationDir(repositoryRoot);
  if (!fs.existsSync(dir)) return [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    process.stderr.write(`${formatStatus('warn', `cannot read evaluations directory (${dir}): ${String(err)}`)}\n`);
    return [];
  }
  const records: EvaluationRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.tmp')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      // Filename must equal `${task_id}.json` — records are keyed by task id, so a
      // mismatch means a stray/renamed file that would duplicate or misattribute.
      if (isValidEvaluationRecord(raw) && name === `${raw.task_id}.json`) records.push(raw);
    } catch {
      // skip malformed
    }
  }
  return records.sort((a, b) => b.generated_at.localeCompare(a.generated_at));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test test/evaluation-record.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 6: Commit**

```bash
git add bin/lib/types.ts bin/lib/evaluation-record.ts test/evaluation-record.test.ts
git commit -m "feat(eval): add EvaluationRecord type and storage module"
```

---

### Task 5: Tier resolution + metrics computation

**Files:**
- Modify: `bin/lib/evaluation-record.ts` (add pure functions)
- Test: `test/evaluation-record.test.ts` (add cases)

**Interfaces:**
- Consumes: `RunRecord` (Task 3), `CompiledContextArtifact` (Task 2).
- Produces:
  - `readRoutingTiers(repositoryRoot: string): Record<string, { provider: string; model: string }>`
  - `resolveTier(provider: string, model: string, tiers: Record<string, { provider: string; model: string }>): string`
  - `resolveTierForRuns(runs: RunRecord[], tiers: Record<string, { provider: string; model: string }>): string` — `'unknown'` if there are no runs or the runs resolve to more than one distinct non-`unknown` tier.
  - `computeMetrics(artifact: CompiledContextArtifact | null, runs: RunRecord[], expansionCount: number): EvaluationRecord['metrics']`

- [ ] **Step 1: Write the failing tests**

Add to `test/evaluation-record.test.ts`:

```ts
import { readRoutingTiers, resolveTier, resolveTierForRuns, computeMetrics } from '../bin/lib/evaluation-record.js';
import type { CompiledContextArtifact, RunRecord } from '../bin/lib/types.js';

test('resolveTier matches provider+model and falls back to unknown', () => {
  const tiers = { standard: { provider: 'anthropic', model: 'claude-sonnet-4-6' } };
  assert.equal(resolveTier('anthropic', 'claude-sonnet-4-6', tiers), 'standard');
  assert.equal(resolveTier('openai', 'gpt-4.1', tiers), 'unknown');
});

test('resolveTierForRuns returns unknown for no runs or disagreement', () => {
  const tiers = {
    fast: { provider: 'gemini', model: 'gemini-2.5-flash' },
    standard: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  };
  assert.equal(resolveTierForRuns([], tiers), 'unknown');
  const agree = [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }, { provider: 'anthropic', model: 'claude-sonnet-4-6' }] as unknown as RunRecord[];
  assert.equal(resolveTierForRuns(agree, tiers), 'standard');
  const disagree = [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }, { provider: 'gemini', model: 'gemini-2.5-flash' }] as unknown as RunRecord[];
  assert.equal(resolveTierForRuns(disagree, tiers), 'unknown');
});

test('readRoutingTiers parses tiers from model-routing.yaml', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  fs.mkdirSync(path.join(dir, '.ai'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ai/model-routing.yaml'),
    'tiers:\n  fast:\n    provider: gemini\n    model: gemini-2.5-flash\n  standard:\n    provider: anthropic\n    model: claude-sonnet-4-6\n');
  const tiers = readRoutingTiers(dir);
  assert.equal(tiers.fast.model, 'gemini-2.5-flash');
  assert.equal(tiers.standard.provider, 'anthropic');
});

test('computeMetrics sums call metrics and derives context metrics', () => {
  const artifact = {
    selection: { files: [{}, {}, {}] },
    excerpts: [{}, {}],
    omitted_candidates: 4,
    budget: { limit_tokens: 6000, estimated_tokens: 4800 },
  } as unknown as CompiledContextArtifact;
  const runs = [
    { input_tokens: 100, output_tokens: 20, cached_tokens: 5, latency_ms: 300, retry_count: 1 },
    { input_tokens: 50, output_tokens: 10, cached_tokens: null, latency_ms: 200, retry_count: 0 },
  ] as unknown as RunRecord[];
  const metrics = computeMetrics(artifact, runs, 2);
  assert.equal(metrics.context.selected_files, 3);
  assert.equal(metrics.context.excerpts, 2);
  assert.equal(metrics.context.omitted_candidates, 4);
  assert.equal(metrics.context.budget_utilization, 0.8);
  assert.equal(metrics.context.expansion_rounds, 2);
  assert.equal(metrics.context.context_escapes, null);
  assert.equal(metrics.calls.model_calls, 2);
  assert.equal(metrics.calls.input_tokens, 150);
  assert.equal(metrics.calls.cached_tokens, 5);
  assert.equal(metrics.calls.retries, 1);
});

test('computeMetrics handles a null artifact and empty runs', () => {
  const metrics = computeMetrics(null, [], 0);
  assert.equal(metrics.context.selected_files, 0);
  assert.equal(metrics.calls.model_calls, 0);
  assert.equal(metrics.context.budget_utilization, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test test/evaluation-record.test.ts`
Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Implement the functions**

Append to `bin/lib/evaluation-record.ts` (add `import type { CompiledContextArtifact, RunRecord } from './types.js';` to the existing type import):

```ts
export function readRoutingTiers(repositoryRoot: string): Record<string, { provider: string; model: string }> {
  const filePath = path.join(repositoryRoot, '.ai/model-routing.yaml');
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const tiersIndex = lines.findIndex((line) => /^tiers:\s*$/.test(line));
  if (tiersIndex === -1) return {};
  const tiers: Record<string, { provider: string; model: string }> = {};
  let current: string | null = null;
  for (let i = tiersIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // left the tiers: block (column-0 key)
    const header = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (header) { current = header[1]; tiers[current] = { provider: '', model: '' }; continue; }
    if (!current) continue;
    const prov = line.match(/^    provider:\s*(.+?)\s*$/);
    if (prov) tiers[current].provider = prov[1].replace(/^["']|["']$/g, '');
    const model = line.match(/^    model:\s*(.+?)\s*$/);
    if (model) tiers[current].model = model[1].replace(/^["']|["']$/g, '');
  }
  return tiers;
}

export function resolveTier(provider: string, model: string, tiers: Record<string, { provider: string; model: string }>): string {
  for (const [name, entry] of Object.entries(tiers)) {
    if (entry.provider === provider && entry.model === model) return name;
  }
  return 'unknown';
}

export function resolveTierForRuns(runs: RunRecord[], tiers: Record<string, { provider: string; model: string }>): string {
  const resolved = new Set(runs.map((r) => resolveTier(r.provider, r.model, tiers)).filter((t) => t !== 'unknown'));
  return resolved.size === 1 ? [...resolved][0] : 'unknown';
}

export function computeMetrics(artifact: CompiledContextArtifact | null, runs: RunRecord[], expansionCount: number): EvaluationRecord['metrics'] {
  const limit = artifact ? artifact.budget.limit_tokens : 0;
  const estimated = artifact ? artifact.budget.estimated_tokens : 0;
  const sum = (pick: (r: RunRecord) => number | null) => runs.reduce((total, r) => total + (pick(r) ?? 0), 0);
  return {
    context: {
      selected_files: artifact ? artifact.selection.files.length : 0,
      excerpts: artifact ? artifact.excerpts.length : 0,
      omitted_candidates: artifact ? artifact.omitted_candidates : 0,
      budget_limit_tokens: limit,
      budget_estimated_tokens: estimated,
      budget_utilization: limit > 0 ? Math.round((estimated / limit) * 1000) / 1000 : 0,
      // Count of expansion artifacts recorded for this task (see runEvaluate).
      expansion_rounds: expansionCount,
      // null = not measured in 13A: rejected need_context requests are only
      // warned to stderr, never persisted. 0 would falsely assert "no escapes".
      context_escapes: null,
    },
    calls: {
      model_calls: runs.length,
      input_tokens: sum((r) => r.input_tokens),
      output_tokens: sum((r) => r.output_tokens),
      cached_tokens: sum((r) => r.cached_tokens),
      latency_ms: sum((r) => r.latency_ms),
      retries: sum((r) => r.retry_count),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test test/evaluation-record.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add bin/lib/evaluation-record.ts test/evaluation-record.test.ts
git commit -m "feat(eval): add tier resolution and metric computation"
```

---

### Task 6: Consistency gate + outcome derivation

**Files:**
- Modify: `bin/lib/evaluation-record.ts` (add `buildEvaluationRecord`)
- Test: `test/evaluation-record.test.ts` (add cases)

**Interfaces:**
- Consumes: `review.ts` helpers `extractTableRows`, `extractLabeledValue`, `isRealEvidenceRow`, `validRecommendations`; `lifecycle.ts` `extractBulletValue`; `computeMetrics`, `resolveTierForRuns` (Task 5).
- Produces:
  ```ts
  type BuildInput = {
    taskId: string;
    journalContent: string;   // task journal markdown
    journalPath: string;      // repo-relative path for provenance
    scorecardContent: string; // scorecard markdown
    scorecardPath: string;    // repo-relative path for provenance
    runs: RunRecord[];
    artifact: CompiledContextArtifact | null;
    artifactPath: string | null; // repo-relative
    expansionCount: number;      // # of expansion artifacts for the task
    tiers: Record<string, { provider: string; model: string }>;
    now: string;              // ISO timestamp (injectable for tests)
  };
  type BuildResult = { ok: true; record: EvaluationRecord } | { ok: false; errors: string[] };
  export function buildEvaluationRecord(input: BuildInput): BuildResult;
  ```

- [ ] **Step 1: Write the failing tests**

Add to `test/evaluation-record.test.ts`:

```ts
import { buildEvaluationRecord } from '../bin/lib/evaluation-record.js';

const APPROVE_SCORECARD = [
  '- Task ID: `TASK-20260724-x`',
  '',
  '## Scorecard',
  '| Dimension | Rating | Notes |',
  '| --- | --- | --- |',
  '| Correctness | pass | ok |',
  '',
  'Unresolved blockers: none',
  '',
  'Verdict: Approve',
].join('\n');

const JOURNAL_WITH_EVIDENCE = [
  '- Task ID: TASK-20260724-x',
  '',
  '## Commands And Validation',
  '| Date | Command | Result |',
  '| --- | --- | --- |',
  '| 2026-07-24 | npm test | pass |',
].join('\n');

function baseInput(overrides = {}) {
  return {
    taskId: 'TASK-20260724-x',
    journalContent: JOURNAL_WITH_EVIDENCE,
    journalPath: '.ai/state/tasks/TASK-20260724-x.md',
    scorecardContent: APPROVE_SCORECARD,
    scorecardPath: '.ai/state/reviews/TASK-20260724-x.md',
    runs: [] as RunRecord[],
    artifact: null,
    artifactPath: null,
    expansionCount: 0,
    tiers: {},
    now: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

test('buildEvaluationRecord maps Approve to pass', () => {
  const result = buildEvaluationRecord(baseInput());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.record.outcome, 'pass');
    assert.equal(result.record.evaluation_id, 'eval-TASK-20260724-x');
    assert.equal(result.record.validation.status, 'pass');
  }
});

test('buildEvaluationRecord maps Request changes to fail and Needs human decision to partial', () => {
  const fail = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD.replace('Verdict: Approve', 'Verdict: Request changes') }));
  assert.equal(fail.ok && fail.record.outcome, 'fail');
  const partial = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD.replace('Verdict: Approve', 'Verdict: Needs human decision') }));
  assert.equal(partial.ok && partial.record.outcome, 'partial');
});

test('buildEvaluationRecord rejects a scorecard with lowercase todo', () => {
  const result = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD + '\ntodo' }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects Approve with unresolved blockers', () => {
  const result = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD.replace('Unresolved blockers: none', 'Unresolved blockers: security review pending') }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects Approve contradicted by a fail dimension rating', () => {
  const result = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD.replace('| Correctness | pass | ok |', '| Correctness | fail | broken |') }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects an empty or invalid dimension rating', () => {
  const empty = APPROVE_SCORECARD.replace('| Correctness | pass | ok |', '| Correctness |  | ok |');
  assert.equal(buildEvaluationRecord(baseInput({ scorecardContent: empty })).ok, false);
  const invalid = APPROVE_SCORECARD.replace('| Correctness | pass | ok |', '| Correctness | maybe | ok |');
  assert.equal(buildEvaluationRecord(baseInput({ scorecardContent: invalid })).ok, false);
});

test('buildEvaluationRecord rejects a scorecard with no dimension rows', () => {
  const noRows = ['- Task ID: `TASK-20260724-x`', '', '## Scorecard', '| Dimension | Rating | Notes |', '| --- | --- | --- |', '', 'Unresolved blockers: none', '', 'Verdict: Approve'].join('\n');
  assert.equal(buildEvaluationRecord(baseInput({ scorecardContent: noRows })).ok, false);
});

test('buildEvaluationRecord rejects Approve contradicted by fail evidence', () => {
  const journal = JOURNAL_WITH_EVIDENCE.replace('npm test | pass', 'npm test | fail');
  const result = buildEvaluationRecord(baseInput({ journalContent: journal }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects when no real validation evidence', () => {
  const journal = ['## Commands And Validation', '| Date | Command | Result |', '| --- | --- | --- |'].join('\n');
  const result = buildEvaluationRecord(baseInput({ journalContent: journal }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects a scorecard task-id mismatch', () => {
  const result = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD.replace('TASK-20260724-x', 'TASK-20260724-y') }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects an invalid verdict', () => {
  const result = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD.replace('Verdict: Approve', 'Verdict: Maybe') }));
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test test/evaluation-record.test.ts`
Expected: FAIL — `buildEvaluationRecord` not exported.

- [ ] **Step 3: Implement the gate**

Append to `bin/lib/evaluation-record.ts` (add imports at top:
`import { extractTableRows, extractLabeledValue, isRealEvidenceRow, validRecommendations } from './review.js';`
and `import { extractBulletValue } from './lifecycle.js';`):

```ts
type BuildInput = {
  taskId: string;
  journalContent: string;
  journalPath: string;
  scorecardContent: string;
  scorecardPath: string;
  runs: RunRecord[];
  artifact: CompiledContextArtifact | null;
  artifactPath: string | null;
  expansionCount: number;
  tiers: Record<string, { provider: string; model: string }>;
  now: string;
};
type BuildResult = { ok: true; record: EvaluationRecord } | { ok: false; errors: string[] };

const VERDICT_TO_OUTCOME: Record<string, EvaluationRecord['outcome']> = {
  approve: 'pass',
  'request changes': 'fail',
  'needs human decision': 'partial',
};
const VALID_RATINGS = new Set(['pass', 'concern', 'fail']);

export function buildEvaluationRecord(input: BuildInput): BuildResult {
  const errors: string[] = [];
  const { taskId, journalContent, scorecardContent, scorecardPath } = input;

  // Scorecard Task ID bullet must match the requested task id.
  const scorecardTaskId = extractBulletValue(scorecardContent, 'Task ID');
  if (scorecardTaskId !== taskId) {
    errors.push(`scorecard Task ID "${scorecardTaskId}" does not match --task ${taskId}`);
  }

  if (/\bTODO\b/i.test(scorecardContent)) {
    errors.push('scorecard still contains a TODO/placeholder');
  }

  const verdict = extractLabeledValue(scorecardContent, 'Verdict').toLowerCase();
  if (!validRecommendations.includes(verdict)) {
    errors.push(`Verdict must be Approve, Request changes, or Needs human decision (got: ${verdict || 'missing'})`);
  }

  // Require at least one dimension row, and every rating must be pass|concern|fail.
  const dimensionRows = extractTableRows(scorecardContent, 'Scorecard');
  if (dimensionRows.length === 0) {
    errors.push('scorecard has no dimension rows');
  }
  let anyDimensionFail = false;
  for (const cells of dimensionRows) {
    const rating = (cells[1] ?? '').toLowerCase();
    if (!VALID_RATINGS.has(rating)) {
      errors.push(`scorecard rating "${cells[1] ?? ''}" is not pass|concern|fail`);
    }
    if (rating === 'fail') anyDimensionFail = true;
  }

  // Validation evidence comes from the journal's Commands And Validation table.
  const evidenceRows = extractTableRows(journalContent, 'Commands And Validation').filter(isRealEvidenceRow);
  if (evidenceRows.length === 0) {
    errors.push('no real validation evidence in the journal Commands And Validation table');
  }
  const results = { pass: 0, fail: 0, skipped: 0 };
  for (const cells of evidenceRows) {
    const r = (cells[2] ?? '').toLowerCase();
    if (r === 'pass' || r === 'fail' || r === 'skipped') results[r] += 1;
  }

  // Approve must not be contradicted by fail evidence, a fail dimension rating,
  // or unresolved blockers.
  if (verdict === 'approve') {
    if (results.fail > 0) errors.push('verdict Approve contradicted by a fail validation row');
    if (anyDimensionFail) errors.push('verdict Approve contradicted by a fail scorecard dimension');
    const blockers = extractLabeledValue(scorecardContent, 'Unresolved blockers').toLowerCase();
    if (blockers !== '' && blockers !== 'none') errors.push(`verdict Approve but unresolved blockers: ${blockers}`);
  }

  if (errors.length > 0) return { ok: false, errors };

  const validationStatus: EvaluationRecord['validation']['status'] =
    results.fail > 0 ? 'fail' : results.pass > 0 ? 'pass' : 'partial';

  const record: EvaluationRecord = {
    kind: 'forgeai_evaluation_record',
    schema_version: 1,
    evaluation_id: `eval-${taskId}`,
    task_id: taskId,
    generated_at: input.now,
    outcome: VERDICT_TO_OUTCOME[verdict],
    outcome_source: { type: 'review_scorecard', scorecard: scorecardPath, verdict },
    validation: { status: validationStatus, evidence_count: evidenceRows.length, results },
    run_ids: input.runs.map((r) => r.run_id),
    context_artifact: input.artifactPath,
    task_journal: input.journalPath,
    tier: resolveTierForRuns(input.runs, input.tiers),
    metrics: computeMetrics(input.artifact, input.runs, input.expansionCount),
  };
  return { ok: true, record };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test test/evaluation-record.test.ts`
Expected: PASS (all gate cases).

- [ ] **Step 5: Commit**

```bash
git add bin/lib/evaluation-record.ts test/evaluation-record.test.ts
git commit -m "feat(eval): add consistency gate and outcome derivation"
```

---

### Task 7: `--evaluate --task <id>` command wiring

**Files:**
- Modify: `bin/lib/evaluation-record.ts` (add `runEvaluate`)
- Modify: `bin/lib/context.ts` (add `evaluate` flag)
- Modify: `bin/forgeai-init.ts` (dispatch)
- Modify: `bin/lib/init.ts` (`usage()` help text)
- Test: `test/evaluate-command.test.ts` (create)

**Interfaces:**
- Consumes: `buildEvaluationRecord`, `writeEvaluationRecord`, `readRoutingTiers` (Tasks 4–6); `listRunRecords` (`run-record.js`); `listTaskJournalFiles`, `parseTaskJournal` (`lifecycle.js`); `getArgValue`, `root` (`context.js`); `isValidTaskId` (`utils.js`).
- Produces: `runEvaluate(): void` — resolves inputs by `task_id`, runs the gate, writes one record, prints result; exit code 1 with no write on any failure.

- [ ] **Step 1: Write the failing test**

Create `test/evaluate-command.test.ts`. Use the shared `test/helpers.ts`
(`cli` = absolute path to the CLI; `runTs` runs it with an **absolute** tsx
loader so it resolves from any `cwd`). `runTs` throws on a non-zero exit (it uses
`execFileSync`), so wrap it in a small `run` helper that captures status/stdout/
stderr — the same convention as `test/security.test.ts` and `test/check.test.ts`.

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, runTs, type ExecError } from './helpers.js';

function run(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = runTs(cli, args, { cwd });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as ExecError;
    return { status: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
}

function setupRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-evalcmd-'));
  fs.mkdirSync(path.join(dir, '.ai/state/tasks'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.ai/state/reviews'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ai/state/tasks/TASK-20260724-x.md'),
    ['- Task ID: TASK-20260724-x', '', '## Commands And Validation', '| Date | Command | Result |', '| --- | --- | --- |', '| 2026-07-24 | npm test | pass |'].join('\n'));
  fs.writeFileSync(path.join(dir, '.ai/state/reviews/TASK-20260724-x.md'),
    ['- Task ID: `TASK-20260724-x`', '', '## Scorecard', '| Dimension | Rating | Notes |', '| --- | --- | --- |', '| Correctness | pass | ok |', '', 'Unresolved blockers: none', '', 'Verdict: Approve'].join('\n'));
  return dir;
}

// Compiles a real, structurally-valid artifact stamped with the given task id,
// then returns its JSON string. Mirrors initAndCompile in context-routing.test.ts.
function compileArtifact(dir: string, taskId: string): string {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'entry.ts'), 'export function runCli() { return 42; }\n');
  runTs(cli, [], { cwd: dir });
  runTs(cli, ['--refresh-codegraph'], { cwd: dir });
  return runTs(cli, ['--compile-context', '--objective', 'change runCli implementation', '--budget', '4000', '--task', taskId], { cwd: dir });
}

test('--evaluate writes a pass record for an approved task', () => {
  const dir = setupRepo();
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8'));
  assert.equal(record.outcome, 'pass');
});

test('--evaluate fails and writes nothing when the scorecard is missing', () => {
  const dir = setupRepo();
  fs.rmSync(path.join(dir, '.ai/state/reviews/TASK-20260724-x.md'));
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('--evaluate errors on a missing --task argument', () => {
  const dir = setupRepo();
  const result = run(dir, ['--evaluate']);
  assert.equal(result.status, 1);
});

test('--evaluate errors on a bare --task with no value', () => {
  const dir = setupRepo();
  const result = run(dir, ['--evaluate', '--task']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--task requires a value/);
});

test('--evaluate fails on two primary artifacts for the same task', () => {
  const dir = setupRepo();
  const compiled = compileArtifact(dir, 'TASK-20260724-x'); // structurally valid, artifact_role primary
  const ctxDir = path.join(dir, '.ai/state/context');
  fs.mkdirSync(ctxDir, { recursive: true }); // compileArtifact prints to stdout, so the dir may not exist yet
  fs.writeFileSync(path.join(ctxDir, 'copy-a.json'), compiled);
  fs.writeFileSync(path.join(ctxDir, 'copy-b.json'), compiled);
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('--evaluate ignores a malformed context artifact and still succeeds', () => {
  const dir = setupRepo();
  const ctxDir = path.join(dir, '.ai/state/context');
  fs.mkdirSync(ctxDir, { recursive: true });
  fs.writeFileSync(path.join(ctxDir, 'broken.json'), '{ not valid');
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 0, result.stderr);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/evaluate-command.test.ts`
Expected: FAIL — `--evaluate` is unrecognized (falls through to `runInit`).

- [ ] **Step 3: Implement `runEvaluate`**

Append to `bin/lib/evaluation-record.ts` (add imports:
`import { root, getArgValue } from './context.js';`
`import { isValidTaskId } from './utils.js';` — already imported from Task 4
`import { listRunRecords } from './run-record.js';`
`import { listTaskJournalFiles, parseTaskJournal } from './lifecycle.js';`
`import { checkArtifactStructure } from './router.js';`
`import type { CompiledContextArtifact } from './types.js';` — already imported):

> Import note: `evaluation-record.ts` imports `checkArtifactStructure` from
> `router.ts`, and `router.ts` does not import `evaluation-record.ts`, so there is
> no cycle. If a cycle is later introduced, move `checkArtifactStructure` into a
> leaf module instead.

```ts
type ArtifactLookup = { primary: { rel: string; artifact: CompiledContextArtifact } | null; expansionCount: number; multiplePrimary: boolean };

function findArtifactsForTask(taskId: string, repositoryRoot: string): ArtifactLookup {
  const dir = path.join(repositoryRoot, '.ai/state/context');
  const lookup: ArtifactLookup = { primary: null, expansionCount: 0, multiplePrimary: false };
  if (!fs.existsSync(dir)) return lookup;
  const primaries: Array<{ rel: string; artifact: CompiledContextArtifact }> = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { continue; }
    // Full structural validation (schema_version, task_id/artifact_role shape,
    // selection/excerpts/budget, etc.) WITHOUT fingerprint/graph freshness, so an
    // artifact compiled against an earlier revision is still evaluable. Malformed
    // artifacts are skipped, never crashing computeMetrics.
    if (checkArtifactStructure(raw) !== null) continue;
    const artifact = raw as CompiledContextArtifact;
    if (artifact.task_id !== taskId) continue;
    if ((artifact.artifact_role ?? 'primary') === 'expansion') { lookup.expansionCount += 1; continue; }
    primaries.push({ rel: `.ai/state/context/${name}`, artifact });
  }
  if (primaries.length > 1) lookup.multiplePrimary = true;
  else lookup.primary = primaries[0] ?? null;
  return lookup;
}

export function runEvaluate(): void {
  const taskId = getArgValue('--task');
  if (!taskId) {
    process.stderr.write('Usage: forgeai-init --evaluate --task <TASK-YYYYMMDD-slug>\n');
    process.exitCode = 1;
    return;
  }
  if (!isValidTaskId(taskId)) {
    process.stderr.write(`Error: "${taskId}" is not a valid task id (TASK-YYYYMMDD-slug).\n`);
    process.exitCode = 1;
    return;
  }

  const journalFiles = listTaskJournalFiles().filter((file) => parseTaskJournal(file).taskId === taskId);
  if (journalFiles.length === 0) {
    process.stderr.write(formatStatus('invalid', `no task journal found for ${taskId}`) + '\n');
    process.exitCode = 1;
    return;
  }
  if (journalFiles.length > 1) {
    process.stderr.write(formatStatus('invalid', `multiple task journals match ${taskId}`) + '\n');
    process.exitCode = 1;
    return;
  }
  const journalContent = fs.readFileSync(path.join(root, journalFiles[0]), 'utf8');

  const scorecardRel = `.ai/state/reviews/${taskId}.md`;
  const scorecardAbs = path.join(root, scorecardRel);
  if (!fs.existsSync(scorecardAbs)) {
    process.stderr.write(formatStatus('missing', `${scorecardRel} scorecard for ${taskId}`) + '\n');
    process.exitCode = 1;
    return;
  }
  const scorecardContent = fs.readFileSync(scorecardAbs, 'utf8');

  const lookup = findArtifactsForTask(taskId, root);
  if (lookup.multiplePrimary) {
    process.stderr.write(formatStatus('invalid', `multiple primary context artifacts match ${taskId}`) + '\n');
    process.exitCode = 1;
    return;
  }
  const artifact = lookup.primary?.artifact ?? null;
  const artifactPath = lookup.primary?.rel ?? null;

  const runs = listRunRecords(root).filter((r) => r.task_id === taskId);
  const tiers = readRoutingTiers(root);

  const result = buildEvaluationRecord({
    taskId, journalContent, journalPath: journalFiles[0], scorecardContent, scorecardPath: scorecardRel,
    runs, artifact, artifactPath, expansionCount: lookup.expansionCount, tiers, now: new Date().toISOString(),
  });

  if (!result.ok) {
    console.log('ForgeAI evaluation');
    console.log('');
    for (const err of result.errors) console.log(formatStatus('invalid', err));
    console.log('');
    console.log('Result: evaluation failed. No record written.');
    process.exitCode = 1;
    return;
  }

  writeEvaluationRecord(result.record, root);
  console.log('ForgeAI evaluation');
  console.log('');
  console.log(formatStatus('ok', `${taskId} → ${result.record.outcome} (verdict: ${result.record.outcome_source.verdict}, ${runs.length} run${runs.length === 1 ? '' : 's'})`));
  console.log(formatStatus('ok', `written to .ai/state/evaluations/${taskId}.json`));
}
```

- [ ] **Step 4: Wire the flag and dispatch**

In `bin/lib/context.ts`, add near the other flags:

```ts
export const evaluate = args.has('--evaluate');
```

In `bin/forgeai-init.ts`, add `evaluate` to the `context.js` import list, add `import { runEvaluate } from './lib/evaluation-record.js';`, and add to the dispatch chain (before `else runInit()`):

```ts
else if (evaluate) runEvaluate();
```

In `bin/lib/init.ts` `usage()`, add a help line near `--check-evaluation`:

```
  --evaluate --task <id>
                Build a structured evaluation record for a task from its
                review scorecard, journal, run records, and context artifact.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test test/evaluate-command.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 6: Commit**

```bash
git add bin/lib/evaluation-record.ts bin/lib/context.ts bin/forgeai-init.ts bin/lib/init.ts test/evaluate-command.test.ts
git commit -m "feat(eval): add --evaluate command"
```

---

### Task 8: `--report` command

**Files:**
- Create: `bin/lib/evaluation-report.ts`
- Modify: `bin/lib/context.ts` (add `report` flag)
- Modify: `bin/forgeai-init.ts` (dispatch)
- Modify: `bin/lib/init.ts` (`usage()` help text)
- Test: `test/evaluation-report.test.ts` (create)

**Interfaces:**
- Consumes: `listEvaluationRecords` (Task 4), `EvaluationRecord` type.
- Produces:
  - `aggregateEvaluations(records: EvaluationRecord[]): { total: number; outcomes: { pass: number; partial: number; fail: number }; byTier: Record<string, { count: number; pass: number; partial: number; fail: number; input_tokens: number; output_tokens: number; latency_ms: number; retries: number }> }`
  - `runReport(): void`

- [ ] **Step 1: Write the failing test**

Create `test/evaluation-report.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateEvaluations } from '../bin/lib/evaluation-report.js';
import type { EvaluationRecord } from '../bin/lib/types.js';

function rec(tier: string, outcome: EvaluationRecord['outcome'], input: number): EvaluationRecord {
  return {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: 'e', task_id: 't',
    generated_at: '2026-07-24T00:00:00.000Z', outcome,
    outcome_source: { type: 'review_scorecard', scorecard: 's', verdict: 'approve' },
    validation: { status: 'pass', evidence_count: 1, results: { pass: 1, fail: 0, skipped: 0 } },
    run_ids: [], context_artifact: null, task_journal: '.ai/state/tasks/t.md', tier,
    metrics: {
      context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: input, output_tokens: 10, cached_tokens: 0, latency_ms: 100, retries: 0 },
    },
  };
}

test('aggregateEvaluations groups by tier, counts outcomes, and totals tokens', () => {
  const agg = aggregateEvaluations([rec('standard', 'pass', 100), rec('standard', 'fail', 200), rec('fast', 'pass', 50)]);
  assert.equal(agg.total, 3);
  assert.equal(agg.outcomes.pass, 2);
  assert.equal(agg.outcomes.fail, 1);
  assert.equal(agg.byTier.standard.count, 2);
  assert.equal(agg.byTier.standard.input_tokens, 300);
  assert.equal(agg.byTier.standard.output_tokens, 20);
  // total tokens = 300 in + 20 out = 320 over 2 evaluations → mean 160
  assert.equal((agg.byTier.standard.input_tokens + agg.byTier.standard.output_tokens) / agg.byTier.standard.count, 160);
  assert.equal(agg.byTier.fast.pass, 1);
});

test('aggregateEvaluations handles an empty list', () => {
  const agg = aggregateEvaluations([]);
  assert.equal(agg.total, 0);
  assert.deepEqual(agg.byTier, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/evaluation-report.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the report**

Create `bin/lib/evaluation-report.ts`:

```ts
import type { EvaluationRecord } from './types.js';
import { root, args } from './context.js';
import { formatStatus } from './utils.js';
import { listEvaluationRecords } from './evaluation-record.js';

type TierAgg = { count: number; pass: number; partial: number; fail: number; input_tokens: number; output_tokens: number; latency_ms: number; retries: number };
type Aggregate = { total: number; outcomes: { pass: number; partial: number; fail: number }; byTier: Record<string, TierAgg> };

export function aggregateEvaluations(records: EvaluationRecord[]): Aggregate {
  const agg: Aggregate = { total: records.length, outcomes: { pass: 0, partial: 0, fail: 0 }, byTier: {} };
  for (const r of records) {
    agg.outcomes[r.outcome] += 1;
    const tier = (agg.byTier[r.tier] ??= { count: 0, pass: 0, partial: 0, fail: 0, input_tokens: 0, output_tokens: 0, latency_ms: 0, retries: 0 });
    tier.count += 1;
    tier[r.outcome] += 1;
    tier.input_tokens += r.metrics.calls.input_tokens;
    tier.output_tokens += r.metrics.calls.output_tokens;
    tier.latency_ms += r.metrics.calls.latency_ms;
    tier.retries += r.metrics.calls.retries;
  }
  return agg;
}

function passRate(pass: number, total: number): string {
  return total === 0 ? 'n/a' : `${Math.round((pass / total) * 100)}%`;
}

export function runReport(): void {
  const records = listEvaluationRecords(root);
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(aggregateEvaluations(records), null, 2)}\n`);
    return;
  }
  console.log('ForgeAI evaluation report');
  console.log('');
  if (records.length === 0) {
    console.log(formatStatus('ok', '.ai/state/evaluations has no evaluation records'));
    return;
  }
  const agg = aggregateEvaluations(records);
  console.log(formatStatus('metric', `evaluations: ${agg.total} (pass ${agg.outcomes.pass} / partial ${agg.outcomes.partial} / fail ${agg.outcomes.fail}) — pass rate ${passRate(agg.outcomes.pass, agg.total)}`));
  console.log('');
  console.log('By tier');
  for (const [tier, t] of Object.entries(agg.byTier).sort((a, b) => a[0].localeCompare(b[0]))) {
    const totalTokens = t.input_tokens + t.output_tokens;
    const meanTokens = Math.round(totalTokens / t.count);
    const meanLatency = Math.round(t.latency_ms / t.count);
    console.log(formatStatus('metric', `${tier}: ${t.count} evaluation${t.count === 1 ? '' : 's'}, pass rate ${passRate(t.pass, t.count)}, tokens in=${t.input_tokens} out=${t.output_tokens} (total ${totalTokens}, mean ${meanTokens}), mean latency ${meanLatency}ms, retries ${t.retries}`));
  }
}
```

`--json` is a bare boolean flag; `args.has('--json')` (from `context.ts`) is the
correct check. Do **not** use `getArgValue('--json')`, which returns `string |
null` and is never `undefined`.

- [ ] **Step 4: Wire the flag and dispatch**

In `bin/lib/context.ts`:

```ts
export const report = args.has('--report');
```

In `bin/forgeai-init.ts`, add `report` to the `context.js` imports, add `import { runReport } from './lib/evaluation-report.js';`, and add before `else runInit()`:

```ts
else if (report) runReport();
```

In `bin/lib/init.ts` `usage()`, add:

```
  --report [--json]
                Aggregate evaluation records by model tier (pass rate, token
                cost, latency, retries). --json emits the aggregate for CI.
```

- [ ] **Step 5: Add CLI tests for both output modes**

Add to `test/evaluation-report.test.ts` (import the shared helpers; `runTs`
throws on non-zero exit, so wrap it):

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cli, runTs } from './helpers.js';

function writeRecordFile(dir: string, taskId: string, tier: string): void {
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  const record = {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: `eval-${taskId}`, task_id: taskId,
    generated_at: '2026-07-24T00:00:00.000Z', outcome: 'pass',
    outcome_source: { type: 'review_scorecard', scorecard: `.ai/state/reviews/${taskId}.md`, verdict: 'approve' },
    validation: { status: 'pass', evidence_count: 1, results: { pass: 1, fail: 0, skipped: 0 } },
    run_ids: [], context_artifact: null, task_journal: `.ai/state/tasks/${taskId}.md`, tier,
    metrics: {
      context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: 100, output_tokens: 20, cached_tokens: 0, latency_ms: 100, retries: 0 },
    },
  };
  fs.writeFileSync(path.join(evalDir, `${taskId}.json`), JSON.stringify(record, null, 2) + '\n');
}

test('--report prints a human-readable report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-report-'));
  writeRecordFile(dir, 'TASK-20260724-a', 'standard');
  const out = runTs(cli, ['--report'], { cwd: dir });
  assert.match(out, /evaluation report/i);
  assert.match(out, /standard: 1 evaluation/);
});

test('--report --json emits parseable aggregate JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-report-'));
  writeRecordFile(dir, 'TASK-20260724-a', 'standard');
  const out = runTs(cli, ['--report', '--json'], { cwd: dir });
  const agg = JSON.parse(out);
  assert.equal(agg.total, 1);
  assert.equal(agg.byTier.standard.count, 1);
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --import tsx --test test/evaluation-report.test.ts`
Expected: PASS (unit + both CLI cases).

- [ ] **Step 7: Commit**

```bash
git add bin/lib/evaluation-report.ts bin/lib/context.ts bin/forgeai-init.ts bin/lib/init.ts test/evaluation-report.test.ts
git commit -m "feat(eval): add --report aggregate command"
```

---

### Task 9: Soft-deprecate `--check-evaluation`

**Files:**
- Modify: `bin/lib/evaluation.ts` (`runCheckEvaluation`)
- Test: `test/evaluation.test.ts` (add a case; create if absent)

**Interfaces:**
- Consumes: nothing new.
- Produces: `runCheckEvaluation` prints a one-line deprecation notice; all existing behavior/exit codes unchanged.

- [ ] **Step 1: Write the failing test**

Add to `test/evaluation.test.ts`, using the shared `test/helpers.ts` (`cli` +
`runTs` with its absolute tsx loader, so it resolves from a temp cwd). Import
`cli, runTs` from `./helpers.js`. `--check-evaluation` exits 0 with no runs, so
`runTs` returns its stdout directly:

```ts
test('--check-evaluation prints a soft-deprecation notice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-checkeval-'));
  const out = runTs(cli, ['--check-evaluation'], { cwd: dir });
  assert.match(out, /deprecated/i);
  assert.match(out, /--evaluate/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/evaluation.test.ts`
Expected: FAIL — no deprecation text in output.

- [ ] **Step 3: Add the notice**

In `bin/lib/evaluation.ts` `runCheckEvaluation`, the function already opens with `console.log('ForgeAI evaluation check')` then `console.log('')`. Insert **one** notice line immediately after that existing blank line — do **not** re-print the title:

```ts
  console.log('ForgeAI evaluation check');
  console.log('');
  // >>> insert only the two lines below; the two lines above already exist <<<
  console.log(formatStatus('warn', '[deprecated] --check-evaluation validates the manual .ai/evaluation/*.md files; structured evaluation is now --evaluate / --report (see CHANGELOG 3.9.0).'));
  console.log('');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/evaluation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bin/lib/evaluation.ts test/evaluation.test.ts
git commit -m "feat(eval): soft-deprecate --check-evaluation"
```

---

### Task 10: Gitignore + upgrade preservation for evaluation records

**Files:**
- Modify: `bin/lib/init.ts` (`CONTEXT_GITIGNORE_ENTRIES`, `isPreservedOnUpgrade`)
- Test: `test/init.test.ts` or the existing upgrade/gitignore test file (add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `.ai/state/evaluations/` in generated gitignore; `.ai/state/evaluations/*.json` preserved on upgrade.

- [ ] **Step 1: Write the failing tests**

Find the test that asserts `isPreservedOnUpgrade` and the gitignore entries (search `grep -rn "isPreservedOnUpgrade\|CONTEXT_GITIGNORE_ENTRIES\|state/runs/" test`). Add:

```ts
test('evaluation records are preserved on upgrade', () => {
  assert.equal(isPreservedOnUpgrade(path.join(root, '.ai/state/evaluations/TASK-20260724-x.json')), true);
});

test('gitignore includes the evaluations directory', () => {
  assert.ok(CONTEXT_GITIGNORE_ENTRIES.includes('.ai/state/evaluations/'));
});
```

(Import `CONTEXT_GITIGNORE_ENTRIES` if the test asserts it directly; if the constant is not exported, assert against the generated `.gitignore` content instead, matching how the file already tests `.ai/state/runs/`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test test/init.test.ts`
Expected: FAIL — evaluations dir not preserved / not in gitignore.

- [ ] **Step 3: Add the gitignore entry**

In `bin/lib/init.ts`, extend `CONTEXT_GITIGNORE_ENTRIES` (~line 264):

```ts
const CONTEXT_GITIGNORE_ENTRIES = ['.ai/state/context/', '.ai/state/context-routes.md', '.ai/state/runs/', '.ai/state/evaluations/'];
```

- [ ] **Step 4: Add the preserve rule**

In `isPreservedOnUpgrade`, after the `reviews` branch, add:

```ts
  if (/^\.ai\/state\/evaluations\/.+\.json$/.test(relative)) {
    return true;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test test/init.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add bin/lib/init.ts test/init.test.ts
git commit -m "feat(eval): gitignore and preserve evaluation records on upgrade"
```

---

### Task 11: Version bump and documentation

**Files:**
- Modify: `package.json`, `package-lock.json`, `CHANGELOG.md`, `ROADMAP.md`, `README.md`
- Create: `docs/migrations/3.9.0.md`

**Interfaces:** none (docs/metadata only).

- [ ] **Step 1: Bump the version**

Set `"version": "3.9.0"` in `package.json`. In `package-lock.json`, set both the top-level `"version"` and the root package entry under `"packages"` `""` `"version"` to `3.9.0`.

- [ ] **Step 2: Run the full suite to confirm the version fixtures pass**

Run: `npm test`
Expected: typecheck + build + all tests PASS (dynamic version fixtures pick up 3.9.0).

- [ ] **Step 3: Add the CHANGELOG entry**

Prepend a `## 3.9.0 — 2026-07-24` section to `CHANGELOG.md` describing: structured evaluation records; `--evaluate --task <id>`; `--report [--json]`; `task_id` on compiled-context artifacts and run records; `--compile-context --task <id>`; soft-deprecation of `--check-evaluation`. Include a `### Migration` note pointing at `docs/migrations/3.9.0.md`.

- [ ] **Step 4: Update ROADMAP**

In `ROADMAP.md` Phase 13 section, mark Phase 13A shipped in 3.9.0 (structured records, `--evaluate`, `--report`, `task_id` linkage) and note 13B (baseline/compact modes, sample-sufficiency gate, advisory routing) still open.

- [ ] **Step 5: Add the migration doc**

Create `docs/migrations/3.9.0.md`: additive change, run `forgeai-init --upgrade`; no breaking schema/config changes; note that pre-3.9.0 artifacts/run records lack `task_id` and are not retro-evaluated.

- [ ] **Step 6: Update README**

Add an "Evaluation" section documenting the workflow `--compile-context --task <id>` → `--route` → `--evaluate --task <id>` → `--report`, the `EvaluationRecord` shape, the outcome mapping (`approve→pass`, `request changes→fail`, `needs human decision→partial`), and that `--check-evaluation` is deprecated.

- [ ] **Step 7: Final full-suite run**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json CHANGELOG.md ROADMAP.md README.md docs/migrations/3.9.0.md
git commit -m "docs(eval): release Phase 13A in 3.9.0"
```

---

## Self-Review

**Spec coverage:**
- 13A.1 schema+linking → Tasks 1, 2, 3 (incl. `artifact_role`, legacy normalization, `--task` eager validation).
- 13A.2 validation+recording → Tasks 4, 5, 6, 7.
- 13A.3 aggregate report → Task 8.
- Legacy soft-deprecation → Task 9.
- Storage/gitignore/upgrade → Tasks 4 + 10.
- Version/docs → Task 11.
- Consistency gate (all rejection paths), outcome mapping, provenance (`outcome_source` + `task_journal`), atomic+idempotent write → Tasks 4/6/7.

**Review findings addressed (2026-07-24):**
- Primary/expansion collision → `artifact_role` discriminator; `findArtifactsForTask` selects the single primary and counts expansions (Tasks 2, 7).
- Artifact backward-compat → `validateArtifact` recomputes the estimate on the raw shape, normalizes only on return (Task 2).
- Shallow eval validator + path traversal → full `isValidEvaluationRecord` + `isValidTaskId` guards in read/write (Task 4).
- Tier "unknown on disagreement" + report totals/means/label → `resolveTierForRuns` (Task 6), report changes (Task 8).
- `context_escapes` honesty → `number | null`, emitted `null` (Task 5); `expansion_rounds` counted from expansion artifacts (Tasks 5, 7).
- Gate hardening → `/\bTODO\b/i`, dimension rows required, empty ratings rejected (Task 6).
- Bare `--task` → eager value validation (Task 2); tested in Task 7.
- Task 9 double-title corrected.

**Review round 2 addressed (2026-07-25):**
- `--report` always-JSON bug → `args.has('--json')` (bare flag); added CLI tests for human + JSON modes (Task 8).
- Weak artifact lookup → export `checkArtifactStructure` from `router.ts`; `findArtifactsForTask` uses it (full structural validation, no freshness); duplicate-primary test now uses two copies of a real compiled artifact (Tasks 2, 7).
- CLI tests couldn't resolve tsx from a temp cwd → use `cli`/`runTs` from `test/helpers.ts` with a try/catch wrapper (Tasks 7, 9-style report tests).
- Task 2 expansion objective regression → keep `[expansion] ${primary.objective}`, only append `task_id`/`artifact_role`.
- Approve + a `fail` scorecard dimension → now a gate contradiction (Task 6).
- Stricter record validator → canonical ISO `generated_at`, `evaluation_id === eval-${task_id}`, non-negative integers, `evidence_count === pass+fail+skipped`, filename-matches-`task_id` on list (Task 4).
- `expansion_requests` → renamed `expansion_rounds` (counts rounds, not request items).

**Review round 3 addressed (2026-07-25):**
- `latency_ms` write/read mismatch → validator treats `latency_ms` as a non-negative real (RunRecord permits decimals); only the other call metrics are integers (Task 4). Added a decimal-latency round-trip test.
- Duplicate-primary CLI test wrote to a non-existent `.ai/state/context/` (compile prints to stdout) → `fs.mkdirSync(ctxDir, { recursive: true })` added (Task 7).
- Task 4 now includes the four validator regression tests the strategy promised: non-canonical `generated_at`, `evaluation_id` mismatch, `evidence_count` ≠ sum, filename ≠ `task_id`.

**Type consistency:** `task_id: string | null` + `artifact_role` identical on the artifact (Task 2); `task_id: string | null` on the run record (Task 3); `EvaluationRecord` shape defined once (Task 4, incl. `task_journal` and `context_escapes: number | null`) and reused verbatim in Tasks 5–8; `resolveTierForRuns`/`computeMetrics(…, expansionCount)`/`buildEvaluationRecord` signatures match their call sites in `runEvaluate` (Task 7); `aggregateEvaluations` return shape matches `runReport` (Task 8).

**Out of scope (13B):** baseline/compact modes, sample-sufficiency gate, advisory routing recommendations, `--outcome` override, real `context_escapes` measurement, `parent_artifact` linkage, removing the legacy manual system.
