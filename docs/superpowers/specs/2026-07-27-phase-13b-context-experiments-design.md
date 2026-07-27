# Phase 13B — Context Experiments and Advisory Mode Recommendation Design

Status: approved, ready for implementation planning.
Target version: 3.10.0 (from 3.9.0).
Depends on: Phase 13A (evaluation records, `--evaluate`, `--report`, `task_id`
linking, shipped 3.9.0), Phase 10 (context compiler), Phase 11 (enforced
context boundary), Phase 12A/12B (`RunRecord`), Phase 4 (review scorecards).

## Goal

Turn evaluation from **descriptive** (13A: records + a per-tier report) into
**actionable**. This is the second slice of Phase 13 (Evaluation and routing
feedback). It delivers three sub-tasks:

1. **13B.1 — Experiment modes.** A `baseline` / `compact` mode on
   `--compile-context`, so the same task can be run under two context regimes
   and compared fairly. `baseline` sends the same selected files **whole**
   (uncompiled); `compact` is 13A's bounded excerpts.
2. **13B.2 — Sample-sufficiency gate.** A minimum number of complete
   baseline/compact experiment pairs before any advisory is emitted. Below the
   threshold the report still shows the descriptive comparison but withholds the
   recommendation.
3. **13B.3 — Advisory context-mode recommendation.** `--report` recommends
   `prefer compact` only when the sufficiency gate passes, pass-rate degradation
   stays within tolerance, and token or latency savings are material. Always
   marked `[advisory]`.

Deferred to a later phase (separate spec): model-tier recommendations, real
`context_escapes` measurement, `parent_artifact` linkage, and the `--outcome`
manual override / CI import escape hatch.

## Overarching principles

1. **Reuse 13A end to end.** An experiment is two ordinary evaluated tasks. The
   13A consistency gate, outcome derivation, and storage layout are reused; the
   record schema gains additive optional fields (`mode`, `experiment_id`,
   `comparability`) and **no new agent instrumentation** is required — every
   value is derived from existing artifacts, run records, and journals. 13B does
   add one narrow gate: an **experiment provenance gate** in `--evaluate` that
   applies only when a task is part of an experiment (`experiment_id` set), so
   ordinary 13A evaluations are unaffected.
2. **Per-mode outcomes come from real, independently-reviewed runs.** A
   recommendation about whether compact context degrades outcomes must be backed
   by two runs that each independently passed (or failed) the same acceptance
   criteria — never synthesized from a single scorecard.
3. **Never recommend on thin evidence.** Below the sample threshold, or when
   savings are immaterial, the report is descriptive only. A recommendation is
   opt-in evidence, not a default.
4. **Additive and backward compatible.** `schema_version` stays `1`. `mode`,
   `experiment_id`, and `comparability` are optional-on-read; artifacts, run
   records, and evaluation records written before 3.10.0 read as
   `mode: 'compact'`, `experiment_id: null`, `comparability: null` and are simply
   excluded from experiment analysis (they still count in the overall/per-tier
   summary).
5. **No special boundary bypass.** A `baseline` artifact is a normal
   `CompiledContextArtifact` that flows through the Phase 11 boundary unchanged.
   It is never silently truncated and never granted an over-budget exemption.

## The experiment identity model (resolved during brainstorming)

