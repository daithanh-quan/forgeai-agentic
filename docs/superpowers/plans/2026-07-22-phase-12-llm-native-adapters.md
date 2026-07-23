# Phase 12A — LLM-Native Adapter Layer (Buffered MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship first-class API adapters for Anthropic, OpenAI, and Gemini behind a normalized error taxonomy, write structured JSON run records on every call, and fall back to CLI adapters only on quota/rate-limit — all without leaking credentials to files or URL logs.

**Architecture:** Provider implementations (`bin/lib/api-adapters/`) each accept an injectable `fetcher` for testing without live APIs. A dispatcher (`bin/lib/api-adapter.ts`) validates the config, calls the right provider, writes a run record to `.ai/state/runs/`, and returns a typed result with normalized `error_kind` / `http_status` / `retryable` fields the router uses to decide fallback vs fast-fail. `routeToAdapter()` and `runRoute()` become `async`; `forgeai-init.ts` uses top-level `await` (valid in ESM). Auth errors (`error_kind: 'auth'`) always fail fast — no CLI fallback. Quota errors (`error_kind: 'quota'`) fall back to the CLI adapter when one is configured. `.ai/api-adapters.json` is added to `PRESERVE_ON_UPGRADE_FILES`. Child process CLI adapters use `stdio: ['pipe', 'inherit', 'inherit']` so their output goes directly to FD 1 — tests use a `CLI_MARKER` env var + marker file to assert CLI ran, not stdout monkey-patching.

**Deferred to Phase 12B:** Streaming HTTP output (chunked `ReadableStream` → incremental stdout), retry loop with backoff, and provider-native lifecycle events (NDJSON to `--watch` pipe). These require stable provider interfaces that this phase establishes.

**Tech Stack:** Node.js ≥20 built-in `fetch`, TypeScript, `node:test`, `node:assert/strict`, `node:fs`, `node:crypto`

## Global Constraints

- Node.js `>=20.0.0` — `fetch` is a global; top-level `await` is valid in ESM
- No new runtime dependencies — all HTTP via built-in `fetch`
- API keys from env vars only (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`); never written to any project file
- Gemini API key goes in `x-goog-api-key` **header**, never in the URL query string
- Tests use `node:test` + `node:assert/strict`; injectable `fetcher` avoids live API calls
- `routeToAdapter()` and `runRoute()` return `Promise<void>`; `forgeai-init.ts` awaits them
- Auth errors (HTTP 401/403) fail immediately — never fall back to a CLI adapter
- Quota errors (HTTP 429) fall back to CLI adapter when one is registered; otherwise fail
- HTTP 408 and 5xx responses are `retryable: true`; 400/404/422 and other non-2xx are `retryable: false`
- `writeRunRecord()` failure emits a warning to stderr but does not abort the route — run records are best-effort
- `callApiAdapter()` returns `{ result: ApiCallResult; record: RunRecord | null }` — `record` is `null` when no API call was attempted (config invalid or adapter not found in config)
- Invalid `api-adapters.json` fails fast with exit 1 — never silently falls through to CLI
- CLI child process tests: use `CLI_MARKER` env var pointing to a temp file; CLI command writes to that file; test asserts file exists. Do NOT use `process.stdout.write` monkey-patching to detect CLI runs.
- Model defaults confirmed stable (as of 2026-07-22): `claude-sonnet-4-6` (Anthropic), `gpt-4.1` (OpenAI), `gemini-2.5-flash` (Gemini)
- Provider adapters strictly validate response content shape — a valid-JSON but malformed content must return `error_kind: 'invalid_response'`, never throw into the dispatcher's catch (which would mis-label it `'network'`). Optional usage metadata is normalized best-effort: missing or malformed token counts become `null` and do not fail the call.
- Gemini `usageMetadata` includes `cachedContentTokenCount`; read it into `cached_tokens` (not always null)
- `generateRunId()` uses `crypto.randomUUID()` for the random suffix (128-bit entropy; collision risk reduced to negligible — not zero, but `writeFileSync` overwrite is no longer a practical concern)
- `isValidRunRecord()` validates schema_version, provider/outcome union membership, all numeric-or-null fields, and all required string fields
- Changelog and README must use "best-effort" language for run record writes
- README "API Adapters" setup section: primary path is `forgeai-init` (new install) or `forgeai-init --upgrade` (existing project); manual `cp` from `node_modules` is an explicit fallback only

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `bin/lib/types.ts` | Add `ApiAdapterEntry`, `ApiAdapterConfig`, `ApiCallResult` (with `error_kind`/`http_status`/`retryable`), `RunRecord` |
| Modify | `bin/lib/init.ts` | Add `.ai/api-adapters.json` to `PRESERVE_ON_UPGRADE_FILES` |
| Create | `bin/lib/run-record.ts` | `generateRunId`, `writeRunRecord`, `listRunRecords` (with field validation), `runListRuns` |
| Create | `bin/lib/api-adapters/anthropic.ts` | Anthropic Messages API |
| Create | `bin/lib/api-adapters/openai.ts` | OpenAI Chat Completions API |
| Create | `bin/lib/api-adapters/gemini.ts` | Google Gemini generateContent API (`x-goog-api-key` header) |
| Create | `bin/lib/api-adapter.ts` | Config validator + async dispatcher |
| Modify | `bin/lib/router.ts` | `routeToAdapter` and `runRoute` → `Promise<void>`; check API before CLI |
| Modify | `bin/lib/context.ts` | Add `listRuns` flag |
| Modify | `bin/forgeai-init.ts` | Import `runListRuns`; `await` async commands; wire `--list-runs` |
| Modify | `bin/lib/init.ts` | Add `--list-runs` and `--route` API note to `usage()` |
| Create | `templates/.ai/api-adapters.json` | Starter config for three providers |
| Modify | `ROADMAP.md` | Rename Phase 12 → 12A (buffered MVP); add Phase 12B for streaming/retry |
| Create | `test/run-record.test.ts` | Run record tests (including field-validation tests) |
| Create | `test/api-adapter.test.ts` | Provider unit tests + dispatcher + router integration tests (marker file pattern) |
| Modify | `README.md` | Add "API Adapters" section after "CI/CD Integration" |
| Modify | `CHANGELOG.md` | Add `## 3.7.0` entry |
| Modify | `package.json` | Bump to `3.7.0` |
| Modify | `package-lock.json` | Kept in sync by `npm version` (not hand-edited) |

---

## Task 1: Contract, error taxonomy, config validation, preserve-on-upgrade

**Files:**
- Modify: `bin/lib/types.ts`
- Modify: `bin/lib/init.ts`

**Interfaces:**
- Consumes: nothing — pure type definitions and init constants
- Produces:
  - `ApiAdapterEntry`, `ApiAdapterConfig` — config file shape
  - `ApiCallResult` — normalized result with `error_kind: 'auth' | 'quota' | 'network' | 'provider' | 'invalid_response' | null`, `http_status: number | null`, `retryable: boolean`
  - `RunRecord` with `outcome: 'ok' | 'quota' | 'auth' | 'error'`
  - `PRESERVE_ON_UPGRADE_FILES` updated with `.ai/api-adapters.json`

- [ ] **Step 1: Append type block to the bottom of `bin/lib/types.ts`**

```typescript
export type ApiAdapterProvider = 'anthropic' | 'openai' | 'gemini';

export type ApiAdapterEntry = {
  provider: ApiAdapterProvider;
  model: string;
  max_tokens?: number;
  system?: string;
  timeout_ms?: number;        // fetch timeout in ms; max 600000; default 120000
  fallback_adapter?: string;  // CLI adapter to use on HTTP 429; must be non-empty, no surrounding whitespace
};

export type ApiAdapterConfig = {
  version?: number;
  adapters?: Record<string, ApiAdapterEntry>;
};

export type ApiCallResult = {
  ok: boolean;
  text: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  latency_ms: number;
  http_status: number | null;
  error_kind: 'auth' | 'quota' | 'network' | 'provider' | 'invalid_response' | null;
  retryable: boolean;
  error: string | null;
};

export type RunRecord = {
  schema_version: 1;
  kind: 'forgeai_run_record';
  run_id: string;
  timestamp: string;
  adapter: string;
  provider: ApiAdapterProvider;
  model: string;
  artifact: string;
  objective: string;
  budget_tokens: number;
  estimated_tokens: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  latency_ms: number;
  http_status: number | null;
  outcome: 'ok' | 'quota' | 'auth' | 'error';
  error: string | null;
};
```

- [ ] **Step 2: Add `.ai/api-adapters.json` to `PRESERVE_ON_UPGRADE_FILES` in `bin/lib/init.ts`**

Find the `PRESERVE_ON_UPGRADE_FILES` set (around line 181). Add `'.ai/api-adapters.json'` immediately after `'.ai/cli-adapters.json'`:

```typescript
export const PRESERVE_ON_UPGRADE_FILES = new Set([
  '.ai/PROJECT.md',
  '.ai/MEMORY.md',
  '.ai/AGENT_REGISTRY.md',
  '.ai/cli-adapters.json',
  '.ai/api-adapters.json',       // ← add this line
  '.ai/model-routing.yaml',
  '.ai/security-policy.yaml',
  '.ai/codegraph/graph.json',
  '.ai/codegraph/dependency-graph.json',
  '.ai/codegraph/hotspots.md',
  '.ai/state/CURRENT.md',
  '.ai/state/sessions.md'
]);
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: User commits**

```
feat(types): add API adapter contract and error taxonomy (Phase 12A)

Adds ApiAdapterEntry, ApiAdapterConfig, ApiCallResult with normalized
error_kind/http_status/retryable fields, and RunRecord. Adds
.ai/api-adapters.json to PRESERVE_ON_UPGRADE_FILES.
```

---

## Task 2: Run record utilities

**Files:**
- Create: `bin/lib/run-record.ts`
- Create: `test/run-record.test.ts`

**Interfaces:**
- Consumes: `RunRecord`, `ApiAdapterProvider` from `./types.js`
- Produces:
  - `generateRunId(): string` — `"run-<YYYYMMDDTHHMMSSZ>-<4 hex chars>"`
  - `writeRunRecord(record: RunRecord, repositoryRoot: string): void` — writes `<runId>.json` to `.ai/state/runs/`; warns to stderr on failure (never throws)
  - `listRunRecords(repositoryRoot: string): RunRecord[]` — all valid `.json` files in `.ai/state/runs/`, newest-first; skips non-JSON, malformed JSON, wrong kind, and records missing required string fields
  - `runListRuns(): void` — CLI handler for `--list-runs`

- [ ] **Step 1: Write the failing tests in `test/run-record.test.ts`**

```typescript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateRunId, writeRunRecord, listRunRecords } from '../bin/lib/run-record.js';
import type { RunRecord } from '../bin/lib/types.js';

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    schema_version: 1,
    kind: 'forgeai_run_record',
    run_id: 'run-test',
    timestamp: '2026-07-22T00:00:00.000Z',
    adapter: 'anthropic',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    artifact: '.ai/state/context/TASK-01.json',
    objective: 'test objective',
    budget_tokens: 6000,
    estimated_tokens: 4000,
    input_tokens: 4100,
    output_tokens: 800,
    cached_tokens: 1200,
    latency_ms: 5000,
    http_status: 200,
    outcome: 'ok',
    error: null,
    ...overrides,
  };
}

