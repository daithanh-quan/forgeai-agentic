# Phase 13A — Structured Evaluation Records and Aggregate Report Design

Status: approved, ready for implementation planning.
Target version: 3.9.0 (from 3.8.0).
Depends on: Phase 10 (context compiler), Phase 11 (enforced context boundary,
`need_context`), Phase 12A/12B (LLM-native adapters and `RunRecord`, shipped
3.7.0/3.8.0), Phase 4 (review scorecards).

## Goal

Replace manually-entered evaluation data with structured records derived from
existing machine artifacts, and add a terminal report over them. This is the
foundation slice of Phase 13 (Evaluation and routing feedback). It delivers
three sub-tasks:

1. **13A.1 — Schema + linking.** Stamp a `task_id` into the compiled context
   artifact and the run record so evaluation data can be joined by a real key,
   not a filename heuristic.
2. **13A.2 — Validation + recording.** A new `--evaluate --task <id>` command
   that joins the task journal, review scorecard, run records, and context
   artifact by `task_id`, enforces a consistency gate, derives an outcome from
   the review verdict, and writes one structured JSON evaluation record with
   full provenance.
3. **13A.3 — Aggregate report.** A new `--report` command that aggregates
   evaluation records into a terminal report grouped by model tier (pass rate,
   token cost, latency, retries).

Deferred to Phase 13B (separate spec): baseline/compact experiment modes, the
sample-sufficiency gate, and advisory routing recommendations.

## Overarching principles

1. **JSON records are the source of truth; the report is presentation.** The
   report never holds state the records do not.
2. **Never guess an outcome.** If the scorecard evidence contradicts its
   verdict, or any consistency check fails, `--evaluate` errors and writes
   nothing. A missing or ambiguous outcome is an error, not a default.
3. **Additive and backward compatible.** `task_id` is optional on existing
   schemas; `schema_version` stays `1`. Records and artifacts written before
   3.9.0 read as `task_id: null`.
4. **Reuse structured data; add no new agent instrumentation.** Every metric is
   computed from artifacts, run records, and scorecards that already exist.
5. **The legacy manual path keeps working.** `--check-evaluation` and
   `.ai/evaluation/*.md` are soft-deprecated (a one-line notice), not removed.

## Design decisions (resolved during brainstorming)

| Decision | Choice |
|----------|--------|
| Scope | Phase 13A only: 13A.1 schema+linking, 13A.2 validation+recording, 13A.3 aggregate report. 13B deferred. |
| Run→task linking | Explicit `task_id` field stamped into `CompiledContextArtifact` and `RunRecord`. **No artifact-path/filename heuristics** — `--route` accepts arbitrary artifact paths. |
| Primary vs expansion | Both primary and `--expand-context` artifacts carry the same `task_id`, so a structural discriminator `artifact_role: 'primary' \| 'expansion'` is added. `--evaluate` selects the single **primary**; expansion artifacts are counted for `expansion_rounds`. A missing `artifact_role` (pre-3.9.0) normalizes to `'primary'`. **No `[expansion]`/filename heuristics.** `parent_artifact` linkage is deferred to 13B (would require threading the primary path through `compileContextExpansion`). |
| Record creation | Explicit `--evaluate --task <id>`. Not auto-drafted at route time (a route proves a call happened, not that the task succeeded). |
| Outcome source | Derived from the review scorecard `Verdict`: `approve→pass`, `request changes→fail`, `needs human decision→partial`. |
| Consistency gate | `--evaluate` enforces a stricter check than the review gate before trusting the verdict (see §4). Contradiction ⇒ fail, no record. |
| Manual outcome | Not a primary path. A `--outcome` override is **out of scope for 13A** (future CI import escape hatch with explicit provenance). |
| Legacy eval | Keep `--check-evaluation` + `.ai/evaluation/*.md`; print a one-line soft-deprecation notice. Removal deferred. |
| Storage | `.ai/state/evaluations/<task_id>.json`. Gitignored (local derived state) and preserved on upgrade, matching the `.ai/state/runs/` precedent. |
| Idempotency | Keyed by `task_id` (filename `<task_id>.json`); re-running recomputes and overwrites atomically (temp + rename). |
| Report recommendations | None in 13A. Report is descriptive only; recommendations are 13B. |