An honest baseline-vs-compact comparison needs a **per-mode outcome**: did each
mode independently pass the same acceptance criteria? 13A derives an outcome from
*one* review scorecard plus *one* task journal per `task_id`. A single `task_id`
therefore cannot carry two mode outcomes, and there is no way to synthesize a
per-mode pass/fail from one scorecard without new agent instrumentation (which
13A principle #4 forbids).

**Chosen model:** an experiment is **two real task runs that share an
`experiment_id`**, one per mode. Each is a normal task (its own journal,
scorecard, primary artifact, and run records) evaluated by 13A's `--evaluate`.
Because baseline and compact are **distinct `task_id`s**, every 13A *storage*
invariant holds unchanged:

- Record storage stays `.ai/state/evaluations/<task_id>.json`.
- `evaluation_id` stays `eval-<task_id>`.
- The "exactly one primary artifact per `task_id`" gate stands (each `task_id`
  still has exactly one primary).

13B adds the optional record fields (`mode`, `experiment_id`, `comparability`),
one experiment-only provenance gate in `--evaluate` (§4), and the report-side
pairing + recommendation (§5). `experiment_id` links the pair explicitly — **no
filename or naming heuristics**, consistent with 13A's linking discipline.

**Rejected alternative:** one `task_id` run twice. It breaks the one-primary and
one-scorecard invariants and cannot yield a per-mode outcome.

## Design decisions

| Decision | Choice |
|----------|--------|
| Scope | 13B.1 experiment modes, 13B.2 sufficiency gate, 13B.3 advisory context-mode recommendation. Model-tier recommendations deferred. |
| Experiment identity | Two real evaluated tasks sharing an explicit `experiment_id`; one per `mode`. No single-task-id-run-twice. No naming heuristics. |
| Baseline definition | Same seed selection as compact, but every selected file emitted as one whole-file excerpt — no node extraction, no excerpt dedup. |
| Baseline budget | Budget-honest. If whole files exceed `--budget`, `--compile-context --mode baseline` errors and asks for a larger budget. No truncation, no boundary bypass. |
| Recommendation target | Context mode only (`prefer compact` vs `keep baseline`). Model-tier recommendations deferred to a later phase with their own per-tier and task-score sufficiency rules. |
| Sufficiency gate | `MIN_EXPERIMENT_PAIRS` complete baseline+compact pairs (default 5), overridable via `--min-samples <n>`. Applies to the recommendation, not the descriptive report. |
| Recommendation rule | `prefer compact` only when pairs ≥ threshold **and** pass-rate degradation ≤ `MAX_PASS_RATE_DROP_PCT` **and** (token saving ≥ `MIN_TOKEN_SAVING_PCT` **or** latency saving ≥ `MIN_LATENCY_SAVING_PCT`). |
| Storage | Unchanged from 13A. No new files, no key change. |
| Backward compatibility | Additive fields; legacy data normalizes to `mode: 'compact'`, `experiment_id: null`; excluded from experiment analysis but still counted in the overall/per-tier summary. |

## Threshold constants

All thresholds are named, documented constants (proposed in
`bin/lib/evaluation-report.ts`). `--min-samples` overrides the first; the rest
are fixed constants in 13B (no flags), documented in README and the migration
note:

| Constant | Proposed value | Meaning |
|----------|----------------|---------|
| `MIN_EXPERIMENT_PAIRS` | 5 | Minimum complete baseline+compact pairs before any advisory. |
| `MAX_PASS_RATE_DROP_PCT` | 5 | Max allowed (baseline − compact) pass-rate drop, in percentage points. |
| `MIN_TOKEN_SAVING_PCT` | 15 | Token saving (baseline − compact, as % of baseline) considered material. |
| `MIN_LATENCY_SAVING_PCT` | 15 | Latency saving considered material (alternative to token saving). |

## Components

### 1. Types (`bin/lib/types.ts`)

- `CompiledContextArtifact`: add `mode: 'baseline' | 'compact'` and
  `experiment_id: string | null`. Additive; `schema_version` stays `1`.
  - **Router structural validator** (`checkArtifactStructure`, exported from
    `router.ts` in 13A): accept `mode` when **absent** (normalized to
    `'compact'`) or exactly `'baseline'`/`'compact'`, rejecting any other string;
    accept `experiment_id` when **absent/null** or a non-empty string matching
    the experiment-id shape (see §2), rejecting present-but-empty/malformed.
  - **Backward-compatible normalization (required), mirroring 13A's `task_id`
    handling.** `computeArtifactEstimate` serializes the whole artifact, so
    adding `mode`/`experiment_id` to a pre-3.10.0 artifact would change its
    estimated-token count. `validateArtifact` must recompute the estimate against
    the **raw** parsed object first, then return a normalized artifact
    `{ ...raw, task_id: raw.task_id ?? null, artifact_role: raw.artifact_role ?? 'primary', mode: raw.mode ?? 'compact', experiment_id: raw.experiment_id ?? null }`.
    New (3.10.0+) artifacts include both fields at creation, so their declared
    estimate is already self-consistent.
- `RunRecord`: add `mode: 'baseline' | 'compact' | null`. Same pattern as
  `task_id` in 13A — `isValidRunRecordInput` accepts `mode` when absent, `null`,
  or a valid union value; `listRunRecords` normalizes each record to
  `{ ...raw, mode: raw.mode ?? 'compact' }` so consumers always see a resolved
  mode. Do not tighten the return into a `raw is RunRecord` predicate for
  un-normalized input.
- `EvaluationRecord`: add `mode: 'baseline' | 'compact'` and
  `experiment_id: string | null`.

All existing `RunRecord` and `CompiledContextArtifact` literals in providers,
`api-adapter.ts`, `context-compiler.ts`, `router.ts`, and tests must set the new
fields (`mode: 'compact'`, `experiment_id: null` for the no-experiment case).

### 2. Stamping `mode` and `experiment_id` (13B.1)

Experiment-id shape: reuse the task-id family convention `EXP-YYYYMMDD-<slug>`. A
shared validator `isValidExperimentId(id: string): boolean` (new small export
alongside `isValidTaskId`) rejects the template placeholder
(`EXP-YYYYMMDD-short-slug`, `EXP-...`) and empty strings.

- **`--compile-context --task <id> --mode baseline|compact --experiment <exp-id>`**
  (`context-compiler.ts`, `runCompileContext`):
  - `--mode`: default `compact` (today's behavior). `baseline` switches excerpt
    generation to whole-file mode (§3). An invalid value errors with exit 1.
  - `--experiment`: optional. When present, validate the shape (error + exit 1 on
    malformed) and set `artifact.experiment_id`; when absent, `null`.
  - Both fields are set on the artifact object **before** the internal estimate
    pass so the declared estimate stays self-consistent.
  - The `--expand-context` artifact copies the primary's `mode` and
    `experiment_id` (an expansion of a baseline run is still baseline).
- **`--mode` / `--experiment` value validation.** Both are added to the eager
  value-requiring flag list in `context.ts` (currently
  `['--profile','--emit','--adapter','--model','--task']`) so a bare
  `--compile-context --mode` (no value) fails fast with `--mode requires a value`
  instead of being silently treated as default.
- **`--route`** (`router.ts`, `runRoute` → run-record construction): copy
  `artifact.mode` into the `RunRecord.mode` (already validated at load), exactly
  as 13A copies `artifact.task_id`. No new route flag — the mode rides on the
  artifact.

Backward compatibility: artifacts/run records produced before 3.10.0 have no
`mode`/`experiment_id`; they load as `mode: 'compact'`, `experiment_id: null`.

### 3. Baseline excerpt generation (13B.1)

`--mode baseline` reuses the exact same **seed selection** (dependency-aware
file selection, Phase 9/10) but replaces the excerpt-extraction step:

- Each selected file becomes **one whole-file excerpt** carrying the full file
  contents, with its normal source-path provenance and a `reason` of
  `baseline whole-file` (or equivalent). No function/class/interface extraction,
  no caller analysis, no excerpt-level deduplication.
- Rule packing, assignment, tests, and diagnostics packing are unchanged —
  baseline differs only in how selected **source files** are rendered.
- **Budget is honest, never bypassed.** The whole-file payload is estimated the
  same way. If it exceeds the configured `--budget`, `--compile-context --mode
  baseline` **errors** (exit 1) with a message asking for a larger `--budget`,
  rather than truncating a file mid-node (which Phase 10 forbids) or emitting an
  over-budget artifact the Phase 11 boundary would reject at route time. A
  baseline control that does not fit its budget is a user decision to resolve by
  raising the budget, not a silent degradation.

Determinism: whole-file excerpts are ordered by the same selection order compact
uses, so a baseline artifact is reproducible.

### 4. `EvaluationRecord` fields and sourcing (13B.2)

`--evaluate --task <id>` is unchanged in flow (13A §4). It additionally:

- Reads `mode` and `experiment_id` from the matched **primary** artifact and
  writes them into the record. When the primary artifact is absent (a task
  evaluated with no artifact), `mode` defaults to `'compact'` and
  `experiment_id` to `null`.
- Builds the `comparability` block from the primary artifact
  (`objective`, `repository.fingerprint`, `selection`), the journal evidence
  rows (`acceptance_signature`), and the matched runs (`routing_signature`).
  `null` when there is no primary artifact.
- **Experiment provenance gate (new consistency rule, only when the primary
  artifact has a non-null `experiment_id`).** An experiment record is only
  written when its runs actually came from this mode's artifact — otherwise the
  record fails the gate (exit 1, nothing written), matching 13A's "never guess"
  stance:
  - at least one matched run exists (an experiment needs model cost/routing
    evidence; a zero-run experiment cannot be compared);
  - every matched run has `run.mode === artifact.mode`;
  - every matched run routed the **primary artifact**
    (`path.resolve(root, run.artifact) === path.resolve(root, primaryArtifactPath)`),
    so a stray run that shares only `task_id` cannot pollute the metrics.

  Ordinary (non-experiment, `experiment_id: null`) evaluations are unchanged —
  they still allow zero runs and do not apply this gate.

New `EvaluationRecord` fields:

```json
{
  "mode": "compact",
  "experiment_id": "EXP-20260727-router-refactor",
  "comparability": {
    "objective": "refactor router fallback",
    "repository_fingerprint": "sha256:…",
    "selection_signature": "1:5:bin/lib/router.ts,bin/lib/types.ts",
    "acceptance_signature": "npm run build\nnpm test",
    "routing_signature": "anthropic/claude-opus-4-8"
  }
}
```

- `mode`: `'baseline' | 'compact'`.
- `experiment_id`: `string | null`. `null` for an ordinary (non-experiment)
  evaluation. When non-null it MUST pass `isValidExperimentId` — the artifact
  structural validator and `isValidEvaluationRecord` both enforce the
  `EXP-YYYYMMDD-slug` shape, not merely non-empty.
- `comparability`: `EvaluationComparability | null`. The signature the pairing
  gate uses to prove two records differ **only** in context mode. `null` when the
  task had no primary artifact (such a record can never form a comparable pair).
  Fields:
  - `objective`: `artifact.objective`.
  - `repository_fingerprint`: `artifact.repository.fingerprint`.
  - `selection_signature`:
    `` `${max_depth}:${max_nodes}:${files.map(f=>f.path).sort().join(',')}` ``
    from `artifact.selection` — same seeds regardless of mode when the experiment
    is set up correctly (budget differs, selection does not).
  - `acceptance_signature`: the sorted unique **command** cells of the journal's
    "Commands And Validation" evidence rows, joined by `\n`. The table columns are
    `| Date | Command | Result |`, so the command is `cells[1]` (matching
    `review.ts` `isRealEvidenceRow`'s `[date, command, result]` destructuring).
    **Date (`cells[0]`) and Result (`cells[2]`) are excluded** — the date is
    incidental and the result must be free to differ between baseline and compact.
  - `routing_signature`: the sorted unique `` `${provider}/${model}` `` set of the
    matched run records, joined by `,`. This proves both modes used the **same
    model(s)**, catching two different models that both resolve to tier
    `unknown` — a case a bare `tier` equality check would miss.

`isValidEvaluationRecord` (the full structural read validator from 13A) is
extended: `mode` must be `'baseline'`/`'compact'` when present (absent normalizes
to `'compact'` for pre-3.10.0 records), and `experiment_id` must be `null` or a
non-empty string when present (absent normalizes to `null`). All other 13A
invariants — `evaluation_id === \`eval-${task_id}\``, canonical `generated_at`,
non-negative integer metrics, `evidence_count === pass + fail + skipped`,
filename `\`${task_id}.json\`` — are unchanged.

### 5. Experiment aggregation and recommendation (13B.2 + 13B.3)

New logic in `bin/lib/evaluation-report.ts`.

**Pairing.** Group records with a non-null `experiment_id` by that id. A
**complete pair** is an experiment id that has exactly one `mode: 'baseline'`
record and exactly one `mode: 'compact'` record. An experiment id with a missing
mode, a duplicated mode (two baselines), or more than two records is **incomplete
/ malformed** — it is reported in a "skipped experiments" line with the reason and
excluded from the aggregate (never crashes, never silently averaged).

**Comparability gate (noise control).** A complete pair is only a valid
context-mode experiment if it differs **only** in context mode. Before a pair is
counted it must additionally satisfy — else it is moved to skipped with a
specific reason and **does not count toward sufficiency**:

- Neither record has `metrics.context.expansion_rounds > 0`. In Phase 13B a
  baseline **expansion** artifact is only relabeled `mode: 'baseline'`;
  `compileContextExpansion` still emits compact node excerpts, so an expanded
  baseline is not truly whole-file. Rather than rework the expansion path,
  Phase 13B excludes any expanded pair from the advisory. (Making expansion
  mode-aware is deferred.)
- Both records have a non-null `comparability` (both had a primary artifact).
- The two `comparability` blocks are equal on `objective`,
  `repository_fingerprint`, `selection_signature`, `acceptance_signature`, and
  `routing_signature`. A mismatch means the runs differed in objective, revision,
  selected files, acceptance criteria, or **model** — differences that would be
  misattributed to context mode. `routing_signature` (provider/model) is used
  instead of a bare `tier` equality so two distinct models that both resolve to
  tier `unknown` are still treated as non-comparable. This is context-experiment
  noise control, **not** a model-tier recommendation.

**Operational consequence (documented in the README workflow).** Because the two
modes must share a `repository_fingerprint`, both must be compiled from the
**same starting revision**. Since running a task mutates source, the two modes
are run in **separate worktrees/clones of the same base commit**, then their two
evaluation records are gathered into one workspace for `--report`. 13B ships no
import command; the README documents the copy step and the requirement that the
two `task_id`s differ while objective/model/experiment id match.

**Per-pair comparison.** For each complete pair:
- `baseline.outcome` and `compact.outcome` (pass/partial/fail).
- Token delta: `baseline tokens − compact tokens` (input + output) and the
  percentage saving relative to baseline.
- Latency delta: `baseline latency_ms − compact latency_ms` and percentage.
- A pair is `outcome_preserved` when `compact.outcome` is at least as good as
  `baseline.outcome` (pass ≥ partial ≥ fail ordering).

**Aggregate over complete pairs.**
- `pairs`: count of complete pairs.
- `baseline_pass_rate`, `compact_pass_rate` (pass ÷ pairs, per mode).
- `pass_rate_drop_pct = baseline_pass_rate − compact_pass_rate` in points.
- `mean_token_saving_pct`, `mean_latency_saving_pct` (means of per-pair
  percentage savings; a pair with zero baseline tokens contributes `0` and is
  noted, not a divide-by-zero).

**Decide on raw values; round only at render.** The aggregate carries **unrounded**
pass rates, drop, and savings, and `recommend` compares those raw values against
the thresholds. Rounding happens only when a number is printed or serialized to
JSON. Otherwise a true drop just above `MAX_PASS_RATE_DROP_PCT` (e.g. `5.04`)
could round to `5.0` and be wrongly permitted at the boundary.

**Sufficiency gate (13B.2).** If `pairs < minSamples` (default
`MIN_EXPERIMENT_PAIRS`, overridable via `--min-samples <n>`), emit
`insufficient samples (<pairs>/<minSamples>) — recommendation withheld` and stop
before the recommendation. When withheld, the recommendation object's `verdict`
is **`null`** (not a real verdict) with `withheld: true`, so a JSON consumer
cannot mistake a withheld state for an actual recommendation. `--min-samples`
must be a positive integer; a bad value is a usage error (exit 1).

**Recommendation (13B.3).** Only when `pairs ≥ minSamples`:
- `prefer compact` when `pass_rate_drop_pct ≤ MAX_PASS_RATE_DROP_PCT` **and**
  (`mean_token_saving_pct ≥ MIN_TOKEN_SAVING_PCT` **or**
  `mean_latency_saving_pct ≥ MIN_LATENCY_SAVING_PCT`).
- `keep baseline — compact degrades outcomes` when
  `pass_rate_drop_pct > MAX_PASS_RATE_DROP_PCT`.
- `no material difference — either mode acceptable` when outcomes are within
  tolerance but savings are immaterial.
- Every recommendation line is prefixed `[advisory]` and states the evidence
  (`n` pairs, drop pts, mean saving %).

### 6. `--report` output (13B.3)

`runReport` gains an **Experiments** section, printed after the existing overall
and per-tier sections:

- **No experiments:** a single `formatStatus('skipped', 'no paired experiments
  recorded')` line (records without `experiment_id` are simply not experiments).
- **With experiments:** per-pair metric lines (experiment id, both outcomes,
  token/latency deltas), a skipped-experiments line if any are incomplete, the
  aggregate line (pairs, baseline vs compact pass rate, mean savings), then the
  sufficiency line and the `[advisory]` recommendation (or withheld notice).
- All lines use the existing `formatStatus('metric', …)` / `formatStatus('ok' |
  'skipped', …)` styles.

`--report --json` gains an `experiments` object (aggregate + per-pair array +
`skipped` list) and a `recommendation` object
(`{ verdict, withheld, min_samples, pairs, pass_rate_drop_pct,
mean_token_saving_pct, mean_latency_saving_pct }`), where `verdict` is
`'prefer_compact' | 'keep_baseline' | 'no_material_difference' | null` and is
`null` whenever `withheld` is `true`. The 13A `--json` shape is extended, not
replaced; existing consumers keep reading the fields they used.

The 13A overall and per-tier summaries are **unchanged** and still count every
record (experiment and non-experiment alike), so `--report` remains fully
backward compatible for repositories with no experiments.

### 7. CLI and flag wiring

- `bin/lib/context.ts`: add `--mode`, `--experiment`, and `--min-samples` to the
  eager value-requiring flag list.
- `--compile-context` reads `getArgValue('--mode')` (default `compact`),
  `getArgValue('--experiment')` — no new boolean flags.
- `--report` reads `getArgValue('--min-samples')` when present.
- Help text (`init.ts` `usage()`): document `--compile-context --mode
  baseline|compact --experiment <exp-id>` and `--report [--json]
  [--min-samples <n>]`.

### 8. Storage, gitignore, and upgrade

- **No storage change.** Records stay at `.ai/state/evaluations/<task_id>.json`,
  already gitignored and preserved on upgrade in 13A. No new directories, no new
  gitignore or preservation branches.

### 9. Documentation and version

Bump `3.9.0 → 3.10.0` in every version location:

- `package.json` `version`.
- `package-lock.json` — both the top-level `version` and the root package entry
  under `packages[""]`.
- `CHANGELOG.md`: 3.10.0 entry — experiment modes (`--compile-context --mode
  baseline|compact --experiment`), `mode`/`experiment_id` on artifacts, run
  records, and evaluation records, the `--report` Experiments section, the
  sample-sufficiency gate (`--min-samples`), and the advisory context-mode
  recommendation.
- `ROADMAP.md`: mark Phase 13B shipped in 3.10.0; note the still-deferred items
  (model-tier recommendations, real `context_escapes`, `parent_artifact`
  linkage, `--outcome` override).
- `README.md`: add an Experiments subsection to the Evaluation section
  documenting the workflow (`--compile-context --mode baseline --experiment E` →
  `--route` → `--evaluate`; repeat with `--mode compact`; then `--report`), the
  new record fields, the threshold constants, and how to read the advisory.
- `docs/migrations/3.10.0.md`: additive change; run `forgeai-init --upgrade`. No
  breaking schema or config change. Pre-3.10.0 artifacts/run/evaluation records
  read as `mode: 'compact'`, `experiment_id: null` and are excluded from
  experiment analysis (no retro-pairing of historical runs).

## Testing strategy

- **Schema (13B.1):**
  - `isValidExperimentId`: accepts `EXP-20260727-slug`; rejects empty, the
    template placeholder, and malformed shapes.
  - Artifact validator accepts absent/valid `mode` and absent/null/valid
    `experiment_id`; rejects an unknown `mode` string and a present-but-empty
    `experiment_id`.
  - **Legacy artifact normalization:** a 3.9.0 artifact with no
    `mode`/`experiment_id` validates OK (estimate recomputed on the raw shape)
    and normalizes to `mode: 'compact'`, `experiment_id: null`. Cover both
    `--route` and `--expand-context` reading such an artifact.
  - `isValidRunRecordInput` accepts absent/null/valid `mode`; `listRunRecords`
    normalizes a pre-3.10.0 record (no field) to `mode: 'compact'`.
  - `--compile-context --mode baseline` stamps `mode: 'baseline'`, emits
    whole-file excerpts (assert an excerpt equals a full source file, no node
    extraction), and copies mode/experiment to the `--expand-context` artifact;
    `--mode` with an invalid value exits 1; a bare `--mode`/`--experiment` (no
    value) exits 1 with `requires a value`; `--route` copies the artifact's
    `mode` into the run record.
  - **Baseline over budget:** whole files exceeding `--budget` exit 1 with a
    raise-budget message and write no artifact.
- **Evaluation carry-through (13B.2):** `--evaluate` writes `mode` and
  `experiment_id` from the primary artifact; a task with no artifact records
  `mode: 'compact'`, `experiment_id: null`; `isValidEvaluationRecord` accepts the
  new fields and still enforces all 13A invariants; a legacy record with no mode
  reads as `compact`.
- **Aggregation + pairing (13B.2):**
  - A complete pair (one baseline + one compact record sharing an
    `experiment_id`, comparable) aggregates correctly: pass rates, token/latency
    saving %.
  - An incomplete experiment (missing mode / duplicated mode / three records) is
    listed as skipped and excluded — not crashing, not averaged.
  - **Comparability gate:** a complete pair whose two records differ on
    `objective`, `repository_fingerprint`, `selection_signature`,
    `acceptance_signature`, or `routing_signature` is moved to skipped and does
    **not** count toward sufficiency; a pair with `expansion_rounds > 0` on either
    side is likewise excluded; a pair where either record has
    `comparability: null` is excluded. Two records with the **same** commands but
    a different Date column produce the **same** `acceptance_signature` (pair
    kept); two records with **different** commands but the same date produce
    **different** signatures (pair excluded).
  - **Experiment provenance gate:** `--evaluate` on an experiment task
    (`experiment_id` set) errors and writes nothing when there are no matched
    runs, when a run's `mode` differs from the artifact's, or when a run routed a
    different artifact than the primary; an ordinary (non-experiment) evaluation
    with zero runs still succeeds.
  - **Raw-decision boundary:** a pair set whose true drop is `5.04` (rounds to
    `5.0`) still yields `keep_baseline`, proving the tolerance is applied to the
    raw value, not the rounded one.
  - A pair with zero baseline tokens/latency contributes `0` saving without a
    divide-by-zero.
  - Non-experiment (13A) records are excluded from pairing but still counted in
    the overall/per-tier summary.
- **Sufficiency gate (13B.2):** below `MIN_EXPERIMENT_PAIRS` the recommendation
  is withheld with `insufficient samples (n/N)` and `verdict: null` in JSON;
  `--min-samples` overrides the threshold; a non-positive `--min-samples` is a
  usage error (exit 1).
- **Recommendation (13B.3):** with ≥ threshold pairs — `prefer compact` when
  drop ≤ tolerance and savings material, including the case where **token saving
  is immaterial but latency saving is material**; `prefer compact` at the exact
  boundary (drop == `MAX_PASS_RATE_DROP_PCT`); `keep baseline` when drop just
  exceeds tolerance; `no material difference` when within tolerance but neither
  token nor latency saving is material. Each asserts the `[advisory]` prefix and
  the evidence numbers.
- **`--report` (13B.3):** CLI `--report` prints the Experiments section
  (per-pair lines, aggregate, sufficiency, advisory); `--report --json` emits a
  parseable object with `experiments` + `recommendation`; malformed record files
  are still skipped, not fatal; the 13A overall/per-tier output is unchanged when
  no experiments exist.
- **Upgrade/backward compat:** a 3.9.0 evaluations directory reports cleanly
  under 3.10.0 with no experiments; records survive a simulated `--upgrade`
  (unchanged from 13A).

## Out of scope (13B)

- Model-tier routing recommendations (separate later phase with per-tier and
  task-score sufficiency rules).
- Real `context_escapes` measurement (persisting rejected `need_context`
  requests); remains `null`.
- `parent_artifact` linkage from expansion → primary artifacts.
- A `--outcome` manual override / CI import escape hatch.
- Any change to record storage layout, keys, or `evaluation_id`.
- Any web dashboard.

## Process notes

- The user commits every change themselves; do not run `git commit`.
- No CI work for this repository.