test('generateRunId starts with "run-"', () => {
  const id = generateRunId();
  assert.ok(id.startsWith('run-'), `expected run- prefix, got ${id}`);
  assert.ok(id.length > 10);
});

test('generateRunId is unique on successive calls', () => {
  const ids = new Set(Array.from({ length: 10 }, () => generateRunId()));
  assert.ok(ids.size > 1);
});

test('writeRunRecord creates the file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  try {
    const record = makeRecord({ run_id: 'run-write-test' });
    writeRunRecord(record, tmp);
    const filePath = path.join(tmp, '.ai', 'state', 'runs', 'run-write-test.json');
    assert.ok(fs.existsSync(filePath));
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RunRecord;
    assert.equal(parsed.run_id, 'run-write-test');
    assert.equal(parsed.kind, 'forgeai_run_record');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('writeRunRecord emits warning to stderr on write failure but does not throw', () => {
  const stderrChunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderrChunks.push(String(chunk));
    return true;
  };
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-fail-'));
    const blocker = path.join(tmp, '.ai');
    fs.writeFileSync(blocker, 'not-a-dir'); // makes mkdir fail
    assert.doesNotThrow(() => writeRunRecord(makeRecord(), tmp));
    assert.ok(stderrChunks.some((c) => c.includes('run record')));
  } finally {
    process.stderr.write = orig;
  }
});

test('listRunRecords returns empty array when directory is absent', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  try {
    assert.deepEqual(listRunRecords(tmp), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('listRunRecords returns records sorted newest-first', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  try {
    writeRunRecord(makeRecord({ run_id: 'run-aaa', timestamp: '2026-07-22T01:00:00.000Z' }), tmp);
    writeRunRecord(makeRecord({ run_id: 'run-bbb', timestamp: '2026-07-22T02:00:00.000Z' }), tmp);
    const records = listRunRecords(tmp);
    assert.equal(records.length, 2);
    assert.equal(records[0]!.run_id, 'run-bbb');
    assert.equal(records[1]!.run_id, 'run-aaa');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('listRunRecords skips non-JSON files and malformed JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  try {
    const runsDir = path.join(tmp, '.ai', 'state', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, 'README.md'), '# ignore');
    fs.writeFileSync(path.join(runsDir, 'broken.json'), 'not-json{');
    fs.writeFileSync(path.join(runsDir, 'wrong-kind.json'), JSON.stringify({ kind: 'other' }));
    writeRunRecord(makeRecord({ run_id: 'run-only-valid' }), tmp);
    const records = listRunRecords(tmp);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.run_id, 'run-only-valid');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('listRunRecords skips records with invalid budget_tokens, estimated_tokens, error, or timestamp', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  try {
    const runsDir = path.join(tmp, '.ai', 'state', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    // negative budget_tokens
    fs.writeFileSync(path.join(runsDir, 'bad-budget.json'), JSON.stringify({ ...JSON.parse(JSON.stringify(makeRecord({ run_id: 'bad-budget' }))), budget_tokens: -1 }));
    // negative estimated_tokens
    fs.writeFileSync(path.join(runsDir, 'bad-est.json'), JSON.stringify({ ...JSON.parse(JSON.stringify(makeRecord({ run_id: 'bad-est' }))), estimated_tokens: -1 }));
    // non-string error field
    fs.writeFileSync(path.join(runsDir, 'bad-error.json'), JSON.stringify({ ...JSON.parse(JSON.stringify(makeRecord({ run_id: 'bad-error' }))), error: 42 }));
    // non-ISO timestamp
    fs.writeFileSync(path.join(runsDir, 'bad-ts.json'), JSON.stringify({ ...JSON.parse(JSON.stringify(makeRecord({ run_id: 'bad-ts' }))), timestamp: 'not-a-date' }));
    writeRunRecord(makeRecord({ run_id: 'run-valid-budget' }), tmp);
    const records = listRunRecords(tmp);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.run_id, 'run-valid-budget');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('listRunRecords skips records with correct kind but missing required string fields', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  try {
    const runsDir = path.join(tmp, '.ai', 'state', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    // Has correct kind but no timestamp — sort would crash without isValidRunRecord guard
    fs.writeFileSync(path.join(runsDir, 'no-timestamp.json'), JSON.stringify({ kind: 'forgeai_run_record', run_id: 'x', provider: 'anthropic', model: 'm', outcome: 'ok' }));
    // Has kind + timestamp but no run_id
    fs.writeFileSync(path.join(runsDir, 'no-runid.json'), JSON.stringify({ kind: 'forgeai_run_record', timestamp: '2026-07-22T00:00:00.000Z', provider: 'anthropic', model: 'm', outcome: 'ok' }));
    writeRunRecord(makeRecord({ run_id: 'run-valid-only' }), tmp);
    const records = listRunRecords(tmp);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.run_id, 'run-valid-only');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test 2>&1 | grep -E "run-record|FAIL|Error" | head -10
```

Expected: failures — module `bin/lib/run-record.js` does not exist.

- [ ] **Step 3: Create `bin/lib/run-record.ts`**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { RunRecord } from './types.js';
import { root } from './context.js';
import { formatStatus } from './utils.js';

const RUNS_DIR = '.ai/state/runs';

export function generateRunId(): string {
  const ts = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  return `run-${ts}-${crypto.randomUUID()}`;
}

export function writeRunRecord(record: RunRecord, repositoryRoot: string): void {
  try {
    const dir = path.join(repositoryRoot, RUNS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${record.run_id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${formatStatus('warn', `could not write run record: ${String(err)}`)}\n`);
  }
}

const VALID_PROVIDERS_REC = new Set(['anthropic', 'openai', 'gemini']);
const VALID_OUTCOMES_REC = new Set(['ok', 'quota', 'auth', 'error']);

function isValidRunRecord(raw: unknown): raw is RunRecord {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (r['kind'] !== 'forgeai_run_record') return false;
  if (r['schema_version'] !== 1) return false;
  if (typeof r['run_id'] !== 'string' || typeof r['timestamp'] !== 'string') return false;
  if (typeof r['adapter'] !== 'string' || typeof r['artifact'] !== 'string' || typeof r['objective'] !== 'string') return false;
  if (typeof r['model'] !== 'string') return false;
  if (!VALID_PROVIDERS_REC.has(r['provider'] as string)) return false;
  if (!VALID_OUTCOMES_REC.has(r['outcome'] as string)) return false;
  if (typeof r['latency_ms'] !== 'number' || !Number.isFinite(r['latency_ms'] as number) || (r['latency_ms'] as number) < 0) return false;
  for (const field of ['input_tokens', 'output_tokens', 'cached_tokens']) {
    const v = r[field];
    if (v !== null && !(Number.isInteger(v) && (v as number) >= 0)) return false;
  }
  const hs = r['http_status'];
  if (hs !== null && !(Number.isInteger(hs) && (hs as number) >= 100 && (hs as number) <= 599)) return false;
  if (!Number.isInteger(r['budget_tokens']) || (r['budget_tokens'] as number) < 0) return false;
  if (!Number.isInteger(r['estimated_tokens']) || (r['estimated_tokens'] as number) < 0) return false;
  if (r['error'] !== null && typeof r['error'] !== 'string') return false;
  const parsedTs = new Date(r['timestamp'] as string);
  if (Number.isNaN(parsedTs.getTime()) || parsedTs.toISOString() !== r['timestamp']) return false;
  return true;
}

export function listRunRecords(repositoryRoot: string): RunRecord[] {
  const dir = path.join(repositoryRoot, RUNS_DIR);
  if (!fs.existsSync(dir)) return [];

  const records: RunRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (isValidRunRecord(raw)) records.push(raw);
    } catch {
      // skip malformed
    }
  }

  return records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function runListRuns(): void {
  const records = listRunRecords(root);
  if (records.length === 0) {
    console.log(formatStatus('ok', `${RUNS_DIR} has no run records`));
    return;
  }
  console.log(`Run records (${records.length} total)`);
  console.log('');
  for (const r of records) {
    const tokens = r.input_tokens !== null
      ? `in=${r.input_tokens} out=${r.output_tokens} cached=${r.cached_tokens ?? 0}`
      : 'tokens=unknown';
    console.log(
      formatStatus(
        r.outcome === 'ok' ? 'ok' : 'invalid',
        `${r.run_id}  ${r.provider}/${r.model}  ${r.outcome}  ${tokens}  ${r.latency_ms}ms`
      )
    );
  }
}
```

- [ ] **Step 4: Run tests — all nine run-record tests pass**

```bash
npm test 2>&1 | grep -E "run-record|✓|✗" | head -15
```

Expected: all nine pass.

- [ ] **Step 5: User commits**

```
feat(runs): add run record schema and utilities (Phase 12A)
```

---

## Task 3: Anthropic adapter

**Files:**
- Create: `bin/lib/api-adapters/anthropic.ts`
- Create: `test/api-adapter.test.ts` (Anthropic section only — expanded in Tasks 4–7)

**Interfaces:**
- Consumes: `ApiAdapterEntry`, `ApiCallResult`, `CompiledContextArtifact` from `../types.js`
- Produces:
  - `callAnthropic(artifact: CompiledContextArtifact, config: ApiAdapterEntry, fetcher?: typeof fetch): Promise<ApiCallResult>`
  - `error_kind` set to: `'auth'` (401/403), `'quota'` (429), `'invalid_response'` (non-JSON or missing fields), `'provider'` (other non-2xx), `'network'` (fetch throws)
  - `retryable: true` for HTTP 408, 5xx; `false` for all other non-2xx

- [ ] **Step 1: Create `test/api-adapter.test.ts` with the Anthropic tests**

```typescript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { callAnthropic } from '../bin/lib/api-adapters/anthropic.js';
import type { ApiAdapterEntry, CompiledContextArtifact } from '../bin/lib/types.js';

export function minimalArtifact(): CompiledContextArtifact {
  return {
    schema_version: 1,
    kind: 'forgeai_compiled_context',
    objective: 'test objective',
    repository: { revision: null, fingerprint: 'abc123' },
    budget: { limit_tokens: 6000, estimated_tokens: 100, estimator: 'characters_divided_by_4', exhausted: false },
    selection: { max_depth: 2, max_nodes: 10, files: [] },
    rules: [],
    diagnostics: {
      git: { available: false, branch: null, revision: null, staged: 0, unstaged: 0, untracked: 0, changed_files: [], changed_files_truncated: false, diff: [], diff_truncated: false, error: null },
      validation: { package_manager: null, scripts: [] },
    },
    contracts: [],
    entrypoints: [],
    excerpts: [],
    omitted_candidates: 0,
  };
}

function anthropicConfig(): ApiAdapterEntry {
  return { provider: 'anthropic', model: 'claude-sonnet-4-6', max_tokens: 1024 };
}

test('callAnthropic: 200 → ok result with tokens', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    content: [{ type: 'text', text: 'response text' }],
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 30 },
  }), { status: 200 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, true);
  assert.equal(result.text, 'response text');
  assert.equal(result.input_tokens, 100);
  assert.equal(result.output_tokens, 50);
  assert.equal(result.cached_tokens, 30);
  assert.equal(result.http_status, 200);
  assert.equal(result.error_kind, null);
  assert.equal(result.retryable, false);
});