## Components

### 1. Types (`bin/lib/types.ts`)

- `CompiledContextArtifact`: add `task_id: string | null` and
  `artifact_role: 'primary' | 'expansion'`. Additive; `schema_version` stays
  `1`. The router's artifact validator (`router.ts` `checkStructure`) must
  accept the fields: `task_id` is valid when **absent/null** or a non-empty
  string matching the task-id shape (see §2), rejecting present-but-empty or
  malformed values; `artifact_role` is valid when **absent** (normalized to
  `'primary'`) or exactly `'primary'`/`'expansion'`.
- **Backward-compatible normalization (required).** `computeArtifactEstimate`
  serializes the entire artifact, so adding `task_id`/`artifact_role` to a
  pre-3.9.0 artifact changes its estimated-token count. `validateArtifact` must
  therefore recompute the estimate against the **raw** parsed object first, and
  only then return a normalized artifact
  `{ ...raw, task_id: raw.task_id ?? null, artifact_role: raw.artifact_role ?? 'primary' }`.
  New (3.9.0+) artifacts include both fields at creation, so their declared
  estimate is already self-consistent.
- `RunRecord`: add `task_id: string | null`. Same backward-compat pattern as
  `retry_count` in 12B — `isValidRunRecordInput` accepts `task_id` when absent,
  `null`, or a non-empty string; `listRunRecords` normalizes each record to
  `{ ...raw, task_id: raw.task_id ?? null }` so consumers always see the field.
  Do not tighten the return into a `raw is RunRecord` predicate for
  un-normalized input (the existing function already returns `boolean`).
- New `EvaluationRecord` type (see §3 for the JSON shape and field types).

All existing `RunRecord` and `CompiledContextArtifact` literals in providers,
`api-adapter.ts`, `context-compiler.ts`, `router.ts`, and tests must set the new
`task_id` field (`null` for the no-task case).

### 2. Stamping `task_id` (13A.1)

Task-id shape: reuse the lifecycle convention `TASK-YYYYMMDD-<slug>`. A shared
validator `isValidTaskId(id: string): boolean` (new small export, e.g. in
`lifecycle.ts` or `utils.ts`) rejects the template placeholders
(`TASK-YYYYMMDD-short-slug`, `TASK-...`) and empty strings. Reused by
`--compile-context`, artifact validation, and `--evaluate`.

- **`--compile-context --task <id>`** (`context-compiler.ts`,
  `runCompileContext`): read `getArgValue('--task')`. When present, validate the
  shape (error + exit 1 on malformed) and set `artifact.task_id`. When absent,
  set `null`. The primary artifact is stamped `artifact_role: 'primary'`; the
  `--expand-context` artifact is stamped `artifact_role: 'expansion'` and copies
  the primary's `task_id`. Both fields are set on the artifact object **before**
  the internal estimate pass so the declared estimate stays self-consistent.
- **`--task` value validation.** `--task` must be added to the eager
  value-requiring flag list in `context.ts` (currently
  `['--profile','--emit','--adapter','--model']`) so a bare `--compile-context
  --task` (no value) fails fast with `--task requires a value` instead of being
  silently treated as "no task".
- **`--route`** (`router.ts`, `runRoute` → run-record construction): copy
  `artifact.task_id` (already validated at load) into the `RunRecord`. No new
  route flag — the task id rides on the artifact so a routed run is always
  attributed to whatever task compiled its context. If the artifact has no
  `task_id`, the run record's is `null` (and such runs are simply not matched by
  `--evaluate`).

Backward compatibility: artifacts/run records produced before 3.9.0 have no
`task_id`; they load as `null` and are ignored by `--evaluate`. This is
acceptable for a new feature — no migration of historical runs.

### 3. `EvaluationRecord` (13A.2 output)

Written to `.ai/state/evaluations/<task_id>.json`:

