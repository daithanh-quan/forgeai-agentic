# Phase 13C — Context escapes and parent-artifact linkage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure real `context_escapes` from a per-task, digest-attributed, event-per-file escape store (with observation markers so a true `0` is distinguishable from "never measured"), and record `parent_artifact` on expansion artifacts.

**Architecture:** `--expand-context` records an observation marker for the evaluated primary (by immutable content digest) on every run, and one file per declined `need_context` request (schema/graph rejections, plus whole-set `budget_exceeded`/`no_new_context` and the low-capacity early return). Expansion-of-expansion is rejected so every escape attributes to exactly one primary. `--evaluate` computes the evaluated primary's digest, and reports `null` (unobserved), `0` (observed, no escapes), `N` (N escapes), or hard-fails on any malformed record.

**Tech Stack:** TypeScript (Node ESM), `node:crypto`, `node:test` + `node:assert/strict`, `tsx` loader. Tests run end-to-end via `runTs(cli, …)` in temp dirs and as unit imports from `../bin/lib/*.js`.

## Global Constraints

- `schema_version` stays `1` on `CompiledContextArtifact` and `EvaluationRecord`; escape/observation records are their own `schema_version: 1` kinds. Pre-13C artifacts/records read back as `parent_artifact: null` / `context_escapes: null`.
- Escape store is derived local state: gitignored and preserved on `--upgrade` (same treatment as `.ai/state/runs/` and `.ai/state/evaluations/`).
- Provenance is the **primary digest** = `sha256(<raw bytes of the primary artifact file>)` (64-hex), never the path. Same file ⇒ same digest at record and eval time.
- `context_escapes` counts **distinct declined context needs** (a request retried across runs deduplicates to one event via `escape_id`), never occurrences. Rules (never a silent/misleading `0`): no primary artifact → `null`; no task escape dir → `null`; primary digest not observed → `null`; observed with zero matching events → `0`; observed with N distinct → `N`; any malformed record or unreadable store structure → `--evaluate` FAILS and writes no record.
- `--expand-context` records nothing until all preconditions pass: `--artifact` must resolve inside the repository root (reject an absolute or `..`-prefixed `path.relative`), and `--budget` syntax is validated before the observation marker is written. The event's `request` is validated only as a plain object (declined requests are recorded *because* they were malformed); the recomputed `escape_id` is the integrity check.
- Stored artifact references use relative-to-root forward-slash paths (`.ai/state/context/<name>.json`).
- `task_id` (`isValidTaskId`) and `primary_digest` (64-hex) are validated before any path interpolation (traversal guard). Writes are atomic (`<file>.<pid>.tmp` + `fs.renameSync`).
- Valid task ids match `/^TASK-\d{8}-[a-z0-9][a-z0-9-]*$/` (`bin/lib/utils.ts`). Use ids like `TASK-20260727-esc` in tests — `TASK-01` is invalid and will throw.
- Test command for one file: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/<file>.test.ts`. Full suite: `npm test`. `stableArtifactEstimate` serializes the whole artifact, so adding `parent_artifact` shifts `estimated_tokens` by a few tokens — expect and fix any exact-estimate assertions.
- Release: the whole of Phase 13 (13A + 13B + 13C) ships as a **single
  unreleased `3.9.0`** from the last published `3.8.0`. Task 7 keeps one
  `package.json`/lock version, one CHANGELOG entry, and one migration guide at
  `3.9.0`, and marks 13A/B/C as shipped together in the ROADMAP. Tasks 1–6 do
  not depend on the number.

---

### Task 1: Add `parent_artifact` to the artifact type, schema, and normalization

**Files:**
- Modify: `bin/lib/types.ts` (add field to `CompiledContextArtifact`, ~line 173)
- Modify: `bin/lib/router.ts` (`checkArtifactStructure` ~line 45; `validateArtifact` normalization ~line 152)
- Modify: `bin/lib/evaluation-record.ts` (`findArtifactsForTask` normalization ~line 361)
- Test: `test/artifact-mode-schema.test.ts`

**Interfaces:**
- Produces: `CompiledContextArtifact.parent_artifact: string | null`. `checkArtifactStructure` accepts missing/`null`/string; `validateArtifact` returns it normalized to `null` when absent.

- [ ] **Step 1: Write the failing test**

Add to `test/artifact-mode-schema.test.ts`:

```ts
test('checkArtifactStructure accepts a missing, null, or string parent_artifact and rejects other types', async () => {
  const { checkArtifactStructure } = await import('../bin/lib/router.js');
  const base = {
    kind: 'forgeai_compiled_context', schema_version: 1, objective: 'x', task_id: null,
    repository: { revision: null, fingerprint: 'fp' },
    budget: { limit_tokens: 6000, estimated_tokens: 10, estimator: 'characters_divided_by_4', exhausted: false },
    selection: { max_depth: 1, max_nodes: 1, files: [] },
    excerpts: [], rules: [], diagnostics: {}, contracts: [], entrypoints: [], omitted_candidates: 0,
  } as Record<string, unknown>;
  assert.equal(checkArtifactStructure(base), null); // absent is fine
  assert.equal(checkArtifactStructure({ ...base, parent_artifact: null }), null);
  assert.equal(checkArtifactStructure({ ...base, parent_artifact: '.ai/state/context/P.json' }), null);
  assert.equal(checkArtifactStructure({ ...base, parent_artifact: 5 }), 'parent_artifact must be null or a string');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/artifact-mode-schema.test.ts`
Expected: FAIL — `checkArtifactStructure({ ...base, parent_artifact: 5 })` returns `null` (no such check yet).

- [ ] **Step 3: Add the field to the type**

In `bin/lib/types.ts`, inside `CompiledContextArtifact`, immediately after `experiment_id: string | null;`:

```ts
  parent_artifact: string | null;
```

- [ ] **Step 4: Add lenient validation + normalization in `router.ts`**

In `checkArtifactStructure`, after the `experiment_id` check (~line 45):

```ts
  if (a.parent_artifact !== null && a.parent_artifact !== undefined && typeof a.parent_artifact !== 'string') {
    return 'parent_artifact must be null or a string';
  }
```

In `validateArtifact`'s normalized return object (~line 152), add:

```ts
      parent_artifact: artifact.parent_artifact ?? null,
```

- [ ] **Step 5: Normalize in `findArtifactsForTask`**

In `bin/lib/evaluation-record.ts`, in the `artifact` object built inside `findArtifactsForTask` (~line 361), after `experiment_id`:

```ts
      parent_artifact: (rawRecord['parent_artifact'] as string | null | undefined) ?? null,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/artifact-mode-schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add bin/lib/types.ts bin/lib/router.ts bin/lib/evaluation-record.ts test/artifact-mode-schema.test.ts
git commit -m "feat(context): add additive parent_artifact field and validation"
```

---

### Task 2: Stamp `parent_artifact` when compiling primary and expansion artifacts

**Files:**
- Modify: `bin/lib/context-compiler.ts` (`compileContext` artifact ctor ~line 238; `compileContextExpansion` options + artifact ctor ~lines 306-429; `renderCompiledContextMarkdown` ~line 483)
- Modify: `bin/lib/context-expansion.ts` (`runExpandContext` call to `compileContextExpansion` ~line 201)
- Test: `test/context-expansion.test.ts`, plus estimate-sensitive suites

**Interfaces:**
- Consumes: `CompiledContextArtifact.parent_artifact` (Task 1).
- Produces: `compileContextExpansion(primary, valid, curatedGraph, depGraph, root, { budget, parentArtifact })` — new optional `parentArtifact?: string | null`. Primary artifacts get `parent_artifact: null`; expansion artifacts get the passed value (or `null`).

- [ ] **Step 1: Write the failing test**

Add to `test/context-expansion.test.ts`:

```ts
test('compileContextExpansion stamps parent_artifact and compileContext leaves it null', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-parent-'));
  buildFixture(target);
  const { compileContextExpansion } = await import('../bin/lib/context-compiler.js');
  const { readDependencyGraph } = await import('../bin/lib/dependency-graph.js');
  const { tryReadCuratedCodeGraph } = await import('../bin/lib/context-pack.js');
  const primaryPath = path.join(target, '.ai/state/context/TASK-20260727-parent.json');
  runTs(cli, ['--compile-context', '--task', 'TASK-20260727-parent', '--objective', 'login', '--budget', '6000', '--output', '.ai/state/context/TASK-20260727-parent.json'], { cwd: target });
  const primary = JSON.parse(fs.readFileSync(primaryPath, 'utf8')) as CompiledContextArtifact;
  assert.equal(primary.parent_artifact, null, 'primary parent_artifact is null');
  const depGraph = readDependencyGraph(target);
  const curatedGraph = tryReadCuratedCodeGraph(target);
  const requests: ResolvedContextRequest[] = [{ requestKind: 'file', path: 'src/auth.ts', reason: 'need private helper' }];
  const expansion = compileContextExpansion(primary, requests, curatedGraph, depGraph!, target, { budget: 4000, parentArtifact: '.ai/state/context/TASK-20260727-parent.json' });
  assert.equal(expansion.artifact_role, 'expansion');
  assert.equal(expansion.parent_artifact, '.ai/state/context/TASK-20260727-parent.json');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/context-expansion.test.ts`
Expected: FAIL — `parentArtifact` is not an accepted option / `parent_artifact` is `undefined`.

- [ ] **Step 3: Set `parent_artifact: null` on the primary artifact**

In `bin/lib/context-compiler.ts` `compileContext`, in the artifact object literal (~line 238-245), after `experiment_id: options.experimentId ?? null,`:

```ts
    parent_artifact: null,
```

(It must be present at construction because `stableArtifactEstimate` serializes the whole artifact for the token estimate.)

- [ ] **Step 4: Accept and stamp `parentArtifact` in `compileContextExpansion`**

In `compileContextExpansion`'s signature options object (~line 313), extend to:

```ts
  options: { budget?: number; parentArtifact?: string | null } = {}
```

In its artifact object literal (~line 422-429), after `experiment_id: primary.experiment_id,`:

```ts
    parent_artifact: options.parentArtifact ?? null,
```

- [ ] **Step 5: Pass the primary path from `runExpandContext`**

In `bin/lib/context-expansion.ts`, immediately before the `compileContextExpansion` call (~line 201):

```ts
    const parentRel = path.relative(root, artifactPath).split(path.sep).join('/');
    expansion = compileContextExpansion(primary, valid, curatedGraph, depGraph!, root, { budget, parentArtifact: parentRel });
```

(Task 4 relocates this `parentRel` declaration to the top of the function and reuses it; for now declaring it here is fine.)

- [ ] **Step 6: Surface the parent in the Markdown render**

In `renderCompiledContextMarkdown` (`bin/lib/context-compiler.ts` ~line 483), where the header/objective is emitted, add for expansion artifacts:

```ts
  const parentLine = artifact.parent_artifact ? `\n- Parent artifact: ${artifact.parent_artifact}` : '';
```

Include `${parentLine}` in the header template string immediately after the `artifact_role`/objective portion.

- [ ] **Step 7: Run tests to verify they pass; fix estimate ripple**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/context-expansion.test.ts`
Expected: PASS.

Then: `node --import ./node_modules/tsx/dist/loader.mjs --test test/baseline-compile.test.ts test/context-compiler.test.ts test/artifact-mode-schema.test.ts`
Expected: PASS. If any assertion checks an exact `estimated_tokens` / `budget.estimated_tokens`, update the literal to the new value from the failure output. Do not loosen the assertion.

- [ ] **Step 8: Commit**

```bash
git add bin/lib/context-compiler.ts bin/lib/context-expansion.ts test/
git commit -m "feat(context): stamp parent_artifact on primary and expansion artifacts"
```

---

### Task 3: Escape store types and module (digest, record, resolve)

**Files:**
- Modify: `bin/lib/types.ts` (add `EscapeReasonCode`, `RejectedRequestSnapshot`, `ContextEscapeEvent`, `ContextEscapeObservation`)
- Create: `bin/lib/context-escapes.ts`
- Test: `test/context-escapes.test.ts` (new)

**Interfaces:**
- Consumes: `NeedContextRequestItem` (existing).
- Produces:
  - `artifactDigest(rawContent: string): string` — 64-hex sha256 of raw bytes.
  - `escapeId(primaryDigest: string, request: RejectedRequestSnapshot, reasonCode: EscapeReasonCode): string` — 16-hex. (`RejectedRequestSnapshot = Record<string, unknown>` — a declined request may be malformed, so it is NOT typed as `NeedContextRequestItem`.)
  - `taskEscapeDir(root: string, taskId: string): string`.
  - `type NewEscape = { primary_artifact: string; primary_digest: string; request: RejectedRequestSnapshot; reason_code: EscapeReasonCode; detail: string }`.
  - `recordObservation(taskId: string, obs: { primary_artifact: string; primary_digest: string }, root: string): void` (idempotent; atomic; throws on invalid `taskId`/digest).
  - `recordEscapes(taskId: string, escapes: NewEscape[], root: string): void` (dedup by `escape_id` filename; atomic; no-op on empty; throws on invalid `taskId`/digest).
  - `type ResolveResult = { ok: true; count: number | null } | { ok: false; reason: string }`.
  - `resolveEscapeCount(taskId: string, primaryDigest: string, root: string): ResolveResult`.

- [ ] **Step 1: Add types**

In `bin/lib/types.ts`, after the `NeedContextArtifact` type:

```ts
export type EscapeReasonCode =
  | 'missing_reason' | 'missing_path' | 'missing_name'
  | 'ignored_path' | 'path_not_in_graph' | 'symbol_not_found'
  | 'unknown_kind' | 'budget_exceeded' | 'no_new_context';

// A persisted snapshot of the declined request. Deliberately NOT a
// NeedContextRequestItem — missing_reason / missing_name / unknown_kind escapes
// exist precisely because the submitted request was malformed.
export type RejectedRequestSnapshot = Record<string, unknown>;

export type ContextEscapeEvent = {
  schema_version: 1;
  kind: 'forgeai_context_escape_event';
  escape_id: string;
  task_id: string;
  recorded_at: string;
  primary_artifact: string;
  primary_digest: string;
  request: RejectedRequestSnapshot;
  status: 'rejected';
  reason_code: EscapeReasonCode;
  detail: string;
};

export type ContextEscapeObservation = {
  schema_version: 1;
  kind: 'forgeai_context_escape_observation';
  task_id: string;
  recorded_at: string;
  primary_artifact: string;
  primary_digest: string;
};
```

- [ ] **Step 2: Write the failing test**

Create `test/context-escapes.test.ts`:

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { RejectedRequestSnapshot } from '../bin/lib/types.js';
import {
  artifactDigest, escapeId, recordEscapes, recordObservation, resolveEscapeCount, taskEscapeDir, type NewEscape,
} from '../bin/lib/context-escapes.js';

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-esc-')); }
const TASK = 'TASK-20260727-esc';
const DIGEST = 'a'.repeat(64);
const req: RejectedRequestSnapshot = { kind: 'file', path: 'src/a.ts', reason: 'need a' };
const esc = (over: Partial<NewEscape> = {}): NewEscape => ({
  primary_artifact: '.ai/state/context/T.json', primary_digest: DIGEST, request: req, reason_code: 'path_not_in_graph', detail: 'nope', ...over,
});

test('artifactDigest is 64-hex and escapeId is 16-hex, key-order independent', () => {
  assert.match(artifactDigest('{"a":1}'), /^[0-9a-f]{64}$/);
  const a = escapeId(DIGEST, { kind: 'file', path: 'src/a.ts', reason: 'r' }, 'path_not_in_graph');
  const b = escapeId(DIGEST, { reason: 'r', path: 'src/a.ts', kind: 'file' }, 'path_not_in_graph');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('recordEscapes writes one file per escape and dedupes on re-run', () => {
  const root = tmp();
  recordEscapes(TASK, [esc()], root);
  recordEscapes(TASK, [esc()], root); // same escape_id -> deduped
  const evDir = path.join(taskEscapeDir(root, TASK), 'events');
  const files = fs.readdirSync(evDir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 1);
  const rec = JSON.parse(fs.readFileSync(path.join(evDir, files[0]), 'utf8'));
  assert.equal(rec.kind, 'forgeai_context_escape_event');
  assert.equal(files[0], `${rec.escape_id}.json`);
});

test('recordEscapes / recordObservation refuse an invalid task id or digest', () => {
  const root = tmp();
  assert.throws(() => recordEscapes('../evil', [esc()], root), /invalid task_id/);
  assert.throws(() => recordObservation(TASK, { primary_artifact: 'x', primary_digest: 'short' }, root), /primary_digest/);
});

test('resolveEscapeCount: null unobserved, 0 observed-empty, N observed-with-events', () => {
  const root = tmp();
  // no dir at all
  assert.deepEqual(resolveEscapeCount(TASK, DIGEST, root), { ok: true, count: null });
  // observed, no events -> 0
  recordObservation(TASK, { primary_artifact: '.ai/state/context/T.json', primary_digest: DIGEST }, root);
  assert.deepEqual(resolveEscapeCount(TASK, DIGEST, root), { ok: true, count: 0 });
  // observed, two escapes for this digest, one for another digest
  recordEscapes(TASK, [
    esc({ request: { kind: 'file', path: 'src/a.ts', reason: 'r' } }),
    esc({ request: { kind: 'file', path: 'src/b.ts', reason: 'r' } }),
    esc({ primary_digest: 'b'.repeat(64), request: { kind: 'file', path: 'src/c.ts', reason: 'r' } }),
  ], root);
  assert.deepEqual(resolveEscapeCount(TASK, DIGEST, root), { ok: true, count: 2 });
  // a different, unobserved digest -> null even though its events exist
  assert.deepEqual(resolveEscapeCount(TASK, 'b'.repeat(64), root), { ok: true, count: null });
});

test('resolveEscapeCount fails on a malformed marker or event file', () => {
  const root = tmp();
  recordObservation(TASK, { primary_artifact: '.ai/state/context/T.json', primary_digest: DIGEST }, root);
  const evDir = path.join(taskEscapeDir(root, TASK), 'events');
  fs.mkdirSync(evDir, { recursive: true });
  fs.writeFileSync(path.join(evDir, 'deadbeefdeadbeef.json'), '{ broken');
  const r = resolveEscapeCount(TASK, DIGEST, root);
  assert.equal(r.ok, false);
});

test('escapes for malformed requests (missing_reason / missing_name / unknown_kind) are valid, not malformed', () => {
  const root = tmp();
  recordObservation(TASK, { primary_artifact: '.ai/state/context/T.json', primary_digest: DIGEST }, root);
  recordEscapes(TASK, [
    // request intentionally lacks `reason` — this is exactly what missing_reason records.
    // No casts needed: NewEscape.request is RejectedRequestSnapshot (Record<string, unknown>).
    esc({ request: { kind: 'file', path: 'src/a.ts' }, reason_code: 'missing_reason' }),
    esc({ request: { kind: 'symbol', reason: 'r' }, reason_code: 'missing_name' }),
    esc({ request: { kind: 'weird', reason: 'r' }, reason_code: 'unknown_kind' }),
  ], root);
  const r = resolveEscapeCount(TASK, DIGEST, root);
  assert.deepEqual(r, { ok: true, count: 3 }); // all three round-trip as valid events
});

test('resolveEscapeCount fails structurally when observed/events is a file, not a directory', () => {
  const root = tmp();
  const dir = taskEscapeDir(root, TASK);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'observed'), 'not a directory');
  const r = resolveEscapeCount(TASK, DIGEST, root);
  assert.equal(r.ok, false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/context-escapes.test.ts`
Expected: FAIL — `../bin/lib/context-escapes.js` does not exist.

- [ ] **Step 4: Implement the module**

> The shipped `bin/lib/context-escapes.ts` is authoritative. It refines the block
> below in three ways settled during review: the persisted `request` is typed
> `RejectedRequestSnapshot`, not `NeedContextRequestItem`; event validation uses a
> plain-object check plus a recomputed `escape_id` (not a full request union); and
> `resolveEscapeCount` `stat`s the task directory so a file-where-a-directory-is-
> expected fails rather than reading as "unobserved".

Create `bin/lib/context-escapes.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  ContextEscapeEvent, ContextEscapeObservation, EscapeReasonCode, RejectedRequestSnapshot,
} from './types.js';
import { isValidTaskId } from './utils.js';

const ESCAPE_DIR = '.ai/state/context-escapes';
const DIGEST_RE = /^[0-9a-f]{64}$/;
const ESCAPE_ID_RE = /^[0-9a-f]{16}$/;
const REASON_CODES: ReadonlySet<EscapeReasonCode> = new Set<EscapeReasonCode>([
  'missing_reason', 'missing_path', 'missing_name', 'ignored_path', 'path_not_in_graph',
  'symbol_not_found', 'unknown_kind', 'budget_exceeded', 'no_new_context',
]);

export function taskEscapeDir(root: string, taskId: string): string {
  return path.join(root, ESCAPE_DIR, taskId);
}

export function artifactDigest(rawContent: string): string {
  return crypto.createHash('sha256').update(rawContent).digest('hex');
}

// Canonicalize so equal requests hash equally regardless of key order.
function canonicalRequest(request: RejectedRequestSnapshot): string {
  const obj: Record<string, unknown> = {};
  for (const k of Object.keys(request).sort()) obj[k] = request[k];
  return JSON.stringify(obj);
}

export function escapeId(primaryDigest: string, request: RejectedRequestSnapshot, reasonCode: EscapeReasonCode): string {
  const material = `${primaryDigest}\n${canonicalRequest(request)}\n${reasonCode}`;
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 16);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

export function recordObservation(taskId: string, obs: { primary_artifact: string; primary_digest: string }, root: string): void {
  if (!isValidTaskId(taskId)) throw new Error(`refusing to record observation with invalid task_id: ${taskId}`);
  if (!DIGEST_RE.test(obs.primary_digest)) throw new Error(`refusing to record observation with invalid primary_digest: ${obs.primary_digest}`);
  const filePath = path.join(taskEscapeDir(root, taskId), 'observed', `${obs.primary_digest}.json`);
  if (fs.existsSync(filePath)) return; // idempotent
  const record: ContextEscapeObservation = {
    schema_version: 1, kind: 'forgeai_context_escape_observation', task_id: taskId,
    recorded_at: new Date().toISOString(), primary_artifact: obs.primary_artifact, primary_digest: obs.primary_digest,
  };
  writeJsonAtomic(filePath, record);
}

export type NewEscape = {
  primary_artifact: string;
  primary_digest: string;
  request: RejectedRequestSnapshot;
  reason_code: EscapeReasonCode;
  detail: string;
};

export function recordEscapes(taskId: string, escapes: NewEscape[], root: string): void {
  if (!isValidTaskId(taskId)) throw new Error(`refusing to record escapes with invalid task_id: ${taskId}`);
  if (escapes.length === 0) return;
  const now = new Date().toISOString();
  for (const esc of escapes) {
    if (!DIGEST_RE.test(esc.primary_digest)) throw new Error(`refusing to record escape with invalid primary_digest: ${esc.primary_digest}`);
    // Fail-fast on a request the reader would reject (e.g. an array): silently
    // skipping it would leave an observation with no event and let --evaluate
    // report a misleading context_escapes: 0. Consistent with the guards above.
    if (!isPlainObject(esc.request)) throw new Error('refusing to record escape with a non-object request');
    const id = escapeId(esc.primary_digest, esc.request, esc.reason_code);
    const filePath = path.join(taskEscapeDir(root, taskId), 'events', `${id}.json`);
    if (fs.existsSync(filePath)) continue; // dedup by filename
    const record: ContextEscapeEvent = {
      schema_version: 1, kind: 'forgeai_context_escape_event', escape_id: id, task_id: taskId,
      recorded_at: now, primary_artifact: esc.primary_artifact, primary_digest: esc.primary_digest,
      request: esc.request, status: 'rejected', reason_code: esc.reason_code, detail: esc.detail,
    };
    writeJsonAtomic(filePath, record);
  }
}

// ─── read + validate ──────────────────────────────────────────────────────────

function isIso(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
}

// Declined requests are recorded *because* they were malformed (missing
// reason/path/name, unknown kind), so we do NOT require a full request union —
// only a plain object so canonicalRequest() can hash it. The recomputed
// escape_id below is the real integrity check.
function isPlainObject(raw: unknown): raw is RejectedRequestSnapshot {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function isValidObservation(raw: unknown, taskId: string, fileDigest: string): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return r.kind === 'forgeai_context_escape_observation' && r.schema_version === 1
    && r.task_id === taskId && isIso(r.recorded_at)
    && typeof r.primary_artifact === 'string' && (r.primary_artifact as string).length > 0
    && DIGEST_RE.test(fileDigest) && r.primary_digest === fileDigest;
}

function validateEvent(raw: unknown, taskId: string): ContextEscapeEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'forgeai_context_escape_event' || r.schema_version !== 1) return null;
  if (r.task_id !== taskId) return null;
  if (!isIso(r.recorded_at)) return null;
  if (typeof r.primary_artifact !== 'string' || (r.primary_artifact as string).length === 0) return null;
  if (typeof r.primary_digest !== 'string' || !DIGEST_RE.test(r.primary_digest as string)) return null;
  if (r.status !== 'rejected') return null;
  if (typeof r.reason_code !== 'string' || !REASON_CODES.has(r.reason_code as EscapeReasonCode)) return null;
  if (typeof r.detail !== 'string') return null;
  if (!isPlainObject(r.request)) return null;
  if (typeof r.escape_id !== 'string' || !ESCAPE_ID_RE.test(r.escape_id as string)) return null;
  // Recompute: escape_id must match content (rejects tampered/corrupt files).
  if (escapeId(r.primary_digest as string, r.request as RejectedRequestSnapshot, r.reason_code as EscapeReasonCode) !== r.escape_id) return null;
  return r as unknown as ContextEscapeEvent;
}

export type ResolveResult = { ok: true; count: number | null } | { ok: false; reason: string };

// Safely list *.json entries in a directory; ENOTDIR (a file where a directory
// is expected) or any read error surfaces as a structural failure, never a throw.
function listJsonSafely(dir: string, label: string): string[] | { error: string } {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.tmp'));
  } catch (err) {
    return { error: `${label} is not a readable directory: ${String(err)}` };
  }
}

export function resolveEscapeCount(taskId: string, primaryDigest: string, root: string): ResolveResult {
  if (!isValidTaskId(taskId)) return { ok: false, reason: `invalid task id ${taskId}` };
  if (!DIGEST_RE.test(primaryDigest)) return { ok: false, reason: `invalid primary digest` };
  const dir = taskEscapeDir(root, taskId);
  let dirStat: fs.Stats;
  try {
    dirStat = fs.statSync(dir);
  } catch {
    return { ok: true, count: null }; // no store for this task
  }
  // The task path exists but is not a directory — a corrupt store, not "unobserved".
  if (!dirStat.isDirectory()) return { ok: false, reason: `${ESCAPE_DIR}/${taskId} is not a directory` };

  // Observation markers gate null-vs-0.
  let observed = false;
  const obsDir = path.join(dir, 'observed');
  const obsNames = listJsonSafely(obsDir, `${ESCAPE_DIR}/${taskId}/observed`);
  if (!Array.isArray(obsNames)) return { ok: false, reason: obsNames.error };
  for (const name of obsNames) {
    const fileDigest = name.slice(0, -5);
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(path.join(obsDir, name), 'utf8')); }
    catch { return { ok: false, reason: `${ESCAPE_DIR}/${taskId}/observed/${name} is not valid JSON` }; }
    if (!isValidObservation(raw, taskId, fileDigest)) return { ok: false, reason: `${ESCAPE_DIR}/${taskId}/observed/${name} is malformed` };
    if (fileDigest === primaryDigest) observed = true;
  }

  // Count events matching the evaluated primary digest.
  let count = 0;
  const evDir = path.join(dir, 'events');
  const evNames = listJsonSafely(evDir, `${ESCAPE_DIR}/${taskId}/events`);
  if (!Array.isArray(evNames)) return { ok: false, reason: evNames.error };
  for (const name of evNames) {
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(path.join(evDir, name), 'utf8')); }
    catch { return { ok: false, reason: `${ESCAPE_DIR}/${taskId}/events/${name} is not valid JSON` }; }
    const event = validateEvent(raw, taskId);
    if (!event) return { ok: false, reason: `${ESCAPE_DIR}/${taskId}/events/${name} is malformed` };
    if (name !== `${event.escape_id}.json`) return { ok: false, reason: `${ESCAPE_DIR}/${taskId}/events/${name} filename does not match escape_id` };
    if (event.primary_digest === primaryDigest) count += 1;
  }

  return observed ? { ok: true, count } : { ok: true, count: null };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/context-escapes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add bin/lib/types.ts bin/lib/context-escapes.ts test/context-escapes.test.ts