test('callAnthropic: 429 → quota error, retryable', async () => {
  const mockFetch = async (): Promise<Response> =>
    new Response('rate limit', { status: 429 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'quota');
  assert.equal(result.http_status, 429);
  assert.equal(result.retryable, true);
});

test('callAnthropic: 401 → auth error, not retryable', async () => {
  const mockFetch = async (): Promise<Response> =>
    new Response('invalid api key', { status: 401 });

  process.env.ANTHROPIC_API_KEY = 'bad-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'auth');
  assert.equal(result.http_status, 401);
  assert.equal(result.retryable, false);
});

test('callAnthropic: 403 → auth error', async () => {
  const mockFetch = async (): Promise<Response> => new Response('forbidden', { status: 403 });

  process.env.ANTHROPIC_API_KEY = 'bad-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.error_kind, 'auth');
  assert.equal(result.http_status, 403);
});

test('callAnthropic: 500 → provider error, retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('internal error', { status: 500 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'provider');
  assert.equal(result.http_status, 500);
  assert.equal(result.retryable, true);
});

test('callAnthropic: 400 → provider error, not retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('bad request', { status: 400 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'provider');
  assert.equal(result.retryable, false);
});

test('callAnthropic: non-JSON 200 → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response('not json', { status: 200 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callAnthropic: network error → network error_kind', async () => {
  const mockFetch = async (): Promise<Response> => { throw new Error('connection refused'); };

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'network');
  assert.equal(result.http_status, null);
  assert.equal(result.retryable, true);
});

test('callAnthropic: missing ANTHROPIC_API_KEY → auth error without calling fetch', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let fetchCalled = false;
  const mockFetch = async (): Promise<Response> => { fetchCalled = true; return new Response('{}', { status: 200 }); };
  try {
    const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
    assert.equal(result.ok, false);
    assert.equal(result.error_kind, 'auth');
    assert.equal(fetchCalled, false);
    assert.ok(result.error?.includes('ANTHROPIC_API_KEY'));
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('callAnthropic: valid JSON but null content item → invalid_response, not network', async () => {
  // Nested shape is wrong (null item in array) — must NOT throw into dispatcher's catch
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    content: [null],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
  }), { status: 200 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response', 'must not be reclassified as network');
});

test('callAnthropic: text block without text field → invalid_response', async () => {
  // type=text but text field is absent — silently returning empty string is wrong
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    content: [{ type: 'text' }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
  }), { status: 200 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callAnthropic: malformed usage fields → ok:true, tokens coerced to null', async () => {
  // Non-integer / negative usage values must not leak through as real numbers
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    content: [{ type: 'text', text: 'hello' }],
    usage: { input_tokens: 'invalid', output_tokens: null, cache_read_input_tokens: -1 },
  }), { status: 200 });
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(result.ok, true);
  assert.equal(result.input_tokens, null);
  assert.equal(result.output_tokens, null);
  assert.equal(result.cached_tokens, null);
});

test('callAnthropic: sends correct headers', async () => {
  let capturedHeaders: Record<string, string> = {};
  const mockFetch = async (_url: string, init: RequestInit): Promise<Response> => {
    capturedHeaders = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    }), { status: 200 });
  };

  process.env.ANTHROPIC_API_KEY = 'hdr-test-key';
  await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(capturedHeaders['x-api-key'], 'hdr-test-key');
  assert.equal(capturedHeaders['anthropic-version'], '2023-06-01');
  assert.equal(capturedHeaders['content-type'], 'application/json');
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test 2>&1 | grep -E "api-adapter|Error" | head -10
```

Expected: module `bin/lib/api-adapters/anthropic.js` not found.

- [ ] **Step 3: Create `bin/lib/api-adapters/anthropic.ts`**

```typescript
import type { ApiAdapterEntry, ApiCallResult, CompiledContextArtifact } from '../types.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_SYSTEM = 'You are a software engineering agent. Process the compiled context artifact and complete the objective stated in it.';

function optionalTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export async function callAnthropic(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch
): Promise<ApiCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'auth', retryable: false, error: 'ANTHROPIC_API_KEY is not set' };
  }

  const body = JSON.stringify({
    model: config.model,
    max_tokens: config.max_tokens ?? 8192,
    system: config.system ?? DEFAULT_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(artifact) }],
  });

  const start = Date.now();
  let response: Response;
  try {
    response = await fetcher(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body,
    });
  } catch (err) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: null, error_kind: 'network', retryable: true, error: String(err) };
  }

  const latency_ms = Date.now() - start;
  const status = response.status;

  if (status === 401 || status === 403) {
    const detail = await response.text().catch(() => '');
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'auth', retryable: false, error: `HTTP ${status}: ${detail.slice(0, 200)}` };
  }
  if (status === 429) {
    const detail = await response.text().catch(() => '');
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'quota', retryable: true, error: `HTTP 429: ${detail.slice(0, 200)}` };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const retryable = status === 408 || (status >= 500 && status < 600);
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'provider', retryable, error: `HTTP ${status}: ${detail.slice(0, 200)}` };
  }

  type AnthropicResponse = {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
  };
  let data: AnthropicResponse;
  try {
    data = await response.json() as AnthropicResponse;
  } catch {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response body is not valid JSON' };
  }

  if (!Array.isArray(data?.content)) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response missing content array' };
  }

  // Guard null/non-object items — avoids throw on malformed shape (which dispatcher would mis-label 'network')
  const invalidItem = data.content.find((c) => typeof c !== 'object' || c === null);
  if (invalidItem !== undefined) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response content array contains non-object item' };
  }
  // Reject text blocks that have no string text field — returning empty string would be silent data loss
  const textItems = data.content.filter((c) => c.type === 'text');
  if (textItems.some((c) => typeof c.text !== 'string')) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response has text block with non-string text field' };
  }
  const text = textItems.map((c) => c.text as string).join('');
  return {
    ok: true,
    text,
    input_tokens: optionalTokenCount(data.usage?.input_tokens),
    output_tokens: optionalTokenCount(data.usage?.output_tokens),
    cached_tokens: optionalTokenCount(data.usage?.cache_read_input_tokens),
    latency_ms,
    http_status: status,
    error_kind: null,
    retryable: false,
    error: null,
  };
}
```

- [ ] **Step 4: Run tests — all thirteen Anthropic tests pass**

```bash
npm test 2>&1 | grep -E "callAnthropic|✓|✗" | head -15
```

Expected: all thirteen pass.

- [ ] **Step 5: User commits**

```
feat(adapters): add Anthropic API provider (Phase 12A)
```

---

## Task 4: OpenAI adapter

**Files:**
- Create: `bin/lib/api-adapters/openai.ts`
- Modify: `test/api-adapter.test.ts` (append)

**Interfaces:**
- Consumes: `ApiAdapterEntry`, `ApiCallResult`, `CompiledContextArtifact` from `../types.js`
- Produces:
  - `callOpenAI(artifact: CompiledContextArtifact, config: ApiAdapterEntry, fetcher?: typeof fetch): Promise<ApiCallResult>`
  - Same `error_kind` taxonomy as Anthropic; `retryable: true` for 408/5xx
  - `cached_tokens`: OpenAI returns `prompt_tokens_details.cached_tokens`; `null` if absent

- [ ] **Step 1: Append OpenAI tests to `test/api-adapter.test.ts`**

```typescript
import { callOpenAI } from '../bin/lib/api-adapters/openai.js';

function openaiConfig(): ApiAdapterEntry {
  return { provider: 'openai', model: 'gpt-4.1', max_tokens: 1024 };
}

test('callOpenAI: 200 → ok result with tokens', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: [{ message: { content: 'openai response' } }],
    usage: { prompt_tokens: 200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 50 } },
  }), { status: 200 });

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.ok, true);
  assert.equal(result.text, 'openai response');
  assert.equal(result.input_tokens, 200);
  assert.equal(result.output_tokens, 80);
  assert.equal(result.cached_tokens, 50);
  assert.equal(result.error_kind, null);
});

test('callOpenAI: missing usage → null token counts', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: [{ message: { content: 'ok' } }],
  }), { status: 200 });

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.ok, true);
  assert.equal(result.input_tokens, null);
  assert.equal(result.cached_tokens, null);
});

test('callOpenAI: empty choices → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 0 },
  }), { status: 200 });

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callOpenAI: 429 → quota, retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('{}', { status: 429 });

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.error_kind, 'quota');
  assert.equal(result.retryable, true);
});

test('callOpenAI: 401 → auth, not retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('{}', { status: 401 });

  process.env.OPENAI_API_KEY = 'bad-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.error_kind, 'auth');
  assert.equal(result.retryable, false);
});

test('callOpenAI: 500 → provider error, retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('{}', { status: 500 });

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.error_kind, 'provider');
  assert.equal(result.retryable, true);
});

test('callOpenAI: valid JSON but message missing → invalid_response, not network', async () => {
  // choices[0] exists but no .message — accessing .message.content would throw without guard
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: [{ role: 'assistant' }],  // no 'message' key
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }), { status: 200 });

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response', 'must not be reclassified as network');
});

test('callOpenAI: missing OPENAI_API_KEY → auth, no fetch call', async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  let called = false;
  try {
    const result = await callOpenAI(minimalArtifact(), openaiConfig(), async () => { called = true; return new Response('{}', { status: 200 }); });
    assert.equal(result.error_kind, 'auth');
    assert.equal(called, false);
  } finally {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  }
});

