# Phase 13B — Context Experiments and Advisory Mode Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn ForgeAI evaluation from descriptive into actionable — add baseline/compact context experiments, a sample-sufficiency gate, and an advisory "prefer compact" recommendation in `--report`.

**Architecture:** An experiment is two ordinary evaluated tasks that share an explicit `experiment_id`, one per `mode` (`baseline` = whole selected files, `compact` = 13A excerpts). Two optional fields (`mode`, `experiment_id`) ride the compiled-context artifact through route → run record → evaluation record; the report pairs records by `experiment_id` and, once enough pairs exist, emits a gated advisory. No 13A storage, key, or gate change.

**Tech Stack:** TypeScript (NodeNext, strict), Node built-in test runner via `tsx`, no runtime dependencies. Hand-rolled JSON schema validators (no schema library), matching the existing codebase.

## Global Constraints

- Target version: **3.9.0** (from the last published `3.8.0`). Phase 13B is
  included in the single consolidated Phase 13 release; update `package.json`,
  both version locations in `package-lock.json`, `CHANGELOG.md`, `ROADMAP.md`,
  `README.md`, and the existing consolidated `docs/migrations/3.9.0.md`.
- `schema_version` stays **`1`** on every artifact/record. All new fields are additive and optional-on-read.
- Backward compatibility: pre-3.9.0 artifacts, run records, and evaluation records normalize to `mode: 'compact'`, `experiment_id: null`, and are excluded from experiment pairing but still counted in the existing overall/per-tier `--report` summary.
- The test command is `npm test` = `tsc -p tsconfig.json && tsc -p tsconfig.build.json && node --import tsx --test test/*.test.ts`. **`tsconfig.json` includes `test/**/*.ts`, so every task must keep the whole project — source and tests — type-clean.** When a task adds a required field to a shared type, that same task updates every literal (source and test) the compiler flags. Run a single test file with `node --import tsx --test test/<file>.test.ts`.
- Threshold constants (Task 7), documented named constants: `MIN_EXPERIMENT_PAIRS = 5`, `MAX_PASS_RATE_DROP_PCT = 5`, `MIN_TOKEN_SAVING_PCT = 15`, `MIN_LATENCY_SAVING_PCT = 15`.
- The user commits every change themselves — **do not run `git commit`**. Each task's final step stages the change and states the message for the user to commit.
- No CI work for this repository.
- Never place provider credentials in files.

## File Structure

- `bin/lib/utils.ts` — add `isValidExperimentId` next to `isValidTaskId` (Task 1).
- `bin/lib/types.ts` — add fields to `CompiledContextArtifact`, `CompiledContextExcerpt.kind`, `RunRecord`, `EvaluationRecord`; add `EvaluationComparability` (Tasks 2–4).
- `bin/lib/router.ts` — extend `checkArtifactStructure` + `validateArtifact` normalization (Task 2).
- `bin/lib/run-record.ts` — extend `isValidRunRecordInput` + `listRunRecords` normalization (Task 3).
- `bin/lib/api-adapter.ts` — set `mode` on the constructed `RunRecord` (Task 3).
- `bin/lib/evaluation-record.ts` — extend `isValidEvaluationRecord`, read normalization, and `buildEvaluationRecord` (Tasks 4, 6).
- `bin/lib/context-compiler.ts` — baseline whole-file excerpts + `mode`/`experimentId` options + flag wiring (Tasks 2, 5).
- `bin/lib/context.ts` — eager value-flag validation for `--mode`, `--experiment`, `--min-samples` (Tasks 5, 8).
- `bin/lib/evaluation-report.ts` — experiment pairing, aggregation, recommendation, report output, `--json`, `--min-samples` (Tasks 7, 8).
- `bin/lib/init.ts` — `usage()` help text (Task 8).
- Tests: one focused `test/*.test.ts` per behavior, following the existing `test/evaluation-report.test.ts` / `test/evaluate-command.test.ts` patterns.

---

### Task 1: `isValidExperimentId` validator

**Files:**
- Modify: `bin/lib/utils.ts` (after `isValidTaskId`, ~line 162)
- Test: `test/experiment-id.test.ts` (create)

**Interfaces:**
- Produces: `export function isValidExperimentId(id: string): boolean` — true iff `id` matches `EXP-<8 digits>-<lowercase-alnum-slug>`.

- [ ] **Step 1: Write the failing test**

Create `test/experiment-id.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidExperimentId } from '../bin/lib/utils.js';

test('isValidExperimentId accepts a well-formed id', () => {
  assert.equal(isValidExperimentId('EXP-20260727-router-refactor'), true);
  assert.equal(isValidExperimentId('EXP-20260727-a'), true);
});

test('isValidExperimentId rejects placeholders, empties, and malformed ids', () => {
  assert.equal(isValidExperimentId('EXP-YYYYMMDD-short-slug'), false);
  assert.equal(isValidExperimentId('EXP-...'), false);
  assert.equal(isValidExperimentId(''), false);
  assert.equal(isValidExperimentId('TASK-20260727-x'), false);
  assert.equal(isValidExperimentId('EXP-2026-x'), false);
  assert.equal(isValidExperimentId('EXP-20260727-Upper'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/experiment-id.test.ts`
Expected: FAIL — `isValidExperimentId` is not exported.

- [ ] **Step 3: Add the validator**

In `bin/lib/utils.ts`, immediately after the `isValidTaskId` function (~line 162), add:

```typescript
// A valid ForgeAI experiment id: EXP-<8 digits>-<lowercase alphanumeric slug>.
// Rejects empty strings and the EXP-YYYYMMDD-short-slug template placeholder.
const EXPERIMENT_ID_PATTERN = /^EXP-\d{8}-[a-z0-9][a-z0-9-]*$/;

export function isValidExperimentId(id: string): boolean {
  return typeof id === 'string' && EXPERIMENT_ID_PATTERN.test(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/experiment-id.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add bin/lib/utils.ts test/experiment-id.test.ts
# Commit message for the user:
# feat(eval): add isValidExperimentId validator (Phase 13B)
```

---

### Task 2: Artifact schema — `mode`, `experiment_id`, and the `file` excerpt kind

**Files:**
- Modify: `bin/lib/types.ts` (`CompiledContextExcerpt.kind` ~line 128; `CompiledContextArtifact` after `artifact_role` ~line 171)
- Modify: `bin/lib/router.ts` (`checkArtifactStructure` ~line 37, `validExcerptKinds` ~line 64, `validateArtifact` return ~line 142)
- Modify: `bin/lib/context-compiler.ts` (`compileContext` artifact literal ~line 224; `compileContextExpansion` artifact literal ~line 392)
- Test: `test/artifact-mode-schema.test.ts` (create)

**Interfaces:**
- Consumes: `isValidTaskId` (existing), `checkArtifactStructure(raw): string | null`.
- Produces: `CompiledContextArtifact` now has `mode: 'baseline' | 'compact'` and `experiment_id: string | null`; `CompiledContextExcerpt.kind` includes `'file'`. `checkArtifactStructure` accepts/normalizes these. `validateArtifact` returns an artifact normalized to `mode`/`experiment_id`.

- [ ] **Step 1: Write the failing test**

Create `test/artifact-mode-schema.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkArtifactStructure } from '../bin/lib/router.js';

// A minimal structurally-valid compiled-context artifact (no fingerprint check).
function baseArtifact(): Record<string, unknown> {
  return {
    schema_version: 1,
    kind: 'forgeai_compiled_context',
    objective: 'demo',
    task_id: null,
    artifact_role: 'primary',
    repository: { revision: null, fingerprint: 'abc' },
    budget: { limit_tokens: 4000, estimated_tokens: 10, estimator: 'characters_divided_by_4', exhausted: false },
    selection: { max_depth: 1, max_nodes: 5, files: [{ path: 'a.ts', depth: 0, reason: 'seed', graph_path: 'a.ts' }] },
    rules: [],
    diagnostics: {},
    contracts: [],
    entrypoints: [],
    excerpts: [],
    omitted_candidates: 0,
  };
}

test('checkArtifactStructure accepts absent mode/experiment_id (legacy)', () => {
  assert.equal(checkArtifactStructure(baseArtifact()), null);
});

test('checkArtifactStructure accepts valid mode and experiment_id', () => {
  assert.equal(checkArtifactStructure({ ...baseArtifact(), mode: 'baseline', experiment_id: 'EXP-20260727-x' }), null);
  assert.equal(checkArtifactStructure({ ...baseArtifact(), mode: 'compact', experiment_id: null }), null);
});

test('checkArtifactStructure rejects unknown mode and malformed experiment_id', () => {
  assert.match(String(checkArtifactStructure({ ...baseArtifact(), mode: 'full' })), /mode must be/);
  assert.match(String(checkArtifactStructure({ ...baseArtifact(), experiment_id: '' })), /experiment_id must be/);
  assert.match(String(checkArtifactStructure({ ...baseArtifact(), experiment_id: 'EXP-1' })), /experiment_id must be/);
});

test('checkArtifactStructure accepts a whole-file excerpt of kind "file"', () => {
  const a = baseArtifact();
  a.excerpts = [{
    path: 'a.ts', kind: 'file', name: 'a.ts', reason: 'baseline: whole selected file',
    source_start_line: 1, source_end_line: 12, mode: 'full', content: 'export const x = 1;\n',
  }];
  assert.equal(checkArtifactStructure(a), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/artifact-mode-schema.test.ts`
Expected: FAIL — kind `'file'` rejected and mode/experiment_id checks absent.

- [ ] **Step 3: Extend the excerpt kind union in `types.ts`**

In `bin/lib/types.ts`, `CompiledContextExcerpt.kind` (~line 128), add `'file'`:

```typescript
  kind: 'import' | 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'test' | 'file';
```

- [ ] **Step 4: Add the artifact fields in `types.ts`**

In `bin/lib/types.ts`, `CompiledContextArtifact`, immediately after the `artifact_role` line (~line 171), add:

```typescript
  mode: 'baseline' | 'compact';
  experiment_id: string | null;
```

- [ ] **Step 5: Extend `checkArtifactStructure` and `validExcerptKinds` in `router.ts`**

First extend the `./utils.js` import at the top of `bin/lib/router.ts` to include `isValidExperimentId` alongside the existing `isValidTaskId`:

```typescript
import { formatStatus, getErrorMessage, isValidTaskId, isValidExperimentId } from './utils.js';
```

Then, right after the `artifact_role` check (~line 39), add:

```typescript
  if (a.mode !== undefined && a.mode !== 'baseline' && a.mode !== 'compact') {
    return "mode must be 'baseline' or 'compact'";
  }
  if (a.experiment_id !== null && a.experiment_id !== undefined && (typeof a.experiment_id !== 'string' || !isValidExperimentId(a.experiment_id))) {
    return 'experiment_id must be null or a valid EXP-YYYYMMDD-slug string';
  }
```

Update `validExcerptKinds` (~line 64) to include `'file'`:

```typescript
  const validExcerptKinds = new Set(['import', 'function', 'class', 'interface', 'type', 'enum', 'variable', 'test', 'file']);
```

- [ ] **Step 6: Normalize the new fields in `validateArtifact`**

In `bin/lib/router.ts`, the `validateArtifact` success return (~line 142), extend the normalization so the estimate above is still computed against the raw shape:

```typescript
  return {
    status: 'ok',
    artifact: {
      ...artifact,
      task_id: artifact.task_id ?? null,
      artifact_role: artifact.artifact_role ?? 'primary',
      mode: artifact.mode ?? 'compact',
      experiment_id: artifact.experiment_id ?? null,
    }
  };
```

- [ ] **Step 7: Update the two compiler artifact literals to compile**

In `bin/lib/context-compiler.ts`, `compileContext` artifact literal, after `artifact_role: 'primary',` (~line 225), add the default fields (real option wiring comes in Task 5):

```typescript
    mode: 'compact',
    experiment_id: null,
```

In `compileContextExpansion` artifact literal, after `artifact_role: 'expansion',` (~line 393), copy them from the primary:

```typescript
    mode: primary.mode,
    experiment_id: primary.experiment_id,
```

- [ ] **Step 8: Fix every remaining artifact literal the compiler flags**

Run: `npm run typecheck`
For each error `Property 'mode' is missing` / `Property 'experiment_id' is missing` on a `CompiledContextArtifact` literal (expected in a handful of `test/*.ts` files — e.g. `test/router.test.ts`, `test/context-compiler.test.ts`), add these two lines to that literal:

```typescript
  mode: 'compact',
  experiment_id: null,
```

Re-run `npm run typecheck` until clean.

- [ ] **Step 9: Assert `validateArtifact` normalizes a legacy artifact**

`test/router.test.ts` already has a 13A test that a pre-3.9.0 artifact (no `task_id`/`artifact_role`) validates and normalizes. Extend that test (or add one beside it) so it also asserts the new fields normalize — the artifact JSON written to disk has **no** `mode`/`experiment_id`, and the returned artifact has `mode: 'compact'`, `experiment_id: null`:

```typescript
  assert.equal(result.status, 'ok');
  assert.equal(result.artifact.mode, 'compact');
  assert.equal(result.artifact.experiment_id, null);
```

> This confirms the estimate is still computed against the raw shape (Step 6): a legacy artifact whose stored `estimated_tokens` predates these fields must still validate. Reuse the existing test's on-disk fixture; do not add `mode`/`experiment_id` to it.

- [ ] **Step 10: Run the tests**

Run: `node --import tsx --test test/artifact-mode-schema.test.ts`
Expected: PASS (4 tests).
Run: `node --import tsx --test test/router.test.ts`
Expected: PASS (existing + the normalization assertions).
Run: `npm test`
Expected: typecheck + build clean, all tests pass.

- [ ] **Step 11: Commit**

```bash
git add bin/lib/types.ts bin/lib/router.ts bin/lib/context-compiler.ts test/
# feat(eval): add mode/experiment_id and file excerpt kind to context artifact (Phase 13B)
```

---

### Task 3: `RunRecord.mode`

**Files:**
- Modify: `bin/lib/types.ts` (`RunRecord`, after `task_id` ~line 273)
- Modify: `bin/lib/run-record.ts` (`isValidRunRecordInput` ~line 57, `listRunRecords` normalize ~line 82)
- Modify: `bin/lib/api-adapter.ts` (`RunRecord` literal ~line 202)
- Test: `test/run-record-mode.test.ts` (create)

**Interfaces:**
- Consumes: `CompiledContextArtifact.mode` (Task 2).
- Produces: `RunRecord` now has `mode: 'baseline' | 'compact' | null`; `listRunRecords` normalizes a missing `mode` to `'compact'`.

- [ ] **Step 1: Write the failing test**

Create `test/run-record-mode.test.ts`:

```typescript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listRunRecords } from '../bin/lib/run-record.js';

function writeRun(dir: string, name: string, extra: Record<string, unknown>): void {
  const runsDir = path.join(dir, '.ai/state/runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const base = {
    schema_version: 1, kind: 'forgeai_run_record', run_id: name, timestamp: '2026-07-27T00:00:00.000Z',
    adapter: 'claude', provider: 'anthropic', model: 'claude-opus-4-8', artifact: '.ai/state/context/t.json',
    objective: 'demo', task_id: 'TASK-20260727-x', budget_tokens: 4000, estimated_tokens: 100,
    input_tokens: 10, output_tokens: 5, cached_tokens: 0, latency_ms: 100, http_status: 200,
    outcome: 'ok', retry_count: 0, error: null,
  };
  fs.writeFileSync(path.join(runsDir, `${name}.json`), JSON.stringify({ ...base, ...extra }, null, 2) + '\n');
}

test('listRunRecords normalizes a missing mode to compact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runmode-'));
  writeRun(dir, 'run-legacy', {});
  const records = listRunRecords(dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].mode, 'compact');
});

test('listRunRecords preserves and validates an explicit mode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runmode-'));
  writeRun(dir, 'run-b', { mode: 'baseline' });
  writeRun(dir, 'run-bad', { mode: 'nope' });
  const modes = listRunRecords(dir).map((r) => r.mode).sort();
  // run-bad is rejected as malformed; only run-b remains.
  assert.deepEqual(modes, ['baseline']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/run-record-mode.test.ts`
Expected: FAIL — `records[0].mode` is `undefined`.

- [ ] **Step 3: Add the `RunRecord` field**

In `bin/lib/types.ts`, `RunRecord`, immediately after `task_id: string | null;` (~line 273), add:

```typescript
  mode: 'baseline' | 'compact' | null;
```

- [ ] **Step 4: Validate and normalize `mode` in `run-record.ts`**

In `bin/lib/run-record.ts`, `isValidRunRecordInput`, after the `task_id` check (~line 57, just before `return true;`), add:

```typescript
  const md = r['mode'];
  if (md !== undefined && md !== null && md !== 'baseline' && md !== 'compact') return false;
```

In `listRunRecords`, the normalization object (~line 82), add the `mode` line:

```typescript
        records.push({
          ...(r as unknown as RunRecord),
          retry_count: (r['retry_count'] as number | undefined) ?? 0,
          task_id: (r['task_id'] as string | null | undefined) ?? null,
          mode: (r['mode'] as RunRecord['mode'] | undefined) ?? 'compact',
        });
```

- [ ] **Step 5: Set `mode` when constructing the run record**

In `bin/lib/api-adapter.ts`, the `RunRecord` literal (~line 202), add `mode` next to `task_id`:

```typescript
    artifact: artifactPath, objective: artifact.objective, task_id: artifact.task_id ?? null, mode: artifact.mode ?? 'compact',
```

- [ ] **Step 6: Fix every remaining `RunRecord` literal the compiler flags**

Run: `npm run typecheck`
For each `Property 'mode' is missing` on a `RunRecord` literal (expected in `test/run-record.test.ts` and `test/evaluate-command.test.ts`), add `mode: 'compact',` (or `mode: null,` where a legacy record is being simulated) to that literal. Re-run until clean.

- [ ] **Step 7: Run the tests**

Run: `node --import tsx --test test/run-record-mode.test.ts`
Expected: PASS (2 tests).
Run: `npm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add bin/lib/types.ts bin/lib/run-record.ts bin/lib/api-adapter.ts test/
# feat(eval): add mode to run records (Phase 13B)
```

---

### Task 4: `EvaluationRecord` schema — `mode` + `experiment_id`

**Files:**
- Modify: `bin/lib/types.ts` (add `EvaluationComparability`; `EvaluationRecord`, after `task_id` ~line 292)
- Modify: `bin/lib/evaluation-record.ts` (add `isValidExperimentId` import; `isValidEvaluationRecord` ~line 99, `readEvaluationRecord` ~line 108, `listEvaluationRecords` ~line 131, `buildEvaluationRecord` literal ~line 296)
- Test: `test/evaluation-record-mode.test.ts` (create)

**Interfaces:**
- Produces: `EvaluationRecord` now has `mode: 'baseline' | 'compact'`, `experiment_id: string | null` (validated with `isValidExperimentId` when non-null), and `comparability: EvaluationComparability | null`; read paths normalize missing values to `'compact'` / `null` / `null`; `isValidEvaluationRecord` accepts absent-or-valid values (legacy 13A records stay valid).
- Produces type: `EvaluationComparability = { objective: string; repository_fingerprint: string; selection_signature: string; acceptance_signature: string; routing_signature: string }`.

- [ ] **Step 1: Write the failing test**

Create `test/evaluation-record-mode.test.ts`:

```typescript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listEvaluationRecords } from '../bin/lib/evaluation-record.js';

function writeRecord(dir: string, taskId: string, extra: Record<string, unknown>): void {
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  const base = {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: `eval-${taskId}`, task_id: taskId,
    generated_at: '2026-07-27T00:00:00.000Z', outcome: 'pass',
    outcome_source: { type: 'review_scorecard', scorecard: `.ai/state/reviews/${taskId}.md`, verdict: 'approve' },
    validation: { status: 'pass', evidence_count: 1, results: { pass: 1, fail: 0, skipped: 0 } },
    run_ids: [], context_artifact: null, task_journal: `.ai/state/tasks/${taskId}.md`, tier: 'standard',
    metrics: {
      context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: 100, output_tokens: 20, cached_tokens: 0, latency_ms: 100, retries: 0 },
    },
  };
  fs.writeFileSync(path.join(evalDir, `${taskId}.json`), JSON.stringify({ ...base, ...extra }, null, 2) + '\n');
}

test('listEvaluationRecords normalizes a legacy record (no mode) to compact/null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-evalmode-'));
  writeRecord(dir, 'TASK-20260727-legacy', {});
  const [rec] = listEvaluationRecords(dir);
  assert.equal(rec.mode, 'compact');
  assert.equal(rec.experiment_id, null);
  assert.equal(rec.comparability, null);
});

test('listEvaluationRecords preserves explicit fields and rejects malformed ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-evalmode-'));
  const comparability = { objective: 'demo', repository_fingerprint: 'fp', selection_signature: '1:5:a.ts', acceptance_signature: 'npm test', routing_signature: 'anthropic/claude-opus-4-8' };
  writeRecord(dir, 'TASK-20260727-base', { mode: 'baseline', experiment_id: 'EXP-20260727-e', comparability });
  writeRecord(dir, 'TASK-20260727-bad', { mode: 'nope' });
  writeRecord(dir, 'TASK-20260727-badexp', { experiment_id: 'EXP-1' });
  const byTask = new Map(listEvaluationRecords(dir).map((r) => [r.task_id, r]));
  assert.equal(byTask.get('TASK-20260727-base')?.mode, 'baseline');
  assert.equal(byTask.get('TASK-20260727-base')?.experiment_id, 'EXP-20260727-e');
  assert.deepEqual(byTask.get('TASK-20260727-base')?.comparability, comparability);
  assert.equal(byTask.has('TASK-20260727-bad'), false);         // invalid mode
  assert.equal(byTask.has('TASK-20260727-badexp'), false);      // malformed experiment_id
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/evaluation-record-mode.test.ts`
Expected: FAIL — `rec.mode` is `undefined`.