```json
{
  "kind": "forgeai_evaluation_record",
  "schema_version": 1,
  "evaluation_id": "eval-TASK-20260724-routing",
  "task_id": "TASK-20260724-routing",
  "generated_at": "2026-07-24T12:00:00.000Z",
  "outcome": "pass",
  "outcome_source": {
    "type": "review_scorecard",
    "scorecard": ".ai/state/reviews/TASK-20260724-routing.md",
    "verdict": "approve"
  },
  "validation": {
    "status": "pass",
    "evidence_count": 4,
    "results": { "pass": 4, "fail": 0, "skipped": 0 }
  },
  "run_ids": ["run-20260724T120000Z-...."],
  "context_artifact": ".ai/state/context/TASK-20260724-routing.json",
  "task_journal": ".ai/state/tasks/TASK-20260724-routing.md",
  "tier": "standard",
  "metrics": {
    "context": {
      "selected_files": 6,
      "excerpts": 11,
      "omitted_candidates": 3,
      "budget_limit_tokens": 6000,
      "budget_estimated_tokens": 5210,
      "budget_utilization": 0.868,
      "expansion_rounds": 1,
      "context_escapes": null
    },
    "calls": {
      "model_calls": 1,
      "input_tokens": 5100,
      "output_tokens": 820,
      "cached_tokens": 0,
      "latency_ms": 4300,
      "retries": 0
    }
  }
}
```

Field notes:

- `evaluation_id` is deterministic: `eval-<task_id>` (idempotent, no random
  component — stable filename by design).
- `outcome`: `pass | fail | partial`.
- `outcome_source`: provenance for audit. Type is `review_scorecard` in 13A
  (`Verdict` + `Unresolved blockers` come from the scorecard).
- `validation`: aggregated from the **task journal's "Commands And Validation"
  table** (not the scorecard) — `pass`/`fail`/`skipped` counts via the existing
  `review.ts` helpers `extractTableRows(journal, 'Commands And Validation')` +
  `isRealEvidenceRow`. `status` = `fail` if any `fail` row, else `pass` if any
  `pass` row and no `fail`, else `partial` (only `skipped`).
- `run_ids`: every `RunRecord` whose `task_id` matches. May be empty (a task
  completed via a CLI adapter that wrote no run record) — allowed; the calls
  metrics are then zero and the record notes `model_calls: 0`.
- `context_artifact`: the **primary** artifact (`artifact_role: 'primary'`)
  whose `task_id` matches, if exactly one is found under `.ai/state/context/`.
  `null` when none matches; more than one primary is a gate failure (see §4).
  Expansion artifacts are not eligible here.
- `task_journal`: repo-relative path of the resolved task journal (provenance).
- `expansion_rounds`: count of `artifact_role: 'expansion'` artifacts under
  `.ai/state/context/` whose `task_id` matches (i.e. expansion rounds recorded
  for the task). `0` when none.
- `context_escapes`: **`null`** in 13A. Rejected `need_context` requests are only
  warned to stderr by `--expand-context`, never persisted, so an escape count
  cannot be derived from stored data. `null` means "not measured"; `0` would
  falsely assert "no escapes". Real attribution is deferred to 13B.
- `tier`: resolved by matching each run's `provider`/`model` against
  `model-routing.yaml` tiers (`fast`/`standard`/`strong`). Resolve across **all**
  matched runs: if every non-`unknown` run agrees on one tier, use it; if runs
  disagree, or there are no runs, use `"unknown"`.

### 4. `--evaluate --task <id>` command (13A.2)

New module `bin/lib/evaluation-record.ts`, `runEvaluate()`. Steps:

1. **Resolve inputs by `task_id`** (no path heuristics):
   - Journal: the `.ai/state/tasks/*.md` file whose parsed `Task ID` equals
     `<id>`. Exactly one required.
   - Scorecard: `.ai/state/reviews/<id>.md`. Required.
   - Run records: all from `listRunRecords(root)` with `task_id === id`.
   - Context artifacts: files under `.ai/state/context/` whose `task_id` equals
     `<id>`. Each candidate is **fully structurally validated** via
     `checkArtifactStructure` — the pure structural validator **exported** from
     `router.ts` (its former private `checkStructure`), which checks
     `schema_version`, `task_id`/`artifact_role` shape, selection/excerpts/budget,
     etc. but **not** fingerprint/graph freshness (so an artifact compiled at an
     earlier revision is still evaluable). A malformed artifact is skipped, never
     fed to `computeMetrics`. Partition by `artifact_role`: exactly zero or one
     **primary**; any number of **expansion** (counted).