git commit -m "feat(context): add digest-attributed context-escape store module"
```

---

### Task 4: Emit `reason_code`, forbid expansion-of-expansion, and record escapes in `--expand-context`

**Files:**
- Modify: `bin/lib/context-expansion.ts` (`validateNeedContext` rejected shape; `runExpandContext` role guard, digest, observation, warn loop, budget paths)
- Test: `test/context-expansion.test.ts`

**Interfaces:**
- Consumes: `artifactDigest`, `recordObservation`, `recordEscapes`, `NewEscape` (Task 3); `EscapeReasonCode` (Task 3).
- Produces: `validateNeedContext` returns `rejected: Array<{ item: NeedContextRequestItem; reason_code: EscapeReasonCode; detail: string }>` (was `{ item, reason }`).

- [ ] **Step 1: Write the failing tests**

Add to `test/context-expansion.test.ts`:

```ts
test('validateNeedContext returns reason_code and detail for rejected requests', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-rc-'));
  buildFixture(target);
  const { validateNeedContext } = await import('../bin/lib/context-expansion.js');
  const { readDependencyGraph } = await import('../bin/lib/dependency-graph.js');
  const { tryReadCuratedCodeGraph } = await import('../bin/lib/context-pack.js');
  const depGraph = readDependencyGraph(target)!;
  const curatedGraph = tryReadCuratedCodeGraph(target);
  const request = { kind: 'forgeai_need_context', schema_version: 1, artifact: 'x',
    requests: [{ kind: 'file', path: 'does/not/exist.ts', reason: 'x' }] } as never;
  const { rejected } = validateNeedContext(request, depGraph, curatedGraph);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason_code, 'path_not_in_graph');
  assert.match(rejected[0].detail, /not found in dependency graph/);
});

