# Phase 12B — Streaming Output, Retry, and Lifecycle Events Design

Status: approved, ready for implementation planning.
Target version: 3.8.0 (from 3.7.0).
Depends on: Phase 12A (LLM-native adapter buffered MVP, shipped 3.7.0).

## Goal

Complete the LLM-native adapter layer by adding the three capabilities deferred
from Phase 12A, plus a run-record field:

1. Incremental stdout from chunked `ReadableStream` (SSE) responses.
2. A configurable retry loop with exponential backoff for `retryable` failures.
3. Provider lifecycle events emitted as NDJSON to the `--watch` pipe.
4. A `retry_count` field on `RunRecord`.

## Overarching principle

The Phase 12A buffered path must not change its default behavior. Streaming is
opt-in via `--stream`. Retry and events run on both paths but are transparent
when there is no error and no watch pipe.

## Design decisions (resolved during brainstorming)

| Decision | Choice |
|----------|--------|
| Scope | Full Phase 12B (all four deliverables). |
| Streaming toggle | CLI flag `--stream` only. No per-adapter config field. Default stays buffered. |
| Retry vs quota fallback | Retry all `retryable` failures (network / 5xx / 429) up to N times with backoff; if still quota after retries, router falls back to the CLI adapter as in 12A. Auth never retries. |
| Retry config location | Per-adapter fields `max_retries` and `retry_base_ms` in `.ai/api-adapters.json`, with sensible defaults. |
| Event granularity | Coarse: `run_start`, `retry_attempt`, `run_complete`. No per-chunk events (avoids pipe EAGAIN). |

## Components

### 1. Types (`bin/lib/types.ts`)

- `ApiAdapterEntry`: add optional `max_retries?: number` and
  `retry_base_ms?: number`.
- `ApiCallResult`: add `retry_count: number` (retries actually performed) and
  `streamed: boolean` (whether any bytes were already written to stdout; used to
  block mid-stream fallback).
- `RunRecord`: add `retry_count: number`. Additive change; `schema_version`
  stays `1`. Records written before 12B lack the field. Backward compatibility
  requires a real normalize path in `run-record.ts`, not just a type change,
  because `listRunRecords()` currently pushes the raw parsed object directly:
  - `isValidRunRecord` accepts `retry_count` when it is **absent** or a
    non-negative integer; it rejects negative or decimal values.
  - `listRunRecords()` normalizes each accepted record to
    `{ ...raw, retry_count: raw.retry_count ?? 0 }` so consumers always see a
    number.
  - **Type-predicate correctness.** `isValidRunRecord` is currently a type
    predicate (`raw is RunRecord`). A 3.7.0 record lacking `retry_count` does not
    satisfy the new `RunRecord` type, so keeping the predicate would be unsound
    (it would narrow to `RunRecord` an object missing a required field). The
    implementation must either validate against a `LegacyRunRecordInput` type
    (all 12A fields + optional `retry_count`) and return that, or change the
    validator to return `boolean` and produce the `RunRecord` only through the
    normalize step above. Do not return `raw is RunRecord` for un-normalized
    input.
  - Tests: read a 3.7.0 record with no `retry_count` (normalizes to `0`); reject
    a record with a negative or decimal `retry_count`.

All existing `ApiCallResult` literals in providers, `api-adapter.ts`, and tests
must set the two new fields (`retry_count: 0`, `streamed: false`) for the
buffered/no-retry case.

**Config validation (`api-adapter.ts`).** The config validator uses a strict
field whitelist (`KNOWN_ENTRY_FIELDS`), so the two new fields will be rejected as
"unknown field" unless explicitly added. Implementation must:

- Add `max_retries` and `retry_base_ms` to `KNOWN_ENTRY_FIELDS`.
- Validate `max_retries` as a non-negative integer with an upper bound (cap `5`);
  `max_retries: 0` is valid and disables retry.
- Validate `retry_base_ms` as a positive integer with an upper bound (cap
  `30000`) to prevent a `retry_base_ms * 2 ** attempt` blow-up or overflow.
- Reject negative, non-integer (decimal), and over-cap values with a clear
  message, matching the existing `max_tokens` / `timeout_ms` validation style.
- Tests: a valid config using both fields (including `max_retries: 0`), and
  rejection of negative, decimal, and over-cap values for each field.

