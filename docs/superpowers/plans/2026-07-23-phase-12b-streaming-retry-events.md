# Phase 12B — Streaming, Retry, and Lifecycle Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in streaming output, a retry loop with exponential backoff, and NDJSON lifecycle events to the LLM-native adapter layer, plus a `retry_count` field on run records.

**Architecture:** Providers gain an optional `onDelta` callback that switches them to SSE streaming while still returning the same `ApiCallResult`. `callApiAdapter` wraps provider dispatch in a retry loop and emits coarse lifecycle events. The router threads a `--stream` flag down and writes deltas straight to stdout. All new behavior is transparent when `--stream` is absent and no watch pipe exists.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node 20+ `fetch` / `ReadableStream` / `TextDecoder`, `node:test` + `node:assert/strict`, Ink for the TUI reducer.

## Global Constraints

- Node `>=20.0.0`. ESM only; import local modules with `.js` specifiers.
- The Phase 12A buffered path must remain byte-for-byte unchanged when `--stream` is absent and no retryable failure occurs.
- Provider `call*` functions keep `fetcher: typeof fetch = fetch` as the third parameter (existing tests depend on it); `onDelta` is appended as the fourth parameter.
- Lifecycle event `ts` is Unix epoch **seconds** (`Math.floor(Date.now() / 1000)`).
- `retry_count` defaults to `0`; `streamed` defaults to `false`.
- Config caps: `max_retries` integer `0..5`; `retry_base_ms` integer `1..30000`.
- The user commits every change themselves — **do not run `git commit`**. Each task's final step lists the exact `git add` + commit message for the user to run.
- No CI work.
- Run the full suite with `npm test` (runs typecheck + build + `node --test`).

---

## File Structure

- Create `bin/lib/api-adapters/sse.ts` — `parseSSE` async generator (shared SSE line parser).
- Create `bin/lib/run-events.ts` — `RunEvent` union + `emitRunEvent` + `nowSeconds`.
- Modify `bin/lib/types.ts` — add fields to `ApiAdapterEntry`, `ApiCallResult`, `RunRecord`.
- Modify `bin/lib/api-adapter.ts` — config validation for new fields; retry loop; event emission; latency totalling; `CallApiAdapterOptions`.
- Modify `bin/lib/api-adapters/{anthropic,openai,gemini}.ts` — `onDelta` streaming path.
- Modify `bin/lib/run-record.ts` — `retry_count` normalize on read/validate.
- Modify `bin/lib/router.ts` — `--stream` wiring, no double-write, no fallback after streamed bytes.
- Modify `bin/lib/context.ts` — parse `--stream` boolean flag.
- Modify `bin/ui/types.ts` + `bin/ui/reducer.ts` — `ForgeEvent` fields + three reducer cases.
- Modify `test/*.test.ts` — new tests per task.
- Modify docs + version files in the final task.

---

## Task 1: Schema fields and config validation

**Files:**
- Modify: `bin/lib/types.ts`
- Modify: `bin/lib/api-adapter.ts` (validator + every `ApiCallResult` literal)
- Modify: `bin/lib/api-adapters/anthropic.ts`, `openai.ts`, `gemini.ts` (every `ApiCallResult` literal — add the two constant fields)
- Test: `test/api-adapter.test.ts`

**Interfaces:**
- Produces: `ApiAdapterEntry.max_retries?: number`, `ApiAdapterEntry.retry_base_ms?: number`; `ApiCallResult.streamed: boolean`; `ApiCallResult.retry_count: number`; `RunRecord.retry_count: number`.

- [ ] **Step 1: Add the type fields**

In `bin/lib/types.ts`, extend three types:

```ts
export type ApiAdapterEntry = {
  provider: ApiAdapterProvider;
  model: string;
  max_tokens?: number;
  system?: string;
  timeout_ms?: number;
  fallback_adapter?: string;
  max_retries?: number;
  retry_base_ms?: number;
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
  streamed: boolean;
  retry_count: number;
  error: string | null;
};

export type RunRecord = {
  // ...all existing fields unchanged...
  outcome: 'ok' | 'quota' | 'auth' | 'error';
  retry_count: number;
  error: string | null;
};
```

- [ ] **Step 2: Make every existing `ApiCallResult` literal compile**

`streamed` and `retry_count` are now required. Every existing object literal that constructs an `ApiCallResult` must add `streamed: false, retry_count: 0`. This is a uniform mechanical edit — apply it to **all** literals in these files:
`bin/lib/api-adapters/anthropic.ts`, `openai.ts`, `gemini.ts`, and `bin/lib/api-adapter.ts`.

Transformation (example — apply the same two fields to every literal):

```ts
// before
return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'auth', retryable: false, error: '...' };
// after
return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'auth', retryable: false, streamed: false, retry_count: 0, error: '...' };
```

In `api-adapter.ts`, also update the `RunRecord` object built in `callApiAdapter` to include `retry_count: result.retry_count` (the field exists on the result after Step 1; for now results carry `0`).

- [ ] **Step 3: Add validation for the two config fields**

In `bin/lib/api-adapter.ts`, add both names to the whitelist and validate them:

```ts
const KNOWN_ENTRY_FIELDS = new Set(['provider', 'model', 'max_tokens', 'system', 'timeout_ms', 'fallback_adapter', 'max_retries', 'retry_base_ms']);
```

Inside the per-entry validation loop (after the `timeout_ms` block), add:

```ts
if (e['max_retries'] !== undefined) {
  if (typeof e['max_retries'] !== 'number' || !Number.isInteger(e['max_retries']) || (e['max_retries'] as number) < 0) {
    return { ok: false, detail: `adapter "${name}" max_retries must be a non-negative integer` };
  }
  if ((e['max_retries'] as number) > 5) {
    return { ok: false, detail: `adapter "${name}" max_retries exceeds maximum of 5` };
  }
}
if (e['retry_base_ms'] !== undefined) {
  if (typeof e['retry_base_ms'] !== 'number' || !Number.isInteger(e['retry_base_ms']) || (e['retry_base_ms'] as number) <= 0) {
    return { ok: false, detail: `adapter "${name}" retry_base_ms must be a positive integer` };
  }
  if ((e['retry_base_ms'] as number) > 30000) {
    return { ok: false, detail: `adapter "${name}" retry_base_ms exceeds maximum of 30000` };
  }
}
```

- [ ] **Step 4: Write the failing validation tests**

Append to `test/api-adapter.test.ts` (import `validateApiAdaptersConfig` is already imported in that file; if not, add it to the existing import from `../bin/lib/api-adapter.js`):

