# Phase 11 — Enforced Context Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--validate-artifact`, `--route`, and `--expand-context` commands that enforce compiled context as the verified input for CLI adapter calls and provide a validated need_context expansion protocol.

**Architecture:** Three new modules (`router.ts`, `context-expansion.ts`) and two extended existing modules (`context-compiler.ts`, `context-pack.ts`) are wired into the existing CLI dispatch. Artifact validation is shared across all three commands. Expansion uses kind-aware forced inclusion with a mode-aware dominance rule against the primary artifact.

**Tech Stack:** Node.js ESM TypeScript, `node:child_process` (spawnSync), existing test helper (`runTs`/`cli` from `test/helpers.ts`).

## Global Constraints

- All new source files are ESM TypeScript (`import`/`export`, `.js` extensions in imports).
- All status, warning, and error output goes to `process.stderr`; artifact JSON goes to `process.stdout` only.
- No context artifact file is created without an explicit `--output` flag.
- `validateArtifact()` is called as the first step of both `--route` and `--expand-context`.
- `computeArtifactEstimate()` must be pure — it must not mutate its input.
- Phase 11 supports only `input: 'stdin'` adapters; `input: 'argv'` exits 1.
- Adapter config is read from `.ai/cli-adapters.json` (constant `ADAPTERS_RELATIVE` from `model-routing.ts`) as a read-only operation; do not call `loadAdaptersForWrite()`.
- Journal file is `.ai/state/context-routes.md`; append-only; control characters in user strings are replaced with a space before writing.
- `budget.limit_tokens`: integer 256–200 000; `selection.max_depth`: integer 0–5; `selection.max_nodes`: integer 1–50.
- Run `npm test` (typecheck + build + node tests) after every task to confirm nothing breaks.
- Version target: `3.3.0`.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `bin/lib/types.ts` | Modify | Add `NeedContextRequestItem`, `NeedContextArtifact`, `ArtifactValidationResult`, `ResolvedContextRequest` |
| `bin/lib/context-pack.ts` | Modify | Export `tokenizeObjective()` (rename private `tokenize`) |
| `bin/lib/context-compiler.ts` | Modify | Export pure `computeArtifactEstimate()`; add `compileContextExpansion()` |
| `bin/lib/router.ts` | Create | `validateArtifact`, `resolvePlaceholders`, `routeToAdapter`, `runValidateArtifact`, `runRoute` |
| `bin/lib/context-expansion.ts` | Create | `validateNeedContext`, `runExpandContext` |
| `bin/lib/context.ts` | Modify | Export `validateArtifact`, `route`, `expandContext` flags |
| `bin/lib/init.ts` | Modify | Add three commands to help text; gitignore maintenance |
| `bin/forgeai-init.ts` | Modify | Wire three new commands |
| `test/context-routing.test.ts` | Create | Tests for `--validate-artifact` and `--route` |
| `test/context-expansion.test.ts` | Create | Tests for `--expand-context` |
| `test/upgrade.test.ts` | Extend | Gitignore maintenance tests |
| `test/lifecycle.test.ts` | Extend | Help text contains three new command names |
| `test/dist.test.ts` | Extend | New CLI flags in compiled dist |
| `test/context-compiler.test.ts` | Extend | `computeArtifactEstimate` purity test |
| `package.json` | Modify | Version bump to 3.3.0 |
| `package-lock.json` | Modify | Sync version |
| `README.md` | Modify | Document three new commands |
| `docs/migrations/3.3.0.md` | Create | Migration note |
| `CHANGELOG.md` | Modify | 3.3.0 entry |

---

## Task 1: Shared types, pure token estimator, and tokenizeObjective export

**Files:**
- Modify: `bin/lib/types.ts`
- Modify: `bin/lib/context-pack.ts`
- Modify: `bin/lib/context-compiler.ts`
- Extend: `test/context-compiler.test.ts`

**Interfaces:**
- Produces:
  - `NeedContextRequestItem`, `NeedContextArtifact`, `ArtifactValidationResult`, `ResolvedContextRequest` from `types.ts`
  - `tokenizeObjective(objective: string): string[]` from `context-pack.ts`
  - `computeArtifactEstimate(artifact: CompiledContextArtifact): number` from `context-compiler.ts` — pure, no mutation

---

- [ ] **Step 1.1: Write a failing test for `computeArtifactEstimate` purity**

Add to `test/context-compiler.test.ts`:

```typescript
import { computeArtifactEstimate } from '../bin/lib/context-compiler.js';

test('computeArtifactEstimate does not mutate input artifact', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-estimate-pure-'));
  try {
    initializeFixture(target);
    const result = runCompile(target, ['--objective', 'change runCli implementation', '--budget', '4000']);
    assert.equal(result.failed, false);
    const artifact = JSON.parse(result.output) as CompiledContextArtifact;
    const declared = artifact.budget.estimated_tokens;
    const recomputed = computeArtifactEstimate(artifact);
    // Input must not have been mutated
    assert.equal(artifact.budget.estimated_tokens, declared, 'computeArtifactEstimate must not mutate input');
    // Result must be consistent with declared (valid artifact)
    assert.equal(recomputed, declared);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 1.2: Run test to confirm it fails**

```bash
npm run typecheck && node --import tsx --test test/context-compiler.test.ts
```
Expected: error — `computeArtifactEstimate` is not exported.

- [ ] **Step 1.3: Add types to `bin/lib/types.ts`**

Append to the end of the file:

```typescript
export type NeedContextRequestItem =
  | { kind: 'symbol'; name: string; reason: string }
  | { kind: 'file';   path: string; reason: string }
  | { kind: 'test';   path: string; reason: string };

export type NeedContextArtifact = {
  kind: 'forgeai_need_context';
  schema_version: 1;
  artifact: string;
  requests: NeedContextRequestItem[];
};

export type ArtifactValidationResult =
  | { status: 'ok';      artifact: CompiledContextArtifact }
  | { status: 'invalid'; detail: string }
  | { status: 'stale';   detail: string };

