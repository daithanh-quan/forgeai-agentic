---
name: phase-11-enforced-context-boundary
description: Design spec for Phase 11 — enforced context boundary and controlled expansion via --validate-artifact, --route, and --expand-context commands
metadata:
  type: project
---

# Phase 11 — Enforced Context Boundary and Controlled Expansion

## Background

Phase 10 (v3.2.0) delivers `--compile-context`: a command that produces a
budget-bounded `CompiledContextArtifact` JSON containing AST excerpts, rules,
and diagnostics for a given objective. The artifact is validated against the
dependency graph fingerprint at compile time.

Without Phase 11, the artifact is advisory. Nothing prevents an orchestrator
from routing a stale artifact, an over-budget payload, or arbitrary repository
files to a delegated model. Phase 11 adds an enforcement layer between the
orchestrator and the delegated model.

## Goals

- Make compiled context the verified input for delegated CLI adapter calls.
- Reject malformed, stale, or over-budget payloads before any adapter is
  invoked.
- Provide a structured protocol for delegated models to request additional
  context, with each request validated and compiled per request semantics.
- Record what was routed and when in an append-only journal.
- Keep artifacts ephemeral: generated per task, used, discarded. Not an archive.

## Out of Scope

- Delta payloads (incremental context without resending unchanged excerpts).
- API adapters (Anthropic, OpenAI, Gemini) — those are Phase 12.
- Session locking and concurrent write-scope coordination — Phase 17.
- Automatic cleanup of `.ai/state/context/` — deferred; see gitignore handling.

## CLI Interface

Three new commands are added. The existing `forgeai-init` and `--upgrade`
commands additionally maintain context-state gitignore entries.

```bash
# 1. Validate a compiled context artifact standalone
forgeai-init --validate-artifact --artifact <path>

# 2. Validate and route to a CLI adapter
forgeai-init --route \
  --artifact <path> \
  [--adapter <name>] \
  [--model <model-id>]

# 3. Validate a need_context request and produce a supplemental artifact
forgeai-init --expand-context \
  --artifact <path> \
  --need-context <path> \
  [--budget <tokens>] \
  [--output <json>] \
  [--markdown-output <md>]
```

### stdout / stderr contract

- `--validate-artifact`: nothing to stdout on success; status line to stderr.
- `--route` without `--adapter`: validated artifact JSON to stdout; all other
  output to stderr.
- `--route` with `--adapter`: artifact JSON to the adapter stdin; `--route`
  itself writes nothing to stdout; adapter stdout/stderr are inherited.
- `--expand-context` without `--output`: supplemental artifact JSON to stdout;
  all other output to stderr.
- `--expand-context` with `--output`: writes files; status lines to stderr only.

No context artifact file is created without an explicit `--output` flag. The
journal file `.ai/state/context-routes.md` is created by `--route` separately.

## Artifact Validation

Shared by `--validate-artifact`, `--route`, and `--expand-context` (which calls
it first). Rejection is immediate on the first failed check.

### Structural validation

Parse the file as JSON (reject if invalid). Then validate all required fields.
Unknown additional fields are tolerated for forward compatibility.

Top-level required fields:

| Field | Required type |
|---|---|
| `kind` | string equal to `'forgeai_compiled_context'` |
| `schema_version` | number equal to `1` |
| `objective` | non-empty string |
| `repository.fingerprint` | non-empty string |
| `repository.revision` | string or null |
| `budget.limit_tokens` | integer, 256–200 000 (Phase 10 compiler bounds) |
| `budget.estimated_tokens` | non-negative integer |
| `budget.estimator` | string equal to `'characters_divided_by_4'` |
| `budget.exhausted` | boolean |
| `selection.max_depth` | integer, 0–5 (Phase 10 compiler bounds) |
| `selection.max_nodes` | integer, 1–50 (Phase 10 compiler bounds) |
| `selection.files` | array (see item schema below) |
| `excerpts` | array (see item schema below) |
| `rules` | array (see item schema below) |
| `contracts` | array of strings |
| `entrypoints` | array of strings |
| `omitted_candidates` | non-negative integer |
| `diagnostics` | opaque object (presence and type checked; internal structure not validated in Phase 11) |

Each `selection.files[]` item:

| Field | Required type |
|---|---|
| `path` | non-empty string |
| `depth` | non-negative integer |
| `reason` | non-empty string |
| `graph_path` | string |