test('callOpenAI: malformed usage fields → ok:true, tokens coerced to null', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: [{ message: { content: 'hello' } }],
    usage: { prompt_tokens: 'invalid', completion_tokens: -1 },
  }), { status: 200 });
  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;
  assert.equal(result.ok, true);
  assert.equal(result.input_tokens, null);
  assert.equal(result.output_tokens, null);
  assert.equal(result.cached_tokens, null);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test 2>&1 | grep -E "callOpenAI|Error" | head -10
```

Expected: module `bin/lib/api-adapters/openai.js` not found.

- [ ] **Step 3: Create `bin/lib/api-adapters/openai.ts`**

```typescript
import type { ApiAdapterEntry, ApiCallResult, CompiledContextArtifact } from '../types.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_SYSTEM = 'You are a software engineering agent. Process the compiled context artifact and complete the objective stated in it.';

function optionalTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export async function callOpenAI(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch
): Promise<ApiCallResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'auth', retryable: false, error: 'OPENAI_API_KEY is not set' };
  }

  const body = JSON.stringify({
    model: config.model,
    max_tokens: config.max_tokens ?? 8192,
    messages: [
      { role: 'system', content: config.system ?? DEFAULT_SYSTEM },
      { role: 'user', content: JSON.stringify(artifact) },
    ],
  });

  const start = Date.now();
  let response: Response;
  try {
    response = await fetcher(OPENAI_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body,
    });
  } catch (err) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: null, error_kind: 'network', retryable: true, error: String(err) };
  }

  const latency_ms = Date.now() - start;
  const status = response.status;

  if (status === 401 || status === 403) {
    const detail = await response.text().catch(() => '');
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'auth', retryable: false, error: `HTTP ${status}: ${detail.slice(0, 200)}` };
  }
  if (status === 429) {
    const detail = await response.text().catch(() => '');
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'quota', retryable: true, error: `HTTP 429: ${detail.slice(0, 200)}` };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const retryable = status === 408 || (status >= 500 && status < 600);
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'provider', retryable, error: `HTTP ${status}: ${detail.slice(0, 200)}` };
  }

  type OpenAIResponse = {
    choices?: Array<{ message?: { content: unknown } }>;
    usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  let data: OpenAIResponse;
  try {
    data = await response.json() as OpenAIResponse;
  } catch {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response body is not valid JSON' };
  }

  const choice = data?.choices?.[0];
  if (!choice) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response has no choices' };
  }
  // Use optional chaining — choice.message may be absent on malformed responses
  if (typeof choice.message?.content !== 'string') {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response content is not a string' };
  }

  return {
    ok: true,
    text: choice.message.content,
    input_tokens: optionalTokenCount(data.usage?.prompt_tokens),
    output_tokens: optionalTokenCount(data.usage?.completion_tokens),
    cached_tokens: optionalTokenCount(data.usage?.prompt_tokens_details?.cached_tokens),
    latency_ms,
    http_status: status,
    error_kind: null,
    retryable: false,
    error: null,
  };
}
```

- [ ] **Step 4: Run tests — all nine OpenAI tests pass**

```bash
npm test 2>&1 | grep -E "callOpenAI|✓|✗" | head -10
```

Expected: all nine pass.

- [ ] **Step 5: User commits**

```
feat(adapters): add OpenAI API provider (Phase 12A)
```

---

## Task 5: Gemini adapter

**Files:**
- Create: `bin/lib/api-adapters/gemini.ts`
- Modify: `test/api-adapter.test.ts` (append)

**Interfaces:**
- Consumes: `ApiAdapterEntry`, `ApiCallResult`, `CompiledContextArtifact` from `../types.js`
- Produces:
  - `callGemini(artifact: CompiledContextArtifact, config: ApiAdapterEntry, fetcher?: typeof fetch): Promise<ApiCallResult>`
  - API key delivered via `x-goog-api-key` **header**, not URL query string
  - `retryable: true` for 408/5xx
  - `cached_tokens`: from `usageMetadata.cachedContentTokenCount` when present, `null` otherwise

- [ ] **Step 1: Append Gemini tests to `test/api-adapter.test.ts`**

```typescript
import { callGemini } from '../bin/lib/api-adapters/gemini.js';

function geminiConfig(): ApiAdapterEntry {
  return { provider: 'gemini', model: 'gemini-2.5-flash', max_tokens: 1024 };
}

test('callGemini: 200 → ok result with tokens including cached', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'gemini response' }] } }],
    usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 60, cachedContentTokenCount: 40 },
  }), { status: 200 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.ok, true);
  assert.equal(result.text, 'gemini response');
  assert.equal(result.input_tokens, 150);
  assert.equal(result.output_tokens, 60);
  assert.equal(result.cached_tokens, 40);
  assert.equal(result.error_kind, null);
});

test('callGemini: API key sent in x-goog-api-key header, not URL', async () => {
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};
  const mockFetch = async (url: string, init: RequestInit): Promise<Response> => {
    capturedUrl = url;
    capturedHeaders = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }), { status: 200 });
  };

  process.env.GOOGLE_API_KEY = 'hdr-key-123';
  await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.ok(!capturedUrl.includes('key='), `API key must NOT appear in URL, got: ${capturedUrl}`);
  assert.equal(capturedHeaders['x-goog-api-key'], 'hdr-key-123', 'x-goog-api-key header must be set');
});

test('callGemini: 429 → quota, retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('{}', { status: 429 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.error_kind, 'quota');
  assert.equal(result.retryable, true);
});

test('callGemini: 403 → auth error', async () => {
  const mockFetch = async (): Promise<Response> => new Response('forbidden', { status: 403 });

  process.env.GOOGLE_API_KEY = 'bad-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.error_kind, 'auth');
  assert.equal(result.http_status, 403);
});

test('callGemini: 503 → provider error, retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('unavailable', { status: 503 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.error_kind, 'provider');
  assert.equal(result.retryable, true);
});

test('callGemini: missing candidates → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
  }), { status: 200 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.error_kind, 'invalid_response');
});

test('callGemini: valid JSON but candidate missing content → invalid_response, not network', async () => {
  // candidate exists but no .content — accessing .content.parts would throw without guard
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    candidates: [{ finishReason: 'SAFETY' }],  // no 'content' key
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
  }), { status: 200 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response', 'must not be reclassified as network');
});

test('callGemini: missing GOOGLE_API_KEY → auth, no fetch call', async () => {
  const saved = process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  let called = false;
  try {
    const result = await callGemini(minimalArtifact(), geminiConfig(), async () => { called = true; return new Response('{}', { status: 200 }); });
    assert.equal(result.error_kind, 'auth');
    assert.equal(called, false);
    assert.ok(result.error?.includes('GOOGLE_API_KEY'));
  } finally {
    if (saved !== undefined) process.env.GOOGLE_API_KEY = saved;
  }
});

test('callGemini: non-JSON 200 → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response('not json at all', { status: 200 });
  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callGemini: malformed usage fields → ok:true, tokens coerced to null', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'hello' }] } }],
    usageMetadata: { promptTokenCount: 'invalid', candidatesTokenCount: -1 },
  }), { status: 200 });
  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;
  assert.equal(result.ok, true);
  assert.equal(result.input_tokens, null);
  assert.equal(result.output_tokens, null);
  assert.equal(result.cached_tokens, null);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test 2>&1 | grep -E "callGemini|Error" | head -10
```

Expected: module `bin/lib/api-adapters/gemini.js` not found.

- [ ] **Step 3: Create `bin/lib/api-adapters/gemini.ts`**

```typescript
import type { ApiAdapterEntry, ApiCallResult, CompiledContextArtifact } from '../types.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_SYSTEM = 'You are a software engineering agent. Process the compiled context artifact and complete the objective stated in it.';

function optionalTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export async function callGemini(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch
): Promise<ApiCallResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'auth', retryable: false, error: 'GOOGLE_API_KEY is not set' };
  }

  const url = `${GEMINI_BASE}/${encodeURIComponent(config.model)}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(artifact) }] }],
    systemInstruction: { parts: [{ text: config.system ?? DEFAULT_SYSTEM }] },
    generationConfig: { maxOutputTokens: config.max_tokens ?? 8192 },
  });

  const start = Date.now();
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body,
    });
  } catch (err) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: null, error_kind: 'network', retryable: true, error: String(err) };
  }

  const latency_ms = Date.now() - start;
  const status = response.status;

  if (status === 401 || status === 403) {
    const detail = await response.text().catch(() => '');
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'auth', retryable: false, error: `HTTP ${status}: ${detail.slice(0, 200)}` };
  }
  if (status === 429) {
    const detail = await response.text().catch(() => '');
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'quota', retryable: true, error: `HTTP 429: ${detail.slice(0, 200)}` };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const retryable = status === 408 || (status >= 500 && status < 600);
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'provider', retryable, error: `HTTP ${status}: ${detail.slice(0, 200)}` };
  }

  type GeminiResponse = {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
  };
  let data: GeminiResponse;
  try {
    data = await response.json() as GeminiResponse;
  } catch {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response body is not valid JSON' };
  }

  const candidate = data?.candidates?.[0];
  if (!candidate) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response has no candidates' };
  }

  // Guard missing content/parts — avoids throw on safety-filtered responses
  if (!candidate.content || !Array.isArray(candidate.content.parts)) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response candidate missing content or parts' };
  }

  const text = candidate.content.parts
    .filter((p): p is { text: string } => typeof p?.text === 'string')
    .map((p) => p.text)
    .join('');

  return {
    ok: true,
    text,
    input_tokens: optionalTokenCount(data.usageMetadata?.promptTokenCount),
    output_tokens: optionalTokenCount(data.usageMetadata?.candidatesTokenCount),
    cached_tokens: optionalTokenCount(data.usageMetadata?.cachedContentTokenCount),
    latency_ms,
    http_status: status,
    error_kind: null,
    retryable: false,
    error: null,
  };
}
```

- [ ] **Step 4: Run tests — all ten Gemini tests pass**

```bash
npm test 2>&1 | grep -E "callGemini|✓|✗" | head -12
```

Expected: all ten pass.

- [ ] **Step 5: User commits**

```
feat(adapters): add Gemini API provider with x-goog-api-key header (Phase 12A)
```

---

## Task 6: Async dispatcher

**Files:**
- Create: `bin/lib/api-adapter.ts`
- Modify: `test/api-adapter.test.ts` (append dispatcher tests)

