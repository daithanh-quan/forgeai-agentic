# Phase 13C — Context escapes and parent-artifact linkage (design)

Date: 2026-07-27
Status: approved for planning
Scope: two of the four deferred Phase 13 items. The remaining two
(model-tier routing recommendations, `--outcome` manual override) stay
deferred and are out of scope here.

## Problem

Phase 13A/13B shipped structured evaluation, experiments, and an advisory
context-mode recommendation, but left two evaluation-feedback signals stubbed:

1. **`context_escapes` is always `null`.** `computeMetrics` cannot report how
   many distinct context needs a delegated model had that the compiled boundary
   refused.
   Today, rejected `need_context` requests in `--expand-context` are only
   warned to stderr and never persisted (`evaluation-record.ts` `computeMetrics`
   comment), so there is nothing to count. `0` would falsely assert "no
   escapes", so the field is `null`.
2. **Expansion artifacts do not link to their primary.** An artifact with
   `artifact_role: 'expansion'` inherits `task_id`/`mode`/`experiment_id` from
   the primary (`context-compiler.ts` `compileContextExpansion`) but records no
   pointer back to the primary artifact it expanded, so an expansion chain is
   not traceable from the artifact alone.

A "context escape" is a boundary signal: the agent requested context that the
compiled, bounded selection did not contain, and the boundary declined to serve
it. Measuring escapes tells us whether the initial selection was insufficient —
a core ForgeAI concern (send the smallest *complete* input).

## Goals

- Persist every declined `need_context` request as a durable, per-task record,
  including the worst case (a fully-rejected `--expand-context` that writes no
  expansion artifact), safe under concurrent `--expand-context` runs.
- Attribute escapes to an **immutable primary-artifact digest**, not a path, so
  recompiling/overwriting a primary at the same path cannot mis-attribute old
  escapes to a new artifact.
- Have `--evaluate` report a real, provenance-checked `context_escapes` count of
  **distinct declined context needs** (a request retried across runs deduplicates
  to one): `null` when the evaluated primary was never observed by an
  `--expand-context` run, a true `0` when it was observed with no declined
  requests, and `N` for `N` distinct declined needs — never a silent or
  misleading `0`. Any malformed record fails evaluation.
- Record `parent_artifact` on expansion artifacts so an expansion is traceable
  to its primary.
- Keep all artifact/record schema changes additive (`schema_version` stays `1`);
  legacy data reads back with safe defaults.

## Non-goals

- Model-tier routing recommendations in `--report` (deferred).
- `--outcome` manual override in `--evaluate` (deferred).
- Multi-level expansion chains (A→B→C). `--expand-context` is restricted to a
  primary artifact; expansion-of-expansion is rejected (see Design §5).
- Changing what counts as a *valid* `need_context` request, or the expansion
  compilation itself. This phase only records outcomes that already happen.
- Surfacing escapes in `--report`; 13C only wires the per-record metric.

## Design

### 1. `parent_artifact` on `CompiledContextArtifact`

Add an additive field to `CompiledContextArtifact` (`types.ts`):

```ts
parent_artifact: string | null;
```

- **Primary** artifacts: `null`.
- **Expansion** artifacts: the primary artifact's path, normalized
  relative-to-root (the `--artifact` argument passed to `--expand-context`),
  matching the path convention already used by `run.artifact` and
  `evaluation.context_artifact`.

Stamped in `compileContextExpansion`, which already sets
`artifact_role: 'expansion'` and inherits `task_id`/`mode`/`experiment_id`.
The primary's own path is known in `runExpandContext` (the `--artifact` value);
pass it into `compileContextExpansion` (e.g. a `parentArtifactPath` argument or
options field) so the field is stamped where the other role/lineage fields are
set, rather than mutated afterward.

**Back-compat / validation:** `checkArtifactStructure` and the artifact
normalization in `findArtifactsForTask` (`evaluation-record.ts`) read a missing
`parent_artifact` as `null`. Validation stays **lenient**: an expansion artifact
with `parent_artifact: null` (pre-13C) remains valid; newly written expansion
artifacts always set it. `schema_version` stays `1`. `renderCompiledContextMarkdown`
surfaces the parent for expansion artifacts.

### 2. Context-escape store — event-per-file, digest-attributed