Each `excerpts[]` item:

| Field | Required type |
|---|---|
| `path` | non-empty string |
| `kind` | one of `'import' \| 'function' \| 'class' \| 'interface' \| 'type' \| 'enum' \| 'variable' \| 'test'` |
| `name` | string |
| `reason` | string |
| `source_start_line` | positive integer |
| `source_end_line` | positive integer, ≥ `source_start_line` |
| `mode` | one of `'full' \| 'signature'` |
| `content` | string |

Each `rules[]` item:

| Field | Required type |
|---|---|
| `path` | string equal to `'.ai/RULES.md'` (matching the `CompiledRuleSection` literal type) |
| `heading` | string |
| `reason` | string |
| `source_start_line` | positive integer |
| `source_end_line` | positive integer, ≥ `source_start_line` |
| `content` | string |

### Cross-field checks

After structural validation:

1. Every `excerpts[].path` must appear in `selection.files[].path`. An excerpt
   from a file not in the selection set is a sign of corruption.
2. Every `excerpts[].path` must exist as a `DependencyGraphNode.path`. The
   excerpt payload is the actual content delivered to the model; this is the
   boundary that matters most.
3. Every `selection.files[].path` must exist as a `DependencyGraphNode.path`.

### Token estimate check

Use a shared helper `computeArtifactEstimate(artifact)` (see below) to
recompute the token estimate. Reject if the result differs from
`artifact.budget.estimated_tokens`. Catches accidental file corruption.

This is not a tamper-proof check: a caller with write access can recompute the
estimate after editing. The trust assumption is explicit: Phase 11 protects
against orchestration errors and accidental corruption, not deliberate
manipulation.

### Fingerprint check sequence

1. Call `checkDependencyGraphHealth(root, readDependencyGraph(root))`. Any
   status other than `'ok'` — including `'missing'` — is rejected. A missing
   graph is always an error; Phase 10 cannot produce an artifact without one.
2. Compare `artifact.repository.fingerprint` with
   `dependencyGraph.repository.fingerprint`. Mismatch → artifact predates the
   last `--refresh-codegraph`.

Exit code 1 on any failure (error to stderr). Exit code 0 with a status line to
stderr on success; stdout is empty.

## Adapter Routing

Adapter config is read from `.ai/cli-adapters.json` using only the
`ADAPTERS_RELATIVE` path constant. `--route` reads this file as a read-only
operation and does not call `loadAdaptersForWrite()`.

| Condition | Behaviour |
|---|---|
| `--adapter` given, config file missing | exit 1 |
| `--adapter` omitted, config file missing | route to stdout |
| `--adapter` names unknown adapter | exit 1 |
| Adapter `command` is missing or falsy | exit 1 before healthcheck |
| Adapter `input` is `'argv'` | exit 1 (not supported in Phase 11) |
| Adapter `input` absent or unknown | exit 1 before healthcheck |
| `--model` provided without `--adapter` | warning to stderr; `--model` ignored |

Error message for argv adapters:

```
Error: argv adapters cannot deliver compiled context in Phase 11.
Use a stdin adapter (claude, codex, agy) or pipe to stdout with --adapter omitted.
```

### Adapter config validation

After reading `.ai/cli-adapters.json`, validate the named adapter's fields
before healthcheck or spawn:

- Config file is not valid JSON → exit 1.
- `args` absent → treat as `[]`.
- `args` present but not an array of strings → exit 1.
- `healthcheck.args` present but not an array of strings → exit 1.
- `healthcheck.timeout_ms` present but not a positive integer → exit 1.

These checks run before healthcheck and before placeholder resolution.

### Placeholder resolution

For `input: 'stdin'` adapters, resolve these placeholders in `args` before
spawn:

| Placeholder | Resolved value |
|---|---|
| `{model}` | Value of `--model` flag |
| `{assignment}` | `artifact.objective` (plain text) |
| `{token_budget}` | `artifact.budget.limit_tokens` (as string) |

If `{model}` is present in args but `--model` is not provided → exit 1 before
spawn, listing all unresolved placeholders. Any other unrecognised placeholder
remaining after substitution → exit 1 before spawn.

### Healthcheck

If `healthcheck` is configured:

- `healthcheck.args` absent → run command with no args (`[]`).
- Enforce `healthcheck.timeout_ms` if set. Timeout → kill, error to stderr,
  exit 1, no journal entry.