test('--expand-context records an observation and escape files; forbids expansion-of-expansion', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-esc-cli-'));
  buildFixture(target);
  const taskId = 'TASK-20260727-esc';
  const primaryRel = `.ai/state/context/${taskId}.json`;
  runTs(cli, ['--compile-context', '--task', taskId, '--objective', 'login', '--budget', '6000', '--output', primaryRel], { cwd: target });
  const needContextPath = writeNeedContext(target, primaryRel, [{ kind: 'file', path: 'does/not/exist.ts', reason: 'need missing' }]);
  // fully rejected -> exit 1, no expansion artifact, but observation + escape recorded
  assert.throws(() => runTs(cli, ['--expand-context', '--artifact', primaryRel, '--need-context', path.relative(target, needContextPath)], { cwd: target }));
  const escBase = path.join(target, '.ai/state/context-escapes', taskId);
  assert.equal(fs.readdirSync(path.join(escBase, 'observed')).length, 1, 'one observation marker');
  const events = fs.readdirSync(path.join(escBase, 'events'));
  assert.equal(events.length, 1);
  const ev = JSON.parse(fs.readFileSync(path.join(escBase, 'events', events[0]), 'utf8'));
  assert.equal(ev.reason_code, 'path_not_in_graph');
  assert.equal(ev.primary_artifact, primaryRel);
  assert.match(ev.primary_digest, /^[0-9a-f]{64}$/);

  // Feeding an expansion artifact back in is rejected.
  const expOut = '.ai/state/context/exp.json';
  const okNeed = writeNeedContext(target, primaryRel, [{ kind: 'file', path: 'src/auth.ts', reason: 'need helper' }]);
  runTs(cli, ['--expand-context', '--artifact', primaryRel, '--need-context', path.relative(target, okNeed), '--output', expOut], { cwd: target });
  let err: unknown = null;
  try { runTs(cli, ['--expand-context', '--artifact', expOut, '--need-context', path.relative(target, okNeed)], { cwd: target }); } catch (e) { err = e; }
  assert.ok(err, 'expansion-of-expansion should exit non-zero');
});