Escapes are stored as one file per event under a per-task directory, not a
single shared ledger. This eliminates the read-modify-write lost-update hazard
of a shared file under concurrent `--expand-context` runs, makes dedup a
filename-existence check, and lets each record be validated independently.

```
.ai/state/context-escapes/<task_id>/
    observed/<primary_digest>.json     # a primary was observed by an --expand-context run
    events/<escape_id>.json            # one declined need_context request
```

**Primary digest (immutable provenance).** `primary_digest` is
`sha256(<raw bytes of the primary artifact file>)` in lowercase hex (64 chars).
It is computed from the exact on-disk file both when `--expand-context` records
and when `--evaluate` reads, so identical files hash identically. Recompiling /
overwriting a primary at the same path changes its bytes, hence its digest, so
old escapes (old digest) are never attributed to a new artifact. Provenance is
the digest, never the path.

**Escape event file** (`events/<escape_id>.json`):

```jsonc
{
  "schema_version": 1,
  "kind": "forgeai_context_escape_event",
  "escape_id": "<sha256(primary_digest + '\\n' + canonicalJSON(request) + '\\n' + reason_code) sliced to 16 hex>",
  "task_id": "TASK-20260727-router",
  "recorded_at": "2026-07-27T10:00:00.000Z",
  "primary_artifact": ".ai/state/context/TASK-20260727-router.json",
  "primary_digest": "<64 hex>",
  "request": { "kind": "file", "path": "bin/lib/router.ts", "reason": "need full fallback behavior" },
  "status": "rejected",
  "reason_code": "path_not_in_graph",
  "detail": "path 'bin/lib/router.ts' not found in dependency graph"
}
```

**Observation marker file** (`observed/<primary_digest>.json`):

```jsonc
{
  "schema_version": 1,
  "kind": "forgeai_context_escape_observation",
  "task_id": "TASK-20260727-router",
  "recorded_at": "2026-07-27T10:00:00.000Z",
  "primary_artifact": ".ai/state/context/TASK-20260727-router.json",
  "primary_digest": "<64 hex>"
}
```

**What is an escape (event).** A `need_context` request item submitted to
`--expand-context` that did **not** end up as resolved context in a written
expansion artifact:

- Per-request schema/graph rejections from `validateNeedContext`
  (missing fields, ignored path, path/symbol not in graph, unknown kind).
- The whole valid set when compilation cannot be served after validation —
  either `ContextBudgetError` / `NoNewContextError` from
  `compileContextExpansion`, **or** the pre-compile early return when the default
  remaining primary capacity is below `MIN_BUDGET` (both are budget-insufficiency
  for a valid set that yields no artifact). Each valid request is recorded as an
  escape.

**`reason_code` — stable machine enum** (with human `detail`, preserving today's
warning text):

| reason_code        | condition                                                   |
|--------------------|-------------------------------------------------------------|
| `missing_reason`   | file/test/symbol request without a non-empty reason         |
| `missing_path`     | file/test request without a non-empty path                  |
| `missing_name`     | symbol request without a non-empty name                     |
| `ignored_path`     | requested path is inside an ignored directory               |
| `path_not_in_graph`| requested path absent from the dependency graph             |
| `symbol_not_found` | symbol absent from graph exports and curated contracts      |
| `unknown_kind`     | request `kind` is none of file/test/symbol                  |
| `budget_exceeded`  | valid set could not be served within budget                 |
| `no_new_context`   | valid set was fully duplicated by the primary artifact      |

`validateNeedContext`'s `rejected[]` changes from `{ item, reason }` to
`{ item, reason_code, detail }`. The stderr warning path prints `detail`
(unchanged user-facing text). `budget_exceeded` / `no_new_context` are produced
in `runExpandContext` where those paths are handled, from the `valid` set.

**When records are written.**

- Only when `primary.task_id` is non-null; an escape must be attributable to a
  task. A `task_id: null` primary keeps today's warn-only behavior.
- `--artifact` **must resolve inside the repository root**. `runExpandContext`
  rejects an artifact outside root (a `path.relative(root, artifactPath)` that is
  absolute or starts with `..`) before recording anything, so every stored
  `primary_artifact` / `parent_artifact` is a normalized repo-relative path with
  no `..` traversal.
- `task_id` and `primary_digest` are validated (`isValidTaskId`; 64-hex) before
  being interpolated into any path (traversal guard).