export type ResolvedContextRequest = {
  requestKind: 'symbol' | 'file' | 'test';
  path: string;
  symbol?: string;
  reason: string;
};
```

- [ ] **Step 1.4: Export `tokenizeObjective` from `bin/lib/context-pack.ts`**

Change line 55 from:
```typescript
function tokenize(value: string): string[] {
```
to:
```typescript
export function tokenizeObjective(value: string): string[] {
```

Then update the one internal call site (inside `selectContextForObjective`) from `tokenize(` to `tokenizeObjective(`.

- [ ] **Step 1.5: Add pure `computeArtifactEstimate` to `bin/lib/context-compiler.ts`**

After the existing `stableArtifactEstimate` function (line ~143), add the new export:

```typescript
export function computeArtifactEstimate(artifact: CompiledContextArtifact): number {
  const clone = JSON.parse(JSON.stringify(artifact)) as CompiledContextArtifact;
  let estimate = clone.budget.estimated_tokens;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    clone.budget.estimated_tokens = estimate;
    const next = estimateTokens(`${JSON.stringify(clone, null, 2)}\n`);
    if (next === estimate) return next;
    estimate = next;
  }
  clone.budget.estimated_tokens = estimate;
  return estimateTokens(`${JSON.stringify(clone, null, 2)}\n`);
}
```

Replace all internal calls to `stableArtifactEstimate(artifact)` in `context-compiler.ts` with the pattern:
```typescript
artifact.budget.estimated_tokens = computeArtifactEstimate(artifact);
```
except inside `tryExcerpt` where the rollback still needs the old behavior — keep `stableArtifactEstimate` as a private function or inline the pattern there.

> Note: `stableArtifactEstimate` can remain private for the `tryExcerpt` rollback path; `computeArtifactEstimate` is the public pure export.

- [ ] **Step 1.6: Run tests to confirm they pass**

```bash
npm test
```
Expected: all tests pass, including the new purity test.

- [ ] **Step 1.7: Commit**

```bash
git add bin/lib/types.ts bin/lib/context-pack.ts bin/lib/context-compiler.ts test/context-compiler.test.ts
git commit -m "feat(phase-11): add shared types, pure computeArtifactEstimate, tokenizeObjective export"
```

---

## Task 2: Artifact validator and `--validate-artifact` CLI

**Files:**
- Create: `bin/lib/router.ts`
- Modify: `bin/lib/context.ts`
- Modify: `bin/forgeai-init.ts`
- Create: `test/context-routing.test.ts`

**Interfaces:**
- Consumes: `ArtifactValidationResult`, `CompiledContextArtifact` from `types.ts`; `computeArtifactEstimate` from `context-compiler.ts`; `checkDependencyGraphHealth`, `readDependencyGraph` from `dependency-graph.ts`
- Produces: `validateArtifact(artifactPath: string, repositoryRoot: string): ArtifactValidationResult`; `runValidateArtifact(): void`

---

- [ ] **Step 2.1: Write failing tests for `--validate-artifact`**

Create `test/context-routing.test.ts`:

```typescript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompiledContextArtifact } from '../bin/lib/types.js';
import { cli, type ExecError, runTs } from './helpers.js';

function initAndCompile(target: string, objective = 'change runCli implementation'): CompiledContextArtifact {
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.writeFileSync(path.join(target, 'src', 'entry.ts'), 'export function runCli() { return 42; }\n');
  runTs(cli, [], { cwd: target });
  runTs(cli, ['--refresh-codegraph'], { cwd: target });
  const json = runTs(cli, ['--compile-context', '--objective', objective, '--budget', '4000'], { cwd: target });
  return JSON.parse(json) as CompiledContextArtifact;
}

function writeArtifact(target: string, artifact: CompiledContextArtifact): string {
  const dir = path.join(target, '.ai', 'state', 'context');
  fs.mkdirSync(dir, { recursive: true });
  const artifactPath = path.join(dir, 'TASK-01.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');
  return artifactPath;
}

test('--validate-artifact exits 0 for a fresh valid artifact', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const output = runTs(cli, ['--validate-artifact', '--artifact', artifactPath], { cwd: target });
    assert.match(output, /ok/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--validate-artifact exits 1 for wrong kind', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-kind-'));
  try {
    const artifact = initAndCompile(target);
    (artifact as Record<string, unknown>).kind = 'wrong';
    const artifactPath = writeArtifact(target, artifact);
    let threw = false;
    try {
      runTs(cli, ['--validate-artifact', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'expected non-zero exit');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--validate-artifact exits 1 for out-of-bounds limit_tokens', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-bounds-'));
  try {
    const artifact = initAndCompile(target);
    artifact.budget.limit_tokens = 10_000_000;
    // Recompute estimated_tokens so only bounds check fails
    const { computeArtifactEstimate } = await import('../bin/lib/context-compiler.js');
    artifact.budget.estimated_tokens = computeArtifactEstimate(artifact);
    const artifactPath = writeArtifact(target, artifact);
    let threw = false;
    try {
      runTs(cli, ['--validate-artifact', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--validate-artifact exits 1 for stale artifact (fingerprint mismatch)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-stale-'));
  try {
    const artifact = initAndCompile(target);
    // Add a new source file to change fingerprint, then refresh graph
    fs.writeFileSync(path.join(target, 'src', 'new.ts'), 'export const x = 1;\n');
    runTs(cli, ['--refresh-codegraph'], { cwd: target });
    // Artifact still has old fingerprint
    const artifactPath = writeArtifact(target, artifact);
    let threw = false;
    try {
      runTs(cli, ['--validate-artifact', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2.2: Run tests to confirm they fail**

```bash
node --import tsx --test test/context-routing.test.ts
```
Expected: all fail — `--validate-artifact` is not yet wired.

- [ ] **Step 2.3: Create `bin/lib/router.ts` with `validateArtifact`**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { ArtifactValidationResult, CompiledContextArtifact } from './types.js';
import { computeArtifactEstimate, estimateTokens } from './context-compiler.js';
import { checkDependencyGraphHealth, readDependencyGraph } from './dependency-graph.js';
import { formatStatus, getErrorMessage } from './utils.js';
import { root, getArgValue } from './context.js';

const MIN_BUDGET = 256;
const MAX_BUDGET = 200_000;
const MAX_DEPTH = 5;
const MAX_NODES = 50;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function checkStructure(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'artifact is not an object';
  const a = raw as Record<string, unknown>;
  if (a.kind !== 'forgeai_compiled_context') return `kind must be 'forgeai_compiled_context', got '${String(a.kind)}'`;
  if (a.schema_version !== 1) return `schema_version must be 1, got ${String(a.schema_version)}`;
  if (typeof a.objective !== 'string' || a.objective.length === 0) return 'objective must be a non-empty string';
  const repo = a.repository as Record<string, unknown> | undefined;
  if (!repo || typeof repo.fingerprint !== 'string' || repo.fingerprint.length === 0) return 'repository.fingerprint must be a non-empty string';
  if (!repo || !('revision' in repo) || (repo.revision !== null && typeof repo.revision !== 'string')) return 'repository.revision must be string or null';
  const budget = a.budget as Record<string, unknown> | undefined;
  if (!budget) return 'budget is required';
  if (!isPositiveInteger(budget.limit_tokens)) return 'budget.limit_tokens must be a positive integer';
  if (budget.limit_tokens < MIN_BUDGET || (budget.limit_tokens as number) > MAX_BUDGET) return `budget.limit_tokens must be between ${MIN_BUDGET} and ${MAX_BUDGET}`;
  if (!isNonNegativeInteger(budget.estimated_tokens)) return 'budget.estimated_tokens must be a non-negative integer';
  if (budget.estimator !== 'characters_divided_by_4') return "budget.estimator must be 'characters_divided_by_4'";
  if (typeof budget.exhausted !== 'boolean') return 'budget.exhausted must be a boolean';
  const sel = a.selection as Record<string, unknown> | undefined;
  if (!sel) return 'selection is required';
  if (!isNonNegativeInteger(sel.max_depth) || (sel.max_depth as number) > MAX_DEPTH) return `selection.max_depth must be an integer 0–${MAX_DEPTH}`;
  if (!isPositiveInteger(sel.max_nodes) || (sel.max_nodes as number) > MAX_NODES) return `selection.max_nodes must be an integer 1–${MAX_NODES}`;
  if (!Array.isArray(sel.files)) return 'selection.files must be an array';
  for (const file of sel.files as unknown[]) {
    if (typeof file !== 'object' || file === null) return 'selection.files items must be objects';
    const f = file as Record<string, unknown>;
    if (typeof f.path !== 'string' || f.path.length === 0) return 'selection.files[].path must be a non-empty string';
    if (!isNonNegativeInteger(f.depth)) return 'selection.files[].depth must be a non-negative integer';
    if (typeof f.reason !== 'string' || f.reason.length === 0) return 'selection.files[].reason must be a non-empty string';
    if (typeof f.graph_path !== 'string') return 'selection.files[].graph_path must be a string';
  }
  if (!Array.isArray(a.excerpts)) return 'excerpts must be an array';
  const validExcerptKinds = new Set(['import', 'function', 'class', 'interface', 'type', 'enum', 'variable', 'test']);
  const selectionPaths = new Set((sel.files as Array<{ path: string }>).map((f) => f.path));
  for (const exc of a.excerpts as unknown[]) {
    if (typeof exc !== 'object' || exc === null) return 'excerpts items must be objects';
    const e = exc as Record<string, unknown>;
    if (typeof e.path !== 'string' || e.path.length === 0) return 'excerpts[].path must be a non-empty string';
    if (!validExcerptKinds.has(e.kind as string)) return `excerpts[].kind must be one of: ${Array.from(validExcerptKinds).join(', ')}`;
    if (typeof e.name !== 'string') return 'excerpts[].name must be a string';
    if (typeof e.reason !== 'string') return 'excerpts[].reason must be a string';
    if (!isPositiveInteger(e.source_start_line)) return 'excerpts[].source_start_line must be a positive integer';
    if (!isPositiveInteger(e.source_end_line) || (e.source_end_line as number) < (e.source_start_line as number)) return 'excerpts[].source_end_line must be a positive integer >= source_start_line';
    if (e.mode !== 'full' && e.mode !== 'signature') return "excerpts[].mode must be 'full' or 'signature'";
    if (typeof e.content !== 'string') return 'excerpts[].content must be a string';
    if (!selectionPaths.has(e.path as string)) return `excerpts[].path '${String(e.path)}' does not appear in selection.files`;
  }
  if (!Array.isArray(a.rules)) return 'rules must be an array';
  for (const rule of a.rules as unknown[]) {
    if (typeof rule !== 'object' || rule === null) return 'rules items must be objects';
    const r = rule as Record<string, unknown>;
    if (r.path !== '.ai/RULES.md') return "rules[].path must be '.ai/RULES.md'";
    if (typeof r.heading !== 'string') return 'rules[].heading must be a string';
    if (typeof r.reason !== 'string') return 'rules[].reason must be a string';
    if (!isPositiveInteger(r.source_start_line)) return 'rules[].source_start_line must be a positive integer';
    if (!isPositiveInteger(r.source_end_line) || (r.source_end_line as number) < (r.source_start_line as number)) return 'rules[].source_end_line must be >= source_start_line';
    if (typeof r.content !== 'string') return 'rules[].content must be a string';
  }
  if (!Array.isArray(a.contracts) || (a.contracts as unknown[]).some((c) => typeof c !== 'string')) return 'contracts must be an array of strings';
  if (!Array.isArray(a.entrypoints) || (a.entrypoints as unknown[]).some((e) => typeof e !== 'string')) return 'entrypoints must be an array of strings';
  if (!isNonNegativeInteger(a.omitted_candidates)) return 'omitted_candidates must be a non-negative integer';
  if (typeof a.diagnostics !== 'object' || a.diagnostics === null) return 'diagnostics must be an object';
  return null;
}

export function validateArtifact(artifactPath: string, repositoryRoot: string): ArtifactValidationResult {
  // Parse
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  } catch (error) {
    return { status: 'invalid', detail: `cannot parse artifact: ${getErrorMessage(error)}` };
  }

  // Structural check
  const structureError = checkStructure(raw);
  if (structureError) return { status: 'invalid', detail: structureError };
  const artifact = raw as CompiledContextArtifact;

  // Dependency graph health (stage 1)
  const depGraph = readDependencyGraph(repositoryRoot);
  const health = checkDependencyGraphHealth(repositoryRoot, depGraph);
  if (health.status !== 'ok') return { status: 'invalid', detail: `dependency graph is ${health.status}: ${health.detail}` };

  // Fingerprint comparison (stage 2)
  if (artifact.repository.fingerprint !== depGraph!.repository.fingerprint) {
    return { status: 'stale', detail: 'artifact fingerprint does not match dependency graph; run --compile-context again' };
  }

  // Selection path membership
  const depPaths = new Set(depGraph!.nodes.map((n) => n.path));
  for (const file of artifact.selection.files) {
    if (!depPaths.has(file.path)) return { status: 'invalid', detail: `selection.files path '${file.path}' not in dependency graph` };
  }
  for (const exc of artifact.excerpts) {
    if (!depPaths.has(exc.path)) return { status: 'invalid', detail: `excerpts path '${exc.path}' not in dependency graph` };
  }

  // Token estimate check (pure)
  const declared = artifact.budget.estimated_tokens;
  const recomputed = computeArtifactEstimate(artifact);
  if (declared !== recomputed) return { status: 'invalid', detail: `declared estimated_tokens ${declared} does not match recomputed ${recomputed}` };

  // Budget check
  if (artifact.budget.estimated_tokens > artifact.budget.limit_tokens) {
    return { status: 'invalid', detail: `estimated_tokens ${artifact.budget.estimated_tokens} exceeds limit_tokens ${artifact.budget.limit_tokens}` };
  }

  return { status: 'ok', artifact };
}

export function runValidateArtifact(): void {
  const artifactArg = getArgValue('--artifact');
  if (!artifactArg) {
    process.stderr.write('Usage: forgeai-init --validate-artifact --artifact <path>\n');
    process.exitCode = 2;
    return;
  }
  const artifactPath = path.resolve(root, artifactArg);
  const result = validateArtifact(artifactPath, root);
  if (result.status !== 'ok') {
    process.stderr.write(`Error: ${result.detail}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`${formatStatus('ok', `artifact is valid (estimated ${result.artifact.budget.estimated_tokens}/${result.artifact.budget.limit_tokens} tokens)`)}\n`);
}
```

- [ ] **Step 2.4: Wire `--validate-artifact` in `bin/lib/context.ts` and `bin/forgeai-init.ts`**

Add to `bin/lib/context.ts`:
```typescript
export const validateArtifact = args.has('--validate-artifact');
export const route = args.has('--route');
export const expandContext = args.has('--expand-context');
```

Add to `bin/forgeai-init.ts` imports:
```typescript
import { validateArtifact, route, expandContext } from './lib/context.js';
import { runValidateArtifact } from './lib/router.js';
```

Add to the dispatch chain in `bin/forgeai-init.ts` (before `runInit()`):
```typescript
else if (validateArtifact) runValidateArtifact();
```

- [ ] **Step 2.5: Run tests to confirm they pass**

```bash
npm test
```
Expected: all tests pass including the four new `--validate-artifact` tests.

- [ ] **Step 2.6: Commit**

```bash
git add bin/lib/types.ts bin/lib/router.ts bin/lib/context.ts bin/forgeai-init.ts test/context-routing.test.ts
git commit -m "feat(phase-11): add validateArtifact and --validate-artifact CLI"
```

---

## Task 3: Adapter routing, journal recording, and `--route` CLI

**Files:**
- Modify: `bin/lib/router.ts` (add `resolvePlaceholders`, `routeToAdapter`, `runRoute`)
- Modify: `bin/forgeai-init.ts`
- Extend: `test/context-routing.test.ts`

**Interfaces:**
- Consumes: `validateArtifact` (Task 2); `ADAPTERS_RELATIVE` from `model-routing.ts`; `AdapterConfig` from `types.ts`
- Produces:
  - `resolvePlaceholders(args: string[], ctx: { model?: string; assignment: string; tokenBudget: number }): { resolved: string[]; unresolved: string[] }`
  - `routeToAdapter(artifact, artifactPath, adapterName, model, repositoryRoot): void`
  - `runRoute(): void`

---

- [ ] **Step 3.1: Write failing tests for `--route`**

Add to `test/context-routing.test.ts`:

```typescript
test('--route without --adapter writes JSON to stdout', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-stdout-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const output = runTs(cli, ['--route', '--artifact', artifactPath], { cwd: target });
    const routed = JSON.parse(output) as CompiledContextArtifact;
    assert.equal(routed.kind, 'forgeai_compiled_context');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--route writes journal entry on stdout routing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-journal-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    runTs(cli, ['--route', '--artifact', artifactPath], { cwd: target });
    const journalPath = path.join(target, '.ai', 'state', 'context-routes.md');
    assert.ok(fs.existsSync(journalPath), 'journal file should be created');
    const journal = fs.readFileSync(journalPath, 'utf8');
    assert.match(journal, /Status: ok/);
    assert.match(journal, /Adapter: stdout/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--route exits 1 for invalid artifact before any adapter is invoked', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-invalid-'));
  try {
    const artifact = initAndCompile(target);
    (artifact as Record<string, unknown>).kind = 'bad';
    const artifactPath = writeArtifact(target, artifact);
    let threw = false;
    try {
      runTs(cli, ['--route', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw);
    // Journal should NOT be written (rejected before routing)
    assert.ok(!fs.existsSync(path.join(target, '.ai', 'state', 'context-routes.md')));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3.2: Run tests to confirm they fail**

```bash
node --import tsx --test test/context-routing.test.ts
```
Expected: new tests fail — `--route` not wired.

- [ ] **Step 3.3: Add `resolvePlaceholders`, `routeToAdapter`, `runRoute` to `bin/lib/router.ts`**

Add imports at top of router.ts:
```typescript
import { spawnSync } from 'node:child_process';
import type { AdapterConfig } from './types.js';
import { ADAPTERS_RELATIVE } from './model-routing.js';
```

Add these functions:

```typescript
function sanitizeForJournal(value: string): string {
  return value.replace(/[\x00-\x1F]/g, ' ');
}

export function resolvePlaceholders(
  args: string[],
  ctx: { model?: string; assignment: string; tokenBudget: number }
): { resolved: string[]; unresolved: string[] } {
  const map: Record<string, string | undefined> = {
    '{model}': ctx.model,
    '{assignment}': ctx.assignment,
    '{token_budget}': String(ctx.tokenBudget)
  };
  const unresolved: string[] = [];
  const resolved = args.map((arg) =>
    arg.replace(/\{[^}]+\}/g, (placeholder) => {
      if (placeholder in map) {
        if (map[placeholder] === undefined) {
          unresolved.push(placeholder);
          return placeholder;
        }
        return map[placeholder]!;
      }
      unresolved.push(placeholder);
      return placeholder;
    })
  );
  return { resolved, unresolved };
}

function appendJournal(entry: string, repositoryRoot: string): void {
  const journalPath = path.join(repositoryRoot, '.ai', 'state', 'context-routes.md');
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.appendFileSync(journalPath, entry);
}

function buildJournalEntry(
  artifact: CompiledContextArtifact,
  artifactPath: string,
  adapterLabel: string,
  model: string | null,
  status: string
): string {
  const timestamp = new Date().toISOString();
  const lines = [
    `## ${sanitizeForJournal(timestamp)} — ${sanitizeForJournal(artifactPath)}`,
    '',
    `- Objective: ${sanitizeForJournal(artifact.objective)}`,
    `- Repository fingerprint: ${sanitizeForJournal(artifact.repository.fingerprint)}`,
    `- Estimated tokens: ${artifact.budget.estimated_tokens}/${artifact.budget.limit_tokens}`,
    `- Files included: ${artifact.selection.files.length}`,
    `- Omitted candidates: ${artifact.omitted_candidates}`,
    `- Adapter: ${sanitizeForJournal(adapterLabel)}`,
    ...(model ? [`- Model: ${sanitizeForJournal(model)}`] : []),
    `- Status: ${sanitizeForJournal(status)}`,
    '',
    ''
  ];
  return lines.join('\n');
}

export function routeToAdapter(
  artifact: CompiledContextArtifact,
  artifactPath: string,
  adapterName: string | null,
  model: string | null,
  repositoryRoot: string
): void {
  const json = `${JSON.stringify(artifact, null, 2)}\n`;

  if (!adapterName) {
    process.stdout.write(json);
    appendJournal(buildJournalEntry(artifact, artifactPath, 'stdout', model, 'ok'), repositoryRoot);
    return;
  }

  const configPath = path.join(repositoryRoot, ADAPTERS_RELATIVE);
  if (!fs.existsSync(configPath)) {
    process.stderr.write(`Error: ${ADAPTERS_RELATIVE} not found. Run forgeai-init first.\n`);
    process.exitCode = 1;
    return;
  }
  let config: AdapterConfig;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as AdapterConfig;
  } catch (error) {
    process.stderr.write(`Error: invalid ${ADAPTERS_RELATIVE}: ${getErrorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }
  const adapter = config.adapters?.[adapterName];
  if (!adapter) {
    process.stderr.write(`Error: adapter '${adapterName}' not found in ${ADAPTERS_RELATIVE}.\n`);
    process.exitCode = 1;
    return;
  }
  if (!adapter.command) {
    process.stderr.write(`Error: adapter '${adapterName}' has no command configured.\n`);
    process.exitCode = 1;
    return;
  }
  if (adapter.input === 'argv') {
    process.stderr.write('Error: argv adapters cannot deliver compiled context in Phase 11.\nUse a stdin adapter (claude, codex, agy) or pipe to stdout with --adapter omitted.\n');
    process.exitCode = 1;
    return;
  }
  if (adapter.input !== 'stdin') {
    process.stderr.write(`Error: adapter input mode '${String(adapter.input)}' is not supported.\n`);
    process.exitCode = 1;
    return;
  }
  // Validate args and healthcheck config
  const adapterArgs = adapter.args ?? [];
  if (!Array.isArray(adapterArgs) || adapterArgs.some((a) => typeof a !== 'string')) {
    process.stderr.write(`Error: adapter '${adapterName}' args must be an array of strings.\n`);
    process.exitCode = 1;
    return;
  }
  if (adapter.healthcheck) {
    const hcArgs = adapter.healthcheck.args;
    if (hcArgs !== undefined && (!Array.isArray(hcArgs) || hcArgs.some((a) => typeof a !== 'string'))) {
      process.stderr.write(`Error: adapter '${adapterName}' healthcheck.args must be an array of strings.\n`);
      process.exitCode = 1;
      return;
    }
    const hcTimeout = adapter.healthcheck.timeout_ms;
    if (hcTimeout !== undefined && (!Number.isInteger(hcTimeout) || hcTimeout <= 0)) {
      process.stderr.write(`Error: adapter '${adapterName}' healthcheck.timeout_ms must be a positive integer.\n`);
      process.exitCode = 1;
      return;
    }
    // Run healthcheck
    const hcResult = spawnSync(adapter.command, hcArgs ?? [], { timeout: hcTimeout ?? undefined, encoding: 'utf8' });
    if (hcResult.error || hcResult.status !== 0) {
      process.stderr.write(`Error: healthcheck for '${adapterName}' failed.\n`);
      process.exitCode = 1;
      return;
    }
  }
  // Resolve placeholders
  const { resolved, unresolved } = resolvePlaceholders(adapterArgs as string[], {
    model: model ?? undefined,
    assignment: artifact.objective,
    tokenBudget: artifact.budget.limit_tokens
  });
  if (unresolved.length > 0) {
    process.stderr.write(`Error: unresolved placeholders in adapter args: ${unresolved.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  // Spawn adapter
  const result = spawnSync(adapter.command, resolved, {
    input: json,
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8'
  });
  const adapterLabel = `${adapterName} (stdin)`;
  if (result.error) {
    process.stderr.write(`Error: failed to spawn adapter '${adapterName}': ${result.error.message}\n`);
    appendJournal(buildJournalEntry(artifact, artifactPath, adapterLabel, model, 'failed (spawn error)'), repositoryRoot);
    process.exitCode = 1;
    return;
  }
  if (result.signal) {
    process.stderr.write(`Error: adapter '${adapterName}' killed by signal ${result.signal}.\n`);
    appendJournal(buildJournalEntry(artifact, artifactPath, adapterLabel, model, `failed (signal ${result.signal})`), repositoryRoot);
    process.exitCode = 1;
    return;
  }
  const exitCode = result.status ?? 0;
  const status = exitCode === 0 ? 'ok' : `failed (exit ${exitCode})`;
  appendJournal(buildJournalEntry(artifact, artifactPath, adapterLabel, model, status), repositoryRoot);
  if (exitCode !== 0) {
    process.stderr.write(`Error: adapter '${adapterName}' exited with code ${exitCode}.\n`);
    process.exitCode = exitCode;
  }
}

export function runRoute(): void {
  const artifactArg = getArgValue('--artifact');
  if (!artifactArg) {
    process.stderr.write('Usage: forgeai-init --route --artifact <path> [--adapter <name>] [--model <id>]\n');
    process.exitCode = 2;
    return;
  }
  const artifactPath = path.resolve(root, artifactArg);
  const result = validateArtifact(artifactPath, root);
  if (result.status !== 'ok') {
    process.stderr.write(`Error: ${result.detail}\n`);
    process.exitCode = 1;
    return;
  }
  const adapterName = getArgValue('--adapter');
  const model = getArgValue('--model');
  if (model && !adapterName) {
    process.stderr.write(`${formatStatus('warn', '--model is ignored when --adapter is not specified')}\n`);
  }
  routeToAdapter(result.artifact, artifactPath, adapterName, model, root);
}
```

- [ ] **Step 3.4: Wire `--route` in `bin/forgeai-init.ts`**

Add to imports:
```typescript
import { runValidateArtifact, runRoute } from './lib/router.js';
```

Add to dispatch chain:
```typescript
else if (route) runRoute();
```

- [ ] **Step 3.5: Run tests to confirm they pass**

```bash
npm test
```
Expected: all tests pass including the three new `--route` tests.

- [ ] **Step 3.6: Commit**

```bash
git add bin/lib/router.ts bin/lib/context.ts bin/forgeai-init.ts test/context-routing.test.ts
git commit -m "feat(phase-11): add adapter routing, journal recording, and --route CLI"
```

---

## Task 4: Kind-aware expansion compiler and mode-aware dominance

**Files:**
- Modify: `bin/lib/context-compiler.ts` (add `compileContextExpansion`)
- Extend: `test/context-expansion.test.ts` (partial — expansion compiler unit tests)

**Interfaces:**
- Consumes: `tokenizeObjective` from `context-pack.ts`; `candidatesForFile`, `deduplicateCandidates`, `tryExcerpt`, `ExcerptCandidate` (internal); `ResolvedContextRequest` from `types.ts`
- Produces: `compileContextExpansion(primary, requests, curatedGraph, dependencyGraph, repositoryRoot, options): CompiledContextArtifact`

---

- [ ] **Step 4.1: Write failing test for expansion compiler**

Create `test/context-expansion.test.ts`:

```typescript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompiledContextArtifact, ResolvedContextRequest } from '../bin/lib/types.js';
import { cli, runTs } from './helpers.js';

function buildFixture(target: string): void {
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.mkdirSync(path.join(target, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(target, 'src', 'auth.ts'),
    'export function login(user: string) { return internalCheck(user); }\nfunction internalCheck(u: string) { return u.length > 0; }\n'
  );
  fs.writeFileSync(
    path.join(target, 'test', 'auth.test.ts'),
    "import test from 'node:test';\ntest('login works', () => {});\n"
  );
  runTs(cli, [], { cwd: target });
  runTs(cli, ['--refresh-codegraph'], { cwd: target });
}

function compile(target: string, objective: string, budget = 4000): CompiledContextArtifact {
  const json = runTs(cli, ['--compile-context', '--objective', objective, '--budget', String(budget)], { cwd: target });
  return JSON.parse(json) as CompiledContextArtifact;
}

test('compileContextExpansion includes file request declarations regardless of export status', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-compiler-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    const { compileContextExpansion } = await import('../bin/lib/context-compiler.js');
    const { readCuratedCodeGraph } = await import('../bin/lib/context-pack.js');
    const { readDependencyGraph, checkDependencyGraphHealth } = await import('../bin/lib/dependency-graph.js');
    const curatedGraph = readCuratedCodeGraph();
    const depGraph = readDependencyGraph(target);
    const requests: ResolvedContextRequest[] = [
      { requestKind: 'file', path: 'src/auth.ts', reason: 'need private helper' }
    ];
    const expansion = compileContextExpansion(primary, requests, curatedGraph, depGraph!, target, { budget: 4000 });
    assert.equal(expansion.kind, 'forgeai_compiled_context');
    assert.match(expansion.objective, /\[expansion\]/);
    // expansion should contain internalCheck (not exported, not objective-matching in primary)
    const names = expansion.excerpts.map((e) => e.name);
    assert.ok(names.includes('internalCheck'), `expected internalCheck in expansion excerpts, got: ${names.join(', ')}`);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4.2: Run test to confirm it fails**

```bash
node --import tsx --test test/context-expansion.test.ts
```
Expected: fail — `compileContextExpansion` not exported.

- [ ] **Step 4.3: Add `compileContextExpansion` to `bin/lib/context-compiler.ts`**

Add import at top:
```typescript
import { tokenizeObjective } from './context-pack.js';
```

Add function after `compileContext`:

```typescript
export function compileContextExpansion(
  primary: CompiledContextArtifact,
  requests: import('./types.js').ResolvedContextRequest[],
  curatedGraph: ReturnType<typeof readCuratedCodeGraph>,
  dependencyGraph: DependencyGraph,
  repositoryRoot: string,
  options: { budget?: number } = {}
): CompiledContextArtifact {
  const remainingCapacity = primary.budget.limit_tokens - primary.budget.estimated_tokens;
  const budget = options.budget ?? remainingCapacity;
  const terms = tokenizeObjective(primary.objective);

  // Build primary key map: key -> mode
  const primaryModes = new Map<string, 'full' | 'signature'>();
  for (const exc of primary.excerpts) {
    const key = [exc.path, exc.source_start_line, exc.source_end_line, exc.kind].join(':');
    const existing = primaryModes.get(key);
    if (!existing || exc.mode === 'full') primaryModes.set(key, exc.mode);
  }

  // Collect candidates per request, respecting request kind
  const allCandidates: ExcerptCandidate[] = [];
  const seenRequestKeys = new Set<string>();

  for (const request of requests) {
    const reqKey = `${request.requestKind}:${request.path}:${request.symbol ?? ''}`;
    if (seenRequestKeys.has(reqKey)) continue;
    seenRequestKeys.add(reqKey);

    const depNode = dependencyGraph.nodes.find((n) => n.path === request.path);
    if (!depNode) continue;

    // Get raw candidates for the file using existing logic
    const fileCandidates: ExcerptCandidate[] = (() => {
      try {
        return candidatesForFile(repositoryRoot, { node: depNode, depth: 0, reason: request.reason, graphPath: request.path }, terms);
      } catch {
        return [];
      }
    })();

    if (request.requestKind === 'file') {
      // Force-include ALL declarations: rebuild candidates ignoring match filter
      const absolutePath = path.join(repositoryRoot, request.path);
      const content = fs.readFileSync(absolutePath, 'utf8');
      const analysis = analyzeSource(content, request.path);
      for (const declaration of analysis.declarations) {
        const reason = `${request.reason} (file request)`;
        allCandidates.push({
          priority: 0,
          full: excerptFromDeclaration({ node: depNode, depth: 0, reason, graphPath: request.path }, declaration, content, 'full', reason),
          signature: declaration.signature
            ? excerptFromDeclaration({ node: depNode, depth: 0, reason, graphPath: request.path }, declaration, content, 'signature', `${reason}; body omitted to fit budget`)
            : null
        });
      }
    } else if (request.requestKind === 'test') {
      // Force-include test-kind declarations only
      const absolutePath = path.join(repositoryRoot, request.path);
      const content = fs.readFileSync(absolutePath, 'utf8');
      const analysis = analyzeSource(content, request.path);
      for (const declaration of analysis.declarations.filter((d) => d.kind === 'test')) {
        const reason = `${request.reason} (test request)`;
        allCandidates.push({
          priority: 0,
          full: excerptFromDeclaration({ node: depNode, depth: 0, reason, graphPath: request.path }, declaration, content, 'full', reason),
          signature: null
        });
      }
      // Non-test declarations still go through normal matching
      allCandidates.push(...fileCandidates.filter((c) => c.full.kind !== 'test'));
    } else if (request.requestKind === 'symbol') {
      // Force-include declaration whose name matches symbol
      if (request.symbol) {
        const absolutePath = path.join(repositoryRoot, request.path);
        const content = fs.readFileSync(absolutePath, 'utf8');
        const analysis = analyzeSource(content, request.path);
        for (const declaration of analysis.declarations.filter((d) => d.name === request.symbol)) {
          const reason = `${request.reason} (symbol request: ${request.symbol})`;
          allCandidates.push({
            priority: 0,
            full: excerptFromDeclaration({ node: depNode, depth: 0, reason, graphPath: request.path }, declaration, content, 'full', reason),
            signature: declaration.signature
              ? excerptFromDeclaration({ node: depNode, depth: 0, reason, graphPath: request.path }, declaration, content, 'signature', `${reason}; body omitted to fit budget`)
              : null
          });
        }
      }
      // Also include normal objective-matching candidates from this file
      allCandidates.push(...fileCandidates);
    }
  }

  // Apply mode-aware dominance rule against primary
  const dominatedCandidates = allCandidates
    .map((candidate): ExcerptCandidate | null => {
      const key = [candidate.full.path, candidate.full.source_start_line, candidate.full.source_end_line, candidate.full.kind].join(':');
      const primaryMode = primaryModes.get(key);
      if (primaryMode === 'full') return null; // primary already complete
      if (primaryMode === 'signature') {
        // Allow full upgrade; disallow signature retransmission
        return { ...candidate, signature: null };
      }
      return candidate; // absent in primary — keep
    })
    .filter((c): c is ExcerptCandidate => c !== null);

  // Dedup within expansion
  const deduped = deduplicateCandidates(dominatedCandidates);

  const contracts = Array.from(new Set(primary.contracts)).sort();
  const entrypoints = Array.from(new Set(primary.entrypoints)).sort();

  const artifact: CompiledContextArtifact = {
    schema_version: 1,
    kind: 'forgeai_compiled_context',
    objective: `[expansion] ${primary.objective}`,
    repository: primary.repository,
    budget: {
      limit_tokens: budget,
      estimated_tokens: 0,
      estimator: 'characters_divided_by_4',
      exhausted: false
    },
    selection: {
      max_depth: primary.selection.max_depth,
      max_nodes: primary.selection.max_nodes,
      files: Array.from(new Set(deduped.map((c) => c.full.path))).map((p) => ({
        path: p, depth: 0, reason: 'expansion request', graph_path: p
      }))
    },
    rules: [],
    diagnostics: primary.diagnostics,
    contracts,
    entrypoints,
    excerpts: [],
    omitted_candidates: deduped.length
  };

  const baseEstimate = computeArtifactEstimate(artifact);
  if (baseEstimate > budget) {
    throw new ContextBudgetError(`expansion budget ${budget} is too small for base artifact overhead; increase --budget`);
  }

  for (const candidate of deduped) {
    if (tryExcerpt(artifact, candidate.full, deduped.length)) continue;
    if (candidate.signature) tryExcerpt(artifact, candidate.signature, deduped.length);
  }

  artifact.omitted_candidates = deduped.length - artifact.excerpts.length;
  artifact.budget.exhausted = artifact.omitted_candidates > 0 || artifact.excerpts.some((e) => e.mode === 'signature');
  artifact.budget.estimated_tokens = computeArtifactEstimate(artifact);

  return artifact;
}
```

> Note: `candidatesForFile`, `excerptFromDeclaration`, `analyzeSource`, `deduplicateCandidates`, `tryExcerpt`, `ContextBudgetError` are already defined or imported in `context-compiler.ts`. Make sure `analyzeSource` is imported at the top of the file (it already is from `source-analysis.js`).

- [ ] **Step 4.4: Run tests to confirm they pass**

```bash
npm test
```
Expected: all tests pass including the new expansion compiler test.

- [ ] **Step 4.5: Commit**

```bash
git add bin/lib/context-compiler.ts test/context-expansion.test.ts
git commit -m "feat(phase-11): add kind-aware compileContextExpansion with mode-aware dominance"
```

---

## Task 5: need_context parser, resolver, and `--expand-context` CLI

**Files:**
- Create: `bin/lib/context-expansion.ts`
- Modify: `bin/forgeai-init.ts`
- Extend: `test/context-expansion.test.ts`

**Interfaces:**
- Consumes: `validateArtifact` from `router.ts`; `compileContextExpansion` from `context-compiler.ts`; `readCuratedCodeGraph` from `context-pack.ts`; `readDependencyGraph`, `checkDependencyGraphHealth` from `dependency-graph.ts`
- Produces:
  - `validateNeedContext(request, dependencyGraph, curatedGraph, repositoryRoot): { valid: ResolvedContextRequest[]; rejected: ... }`
  - `runExpandContext(): void`

---

- [ ] **Step 5.1: Write failing tests for `--expand-context`**

Add to `test/context-expansion.test.ts`:

```typescript
function writeNeedContext(
  target: string,
  artifactPath: string,
  requests: Array<{ kind: string; name?: string; path?: string; reason: string }>
): string {
  const needContext = {
    kind: 'forgeai_need_context',
    schema_version: 1,
    artifact: artifactPath,
    requests
  };
  const dir = path.join(target, '.ai', 'state', 'context');
  fs.mkdirSync(dir, { recursive: true });
  const needContextPath = path.join(dir, 'TASK-01-need-context.json');
  fs.writeFileSync(needContextPath, JSON.stringify(needContext, null, 2) + '\n');
  return needContextPath;
}

test('--expand-context produces supplemental artifact for file request', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-cli-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    const artifactPath = path.join(target, '.ai', 'state', 'context', 'TASK-01.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(primary, null, 2) + '\n');
    const needContextPath = writeNeedContext(target, artifactPath, [
      { kind: 'file', path: 'src/auth.ts', reason: 'need private helper' }
    ]);
    const outputPath = path.join(target, '.ai', 'state', 'context', 'TASK-01-expansion-1.json');
    runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needContextPath, '--output', outputPath], { cwd: target });
    assert.ok(fs.existsSync(outputPath));
    const expansion = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as CompiledContextArtifact;
    assert.equal(expansion.kind, 'forgeai_compiled_context');
    assert.match(expansion.objective, /\[expansion\]/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--expand-context exits 1 when all candidates deduplicate against primary', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-dedup-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    const artifactPath = path.join(target, '.ai', 'state', 'context', 'TASK-01.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(primary, null, 2) + '\n');
    // Request something already fully in primary
    const existingPath = primary.excerpts[0]?.path;
    if (!existingPath) return; // skip if no excerpts
    const needContextPath = writeNeedContext(target, artifactPath, [
      { kind: 'file', path: existingPath, reason: 'already in primary at full mode' }
    ]);
    // Artificially make primary have full mode for all excerpts
    const modifiedPrimary = { ...primary, excerpts: primary.excerpts.map((e) => ({ ...e, mode: 'full' as const })) };
    fs.writeFileSync(artifactPath, JSON.stringify(modifiedPrimary, null, 2) + '\n');
    let threw = false;
    try {
      runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needContextPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5.2: Run tests to confirm they fail**

```bash
node --import tsx --test test/context-expansion.test.ts
```
Expected: new tests fail — `--expand-context` not wired.

- [ ] **Step 5.3: Create `bin/lib/context-expansion.ts`**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type {
  NeedContextArtifact,
  NeedContextRequestItem,
  ResolvedContextRequest,
  DependencyGraph
} from './types.js';
import type { readCuratedCodeGraph } from './context-pack.js';
import { validateArtifact } from './router.js';
import { compileContextExpansion, ContextBudgetError } from './context-compiler.js';
import { readCuratedCodeGraph as readGraph } from './context-pack.js';
import { readDependencyGraph, checkDependencyGraphHealth, IGNORED_DIRECTORIES } from './dependency-graph.js';
import { root, getArgValue } from './context.js';
import { formatStatus, getErrorMessage } from './utils.js';
import { renderCompiledContextMarkdown } from './context-compiler.js';

const MIN_BUDGET = 256;
const MAX_BUDGET = 200_000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validateNeedContextSchema(raw: unknown): NeedContextArtifact | string {
  if (typeof raw !== 'object' || raw === null) return 'need_context is not an object';
  const n = raw as Record<string, unknown>;
  if (n.kind !== 'forgeai_need_context') return "kind must be 'forgeai_need_context'";
  if (n.schema_version !== 1) return 'schema_version must be 1';
  if (!isNonEmptyString(n.artifact)) return 'artifact must be a non-empty string';
  if (!Array.isArray(n.requests) || n.requests.length === 0) return 'requests must be a non-empty array';
  for (const item of n.requests as unknown[]) {
    if (typeof item !== 'object' || item === null) return 'requests items must be objects';
    const r = item as Record<string, unknown>;
    if (r.kind === 'symbol') {
      if (!isNonEmptyString(r.name)) return 'symbol request must have a non-empty name';
      if (typeof r.reason !== 'string') return 'symbol request must have a reason string';
    } else if (r.kind === 'file' || r.kind === 'test') {
      if (!isNonEmptyString(r.path)) return `${String(r.kind)} request must have a non-empty path`;
      if (typeof r.reason !== 'string') return `${String(r.kind)} request must have a reason string`;
    } else {
      return `unknown request kind '${String(r.kind)}'`;
    }
  }
  return raw as NeedContextArtifact;
}

export function validateNeedContext(
  request: NeedContextArtifact,
  dependencyGraph: DependencyGraph,
  curatedGraph: ReturnType<typeof readCuratedCodeGraph>,
  repositoryRoot: string
): { valid: ResolvedContextRequest[]; rejected: Array<{ item: NeedContextRequestItem; reason: string }> } {
  const depPaths = new Set(dependencyGraph.nodes.map((n) => n.path));
  const ignoredSegments = new Set(IGNORED_DIRECTORIES as readonly string[]);

  function isIgnoredPath(p: string): boolean {
    return p.split('/').some((seg) => ignoredSegments.has(seg));
  }

  const valid: ResolvedContextRequest[] = [];
  const rejected: Array<{ item: NeedContextRequestItem; reason: string }> = [];
  const seenKeys = new Set<string>();

  for (const item of request.requests) {
    if (item.kind === 'file' || item.kind === 'test') {
      const p = item.path;
      if (isIgnoredPath(p)) {
        rejected.push({ item, reason: `path '${p}' is in an ignored directory` });
        continue;
      }
      if (!depPaths.has(p)) {
        rejected.push({ item, reason: `path '${p}' not found in dependency graph` });
        continue;
      }
      const key = `${item.kind}:${p}:`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      valid.push({ requestKind: item.kind, path: p, reason: item.reason });
    } else if (item.kind === 'symbol') {
      const name = item.name;
      const resolvedPaths: string[] = [];
      // Search dependency graph exports
      for (const node of dependencyGraph.nodes) {
        if (node.exports.includes(name)) resolvedPaths.push(node.path);
      }
      // Search curated graph public_contracts
      if (curatedGraph) {
        for (const node of curatedGraph.nodes ?? []) {
          if ((node.public_contracts ?? []).includes(name) && node.path && !resolvedPaths.includes(node.path)) {
            resolvedPaths.push(node.path);
          }
        }
      }
      if (resolvedPaths.length === 0) {
        rejected.push({ item, reason: `symbol '${name}' not found in dependency graph exports or public_contracts` });
        continue;
      }
      for (const p of resolvedPaths) {
        if (isIgnoredPath(p)) continue;
        const key = `symbol:${p}:${name}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        valid.push({ requestKind: 'symbol', path: p, symbol: name, reason: item.reason });
      }
    }
  }
  return { valid, rejected };
}

export function runExpandContext(): void {
  const artifactArg = getArgValue('--artifact');
  const needContextArg = getArgValue('--need-context');
  if (!artifactArg || !needContextArg) {
    process.stderr.write('Usage: forgeai-init --expand-context --artifact <path> --need-context <path> [--budget <tokens>] [--output <json>]\n');
    process.exitCode = 2;
    return;
  }
  const artifactPath = path.resolve(root, artifactArg);
  const needContextPath = path.resolve(root, needContextArg);

  // Step 1: Validate primary artifact
  const primaryResult = validateArtifact(artifactPath, root);
  if (primaryResult.status !== 'ok') {
    process.stderr.write(`Error: ${primaryResult.detail}\n`);
    process.exitCode = 1;
    return;
  }
  const primary = primaryResult.artifact;

  // Step 2: Validate need_context schema
  let rawNeedContext: unknown;
  try {
    rawNeedContext = JSON.parse(fs.readFileSync(needContextPath, 'utf8'));
  } catch (error) {
    process.stderr.write(`Error: cannot parse need_context: ${getErrorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }
  const needContextOrError = validateNeedContextSchema(rawNeedContext);
  if (typeof needContextOrError === 'string') {
    process.stderr.write(`Error: invalid need_context: ${needContextOrError}\n`);
    process.exitCode = 1;
    return;
  }
  const needContext = needContextOrError;

  // Step 3: Load graphs and resolve requests
  const depGraph = readDependencyGraph(root);
  const health = checkDependencyGraphHealth(root, depGraph);
  if (health.status !== 'ok') {
    process.stderr.write(`Error: dependency graph is ${health.status}: ${health.detail}\n`);
    process.exitCode = 1;
    return;
  }
  const curatedGraph = readGraph();
  const { valid, rejected } = validateNeedContext(needContext, depGraph!, curatedGraph, root);
  for (const r of rejected) {
    process.stderr.write(`${formatStatus('warn', `rejected: ${r.reason}`)}\n`);
  }
  if (valid.length === 0) {
    process.stderr.write('Error: no requests passed validation.\n');
    process.exitCode = 1;
    return;
  }

  // Expansion budget
  const remainingCapacity = primary.budget.limit_tokens - primary.budget.estimated_tokens;
  const budgetArg = getArgValue('--budget');
  let budget: number;
  if (budgetArg !== null) {
    budget = Number(budgetArg);
    if (!Number.isInteger(budget) || budget < MIN_BUDGET || budget > MAX_BUDGET) {
      process.stderr.write(`Error: --budget must be between ${MIN_BUDGET} and ${MAX_BUDGET}.\n`);
      process.exitCode = 2;
      return;
    }
  } else {
    if (remainingCapacity < MIN_BUDGET) {
      process.stderr.write(`Error: remaining primary capacity (${remainingCapacity}) is below minimum ${MIN_BUDGET}. Pass --budget explicitly.\n`);
      process.exitCode = 1;
      return;
    }
    budget = remainingCapacity;
  }

  // Step 4: Compile expansion
  let expansion;
  try {
    expansion = compileContextExpansion(primary, valid, curatedGraph, depGraph!, root, { budget });
  } catch (error) {
    if (error instanceof ContextBudgetError) {
      process.stderr.write(`Error: expansion budget is too small for the requested context; increase --budget.\n`);
      process.exitCode = 2;
    } else {
      process.stderr.write(`Error: expansion failed: ${getErrorMessage(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (expansion.excerpts.length === 0) {
    process.stderr.write('Error: requests produced no new context after deduplication against the primary artifact.\n');
    process.exitCode = 1;
    return;
  }

  const json = `${JSON.stringify(expansion, null, 2)}\n`;
  const outputArg = getArgValue('--output');
  if (!outputArg) {
    process.stdout.write(json);
    return;
  }
  const jsonPath = path.resolve(root, outputArg);
  const markdownArg = getArgValue('--markdown-output') ?? outputArg.replace(/\.json$/, '.md');
  const markdownPath = path.resolve(root, markdownArg);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(jsonPath, json);
  fs.writeFileSync(markdownPath, renderCompiledContextMarkdown(expansion));
  process.stderr.write(`${formatStatus('ok', `expansion JSON written to ${outputArg}`)}\n`);
  process.stderr.write(`${formatStatus('ok', `expansion Markdown written to ${markdownArg}`)}\n`);
  process.stderr.write(`${formatStatus('ok', `estimated tokens ${expansion.budget.estimated_tokens}/${expansion.budget.limit_tokens}`)}\n`);
}
```

- [ ] **Step 5.4: Wire `--expand-context` in `bin/forgeai-init.ts`**

Add to imports:
```typescript
import { runExpandContext } from './lib/context-expansion.js';
```

Add to dispatch chain:
```typescript
else if (expandContext) runExpandContext();
```

- [ ] **Step 5.5: Run tests to confirm they pass**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 5.6: Commit**

```bash
git add bin/lib/context-expansion.ts bin/forgeai-init.ts test/context-expansion.test.ts
git commit -m "feat(phase-11): add validateNeedContext, runExpandContext, and --expand-context CLI"
```

---

## Task 6: Help text, `.gitignore` maintenance, regression tests, docs, and version bump

**Files:**
- Modify: `bin/lib/init.ts`
- Extend: `test/upgrade.test.ts`
- Extend: `test/lifecycle.test.ts`
- Extend: `test/context-routing.test.ts` (regression test 1)
- Extend: `test/context-expansion.test.ts` (regression tests 2, 3)
- Extend: `test/dist.test.ts`
- Modify: `README.md`
- Create: `docs/migrations/3.3.0.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`, `package-lock.json`

---

- [ ] **Step 6.1: Write failing help text test**

Add to `test/lifecycle.test.ts`:

```typescript
test('help text contains three Phase 11 commands', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-help-phase11-'));
  try {
    const output = runTs(cli, ['--help'], { cwd: target });
    assert.match(output, /--validate-artifact/);
    assert.match(output, /--route/);
    assert.match(output, /--expand-context/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6.2: Write failing gitignore tests**

Add to `test/upgrade.test.ts`:

```typescript
test('forgeai-init creates .gitignore with context-state entries when absent', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-gitignore-create-'));
  try {
    assert.ok(!fs.existsSync(path.join(target, '.gitignore')));
    runTs(cli, [], { cwd: target });
    const gitignore = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    assert.match(gitignore, /\.ai\/state\/context\//);
    assert.match(gitignore, /\.ai\/state\/context-routes\.md/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('forgeai-init appends context-state entries idempotently with trailing newline', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-gitignore-idem-'));
  try {
    // Pre-existing .gitignore without trailing newline, with one of the entries
    fs.writeFileSync(path.join(target, '.gitignore'), 'node_modules\n.ai/state/context/');
    runTs(cli, [], { cwd: target });
    const content = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    // Must have trailing newline
    assert.ok(content.endsWith('\n'));
    // Must contain both entries exactly once
    const lines = content.split('\n');
    assert.equal(lines.filter((l) => l === '.ai/state/context/').length, 1);
    assert.ok(lines.includes('.ai/state/context-routes.md'));
    // Run again — no duplicates
    runTs(cli, [], { cwd: target });
    const content2 = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    const lines2 = content2.split('\n');
    assert.equal(lines2.filter((l) => l === '.ai/state/context/').length, 1);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade also writes context-state gitignore entries', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-gitignore-upgrade-'));
  try {
    runTs(cli, [], { cwd: target });
    // Delete .gitignore to simulate older install
    fs.rmSync(path.join(target, '.gitignore'), { force: true });
    runTs(cli, ['--upgrade'], { cwd: target });
    const content = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    assert.match(content, /\.ai\/state\/context\//);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6.3: Run failing tests**

```bash
npm test
```
Expected: help test and gitignore tests fail.

- [ ] **Step 6.4: Update `bin/lib/init.ts` — help text**

Add after `--compile-context` help block (around line 91):

```
  --validate-artifact
                Validate a compiled context artifact: checks schema, structure,
                dependency graph health, fingerprint, path membership, and token
                estimate consistency. Requires --artifact <path>.
  --route       Validate and deliver a compiled context artifact to a CLI adapter
                via stdin. Requires --artifact <path>. Use --adapter <name> to
                name a configured adapter from .ai/cli-adapters.json. Without
                --adapter, writes validated JSON to stdout. Use --model <id> to
                resolve the {model} placeholder in adapter args.
  --expand-context
                Validate a need_context request and compile a supplemental context
                artifact containing only the additionally requested symbols, files,
                or tests. Requires --artifact <path> and --need-context <path>.
                Use --budget <tokens> to override the default (remaining primary
                capacity). With --output <json>, also writes a Markdown rendering.
```

- [ ] **Step 6.5: Add gitignore maintenance to `bin/lib/init.ts`**

Add a new exported function and call it from both `runInit` and the upgrade path:

```typescript
const CONTEXT_GITIGNORE_ENTRIES = ['.ai/state/context/', '.ai/state/context-routes.md'];

export function maintainContextGitignore(repositoryRoot: string, isDryRun: boolean): void {
  const gitignorePath = path.join(repositoryRoot, '.gitignore');
  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf8');
  }
  const existingLines = existing.split('\n');
  const missing = CONTEXT_GITIGNORE_ENTRIES.filter((entry) => !existingLines.includes(entry));
  if (missing.length === 0) return;
  if (isDryRun) {
    for (const entry of missing) {
      console.log(`would append ${entry} to .gitignore`);
    }
    return;
  }
  let content = existing;
  if (content.length > 0 && !content.endsWith('\n')) content += '\n';
  content += missing.join('\n') + '\n';
  fs.writeFileSync(gitignorePath, content);
}
```

Call `maintainContextGitignore(root, dryRun)` at the end of both the init path (in `runInit()`) and the upgrade path.

- [ ] **Step 6.6: Write regression test 1 — falsified token estimate**

Add to `test/context-routing.test.ts`:

```typescript
test('--validate-artifact rejects artifact with falsified estimated_tokens', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-falsified-'));
  try {
    const artifact = initAndCompile(target);
    // Falsify the token estimate
    artifact.budget.estimated_tokens = artifact.budget.estimated_tokens + 999;
    const artifactPath = writeArtifact(target, artifact);
    let threw = false;
    try {
      runTs(cli, ['--validate-artifact', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'should reject artifact with falsified estimated_tokens');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6.7: Write regression test 2 — signature in primary allows full in expansion**

Add to `test/context-expansion.test.ts`:

```typescript
test('expansion sends full body when primary only has signature mode', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-sig-upgrade-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    // Find a full excerpt and force it to signature mode in primary
    const targetExcerpt = primary.excerpts.find((e) => e.mode === 'full' && e.kind !== 'import');
    if (!targetExcerpt) return; // skip if no suitable excerpt
    const modifiedPrimary = {
      ...primary,
      excerpts: primary.excerpts.map((e) =>
        e === targetExcerpt ? { ...e, mode: 'signature' as const } : e
      )
    };
    // Recompute estimated_tokens for modified primary
    const { computeArtifactEstimate } = await import('../bin/lib/context-compiler.js');
    modifiedPrimary.budget.estimated_tokens = computeArtifactEstimate(modifiedPrimary as CompiledContextArtifact);
    const artifactPath = path.join(target, '.ai', 'state', 'context', 'TASK-01.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(modifiedPrimary, null, 2) + '\n');
    const needContextPath = writeNeedContext(target, artifactPath, [
      { kind: 'symbol', name: targetExcerpt.name, reason: 'need full implementation' }
    ]);
    const output = runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needContextPath], { cwd: target });
    const expansion = JSON.parse(output) as CompiledContextArtifact;
    const fullExcerpt = expansion.excerpts.find((e) => e.name === targetExcerpt.name);
    assert.ok(fullExcerpt, `expected ${targetExcerpt.name} in expansion excerpts`);
    assert.equal(fullExcerpt?.mode, 'full');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6.8: Write regression test 3 — same path with file and test request is deterministic**

Add to `test/context-expansion.test.ts`:

```typescript
test('file and test requests for same path are treated independently and deterministically', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-dedup-kind-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    const { compileContextExpansion } = await import('../bin/lib/context-compiler.js');
    const { readCuratedCodeGraph } = await import('../bin/lib/context-pack.js');
    const { readDependencyGraph } = await import('../bin/lib/dependency-graph.js');
    const curatedGraph = readCuratedCodeGraph();
    const depGraph = readDependencyGraph(target);
    const requests: ResolvedContextRequest[] = [
      { requestKind: 'file', path: 'test/auth.test.ts', reason: 'need test file' },
      { requestKind: 'test', path: 'test/auth.test.ts', reason: 'need test declarations' }
    ];
    const expansion1 = compileContextExpansion(primary, requests, curatedGraph, depGraph!, target, { budget: 4000 });
    const expansion2 = compileContextExpansion(primary, requests, curatedGraph, depGraph!, target, { budget: 4000 });
    // Results must be identical across runs
    assert.deepEqual(
      expansion1.excerpts.map((e) => `${e.path}:${e.source_start_line}:${e.kind}`),
      expansion2.excerpts.map((e) => `${e.path}:${e.source_start_line}:${e.kind}`)
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6.9: Extend `test/dist.test.ts` for new CLI flags**

Add to `test/dist.test.ts`:

```typescript
test('compiled dist CLI help contains Phase 11 commands', () => {
  const output = runDist(['--help'], projectRoot);
  assert.match(output, /--validate-artifact/);
  assert.match(output, /--route/);
  assert.match(output, /--expand-context/);
});
```

- [ ] **Step 6.10: Run all tests**

```bash
npm test
```
Expected: all tests pass including all regression tests and gitignore tests.

- [ ] **Step 6.11: Write `docs/migrations/3.3.0.md`**

```markdown
# Migration Guide — 3.3.0

## What changed

- `forgeai-init` and `--upgrade` now append two entries to `.gitignore` if not
  already present:
  - `.ai/state/context/`
  - `.ai/state/context-routes.md`

  These directories hold ephemeral compiled context artifacts and the routing
  audit log. They should not be committed.

## Upgrade steps

Run `forgeai-init --upgrade` to apply the new managed-file set. No breaking
changes to existing harness files or schemas.
```

- [ ] **Step 6.12: Update `CHANGELOG.md`**

Prepend:

```markdown
## 3.3.0 — 2026-07-14

### Added

- `--validate-artifact` command: validates a compiled context artifact against
  its dependency graph — structural schema, Phase 10 compiler bounds, path
  membership, fingerprint freshness, and token estimate consistency.
- `--route` command: validates and delivers a compiled context artifact to a
  configured `input: 'stdin'` CLI adapter. Writes an append-only routing journal
  to `.ai/state/context-routes.md`. Falls back to stdout when `--adapter` is
  omitted.
- `--expand-context` command: validates a `forgeai_need_context` request,
  resolves symbol/file/test requests against both graphs, and compiles a
  supplemental artifact with kind-aware inclusion and mode-aware deduplication
  against the primary artifact.
- `computeArtifactEstimate()` exported from `context-compiler` as a pure shared
  helper for consistent token estimation.
- `tokenizeObjective()` exported from `context-pack` for use by the expansion
  compiler.

### Changed

- `forgeai-init` and `--upgrade` now maintain `.ai/state/context/` and
  `.ai/state/context-routes.md` entries in the project `.gitignore`.

### Migration

Run `forgeai-init --upgrade`. See `docs/migrations/3.3.0.md`.
```

- [ ] **Step 6.13: Update `README.md`**

Add a new section "Context Enforcement (Phase 11)" after the existing `--compile-context` documentation, describing the three commands and typical workflow:

```markdown
## Context Enforcement

After compiling context with `--compile-context`, Phase 11 commands enforce
it as the verified input for delegated model calls.

### Validate an artifact

```bash
forgeai-init --validate-artifact --artifact .ai/state/context/TASK-01.json
```

Checks schema, fingerprint freshness, path membership, and token estimate
consistency. Exits 0 on success; exits 1 with a descriptive error on failure.

### Route to a CLI adapter

```bash
forgeai-init --route \
  --artifact .ai/state/context/TASK-01.json \
  --adapter claude \
  --model claude-sonnet-4-6
```

Validates the artifact, then pipes the JSON to the named adapter's stdin.
Without `--adapter`, writes validated JSON to stdout for manual piping.
Records each routing attempt in `.ai/state/context-routes.md`.

### Request additional context

When a delegated model needs more context, it writes a `forgeai_need_context`
JSON file:

```json
{
  "kind": "forgeai_need_context",
  "schema_version": 1,
  "artifact": ".ai/state/context/TASK-01.json",
  "requests": [
    { "kind": "file", "path": "src/auth/internal.ts", "reason": "need private helper" }
  ]
}
```

The orchestrator runs:

```bash
forgeai-init --expand-context \
  --artifact .ai/state/context/TASK-01.json \
  --need-context .ai/state/context/TASK-01-need-context.json \
  --output .ai/state/context/TASK-01-expansion-1.json
```

The supplemental artifact contains only the additionally requested context,
deduplicated against the primary artifact.
```

- [ ] **Step 6.14: Bump version to 3.3.0**

In `package.json`, change:
```json
"version": "3.2.0",
```
to:
```json
"version": "3.3.0",
```

Then run:
```bash
npm install
```
to sync `package-lock.json`.

- [ ] **Step 6.15: Final full test run**

```bash
npm test
```
Expected: all tests pass. Check that `test/lifecycle.test.ts` does not hard-code 3.2.0 anywhere that would now fail — if it does, update those assertions to 3.3.0.

- [ ] **Step 6.16: Commit**

```bash
git add bin/lib/init.ts test/upgrade.test.ts test/lifecycle.test.ts test/context-routing.test.ts test/context-expansion.test.ts test/dist.test.ts README.md docs/migrations/3.3.0.md CHANGELOG.md package.json package-lock.json
git commit -m "feat(phase-11): help text, gitignore maintenance, regression tests, docs, version 3.3.0"
```