- Non-zero exit → error to stderr, exit 1, no journal entry.

### Post-spawn outcomes

| Outcome | Exit | Journal status |
|---|---|---|
| Adapter exits 0 | 0 | `ok` |
| Adapter exits non-zero | 1 | `failed (exit <N>)` |
| Adapter killed by signal | 1 | `failed (signal <name>)` |
| Spawn error (not found, permission) | 1 | `failed (spawn error)` |

`--route` inherits adapter stdout/stderr directly. No timeout on main adapter
invocation. If the journal append itself fails after the adapter ran → write
error to stderr and exit 1.

## Task Journal Recording

On every `--route` that reaches the routing step (adapter spawned or stdout),
append one entry to `.ai/state/context-routes.md` (create file and parent
directories if absent):

```markdown
## 2026-07-14T08:30:00Z — .ai/state/context/TASK-01.json

- Objective: refactor router fallback
- Repository fingerprint: abc123
- Estimated tokens: 4823/6000
- Files included: 5
- Omitted candidates: 3
- Adapter: claude (stdin)
- Model: claude-sonnet-4-6
- Status: ok
```

`Model` omitted when `--model` not provided. `Adapter` is `stdout` when routing
to stdout. Entry is written after adapter completes. Healthcheck failures produce
no entry.

**Sanitization:** before writing, replace all ASCII control characters (0x00–0x1F,
including newlines and tabs) in user-provided strings (objective, model, adapter
name, artifact path) with a space. Prevents crafted objective text from injecting
fake Markdown entries into the audit log.

The file is append-only and never read by the tool.

## Need_context Protocol

When a delegated model needs additional context, it writes a `forgeai_need_context`
JSON file and the orchestrator runs `--expand-context`.

### Request format

```json
{
  "kind": "forgeai_need_context",
  "schema_version": 1,
  "artifact": ".ai/state/context/TASK-01.json",
  "requests": [
    { "kind": "symbol", "name": "AuthService", "reason": "implementation missing" },
    { "kind": "file",   "path": "src/auth/internal.ts", "reason": "need private helper" },
    { "kind": "test",   "path": "test/auth.test.ts", "reason": "need test context" }
  ]
}
```

The `artifact` field in the JSON is human reference only. The `--artifact` CLI
flag is authoritative.

### Runtime validation of need_context

Validate the JSON before processing:

- `kind === 'forgeai_need_context'`
- `schema_version === 1`
- `artifact` is a non-empty string (informational only, but must be present and
  non-empty to confirm the model produced a well-formed request)
- `requests` is a non-empty array
- Each item is a plain object matching one union variant:
  - `{ kind: 'symbol', name: string (non-empty), reason: string }`
  - `{ kind: 'file',   path: string (non-empty), reason: string }`
  - `{ kind: 'test',   path: string (non-empty), reason: string }`

Unknown request kinds are rejected per-item (not silently skipped).

### expand-context execution order

1. Validate primary artifact with `validateArtifact()`. A malformed, stale, or
   over-budget primary is rejected before any request processing.
2. Validate need_context schema.
3. Resolve and validate each request → produce `ResolvedContextRequest[]`.
4. Compile expansion with `compileContextExpansion()`.

### Request resolution

Produce a `ResolvedContextRequest` (see type below) for each valid request,
preserving the original kind, symbol name, reason, and resolved path.

#### file / test requests

Path must match a `DependencyGraphNode.path`. Paths outside the repository root
or inside `IGNORED_DIRECTORIES` are always rejected.

#### symbol requests

Search both graphs for declarations matching the name:

- **Dependency graph**: any `DependencyGraphNode.exports` entry matching the
  name → resolve to that node's path.
- **Curated CodeGraph** (if available): any `CodeGraphNode.public_contracts`
  entry matching the name → resolve to that node's path.

A symbol resolving to multiple paths produces one `ResolvedContextRequest` per
path (deduplication below). A symbol found in neither graph is rejected.

After resolution, deduplicate `ResolvedContextRequest` entries by
`(requestKind, path, symbol or undefined)`. This preserves distinct semantics:
a path requested as both `file` and `test` produces two entries with different
selection behaviour; a path requested as both `file` and `symbol` also produces
two entries. Candidate-level deduplication later removes overlapping excerpts.

Invalid requests are reported as warnings to stderr. If no requests pass
validation → exit 1, write nothing.