### 2. Streaming in providers (`bin/lib/api-adapters/*.ts`)

Each provider `call*` function gains an optional `onDelta?: (text: string) => void`
parameter (in addition to the existing injectable `fetcher`).

- When `onDelta` is provided: set `stream: true` in the request body (Gemini uses
  the `:streamGenerateContent?alt=sse` endpoint), and parse the Server-Sent
  Events response body incrementally. Each text delta is passed to `onDelta` as
  it arrives, and also accumulated so the returned `ApiCallResult.text` still
  contains the full aggregated output.
- When `onDelta` is undefined: unchanged Phase 12A buffered behavior.
- A shared helper `parseSSE(body: ReadableStream<Uint8Array>)` (new small module,
  e.g. `bin/lib/api-adapters/sse.ts`) yields decoded `data:` payload strings.
  Each provider interprets its own event shapes on top of that:
  - **Anthropic**: `content_block_delta` → `delta.text`; input +
    `cache_read_input_tokens` from `message_start.message.usage`, output from the
    final `message_delta.usage`; `error` events surface as failures; terminal
    marker is `message_stop`.
  - **OpenAI**: `choices[].delta.content`; input/output usage and
    `prompt_tokens_details.cached_tokens` from the final usage chunk, which
    requires sending `stream_options: { include_usage: true }`; terminal marker
    is the `[DONE]` sentinel.
  - **Gemini**: `candidates[].content.parts[].text`; usage
    (`promptTokenCount`, `candidatesTokenCount`, `cachedContentTokenCount`) from
    `usageMetadata`; no sentinel — a clean EOF is the terminal marker.
- **Token-usage parity.** Streaming must populate the same `ApiCallResult` usage
  fields as the buffered path, including `cached_tokens`
  (Anthropic `cache_read_input_tokens`, OpenAI
  `prompt_tokens_details.cached_tokens`, Gemini `cachedContentTokenCount`). If a
  usage field appears in more than one event, keep the last valid value per
  provider. Absent usage fields stay `null`, exactly as buffered.
- **Completion contract (detecting a truncated stream).** A clean connection
  close is not by itself success — a stream cut off after a few deltas but before
  its terminal marker would otherwise be returned as truncated "success". So:
  - OpenAI succeeds only after observing `[DONE]`; Anthropic only after
    `message_stop`; Gemini treats a clean EOF as completion (no sentinel exists).
  - EOF reached without the required terminal marker (OpenAI / Anthropic) →
    `error_kind: 'invalid_response'`; `streamed` reflects whether any delta was
    already emitted (`true` if so, else `false`).
  - `response.body === null` → `invalid_response`, `streamed: false`.
  - Every provider rejects empty aggregated text (`error_kind: 'invalid_response'`),
    preserving the buffered path's empty-response validation.
- The provider always returns a full `ApiCallResult` (aggregated text + usage) so
  the router and run-record are identical across both paths.

Error handling in streaming — full contract matrix:

| Failure point | `error_kind` | `retryable` | `streamed` |
|---------------|--------------|-------------|------------|
| HTTP status error before body (401/403) | `auth` | false | false |
| HTTP status error before body (429) | `quota` | true | false |
| HTTP status error before body (408 / 5xx) | `provider` | true | false |
| Body read timeout / network reset **before** first delta | `network` | true | false |
| Provider overload signalled before first delta (e.g. Anthropic `error` event with `overloaded_error` on an HTTP 200 stream — the 529-equivalent) | `provider` | true | false |
| Malformed JSON / malformed SSE **before** first delta | `invalid_response` | false | false |
| **Any** failure after at least one delta emitted | `invalid_response` | false | true |

Rationale: before the first byte reaches stdout, transient failures (network,
provider overload) are safely retryable and eligible for CLI fallback. Once any
delta has been written to stdout, output cannot be un-written, so the run is
terminal — no retry, no fallback. Malformed protocol data is a hard error, not a
transient one, so it is never retried even before the first delta.

Timeouts continue to use `AbortSignal.timeout(...)`. HTTP status classification
(auth / quota / provider) is identical to the Phase 12A buffered path.

### 3. Retry loop (`bin/lib/api-adapter.ts`)

`callApiAdapter` wraps `dispatchProvider` in a retry loop:

- Read `max_retries` (default `2`) and `retry_base_ms` (default `500`) from the
  adapter entry.