2. **Consistency gate** — fail (exit 1, write nothing) if any of:
   - `<id>` is not a valid task id shape.
   - No journal, multiple journals, or no scorecard for `<id>`.
   - Journal `Task ID` ≠ `<id>`, or the scorecard `- Task ID:` bullet ≠ `<id>`
     (all three must agree).
   - Scorecard still contains `TODO` / placeholder text.
   - `Verdict` is missing or not one of `validRecommendations`
     (`approve`/`request changes`/`needs human decision`).
   - The scorecard has **no** dimension rows, or any dimension rating (the
     "Scorecard" table) is missing/empty or not `pass`/`concern`/`fail`. (An
     empty rating must fail, not be skipped.)
   - No real validation evidence row in the journal's "Commands And Validation"
     table (reuse `review.ts` `extractTableRows` + `isRealEvidenceRow`).
   - **Verdict/evidence contradiction:** `Verdict = approve` while any journal
     evidence row is `fail`, **or any scorecard dimension is rated `fail`**, or
     while scorecard `Unresolved blockers` is non-empty and not `none`.
   - More than one **primary** context artifact matches `<id>` (ambiguous
     linkage).
   The `TODO` check uses a case-insensitive `/\bTODO\b/i` so lowercase `todo`
   placeholders are also caught.
   Each failure prints a specific `formatStatus('invalid', …)` line, mirroring
   the review-check output style. This gate is intentionally **stricter** than
   `runCheckReview` (`review.ts:65`), which only checks presence + valid verdict;
   the evaluator must not trust a verdict it has not cross-checked against
   evidence.
3. **Derive outcome:** `approve→pass`, `request changes→fail`,
   `needs human decision→partial`.
4. **Compute metrics** (§3) from the matched primary artifact, expansion count,
   and run records.
5. **Write atomically + idempotently:** serialize, write to a temp file in
   `.ai/state/evaluations/`, `fs.renameSync` to `<task_id>.json`. Re-running
   overwrites deterministically.
6. **Report success:** print the outcome, source verdict, run count, and file
   path.

Missing `--task`: usage error to stderr, exit 1 (match the `--validate-artifact`
usage-error style). A bare `--task` is already rejected earlier by the eager
value check (§2).

**Storage safety — validation and path traversal.** `record.task_id` is
interpolated into the output filename, so `writeEvaluationRecord` and
`readEvaluationRecord` MUST guard the id with `isValidTaskId` before building any
path (a value like `../../x` is rejected — never written or read). The
`isValidEvaluationRecord` read validator MUST be a **full** structural check, not
a five-field spot check: `kind`, `schema_version === 1`,
`isValidTaskId(task_id)`, **`evaluation_id === \`eval-${task_id}\``**, a
**canonical** ISO `generated_at` (`new Date(v).toISOString() === v`),
`outcome`/`validation.status`/`outcome_source.type` unions, string `tier`, array
`run_ids`, string `task_journal`, and the complete nested
`metrics.context`/`metrics.calls` fields as **non-negative integers**, with two
real-valued exceptions: `metrics.calls.latency_ms` and
`metrics.context.budget_utilization` are non-negative reals (decimals allowed,
matching `RunRecord.latency_ms`); `context_escapes` is `number | null`.
`validation.evidence_count` MUST equal `pass + fail + skipped`. A record that
parses as JSON but is missing `metrics.calls` must be rejected so `--report`
cannot crash on it. `listEvaluationRecords` additionally requires the filename to
equal `\`${task_id}.json\`` so a stray/renamed file cannot misattribute or
duplicate a record.

### 5. `--report` command (13A.3)

New module `bin/lib/evaluation-report.ts`, `runReport()`. Reads all
`EvaluationRecord`s from `.ai/state/evaluations/` (skip malformed, same
tolerance as `listRunRecords`). Prints a terminal report:

- **Empty state:** a clean `formatStatus('ok', '.ai/state/evaluations has no
  evaluation records')` line, like `--list-runs`.
- **Overall summary:** total evaluations, pass/partial/fail counts and pass
  rate.
- **Per tier** (`fast`/`standard`/`strong`/`unknown`): **evaluation** count
  (labelled "evaluations", not "runs"), pass rate, **total input + output
  tokens**, **mean token cost** (total tokens ÷ evaluation count), mean latency,
  total retries.
- **Metric lines** use `formatStatus('metric', …)`, matching
  `runCheckEvaluation`'s existing metric output style.

`--report --json` emits the aggregate object as JSON to stdout for CI
consumption instead of the human report. `--json` is a bare boolean flag, so the
check MUST be `args.has('--json')` — **not** `getArgValue('--json')`, which
returns `string | null` (never `undefined`) and would make JSON output
unconditional. The JSON is a view derived from the records, never a separate
stored artifact. Both modes have CLI tests.

No routing recommendation is printed. The report is descriptive; recommendations
are gated on the 13B sample-sufficiency work.

### 6. Legacy soft-deprecation (`bin/lib/evaluation.ts`)

`runCheckEvaluation` keeps its current behavior. Add one notice line near the
top of its output:

```
[deprecated] --check-evaluation validates the manual .ai/evaluation/*.md files.
Structured evaluation is now --evaluate / --report. See CHANGELOG 3.9.0.
```

No behavior change, no removal, exit code unchanged. `.ai/evaluation/*.md`
templates are untouched.

### 7. CLI and flag wiring

- `bin/lib/context.ts`: add `export const evaluate = args.has('--evaluate')` and
  `export const report = args.has('--report')`.
- `bin/forgeai-init.ts`: import `runEvaluate` and `runReport`; add
  `else if (evaluate) runEvaluate();` and `else if (report) runReport();` in the
  dispatch chain (before `runInit()`).
- `--compile-context --task <id>` uses the existing `getArgValue('--task')` — no
  new boolean flag needed for compile.
- Help text (`init.ts` `usage()`): document `--evaluate --task <id>`,
  `--report [--json]`, and the new `--compile-context --task <id>` option; note
  `--check-evaluation` is deprecated.

### 8. Storage, gitignore, and upgrade

- Records live in `.ai/state/evaluations/<task_id>.json`.
- `init.ts` `CONTEXT_GITIGNORE_ENTRIES` (line ~264): add
  `.ai/state/evaluations/` so records are gitignored like `.ai/state/runs/`.
- `init.ts` `isPreservedOnUpgrade`: add a regex branch
  `^\.ai\/state\/evaluations\/.+\.json$` so records survive `--upgrade`,
  mirroring the `tasks/` and `reviews/` branches.
- No template files are shipped for the evaluations directory (records are
  wholly generated).

### 9. Documentation and version

Bump `3.8.0 → 3.9.0` in every version location:

- `package.json` `version`.
- `package-lock.json` — both the top-level `version` and the root package entry
  under `packages[""]`.
- `CHANGELOG.md`: 3.9.0 entry — structured evaluation records, `--evaluate`,
  `--report`, `task_id` on artifacts/run records, `--compile-context --task`,
  soft-deprecation of `--check-evaluation`.
- `ROADMAP.md`: mark Phase 13A shipped in 3.9.0; note 13B (baseline/compact,
  sample-sufficiency gate, advisory routing) still open.
- `README.md`: add an Evaluation section documenting the workflow
  (`--compile-context --task` → `--route` → `--evaluate --task` → `--report`),
  the record shape, and the outcome mapping.
- `docs/migrations/3.9.0.md`: additive change; run `forgeai-init --upgrade`. No
  breaking schema or config changes. Note that historical (pre-3.9.0)
  artifacts/run records lack `task_id` and are not retro-evaluated.

## Testing strategy