## Expansion Compilation per Request Kind

The existing `compileContext()` uses `selectContextForObjective()` and objective
keyword matching. Expansion requires kind-aware forced inclusion. The new
`compileContextExpansion()` function applies different selection rules per
request kind to ensure the model actually receives the context it requested.

### symbol requests

For a `symbol` request resolved to a file path, `candidatesForFile()` is run
with the primary objective terms. Additionally, any declaration in the file
whose name exactly matches the `symbol` field is force-included at priority 0
regardless of export status or objective match. The request `reason` is used as
the excerpt inclusion reason for the force-included declaration.

### file requests

For a `file` request, `candidatesForFile()` is run with the match filter
suppressed — all declarations in the file become candidates regardless of export
status or objective match. Budget constraints still apply: some candidates may
be omitted or downgraded to `signature` mode if the budget is exhausted. The
request `reason` is the base reason for all excerpts from this file.

### test requests

Same as `file` requests, but only declarations with `kind === 'test'` are
force-included without objective matching. Non-test declarations in the file
still require objective match or export status.

### Deduplication against primary

Each `ExcerptCandidate` produced by `candidatesForFile()` contains:

```typescript
{ priority: number; full: CompiledContextExcerpt; signature: CompiledContextExcerpt | null }
```

Use the base identity key `(path, source_start_line, source_end_line, kind)` to
look up what the primary artifact already contains for that syntax node. Apply
the **mode-aware dominance rule** to each candidate before packing:

| Primary excerpt for key | Action on candidate |
|---|---|
| `mode: 'full'` | Drop entire candidate (`full` and `signature` both removed). Primary is complete. |
| `mode: 'signature'` | Keep `candidate.full`; set `candidate.signature = null`. If `full` does not fit budget, the compiler must not fall back to `signature` — the node is already present at that level. |
| absent | Keep candidate unchanged (`full` and `signature` both available). |

The second row is the critical upgrade path: a model that received a function in
`signature` mode can request the full body via `need_context` and receive it in
the expansion. If the expansion budget is insufficient for `full`, the node is
omitted entirely rather than retransmitting the same `signature`.

After applying the dominance rule, if no candidates remain → exit 1:

```
Error: requests produced no new context after deduplication against the primary artifact.
```

If candidates remain but none fit the expansion budget → exit 1:

```
Error: expansion budget is too small for the requested context; increase --budget.
```

Set `objective` to `[expansion] <primary.objective>`.

## Expansion Budget

Default:

```
primary.budget.limit_tokens - primary.budget.estimated_tokens
```

If this value is less than `MIN_BUDGET` (256) → exit 1, require `--budget`
explicit. Do not silently raise. If `--budget` is explicit, apply the same bounds
as `--compile-context` (256–200 000). Cumulative tracking across multiple
expansions is the orchestrator's responsibility.

## Shared Token Estimate Helper

Export `computeArtifactEstimate(artifact: CompiledContextArtifact): number` from
`context-compiler.ts`. The existing internal `stableArtifactEstimate()` mutates
`artifact.budget.estimated_tokens` during its fixed-point loop. The new helper
must be **pure** — it clones the artifact, runs the fixed-point loop on the
clone, and returns the converged value without touching the input.

This distinction is critical for validation correctness. The validator pattern:

```typescript
const declared = artifact.budget.estimated_tokens;   // read before calling helper
const recomputed = computeArtifactEstimate(artifact); // pure: does not mutate
if (declared !== recomputed) reject();
```

If `computeArtifactEstimate` were to mutate `artifact`, a falsified
`estimated_tokens` would be overwritten before the comparison, causing
validation to always pass.

The compiler pattern after adding the export:

```typescript
artifact.budget.estimated_tokens = computeArtifactEstimate(artifact);
```

The compiler still assigns the result back, but now calls the shared helper
instead of the internal function. The internal `stableArtifactEstimate()` can be
removed or kept as a private alias.

## Gitignore Handling

`bin/lib/init.ts` is updated to ensure two entries exist in the project's
`.gitignore` during `forgeai-init` and `--upgrade`:

```
.ai/state/context/
.ai/state/context-routes.md
```

Rules:

- If `.gitignore` does not exist, create it with just these two entries
  (unless `--dry-run` is active, in which case log what would be created).
- If `.gitignore` exists, check for each entry by exact line match. Append
  only the missing entries.