**Interfaces:**
- Consumes: `callAnthropic`, `callOpenAI`, `callGemini`; `generateRunId`, `writeRunRecord`; types from `./types.js`
- Produces:
  - `API_ADAPTERS_RELATIVE = '.ai/api-adapters.json'` (exported const)
  - `validateApiAdaptersConfig(raw: unknown): { ok: true; config: ApiAdapterConfig } | { ok: false; detail: string }` — rejects arrays, validates version (must be 1 if present), validates system is string if present, rejects empty adapter names, rejects max_tokens > 65536
  - `loadApiAdapters(repositoryRoot: string): { ok: true; config: ApiAdapterConfig } | { ok: false; detail: string } | null` — null = file absent; `ok: false` = file invalid
  - `callApiAdapter(adapterName: string, artifact: CompiledContextArtifact, artifactPath: string, repositoryRoot: string): Promise<{ result: ApiCallResult; record: RunRecord | null }>` — `record` is `null` when no API call was made (config invalid or adapter not in config)

- [ ] **Step 1: Append dispatcher tests to `test/api-adapter.test.ts`**

```typescript
import { loadApiAdapters, callApiAdapter, validateApiAdaptersConfig, API_ADAPTERS_RELATIVE } from '../bin/lib/api-adapter.js';

test('API_ADAPTERS_RELATIVE equals .ai/api-adapters.json', () => {
  assert.equal(API_ADAPTERS_RELATIVE, '.ai/api-adapters.json');
});

test('validateApiAdaptersConfig: rejects non-object (string)', () => {
  const r = validateApiAdaptersConfig('not an object');
  assert.equal(r.ok, false);
});

test('validateApiAdaptersConfig: rejects array', () => {
  const r = validateApiAdaptersConfig([{ provider: 'anthropic', model: 'm' }]);
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.toLowerCase().includes('object'));
});

test('validateApiAdaptersConfig: rejects version !== 1', () => {
  const r = validateApiAdaptersConfig({ version: 2, adapters: {} });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('version'));
});

test('validateApiAdaptersConfig: rejects unknown provider', () => {
  const r = validateApiAdaptersConfig({ version: 1, adapters: { x: { provider: 'unknown', model: 'm' } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('unknown provider'));
});

test('validateApiAdaptersConfig: rejects empty adapter name', () => {
  const r = validateApiAdaptersConfig({ version: 1, adapters: { '': { provider: 'anthropic', model: 'm' } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.toLowerCase().includes('name'));
});

test('validateApiAdaptersConfig: rejects non-string system', () => {
  const r = validateApiAdaptersConfig({ version: 1, adapters: { a: { provider: 'anthropic', model: 'm', system: 42 } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('system'));
});

test('validateApiAdaptersConfig: rejects max_tokens > 65536', () => {
  const r = validateApiAdaptersConfig({ version: 1, adapters: { a: { provider: 'anthropic', model: 'm', max_tokens: 100000 } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('max_tokens'));
});

test('validateApiAdaptersConfig: accepts valid config', () => {
  const r = validateApiAdaptersConfig({ version: 1, adapters: { a: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } });
  assert.equal(r.ok, true);
});

test('loadApiAdapters: returns null when file absent', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    assert.equal(loadApiAdapters(tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadApiAdapters: returns ok:false on malformed JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    const aiDir = path.join(tmp, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), 'not-json{');
    const r = loadApiAdapters(tmp);
    assert.ok(r !== null);
    assert.equal(r!.ok, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadApiAdapters: returns ok:false on invalid config (unknown provider)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    const aiDir = path.join(tmp, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), JSON.stringify({ adapters: { x: { provider: 'badprovider', model: 'm' } } }));
    const r = loadApiAdapters(tmp);
    assert.ok(r !== null);
    assert.equal(r!.ok, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadApiAdapters: returns valid config', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    const aiDir = path.join(tmp, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), JSON.stringify({
      version: 1,
      adapters: { anthropic: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
    }));
    const r = loadApiAdapters(tmp);
    assert.ok(r !== null && r.ok === true);
    assert.equal(r!.ok && r.config.adapters?.['anthropic']?.model, 'claude-sonnet-4-6');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('callApiAdapter: writes run record on success', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    const aiDir = path.join(tmp, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), JSON.stringify({
      adapters: { anthropic: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
    }));

    process.env.ANTHROPIC_API_KEY = 'test-key';
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    }), { status: 200 });

    try {
      const artifact = minimalArtifact();
      const { result, record } = await callApiAdapter('anthropic', artifact, '.ai/state/context/T.json', tmp);
      assert.equal(result.ok, true);
      assert.ok(record !== null);
      assert.equal(record!.outcome, 'ok');
      assert.equal(record!.provider, 'anthropic');

      const runsDir = path.join(tmp, '.ai', 'state', 'runs');
      const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json'));
      assert.equal(files.length, 1);
    } finally {
      globalThis.fetch = origFetch;
      delete process.env.ANTHROPIC_API_KEY;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('callApiAdapter: missing adapter config → error result, record is null', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    // No api-adapters.json at all — adapter not found
    const { result, record } = await callApiAdapter('anthropic', minimalArtifact(), '.ai/state/context/T.json', tmp);
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes('not found'));
    assert.equal(record, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('callApiAdapter: invalid config → error result, record is null', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    const aiDir = path.join(tmp, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), JSON.stringify({ adapters: { x: { provider: 'badprovider', model: 'm' } } }));
    const { result, record } = await callApiAdapter('x', minimalArtifact(), '.ai/state/context/T.json', tmp);
    assert.equal(result.ok, false);
    assert.equal(record, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test 2>&1 | grep -E "loadApiAdapters|callApiAdapter|validateApiAdapters|Error" | head -15
```

Expected: module `bin/lib/api-adapter.js` not found.

- [ ] **Step 3: Create `bin/lib/api-adapter.ts`**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { ApiAdapterConfig, ApiCallResult, CompiledContextArtifact, RunRecord } from './types.js';
import { callAnthropic } from './api-adapters/anthropic.js';
import { callOpenAI } from './api-adapters/openai.js';
import { callGemini } from './api-adapters/gemini.js';
import { generateRunId, writeRunRecord } from './run-record.js';
import { getErrorMessage } from './utils.js';

export const API_ADAPTERS_RELATIVE = '.ai/api-adapters.json';

const VALID_PROVIDERS = new Set(['anthropic', 'openai', 'gemini']);

export function validateApiAdaptersConfig(raw: unknown): { ok: true; config: ApiAdapterConfig } | { ok: false; detail: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, detail: 'config must be a JSON object (not an array or primitive)' };
  }
  const obj = raw as Record<string, unknown>;
  if ('version' in obj && obj['version'] !== 1) {
    return { ok: false, detail: `unsupported version ${String(obj['version'])}; expected 1` };
  }
  const adapters = obj['adapters'];
  if (adapters !== undefined) {
    if (typeof adapters !== 'object' || adapters === null || Array.isArray(adapters)) {
      return { ok: false, detail: 'adapters must be a plain object' };
    }
    for (const [name, entry] of Object.entries(adapters as Record<string, unknown>)) {
      if (name.length === 0) {
        return { ok: false, detail: 'adapter name must not be empty' };
      }
      if (typeof entry !== 'object' || entry === null) {
        return { ok: false, detail: `adapter "${name}" must be an object` };
      }
      const e = entry as Record<string, unknown>;
      if (typeof e['provider'] !== 'string') {
        return { ok: false, detail: `adapter "${name}" must have a string provider` };
      }
      if (!VALID_PROVIDERS.has(e['provider'] as string)) {
        return { ok: false, detail: `adapter "${name}" has unknown provider "${String(e['provider'])}"; expected one of: ${[...VALID_PROVIDERS].join(', ')}` };
      }
      if (typeof e['model'] !== 'string' || (e['model'] as string).length === 0) {
        return { ok: false, detail: `adapter "${name}" must have a non-empty string model` };
      }
      if (e['system'] !== undefined && typeof e['system'] !== 'string') {
        return { ok: false, detail: `adapter "${name}" system must be a string` };
      }
      if (e['max_tokens'] !== undefined) {
        if (typeof e['max_tokens'] !== 'number' || !Number.isInteger(e['max_tokens']) || (e['max_tokens'] as number) <= 0) {
          return { ok: false, detail: `adapter "${name}" max_tokens must be a positive integer` };
        }
        if ((e['max_tokens'] as number) > 65536) {
          return { ok: false, detail: `adapter "${name}" max_tokens exceeds maximum of 65536` };
        }
      }
    }
  }
  return { ok: true, config: raw as ApiAdapterConfig };
}

export function loadApiAdapters(repositoryRoot: string): { ok: true; config: ApiAdapterConfig } | { ok: false; detail: string } | null {
  const filePath = path.join(repositoryRoot, API_ADAPTERS_RELATIVE);
  if (!fs.existsSync(filePath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { ok: false, detail: `cannot parse ${API_ADAPTERS_RELATIVE}: ${getErrorMessage(err)}` };
  }
  return validateApiAdaptersConfig(raw);
}

async function dispatchProvider(
  provider: string,
  artifact: CompiledContextArtifact,
  entry: { model: string; max_tokens?: number; system?: string }
): Promise<ApiCallResult> {
  switch (provider) {
    case 'anthropic': return callAnthropic(artifact, { provider: 'anthropic', ...entry });
    case 'openai':    return callOpenAI(artifact, { provider: 'openai', ...entry });
    case 'gemini':    return callGemini(artifact, { provider: 'gemini', ...entry });
    default:
      return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'provider', retryable: false, error: `unknown provider: ${provider}` };
  }
}

export async function callApiAdapter(
  adapterName: string,
  artifact: CompiledContextArtifact,
  artifactPath: string,
  repositoryRoot: string
): Promise<{ result: ApiCallResult; record: RunRecord | null }> {
  const loaded = loadApiAdapters(repositoryRoot);

  if (loaded !== null && !loaded.ok) {
    const err = `invalid ${API_ADAPTERS_RELATIVE}: ${loaded.detail}`;
    const result: ApiCallResult = { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'provider', retryable: false, error: err };
    return { result, record: null };
  }

  const entry = loaded?.ok ? loaded.config.adapters?.[adapterName] : undefined;
  if (!entry) {
    const err = `API adapter '${adapterName}' not found in ${API_ADAPTERS_RELATIVE}`;
    const result: ApiCallResult = { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'provider', retryable: false, error: err };
    return { result, record: null };
  }

  let result: ApiCallResult;
  try {
    result = await dispatchProvider(entry.provider, artifact, entry);
  } catch (err) {
    result = { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'provider', retryable: false, error: getErrorMessage(err) };
  }

  const outcome: RunRecord['outcome'] = result.ok ? 'ok' : result.error_kind === 'quota' ? 'quota' : result.error_kind === 'auth' ? 'auth' : 'error';
  const record: RunRecord = {
    schema_version: 1, kind: 'forgeai_run_record',
    run_id: generateRunId(), timestamp: new Date().toISOString(),
    adapter: adapterName, provider: entry.provider, model: entry.model,
    artifact: artifactPath, objective: artifact.objective,
    budget_tokens: artifact.budget.limit_tokens, estimated_tokens: artifact.budget.estimated_tokens,
    input_tokens: result.input_tokens, output_tokens: result.output_tokens,
    cached_tokens: result.cached_tokens, latency_ms: result.latency_ms,
    http_status: result.http_status, outcome, error: result.error,
  };
  writeRunRecord(record, repositoryRoot);
  return { result, record };
}
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Run tests — all dispatcher tests pass**