- [ ] **Step 3: Add the comparability type and the `EvaluationRecord` fields**

In `bin/lib/types.ts`, immediately above `export type EvaluationRecord = {` (~line 288), add:

```typescript
export type EvaluationComparability = {
  objective: string;
  repository_fingerprint: string;
  selection_signature: string;
  acceptance_signature: string;
  routing_signature: string;
};
```

In `EvaluationRecord`, immediately after `task_id: string;` (~line 292), add:

```typescript
  mode: 'baseline' | 'compact';
  experiment_id: string | null;
  comparability: EvaluationComparability | null;
```

- [ ] **Step 4: Accept the fields in `isValidEvaluationRecord`**

First extend the `./utils.js` import at the top of `bin/lib/evaluation-record.ts` to include `isValidExperimentId`:

```typescript
import { formatStatus, isValidTaskId, isValidExperimentId } from './utils.js';
```

In `isValidEvaluationRecord`, just before the final `return true;` (~line 99), add:

```typescript
  const md = r['mode'];
  if (md !== undefined && md !== 'baseline' && md !== 'compact') return false;
  const exp = r['experiment_id'];
  if (exp !== undefined && exp !== null && (typeof exp !== 'string' || !isValidExperimentId(exp))) return false;
  const comp = r['comparability'];
  if (comp !== undefined && comp !== null) {
    if (typeof comp !== 'object') return false;
    const c = comp as Record<string, unknown>;
    if (typeof c['objective'] !== 'string' || typeof c['repository_fingerprint'] !== 'string'
      || typeof c['selection_signature'] !== 'string' || typeof c['acceptance_signature'] !== 'string'
      || typeof c['routing_signature'] !== 'string') return false;
  }
```

- [ ] **Step 5: Normalize on both read paths**

In `readEvaluationRecord` (~line 108), replace the return:

```typescript
    return isValidEvaluationRecord(raw)
      ? { ...raw, mode: raw.mode ?? 'compact', experiment_id: raw.experiment_id ?? null, comparability: raw.comparability ?? null }
      : null;
```

In `listEvaluationRecords`, the push (~line 131), replace with:

```typescript
      if (isValidEvaluationRecord(raw) && name === `${raw.task_id}.json`) {
        records.push({ ...raw, mode: raw.mode ?? 'compact', experiment_id: raw.experiment_id ?? null, comparability: raw.comparability ?? null });
      }
```

- [ ] **Step 6: Give `buildEvaluationRecord` a compiling default**

In `bin/lib/evaluation-record.ts`, the `record` literal in `buildEvaluationRecord` (~line 296, after `task_journal: input.journalPath,`), add (real artifact-derived values come in Task 6):

```typescript
    mode: 'compact',
    experiment_id: null,
    comparability: null,
```

- [ ] **Step 7: Fix every remaining `EvaluationRecord` literal the compiler flags**

Run: `npm run typecheck`
For each `Property 'mode' is missing` (or `'comparability' is missing`) on an `EvaluationRecord` literal (expected in `test/evaluation-report.test.ts` `rec()` + `writeRecordFile`, `test/evaluation-record.test.ts`, `test/evaluate-command.test.ts`), add:

```typescript
  mode: 'compact',
  experiment_id: null,
  comparability: null,
```

Re-run until clean.

- [ ] **Step 8: Run the tests**

Run: `node --import tsx --test test/evaluation-record-mode.test.ts`
Expected: PASS (2 tests).
Run: `npm test`
Expected: all green (existing 13A record tests still pass — legacy records remain valid).

- [ ] **Step 9: Commit**

```bash
git add bin/lib/types.ts bin/lib/evaluation-record.ts test/
# feat(eval): add mode/experiment_id to evaluation records (Phase 13B)
```

---

### Task 5: Baseline compile mode + `--mode` / `--experiment` flags

**Files:**
- Modify: `bin/lib/context-compiler.ts` (add `wholeFileExcerpt` helper; `compileContext` options + branch ~lines 196-269; `runCompileContext` ~line 479)
- Modify: `bin/lib/context.ts` (eager flag list ~line 43)
- Test: `test/baseline-compile.test.ts` (create)

**Interfaces:**
- Consumes: `readVerifiedSource(repositoryRoot, node)` (existing, private in module), `SelectedContextNode` (existing), `isValidExperimentId` (Task 1), `CompiledContextArtifact.mode/experiment_id` (Task 2).
- Produces: `compileContext(..., options)` accepts `mode?: 'baseline' | 'compact'` and `experimentId?: string | null`; `--compile-context --mode baseline --experiment <id>` writes a whole-file-excerpt artifact.

- [ ] **Step 1: Write the failing test**