test('--expand-context: successful expansion records only an observation (count 0)', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-esc-ok-'));
  buildFixture(target);
  const taskId = 'TASK-20260727-ok';
  const primaryRel = `.ai/state/context/${taskId}.json`;
  runTs(cli, ['--compile-context', '--task', taskId, '--objective', 'login', '--budget', '6000', '--output', primaryRel], { cwd: target });
  const okNeed = writeNeedContext(target, primaryRel, [{ kind: 'file', path: 'src/auth.ts', reason: 'need helper' }]);
  runTs(cli, ['--expand-context', '--artifact', primaryRel, '--need-context', path.relative(target, okNeed), '--output', '.ai/state/context/exp.json'], { cwd: target });
  const escBase = path.join(target, '.ai/state/context-escapes', taskId);
  assert.equal(fs.readdirSync(path.join(escBase, 'observed')).length, 1);
  assert.equal(fs.existsSync(path.join(escBase, 'events')) ? fs.readdirSync(path.join(escBase, 'events')).length : 0, 0);
});

test('--expand-context: an invalid --budget writes no observation marker', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-esc-badbudget-'));
  buildFixture(target);
  const taskId = 'TASK-20260727-bad';
  const primaryRel = `.ai/state/context/${taskId}.json`;
  runTs(cli, ['--compile-context', '--task', taskId, '--objective', 'login', '--budget', '6000', '--output', primaryRel], { cwd: target });
  const okNeed = writeNeedContext(target, primaryRel, [{ kind: 'file', path: 'src/auth.ts', reason: 'need helper' }]);
  assert.throws(() => runTs(cli, ['--expand-context', '--artifact', primaryRel, '--need-context', path.relative(target, okNeed), '--budget', '5'], { cwd: target }));
  assert.equal(fs.existsSync(path.join(target, '.ai/state/context-escapes', taskId)), false, 'no store written on usage error');
});
```

Note: the design requires the out-of-root and compile-`ContextBudgetError` paths to be tested directly. Both have dedicated CLI tests: an out-of-root case copies a valid-for-repo artifact to a sibling temp dir and passes its absolute path as `--artifact` (rejected with "inside the repository root", no store written); a `ContextBudgetError` case adds a large source node before compiling, then requests it under an explicit `--budget 256` and asserts a `budget_exceeded` escape is persisted.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/context-expansion.test.ts`
Expected: FAIL — `rejected[0].reason_code` is `undefined`; no escape/observation files; expansion-of-expansion is accepted.