```bash
npm test 2>&1 | grep -E "loadApiAdapters|callApiAdapter|validateApiAdapters|✓|✗" | head -25
```

Expected: all sixteen dispatcher tests pass (9 validate + 4 load + 3 callApiAdapter).

- [ ] **Step 6: User commits**

```
feat(adapters): add async dispatcher with config validation (Phase 12A)
```

---

## Task 7: Router integration and comprehensive integration tests

**Files:**
- Modify: `bin/lib/router.ts`
- Modify: `test/api-adapter.test.ts` (append router integration tests)

**Interfaces:**
- Consumes: `callApiAdapter`, `loadApiAdapters`, `API_ADAPTERS_RELATIVE` from `./api-adapter.js`
- Produces:
  - `routeToAdapter(...)` → `Promise<void>` (was `void`)
  - `runRoute()` → `Promise<void>` (was `void`)
  - Auth errors: fail fast, exit 1, no CLI fallback
  - Quota errors: warn, then fall through to `routeCliAdapter`
  - API config invalid (not absent): fail fast with error, do not silently fall through

> **CLI output detection:** `spawnSync` uses `stdio: ['pipe', 'inherit', 'inherit']` — the child writes stdout directly to FD 1, bypassing `process.stdout.write`. Tests that need to assert the CLI adapter ran must use the `CLI_MARKER` env var pattern: the CLI command writes a sentinel file when `process.env.CLI_MARKER` is set; the test asserts that file exists after the call.

- [ ] **Step 1: Append router integration tests to `test/api-adapter.test.ts`**