Create `test/baseline-compile.test.ts`. It builds a tiny repo with a dependency graph and curated codegraph, then compiles in baseline mode. (Model it on the existing `test/context-compiler.test.ts` fixtures — copy that file's repo-setup helper if present; the assertions below are the new behavior.)

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { cli, runTs } from './helpers.js';
import { makeCompilerRepo } from './context-compiler.test.js'; // reuse existing fixture helper if exported; otherwise inline the same setup

test('--compile-context --mode baseline emits whole-file excerpts', () => {
  const dir = makeCompilerRepo(); // creates .ai/codegraph + dependency graph + a.ts
  const out = runTs(cli, ['--compile-context', '--objective', 'demo', '--mode', 'baseline', '--experiment', 'EXP-20260727-e', '--budget', '20000'], { cwd: dir });
  const artifact = JSON.parse(out);
  assert.equal(artifact.mode, 'baseline');
  assert.equal(artifact.experiment_id, 'EXP-20260727-e');
  assert.ok(artifact.excerpts.length > 0);
  assert.ok(artifact.excerpts.every((e: { kind: string; mode: string }) => e.kind === 'file' && e.mode === 'full'));
});

test('--compile-context --mode baseline errors when whole files exceed the budget', () => {
  const dir = makeCompilerRepo();
  let threw = false;
  try {
    runTs(cli, ['--compile-context', '--objective', 'demo', '--mode', 'baseline', '--budget', '300'], { cwd: dir });
  } catch (err) {
    threw = true;
    assert.match(String((err as { stderr?: Buffer }).stderr ?? ''), /baseline mode needs|raise --budget/);
  }
  assert.equal(threw, true);
});

test('--compile-context rejects an invalid --mode', () => {
  const dir = makeCompilerRepo();
  let threw = false;
  try {
    runTs(cli, ['--compile-context', '--objective', 'demo', '--mode', 'full'], { cwd: dir });
  } catch (err) {
    threw = true;
    assert.match(String((err as { stderr?: Buffer }).stderr ?? ''), /--mode must be/);
  }
  assert.equal(threw, true);
});

test('baseline excerpt content equals the whole source file and shares compact selection', () => {
  const dir = makeCompilerRepo();
  const baseline = JSON.parse(runTs(cli, ['--compile-context', '--objective', 'demo', '--mode', 'baseline', '--budget', '20000'], { cwd: dir }));
  const compact = JSON.parse(runTs(cli, ['--compile-context', '--objective', 'demo', '--mode', 'compact', '--budget', '20000'], { cwd: dir }));
  // Selection (seed files) is identical — mode only changes how files are rendered.
  assert.deepEqual(
    baseline.selection.files.map((f: { path: string }) => f.path).sort(),
    compact.selection.files.map((f: { path: string }) => f.path).sort(),
  );
  // A baseline 'file' excerpt's content is the verbatim source file.
  const fileExc = baseline.excerpts.find((e: { kind: string; path: string }) => e.kind === 'file');
  assert.ok(fileExc);
  const onDisk = fs.readFileSync(path.join(dir, fileExc.path), 'utf8');
  assert.equal(fileExc.content, onDisk);
});

test('a bare --mode or --experiment (no value) exits 1', () => {
  const dir = makeCompilerRepo();
  for (const flag of ['--mode', '--experiment']) {
    let threw = false;
    try {
      runTs(cli, ['--compile-context', '--objective', 'demo', flag], { cwd: dir });
    } catch (err) {
      threw = true;
      assert.match(String((err as { stderr?: Buffer }).stderr ?? ''), new RegExp(`\\${flag} requires a value`));
    }
    assert.equal(threw, true);
  }
});
```

This test needs `fs` and `path` imports at the top of the file:

```typescript
import fs from 'node:fs';
import path from 'node:path';
```

> If `context-compiler.test.ts` does not export a reusable repo helper, inline the same fixture-creation code it uses (dependency graph JSON, curated codegraph, and one small source file) directly in this test file. Do not invent a new fixture shape — copy the working one.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/baseline-compile.test.ts`
Expected: FAIL — `--mode` is unknown, baseline produces normal excerpts.

- [ ] **Step 3: Add the `wholeFileExcerpt` helper**

In `bin/lib/context-compiler.ts`, add near `excerptFromDeclaration` (~line 89):

```typescript
function wholeFileExcerpt(repositoryRoot: string, selected: SelectedContextNode): CompiledContextExcerpt {
  const content = readVerifiedSource(repositoryRoot, selected.node);
  const lineCount = content.length === 0 ? 1 : content.split('\n').length;
  return {
    path: selected.node.path,
    kind: 'file',
    name: selected.node.path,
    reason: `baseline: whole selected file (${selected.reason})`,
    source_start_line: 1,
    source_end_line: Math.max(1, lineCount),
    mode: 'full',
    content,
  };
}
```

- [ ] **Step 4: Thread `mode`/`experimentId` through `compileContext`**

In `bin/lib/context-compiler.ts`, `compileContext` signature options (~line 201), extend:

```typescript
  options: { budget?: number; maxNodes?: number; maxDepth?: number; taskId?: string | null; mode?: 'baseline' | 'compact'; experimentId?: string | null } = {}
```

At the top of the function body (after reading `maxDepth`, ~line 205) add:

```typescript
  const mode = options.mode ?? 'compact';
```

Only compute compact candidates when needed — replace the `const candidates = deduplicateCandidates(...)...` block (~line 211-218) with:

```typescript
  const candidates = mode === 'compact'
    ? deduplicateCandidates(
        selection.selected.flatMap((selected) => candidatesForFile(repositoryRoot, selected, selection.terms))
      ).sort((a, b) =>
        a.priority - b.priority
        || a.full.path.localeCompare(b.full.path)
        || a.full.source_start_line - b.full.source_start_line
        || a.full.name.localeCompare(b.full.name)
      )
    : [];
```

In the artifact literal, replace the Task 2 defaults (~line 224-225) with the option-driven values:

```typescript
    task_id: options.taskId ?? null,
    artifact_role: 'primary',
    mode,
    experiment_id: options.experimentId ?? null,
```

After the `baseEstimate > budget` guard (~line 258), insert the baseline branch before the compact packing loop:

```typescript
  if (mode === 'baseline') {
    for (const selected of selection.selected) {
      artifact.excerpts.push(wholeFileExcerpt(repositoryRoot, selected));
    }
    artifact.omitted_candidates = 0;
    artifact.budget.exhausted = false;
    artifact.budget.estimated_tokens = computeArtifactEstimate(artifact);
    if (artifact.budget.estimated_tokens > budget) {
      throw new ContextBudgetError(`baseline mode needs ${artifact.budget.estimated_tokens} tokens for whole selected files; raise --budget (currently ${budget})`);
    }
    return artifact;
  }
```

(The existing compact packing loop and its `finalEstimate` guard remain unchanged below this branch.)

- [ ] **Step 5: Wire the flags in `runCompileContext`**

In `bin/lib/context-compiler.ts`, add the import at the top — extend the existing `./utils.js` import to include `isValidExperimentId` alongside `isValidTaskId`.

In `runCompileContext`, after the `--task` validation block (~line 491), add:

```typescript
  const modeArg = getArgValue('--mode') ?? 'compact';
  if (modeArg !== 'baseline' && modeArg !== 'compact') {
    process.stderr.write("Error: --mode must be 'baseline' or 'compact'.\n");
    process.exitCode = 1;
    return;
  }
  const experimentArg = getArgValue('--experiment');
  if (experimentArg !== null && !isValidExperimentId(experimentArg)) {
    process.stderr.write('Error: --experiment must be a valid experiment id (EXP-YYYYMMDD-slug).\n');
    process.exitCode = 1;
    return;
  }
```

Pass them into `compileContext` (~line 508):

```typescript
    const artifact = compileContext(objective, curatedGraph, dependencyGraph!, root, { budget, maxDepth, maxNodes, taskId: taskIdArg, mode: modeArg, experimentId: experimentArg });
```

- [ ] **Step 6: Register the eager value flags**

In `bin/lib/context.ts`, extend the eager flag list (~line 43):

```typescript
for (const name of ['--profile', '--emit', '--adapter', '--model', '--task', '--mode', '--experiment'] as const) {
```

- [ ] **Step 7: Assert expansion carries `mode`/`experiment_id` from the primary**

`compileContextExpansion` already copies `primary.mode`/`primary.experiment_id` (set in Task 2 Step 7). Lock it with a test. Extend `test/context-expansion.test.ts`: in the existing passing expansion test, set the primary artifact's `mode: 'baseline'` and `experiment_id: 'EXP-20260727-e'` before calling `compileContextExpansion`, and assert the returned expansion artifact carries them and is labelled expansion:

```typescript
test('expansion artifact carries mode and experiment_id from the primary', () => {
  const { primary, requests, curatedGraph, depGraph, root } = makeExpansionFixture(); // existing helper in this file
  primary.mode = 'baseline';
  primary.experiment_id = 'EXP-20260727-e';
  const expansion = compileContextExpansion(primary, requests, curatedGraph, depGraph, root, {});
  assert.equal(expansion.artifact_role, 'expansion');
  assert.equal(expansion.mode, 'baseline');
  assert.equal(expansion.experiment_id, 'EXP-20260727-e');
});
```

> Reuse this file's existing expansion fixture/helper; if it does not expose the intermediate pieces, adapt the assertion to whatever the file's working expansion test already constructs — do not invent a new fixture.

- [ ] **Step 8: Run the tests**

Run: `node --import tsx --test test/baseline-compile.test.ts`
Expected: PASS (5 tests).
Run: `node --import tsx --test test/context-expansion.test.ts`
Expected: PASS (existing + carry-through test).
Run: `npm test`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add bin/lib/context-compiler.ts bin/lib/context.ts test/baseline-compile.test.ts test/context-expansion.test.ts
# feat(context): add baseline whole-file compile mode and --mode/--experiment flags (Phase 13B)
```

---

### Task 6: `--evaluate` carries `mode`/`experiment_id` from the primary artifact

**Files:**
- Modify: `bin/lib/evaluation-record.ts` (`buildEvaluationRecord` record literal ~line 296)
- Test: `test/evaluate-command.test.ts` (extend — add one test)

**Interfaces:**
- Consumes: `BuildInput.artifact: CompiledContextArtifact | null` (existing) now carrying `mode`/`experiment_id`; `BuildInput.runs: RunRecord[]` (existing, for `routing_signature`); the `evidenceRows` local already computed in `buildEvaluationRecord` (~line 261); `root` + `artifactPath` in `runEvaluate` (for the provenance gate).
- Produces: the written `EvaluationRecord` reflects the primary artifact's `mode`/`experiment_id` and a `comparability` block (with `routing_signature` from the runs; `null` when there is no artifact). `--evaluate` refuses to write an **experiment** record (`experiment_id` set) whose runs are missing or don't provenance-match the primary artifact/mode.

- [ ] **Step 1: Write the failing test**

Add to `test/evaluate-command.test.ts` a test that compiles a baseline artifact for a task, provides a passing journal + scorecard, runs `--evaluate`, and asserts the written record's `mode`/`experiment_id`. Follow the existing happy-path test in that file for the journal/scorecard/artifact fixture; the new assertions are:

```typescript
test('--evaluate stamps mode, experiment_id, and comparability from the primary artifact', () => {
  const dir = makeEvaluableRepo({ // existing helper in this file: writes journal + scorecard + primary artifact
    artifactOverrides: { mode: 'baseline', experiment_id: 'EXP-20260727-e' },
  });
  runTs(cli, ['--evaluate', '--task', 'TASK-20260727-x'], { cwd: dir });
  const record = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260727-x.json'), 'utf8'));
  assert.equal(record.mode, 'baseline');
  assert.equal(record.experiment_id, 'EXP-20260727-e');
  assert.equal(typeof record.comparability.objective, 'string');
  assert.equal(typeof record.comparability.repository_fingerprint, 'string');
  assert.match(record.comparability.selection_signature, /^\d+:\d+:/);
  // acceptance_signature must be built from the Command column (cells[1]), never the Date column.
  assert.ok(record.comparability.acceptance_signature.length > 0);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(record.comparability.acceptance_signature), 'acceptance_signature must hold commands, not dates');
  // routing_signature is the provider/model of the task's run(s).
  assert.match(record.comparability.routing_signature, /.+\/.+/);
});
```

> Use the same repo/artifact helper the existing happy-path evaluate tests use. If that helper does not accept overrides, add a minimal `artifactOverrides` merge to it (a small `{ ...artifact, ...overrides }` at write time) rather than duplicating the whole fixture.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/evaluate-command.test.ts`
Expected: FAIL — record `mode` is `'compact'` (the Task 4 default), not `'baseline'`.

- [ ] **Step 3: Derive the fields from the artifact and journal**

In `bin/lib/evaluation-record.ts`, `buildEvaluationRecord` record literal (~line 296), replace the Task 4 defaults. `evidenceRows` is already in scope (computed ~line 261):

```typescript
    mode: input.artifact?.mode ?? 'compact',
    experiment_id: input.artifact?.experiment_id ?? null,
    comparability: input.artifact
      ? {
          objective: input.artifact.objective,
          repository_fingerprint: input.artifact.repository.fingerprint,
          selection_signature: `${input.artifact.selection.max_depth}:${input.artifact.selection.max_nodes}:${input.artifact.selection.files.map((f) => f.path).sort().join(',')}`,
          // Commands And Validation columns are | Date | Command | Result |, so the
          // command is cells[1] (matching review.ts isRealEvidenceRow's [date, command, result]).
          // Date (cells[0]) and Result (cells[2]) are intentionally excluded.
          acceptance_signature: [...new Set(evidenceRows.map((cells) => (cells[1] ?? '').trim()))].sort().join('\n'),
          // provider/model set of the matched runs — proves both modes used the same model(s).
          routing_signature: [...new Set(input.runs.map((r) => `${r.provider}/${r.model}`))].sort().join(','),
        }
      : null,
```

- [ ] **Step 4: Add the experiment provenance gate**

Write a failing test first, in `test/evaluate-command.test.ts`:

```typescript
test('--evaluate rejects an experiment task whose run routed a different artifact', () => {
  const dir = makeEvaluableRepo({
    artifactOverrides: { mode: 'baseline', experiment_id: 'EXP-20260727-e' },
    // helper writes a run record for the task; point it at a foreign artifact path
    runOverrides: { artifact: '.ai/state/context/OTHER.json', mode: 'baseline' },
  });
  let threw = false;
  try {
    runTs(cli, ['--evaluate', '--task', 'TASK-20260727-x'], { cwd: dir });
  } catch (err) {
    threw = true;
    assert.match(String((err as { stderr?: Buffer; stdout?: Buffer }).stdout ?? ''), /did not route the primary artifact|No record written/);
  }
  assert.equal(threw, true);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260727-x.json')), false);
});

test('--evaluate rejects an experiment task with no runs', () => {
  const dir = makeEvaluableRepo({
    artifactOverrides: { mode: 'baseline', experiment_id: 'EXP-20260727-e' },
    runOverrides: null, // helper writes no run record
  });
  let threw = false;
  try {
    runTs(cli, ['--evaluate', '--task', 'TASK-20260727-x'], { cwd: dir });
  } catch (err) {
    threw = true;
    assert.match(String((err as { stdout?: Buffer }).stdout ?? ''), /no run records|No record written/);
  }
  assert.equal(threw, true);
});

test('--evaluate rejects an experiment run whose mode differs from the artifact', () => {
  const dir = makeEvaluableRepo({
    artifactOverrides: { mode: 'baseline', experiment_id: 'EXP-20260727-e' },
    runOverrides: { mode: 'compact' }, // routes the primary artifact but with the wrong mode
  });
  let threw = false;
  try {
    runTs(cli, ['--evaluate', '--task', 'TASK-20260727-x'], { cwd: dir });
  } catch (err) {
    threw = true;
    assert.match(String((err as { stdout?: Buffer }).stdout ?? ''), /does not match artifact mode|No record written/);
  }
  assert.equal(threw, true);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260727-x.json')), false);
});
```