- [ ] **Step 3: Change `validateNeedContext`'s rejected shape**

Also harden the pre-existing `validateNeedContextSchema`: its per-item check
(`typeof item !== 'object' || item === null`) accepts arrays, which fall through
to `unknown_kind` and get persisted as `request: []` — an event the reader
rejects (arrays are not plain objects), corrupting the store so `--evaluate`
always reports it malformed. Add `|| Array.isArray(item)` to the check so a
malformed `requests: [[]]` fails schema validation before anything is recorded.

In `bin/lib/context-expansion.ts`, add imports at the top:

```ts
import type { EscapeReasonCode } from './types.js';
import { artifactDigest, recordEscapes, recordObservation, type NewEscape } from './context-escapes.js';
```

Change the function return type:

```ts
): { valid: ResolvedContextRequest[]; rejected: Array<{ item: NeedContextRequestItem; reason_code: EscapeReasonCode; detail: string }> } {
```

Rewrite every `rejected.push({ item, reason: '…' })` to `{ item, reason_code, detail }`, preserving the existing detail strings:

| branch | reason_code | detail (unchanged text) |
|--------|-------------|--------------------------|
| file/test missing reason | `missing_reason` | `` `${item.kind} request must have a non-empty string reason` `` |
| file/test missing path | `missing_path` | `` `${item.kind} request must have a non-empty path` `` |
| ignored path | `ignored_path` | `` `path '${p}' is in an ignored directory` `` |
| path not in graph | `path_not_in_graph` | `` `path '${p}' not found in dependency graph` `` |
| symbol missing reason | `missing_reason` | `'symbol request must have a non-empty string reason'` |
| symbol missing name | `missing_name` | `'symbol request must have a non-empty name'` |
| symbol not found | `symbol_not_found` | `` `symbol '${name}' not found in dependency graph exports or public_contracts` `` |
| unknown kind | `unknown_kind` | `` `unknown request kind '${String((item as Record<string, unknown>).kind)}'` `` |