```ts
test('validateApiAdaptersConfig: accepts max_retries and retry_base_ms including 0', () => {
  const res = validateApiAdaptersConfig({ version: 1, adapters: {
    a: { provider: 'anthropic', model: 'claude-sonnet-4-6', max_retries: 0, retry_base_ms: 250 },
  }});
  assert.equal(res.ok, true);
});

for (const bad of [-1, 2.5, 6]) {
  test(`validateApiAdaptersConfig: rejects max_retries ${bad}`, () => {
    const res = validateApiAdaptersConfig({ adapters: { a: { provider: 'openai', model: 'gpt-x', max_retries: bad } } });
    assert.equal(res.ok, false);
  });
}
for (const bad of [0, -5, 1.5, 30001]) {
  test(`validateApiAdaptersConfig: rejects retry_base_ms ${bad}`, () => {
    const res = validateApiAdaptersConfig({ adapters: { a: { provider: 'openai', model: 'gpt-x', retry_base_ms: bad } } });
    assert.equal(res.ok, false);
  });
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all pass (validation tests green; providers still compile with the two new constant fields).

- [ ] **Step 6: Commit (user runs)**

```bash
git add bin/lib/types.ts bin/lib/api-adapter.ts bin/lib/api-adapters/*.ts test/api-adapter.test.ts
git commit -m "feat(adapters): add retry/stream schema fields and retry config validation (Phase 12B)"
```

---

## Task 2: SSE line parser

**Files:**
- Create: `bin/lib/api-adapters/sse.ts`
- Test: `test/sse.test.ts`

**Interfaces:**
- Produces: `export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string>` — yields one string per SSE event, containing the joined `data:` payload(s). `[DONE]` is yielded verbatim as `"[DONE]"`. Comment lines (`:` heartbeat) and non-`data` fields are skipped. Handles frames split across chunks, multi-byte UTF-8 split across chunks, `\n` and `\r\n`, and EOF with no trailing blank line.

- [ ] **Step 1: Write the failing tests**

Create `test/sse.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSSE } from '../bin/lib/api-adapters/sse.js';

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}
const enc = (s: string) => new TextEncoder().encode(s);

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of parseSSE(stream)) out.push(d);
  return out;
}

test('parseSSE: single event', async () => {
  assert.deepEqual(await collect(streamFromChunks([enc('data: {"a":1}\n\n')])), ['{"a":1}']);
});

test('parseSSE: JSON frame split across chunks', async () => {
  assert.deepEqual(await collect(streamFromChunks([enc('data: {"a":'), enc('1}\n\n')])), ['{"a":1}']);
});

test('parseSSE: multi-byte UTF-8 split across chunks', async () => {
  const bytes = enc('data: {"t":"é"}\n\n');       // é is 2 bytes
  const cut = bytes.indexOf(enc('é')[0]);          // split inside the é
  assert.deepEqual(await collect(streamFromChunks([bytes.slice(0, cut + 1), bytes.slice(cut + 1)])), ['{"t":"é"}']);
});

test('parseSSE: CRLF delimiters', async () => {
  assert.deepEqual(await collect(streamFromChunks([enc('data: x\r\n\r\ndata: y\r\n\r\n')])), ['x', 'y']);
});

test('parseSSE: comments and multi-line data', async () => {
  assert.deepEqual(await collect(streamFromChunks([enc(': ping\ndata: a\ndata: b\n\n')])), ['a\nb']);
});

test('parseSSE: [DONE] sentinel yielded verbatim', async () => {
  assert.deepEqual(await collect(streamFromChunks([enc('data: [DONE]\n\n')])), ['[DONE]']);
});

test('parseSSE: EOF without trailing blank line still yields', async () => {
  assert.deepEqual(await collect(streamFromChunks([enc('data: {"a":1}')])), ['{"a":1}']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test test/sse.test.ts`
Expected: FAIL — cannot find module `sse.js`.

- [ ] **Step 3: Implement `parseSSE`**

Create `bin/lib/api-adapters/sse.ts`:

```ts
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];

  // Returns a payload to yield when a blank line closes an event, else null.
  const takeLine = (raw: string): string | null => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '') {
      if (dataLines.length > 0) {
        const payload = dataLines.join('\n');
        dataLines = [];
        return payload;
      }
      return null;
    }
    if (line.startsWith(':')) return null;               // comment / heartbeat
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));   // strip one optional leading space
    }
    return null;                                          // event:, id:, retry: ignored
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const payload = takeLine(line);
        if (payload !== null) yield payload;
      }
    }
    buffer += decoder.decode();            // flush any trailing multi-byte char
    if (buffer.length > 0) {
      const payload = takeLine(buffer);    // final line without a newline
      if (payload !== null) yield payload;
    }
    if (dataLines.length > 0) {            // EOF: data with no terminating blank line
      yield dataLines.join('\n');
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test test/sse.test.ts`
Expected: PASS (all 7).

- [ ] **Step 5: Commit (user runs)**

```bash
git add bin/lib/api-adapters/sse.ts test/sse.test.ts
git commit -m "feat(adapters): add SSE line parser (Phase 12B)"
```

---

## Task 3: Anthropic streaming

**Files:**
- Modify: `bin/lib/api-adapters/anthropic.ts`
- Test: `test/api-adapter.test.ts`

**Interfaces:**
- Consumes: `parseSSE` (Task 2).
- Produces: `callAnthropic(artifact, config, fetcher?, onDelta?)`. When `onDelta` is passed, sends `stream: true`, calls `onDelta(text)` per delta, and returns an aggregated `ApiCallResult`. Buffered behavior (no `onDelta`) is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to the Anthropic section of `test/api-adapter.test.ts`. Import at top of file: `import { parseSSE } from '../bin/lib/api-adapters/sse.js';` is not needed here; only the provider is used. Add a helper near the top of the file (once, reused by Tasks 3–5):

```ts
function sseStream(...frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(c) { if (i < frames.length) c.enqueue(enc.encode(frames[i++])); else c.close(); },
  });
}
function sseResponse(...frames: string[]): Response {
  return new Response(sseStream(...frames), { status: 200 });
}
```

Tests:

```ts
test('callAnthropic streaming: aggregates deltas, usage, cached tokens', async () => {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":30}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hel"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"lo"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":50}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  process.env.ANTHROPIC_API_KEY = 'k';
  const chunks: string[] = [];
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), (async () => sseResponse(...frames)) as unknown as typeof fetch, (t) => chunks.push(t));
  delete process.env.ANTHROPIC_API_KEY;
  assert.deepEqual(chunks, ['Hel', 'lo']);
  assert.equal(result.ok, true);
  assert.equal(result.text, 'Hello');
  assert.equal(result.streamed, true);
  assert.equal(result.input_tokens, 100);
  assert.equal(result.output_tokens, 50);
  assert.equal(result.cached_tokens, 30);
});

test('callAnthropic streaming: overloaded_error before first delta → provider, retryable', async () => {
  const frames = ['event: error\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n\n'];
  process.env.ANTHROPIC_API_KEY = 'k';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), (async () => sseResponse(...frames)) as unknown as typeof fetch, () => {});
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'provider');
  assert.equal(result.retryable, true);
  assert.equal(result.streamed, false);
});

test('callAnthropic streaming: EOF without message_stop → invalid_response', async () => {
  const frames = ['event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n'];
  process.env.ANTHROPIC_API_KEY = 'k';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), (async () => sseResponse(...frames)) as unknown as typeof fetch, () => {});
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
  assert.equal(result.streamed, true);
  assert.equal(result.retryable, false);
});

test('callAnthropic streaming: malformed JSON after a delta → invalid_response, streamed', async () => {
  const frames = [
    'data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n',
    'data: {not json}\n\n',
  ];
  process.env.ANTHROPIC_API_KEY = 'k';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), (async () => sseResponse(...frames)) as unknown as typeof fetch, () => {});
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(result.error_kind, 'invalid_response');
  assert.equal(result.streamed, true);
  assert.equal(result.retryable, false);
});

test('callAnthropic streaming: 429 before body still classifies as quota', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), (async () => new Response('rl', { status: 429 })) as unknown as typeof fetch, () => {});
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(result.error_kind, 'quota');
  assert.equal(result.retryable, true);
  assert.equal(result.streamed, false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test test/api-adapter.test.ts`
Expected: FAIL — `callAnthropic` ignores `onDelta` / no streaming.

- [ ] **Step 3: Implement the streaming branch**

In `bin/lib/api-adapters/anthropic.ts`:

1. Add the import: `import { parseSSE } from './sse.js';`
2. Change the signature to accept `onDelta`:

```ts
export async function callAnthropic(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch,
  onDelta?: (text: string) => void
): Promise<ApiCallResult> {
```

3. When streaming, add `stream: true` to the request body:

```ts
const body = JSON.stringify({
  model: config.model,
  max_tokens: config.max_tokens ?? 8192,
  system: config.system ?? DEFAULT_SYSTEM,
  messages: [{ role: 'user', content: JSON.stringify(artifact) }],
  ...(onDelta ? { stream: true } : {}),
});
```

4. Keep the existing `fetcher(...)` call and all HTTP-status error branches (401/403/429/non-ok) exactly as they are — they set `streamed: false` already (Task 1). After the `if (!response.ok)` block, insert the streaming branch **before** the buffered `response.json()` logic:

```ts
if (onDelta) {
  if (!response.body) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'streaming response has no body' };
  }
  let text = '';
  let input: number | null = null, output: number | null = null, cached: number | null = null;
  let streamed = false;
  let sawStop = false;
  const fail = (kind: ApiCallResult['error_kind'], retryable: boolean, msg: string): ApiCallResult => ({
    ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null,
    latency_ms: Date.now() - start, http_status: status, error_kind: kind,
    retryable: streamed ? false : retryable, streamed, retry_count: 0, error: msg,
  });
  try {
    for await (const data of parseSSE(response.body)) {
      let evt: { type?: string; delta?: { text?: unknown }; message?: { usage?: Record<string, unknown> }; usage?: Record<string, unknown>; error?: { type?: string } };
      try { evt = JSON.parse(data); }
      catch { return { ...fail('invalid_response', false, 'malformed SSE event JSON') }; }
      switch (evt.type) {
        case 'message_start':
          input = optionalTokenCount(evt.message?.usage?.['input_tokens']);
          cached = optionalTokenCount(evt.message?.usage?.['cache_read_input_tokens']);
          break;
        case 'content_block_delta': {
          const d = evt.delta?.text;
          if (typeof d === 'string' && d.length > 0) { text += d; streamed = true; onDelta(d); }
          break;
        }
        case 'message_delta': {
          const o = optionalTokenCount(evt.usage?.['output_tokens']);
          if (o !== null) output = o;
          break;
        }
        case 'error':
          return streamed
            ? fail('invalid_response', false, 'stream error after output began')
            : fail('provider', evt.error?.type === 'overloaded_error', `stream error: ${evt.error?.type ?? 'unknown'}`);
        case 'message_stop':
          sawStop = true;
          break;
        default:
          break; // ping / unknown ignored
      }
    }
  } catch {
    return fail('network', true, 'stream read failed');
  }
  if (!sawStop) return fail('invalid_response', false, 'stream ended before message_stop');
  if (text.trim().length === 0) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'response text is empty' };
  }
  return { ok: true, text, input_tokens: input, output_tokens: output, cached_tokens: cached, latency_ms: Date.now() - start, http_status: status, error_kind: null, retryable: false, streamed: true, retry_count: 0, error: null };
}
```

Note: `optionalTokenCount` already exists in the file. The buffered `response.json()` block below stays unchanged and only runs when `onDelta` is undefined.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test test/api-adapter.test.ts`
Expected: PASS (new streaming tests + all existing buffered tests).

- [ ] **Step 5: Commit (user runs)**

```bash
git add bin/lib/api-adapters/anthropic.ts test/api-adapter.test.ts
git commit -m "feat(adapters): add Anthropic streaming with completion contract (Phase 12B)"
```

---

## Task 4: OpenAI streaming

**Files:**
- Modify: `bin/lib/api-adapters/openai.ts`
- Test: `test/api-adapter.test.ts`

**Interfaces:**
- Consumes: `parseSSE`, `sseResponse` helper (Task 3).
- Produces: `callOpenAI(artifact, config, fetcher?, onDelta?)`. Streaming sends `stream: true` and `stream_options: { include_usage: true }`; succeeds only after `[DONE]`.

- [ ] **Step 1: Write the failing tests**

Add to the OpenAI section of `test/api-adapter.test.ts`:

```ts
test('callOpenAI streaming: aggregates deltas + usage from final chunk, requires [DONE]', async () => {
  const frames = [
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"prompt_tokens_details":{"cached_tokens":20}}}\n\n',
    'data: [DONE]\n\n',
  ];
  process.env.OPENAI_API_KEY = 'k';
  const chunks: string[] = [];
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), (async () => sseResponse(...frames)) as unknown as typeof fetch, (t) => chunks.push(t));
  delete process.env.OPENAI_API_KEY;
  assert.deepEqual(chunks, ['Hel', 'lo']);
  assert.equal(result.text, 'Hello');
  assert.equal(result.input_tokens, 100);
  assert.equal(result.output_tokens, 50);
  assert.equal(result.cached_tokens, 20);
  assert.equal(result.streamed, true);
});

test('callOpenAI streaming: EOF without [DONE] → invalid_response', async () => {
  const frames = ['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'];
  process.env.OPENAI_API_KEY = 'k';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), (async () => sseResponse(...frames)) as unknown as typeof fetch, () => {});
  delete process.env.OPENAI_API_KEY;
  assert.equal(result.error_kind, 'invalid_response');
  assert.equal(result.streamed, true);
  assert.equal(result.retryable, false);
});

test('callOpenAI streaming: missing body → invalid_response, not streamed', async () => {
  process.env.OPENAI_API_KEY = 'k';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), (async () => new Response(null, { status: 200 })) as unknown as typeof fetch, () => {});
  delete process.env.OPENAI_API_KEY;
  assert.equal(result.error_kind, 'invalid_response');
  assert.equal(result.streamed, false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test test/api-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `bin/lib/api-adapters/openai.ts`: add `import { parseSSE } from './sse.js';`, append `onDelta?` param, add streaming request fields, and insert the streaming branch after the `!response.ok` block:

```ts
// request body when streaming:
const body = JSON.stringify({
  model: config.model,
  max_tokens: config.max_tokens ?? 8192,
  messages: [
    { role: 'system', content: config.system ?? DEFAULT_SYSTEM },
    { role: 'user', content: JSON.stringify(artifact) },
  ],
  ...(onDelta ? { stream: true, stream_options: { include_usage: true } } : {}),
});
```

```ts
if (onDelta) {
  if (!response.body) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'streaming response has no body' };
  }
  let text = '';
  let input: number | null = null, output: number | null = null, cached: number | null = null;
  let streamed = false;
  let sawDone = false;
  const fail = (kind: ApiCallResult['error_kind'], retryable: boolean, msg: string): ApiCallResult => ({
    ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null,
    latency_ms: Date.now() - start, http_status: status, error_kind: kind,
    retryable: streamed ? false : retryable, streamed, retry_count: 0, error: msg,
  });
  try {
    for await (const data of parseSSE(response.body)) {
      if (data === '[DONE]') { sawDone = true; break; }
      let evt: { choices?: Array<{ delta?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } } };
      try { evt = JSON.parse(data); }
      catch { return fail('invalid_response', false, 'malformed SSE event JSON'); }
      const c = evt.choices?.[0]?.delta?.content;
      if (typeof c === 'string' && c.length > 0) { text += c; streamed = true; onDelta(c); }
      if (evt.usage) {
        input = optionalTokenCount(evt.usage.prompt_tokens);
        output = optionalTokenCount(evt.usage.completion_tokens);
        cached = optionalTokenCount(evt.usage.prompt_tokens_details?.cached_tokens);
      }
    }
  } catch {
    return fail('network', true, 'stream read failed');
  }
  if (!sawDone) return fail('invalid_response', false, 'stream ended before [DONE]');
  if (text.trim().length === 0) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'response text is empty' };
  }
  return { ok: true, text, input_tokens: input, output_tokens: output, cached_tokens: cached, latency_ms: Date.now() - start, http_status: status, error_kind: null, retryable: false, streamed: true, retry_count: 0, error: null };
}
```

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test test/api-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (user runs)**

```bash
git add bin/lib/api-adapters/openai.ts test/api-adapter.test.ts
git commit -m "feat(adapters): add OpenAI streaming with [DONE] completion contract (Phase 12B)"
```

---

## Task 5: Gemini streaming

**Files:**
- Modify: `bin/lib/api-adapters/gemini.ts`
- Test: `test/api-adapter.test.ts`

**Interfaces:**
- Consumes: `parseSSE`, `sseResponse` helper.
- Produces: `callGemini(artifact, config, fetcher?, onDelta?)`. Streaming uses the `:streamGenerateContent?alt=sse` endpoint; a clean EOF is the completion marker (no sentinel).

- [ ] **Step 1: Write the failing tests**

Add to the Gemini section of `test/api-adapter.test.ts`:

```ts
test('callGemini streaming: aggregates parts + usage on clean EOF', async () => {
  const frames = [
    'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":50,"cachedContentTokenCount":10}}\n\n',
  ];
  process.env.GOOGLE_API_KEY = 'k';
  const chunks: string[] = [];
  const result = await callGemini(minimalArtifact(), geminiConfig(), (async () => sseResponse(...frames)) as unknown as typeof fetch, (t) => chunks.push(t));
  delete process.env.GOOGLE_API_KEY;
  assert.deepEqual(chunks, ['Hel', 'lo']);
  assert.equal(result.text, 'Hello');
  assert.equal(result.input_tokens, 100);
  assert.equal(result.output_tokens, 50);
  assert.equal(result.cached_tokens, 10);
  assert.equal(result.streamed, true);
});

test('callGemini streaming: uses :streamGenerateContent?alt=sse endpoint', async () => {
  let seenUrl = '';
  process.env.GOOGLE_API_KEY = 'k';
  await callGemini(minimalArtifact(), geminiConfig(), (async (u: string) => { seenUrl = u; return sseResponse('data: {"candidates":[{"content":{"parts":[{"text":"x"}]}}]}\n\n'); }) as unknown as typeof fetch, () => {});
  delete process.env.GOOGLE_API_KEY;
  assert.ok(seenUrl.includes(':streamGenerateContent'));
  assert.ok(seenUrl.includes('alt=sse'));
});

test('callGemini streaming: malformed JSON before any delta → invalid_response, not retryable', async () => {
  process.env.GOOGLE_API_KEY = 'k';
  const result = await callGemini(minimalArtifact(), geminiConfig(), (async () => sseResponse('data: {bad}\n\n')) as unknown as typeof fetch, () => {});
  delete process.env.GOOGLE_API_KEY;
  assert.equal(result.error_kind, 'invalid_response');
  assert.equal(result.streamed, false);
  assert.equal(result.retryable, false);
});
```

If `geminiConfig()` does not already exist in the file, add: `function geminiConfig(): ApiAdapterEntry { return { provider: 'gemini', model: 'gemini-2.5-pro', max_tokens: 1024 }; }` (mirror the existing `openaiConfig`/`anthropicConfig` helpers).

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test test/api-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `bin/lib/api-adapters/gemini.ts`: add `import { parseSSE } from './sse.js';`, append `onDelta?` param, choose the URL, and add the streaming branch:

```ts
const url = onDelta
  ? `${GEMINI_BASE}/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`
  : `${GEMINI_BASE}/${encodeURIComponent(config.model)}:generateContent`;
```

```ts
if (onDelta) {
  if (!response.body) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'streaming response has no body' };
  }
  let text = '';
  let input: number | null = null, output: number | null = null, cached: number | null = null;
  let streamed = false;
  const fail = (kind: ApiCallResult['error_kind'], retryable: boolean, msg: string): ApiCallResult => ({
    ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null,
    latency_ms: Date.now() - start, http_status: status, error_kind: kind,
    retryable: streamed ? false : retryable, streamed, retry_count: 0, error: msg,
  });
  try {
    for await (const data of parseSSE(response.body)) {
      let evt: { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>; usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; cachedContentTokenCount?: unknown } };
      try { evt = JSON.parse(data); }
      catch { return fail('invalid_response', false, 'malformed SSE event JSON'); }
      const parts = evt.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          if (typeof p?.text === 'string' && p.text.length > 0) { text += p.text; streamed = true; onDelta(p.text); }
        }
      }
      if (evt.usageMetadata) {
        input = optionalTokenCount(evt.usageMetadata.promptTokenCount);
        output = optionalTokenCount(evt.usageMetadata.candidatesTokenCount);
        cached = optionalTokenCount(evt.usageMetadata.cachedContentTokenCount);
      }
    }
  } catch {
    return fail('network', true, 'stream read failed');
  }
  if (text.trim().length === 0) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'response text is empty' };
  }
  return { ok: true, text, input_tokens: input, output_tokens: output, cached_tokens: cached, latency_ms: Date.now() - start, http_status: status, error_kind: null, retryable: false, streamed: true, retry_count: 0, error: null };
}
```

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test test/api-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (user runs)**

```bash
git add bin/lib/api-adapters/gemini.ts test/api-adapter.test.ts
git commit -m "feat(adapters): add Gemini SSE streaming (Phase 12B)"
```

---

## Task 6: Lifecycle events module + retry loop

**Files:**
- Create: `bin/lib/run-events.ts`
- Modify: `bin/lib/api-adapter.ts`
- Test: `test/run-events.test.ts`, `test/api-adapter.test.ts`

**Interfaces:**
- Produces: `RunEvent` union, `emitRunEvent(event)`, `nowSeconds()`.
- Produces: `CallApiAdapterOptions` and the updated `callApiAdapter(adapterName, artifact, artifactPath, repositoryRoot, modelOverride?, options?)`. `options.dispatch`, `options.sleep`, `options.emitEvent`, `options.now`, `options.stream`, `options.onDelta` are all injectable and default to real implementations.

- [ ] **Step 1: Write the failing run-events test**

Create `test/run-events.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { nowSeconds, type RunEvent } from '../bin/lib/run-events.js';

test('nowSeconds returns integer epoch seconds', () => {
  const s = nowSeconds();
  assert.ok(Number.isInteger(s));
  assert.ok(Math.abs(s - Date.now() / 1000) < 5);
});

test('RunEvent union shape compiles', () => {
  const e: RunEvent = { type: 'run_start', ts: 1, adapter: 'a', provider: 'anthropic', model: 'm', objective: 'o', budget_tokens: 100 };
  assert.equal(e.type, 'run_start');
});
```

- [ ] **Step 2: Implement `run-events.ts`**

Create `bin/lib/run-events.ts`:

```ts
import { emitToPipe, getPipePath } from '../ui/pipe.js';

export type RunEvent =
  | { type: 'run_start'; ts: number; adapter: string; provider: string; model: string; objective: string; budget_tokens: number }
  | { type: 'retry_attempt'; ts: number; adapter: string; attempt: number; error_kind: string; delay_ms: number }
  | { type: 'run_complete'; ts: number; adapter: string; outcome: string; input_tokens: number | null; output_tokens: number | null; latency_ms: number; retry_count: number };

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function emitRunEvent(event: RunEvent): void {
  try {
    emitToPipe(getPipePath(), JSON.stringify(event));
  } catch {
    // best-effort: no pipe running, or buffer full (EAGAIN) — drop the event
  }
}
```

- [ ] **Step 3: Run run-events tests**

Run: `node --import tsx --test test/run-events.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing retry tests**

Add to `test/api-adapter.test.ts` (near the existing `callApiAdapter` tests). These use a temp repo with a valid `.ai/api-adapters.json` and inject `dispatch`/`sleep`/`emitEvent`. Reuse the temp-dir pattern already in the file (`fs.mkdtempSync(path.join(os.tmpdir(), ...))`) and write the config:

```ts
import type { ApiCallResult } from '../bin/lib/types.js';
import type { RunEvent } from '../bin/lib/run-events.js';

function okResult(over: Partial<ApiCallResult> = {}): ApiCallResult {
  return { ok: true, text: 'x', input_tokens: 1, output_tokens: 2, cached_tokens: null, latency_ms: 5, http_status: 200, error_kind: null, retryable: false, streamed: false, retry_count: 0, error: null, ...over };
}
function failResult(over: Partial<ApiCallResult> = {}): ApiCallResult {
  return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 5, http_status: 500, error_kind: 'provider', retryable: true, streamed: false, retry_count: 0, error: 'boom', ...over };
}
function writeApiConfig(tmp: string, entry: Record<string, unknown>): void {
  fs.mkdirSync(path.join(tmp, '.ai'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.ai/api-adapters.json'), JSON.stringify({ version: 1, adapters: { myapi: { provider: 'anthropic', model: 'claude-sonnet-4-6', ...entry } } }));
}

test('callApiAdapter: retries retryable failures then succeeds; records retry_count and delays', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-retry-'));
  writeApiConfig(tmp, { max_retries: 3, retry_base_ms: 100 });
  const results = [failResult(), failResult(), okResult()];
  let calls = 0;
  const delays: number[] = [];
  const events: RunEvent[] = [];
  const { result, record } = await callApiAdapter('myapi', minimalArtifact(), '.ai/state/context/T.json', tmp, null, {
    dispatch: async () => results[calls++],
    sleep: async (ms) => { delays.push(ms); },
    emitEvent: (e) => events.push(e),
  });
  assert.equal(result.ok, true);
  assert.equal(result.retry_count, 2);
  assert.deepEqual(delays, [100, 200]);            // base * 2^0, base * 2^1
  assert.equal(record?.retry_count, 2);
  assert.equal(events.filter((e) => e.type === 'retry_attempt').length, 2);
  assert.equal(events.filter((e) => e.type === 'run_start').length, 1);
  assert.equal(events.filter((e) => e.type === 'run_complete').length, 1);
});

test('callApiAdapter: exhausts retries and returns quota (router will fall back)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-retry-'));
  writeApiConfig(tmp, { max_retries: 2, retry_base_ms: 10 });
  const { result } = await callApiAdapter('myapi', minimalArtifact(), '.ai/state/context/T.json', tmp, null, {
    dispatch: async () => failResult({ error_kind: 'quota', http_status: 429 }),
    sleep: async () => {},
    emitEvent: () => {},
  });
  assert.equal(result.error_kind, 'quota');
  assert.equal(result.retry_count, 2);
});

test('callApiAdapter: auth failure is never retried', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-retry-'));
  writeApiConfig(tmp, { max_retries: 3, retry_base_ms: 10 });
  let calls = 0;
  const { result } = await callApiAdapter('myapi', minimalArtifact(), '.ai/state/context/T.json', tmp, null, {
    dispatch: async () => { calls++; return failResult({ error_kind: 'auth', retryable: false, http_status: 401 }); },
    sleep: async () => {},
    emitEvent: () => {},
  });
  assert.equal(calls, 1);
  assert.equal(result.retry_count, 0);
});

test('callApiAdapter: streamed failure is never retried', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-retry-'));
  writeApiConfig(tmp, { max_retries: 3, retry_base_ms: 10 });
  let calls = 0;
  const { result } = await callApiAdapter('myapi', minimalArtifact(), '.ai/state/context/T.json', tmp, null, {
    dispatch: async () => { calls++; return failResult({ error_kind: 'invalid_response', retryable: false, streamed: true }); },
    sleep: async () => {},
    emitEvent: () => {},
  });
  assert.equal(calls, 1);
  assert.equal(result.streamed, true);
});

test('callApiAdapter: latency_ms is total wall-clock across attempts and backoff', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-retry-'));
  writeApiConfig(tmp, { max_retries: 1, retry_base_ms: 100 });
  const clock = [1000, 1000, 1000, 2500];          // now() readings; final − first = 1500
  let i = 0;
  const results = [failResult(), okResult()];
  let calls = 0;
  const { result } = await callApiAdapter('myapi', minimalArtifact(), '.ai/state/context/T.json', tmp, null, {
    dispatch: async () => results[calls++],
    sleep: async () => {},
    emitEvent: () => {},
    now: () => clock[Math.min(i++, clock.length - 1)],
  });
  assert.equal(result.latency_ms, 1500);
});
```

- [ ] **Step 5: Run to verify failure**

Run: `node --import tsx --test test/api-adapter.test.ts`
Expected: FAIL — `callApiAdapter` has no 6th options parameter / no retry loop.

- [ ] **Step 6: Implement the retry loop and events in `callApiAdapter`**

In `bin/lib/api-adapter.ts`:

1. Add imports:

```ts
import { emitRunEvent, nowSeconds, type RunEvent } from './run-events.js';
```

2. Add the options type and defaults, and thread `onDelta` into dispatch:

```ts
export type CallApiAdapterOptions = {
  stream?: boolean;
  onDelta?: (text: string) => void;
  dispatch?: (artifact: CompiledContextArtifact, entry: ApiAdapterEntry, onDelta?: (t: string) => void) => Promise<ApiCallResult>;
  sleep?: (ms: number) => Promise<void>;
  emitEvent?: (event: RunEvent) => void;
  now?: () => number;
};
```

3. Update `dispatchProvider` to forward `onDelta`:

```ts
async function dispatchProvider(
  artifact: CompiledContextArtifact,
  entry: ApiAdapterEntry,
  onDelta?: (t: string) => void
): Promise<ApiCallResult> {
  switch (entry.provider) {
    case 'anthropic': return callAnthropic(artifact, entry, fetch, onDelta);
    case 'openai':    return callOpenAI(artifact, entry, fetch, onDelta);
    case 'gemini':    return callGemini(artifact, entry, fetch, onDelta);
    default:
      return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'provider', retryable: false, streamed: false, retry_count: 0, error: `unknown provider: ${(entry as { provider: string }).provider}` };
  }
}
```

4. Rewrite the body of `callApiAdapter` (after the entry-lookup guards, which are unchanged) to add the retry loop, event emission, and latency totalling:

```ts
export async function callApiAdapter(
  adapterName: string,
  artifact: CompiledContextArtifact,
  artifactPath: string,
  repositoryRoot: string,
  modelOverride: string | null = null,
  options: CallApiAdapterOptions = {}
): Promise<{ result: ApiCallResult; record: RunRecord | null }> {
  // ... existing config-load + invalid-config + entry-not-found guards unchanged ...
  // (each still returns { result, record: null } with streamed:false, retry_count:0)

  const dispatch = options.dispatch ?? dispatchProvider;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const emit = options.emitEvent ?? emitRunEvent;
  const now = options.now ?? Date.now;
  const onDelta = options.stream ? options.onDelta : undefined;

  const effectiveModel = modelOverride ?? entry.model;
  const maxRetries = entry.max_retries ?? 2;
  const baseMs = entry.retry_base_ms ?? 500;
  const dispatchEntry: ApiAdapterEntry = { ...entry, model: effectiveModel };

  emit({ type: 'run_start', ts: nowSeconds(), adapter: adapterName, provider: entry.provider, model: effectiveModel, objective: artifact.objective.slice(0, 200) + (artifact.objective.length > 200 ? '…' : ''), budget_tokens: artifact.budget.limit_tokens });

  const startWall = now();
  let result: ApiCallResult;
  let attempt = 0;
  for (;;) {
    try {
      result = await dispatch(artifact, dispatchEntry, onDelta);
    } catch (err) {
      result = { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'provider', retryable: false, streamed: false, retry_count: 0, error: getErrorMessage(err) };
    }
    if (result.ok || !result.retryable || result.streamed || attempt >= maxRetries) break;
    const delayMs = baseMs * 2 ** attempt;
    emit({ type: 'retry_attempt', ts: nowSeconds(), adapter: adapterName, attempt: attempt + 1, error_kind: result.error_kind ?? 'error', delay_ms: delayMs });
    await sleep(delayMs);
    attempt += 1;
  }

  result = { ...result, retry_count: attempt, latency_ms: now() - startWall };

  const outcome: RunRecord['outcome'] = result.ok ? 'ok' : result.error_kind === 'quota' ? 'quota' : result.error_kind === 'auth' ? 'auth' : 'error';
  const record: RunRecord = {
    schema_version: 1, kind: 'forgeai_run_record',
    run_id: generateRunId(), timestamp: new Date().toISOString(),
    adapter: adapterName, provider: entry.provider, model: effectiveModel,
    artifact: artifactPath, objective: artifact.objective,
    budget_tokens: artifact.budget.limit_tokens, estimated_tokens: artifact.budget.estimated_tokens,
    input_tokens: result.input_tokens, output_tokens: result.output_tokens,
    cached_tokens: result.cached_tokens, latency_ms: result.latency_ms,
    http_status: result.http_status, outcome, retry_count: result.retry_count, error: result.error,
  };
  writeRunRecord(record, repositoryRoot);
  emit({ type: 'run_complete', ts: nowSeconds(), adapter: adapterName, outcome, input_tokens: result.input_tokens, output_tokens: result.output_tokens, latency_ms: result.latency_ms, retry_count: result.retry_count });
  return { result, record };
}
```

Keep the three early-return guards (invalid config, entry not found) exactly as they are — they run before the loop and already carry `streamed:false, retry_count:0` from Task 1.

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: all pass. Note: the temp `.ai/state/runs` dir is created by `writeRunRecord`; retry tests don't assert on it.

- [ ] **Step 8: Commit (user runs)**

```bash
git add bin/lib/run-events.ts bin/lib/api-adapter.ts test/run-events.test.ts test/api-adapter.test.ts
git commit -m "feat(adapters): add retry loop with backoff and lifecycle events (Phase 12B)"
```

---

## Task 7: RunRecord `retry_count` backward compatibility

**Files:**
- Modify: `bin/lib/run-record.ts`
- Test: `test/run-record.test.ts`

**Interfaces:**
- Consumes: `RunRecord.retry_count` (Task 1).
- Produces: `listRunRecords()` always returns records with a numeric `retry_count` (absent → `0`); records with a negative or non-integer `retry_count` are rejected.

- [ ] **Step 1: Write the failing tests**

Add to `test/run-record.test.ts`. The existing `makeRecord` helper builds a valid record — update it to include `retry_count: 0` (required field now). Then add:

```ts
test('listRunRecords: 3.7.0 record without retry_count normalizes to 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-run-'));
  const dir = path.join(tmp, '.ai/state/runs');
  fs.mkdirSync(dir, { recursive: true });
  const legacy = makeRecord({ run_id: 'run-legacy' }) as Record<string, unknown>;
  delete legacy.retry_count;                       // simulate a pre-12B record
  fs.writeFileSync(path.join(dir, 'run-legacy.json'), JSON.stringify(legacy));
  const records = listRunRecords(tmp);
  assert.equal(records.length, 1);
  assert.equal(records[0].retry_count, 0);
});

test('listRunRecords: rejects negative or decimal retry_count', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-run-'));
  const dir = path.join(tmp, '.ai/state/runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'neg.json'), JSON.stringify({ ...makeRecord({ run_id: 'neg' }), retry_count: -1 }));
  fs.writeFileSync(path.join(dir, 'dec.json'), JSON.stringify({ ...makeRecord({ run_id: 'dec' }), retry_count: 1.5 }));
  assert.equal(listRunRecords(tmp).length, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test test/run-record.test.ts`
Expected: FAIL — legacy record currently kept with `retry_count: undefined`; negative/decimal not rejected.

- [ ] **Step 3: Implement validate + normalize**

In `bin/lib/run-record.ts`:

1. Change the validator to a boolean (drop the `raw is RunRecord` predicate — an un-normalized record does not satisfy the type). Rename the check and accept absent-or-non-negative-integer `retry_count`:

```ts
function isValidRunRecordInput(raw: unknown): boolean {
  // ... all existing checks unchanged ...
  const rc = (raw as Record<string, unknown>)['retry_count'];
  if (rc !== undefined && !(Number.isInteger(rc) && (rc as number) >= 0)) return false;
  return true;
}
```

2. In `listRunRecords`, normalize on push:

```ts
if (isValidRunRecordInput(raw)) {
  const r = raw as Record<string, unknown>;
  records.push({ ...(r as unknown as RunRecord), retry_count: (r['retry_count'] as number | undefined) ?? 0 });
}
```

(Replace the previous `if (isValidRunRecord(raw)) records.push(raw);` line. Update the one other reference to the old function name if present.)

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit (user runs)**

```bash
git add bin/lib/run-record.ts test/run-record.test.ts
git commit -m "feat(runs): normalize retry_count for backward-compatible run records (Phase 12B)"
```

---

## Task 8: Router `--stream` wiring

**Files:**
- Modify: `bin/lib/context.ts`
- Modify: `bin/lib/router.ts`
- Test: `test/api-adapter.test.ts`

**Interfaces:**
- Consumes: `callApiAdapter` options (Task 6).
- Produces: `--stream` flag; `routeToAdapter(artifact, artifactPath, adapterName, model, repositoryRoot, stream?)` writes deltas to stdout during streaming, does not re-write `result.text`, and does not fall back after `result.streamed` is true.

- [ ] **Step 1: Parse the flag**

In `bin/lib/context.ts`, add after the other boolean flags (e.g. near `export const route`):

```ts
export const stream = args.has('--stream');
```

- [ ] **Step 2: Write the failing router tests**

Add to `test/api-adapter.test.ts` (router section — `routeToAdapter` is already imported). These capture stdout via a wrapper. Add a small stdout-capture helper:

```ts
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const orig = process.stdout.write.bind(process.stdout);
  let out = '';
  (process.stdout.write as unknown as (s: string) => boolean) = (s: string) => { out += s; return true; };
  try { await fn(); } finally { (process.stdout.write as unknown) = orig; }
  return out;
}
```

Because `routeToAdapter` calls the real `callApiAdapter` (which dispatches to real providers), these tests set a valid API config whose provider network call is intercepted by exporting the stream through the provider `fetcher`. Simpler: assert wiring at the `routeToAdapter` level using an adapter that streams via a mocked global `fetch`. Set `globalThis.fetch` to a mock for the duration:

```ts
test('routeToAdapter --stream: writes deltas to stdout and does not double-write', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-route-'));
  fs.mkdirSync(path.join(tmp, '.ai'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.ai/api-adapters.json'), JSON.stringify({ version: 1, adapters: { myapi: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } }));
  const frames = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
    'data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n',
    'data: {"type":"message_delta","usage":{"output_tokens":1}}\n\n',
    'data: {"type":"message_stop"}\n\n',
  ];
  const origFetch = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = async () => sseResponse(...frames);
  process.env.ANTHROPIC_API_KEY = 'k';
  const out = await captureStdout(() => routeToAdapter(minimalArtifact(), '.ai/state/context/T.json', 'myapi', null, tmp, true));
  delete process.env.ANTHROPIC_API_KEY;
  (globalThis as { fetch: unknown }).fetch = origFetch;
  assert.equal(out, 'Hi');           // exactly the streamed delta, written once
});
```

Add a companion test asserting that when `stream` is false (buffered), the full `result.text` is written once (existing behavior). Reuse the same config; frames return a buffered JSON body via `new Response(JSON.stringify({...}), {status:200})` and call `routeToAdapter(..., false)`.

- [ ] **Step 3: Run to verify failure**

Run: `node --import tsx --test test/api-adapter.test.ts`
Expected: FAIL — `routeToAdapter` has no `stream` parameter.

- [ ] **Step 4: Implement router wiring**

In `bin/lib/router.ts`:

1. Extend the signature and pass options to `callApiAdapter`:

```ts
export async function routeToAdapter(
  artifact: CompiledContextArtifact,
  artifactPath: string,
  adapterName: string | null,
  model: string | null,
  repositoryRoot: string,
  stream = false
): Promise<void> {
```

2. In the `apiEntry` branch, replace the `callApiAdapter` call and success handling:

```ts
const { result } = await callApiAdapter(adapterName, artifact, artifactPath, repositoryRoot, model, {
  stream,
  onDelta: (t) => process.stdout.write(t),
});
const statusLabel = result.ok ? 'ok' : `failed (${result.error_kind ?? 'error'})`;
appendJournal(buildJournalEntry(artifact, artifactPath, `${adapterName} (api${result.streamed ? ', stream' : ''})`, effectiveModel, statusLabel), repositoryRoot);

if (result.ok) {
  if (!result.streamed && result.text) process.stdout.write(result.text);  // buffered: write once; streamed: already emitted
  return;
}

if (result.streamed) {
  // Bytes already went to stdout — cannot retry or fall back.
  process.stderr.write(`Error: API adapter '${adapterName}' failed mid-stream: ${result.error ?? 'unknown'}\n`);
  process.exitCode = 1;
  return;
}
```

Leave the existing `auth` / `quota` (CLI fallback) / other-error branches below unchanged — they only run for non-streamed failures now.

3. In `runRoute`, read the flag and pass it, warning if `--stream` is used without an adapter:

```ts
import { root, getArgValue, stream as streamFlag } from './context.js';
// ...
const model = getArgValue('--model');
if (model && !adapterName) {
  process.stderr.write(`${formatStatus('warn', '--model is ignored when --adapter is not specified')}\n`);
}
if (streamFlag && !adapterName) {
  process.stderr.write(`${formatStatus('warn', '--stream is ignored when --adapter is not specified')}\n`);
}
await routeToAdapter(result.artifact, artifactPath, adapterName, model, root, streamFlag);
```

4. CLI adapters ignore streaming but should not error. In `routeCliAdapter` there is nothing to change (inherited stdio already streams); optionally, before calling it from the fall-through path, if `stream` was requested, emit a soft warning once:

```ts
// No API adapter by this name — fall through to CLI
if (stream) process.stderr.write(`${formatStatus('warn', `--stream has no effect on CLI adapter '${adapterName}' (it already streams via stdio)`)}\n`);
routeCliAdapter(artifact, artifactPath, adapterName, model, repositoryRoot, json);
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit (user runs)**

```bash
git add bin/lib/context.ts bin/lib/router.ts test/api-adapter.test.ts
git commit -m "feat(router): add --stream flag routing to API adapters (Phase 12B)"
```

---

## Task 9: TUI reducer rendering for lifecycle events

**Files:**
- Modify: `bin/ui/types.ts`
- Modify: `bin/ui/reducer.ts`
- Test: `test/ui-reducer.test.ts` (existing reducer test file)

**Interfaces:**
- Consumes: the three `RunEvent` shapes (Task 6).
- Produces: reducer cases `run_start`, `retry_attempt`, `run_complete` that append log lines; `run_start`/`run_complete` set `connected`.

- [ ] **Step 1: Extend `ForgeEvent`**

In `bin/ui/types.ts`, add optional fields to `ForgeEvent`:

```ts
export type ForgeEvent = {
  type: string;
  ts: number;
  agentId?: string;
  role?: string;
  task?: string;
  message?: string;
  status?: string;
  name?: string;
  target?: string;
  raw?: string;
  adapter?: string;
  provider?: string;
  model?: string;
  attempt?: number;
  error_kind?: string;
  delay_ms?: number;
  outcome?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  latency_ms?: number;
  retry_count?: number;
};
```

- [ ] **Step 2: Write the failing reducer tests**

Append to `test/ui-reducer.test.ts`. Note `initialState` is a **function** — call it `initialState()`. Match the existing import style already in that file:

```ts
import { reducer, initialState } from '../bin/ui/reducer.js';
import type { ForgeEvent } from '../bin/ui/types.js';

test('reducer run_start marks connected and logs adapter/model', () => {
  const s = reducer(initialState(), { type: 'run_start', ts: 1, adapter: 'myapi', provider: 'anthropic', model: 'claude-sonnet-4-6' } as ForgeEvent);
  assert.equal(s.connected, true);
  assert.ok(s.logs.at(-1)!.text.includes('myapi'));
  assert.ok(s.logs.at(-1)!.text.includes('claude-sonnet-4-6'));
});

test('reducer retry_attempt logs attempt and delay at warn level', () => {
  const s = reducer(initialState(), { type: 'retry_attempt', ts: 1, adapter: 'myapi', attempt: 2, error_kind: 'provider', delay_ms: 400 } as ForgeEvent);
  const last = s.logs.at(-1)!;
  assert.equal(last.level, 'warn');
  assert.ok(last.text.includes('#2'));
  assert.ok(last.text.includes('400'));
});

test('reducer run_complete marks connected and logs outcome + tokens', () => {
  const s = reducer(initialState(), { type: 'run_complete', ts: 1, adapter: 'myapi', outcome: 'ok', input_tokens: 100, output_tokens: 50, latency_ms: 1200, retry_count: 1 } as ForgeEvent);
  assert.equal(s.connected, true);
  const last = s.logs.at(-1)!;
  assert.ok(last.text.includes('ok'));
  assert.ok(last.text.includes('1200'));
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --import tsx --test test/watch.test.ts`
Expected: FAIL — events hit the `default` "unknown event" branch.

- [ ] **Step 4: Implement the reducer cases**

In `bin/ui/reducer.ts`, add three `case` blocks before `default:` (use the existing `appendLog(state, text, ts, level)` and `markConnected(state)` helpers; match their exact names in the file):

```ts
case 'run_start':
  return appendLog(
    markConnected(state),
    `▶ run ${event.adapter} ${event.provider ?? ''}/${event.model ?? ''}`,
    ts,
  );

case 'retry_attempt':
  return appendLog(
    state,
    `↻ ${event.adapter} retry #${event.attempt} (${event.error_kind}, ${event.delay_ms}ms)`,
    ts,
    'warn',
  );

case 'run_complete': {
  const icon = event.outcome === 'ok' ? '✓' : '✗';
  const tokens = event.input_tokens != null ? `in=${event.input_tokens} out=${event.output_tokens}` : 'tokens=unknown';
  return appendLog(
    markConnected(state),
    `${icon} run ${event.adapter} ${event.outcome} ${tokens} ${event.latency_ms}ms`,
    ts,
    event.outcome === 'ok' ? 'info' : 'error',
  );
}
```

If `markConnected` does not exist as a helper, inline `{ ...state, connected: true }` (check how `agent.start` marks connected and mirror it).

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit (user runs)**

```bash
git add bin/ui/types.ts bin/ui/reducer.ts test/watch.test.ts
git commit -m "feat(watch): render run lifecycle events in the activity log (Phase 12B)"
```

---

## Task 10: Docs, template, and version bump

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `CHANGELOG.md`, `ROADMAP.md`, `README.md`
- Modify: `templates/.ai/api-adapters.json`
- Create: `docs/migrations/3.8.0.md`
- Test: whichever test asserts the version (grep to find it)

- [ ] **Step 1: Find the version-coupled test**

Run: `grep -rn "3\.7\.0\|package_version\|version" test | grep -i version | head`
Expected: identifies any test that reads `package.json` version dynamically (Phase 14 made these dynamic). If a test hard-codes `3.7.0`, note it and update in Step 4.

- [ ] **Step 2: Bump the version in all locations**

In `package.json` set `"version": "3.8.0"`. In `package-lock.json` update **both** the top-level `"version": "3.8.0"` and the root package entry under `"packages": { "": { "version": "3.8.0" } }`.

- [ ] **Step 3: Document the retry fields in the template**

In `templates/.ai/api-adapters.json`, add `max_retries` and `retry_base_ms` to one example adapter entry (keeping the file valid), e.g.:

```json
{
  "version": 1,
  "adapters": {
    "claude": { "provider": "anthropic", "model": "claude-sonnet-4-6", "max_retries": 2, "retry_base_ms": 500 }
  }
}
```

Match the existing structure of the file (read it first; keep any other adapters intact).

- [ ] **Step 4: Update CHANGELOG, ROADMAP, README, migration doc**

Add a `## 3.8.0 — 2026-07-23` CHANGELOG section covering: `--stream` streaming output for all three API providers; per-adapter `max_retries` / `retry_base_ms` with exponential backoff; NDJSON `run_start` / `retry_attempt` / `run_complete` lifecycle events to the `--watch` pipe; `retry_count` on run records. Note that CLI adapters ignore `--stream` (they already stream), and that `run_complete` describes the API-adapter run only (a `quota` completion may precede a successful CLI fallback).

In `ROADMAP.md`, mark Phase 12B shipped in 3.8.0 (update the `### Phase 12B` section, mirroring how Phase 12A was annotated).

In `README.md`, extend the API Adapters section with: the `--stream` flag, the two retry config fields, and the lifecycle events (plus the `run_complete` quota-semantics note).

Create `docs/migrations/3.8.0.md`: additive change; run `forgeai-init --upgrade`; no breaking config or schema changes; new optional `max_retries` / `retry_base_ms` fields default to `2` / `500`; existing run records without `retry_count` read as `0`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass (including any dynamic version assertions now reading 3.8.0).

- [ ] **Step 6: Commit (user runs)**

```bash
git add package.json package-lock.json CHANGELOG.md ROADMAP.md README.md templates/.ai/api-adapters.json docs/migrations/3.8.0.md
git commit -m "chore: release 3.8.0 — streaming, retry, and lifecycle events (Phase 12B)"
```

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|-----------|------|
| `max_retries` / `retry_base_ms` schema + validation (bounds, `0` allowed, tests) | Task 1, 3–5 (validation), Task 6 (use) |
| `ApiCallResult.streamed` / `retry_count` | Task 1 |
| `RunRecord.retry_count` additive + normalize + type-predicate fix | Task 1, Task 7 |
| `parseSSE` + edge-case tests | Task 2 |
| Streaming per provider + completion contract + cached-token parity + error matrix | Tasks 3, 4, 5 |
| Retry loop, backoff, quota-then-fallback, auth/streamed never retried | Task 6, Task 8 (fallback) |
| `latency_ms` total wall-clock | Task 6 |
| Lifecycle events, `ts` epoch seconds, objective truncation, best-effort emit | Task 6 |
| Reducer cases + `ForgeEvent` extension + `markConnected` + tests | Task 9 |
| Router `--stream`, no double-write, no fallback after streamed bytes, CLI warn | Task 8 |
| `run_complete` quota semantics documented | Task 10 |
| Version bump (package.json + package-lock ×2), docs, template, migration | Task 10 |

**Placeholder scan:** No `TBD`/`TODO`; every code step carries real code; test steps carry real inputs and expected values.

**Type consistency:** `ApiCallResult` fields (`streamed`, `retry_count`) are defined in Task 1 and consumed identically in Tasks 3–8. `callApiAdapter` gains `options` in Task 6 and is called with it in Task 8. `RunEvent` union defined in Task 6, consumed in Task 9 via `ForgeEvent`. Provider signature `(artifact, config, fetcher?, onDelta?)` is consistent across Tasks 3–6.