> The existing `makeEvaluableRepo` helper writes a run record for the task. Extend it (small, local) so that by default the run **routes the primary artifact and carries the same `mode` as the artifact** — this is what lets an experiment evaluation (Step 1's `mode: baseline` case) pass the new provenance gate. Add a `runOverrides` option (`null` = write no run; object = merge into the run record) so the negative cases here can break provenance deliberately. An ordinary (non-experiment) evaluate test in this file must keep passing with zero runs — do not tighten the non-experiment path.

Run: `node --import tsx --test test/evaluate-command.test.ts`
Expected: FAIL — the record is still written.

In `bin/lib/evaluation-record.ts`, `runEvaluate`, after `const runs = listRunRecords(root).filter((r) => r.task_id === taskId);` and the `tiers`/`artifact`/`artifactPath` are known (~line 374), insert the gate. It applies **only** when the primary artifact carries an `experiment_id`:

```typescript
  if (artifact && artifact.experiment_id !== null) {
    const provErrors: string[] = [];
    if (runs.length === 0) {
      provErrors.push(`experiment task ${taskId} has no run records to compare`);
    }
    for (const r of runs) {
      if (r.mode !== artifact.mode) {
        provErrors.push(`run ${r.run_id} mode '${r.mode}' does not match artifact mode '${artifact.mode}'`);
      }
      if (artifactPath === null || path.resolve(root, r.artifact) !== path.resolve(root, artifactPath)) {
        provErrors.push(`run ${r.run_id} did not route the primary artifact`);
      }
    }
    if (provErrors.length > 0) {
      console.log('ForgeAI evaluation');
      console.log('');
      for (const err of provErrors) console.log(formatStatus('invalid', err));
      console.log('');
      console.log('Result: evaluation failed. No record written.');
      process.exitCode = 1;
      return;
    }
  }
```

Run: `node --import tsx --test test/evaluate-command.test.ts`
Expected: PASS (provenance tests + the mode/experiment/comparability test + existing).

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add bin/lib/evaluation-record.ts test/evaluate-command.test.ts
# feat(eval): populate comparability and enforce experiment run provenance (Phase 13B)
```

---

### Task 7: Experiment pairing, aggregation, and recommendation (pure functions)

**Files:**
- Modify: `bin/lib/evaluation-report.ts` (add constants, types, and three pure functions above `runReport`)
- Test: `test/experiment-aggregation.test.ts` (create)

**Interfaces:**
- Consumes: `EvaluationRecord` (with `mode`/`experiment_id`).
- Produces:
  - `pairExperiments(records: EvaluationRecord[]): { pairs: ExperimentPair[]; skipped: SkippedExperiment[] }`
  - `aggregateExperiments(pairs: ExperimentPair[]): ExperimentAggregate`
  - `recommend(agg: ExperimentAggregate, minSamples: number): Recommendation`
  - Exported types `ExperimentPair`, `SkippedExperiment`, `ExperimentAggregate`, `Recommendation` and constants `MIN_EXPERIMENT_PAIRS`, `MAX_PASS_RATE_DROP_PCT`, `MIN_TOKEN_SAVING_PCT`, `MIN_LATENCY_SAVING_PCT`.

- [ ] **Step 1: Write the failing test**

Create `test/experiment-aggregation.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvaluationRecord, EvaluationComparability } from '../bin/lib/types.js';
import {
  pairExperiments, aggregateExperiments, recommend, MIN_EXPERIMENT_PAIRS,
  type ExperimentAggregate,
} from '../bin/lib/evaluation-report.js';

const CMP: EvaluationComparability = { objective: 'demo', repository_fingerprint: 'fp', selection_signature: '1:5:a.ts', acceptance_signature: 'npm test', routing_signature: 'anthropic/claude-opus-4-8' };

function rec(opts: {
  task: string; mode: 'baseline' | 'compact'; exp: string | null; outcome: EvaluationRecord['outcome'];
  input: number; output: number; latency: number;
  tier?: string; expansion?: number; comparability?: EvaluationComparability | null;
}): EvaluationRecord {
  return {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: `eval-${opts.task}`, task_id: opts.task,
    generated_at: '2026-07-27T00:00:00.000Z', outcome: opts.outcome, mode: opts.mode, experiment_id: opts.exp,
    comparability: opts.comparability === undefined ? CMP : opts.comparability,
    outcome_source: { type: 'review_scorecard', scorecard: 's', verdict: opts.outcome === 'pass' ? 'approve' : opts.outcome === 'fail' ? 'request changes' : 'needs human decision' },
    validation: { status: 'pass', evidence_count: 1, results: { pass: 1, fail: 0, skipped: 0 } },
    run_ids: [], context_artifact: '.ai/state/context/x.json', task_journal: 't', tier: opts.tier ?? 'standard',
    metrics: {
      context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: opts.expansion ?? 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: opts.input, output_tokens: opts.output, cached_tokens: 0, latency_ms: opts.latency, retries: 0 },
    },
  };
}

function agg(over: Partial<ExperimentAggregate>): ExperimentAggregate {
  return { pairs: 5, baseline_pass_rate: 100, compact_pass_rate: 100, pass_rate_drop_pct: 0, mean_token_saving_pct: 0, mean_latency_saving_pct: 0, ...over };
}

test('pairExperiments matches one comparable baseline + one compact per experiment id', () => {
  const records = [
    rec({ task: 'TASK-20260727-ab', mode: 'baseline', exp: 'EXP-20260727-p1', outcome: 'pass', input: 1000, output: 100, latency: 500 }),
    rec({ task: 'TASK-20260727-ac', mode: 'compact', exp: 'EXP-20260727-p1', outcome: 'pass', input: 400, output: 100, latency: 300 }),
    rec({ task: 'TASK-20260727-solo', mode: 'compact', exp: null, outcome: 'pass', input: 10, output: 1, latency: 10 }),
  ];
  const { pairs, skipped } = pairExperiments(records);
  assert.equal(pairs.length, 1);
  assert.equal(skipped.length, 0);
  assert.equal(pairs[0].experiment_id, 'EXP-20260727-p1');
  assert.ok(Math.abs(pairs[0].token_saving_pct - 54.5) < 0.2); // (1100-500)/1100*100
  assert.equal(pairs[0].outcome_preserved, true);
});

test('pairExperiments reports incomplete experiments as skipped', () => {
  const records = [
    rec({ task: 'TASK-20260727-x', mode: 'baseline', exp: 'EXP-20260727-p2', outcome: 'pass', input: 100, output: 10, latency: 10 }),
    rec({ task: 'TASK-20260727-y', mode: 'baseline', exp: 'EXP-20260727-p3', outcome: 'pass', input: 100, output: 10, latency: 10 }),
    rec({ task: 'TASK-20260727-z', mode: 'compact', exp: 'EXP-20260727-p3', outcome: 'pass', input: 100, output: 10, latency: 10 }),
    rec({ task: 'TASK-20260727-w', mode: 'compact', exp: 'EXP-20260727-p3', outcome: 'pass', input: 100, output: 10, latency: 10 }),
  ];
  const { pairs, skipped } = pairExperiments(records);
  assert.equal(pairs.length, 0); // p2 missing compact; p3 has two compacts
  assert.deepEqual(skipped.map((s) => s.experiment_id).sort(), ['EXP-20260727-p2', 'EXP-20260727-p3']);
});

test('pairExperiments excludes a non-comparable pair (different model or objective)', () => {
  const records = [
    // Same everything except model (routing_signature) — two models both tier 'unknown' still differ.
    rec({ task: 'TASK-20260727-nt1', mode: 'baseline', exp: 'EXP-20260727-nt', outcome: 'pass', input: 1000, output: 0, latency: 100, tier: 'unknown', comparability: { ...CMP, routing_signature: 'openai/gpt-x' } }),
    rec({ task: 'TASK-20260727-nt2', mode: 'compact', exp: 'EXP-20260727-nt', outcome: 'pass', input: 400, output: 0, latency: 100, tier: 'unknown', comparability: { ...CMP, routing_signature: 'anthropic/claude-opus-4-8' } }),
    rec({ task: 'TASK-20260727-no1', mode: 'baseline', exp: 'EXP-20260727-no', outcome: 'pass', input: 1000, output: 0, latency: 100, comparability: { ...CMP, objective: 'A' } }),
    rec({ task: 'TASK-20260727-no2', mode: 'compact', exp: 'EXP-20260727-no', outcome: 'pass', input: 400, output: 0, latency: 100, comparability: { ...CMP, objective: 'B' } }),
  ];
  const { pairs, skipped } = pairExperiments(records);
  assert.equal(pairs.length, 0);
  assert.deepEqual(skipped.map((s) => s.experiment_id).sort(), ['EXP-20260727-no', 'EXP-20260727-nt']);
});

test('acceptance_signature ignores the Date column but distinguishes commands (gate behavior)', () => {
  // same commands, different date columns baked into acceptance_signature ⇒ identical signature ⇒ pair kept
  const same = pairExperiments([
    rec({ task: 'TASK-20260727-s1', mode: 'baseline', exp: 'EXP-20260727-s', outcome: 'pass', input: 1000, output: 0, latency: 100, comparability: { ...CMP, acceptance_signature: 'npm test' } }),
    rec({ task: 'TASK-20260727-s2', mode: 'compact', exp: 'EXP-20260727-s', outcome: 'pass', input: 400, output: 0, latency: 100, comparability: { ...CMP, acceptance_signature: 'npm test' } }),
  ]);
  assert.equal(same.pairs.length, 1);
  // different commands ⇒ different signature ⇒ excluded
  const diff = pairExperiments([
    rec({ task: 'TASK-20260727-d1', mode: 'baseline', exp: 'EXP-20260727-d', outcome: 'pass', input: 1000, output: 0, latency: 100, comparability: { ...CMP, acceptance_signature: 'npm test' } }),
    rec({ task: 'TASK-20260727-d2', mode: 'compact', exp: 'EXP-20260727-d', outcome: 'pass', input: 400, output: 0, latency: 100, comparability: { ...CMP, acceptance_signature: 'npm run build' } }),
  ]);
  assert.equal(diff.pairs.length, 0);
});

test('pairExperiments excludes a pair with an expansion round or a null comparability', () => {
  const expanded = pairExperiments([
    rec({ task: 'TASK-20260727-ex1', mode: 'baseline', exp: 'EXP-20260727-ex', outcome: 'pass', input: 1000, output: 0, latency: 100, expansion: 1 }),
    rec({ task: 'TASK-20260727-ex2', mode: 'compact', exp: 'EXP-20260727-ex', outcome: 'pass', input: 400, output: 0, latency: 100 }),
  ]);
  assert.equal(expanded.pairs.length, 0);
  assert.equal(expanded.skipped.length, 1);
  const noArtifact = pairExperiments([
    rec({ task: 'TASK-20260727-na1', mode: 'baseline', exp: 'EXP-20260727-na', outcome: 'pass', input: 1000, output: 0, latency: 100, comparability: null }),
    rec({ task: 'TASK-20260727-na2', mode: 'compact', exp: 'EXP-20260727-na', outcome: 'pass', input: 400, output: 0, latency: 100 }),
  ]);
  assert.equal(noArtifact.pairs.length, 0);
  assert.equal(noArtifact.skipped.length, 1);
});

test('aggregateExperiments avoids divide-by-zero on a zero-baseline pair', () => {
  const { pairs } = pairExperiments([
    rec({ task: 'TASK-20260727-z1', mode: 'baseline', exp: 'EXP-20260727-z', outcome: 'pass', input: 0, output: 0, latency: 0 }),
    rec({ task: 'TASK-20260727-z2', mode: 'compact', exp: 'EXP-20260727-z', outcome: 'pass', input: 0, output: 0, latency: 0 }),
  ]);
  const a = aggregateExperiments(pairs);
  assert.equal(a.mean_token_saving_pct, 0);
  assert.equal(a.mean_latency_saving_pct, 0);
});