- Retry only when `result.retryable === true` **and** `result.streamed === false`.
- Exponential backoff: sleep `retry_base_ms * 2 ** (attempt - 1)` before each
  retry. The sleep function is injectable for tests.
- Quota (429) is retried too; if the final result is still quota after exhausting
  retries, `callApiAdapter` returns that quota result and the **router** performs
  the CLI fallback (unchanged from 12A). Auth (`retryable: false`) never retries.
- `retry_count` is the number of retries actually performed; it is written into
  both `ApiCallResult` and the resulting `RunRecord`.
- Before each retry sleep, emit a `retry_attempt` lifecycle event.

**`latency_ms` semantics under retry.** Each provider still measures the latency
of its own HTTP request. `callApiAdapter` overwrites the returned
`result.latency_ms` with the **total wall-clock of the logical run** — from just
before the first attempt to just after the final attempt returns, including all
failed attempts and backoff sleeps. This is the value stored in `RunRecord` and
`run_complete`. Reason: the schema has a single `latency_ms` field, and the
user-meaningful number is how long the whole routed call took, not just the last
HTTP round-trip. (A separate per-attempt latency field is out of scope.)

Testability: `callApiAdapter` gains an internal options object allowing these to
be overridden, all defaulting to the real implementations:

- `dispatch` — the provider dispatch function (default: real `dispatchProvider`).
- `sleep` — backoff sleep (default: `setTimeout`-based promise).
- `emitEvent` — lifecycle-event emitter (default: real `emitRunEvent`).
- `now` — clock for `latency_ms` totals (default: `Date.now`).

Existing provider tests that inject `fetcher` are unaffected.

### 4. Lifecycle events (`bin/lib/run-events.ts`, new)

`emitRunEvent(event)` writes one NDJSON line to the watch pipe on a best-effort
basis: it wraps `emitToPipe(getPipePath(), json)` in try/catch and swallows any
error (missing pipe, EAGAIN), matching the existing auto-emit path. Three coarse
event types:

- `run_start`: `{ type, ts, adapter, provider, model, objective, budget_tokens }`
- `retry_attempt`: `{ type, ts, adapter, attempt, error_kind, delay_ms }`
- `run_complete`: `{ type, ts, adapter, outcome, input_tokens, output_tokens, latency_ms, retry_count }`

**Objective size.** The artifact validator only requires `objective` to be
non-empty, so it can be arbitrarily long. A large event risks exceeding the FIFO
buffer or being partially written (corrupt NDJSON). `run_start.objective` is
therefore truncated to 200 characters (with a trailing `…` when cut); the full
objective already lives in the `RunRecord`.

**Timestamp unit.** `ts` MUST be Unix epoch **seconds**
(`Math.floor(Date.now() / 1000)`), not milliseconds and not an ISO string.
`ActivityLog.tsx` renders time as `new Date(entry.ts * 1000)`, so any other unit
displays the wrong time.

No per-chunk events are emitted, to avoid filling the pipe buffer (`pipe.ts`
raises EAGAIN when the buffer is full).

**Reducer rendering (required).** The current reducer `default` case renders
`event.raw ?? "[warn] unknown event: <type>"` and does not call `markConnected`.
Emitting these events without reducer support would show
`[warn] unknown event: run_start` and drop every useful field (adapter, model,
attempt, outcome, tokens). Therefore the reducer must gain three explicit cases:

- `run_start` → mark connected; log e.g. `▶ run <adapter> <provider>/<model>`.
- `retry_attempt` → log e.g. `↻ <adapter> retry #<attempt> (<error_kind>, <delay_ms>ms)`
  at `warn` level.
- `run_complete` → mark connected; log e.g.
  `<icon> run <adapter> <outcome> in=<in> out=<out> <latency_ms>ms` (icon by
  outcome), `info` on ok / `error` otherwise.

`ForgeEvent` in `bin/ui/types.ts` is extended with the optional fields these
cases read (`adapter`, `provider`, `model`, `attempt`, `error_kind`, `delay_ms`,
`outcome`, `input_tokens`, `output_tokens`, `latency_ms`, `retry_count`).
Reducer unit tests assert the ActivityLog text produced for each of the three
events and that `run_start` / `run_complete` set `connected`.