Example (path-not-in-graph branch):

```ts
      if (!depPaths.has(p)) {
        rejected.push({ item, reason_code: 'path_not_in_graph', detail: `path '${p}' not found in dependency graph` });
        continue;
      }
```

- [ ] **Step 4: Add the role guard, out-of-root guard, and a helper**

After `const primary = primaryResult.artifact;` (~line 140), reject expansion-of-expansion and any artifact outside the repository root:

```ts
  if (primary.artifact_role === 'expansion') {
    process.stderr.write('Error: --artifact must be a primary compiled-context artifact; expansion-of-expansion is not supported.\n');
    process.exitCode = 1;
    return;
  }
  // Normalize via realpath so a symlinked temp/root (e.g. macOS /var -> /private/var)
  // does not read as out-of-root; the primary file exists (validateArtifact passed).
  const realRoot = fs.realpathSync(root);
  let realArtifact: string;
  try { realArtifact = fs.realpathSync(artifactPath); } catch { realArtifact = artifactPath; }
  const parentRel = path.relative(realRoot, realArtifact).split(path.sep).join('/');
  // Reject only real traversal — a file literally named e.g. "..cache/x.json"
  // inside the repo is fine, but "..", "../…", or an absolute path is not.
  if (parentRel === '' || parentRel === '..' || parentRel.startsWith('../') || path.isAbsolute(parentRel)) {
    process.stderr.write('Error: --artifact must resolve inside the repository root.\n');
    process.exitCode = 1;
    return;
  }
```

`parentRel` is now declared once here and reused by both the observation/escape
records and the `compileContextExpansion` call — remove the duplicate `parentRel`
declaration added in Task 2 Step 5.

Add a module-level helper near the top of `context-expansion.ts` (maps a resolved
request back to its request item for whole-set escapes):

```ts
function resolvedToRequestItem(r: ResolvedContextRequest): NeedContextRequestItem {
  return r.requestKind === 'symbol'
    ? { kind: 'symbol', name: r.symbol!, reason: r.reason }
    : { kind: r.requestKind, path: r.path, reason: r.reason };
}
```

- [ ] **Step 5: Validate `--budget` syntax BEFORE observation, then record the observation**

The observation marker must not be written for an invocation that fails argument
validation. Split the existing budget block: do the syntactic `--budget`
validation up front (right after graph health is OK, before touching the escape
store), then write the observation, then resolve requests. Replace the region
from just after `curatedGraph` is loaded through the old budget block with:

```ts
  // Syntactic --budget validation first (usage error, exit 2) — no side effects yet.
  const remainingCapacity = primary.budget.limit_tokens - primary.budget.estimated_tokens;
  const budgetArg = getArgValue('--budget');
  let explicitBudget: number | null = null;
  if (budgetArg !== null) {
    const parsed = Number(budgetArg);
    if (!Number.isInteger(parsed) || parsed < MIN_BUDGET || parsed > MAX_BUDGET) {
      process.stderr.write(`Error: --budget must be between ${MIN_BUDGET} and ${MAX_BUDGET}.\n`);
      process.exitCode = 2;
      return;
    }
    explicitBudget = parsed;
  }

  // Preconditions passed: record the observation for this primary (once).
  const primaryDigest = artifactDigest(fs.readFileSync(artifactPath, 'utf8'));
  if (primary.task_id !== null) {
    recordObservation(primary.task_id, { primary_artifact: parentRel, primary_digest: primaryDigest }, root);
  }

  // Resolve requests and record per-request escapes.
  const { valid, rejected } = validateNeedContext(needContext, depGraph!, curatedGraph);
  const escapes: NewEscape[] = [];
  for (const r of rejected) {
    process.stderr.write(`${formatStatus('warn', `rejected: ${r.detail}`)}\n`);
    escapes.push({ primary_artifact: parentRel, primary_digest: primaryDigest, request: r.item, reason_code: r.reason_code, detail: r.detail });
  }
  if (primary.task_id !== null && escapes.length > 0) {
    recordEscapes(primary.task_id, escapes, root);
  }
  if (valid.length === 0) {
    process.stderr.write('Error: no requests passed validation.\n');
    process.exitCode = 1;
    return;
  }

  // Resolve the effective budget (capacity is a real escape when too small).
  let budget: number;
  if (explicitBudget !== null) {
    budget = explicitBudget;
  } else {
    if (remainingCapacity < MIN_BUDGET) {
      if (primary.task_id !== null) {
        recordEscapes(primary.task_id, valid.map((r) => ({
          primary_artifact: parentRel, primary_digest: primaryDigest, request: resolvedToRequestItem(r),
          reason_code: 'budget_exceeded' as EscapeReasonCode,
          detail: `remaining primary capacity (${remainingCapacity}) is below minimum ${MIN_BUDGET}`,
        })), root);
      }
      process.stderr.write(`Error: remaining primary capacity (${remainingCapacity}) is below minimum ${MIN_BUDGET}. Pass --budget explicitly.\n`);
      process.exitCode = 1;
      return;
    }
    budget = remainingCapacity;
  }
```

- [ ] **Step 6: Record whole-set escapes in the compile catch**

The `compileContextExpansion` catch block (~line 202) records before printing:

```ts
  } catch (error) {
    let code: EscapeReasonCode | null = null;
    if (error instanceof ContextBudgetError) code = 'budget_exceeded';
    else if (error instanceof NoNewContextError) code = 'no_new_context';
    if (code && primary.task_id !== null) {
      recordEscapes(primary.task_id, valid.map((r) => ({
        primary_artifact: parentRel, primary_digest: primaryDigest, request: resolvedToRequestItem(r),
        reason_code: code!, detail: error instanceof Error ? error.message : String(error),
      })), root);
    }
    if (error instanceof ContextBudgetError) {
      process.stderr.write(`Error: expansion budget is too small for the requested context; increase --budget.\n`);
      process.exitCode = 2;
    } else if (error instanceof NoNewContextError) {
      process.stderr.write('Error: requests produced no new context after deduplication against the primary artifact.\n');
      process.exitCode = 1;
    } else {
      process.stderr.write(`Error: expansion failed: ${getErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }
```

The `compileContextExpansion` call itself continues to pass `{ budget, parentArtifact: parentRel }` (Task 2 Step 5).

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/context-expansion.test.ts`
Expected: PASS. If other tests in the file assert the old `rejected[].reason` property, update them to `reason_code`/`detail`.

- [ ] **Step 8: Commit**

```bash
git add bin/lib/context-expansion.ts test/context-expansion.test.ts
git commit -m "feat(context): record escapes and observations; forbid expansion-of-expansion"
```

---

### Task 5: `--evaluate` resolves `context_escapes`; hard-fails on a malformed record

**Files:**
- Modify: `bin/lib/evaluation-record.ts` (`computeMetrics` signature; `BuildInput`; `buildEvaluationRecord`; `runEvaluate` gate + wiring)
- Test: `test/evaluation-record.test.ts`, `test/evaluate-command.test.ts`

**Interfaces:**
- Consumes: `artifactDigest`, `resolveEscapeCount` (Task 3).
- Produces: `computeMetrics(artifact, runs, expansionCount, escapeCount?: number | null)` — new 4th parameter defaulting to `null`; sets `metrics.context.context_escapes`. `BuildInput` gains `escapeCount: number | null`.

- [ ] **Step 1: Write the failing unit test**

Add to `test/evaluation-record.test.ts` (this file imports `computeMetrics` at the top and builds artifacts inline):

```ts
test('computeMetrics records a provided escape count and defaults to null', () => {
  const artifact = makeArtifact(); // reuse the existing artifact builder in this file
  assert.equal(computeMetrics(artifact, [], 0).context.context_escapes, null);
  assert.equal(computeMetrics(artifact, [], 0, 3).context.context_escapes, 3);
  assert.equal(computeMetrics(artifact, [], 0, 0).context.context_escapes, 0);
});
```

(If there is no `makeArtifact` helper, reuse the same inline artifact object the existing `computeMetrics` tests build, e.g. around `test/evaluation-record.test.ts:187`.)

- [ ] **Step 2: Write the failing CLI test**

Add to `test/evaluate-command.test.ts` (extend the existing passing-evaluation fixture — journal, scorecard, primary artifact, run record for a task):

```ts
test('--evaluate counts observed escapes and fails on a malformed record', () => {
  const { target, taskId } = makePassingEvaluationFixture(); // existing/extracted helper
  const primaryRel = `.ai/state/context/${taskId}.json`;
  const { artifactDigest, recordObservation, recordEscapes } = require('../bin/lib/context-escapes.js');
  const digest = artifactDigest(fs.readFileSync(path.join(target, primaryRel), 'utf8'));
  recordObservation(taskId, { primary_artifact: primaryRel, primary_digest: digest }, target);
  recordEscapes(taskId, [{ primary_artifact: primaryRel, primary_digest: digest,
    request: { kind: 'file', path: 'src/x.ts', reason: 'r' }, reason_code: 'path_not_in_graph', detail: 'd' }], target);

  runTs(cli, ['--evaluate', '--task', taskId], { cwd: target });
  const record = JSON.parse(fs.readFileSync(path.join(target, `.ai/state/evaluations/${taskId}.json`), 'utf8'));
  assert.equal(record.metrics.context.context_escapes, 1);

  // malformed event -> evaluate fails, writes no record
  fs.rmSync(path.join(target, `.ai/state/evaluations/${taskId}.json`));
  const evDir = path.join(target, '.ai/state/context-escapes', taskId, 'events');
  fs.writeFileSync(path.join(evDir, 'deadbeefdeadbeef.json'), '{ broken');
  let err: ExecError | null = null;
  try { runTs(cli, ['--evaluate', '--task', taskId], { cwd: target }); } catch (e) { err = e as ExecError; }
  assert.ok(err, 'evaluate should exit non-zero');
  assert.match(String(err!.stdout ?? '') + String(err!.stderr ?? ''), /malformed|not valid JSON|unreadable/);
  assert.equal(fs.existsSync(path.join(target, `.ai/state/evaluations/${taskId}.json`)), false);
});
```