- Recording happens **only after all preconditions pass** — including syntactic
  `--budget` validation. The observation marker is not written for an invocation
  that fails argument validation (e.g. an out-of-range `--budget`), so
  `--evaluate` never reports `0` for a primary that was never actually expanded.
- On **every** `--expand-context` run that passes preconditions against a valid
  primary with a task id, an **observation marker** for that `primary_digest` is
  written (idempotent), regardless of whether any request is declined. This lets
  `--evaluate` tell "observed, zero escapes" (`0`) from "never observed"
  (`null`).
- Each declined request writes `events/<escape_id>.json` **only if that file does
  not already exist** (dedup). `escape_id` hashes `primary_digest` + request +
  `reason_code`, so the same declined request across different runs deduplicates
  to one event: `context_escapes` counts **distinct declined context needs**, not
  occurrences. Writes are atomic (`<file>.<pid>.tmp` + `rename`); distinct
  escapes are distinct files, so concurrent runs never lose each other's events.
- `--expand-context` exit codes and stdout/stderr are otherwise unchanged;
  recording is a side effect.

New module `bin/lib/context-escapes.ts`:

- `artifactDigest(rawContent: string): string` — 64-hex sha256.
- `escapeId(primaryDigest, request, reasonCode): string` — 16-hex.
- `recordObservation(taskId, { primary_artifact, primary_digest }, root): void`.
- `recordEscapes(taskId, escapes: NewEscape[], root): void` — dedup + atomic.
- `resolveEscapeCount(taskId, primaryDigest, root)` →
  `{ ok: true; count: number | null } | { ok: false; reason }`, reading and
  validating every marker/event file for the task.

### 3. `--evaluate` resolves `context_escapes`

`computeMetrics` gains an `escapeCount: number | null` parameter (defaults to
`null`). `runEvaluate` calls `resolveEscapeCount(taskId, primaryDigest, root)`,
where `primaryDigest = artifactDigest(<raw primary file>)`:

- **No primary artifact** for the task → `context_escapes: null` (nothing to
  attribute to; digest cannot be computed).