```typescript
import { validateArtifact, routeToAdapter } from '../bin/lib/router.js';

function makeValidArtifactFile(dir: string, artifact: CompiledContextArtifact): string {
  const aiDir = path.join(dir, '.ai', 'state', 'context');
  fs.mkdirSync(aiDir, { recursive: true });
  const p = path.join(aiDir, 'TASK.json');
  fs.writeFileSync(p, JSON.stringify(artifact));
  return p;
}

function writeApiAdapters(dir: string, content: unknown): void {
  const aiDir = path.join(dir, '.ai');
  fs.mkdirSync(aiDir, { recursive: true });
  fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), JSON.stringify(content));
}

function writeCliAdapters(dir: string): void {
  // CLI adapter writes a sentinel file when CLI_MARKER env var is set.
  // This lets tests assert CLI ran without capturing stdout (which bypasses
  // process.stdout.write via stdio: ['pipe', 'inherit', 'inherit']).
  const aiDir = path.join(dir, '.ai');
  fs.mkdirSync(aiDir, { recursive: true });
  fs.writeFileSync(path.join(aiDir, 'cli-adapters.json'), JSON.stringify({
    version: 1,
    adapters: {
      fallback: {
        command: process.execPath,
        args: ['-e', "if(process.env.CLI_MARKER)require('fs').writeFileSync(process.env.CLI_MARKER,'1')"],
        input: 'stdin',
      },
    },
  }));
}

test('routeToAdapter: API success → text written to stdout, run record created', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    writeApiAdapters(tmp, { adapters: { myapi: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } });

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'api-success-output' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    }), { status: 200 });

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => { stdoutChunks.push(String(chunk)); return true; };

    process.env.ANTHROPIC_API_KEY = 'test-key';
    try {
      await routeToAdapter(artifact, artifactPath, 'myapi', null, tmp);
    } finally {
      globalThis.fetch = origFetch;
      process.stdout.write = origWrite;
      delete process.env.ANTHROPIC_API_KEY;
    }

    assert.ok(stdoutChunks.join('').includes('api-success-output'));
    const runsDir = path.join(tmp, '.ai', 'state', 'runs');
    const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('routeToAdapter: 429 → CLI fallback runs (marker file written)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    // API adapter named "fallback" — same name as CLI adapter — so 429 triggers fallback
    writeApiAdapters(tmp, { adapters: { fallback: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } });
    writeCliAdapters(tmp);

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => new Response('rate limit', { status: 429 });

    const stderrChunks: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => { stderrChunks.push(String(chunk)); return true; };

    const markerFile = path.join(tmp, 'cli-marker.txt');
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.CLI_MARKER = markerFile;
    const savedExitCode = process.exitCode;
    try {
      await routeToAdapter(artifact, artifactPath, 'fallback', null, tmp);
    } finally {
      globalThis.fetch = origFetch;
      process.stderr.write = origStderr;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLI_MARKER;
      process.exitCode = savedExitCode;
    }

    assert.ok(stderrChunks.join('').includes('quota'), 'should warn about quota');
    assert.ok(fs.existsSync(markerFile), 'CLI fallback must run (marker file must exist)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('routeToAdapter: 401 auth error → exit 1, CLI fallback does NOT run', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    writeApiAdapters(tmp, { adapters: { myapi: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } });
    writeCliAdapters(tmp);

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => new Response('bad key', { status: 401 });

    const stderrChunks: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => { stderrChunks.push(String(chunk)); return true; };

    const markerFile = path.join(tmp, 'cli-marker-auth.txt');
    process.env.ANTHROPIC_API_KEY = 'bad-key';
    process.env.CLI_MARKER = markerFile;
    const savedExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await routeToAdapter(artifact, artifactPath, 'myapi', null, tmp);
    } finally {
      globalThis.fetch = origFetch;
      process.stderr.write = origStderr;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLI_MARKER;
    }

    assert.equal(process.exitCode, 1, 'exit code must be 1 on auth error');
    assert.ok(!fs.existsSync(markerFile), 'CLI fallback must NOT run on auth error');
    process.exitCode = savedExitCode;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('routeToAdapter: same name in API and CLI config → API takes precedence', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    writeApiAdapters(tmp, { adapters: { shared: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } });
    const aiDir = path.join(tmp, '.ai');
    fs.writeFileSync(path.join(aiDir, 'cli-adapters.json'), JSON.stringify({
      version: 1,
      adapters: { shared: { command: process.execPath, args: ['-e', "if(process.env.CLI_MARKER)require('fs').writeFileSync(process.env.CLI_MARKER,'1')"], input: 'stdin' } },
    }));

    const origFetch = globalThis.fetch;
    let apiCalled = false;
    globalThis.fetch = async (): Promise<Response> => {
      apiCalled = true;
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'api-was-called' }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      }), { status: 200 });
    };

    const markerFile = path.join(tmp, 'cli-marker-shared.txt');
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.CLI_MARKER = markerFile;
    try {
      await routeToAdapter(artifact, artifactPath, 'shared', null, tmp);
    } finally {
      globalThis.fetch = origFetch;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLI_MARKER;
    }

    assert.equal(apiCalled, true, 'API adapter must be called');
    assert.ok(!fs.existsSync(markerFile), 'CLI adapter must not run when API adapter is present');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('routeToAdapter: invalid api-adapters.json → fail fast, exit 1', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    writeApiAdapters(tmp, { adapters: { x: { provider: 'badprovider', model: 'm' } } });

    const stderrChunks: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => { stderrChunks.push(String(chunk)); return true; };

    const savedExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await routeToAdapter(artifact, artifactPath, 'x', null, tmp);
    } finally {
      process.stderr.write = origStderr;
    }

    assert.equal(process.exitCode, 1, 'exit code must be 1 on invalid config');
    assert.ok(stderrChunks.join('').toLowerCase().includes('invalid'), 'error message must mention invalid config');
    process.exitCode = savedExitCode;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('routeToAdapter: no API config → CLI adapter runs (marker file written)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    // No api-adapters.json — only cli-adapters.json
    writeCliAdapters(tmp);

    const markerFile = path.join(tmp, 'cli-marker-noapi.txt');
    process.env.CLI_MARKER = markerFile;
    try {
      await routeToAdapter(artifact, artifactPath, 'fallback', null, tmp);
    } finally {
      delete process.env.CLI_MARKER;
    }

    assert.ok(fs.existsSync(markerFile), 'CLI adapter must run when no API config exists');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to confirm the new integration tests fail**

```bash
npm test 2>&1 | grep -E "routeToAdapter|Error" | head -15
```

Expected: `routeToAdapter` is currently synchronous so typecheck fails for `Promise<void>` usage.

- [ ] **Step 3: Add import to `bin/lib/router.ts`**

After the existing imports, add:

```typescript
import { loadApiAdapters, callApiAdapter, API_ADAPTERS_RELATIVE } from './api-adapter.js';
```

- [ ] **Step 4: Extract the existing CLI routing body into `routeCliAdapter`**

Add this function before `routeToAdapter`. It contains the full existing body of `routeToAdapter` minus the `if (!adapterName)` block at the top:

```typescript
function routeCliAdapter(
  artifact: CompiledContextArtifact,
  artifactPath: string,
  adapterName: string,
  model: string | null,
  repositoryRoot: string,
  json: string
): void {
  const configPath = path.join(repositoryRoot, ADAPTERS_RELATIVE);
  if (!fs.existsSync(configPath)) {
    process.stderr.write(`Error: ${ADAPTERS_RELATIVE} not found. Run forgeai-init first.\n`);
    process.exitCode = 1;
    return;
  }
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    process.stderr.write(`Error: invalid ${ADAPTERS_RELATIVE}: ${getErrorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }
  if (typeof rawConfig !== 'object' || rawConfig === null) {
    process.stderr.write(`Error: invalid ${ADAPTERS_RELATIVE}: must be a JSON object.\n`);
    process.exitCode = 1;
    return;
  }
  const config = rawConfig as AdapterConfig;
  const adapter = config.adapters?.[adapterName];
  if (!adapter) {
    process.stderr.write(`Error: adapter '${adapterName}' not found in ${ADAPTERS_RELATIVE}.\n`);
    process.exitCode = 1;
    return;
  }
  if (typeof adapter.command !== 'string' || adapter.command.length === 0) {
    process.stderr.write(`Error: adapter '${adapterName}' has no command configured.\n`);
    process.exitCode = 1;
    return;
  }
  if (
    adapter.healthcheck !== undefined &&
    (typeof adapter.healthcheck !== 'object' || adapter.healthcheck === null || Array.isArray(adapter.healthcheck))
  ) {
    process.stderr.write(`Error: adapter '${adapterName}' healthcheck must be a plain object.\n`);
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
    const hcResult = spawnSync(adapter.command, hcArgs ?? [], { timeout: hcTimeout ?? undefined, encoding: 'utf8' });
    if (hcResult.error || hcResult.status !== 0) {
      process.stderr.write(`Error: healthcheck for '${adapterName}' failed.\n`);
      process.exitCode = 1;
      return;
    }
  }
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
    process.exitCode = 1;
  }
}
```

- [ ] **Step 5: Replace `routeToAdapter` with the async version**

```typescript
export async function routeToAdapter(
  artifact: CompiledContextArtifact,
  artifactPath: string,
  adapterName: string | null,
  model: string | null,
  repositoryRoot: string
): Promise<void> {
  const json = `${JSON.stringify(artifact, null, 2)}\n`;

  if (!adapterName) {
    process.stdout.write(json);
    appendJournal(buildJournalEntry(artifact, artifactPath, 'stdout', model, 'ok'), repositoryRoot);
    return;
  }

  // Check API adapters first
  const loaded = loadApiAdapters(repositoryRoot);

  if (loaded !== null && !loaded.ok) {
    // Config file exists but is invalid — fail fast, do not silently fall through to CLI
    process.stderr.write(`Error: invalid ${API_ADAPTERS_RELATIVE}: ${loaded.detail}\n`);
    process.exitCode = 1;
    return;
  }

  const apiEntry = loaded?.ok ? loaded.config.adapters?.[adapterName] : undefined;

  if (apiEntry) {
    const { result } = await callApiAdapter(adapterName, artifact, artifactPath, repositoryRoot);
    const status = result.ok ? 'ok' : `failed (${result.error_kind ?? 'error'})`;
    appendJournal(buildJournalEntry(artifact, artifactPath, `${adapterName} (api)`, model, status), repositoryRoot);

    if (result.ok) {
      if (result.text) process.stdout.write(result.text);
      return;
    }

    if (result.error_kind === 'auth') {
      // Auth errors never fall back — fail immediately
      process.stderr.write(`Error: API adapter '${adapterName}' authentication failed: ${result.error ?? ''}\n`);
      process.exitCode = 1;
      return;
    }

    if (result.error_kind === 'quota') {
      process.stderr.write(`${formatStatus('warn', `API adapter '${adapterName}' hit quota; falling back to CLI adapter`)}\n`);
      routeCliAdapter(artifact, artifactPath, adapterName, model, repositoryRoot, json);
      return;
    }

    // Other errors (network, provider, invalid_response) — fail
    process.stderr.write(`Error: API adapter '${adapterName}' failed: ${result.error ?? 'unknown'}\n`);
    process.exitCode = 1;
    return;
  }

  // No API adapter by this name — fall through to CLI
  routeCliAdapter(artifact, artifactPath, adapterName, model, repositoryRoot, json);
}
```

- [ ] **Step 6: Make `runRoute` async**

```typescript
export async function runRoute(): Promise<void> {
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
  await routeToAdapter(result.artifact, artifactPath, adapterName, model, root);
}
```

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors. If TypeScript complains about `routeToAdapter` being called without `await` somewhere, find the caller and add `await`.

- [ ] **Step 8: Run full test suite**

```bash
npm test
```

Expected: all existing `router.test.ts` tests still pass (CLI adapter path unchanged); all six new integration tests pass.

- [ ] **Step 9: User commits**

```
feat(router): make routeToAdapter/runRoute async; check API adapters first (Phase 12A)

Auth errors fail fast; quota falls back to CLI; invalid api-adapters.json
fails immediately instead of silently routing to CLI.
```

---

## Task 8: Template, lifecycle, preserve-on-upgrade, help, README, ROADMAP, changelog

**Files:**
- Create: `templates/.ai/api-adapters.json`
- Modify: `bin/lib/context.ts` (add `listRuns`)
- Modify: `bin/forgeai-init.ts` (await async commands; wire `--list-runs`)
- Modify: `bin/lib/init.ts` (`usage()` — add `--list-runs` and update `--route` description)
- Modify: `ROADMAP.md` (rename Phase 12 → 12A; add Phase 12B)
- Modify: `README.md` (add "API Adapters" section)
- Modify: `CHANGELOG.md`
- Modify: `package.json` (version → `3.7.0`)

**Interfaces:**
- Consumes: `runListRuns` from `./lib/run-record.js`; `runRoute` (now `Promise<void>`) from `./lib/router.js`
- Produces: shipped template; discoverable `--list-runs`; accurate `--help`; ROADMAP truthfully scoped; version `3.7.0`

- [ ] **Step 1: Create `templates/.ai/api-adapters.json`**

```json
{
  "version": 1,
  "adapters": {
    "anthropic": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "max_tokens": 8192
    },
    "openai": {
      "provider": "openai",
      "model": "gpt-4.1",
      "max_tokens": 8192
    },
    "gemini": {
      "provider": "gemini",
      "model": "gemini-2.5-flash",
      "max_tokens": 8192
    }
  }
}
```

- [ ] **Step 2: Add `listRuns` to `bin/lib/context.ts`**

After the `export const expandContext = args.has('--expand-context');` line, add:

```typescript
export const listRuns = args.has('--list-runs');
```

- [ ] **Step 3: Update `bin/forgeai-init.ts`**

Add imports:

```typescript
import { runListRuns } from './lib/run-record.js';
```

Add `listRuns` to the import list from `./lib/context.js`.

Change all async-capable commands to use `await`. Specifically, replace:

```typescript
else if (route) runRoute();
```

with:

```typescript
else if (route) await runRoute();
```

Add after that line:

```typescript
else if (listRuns) runListRuns();
```

- [ ] **Step 4: Update `usage()` in `bin/lib/init.ts`**

Locate the `--route` entry in the `usage()` function body and update it, then add `--list-runs` immediately after:

```
  --route       Route a compiled context artifact to a configured adapter.
                Checks .ai/api-adapters.json first (Anthropic, OpenAI, Gemini
                via native API), then .ai/cli-adapters.json. Requires
                --artifact <path>. Optional: --adapter <name>, --model <id>.
  --list-runs   Print all API adapter run records from .ai/state/runs/.
```

- [ ] **Step 5: Update `ROADMAP.md`**

Find the `### Phase 12 - LLM-native adapter layer` heading and rename it to:

```markdown
### Phase 12A - LLM-native adapter layer (buffered MVP)
```

Add the following annotation and new section before the `### Phase 13` heading:

```markdown
**Shipped in 3.7.0.** Covers provider interfaces, error taxonomy, config
validation, run records, async routing, and CLI fallback on quota. Streaming
output, retry loop, and provider-native lifecycle events are deferred to Phase 12B.

### Phase 12B - Streaming output and retry (deferred from 12A)

Deliverables:

- Incremental stdout from chunked `ReadableStream` responses.
- Configurable retry loop with exponential backoff for `retryable: true` results.
- Provider-native lifecycle events emitted as NDJSON to the `--watch` pipe.
- `retry_count` field added to `RunRecord`.

```

- [ ] **Step 6: Add "API Adapters" section to `README.md`**

Insert after the `## CI/CD Integration` section:

````markdown
## API Adapters

**New project:** `forgeai-init` creates `.ai/api-adapters.json` automatically
from the template.

**Existing project:** run `forgeai-init --upgrade` to add the file without
overwriting your customized config.

**Manual fallback** (only if the above does not apply):

```bash
cp node_modules/forgeai-agentic-init/templates/.ai/api-adapters.json \
   .ai/api-adapters.json
```

Set your API key in your shell or CI environment (never in project files):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=AIza...
```

Route a compiled context artifact to an API adapter:

```bash
forgeai-init --route \
  --artifact .ai/state/context/TASK-01.json \
  --adapter anthropic
```

The adapter delivers the compiled context to the provider API and writes a
JSON run record to `.ai/state/runs/`. View records with:

```bash
forgeai-init --list-runs
```

**Quota fallback:** HTTP 429 responses fall back to the matching CLI adapter
in `.ai/cli-adapters.json` if one exists.

**Auth errors** (HTTP 401/403) fail immediately — no fallback. Check that the
correct env var is set.

**Run records are best-effort.** If `.ai/state/runs/` cannot be written the
route still completes; a warning is printed to stderr.

**Native API adapters return provider text to stdout.** They do not directly
edit files or execute tools; downstream automation must apply or consume the
response. This differs from CLI adapters (Claude Code, Codex) which run
interactive agents with filesystem access.
````

- [ ] **Step 7: Bump version**

```bash
npm version 3.7.0 --no-git-tag-version
```

Expected output: `v3.7.0`

- [ ] **Step 8: Add `CHANGELOG.md` entry**

At the top of `CHANGELOG.md`, before the `## 3.6.0` block:

```markdown
## 3.7.0 — 2026-07-22

### Added

- **LLM-Native Adapter Layer** (Phase 12A — buffered MVP): `--route --adapter
  anthropic|openai|gemini` delivers a compiled context artifact to the provider
  API via Node.js built-in `fetch` (no new runtime deps). API keys from env
  vars only (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`); never
  stored in project files. Gemini key sent via `x-goog-api-key` header.
- **Normalized error taxonomy:** `ApiCallResult` carries `error_kind`
  (`auth | quota | network | provider | invalid_response`), `http_status`, and
  `retryable`. Auth errors fail fast; quota (HTTP 429) falls back to CLI adapter.
  HTTP 408/5xx responses are `retryable: true`.
- **Config validation:** `loadApiAdapters()` distinguishes missing config (null)
  from invalid config (error), preventing silent CLI fallthrough on typos.
  Validation rejects arrays, unknown providers, empty names, non-string system,
  max_tokens > 65536, and version ≠ 1.
- **Run records:** every API call writes a best-effort JSON record to
  `.ai/state/runs/<run-id>.json`. View with `forgeai-init --list-runs`.
- **`--list-runs`:** prints all run records newest-first.
- **`templates/.ai/api-adapters.json`**: starter config for Anthropic
  (`claude-sonnet-4-6`), OpenAI (`gpt-4.1`), and Gemini (`gemini-2.5-flash`).
  Copy to `.ai/api-adapters.json` and set the relevant env var.
- **`.ai/api-adapters.json` preserved on upgrade** — added to
  `PRESERVE_ON_UPGRADE_FILES`.
- Streaming output, retry loop, and lifecycle events deferred to Phase 12B.

```

- [ ] **Step 9: Run full test suite**

```bash
npm test
```

Expected: all tests pass, zero failures.

- [ ] **Step 10: Verify `--version`**

```bash
node dist/forgeai-init.js --version
```

Expected: `3.7.0`

- [ ] **Step 11: Smoke-test `--list-runs` with no records**

```bash
node dist/forgeai-init.js --list-runs
```

Expected: line containing `no run records`, exit 0.

- [ ] **Step 12: Verify `--help` shows `--list-runs`**

```bash
node dist/forgeai-init.js --help | grep -E "list-runs|route"
```

Expected: both `--list-runs` and updated `--route` description appear.

- [ ] **Step 13: User commits**

```
chore: release 3.7.0 — LLM-native adapter layer Phase 12A
```

---

## Self-Review

### Spec coverage (Phase 12A scope)

| Requirement | Task | Notes |
|---|---|---|
| Provider interfaces behind common contract (`ApiCallResult`) | 1, 3–5 | ✓ |
| Streaming output | — | Deferred to Phase 12B; ROADMAP updated in Task 8 |
| Normalized lifecycle events | — | Journal entries only; NDJSON to watch pipe deferred to 12B |
| Provider-native output limits (`max_tokens`) | 3–5 | ✓ |
| Structured input/output/cached-token/latency metadata | 1 (`RunRecord`) | ✓ |
| Retry metadata | — | `retryable` field in `ApiCallResult`; `retry_count` deferred to 12B |
| Quota metadata | 1, 6 | `error_kind: 'quota'`, `RunRecord.outcome: 'quota'` ✓ |
| Rate-limit fallback | 7 | Quota → CLI fallback ✓ |
| Secret handling — no credentials in files | 3–5 | Env vars only; Gemini uses header ✓ |
| CLI adapters as fallbacks | 7 | `routeCliAdapter` called on quota or no API entry ✓ |
| Same compiled context artifact | 7 | `--route --artifact` path unchanged ✓ |
| Provider usage data without manual transcription | 2 | `writeRunRecord` auto-called ✓ |
| Adapter failures preserve assignment/context boundaries | 7 | Auth fails fast; quota falls back; invalid config fails fast ✓ |
| `.ai/api-adapters.json` preserved on upgrade | 1 | `PRESERVE_ON_UPGRADE_FILES` updated ✓ |

### Review fixes applied (v3)

| Issue | Fix |
|---|---|
| Quota test adapter name mismatch ("myapi" vs "fallback") | Quota test now names the API adapter "fallback" to match CLI adapter |
| CLI stdout capture bypassed by `stdio: ['pipe','inherit','inherit']` | All CLI fallback tests use `CLI_MARKER` env var + marker file pattern |
| `listRunRecords` crashes on records with correct kind but missing timestamp | Added `isValidRunRecord()` guard; added test for missing-timestamp case |
| Dispatcher wrote fake `RunRecord` for non-call paths | `callApiAdapter` returns `record: null` for invalid config / adapter not found |
| Config validator missing array rejection, version check, system type, empty name, max_tokens bound | All five boundary checks added to `validateApiAdaptersConfig` |
| `retryable: false` for HTTP 5xx | `retryable = status === 408 \|\| (status >= 500 && status < 600)` in all three providers |
| "verify and replace" note left model defaults non-authoritative | Notes removed; defaults locked to confirmed-stable IDs |
| Task 6 Step 3 added TypeScript noise then Step 4 deleted it | Clean `dispatchProvider` written in Step 3; no Step 4 deletion needed |

### Review fixes applied (v4)

| Issue | Fix |
|---|---|
| Malformed 200 response throws in provider → dispatcher mis-labels as `'network'` | Anthropic: validates each content item is a non-null object; OpenAI: uses `choice.message?.content` with optional chaining + makes `message` optional in type; Gemini: guards `candidate.content` and `candidate.content.parts` before access; each provider gets a test asserting `invalid_response` not `network` |
| Gemini `cached_tokens` always `null` despite `usageMetadata.cachedContentTokenCount` | `GeminiResponse` type updated to include `cachedContentTokenCount?`; `cached_tokens` now reads it; success test asserts the value |
| `isValidRunRecord()` accepted records with invalid provider/outcome, missing numeric fields | Guard now checks `schema_version === 1`, provider union, outcome union, `latency_ms` is number, token/status fields are number-or-null |
| `generateRunId()` 16-bit suffix risks silent overwrite on collision | Replaced `randomBytes(2).toString('hex')` with `crypto.randomUUID()` (128-bit entropy) |
| README told users to manually `cp` from `node_modules` as the primary path | Primary: `forgeai-init` (new project) or `--upgrade` (existing); manual `cp` documented as explicit fallback only |

### Review fixes applied (v5)

| Issue | Fix |
|---|---|
| All 10 `@ts-expect-error` directives cause TS2578 under TypeScript 6 (unused suppression) | All removed; `globalThis.fetch` assignment is now type-safe without suppression |
| Anthropic `{"type":"text"}` block with no `text` field silently returns ok with empty string | Rejects with `invalid_response`; test `callAnthropic: text block without text field` added |
| Gemini test count mismatch — code had 8 tests but step said "all nine" | Added 9th test `callGemini: non-JSON 200 → invalid_response`; count now accurate |
| `isValidRunRecord()` missing `budget_tokens`, `estimated_tokens`, `error`, `timestamp` guards | All four checks added; new test `listRunRecords skips records with invalid budget_tokens, estimated_tokens, error, or timestamp` added (9th run-record test) |
| UUID wording said "no silent overwrite" which is technically inaccurate | Reworded to "collision risk reduced to negligible" |
| `package-lock.json` missing from File Map | Added row; kept in sync by `npm version` |
| Token metadata not validated at runtime — malformed usage values leaked as wrong type | `optionalTokenCount()` helper added to all three adapters; malformed-usage test added for each provider |
| Dispatcher `catch` maps all unexpected exceptions to `network/retryable:true` | Changed to `provider/retryable:false`; real network errors are already caught per-provider |
| Estimated-token test case absent despite title claiming coverage | `estimated_tokens: -1` record added to the invalid-fields test |
| `Date.parse()` timestamp guard accepts non-ISO strings like "July 22, 2026" | Replaced with strict round-trip: `new Date(ts).toISOString() !== ts` |
| Global constraint "malformed response → invalid_response" contradicted usage normalization | Constraint split: content shape is strict; usage metadata is best-effort (null on bad values) |
| `isValidRunRecord()` accepted negative tokens, fractional counts, latency < 0, out-of-range HTTP status | `latency_ms` requires ≥ 0; token fields require non-negative integer or null; `http_status` must be 100–599 or null |
| README API Adapters section didn't clarify adapters return text only, not file edits | Added explicit note distinguishing API adapters from CLI agents |

### Placeholder scan

No TBD, TODO, or vague steps. Every step has explicit code or exact commands. All type names, function names, and field names are consistent across tasks.

### Type consistency

- `ApiCallResult` defined in Task 1: fields `ok`, `text`, `input_tokens`, `output_tokens`, `cached_tokens`, `latency_ms`, `http_status`, `error_kind`, `retryable`, `error` — used consistently in Tasks 3, 4, 5, 6, 7.
- `RunRecord` defined in Task 1: `http_status` populated from `result.http_status` in Task 6.
- `RunRecord.outcome: 'auth'` is reachable — Task 6 maps `result.error_kind === 'auth'` → `outcome: 'auth'`.
- `callApiAdapter` returns `{ result: ApiCallResult; record: RunRecord | null }` — Task 7 destructures only `{ result }` (doesn't need `record`); dispatcher tests assert `record === null` for non-call paths.
- `loadApiAdapters` returns `{ ok: true; config } | { ok: false; detail } | null` — Task 7 checks `loaded !== null && !loaded.ok` before `loaded?.ok ? loaded.config.adapters?.[name]`.
- `routeToAdapter` and `runRoute` return `Promise<void>` — Task 8 adds `await` in the entry point.

### Review fixes applied (v7)

| Issue | Fix |
|---|---|
| `adapters[adapterName]` in dispatcher and router inherits from `Object.prototype` — `"toString"`, `"constructor"` entries in adapters object return built-in functions | Replaced bare bracket lookup with `Object.hasOwn(adapterMap, adapterName)` guard in both `api-adapter.ts` and `router.ts`; regression tests for `"toString"` and `"constructor"` added |
| OpenAI `choices: { "0": {...} }` (plain object, not array) passes `choices?.[0]` and is accepted as valid | Added `Array.isArray(data.choices)` guard before indexing; plain-object test added |
| Gemini `candidates: { "0": {...} }` (plain object, not array) same path-of-least-resistance bug | Added `Array.isArray(data.candidates)` guard before indexing; plain-object test added |
| Config validation accepted `model: "   "` (whitespace-only) as non-empty | Tightened model check: `m.trim().length === 0 \|\| m !== m.trim()` — rejects empty, whitespace-only, and surrounding-whitespace models |
| `--model --artifact foo` eats the next flag as the model value; `--model=` passes empty string silently | Added early-exit validation in `runRoute`: rejects `adapterName`/`model` that are `""` or start with `"--"` |

### Review fixes applied (v6)

| Issue | Fix |
|---|---|
| `validateApiAdaptersConfig` silently accepted unknown fields (`fallback_adaptor`, `timeout_mz`) | Added `KNOWN_TOP_FIELDS` and `KNOWN_ENTRY_FIELDS` allowlists; any key outside these sets returns `ok: false` with the offending field name |
| `fallback_adapter: " claude "` (leading/trailing whitespace) passed validation but failed lookup silently | Tightened check: `fb !== fb.trim()` now rejects surrounding whitespace in addition to empty/all-whitespace strings |
| `listRunRecords` threw unhandled `ENOTDIR` if `.ai/state/runs` existed as a file | Wrapped `fs.readdirSync` in try/catch; emits `warn` to stderr and returns `[]` |
| `ApiAdapterEntry` in plan Task 1 was missing `timeout_ms` and `fallback_adapter` fields | Updated plan type definition to include both optional fields with inline docs |
| `--model` flag in router computed `effectiveModel` before passing to `callApiAdapter` as `modelOverride`; journal also used `effectiveModel` | Documented: router computes `effectiveModel = model ?? apiEntry.model`, journals it, and passes `model` as `modelOverride` to `callApiAdapter` which also uses `effectiveModel = modelOverride ?? entry.model` internally |
| Body-level timeout (slow response body) was mis-classified as `invalid_response` | All three providers wrap `response.json()` in try/catch; `err.name === 'TimeoutError' \|\| 'AbortError'` returns `network/retryable:true`; `latency_ms` captured after body read succeeds |
| Anthropic `content: []` returned `ok: true` with empty joined string | Added `textItems.length === 0` guard → `invalid_response: 'response has no text blocks'` |
| Template `api-adapters.json` shipped without `fallback_adapter`; quota fallback used wrong CLI adapter name | Template updated with `fallback_adapter` on each entry; router uses `apiEntry.fallback_adapter ?? adapterName` for CLI fallback |