If `require` is not available in the ESM test, use `await import(...)` in an `async` test instead. If no `makePassingEvaluationFixture` exists, factor the existing happy-path setup in this file into a helper returning `{ target, taskId }`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/evaluation-record.test.ts test/evaluate-command.test.ts`
Expected: FAIL — `computeMetrics` ignores the 4th arg; `context_escapes` stays `null`; malformed record does not fail evaluation.

- [ ] **Step 4: Extend `computeMetrics`**

In `bin/lib/evaluation-record.ts`, change the signature and the `context_escapes` line:

```ts
export function computeMetrics(
  artifact: CompiledContextArtifact | null,
  runs: RunRecord[],
  expansionCount: number,
  escapeCount: number | null = null,
): EvaluationRecord['metrics'] {
```

Replace the `context_escapes: null,` line (and its comment) with:

```ts
      // Real count resolved from the per-task escape store in runEvaluate; null
      // when there is no primary artifact or the primary was never observed.
      context_escapes: escapeCount,
```

- [ ] **Step 5: Resolve the count and gate in `runEvaluate`; thread it through**

Add the import:

```ts
import { artifactDigest, resolveEscapeCount } from './context-escapes.js';
```

In `runEvaluate`, after `artifactPath` is resolved (and before `buildEvaluationRecord`):

```ts
  // Context-escape store: hard-fail on any malformed record; otherwise resolve the
  // count attributable to the evaluated primary artifact by its content digest.
  let escapeCount: number | null = null;
  if (artifact !== null && artifactPath !== null) {
    const digest = artifactDigest(fs.readFileSync(path.join(root, artifactPath), 'utf8'));
    const resolved = resolveEscapeCount(taskId, digest, root);
    if (!resolved.ok) {
      console.log('ForgeAI evaluation');
      console.log('');
      console.log(formatStatus('invalid', `context-escape store unreadable: ${resolved.reason}`));
      console.log('');
      console.log('Result: evaluation failed. No record written.');
      process.exitCode = 1;
      return;
    }
    escapeCount = resolved.count;
  }
```

Extend `BuildInput` with `escapeCount: number | null;`, pass `escapeCount` in the `buildEvaluationRecord({ … })` call in `runEvaluate`, and forward it in `buildEvaluationRecord`'s `metrics` construction:

```ts
    metrics: computeMetrics(input.artifact, input.runs, input.expansionCount, input.escapeCount),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/evaluation-record.test.ts test/evaluate-command.test.ts`
Expected: PASS. Existing 3-arg `computeMetrics` calls still yield `context_escapes: null` (default), so the assertion at `test/evaluation-record.test.ts:204` still holds.

- [ ] **Step 7: Commit**

```bash
git add bin/lib/evaluation-record.ts test/evaluation-record.test.ts test/evaluate-command.test.ts
git commit -m "feat(eval): resolve real context_escapes; fail on a malformed escape record"
```

---

### Task 6: Gitignore and upgrade preservation for the escape store

**Files:**
- Modify: `bin/lib/init.ts` (`isPreservedOnUpgrade` ~line 218; `CONTEXT_GITIGNORE_ENTRIES` ~line 275)
- Test: `test/upgrade.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/upgrade.test.ts` (follow the file's existing pattern for preserved paths + gitignore entries):

```ts
test('context-escape records are gitignored and preserved on --upgrade', async () => {
  const { isPreservedOnUpgrade } = await import('../bin/lib/init.js');
  const abs = path.join(process.cwd(), '.ai/state/context-escapes/TASK-20260727-esc/events/deadbeefdeadbeef.json');
  assert.equal(isPreservedOnUpgrade(abs), true);
});
```

Plus an end-to-end assertion mirroring the existing evaluations gitignore test: after init/upgrade, `.gitignore` contains `.ai/state/context-escapes/`. Reuse the helper the existing evaluations-gitignore test uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/upgrade.test.ts`
Expected: FAIL — `isPreservedOnUpgrade` returns `false`; `.gitignore` lacks the entry.

- [ ] **Step 3: Add the gitignore entry**

In `bin/lib/init.ts`, extend `CONTEXT_GITIGNORE_ENTRIES` (~line 275):

```ts
const CONTEXT_GITIGNORE_ENTRIES = ['.ai/state/context/', '.ai/state/context-routes.md', '.ai/state/runs/', '.ai/state/evaluations/', '.ai/state/context-escapes/'];
```

- [ ] **Step 4: Add the preserve rule**

In `isPreservedOnUpgrade` (~line 218), after the evaluations block (the `.+` spans the nested `<task_id>/events|observed/<name>.json`):

```ts
  if (/^\.ai\/state\/context-escapes\/.+\.json$/.test(relative)) {
    return true;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/upgrade.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add bin/lib/init.ts test/upgrade.test.ts
git commit -m "feat(init): gitignore and preserve the context-escape store on upgrade"
```

---

### Task 7: Release — consolidate all of Phase 13 into a single 3.9.0

3.8.0 was the last published release. Phase 13 (13A+13B+13C) therefore ships as
a **single unreleased 3.9.0**. This task folds all three slices into that one
release.

**Files:**
- Modify: `package.json`, `package-lock.json` (version → `3.9.0`)
- Modify: the single consolidated `docs/migrations/3.9.0.md`
- Modify: `README.md`, `CHANGELOG.md`, `ROADMAP.md`

- [ ] **Step 1: Set the version to `3.9.0`**

In `package.json`, set `"version": "3.9.0"`. In `package-lock.json`, set both the
top-level `"version"` and `packages[""].version` to `3.9.0`.

- [ ] **Step 2: Consolidate the migration guide**

Remove any obsolete separate Phase 13B migration guide, then rewrite
`docs/migrations/3.9.0.md` so it covers all of Phase 13 — 13A (structured evaluation), 13B (context
experiments), and 13C (`parent_artifact`, the `.ai/state/context-escapes/<task_id>/`
store, the real `context_escapes` metric, and the expansion-of-expansion /
out-of-root rejections) — as one additive `schema_version: 1` release preserved
on `--upgrade`.

- [ ] **Step 3: Add the README `### Context escapes` section**

In `README.md`, near the `--evaluate` docs, replace the stale
"`context_escapes` is reported as `null` in this release (not yet measured)" note
with a section describing the store layout and the `null` / `0` / `N` (distinct
declined needs) semantics, malformed-store failure, and gitignore/upgrade.

- [ ] **Step 4: Merge the CHANGELOG into one `## 3.9.0`**

Consolidate the separate 13A and 13B release notes into a single `## 3.9.0`
section whose Added block lists 13A + 13B + 13C, a Changed
block (soft-deprecated `--check-evaluation`; `--expand-context` rejects
expansion-of-expansion and out-of-root artifacts), and a Migration note. Remove
any duplicate Phase 13 version heading.

- [ ] **Step 5: Update the ROADMAP**

In `ROADMAP.md`, replace the separate 13A/13B release paragraphs with one
"Phase 13 (A/B/C) shipped in 3.9.0" block; the
deferred list holds only model-tier routing recommendations and a `--outcome`
manual override.

- [ ] **Step 6: Verify the full suite is green**

Run: `npm test`
Expected: typecheck, build, and all tests PASS. Confirm all Phase 13 release
metadata points to the single `3.9.0` release.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json docs/migrations/ README.md CHANGELOG.md ROADMAP.md
git commit -m "docs: consolidate Phase 13 (13A/B/C) into a single 3.9.0 release"
```

---

## Self-Review Notes

- **Spec coverage:** parent_artifact type/normalization (Task 1) + stamping/render (Task 2); escape store module with digest, observation markers, dedup, and full per-file validation (Task 3); reason_code refactor, forbid-chain guard, observation + escape recording incl. full-rejection, low-capacity early return, and budget/no-new-context (Task 4); evaluate digest resolution + null/0/N semantics + malformed-fail (Task 5); gitignore/preserve (Task 6); full release incl. version bump, migration, README, CHANGELOG, ROADMAP (Task 7). Every spec section maps to a task.
- **Review findings addressed (round 1):** F1 (0-vs-unmeasured → observation markers; path staleness → primary digest), F2 (forbid expansion-of-expansion), F3 (full per-event schema validation incl. recomputed escape_id), F4 (valid `TASK-YYYYMMDD-slug` ids in tests), F5 (low-capacity early return records `budget_exceeded`), F6 (event-per-file eliminates lost updates), F8 (release completeness).
- **Review findings addressed (round 2):** malformed-request escapes validate via plain-object + recomputed `escape_id`, not a full union (so `missing_reason`/`missing_path`/`missing_name`/`unknown_kind` events are not self-rejected); `escape_id` measures **distinct declined needs** and docs say so; observation is written only after syntactic `--budget` validation; `--artifact` outside root is rejected; `resolveEscapeCount` catches filesystem-structure errors; tests table-cover all reason codes plus successful→`0`, invalid-budget→no-observation, and FS-structure failure.
- **Estimate ripple:** `parent_artifact` is inside the artifact and `stableArtifactEstimate` serializes the whole artifact, so `estimated_tokens` shifts slightly; Task 2 Step 7 updates any exact-estimate assertions.
- **Back-compat:** `computeMetrics`' 4th arg defaults to `null`; `checkArtifactStructure`/`validateArtifact`/`findArtifactsForTask` read a missing `parent_artifact` as `null`; no escape dir / unobserved digest ⇒ `null`. The existing `evaluation-record.test.ts:204` assertion stays valid.
- **Type consistency:** `artifactDigest`, `escapeId`, `taskEscapeDir`, `recordObservation`, `recordEscapes`, `resolveEscapeCount`, `NewEscape`, `ResolveResult`, `EscapeReasonCode`, `ContextEscapeEvent`, `ContextEscapeObservation` are used with identical names/signatures across Tasks 3–5.
- **Version:** Phase 13 (A/B/C) consolidates into a single unreleased `3.9.0`
  (Task 7); no additional Phase 13 version is created.