- **No task escape directory** → `null` (never measured for the task).
- **Directory present, primary digest not observed** → `null` (this exact
  primary was never observed by an `--expand-context` run — e.g. the directory
  only holds a previous primary's records).
- **Primary digest observed** → count of distinct `events/*.json` with `status:
  'rejected'` and `primary_digest` equal to the evaluated primary's digest. Zero
  matching events → **`0`** (observed, none escaped).
- **Malformed record** — any marker/event file that is unparseable, has the wrong
  `kind`/`schema_version`/`task_id`, a bad `escape_id` (must equal the recomputed
  id), a non-ISO `recorded_at`, a `request` that is not an object, a `status`
  other than `rejected`, a `reason_code` outside the enum, or a non-64-hex
  `primary_digest` → `resolveEscapeCount` returns `{ ok: false }` and
  `--evaluate` **fails and writes no record**, naming the offending file.
  Consistent with the strict "never guess" evaluation gate; never silently
  `0`/`null`. The event's `request` is validated only as an object, not as a full
  `NeedContextRequestItem` union — declined requests are recorded *because* they
  were malformed (missing reason/path/name, unknown kind), and the recomputed
  `escape_id` (which hashes the exact stored request) is the integrity guarantee.
- **Unreadable store structure** — if a `observed`/`events` path is a file rather
  than a directory, or a read otherwise throws, `resolveEscapeCount` catches it
  and returns `{ ok: false }` (evaluation fails) rather than propagating.

The `ok: false` check gates record writing in `runEvaluate` before
`buildEvaluationRecord`; the resolved count is threaded into `computeMetrics`.
The read-path validator `isValidEvaluationRecord` already accepts
`context_escapes: number | null` — unchanged.

### 4. Gitignore and upgrade preservation

Escape records are derived local state (like runs and evaluations):

- `init.ts` `CONTEXT_GITIGNORE_ENTRIES`: add `.ai/state/context-escapes/`
  (trailing slash ignores the whole tree, including per-task subdirectories).
- `init.ts` `isPreservedOnUpgrade`: add
  `/^\.ai\/state\/context-escapes\/.+\.json$/` (the `.+` spans the nested
  `<task_id>/events|observed/<name>.json` paths) so `--upgrade` never discards a
  project's escape records.

### 5. Forbid expansion-of-expansion

`--expand-context` currently accepts any artifact as `--artifact`, so an
expansion artifact can be fed back in (A→B→C). Escapes recorded while expanding
`B` would carry `B`'s digest and be missed when evaluating against `A`. Since
multi-level chains are not a documented feature and are out of scope here,
`runExpandContext` rejects a primary whose `artifact_role === 'expansion'` with a
clear error and a non-zero exit. Every escape therefore attributes to exactly one
primary. (Supporting chains via `root_artifact` lineage is a possible future
refinement, explicitly deferred.)

## Data flow

```
--compile-context --task T        -> primary artifact P (parent_artifact: null)
--expand-context --artifact P     -> reject if P is an expansion artifact
                                  -> digest = sha256(raw P);  if P.task_id:
                                       recordObservation(T, digest)            [observed/<digest>.json]
                                  -> validateNeedContext -> rejected[]
                                     + budget/no_new_context/low-capacity on valid set
                                  -> if P.task_id: recordEscapes(T, events)    [events/<escape_id>.json]
                                  -> on success: expansion artifact (parent_artifact: P path)
--evaluate --task T               -> digest = sha256(raw evaluated primary)
                                  -> resolveEscapeCount(T, digest)
                                       malformed file -> FAIL (no record)
                                       digest not observed -> null
                                       observed -> count matching events (>= 0)
                                  -> metrics.context.context_escapes
```

## Testing

- **parent_artifact**: primary compiles with `null`; expansion stamps the
  primary path; legacy artifact without the field normalizes to `null` and stays
  valid; markdown render shows the parent.
- **forbid chain / out-of-root**: `--expand-context` on an `artifact_role:
  'expansion'` primary exits non-zero and records nothing; an `--artifact`
  resolving outside root is rejected before any record is written.
- **recording**: an observation marker is written on every precondition-passing
  run (even with no rejections); a **table-test covering every `reason_code`**
  (including the malformed-request codes `missing_reason` / `missing_path` /
  `missing_name` / `unknown_kind`) records an event that later round-trips
  through `--evaluate` as valid (not malformed); partial rejection records only
  rejected items; full rejection (no artifact) still records every item;
  successful expansion with no rejections → observation only, count `0`;
  `budget_exceeded` recorded on both the caught `ContextBudgetError` and the
  low-capacity early return; an invalid `--budget` writes **no** observation;
  `no_new_context` recorded; `task_id: null` primary writes nothing; atomic write
  leaves no `.tmp`; re-running the same failing expansion adds no files (dedup);
  concurrent distinct escapes coexist; invalid `task_id`/`primary_digest`
  refused.
- **--evaluate counting**: no artifact → `null`; no escape dir → `null`; dir with
  only a different primary's digest → `null` (unobserved); observed digest with
  matching rejections → exact count; observed digest with zero events → `0`; a
  malformed marker/event file, or a `observed`/`events` path that is a file →
  evaluate fails and writes no record; legacy evaluation records (pre-13C) still
  read as `context_escapes: null`.
- **gitignore/upgrade**: entry appended; nested escape files preserved on
  `--upgrade`.

## Rollout notes (for CHANGELOG / roadmap / release)

- Additive `parent_artifact` on compiled-context artifacts; `context_escapes`
  now measured from a per-task, digest-attributed event store with observation
  markers; new `.ai/state/context-escapes/<task_id>/` (gitignored, preserved on
  upgrade). `schema_version` stays `1`; pre-13C artifacts and evaluation records
  normalize to `parent_artifact: null` / `context_escapes: null`.
- Release: 13C ships as part of the consolidated, still-unreleased **3.9.0** that
  covers all of Phase 13 (13A+13B+13C), following the last published `3.8.0`.
  `package.json` +
  `package-lock.json` at `3.9.0`, a single `docs/migrations/3.9.0.md`, a README
  section (store layout, `null`/`0`/`N` semantics, expansion lineage), and one
  merged CHANGELOG `3.9.0` entry.
- ROADMAP Phase 13 records 13A/13B/13C shipped in 3.9.0; deferred list now holds
  only model-tier routing recommendations and a `--outcome` manual override.