- **`task_id`/`artifact_role` schema (13A.1):**
  - `isValidTaskId`: accepts `TASK-20260724-slug`; rejects empty, the two
    template placeholders, and malformed shapes.
  - Artifact validator accepts absent/null/valid `task_id` and absent/valid
    `artifact_role`; rejects present-but-empty/malformed `task_id` and an
    unknown `artifact_role`.
  - **Legacy artifact normalization:** a 3.8.0 artifact with **no** `task_id`/
    `artifact_role` validates OK (estimate recomputed on the raw shape) and is
    returned normalized to `task_id: null`, `artifact_role: 'primary'`. Cover
    both `--route` and `--expand-context` reading such an artifact.
  - `isValidRunRecordInput` accepts absent/null/valid `task_id`; `listRunRecords`
    normalizes a pre-3.9.0 record (no field) to `task_id: null`.
  - `--compile-context --task <id>` stamps a valid id and errors on a malformed
    one; a **bare** `--task` (no value) exits 1 with `--task requires a value`;
    `--route` copies the artifact's `task_id` into the run record; the expansion
    artifact is stamped `artifact_role: 'expansion'` with the primary's `task_id`.
- **`--evaluate` consistency gate (13A.2):** one test per rejection path —
  missing/duplicate journal, missing scorecard, journal/scorecard id mismatch,
  lowercase `todo` in scorecard, missing/invalid verdict, **no dimension rows**,
  **empty/invalid rating**, no real evidence, `approve` + `fail` evidence
  contradiction, **`approve` + a `fail` dimension rating**, `approve` +
  unresolved blockers, more than one **primary** artifact (built from two copies
  of a real compiled artifact, so both pass structural validation), and a
  **malformed** context artifact (skipped, not crashing). Each asserts exit code
  1 (or skip for malformed) and **no file written** on failure.
  CLI-driven tests use the shared `test/helpers.ts` (`cli` + `runTs` with its
  absolute tsx loader), never a bare `node --import tsx` from a temp cwd (tsx
  would not resolve there).
- **`--evaluate` happy paths:** `approve→pass`, `request changes→fail`,
  `needs human decision→partial`; metrics computed from a fixture primary
  artifact + matching run records; `expansion_rounds` counts matching
  expansion artifacts; `context_escapes` is `null`; idempotent re-run overwrites
  the same file; run set empty ⇒ `model_calls: 0`, `tier: 'unknown'`, record
  still written; tier resolved from a `model-routing.yaml` fixture, `unknown`
  when no tier matches **and when two runs disagree on tier**.
- **Storage safety:** `writeEvaluationRecord`/`readEvaluationRecord` reject a
  `task_id` containing a path separator (e.g. `../../x`) — no file escapes the
  evaluations dir; `isValidEvaluationRecord` rejects a JSON record that parses
  but is missing `metrics.calls`, has a non-canonical `generated_at`, an
  `evaluation_id` ≠ `eval-${task_id}`, or an `evidence_count` ≠ its parts;
  `listEvaluationRecords` drops a record whose filename ≠ `${task_id}.json`.
- **`--report` (13A.3):** empty state message; aggregation across multiple
  records grouped by tier with correct pass rate, total input+output tokens,
  mean token cost, and the "evaluations" label; a **CLI** `--report` prints the
  human report and `--report --json` emits valid parseable aggregate JSON;
  malformed record files are skipped, not fatal.
- **Legacy:** `--check-evaluation` still passes/fails as before and now prints
  the deprecation notice.
- **Upgrade/gitignore:** an evaluation record is preserved across a simulated
  `--upgrade`; `.ai/state/evaluations/` is present in the generated gitignore.

## Out of scope (13A)

- Baseline and compact experiment task modes (13B.1).
- Sample-sufficiency gate before trusting aggregates (13B.2).
- Advisory routing recommendations from evaluation history (13B.3).
- A `--outcome` manual override / CI import escape hatch.
- Removing the legacy `.ai/evaluation/*.md` manual system.
- Real `context_escapes` measurement (persisting rejected `need_context`
  requests); `null` in 13A, full attribution in 13B.
- `parent_artifact` linkage from expansion → primary artifacts (13B).
- Any web dashboard.

## Process notes

- The user commits every change themselves; do not run `git commit`.
- No CI work for this repository.