test('recommend withholds below the sample threshold with a null verdict', () => {
  const r = recommend(agg({ pairs: 2 }), MIN_EXPERIMENT_PAIRS);
  assert.equal(r.withheld, true);
  assert.equal(r.verdict, null);
});

test('recommend prefers compact at the exact tolerance boundary when savings are material', () => {
  const r = recommend(agg({ pass_rate_drop_pct: 5, mean_token_saving_pct: 20 }), MIN_EXPERIMENT_PAIRS);
  assert.equal(r.withheld, false);
  assert.equal(r.verdict, 'prefer_compact');
});

test('recommend prefers compact on material latency saving even when token saving is immaterial', () => {
  const r = recommend(agg({ mean_token_saving_pct: 5, mean_latency_saving_pct: 20 }), MIN_EXPERIMENT_PAIRS);
  assert.equal(r.verdict, 'prefer_compact');
});

test('recommend reports no material difference when neither token nor latency saving is material', () => {
  const r = recommend(agg({ mean_token_saving_pct: 5, mean_latency_saving_pct: 5 }), MIN_EXPERIMENT_PAIRS);
  assert.equal(r.verdict, 'no_material_difference');
});

test('recommend keeps baseline when the pass-rate drop exceeds tolerance', () => {
  const r = recommend(agg({ pass_rate_drop_pct: 6, mean_token_saving_pct: 90 }), MIN_EXPERIMENT_PAIRS);
  assert.equal(r.verdict, 'keep_baseline');
});

test('recommend applies tolerance to the raw drop, not the rounded one', () => {
  // A true drop of 5.04 rounds to 5.0 for display but must still be treated as > 5.
  const r = recommend(agg({ pass_rate_drop_pct: 5.04, mean_token_saving_pct: 90 }), MIN_EXPERIMENT_PAIRS);
  assert.equal(r.verdict, 'keep_baseline');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/experiment-aggregation.test.ts`
Expected: FAIL — the functions/constants/types are not exported.

- [ ] **Step 3: Add constants, types, and functions**

In `bin/lib/evaluation-report.ts`, above `runReport`, add:

```typescript
export const MIN_EXPERIMENT_PAIRS = 5;
export const MAX_PASS_RATE_DROP_PCT = 5;
export const MIN_TOKEN_SAVING_PCT = 15;
export const MIN_LATENCY_SAVING_PCT = 15;

export type ExperimentPair = {
  experiment_id: string;
  baseline: EvaluationRecord;
  compact: EvaluationRecord;
  token_saving_pct: number;
  latency_saving_pct: number;
  outcome_preserved: boolean;
};
export type SkippedExperiment = { experiment_id: string; reason: string };
export type ExperimentAggregate = {
  pairs: number;
  baseline_pass_rate: number;
  compact_pass_rate: number;
  pass_rate_drop_pct: number;
  mean_token_saving_pct: number;
  mean_latency_saving_pct: number;
};
export type Recommendation = {
  verdict: 'prefer_compact' | 'keep_baseline' | 'no_material_difference' | null;
  withheld: boolean;
  min_samples: number;
  pairs: number;
  pass_rate_drop_pct: number;
  mean_token_saving_pct: number;
  mean_latency_saving_pct: number;
};

const OUTCOME_RANK: Record<EvaluationRecord['outcome'], number> = { fail: 0, partial: 1, pass: 2 };
// Round ONLY for display/JSON (see runReport); decisions use raw values.
export const round1 = (n: number): number => Math.round(n * 10) / 10;
const tokensOf = (r: EvaluationRecord): number => r.metrics.calls.input_tokens + r.metrics.calls.output_tokens;
// Raw (unrounded) percentage — a true drop just above tolerance must not round down into it.
const savingPct = (base: number, comp: number): number => (base > 0 ? ((base - comp) / base) * 100 : 0);

export function pairExperiments(records: EvaluationRecord[]): { pairs: ExperimentPair[]; skipped: SkippedExperiment[] } {
  const byExp = new Map<string, EvaluationRecord[]>();
  for (const r of records) {
    if (r.experiment_id === null) continue; // non-experiment 13A records
    const list = byExp.get(r.experiment_id) ?? [];
    list.push(r);
    byExp.set(r.experiment_id, list);
  }
  const pairs: ExperimentPair[] = [];
  const skipped: SkippedExperiment[] = [];
  for (const [experiment_id, list] of [...byExp.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const baselines = list.filter((r) => r.mode === 'baseline');
    const compacts = list.filter((r) => r.mode === 'compact');
    if (baselines.length !== 1 || compacts.length !== 1 || list.length !== 2) {
      skipped.push({ experiment_id, reason: `expected one baseline and one compact record, got ${baselines.length} baseline / ${compacts.length} compact` });
      continue;
    }
    const baseline = baselines[0];
    const compact = compacts[0];
    // Comparability gate: a valid context-mode experiment differs ONLY in mode.
    if (baseline.metrics.context.expansion_rounds > 0 || compact.metrics.context.expansion_rounds > 0) {
      skipped.push({ experiment_id, reason: 'excluded: an expansion round was recorded (baseline expansion is not whole-file in 13B)' });
      continue;
    }
    if (baseline.comparability === null || compact.comparability === null) {
      skipped.push({ experiment_id, reason: 'excluded: a record has no primary artifact to compare' });
      continue;
    }
    const bc = baseline.comparability;
    const cc = compact.comparability;
    // routing_signature (provider/model) is used instead of a bare tier check so two
    // distinct models that both resolve to tier 'unknown' are still non-comparable.
    if (bc.objective !== cc.objective
      || bc.repository_fingerprint !== cc.repository_fingerprint
      || bc.selection_signature !== cc.selection_signature
      || bc.acceptance_signature !== cc.acceptance_signature
      || bc.routing_signature !== cc.routing_signature) {
      skipped.push({ experiment_id, reason: 'excluded: baseline and compact are not comparable (objective/fingerprint/selection/acceptance/model differ)' });
      continue;
    }
    pairs.push({
      experiment_id,
      baseline,
      compact,
      token_saving_pct: savingPct(tokensOf(baseline), tokensOf(compact)),
      latency_saving_pct: savingPct(baseline.metrics.calls.latency_ms, compact.metrics.calls.latency_ms),
      outcome_preserved: OUTCOME_RANK[compact.outcome] >= OUTCOME_RANK[baseline.outcome],
    });
  }
  return { pairs, skipped };
}

export function aggregateExperiments(pairs: ExperimentPair[]): ExperimentAggregate {
  const n = pairs.length;
  if (n === 0) {
    return { pairs: 0, baseline_pass_rate: 0, compact_pass_rate: 0, pass_rate_drop_pct: 0, mean_token_saving_pct: 0, mean_latency_saving_pct: 0 };
  }
  // Raw values — recommend() applies thresholds to these; rounding is display-only.
  const passRate = (pick: (p: ExperimentPair) => EvaluationRecord): number =>
    (pairs.filter((p) => pick(p).outcome === 'pass').length / n) * 100;
  const baseline_pass_rate = passRate((p) => p.baseline);
  const compact_pass_rate = passRate((p) => p.compact);
  const mean = (pick: (p: ExperimentPair) => number): number => pairs.reduce((s, p) => s + pick(p), 0) / n;
  return {
    pairs: n,
    baseline_pass_rate,
    compact_pass_rate,
    pass_rate_drop_pct: baseline_pass_rate - compact_pass_rate,
    mean_token_saving_pct: mean((p) => p.token_saving_pct),
    mean_latency_saving_pct: mean((p) => p.latency_saving_pct),
  };
}

export function recommend(agg: ExperimentAggregate, minSamples: number): Recommendation {
  const base = {
    withheld: false, min_samples: minSamples, pairs: agg.pairs,
    pass_rate_drop_pct: agg.pass_rate_drop_pct,
    mean_token_saving_pct: agg.mean_token_saving_pct,
    mean_latency_saving_pct: agg.mean_latency_saving_pct,
  };
  if (agg.pairs < minSamples) return { ...base, verdict: null, withheld: true };
  if (agg.pass_rate_drop_pct > MAX_PASS_RATE_DROP_PCT) return { ...base, verdict: 'keep_baseline' };
  const material = agg.mean_token_saving_pct >= MIN_TOKEN_SAVING_PCT || agg.mean_latency_saving_pct >= MIN_LATENCY_SAVING_PCT;
  return { ...base, verdict: material ? 'prefer_compact' : 'no_material_difference' };
}
```

Ensure `EvaluationRecord` is imported at the top of the file (it already is via `import type { EvaluationRecord } from './types.js';`).

- [ ] **Step 4: Run the tests**

Run: `node --import tsx --test test/experiment-aggregation.test.ts`
Expected: PASS (12 tests).
Run: `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add bin/lib/evaluation-report.ts test/experiment-aggregation.test.ts
# feat(eval): add experiment pairing, comparability gate, and advisory recommendation logic (Phase 13B)
```

---

### Task 8: `--report` experiments section, `--json`, and `--min-samples`

**Files:**
- Modify: `bin/lib/evaluation-report.ts` (`runReport` ~line 28)
- Modify: `bin/lib/context.ts` (eager flag list ~line 43)
- Modify: `bin/lib/init.ts` (`usage()` — compile-context line ~30 and report line ~96)
- Test: `test/experiment-report-cli.test.ts` (create)

**Interfaces:**
- Consumes: `pairExperiments`, `aggregateExperiments`, `recommend`, `MIN_EXPERIMENT_PAIRS` (Task 7); `getArgValue` (existing).
- Produces: `--report` prints an Experiments section; `--report --json` includes `experiments` + `recommendation`; `--report --min-samples <n>` overrides the pair threshold.

- [ ] **Step 1: Write the failing test**

Create `test/experiment-report-cli.test.ts`. Reuse the `writeRecordFile`-style helper from `test/evaluation-report.test.ts` (a local copy that also writes `mode`/`experiment_id`):

```typescript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, runTs } from './helpers.js';

const CMP = { objective: 'demo', repository_fingerprint: 'fp', selection_signature: '1:5:a.ts', acceptance_signature: 'npm test', routing_signature: 'anthropic/claude-opus-4-8' };

function writeRec(dir: string, task: string, mode: 'baseline' | 'compact', exp: string | null, outcome: string, input: number): void {
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  const record = {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: `eval-${task}`, task_id: task,
    generated_at: '2026-07-27T00:00:00.000Z', outcome, mode, experiment_id: exp, comparability: exp === null ? null : CMP,
    outcome_source: { type: 'review_scorecard', scorecard: `.ai/state/reviews/${task}.md`, verdict: outcome === 'pass' ? 'approve' : 'request changes' },
    validation: { status: 'pass', evidence_count: 1, results: { pass: 1, fail: 0, skipped: 0 } },
    run_ids: [], context_artifact: '.ai/state/context/x.json', task_journal: `.ai/state/tasks/${task}.md`, tier: 'standard',
    metrics: {
      context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: input, output_tokens: 10, cached_tokens: 0, latency_ms: 100, retries: 0 },
    },
  };
  fs.writeFileSync(path.join(evalDir, `${task}.json`), JSON.stringify(record, null, 2) + '\n');
}

function seedOnePair(dir: string, i: number): void {
  const exp = `EXP-20260727-p${i}`;
  writeRec(dir, `TASK-20260727-b${i}`, 'baseline', exp, 'pass', 1000);
  writeRec(dir, `TASK-20260727-c${i}`, 'compact', exp, 'pass', 400);
}

test('--report withholds the advisory below the sample threshold', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-exp-'));
  seedOnePair(dir, 0);
  const out = runTs(cli, ['--report'], { cwd: dir });
  assert.match(out, /Experiments/);
  assert.match(out, /insufficient samples \(1\/5\)/);
});