**Scope of lifecycle events (quota fallback).** Events are emitted by
`callApiAdapter` and describe the **API adapter run only**, not the final route
outcome. When the API adapter exhausts retries on quota and returns, a
`run_complete` with `outcome: 'quota'` is emitted *before* the router runs the
CLI fallback — so the TUI may show a `quota` run even when the overall route then
succeeds via CLI. This keeps event ownership in one place and avoids the router
re-deriving usage. The README must state this explicitly so consumers do not read
`run_complete` as the whole-route result. (The CLI fallback itself is a
`spawnSync` with inherited stdio and emits no lifecycle events.)

### 5. Router and CLI wiring (`bin/lib/router.ts`, `bin/lib/context.ts`)

- Parse a boolean `--stream` flag (via the existing arg helpers in `context.ts`).
- Thread `stream` down `runRoute` → `routeToAdapter` → `callApiAdapter`.
- When streaming, the router supplies `onDelta = (t) => process.stdout.write(t)`;
  after completion it does **not** re-write `result.text`.
- If `result.streamed === true` and the result failed, the router reports the
  error and does **not** fall back (bytes already went to stdout).
- Non-streaming behavior (including quota → CLI fallback) is unchanged.
- CLI adapters ignore `--stream` (they already stream via inherited stdio); if
  `--stream` is passed with a CLI-only adapter, emit a soft warning and proceed.

### 6. Documentation and version

Bump `3.7.0 → 3.8.0` in every version location so the package publishes correctly:

- `package.json` `version`.
- `package-lock.json` — both version locations (top-level `version` and the root
  package entry under `packages[""]`).
- `CHANGELOG.md`: 3.8.0 entry describing streaming, retry, events, `retry_count`.
- `ROADMAP.md`: mark Phase 12B shipped in 3.8.0.
- `README.md`: extend the API Adapters section with `--stream`, the `max_retries`
  / `retry_base_ms` config fields, and the lifecycle events.
- `docs/migrations/3.8.0.md`: additive change; run `forgeai-init --upgrade`. No
  breaking config or schema changes.
- `templates/.ai/api-adapters.json`: optionally document the new retry fields
  (kept backward compatible; absence uses defaults).

## Testing strategy

- **`parseSSE` helper**: unit tests that feed a `ReadableStream` of raw bytes and
  assert the yielded `data:` payloads for: a single JSON frame split across
  multiple stream chunks; a multi-byte UTF-8 character split across chunks
  (decoder must not corrupt it — use a streaming `TextDecoder`); both `\n\n` and
  `\r\n\r\n` event delimiters; comment / heartbeat lines and multi-line `data:`
  fields; and EOF with an unflushed trailing buffer.
- **Provider streaming**: a fake `fetcher` returns a `Response` whose body is a
  `ReadableStream` of SSE bytes; assert `onDelta` is called with the sequential
  text chunks and that the returned result has the aggregated text and parsed
  usage — **including `cached_tokens`** for each provider. Per provider, also
  cover: `response.body === null` → `invalid_response`; a malformed event before
  the first delta (`invalid_response`, `streamed: false`, not retried) and after
  the first delta (`invalid_response`, `streamed: true`); Anthropic
  `overloaded_error` event before first delta (`provider`, retryable); EOF
  missing the terminal marker — OpenAI without `[DONE]`, Anthropic without
  `message_stop` — → `invalid_response`; Anthropic unknown / `ping` events
  ignored; empty aggregated text rejected.
- **Retry**: inject a scripted dispatch returning `retryable` failures then a
  success; assert `retry_count`, the exponential backoff delays passed to the
  injected sleep, and that a `retry_attempt` event fires per retry. Cover: retry
  then success, retries exhausted returning quota (→ router fallback), auth never
  retried, mid-stream failure (`streamed: true`) never retried.
- **Events**: inject the emitter; assert the `run_start` → (`retry_attempt`*) →
  `run_complete` sequence and payload fields.
- **Backward compatibility**: without `--stream` and with no retryable failure,
  the buffered path produces byte-identical behavior to 12A; `retry_count` is `0`.

## Out of scope

- Per-chunk / token-level events.
- Streaming for CLI adapters beyond their existing inherited-stdio behavior.
- Per-adapter `stream` config field (flag-only by decision).
- Evaluation/reporting on `retry_count` (Phase 13).

## Process notes

- The user commits every change themselves; do not run `git commit`.
- No CI work for this repository.