- Before appending, ensure the file ends with a newline. If the last byte is
  not `\n`, write `\n` before the new entries.
- The append is idempotent: running init or upgrade multiple times produces no
  duplicates.
- `--dry-run` logs which entries would be added or created without writing.

## New Types

Added to `bin/lib/types.ts`:

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
  symbol?: string;   // set only for symbol requests
  reason: string;
};
```

## New Modules

### `bin/lib/router.ts`

Exports:

- `validateArtifact(artifactPath: string, repositoryRoot: string): ArtifactValidationResult` —
  full validation: parse, structural check, cross-field checks, dependency graph
  health, fingerprint, path membership, token estimate recomputation.
- `resolvePlaceholders(args: string[], context: { model?: string; assignment: string; tokenBudget: number }): { resolved: string[]; unresolved: string[] }` —
  substitutes known placeholders; returns unresolved placeholder names.
- `routeToAdapter(artifact: CompiledContextArtifact, artifactPath: string, adapterName: string | null, model: string | null, repositoryRoot: string): void` —
  reads adapter config read-only, validates adapter fields, enforces stdin-only
  constraint, resolves placeholders, runs healthcheck, spawns adapter, writes
  journal entry.
- `runValidateArtifact(): void` — CLI entry point for `--validate-artifact`.
- `runRoute(): void` — CLI entry point for `--route`.

### `bin/lib/context-expansion.ts`

Exports:

- `validateNeedContext(request: NeedContextArtifact, dependencyGraph: DependencyGraph, curatedGraph: ReturnType<typeof readCuratedCodeGraph>, repositoryRoot: string): { valid: ResolvedContextRequest[]; rejected: Array<{ item: NeedContextRequestItem; reason: string }> }` —
  validates each request against both graphs, resolves symbol requests to paths,
  preserves kind/symbol/reason metadata. `curatedGraph` may be null; skips
  `public_contracts` lookup when null.
- `runExpandContext(): void` — CLI entry point for `--expand-context`.

### Updated: `bin/lib/context-compiler.ts`

New exports:

- `computeArtifactEstimate(artifact: CompiledContextArtifact): number` —
  pure shared fixed-point token estimate helper. Clones the artifact before
  running the loop; does not mutate the input. Replaces internal
  `stableArtifactEstimate()` at all call sites within the module.
- `compileContextExpansion(primary: CompiledContextArtifact, requests: ResolvedContextRequest[], curatedGraph: ReturnType<typeof readCuratedCodeGraph>, dependencyGraph: DependencyGraph, repositoryRoot: string, options: { budget?: number }): CompiledContextArtifact` —
  kind-aware forced inclusion as described in "Expansion Compilation per Request
  Kind". Returns a `CompiledContextArtifact` with `schema_version: 1`.

### Updated: `bin/lib/context-pack.ts`

- Export `tokenizeObjective(objective: string): string[]` — the existing private
  tokenization helper used by `selectContextForObjective()`. This export allows
  `compileContextExpansion()` to extract objective terms from `primary.objective`
  using the same algorithm without copying the logic.

## Files Changed

| File | Change |
|---|---|
| `bin/lib/types.ts` | Add `NeedContextRequestItem`, `NeedContextArtifact`, `ArtifactValidationResult`, `ResolvedContextRequest` |
| `bin/lib/context.ts` | Export `validateArtifact`, `route`, `expandContext` flags |
| `bin/lib/context-compiler.ts` | Export `computeArtifactEstimate()`, `compileContextExpansion()`; replace all `stableArtifactEstimate()` call sites |
| `bin/lib/context-pack.ts` | Export `tokenizeObjective()` |
| `bin/lib/router.ts` | New module |
| `bin/lib/context-expansion.ts` | New module |
| `bin/lib/init.ts` | Update `--help` text; idempotent `.gitignore` maintenance |
| `bin/forgeai-init.ts` | Wire `--validate-artifact`, `--route`, `--expand-context` |
| `test/context-routing.test.ts` | New: covers `--validate-artifact`, `--route`, journal recording |
| `test/context-expansion.test.ts` | New: covers `--expand-context`, request validation, expansion compilation |
| `test/upgrade.test.ts` | Extend: gitignore created when absent; idempotent; trailing newline; `--dry-run` |
| `test/lifecycle.test.ts` | Extend: help output contains three new command names |
| `test/dist.test.ts` | Extend: new CLI flags present in compiled dist help output |
| `package.json` | Version bump to 3.3.0 |
| `package-lock.json` | Sync version |
| `README.md` | Document `--validate-artifact`, `--route`, `--expand-context` usage |
| `docs/migrations/3.3.0.md` | Migration note: `--upgrade` now writes `.gitignore` entries |
| `CHANGELOG.md` | 3.3.0 entry |

Note: `test/router.test.ts` already exists and tests `.ai/router/run-model.ts`.
New routing tests go into `test/context-routing.test.ts`.

## Exit Criteria

- `--validate-artifact` exits 0 (nothing to stdout) for a valid fresh artifact;
  exits 1 for: invalid JSON, missing/wrong-type required fields, declared limits
  outside Phase 10 compiler bounds (`limit_tokens` outside 256–200 000,
  `max_depth` outside 0–5, `max_nodes` outside 1–50), cross-field violations,
  missing/unhealthy dependency graph, stale fingerprint, path not in dependency
  graph, mismatched token estimate, `estimated_tokens > limit_tokens`.
- `--route` rejects invalid artifacts before spawning any adapter process.
- `--route` exits 1 for argv adapters, missing command, unknown input mode, or
  unresolved placeholders.
- `--route` exits 1 if the adapter config file is missing and `--adapter` was
  named.
- `--route` without `--adapter` writes validated JSON to stdout.
- `--route` journal append failure causes exit 1 after the adapter run completes.
- `--model` provided without `--adapter` emits a warning; `--model` is not used.
- `--expand-context` calls `validateArtifact()` before processing requests.
- `--expand-context` without `--output` writes supplemental JSON to stdout; no
  context artifact file is created without `--output`.
- `--expand-context` exits 1 when default expansion budget < 256 and `--budget`
  not provided.
- `--expand-context` validates need_context JSON structure per union variant
  before processing any request.
- `--expand-context` includes force-selected declarations per request kind;
  symbol declarations are force-included by name, file requests include all
  declarations, test requests include all test-kind declarations.
- `--expand-context` exits 1 with "requests produced no new context after
  deduplication" when all candidates are removed by the dominance rule.
- `--expand-context` exits 1 with "expansion budget is too small for the
  requested context; increase --budget" when candidates exist but none fit.
  These two errors are distinct; orchestrators can distinguish "change request"
  from "increase budget".
- Supplemental artifacts apply the mode-aware dominance rule: a primary
  `signature` excerpt does not block an expansion `full` excerpt for the same
  syntax node; if `full` does not fit budget the node is omitted, not
  retransmitted as `signature`. A primary `full` excerpt blocks both.
- `forgeai-init` and `--upgrade` maintain `.gitignore` entries for
  `.ai/state/context/` and `.ai/state/context-routes.md`: create the file if
  absent, append missing entries idempotently, ensure trailing newline before
  appending, respect `--dry-run`.
- Journal strings are sanitized: control characters replaced with space.
- All status, warning, and error output goes to stderr. Artifact JSON goes to
  stdout only.

### Required regression tests

The following cases must each have a dedicated test:

1. **Falsified token estimate is rejected.** Produce a valid artifact, set
   `estimated_tokens` to a different value, write back to disk. `--validate-artifact`
   must exit 1. Confirms `computeArtifactEstimate()` is pure and the declared
   value is compared before any mutation.

2. **Signature in primary allows full body in expansion.** Produce a primary
   artifact where one function appears as `mode: 'signature'`. Produce a
   need_context request for that symbol. `--expand-context` must include the
   function as `mode: 'full'` in the supplemental artifact.

3. **Same path with both `file` and `test` request is deterministic.** Include
   the same path in a need_context request once as `kind: 'file'` and once as
   `kind: 'test'`. The expansion must produce candidates for both kinds
   independently (dedup key includes `requestKind`); the final candidate set
   must be identical across repeated runs with the same input.

4. **Gitignore created when absent.** Run `forgeai-init` in a directory with no
   `.gitignore`. After init the file must exist and contain both
   `.ai/state/context/` and `.ai/state/context-routes.md`.

5. **Gitignore append is idempotent and preserves trailing newline.** Run
   `forgeai-init` twice with an existing `.gitignore` that already contains one
   entry and has no trailing newline. After each run: no duplicate entries, file
   ends with a newline, original content is preserved.