test('--report --json withholds with a null verdict below the threshold', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-exp-'));
  seedOnePair(dir, 0);
  const json = JSON.parse(runTs(cli, ['--report', '--json'], { cwd: dir }));
  assert.equal(json.recommendation.withheld, true);
  assert.equal(json.recommendation.verdict, null);
});

test('--report --min-samples 1 emits the prefer-compact advisory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-exp-'));
  seedOnePair(dir, 0);
  const out = runTs(cli, ['--report', '--min-samples', '1'], { cwd: dir });
  assert.match(out, /\[advisory\]/);
  assert.match(out, /prefer compact/i);
  assert.match(out, /1 comparable pair\b/); // advisory must state the pair count
});

test('--report --json includes experiments and recommendation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-exp-'));
  seedOnePair(dir, 0);
  const json = JSON.parse(runTs(cli, ['--report', '--json', '--min-samples', '1'], { cwd: dir }));
  assert.equal(json.experiments.aggregate.pairs, 1);
  assert.equal(json.recommendation.verdict, 'prefer_compact');
  assert.equal(json.recommendation.withheld, false);
});

test('--report --min-samples rejects a non-positive value', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-exp-'));
  let threw = false;
  try {
    runTs(cli, ['--report', '--min-samples', '0'], { cwd: dir });
  } catch (err) {
    threw = true;
    assert.match(String((err as { stderr?: Buffer }).stderr ?? ''), /--min-samples must be a positive integer/);
  }
  assert.equal(threw, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/experiment-report-cli.test.ts`
Expected: FAIL — no Experiments section, `--min-samples` unhandled.

- [ ] **Step 3: Extend `runReport`**

In `bin/lib/evaluation-report.ts`, update the imports to pull in the Task 7 functions (they are in the same file, so no import needed) and `getArgValue` (already imported via `import { root, args } from './context.js';` — add `getArgValue`):

```typescript
import { root, args, getArgValue } from './context.js';
```

Rewrite `runReport` to resolve `--min-samples`, build the experiment view, extend the JSON, and print the section. Replace the existing `runReport` body with:

```typescript
export function runReport(): void {
  const records = listEvaluationRecords(root);

  // Resolve --min-samples (positive integer; defaults to MIN_EXPERIMENT_PAIRS).
  let minSamples = MIN_EXPERIMENT_PAIRS;
  const minRaw = getArgValue('--min-samples');
  if (minRaw !== null) {
    const parsed = Number(minRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      process.stderr.write('Error: --min-samples must be a positive integer.\n');
      process.exitCode = 1;
      return;
    }
    minSamples = parsed;
  }

  const { pairs, skipped } = pairExperiments(records);
  const aggregate = aggregateExperiments(pairs); // raw values (decisions already made in recommend)
  const recommendation = recommend(aggregate, minSamples);

  // Round ONLY for output. `recommend` already decided on the raw aggregate above.
  const outAggregate = {
    ...aggregate,
    baseline_pass_rate: round1(aggregate.baseline_pass_rate),
    compact_pass_rate: round1(aggregate.compact_pass_rate),
    pass_rate_drop_pct: round1(aggregate.pass_rate_drop_pct),
    mean_token_saving_pct: round1(aggregate.mean_token_saving_pct),
    mean_latency_saving_pct: round1(aggregate.mean_latency_saving_pct),
  };
  const outRecommendation = {
    ...recommendation,
    pass_rate_drop_pct: round1(recommendation.pass_rate_drop_pct),
    mean_token_saving_pct: round1(recommendation.mean_token_saving_pct),
    mean_latency_saving_pct: round1(recommendation.mean_latency_saving_pct),
  };

  if (args.has('--json')) {
    const payload = {
      ...aggregateEvaluations(records),
      experiments: {
        aggregate: outAggregate,
        pairs: pairs.map((p) => ({
          experiment_id: p.experiment_id,
          baseline_outcome: p.baseline.outcome,
          compact_outcome: p.compact.outcome,
          token_saving_pct: round1(p.token_saving_pct),
          latency_saving_pct: round1(p.latency_saving_pct),
          outcome_preserved: p.outcome_preserved,
        })),
        skipped,
      },
      recommendation: outRecommendation,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
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

  console.log('');
  console.log('Experiments');
  if (pairs.length === 0 && skipped.length === 0) {
    console.log(formatStatus('skipped', 'no paired experiments recorded'));
    return;
  }
  for (const p of pairs) {
    console.log(formatStatus('metric', `${p.experiment_id}: baseline ${p.baseline.outcome} vs compact ${p.compact.outcome}, tokens saved ${round1(p.token_saving_pct)}%, latency saved ${round1(p.latency_saving_pct)}%`));
  }
  for (const s of skipped) {
    console.log(formatStatus('skipped', `${s.experiment_id}: ${s.reason}`));
  }
  if (pairs.length > 0) {
    console.log(formatStatus('metric', `pairs ${aggregate.pairs}: baseline pass ${outAggregate.baseline_pass_rate}% vs compact pass ${outAggregate.compact_pass_rate}% (drop ${outAggregate.pass_rate_drop_pct} pts), mean tokens saved ${outAggregate.mean_token_saving_pct}%, mean latency saved ${outAggregate.mean_latency_saving_pct}%`));
  }
  if (recommendation.withheld) {
    console.log(formatStatus('skipped', `insufficient samples (${aggregate.pairs}/${minSamples}) — recommendation withheld`));
  } else {
    // Every advisory line states the pair count (n comparable pairs) per the design.
    const n = `${aggregate.pairs} comparable pair${aggregate.pairs === 1 ? '' : 's'}`;
    const verdictText = recommendation.verdict === 'prefer_compact'
      ? `prefer compact — ${n}, outcomes held (drop ${outAggregate.pass_rate_drop_pct} pts), savings material (tokens ${outAggregate.mean_token_saving_pct}%, latency ${outAggregate.mean_latency_saving_pct}%)`
      : recommendation.verdict === 'keep_baseline'
        ? `keep baseline — ${n}, compact degrades pass rate by ${outAggregate.pass_rate_drop_pct} pts (tolerance ${MAX_PASS_RATE_DROP_PCT})`
        : `no material difference — ${n}, either mode acceptable (tokens ${outAggregate.mean_token_saving_pct}%, latency ${outAggregate.mean_latency_saving_pct}%)`;
    console.log(formatStatus('metric', `[advisory] ${verdictText}`));
  }
}
```

- [ ] **Step 4: Register `--min-samples` as an eager value flag**

In `bin/lib/context.ts`, extend the eager flag list (~line 43) to include `--min-samples`:

```typescript
for (const name of ['--profile', '--emit', '--adapter', '--model', '--task', '--mode', '--experiment', '--min-samples'] as const) {
```

- [ ] **Step 5: Update help text in `init.ts`**

In `bin/lib/init.ts` `usage()`, replace the compile-context line (~line 30):

```
  forgeai-init --compile-context --objective "<description>" [--task <id>] [--mode baseline|compact] [--experiment <EXP-id>] [--budget <tokens>] [--output <json>]
```

and the report line (~line 96):

```
  --report [--json] [--min-samples <n>]
```

- [ ] **Step 6: Run the tests**

Run: `node --import tsx --test test/experiment-report-cli.test.ts`
Expected: PASS (5 tests).
Run: `node --import tsx --test test/evaluation-report.test.ts`
Expected: PASS — the 13A report tests still pass (overall/per-tier output unchanged; no experiments ⇒ `no paired experiments recorded`).
Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add bin/lib/evaluation-report.ts bin/lib/context.ts bin/lib/init.ts test/experiment-report-cli.test.ts
# feat(eval): add experiments section, --min-samples, and advisory to --report (Phase 13B)
```

---

### Task 9: Add Phase 13B to the consolidated 3.9.0 release

**Files:**
- Modify: `package.json` (`version`)
- Modify: `package-lock.json` (top-level `version` and `packages[""].version`)
- Modify: `CHANGELOG.md` (consolidated 3.9.0 entry)
- Modify: `ROADMAP.md` (Phase 13 section ~line 224)
- Modify: `README.md` (Evaluation section — add an Experiments subsection)
- Modify: `docs/migrations/3.9.0.md`

**Interfaces:** none (documentation + metadata).

- [ ] **Step 1: Bump the package version**

In `package.json`, set:

```json
  "version": "3.9.0",
```

In `package-lock.json`, update **both** the top-level version and the
`packages[""]` entry from `3.8.0` to `3.9.0`.

- [ ] **Step 2: Add the CHANGELOG entry**

Within the consolidated `3.9.0` entry in `CHANGELOG.md`, add the Phase 13B
material:

```markdown
## 3.9.0

Context experiments and advisory mode recommendation (Phase 13B).

- `--compile-context --mode baseline|compact --experiment <EXP-id>`: `baseline`
  sends the same selected files whole (uncompiled, `kind: 'file'` excerpts);
  `compact` is the existing bounded compilation. Baseline is budget-honest — it
  errors and asks for a larger `--budget` rather than truncating.
- `mode` and `experiment_id` added to compiled-context artifacts and evaluation
  records; `mode` added to run records. All additive; `schema_version` stays 1.
  Pre-3.9.0 data normalizes to `mode: compact`, `experiment_id: null`.
- `--report` gains an Experiments section that pairs baseline/compact evaluation
  records by `experiment_id` and reports per-pair and aggregate token/latency
  savings and pass-rate deltas.
- Comparability gate: a pair is only counted when the two records share tier,
  objective, repository fingerprint, selection, and acceptance criteria, and
  neither recorded an expansion round — so differences are attributable to
  context mode, not model/task/routing noise. Non-comparable pairs are skipped.
- Sample-sufficiency gate: the advisory is withheld below
  MIN_EXPERIMENT_PAIRS (5) complete pairs; override with `--report --min-samples <n>`.
- Advisory context-mode recommendation: `[advisory] prefer compact` only when the
  pass-rate drop is within tolerance (5 pts) and token or latency savings are
  material (15%); otherwise `keep baseline` or `no material difference`.
- `--report --json` extended with `experiments` and `recommendation` objects.
```

- [ ] **Step 3: Update ROADMAP**

In `ROADMAP.md`, Phase 13 section (~line 224), after the "Phase 13A shipped" paragraph add:

```markdown
**Phase 13B is included in Phase 13 shipped in 3.9.0.** Baseline/compact context experiment modes
(`--compile-context --mode --experiment`), an evaluation `mode`/`experiment_id`
link, a `--report` Experiments section pairing baseline vs compact by
`experiment_id`, a sample-sufficiency gate (`--min-samples`), and an advisory
context-mode recommendation. Still deferred: model-tier routing
recommendations, real `context_escapes` measurement, `parent_artifact` linkage,
and a `--outcome` manual override.
```

- [ ] **Step 4: Add the Experiments subsection to README**

In `README.md`, within the Evaluation section, add an Experiments subsection documenting the workflow. Insert:

```markdown
### Experiments (baseline vs compact)

Measure whether compiled context preserves outcomes at lower cost. An experiment
runs the **same task twice from the same starting revision** — once with whole
files (`baseline`), once with bounded excerpts (`compact`) — under one shared
`--experiment` id, using the **same model**.

Run each mode in its own worktree so the implementing model's edits in one run
do not change the source the other run compiles against (a changed source =
different `repository_fingerprint`, which the comparability gate would reject):

    BASE=$(git rev-parse HEAD)
    git worktree add ../exp-baseline "$BASE"
    git worktree add ../exp-compact  "$BASE"

    # Baseline worktree — whole selected files
    cd ../exp-baseline
    forgeai-init --compile-context --objective "refactor router fallback" \
      --task TASK-20260727-a --mode baseline --experiment EXP-20260727-router \
      --budget 20000 --output .ai/state/context/TASK-20260727-a.json
    forgeai-init --route --artifact .ai/state/context/TASK-20260727-a.json --adapter <a>
    # …model implements the task, you review it, then:
    forgeai-init --evaluate --task TASK-20260727-a

    # Compact worktree — bounded excerpts, same objective + same adapter/model
    cd ../exp-compact
    forgeai-init --compile-context --objective "refactor router fallback" \
      --task TASK-20260727-b --mode compact --experiment EXP-20260727-router \
      --budget 6000 --output .ai/state/context/TASK-20260727-b.json
    forgeai-init --route --artifact .ai/state/context/TASK-20260727-b.json --adapter <a>
    forgeai-init --evaluate --task TASK-20260727-b

    # Use the baseline worktree as the report workspace: its record is already
    # there, so only the compact record needs to be copied in.
    cp .ai/state/evaluations/TASK-20260727-b.json ../exp-baseline/.ai/state/evaluations/
    cd ../exp-baseline
    forgeai-init --report                    # Experiments section + advisory
    forgeai-init --report --min-samples 1     # lower the pair threshold for a demo

The two `--task` ids must differ (each is a real reviewed task); the
`--experiment` id, objective, and adapter/model must match. `--evaluate` refuses
to write an experiment record whose runs did not route that task's compiled
artifact, so each mode's run must happen in its own worktree.

The advisory recommends `prefer compact` only once there are at least
`--min-samples` (default 5) complete baseline/compact pairs, the compact pass
rate is within 5 points of baseline, and mean token or latency savings reach
15%. A pair counts only if the two runs are comparable — same objective,
repository fingerprint, selected files, acceptance criteria, and
**provider/model routing signature**, with no expansion round — so the measured
difference is attributable to context mode rather than model, task, or revision
changes; non-comparable pairs are listed as skipped. Records without an
`experiment_id` (ordinary evaluations) are excluded from the experiment analysis
but still counted in the overall and per-tier summary.
```

- [ ] **Step 5: Add the migration note**

Add the following Phase 13B material to the consolidated
`docs/migrations/3.9.0.md`:

```markdown
# Migrating to 3.9.0

Additive change — run `forgeai-init --upgrade`. No breaking schema or config
change.

Phase 13B adds context experiments:

- `--compile-context` accepts `--mode baseline|compact` (default `compact`, the
  prior behavior) and `--experiment <EXP-YYYYMMDD-slug>`.
- Compiled-context artifacts and evaluation records gain `mode` and
  `experiment_id`; evaluation records also gain a `comparability` block used to
  pair experiments; run records gain `mode`. `schema_version` stays `1`.
- `--report` gains an Experiments section, a `--min-samples <n>` override, and an
  advisory recommendation; `--report --json` gains `experiments` and
  `recommendation` objects.

Pre-3.9.0 artifacts, run records, and evaluation records have no `mode`/
`experiment_id`/`comparability`; they read as `mode: compact`,
`experiment_id: null`, `comparability: null` and are excluded from experiment
pairing (but still counted in the overall and per-tier summary). Historical runs
are not retro-paired.
```

- [ ] **Step 6: Verify version consistency and build**

Run: `grep -rn '3.9.0' package.json package-lock.json CHANGELOG.md`
Expected: `package.json` (1), `package-lock.json` (2), `CHANGELOG.md` (≥1).
Run: `npm test`
Expected: typecheck + build clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json CHANGELOG.md ROADMAP.md README.md docs/migrations/3.9.0.md
# docs(release): 3.9.0 — context experiments and advisory mode recommendation (Phase 13B)
```

---

## Self-Review

**Spec coverage:**
- 13B.1 experiment modes → Tasks 2 (schema), 5 (baseline compile + flags). ✓
- Baseline = whole selected files, budget-honest → Task 5 `wholeFileExcerpt` + over-budget throw; Task 5 tests assert excerpt content == whole file and identical selection to compact. ✓
- `mode`/`experiment_id` threading (artifact → run record → evaluation record) → Tasks 2, 3, 5, 6; expansion carry-through locked in Task 5 Step 7. ✓
- **`experiment_id` shape enforced** (not merely non-empty) via `isValidExperimentId` in the artifact validator (Task 2) and `isValidEvaluationRecord` (Task 4); all fixtures use valid `EXP-YYYYMMDD-slug` ids. ✓ (review finding 3)
- **Comparability gate** (pair differs only in context mode: equal objective/fingerprint/selection/acceptance/**routing** signatures, no expansion round, non-null comparability) → `comparability` block persisted in Tasks 4/6, gate in Task 7 `pairExperiments`, tests for model/objective mismatch, expansion, and null-comparability exclusion. ✓ (review round 1 finding 1)
- **`acceptance_signature` reads the Command column (`cells[1]`)**, not Date (`cells[0]`), matching `review.ts` `isRealEvidenceRow`'s `[date, command, result]`; Task 6 test asserts the signature contains no date, Task 7 asserts same-command→kept / different-command→excluded. ✓ (review round 2 finding 1)
- **Model/provenance control:** `routing_signature` (provider/model of the runs) replaces the bare `tier` equality so two models both resolving to tier `unknown` are non-comparable; `--evaluate` enforces an experiment provenance gate (≥1 run, `run.mode === artifact.mode`, run routed the primary artifact) in Task 6, with negative tests. ✓ (review round 2 finding 2)
- **Advisory line states the pair count** (`N comparable pairs`) in every verdict → Task 8. ✓ (review round 2 finding 3)
- **Decide on raw, round on render:** `aggregateExperiments`/`savingPct` return unrounded values, `recommend` compares raw thresholds, and Task 8 rounds only for text/JSON; a `5.04` drop test proves the boundary uses the raw value. ✓ (review round 2 finding 4)
- **Two-worktree experiment workflow** documented in the Task 9 README so the two modes compile from the same base revision (shared `repository_fingerprint`) and their records are gathered for `--report`; distinct `task_id`s, matching objective/model/experiment id. ✓ (review round 3 finding 1)
- **Design principles refreshed** — the spec no longer claims "no new gate / two fields only"; it records the experiment-only provenance gate and the `comparability` field, and the schema JSON example includes `routing_signature`. ✓ (review round 3 findings 2, 3)
- **New invariants directly asserted:** Task 6 has a run-mode-≠-artifact-mode rejection test (alongside no-run and wrong-artifact); Task 8's advisory test asserts `1 comparable pair` appears. ✓ (review round 3 finding 4)
- **Baseline expansion excluded from advisory** — since `compileContextExpansion` still emits compact excerpts, any pair with `expansion_rounds > 0` is skipped (Task 7). ✓ (review finding 2)
- 13B.2 sufficiency gate (`MIN_EXPERIMENT_PAIRS`, `--min-samples`) → Tasks 7 (`recommend` withhold, `verdict: null`), 8 (CLI). ✓
- **Withheld ⇒ `verdict: null`** in JSON so a consumer cannot read a stale verdict → Task 7 `recommend`, asserted in Tasks 7 and 8. ✓ (review finding 4)
- 13B.3 advisory recommendation (boundary drop, token-immaterial-but-latency-material, both-immaterial, keep-baseline) → Task 7 tests over hand-built aggregates. ✓ (review finding 5)
- Report Experiments section + `--json` → Task 8. ✓
- Backward compatibility (legacy normalize, still counted in overall/per-tier) → Tasks 2/3/4 normalization; Task 2 Step 9 asserts `validateArtifact` legacy normalization; Task 8 preserves the 13A summary and re-runs the 13A report test. ✓
- No storage/key change → confirmed; no evaluation-record filename or `evaluation_id` change anywhere. ✓
- Docs + version → Task 9. ✓

**Placeholder scan:** No "TBD/handle edge cases/similar to Task N" — every code step shows the code. Test fixtures that reuse an existing helper (Tasks 5, 6, and the expansion/router extensions) explicitly instruct copying the working fixture rather than inventing one, with the exact new assertions given.

**Type consistency:** `mode: 'baseline' | 'compact'` on artifact/evaluation record; `mode: 'baseline' | 'compact' | null` on run record (nullable, matching `task_id`'s pattern). `comparability: EvaluationComparability | null` on the evaluation record, populated in Task 6 and read in Task 7's gate with matching field names (`objective`, `repository_fingerprint`, `selection_signature`, `acceptance_signature`). `Recommendation.verdict` includes `| null` and is `null` exactly when `withheld` (Task 7), consistent with both Task 7 and Task 8 assertions. `pairExperiments` / `aggregateExperiments` / `recommend` and the `ExperimentPair`/`ExperimentAggregate`/`Recommendation` types are used identically in Tasks 7 and 8. The `'file'` excerpt kind is added to both the type union (Task 2 Step 3) and `validExcerptKinds` (Task 2 Step 5).

**Ordering / green-at-every-task:** each required-field addition ships with its literal updates in the same task (Steps 7-8 of Tasks 2-4, plus the `comparability` field in Task 4), and `npm test` runs `tsc` over `test/**` too — so the plan explicitly resolves every flagged literal before that task's commit.
