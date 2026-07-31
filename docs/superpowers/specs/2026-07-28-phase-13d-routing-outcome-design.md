# Phase 13D — Model-tier routing recommendations and `--outcome` override (design)

Date: 2026-07-28
Status: **implemented** — revised 2026-07-31 (twenty review rounds folded in; shipped in 3.10.0)
Scope: the last two deferred Phase 13 items. Completing them closes Phase 13.

## Review findings

**Round 20 — post-implementation review (2026-07-31, applied to code):**

- **[Medium] The R19 override guard checked presence, not dispatch.** It only tested
  whether `--evaluate` was in argv, but the dispatcher picks the first matching command
  by precedence, so `--version --evaluate --outcome pass --reason …` ran `--version`
  and dropped the override. Fix: the guard moved to the dispatcher (`forgeai-init.ts`),
  which requires `--evaluate` to be the **selected** command — set, and none of the
  commands dispatched before it. Regression test covers `--version`/`--help`/`--check`
  alongside `--evaluate`.

**Round 19 — post-implementation review (2026-07-31, applied to code):**

- **[Medium] Override flags were silently ignored without `--evaluate`.** The flags
  are format-validated globally, but the combination/effect only ran inside
  `runEvaluate`, so `forgeai-init --dry-run --outcome pass --reason …` succeeded and
  dropped the decision. Fix (refined in R20): fail usage unless `--evaluate` is the
  selected command (tested for the default command and `--report`).
- **[Low] Validator and CLI disagreed on control-only provenance.** The CLI rejected a
  control-only `reason`/`--by` (line-breakers stripped) but the record validator used
  bare `.trim()`, so a tampered record with `reason: ""` read back valid. Fix: a
  shared `hasPrintableContent` helper used by both the writer and the reader.
- **[Low] `--min-samples` help understated its effect.** It said the flag overrides
  only the experiment pair threshold; it also overrides the routing tier sample gate.
  Help text (`init.ts`) and README updated.

**Eighteen prior review rounds (2026-07-30).** Round 7 is a **simplification that removes** the append-only
history feature accreted in rounds 2–6, so many earlier findings are superseded
(noted inline). Round 10 (pre-implementation) reverses one R7 consequence — a
plain re-evaluate now *preserves* a human override instead of silently reverting
it. Round 11 hardens that preservation (fail closed on a corrupt prior record and
on verdict drift) and makes the routing signature always-derived. Round 12 closes
two blockers in that R11 work (task-id mismatch, fixture typecheck) and tightens the
JSON contract. Round 13 replaces the fragile string signature with a **structured**
one and stops `--report` silently dropping corrupt records. Round 14 fixes the
mechanics of that R13 work (a stray NUL, an incomplete wire type, premature backup,
an invalid-only blind spot). Round 15 makes the report robust to bad timestamps and
filesystem errors. Round 16 closes a writer/reader validation asymmetry and an
`existsSync` fail-closed gap. Rounds 17–18 correct plan/test/scope issues. All live
decisions are folded into the sections below.

**Round 18 — Task-4 import + commit scope (2026-07-30, plan-only):**

- **[Medium] Task 4 didn't update the import or stage `evaluation-record.ts`.** Task 4
  adds `listEvaluationRecordsDetailed` and switches `runReport`'s caller, but hadn't said
  to change `evaluation-report.ts:4`'s `import { listEvaluationRecords }` to
  `listEvaluationRecordsDetailed` (it has no other caller in that file, so it is fully
  replaced), and Step 6 staged only `evaluation-report.ts` + tests, omitting
  `evaluation-record.ts` (which now holds the listing). Both are now specified.

*(Plan/scope correction; the shipped behavior in the sections below is unchanged.)*

**Round 17 — test correctness + Task-1 scope (2026-07-30, plan-only):**

- **[Medium] The R16 whitespace-model test asserted the wrong tier.** With the
  whitespace-model run filtered, the evaluation has no valid runs, so
  `resolveTierForRuns([])` returns `unknown` (and `setupHumanDecisionRepo` has no routing
  config) — the assertion `byTier.standard.count === 1` is corrected to `byTier.unknown`.
- **[Medium] Task 1 lacked a run-record test and commit scope.** Task 1 modifies
  `run-record.ts` and two fixture files but its Step 5 ran only `evaluation-record.test.ts`
  and Step 6 staged three files, so the run-record change was untested there and those
  files would leak into a later task's commit. Task 1 now adds `test/run-record.test.ts`
  (empty/whitespace `model` filtered), runs it in Step 5, and stages all touched files.

*(These are plan/test corrections; the shipped behavior in the sections below is
unchanged from Round 16.)*

**Round 16 — writer/reader symmetry + fail-closed listing (2026-07-30):**

- **[High] The writer could emit a record the reader rejects.** The evaluation
  validator requires each `routing_signatures[].model` to be non-empty, but the
  run-record validator (`run-record.ts`) checked only that `model` is a *string*, so a
  run with `model: ""`/`"   "` was valid and the builder copied it into a signature —
  producing an evaluation record that reads back `invalid_schema` and silently withholds
  routing. Fixed at three layers so the invariant holds: the **run-record validator**
  requires a trimmed-non-empty `model` (`provider` is already enum-checked), the
  **evaluation validator** trims `provider`/`model`, and the **builder** skips a run with
  an empty signature. A test writes a whitespace-model run and asserts the resulting
  record round-trips valid (empty `routing_signatures`, not `invalid_schema`).
- **[Medium] `fs.existsSync` defeated the fail-closed listing.** `listEvaluationRecordsDetailed`
  pre-checked `if (!fs.existsSync(dir)) return empty`, but `existsSync` returns false for
  an *inaccessible* directory (e.g. a parent without traverse permission) as well as a
  missing one — so an unreadable evaluations dir looked empty and routing was **not**
  withheld, contradicting Round 15. Fixed: drop `existsSync` and classify straight from
  `readdirSync` — `ENOENT` is truly absent (empty result); any other error is a
  `read_error` entry (reported with the **relative** path, not the absolute repo path) so
  routing withholds.

**Round 15 — report robustness (2026-07-30):**

- **[High] The validator could throw instead of returning false.** The `generated_at`
  check was `new Date(r.generated_at).toISOString() !== r.generated_at`; a JSON that
  parses but has `"generated_at": "invalid"` makes `toISOString()` throw `RangeError`.
  R13's `listEvaluationRecordsDetailed`/`readEvaluationRecordStatus` call the validator
  **outside** the JSON-parse `try`, so that throw would crash `--report` instead of
  listing the record as `invalid_schema`. Fix: make the validator **total** — guard with
  `Number.isNaN(Date.parse(generatedAt))` before `toISOString` (the pattern already used
  for `decided_at`). Tests: the validator reads back invalid (not throw), and
  `--report --json` reports `invalid_schema` without crashing.
- **[Medium] The invalid-only JSON branch was unreachable and off-schema.** `runReport`
  emits the `--json` payload and returns *before* the terminal zero-record branch, so
  the R14 code that re-emitted a reduced JSON payload inside that terminal branch could
  never run — and it omitted `experiments`/`recommendation`. Fix: the single general
  Step-3 payload already handles 0 valid + N invalid (full schema, routing withheld);
  the terminal branch is terminal-only. The invalid-only test now also asserts
  `experiments`/`recommendation` are present.
- **[Medium] The detailed listing wasn't fail-closed on filesystem errors.**
  `readdirSync` was uncaught (a permission error would crash the report); a
  `readFileSync` `EACCES` was mislabelled `invalid_json`; and results weren't sorted, so
  `invalid_records`/`byTier` order was filesystem-dependent. Fix: catch `readdirSync`
  (→ a `read_error` entry, so routing withholds rather than treating an unreadable
  directory as empty); separate the read from the parse (new `read_error` reason vs
  `invalid_json`); and sort names, records (newest `generated_at` first), and `invalid`
  (by file) for deterministic output.

**Round 14 — R13 mechanics (2026-07-30):**

- **[Blocker] A real NUL byte in the dedup key.** The structured-signature dedup used
  a literal `\0` separator (`` `${provider}\0${model}` ``), which turned the plan
  markdown into a file tools treat as binary. Replaced with a delimiter-free key,
  `JSON.stringify([provider, model])`.
- **[High] The wire type under-declared the legacy schema.** R13's
  `EvaluationRecordWire` made only `routing_signatures` optional, but the validator
  also accepts a 3.9.0 record missing `mode`/`experiment_id`/`comparability` (each
  normalized on read). The wire type now marks **all four** normalized fields optional,
  so it honestly describes what the validator accepts.
- **[High] `--force` moved the corrupt file too early.** The backup rename ran before
  the build, so if the build then failed (bad journal/scorecard) the corrupt file was
  gone from the canonical path — the report could no longer flag it and routing would
  stop failing closed. Now the backup happens **only after a successful build, right
  before the atomic write**, and uses `copyFileSync(..., COPYFILE_EXCL)` (not rename)
  so the canonical path is never briefly missing and an existing backup can't be
  clobbered. A new test covers corrupt + `--force` + build failure.
- **[Medium] An invalid-only directory printed "no evaluation records".** The
  zero-valid-record early return fired before the invalid warning, so a directory of
  only corrupt files looked empty — no warning, no "routing withheld". The early return
  now requires `records.length === 0 && invalid.length === 0`; the invalid-only case
  surfaces the files, the warning, and a withheld routing. A new test covers 0 valid +
  1 invalid.

**Round 13 — structured signature + corrupt-record visibility (2026-07-30):**

- **[Blocker] The `provider/model` string signature can't represent real model IDs.**
  R11/R12 derived `` `${provider}/${model}` `` and joined multiple with commas, then
  validated `/^[^,/]+\/[^,/]+(,…)*$/`. But while `provider` is charset-restricted
  (`[A-Za-z0-9_-]+`, `model-routing.ts`), **`--model` is not** — a model like
  `meta-llama/llama-3.1` (contains `/`) or one with a comma is accepted, so the writer
  produces a value the reader then rejects as corrupt. Fix: store a **structured**
  signature — `routing_signatures: RoutingSignature[]` where
  `RoutingSignature = { provider: string; model: string }`, sorted deterministically
  (provider then model). No string parsing, no delimiter collision. (The separate
  `comparability.routing_signature` string is unchanged — it is only ever compared for
  equality, never parsed.)
- **[Medium] The validator type predicate lied about legacy records.**
  `isValidEvaluationRecord(raw): raw is EvaluationRecord` accepts a 3.9.0 record that
  lacks the new field, yet the predicate asserts the field is present. Fix: the
  validator narrows to an **`EvaluationRecordWire`** (`Omit<EvaluationRecord,
  'routing_signatures'> & { routing_signatures?: RoutingSignature[] }`); a separate
  normalize step (on read) fills `routing_signatures: wire.routing_signatures ?? []`
  to produce the full `EvaluationRecord`. The plan's earlier "not a type guard" note
  was wrong and is corrected.
- **[Medium] `--report` silently dropped corrupt records.** `listEvaluationRecords`
  skips malformed/invalid files without a trace, so a manual decision could vanish and
  sample counts shrink unseen. Fix: a detailed listing returns the valid records **and**
  an `invalid_records: [{ file, reason_code }]` list; `--report` prints a terminal
  warning and adds `invalid_records` to `--json`, and **routing is withheld**
  (`reason_code: 'invalid_records_present'`) whenever any invalid record exists — a
  corrupt record can't be attributed to a tier, so its effect on the pick can't be
  ruled out (chosen: fail closed).
- **[Medium] `--force` destroyed unrecoverable evidence.** Overwriting a corrupt
  record with `--force` discarded a file that might still hold a recoverable manual
  decision. Fix: before the force-overwrite, rename the bad file to
  `` `${taskId}.json.corrupt-<timestamp>` `` so the evidence is preserved, then write
  the new record.
- **[Low] Per-tier exclusion had no stable code.** Alongside the human
  `excluded_reason`, each tier now carries `excluded_reason_code:
  'missing_signature' | 'mixed_signatures' | 'insufficient_samples' | null`.

**Round 12 — closing R11 gaps (2026-07-30):**

- **[Blocker] `readEvaluationRecordStatus` didn't check the record's `task_id`.** It
  read `<taskId>.json` and ran only the schema validator, so a valid record whose
  internal `task_id` was `TASK-B` sitting in `TASK-A.json` read back `valid` — and a
  plain `--evaluate TASK-A` could preserve TASK-B's decision. Fix: after the schema
  check, require `record.task_id === taskId` (else `invalid`). The existing validator
  already ties `evaluation_id === eval-${task_id}` (`isValidEvaluationRecord`), so this
  one check also guarantees the `evaluation_id` matches the requested task.
- **[Blocker] The required `routing_signature` field broke typed fixtures.** Adding a
  required `EvaluationRecord.routing_signature` fails `npm run typecheck` for every
  typed fixture that constructs the type — at least `makeEval()`
  (`test/evaluation-record.test.ts`), `rec()` (`test/evaluation-report.test.ts`), and
  `rec()` (`test/experiment-aggregation.test.ts`). Task 1 now updates **all** typed
  fixtures (a real `provider/model` signature, or `null` for a legacy/no-run fixture).
- **[Medium] A mixed-signature tier is excluded until stale records are cleared.** By
  design (chosen): keep the exclude-on-mixed rule, but surface each tier's
  `routing_signatures` in `--json` (already present) and **document recovery**
  (re-evaluate or delete records from the retired model). Current-cohort comparison
  (reading the live routing config at report time to keep only records matching a
  tier's present mapping) is noted as a future refinement, not built — the output is
  advisory, so a withheld recommendation is the safe failure.
- **[Low] The withheld `reason` was a free-text sentence.** For automation, the
  `routing` JSON now also carries a stable **`reason_code`** (`insufficient_eligible_tiers`
  when withheld, else `null`) and `required_tiers` (2); `reason` stays the
  human-readable message.
- **[Low] `routing_signature` accepted any string.** The validator now requires a
  **canonical** value when non-null: one or more comma-separated `provider/model`
  pairs, each non-empty, no empty segments (rejects `""` and `"a,,b"`).

**Round 11 — hardening the R10 preservation + routing signature (2026-07-30):**

- **[Blocker] A corrupt prior record was silently overwritten.** R10 read the prior
  via `readEvaluationRecord`, which returns `null` for *missing or corrupt* alike and
  treated both as "nothing to preserve" — so a tampered/corrupt record holding a
  human decision would be silently clobbered (contradicting the plan's own
  fail-closed note). Fix: a status-aware `readEvaluationRecordStatus` →
  `{missing}` / `{valid,record}` / `{invalid,reason}`. Any `--evaluate` (plain,
  override, or `--clear-outcome`) that would overwrite an **invalid** record exits 1
  and leaves the file untouched, unless `--force` is given (the existing global flag).
- **[High] Model-drift protection was fail-open.** R10 read the signature from
  `comparability.routing_signature`, which is `null` when there is no context
  artifact — yet the tier is still resolved from run records (exactly the manual-
  override E2E case). A null-signature tier slipped through as eligible. Fix: add a
  top-level **`routing_signature: string | null`** to `EvaluationRecord`, **always
  derived from the record's runs** (`provider/model`), and gate on it: exactly one
  distinct signature → eligible; **zero → excluded (`missing routing signature`)**;
  more than one → excluded (`mixed routing signatures`). No caveat-only pass-through.
- **[High] Preserved override ignored a changed verdict.** R10 preserved a manual
  override verbatim even after the review changed to a *clear* verdict, so a stale
  `pass` could outlive a review that now says `request changes`. Fix (product
  decision): a plain re-evaluate preserves **only while the verdict is still
  `needs human decision`**; if it changed to a clear verdict the build fails (exit 1)
  and asks for `--clear-outcome` (accept the derived outcome) or `--outcome` (record a
  new decision). No record ever pairs fresh validation with a stale verdict snapshot.
- **[Medium] `--min-samples=5` (equals form) didn't override the routing gate.** The
  routing default was chosen with `args.has('--min-samples')`, which only matches the
  *spaced* token; `--min-samples=5` was parsed for its value but left routing on the
  default 20. Fix: detect the flag with `getArgValue('--min-samples') !== null` (reads
  both forms); add an equals-form CLI test.
- **[Medium] `--clear-outcome=<value>` was ignored, duplicates undetected.**
  `args.has('--clear-outcome')` matches only a bare token, so `--clear-outcome=true`
  looked absent (silently preserving the override) and a duplicate went unnoticed. Fix:
  a boolean-flag validator that accepts exactly one bare `--clear-outcome` and rejects
  a `=value` form or a duplicate (exit 1).
- **[Medium] Stale-write race re-introduced by preservation.** A plain re-evaluate now
  reads the old override and could re-write it over a concurrent `--clear-outcome`,
  undoing an explicit clear. 13D does **not** add a per-task lock (R7); instead the
  help text and this design state plainly that **concurrent `--evaluate` on the same
  task is unsupported** (last-writer-wins, and preservation can resurrect a just-cleared
  override).

**Round 10 — pre-implementation review (2026-07-30):**

- **[High] Manual override silently lost on a plain re-evaluate.** Under R7's keyed
  upsert, `--evaluate` with no override re-derived the outcome, reverting a prior
  human `manual_override` to `partial` and erasing its provenance. Fix: a plain
  re-evaluate now **preserves** an existing `manual_override` (refreshing only the
  derived metrics/validation/runs/context); removing it requires an explicit
  **`--clear-outcome`** flag. `--clear-outcome` with `--outcome` is a usage error.
  The preserved override keeps its original `decided_by`/`decided_at`/`reason` — the
  decision is *not* restamped. This partially supersedes R7: re-evaluate is still a
  keyed upsert, but the human decision is carried forward, not dropped.
- **[High] Plan code samples missing imports.** `runEvaluate`/`buildEvaluationRecord`
  used `execFileSync` and `EvaluationOutcomeSource` without importing them; copying
  the plan verbatim fails typecheck. Task 2 now updates `evaluation-record.ts`
  imports (`node:child_process` → `execFileSync`; `EvaluationOutcomeSource` from
  `./types.js`).
- **[High] Routing blended non-equivalent model cohorts under one tier name.**
  Aggregation grouped strictly by `tier`, so a tier remapped from model A→B mixed
  both cohorts and could recommend a tier whose current model was never measured.
  Fix: reuse the existing `comparability.routing_signature` (`provider/model` set) —
  a tier carrying **more than one distinct signature** is excluded from routing
  candidates with a per-tier reason. Records with null `comparability` (no context
  artifact) are not signature-checked; that limitation is stated in the caveat.
- **[Medium] "cheapest" mislabelled a token metric.** The pick minimizes mean
  tokens/eval, which is not cost when providers price input/output/cache
  differently. Reworded to **lowest-token** in the terminal advisory, the JSON
  caveat, CHANGELOG, and docs. A pricing-aware `mean_cost_per_eval` is noted as a
  future refinement, not built here.
- **[Medium] 5-sample routing gate too weak for a 5-pt tolerance.** With 5 evals a
  tier's pass rate moves in 20-pt steps, so a 5-pt tolerance is almost degenerate
  and one sample swings the result. Split **`MIN_TIER_SAMPLES` (default 20)** from
  `MIN_EXPERIMENT_PAIRS` (5); `--min-samples`, when supplied, still overrides both.
  The withheld `routing` JSON now carries a machine-readable `reason` and an
  `eligible_tiers` count.
- **[Low] `$USER`/`$USERNAME` fallback did not truly fall back.**
  `(process.env.USER ?? process.env.USERNAME ?? '').trim()` yields `unknown` when
  `USER` is whitespace even if `USERNAME` is set, because `??` only skips
  `null`/`undefined`. Fixed: trim and test each candidate in turn.
- **[Low] Release date.** The CHANGELOG/migration used a hardcoded `2026-07-29`; use
  the actual **ship date** (`<ship-date>` placeholder until release). Version stays
  **3.10.0** — the registry still publishes 3.9.0.

**Round 9 — sanitizer completeness:**

- **[Medium] Sanitizer missed Unicode line separators.** The render regex stripped
  only C0/C1 controls, so U+2028/U+2029 could still break the terminal line. Added
  `\u2028\u2029` to the shared `LINE_BREAKERS` regex (used by the success line), with
  a test.
- **[Low] Control-only value rendered blank.** A `--reason`/`--by` of only control
  chars (e.g. `"\x01"`) passed the shared non-empty check but sanitized to `""`,
  showing blank provenance. Now rejected at the CLI: `--reason`/`--by` must contain
  at least one printable character (validated on the *displayable* form, so no
  record with blank provenance is ever written).
- **[Low] Round-count metadata.** The header said "six review rounds" while the log
  had eight; corrected (and now nine).

**Round 8 — wording + hardening:**

- **[Medium] Help text overclaimed.** It said "provenance and prior overrides are
  preserved", contradicting R7. Now: "provenance for the current decision is
  recorded; re-evaluating replaces the task's record."
- **[Low] "Idempotent" was imprecise.** Replacing pass/first with fail/second is a
  keyed *upsert*, not idempotence. Reworded: "re-evaluation replaces the task-keyed
  record; a same-input re-run is idempotent."
- **[Low] Log-line injection via `reason`/`decided_by`.** The validator only checks
  non-empty, so a `\n`/control char in `--reason`/`--by` could spoof extra terminal
  lines. The success line now collapses C0/C1 control chars to spaces **for render
  only**; the JSON record keeps the raw value (audit fidelity preserved). (Chosen
  over rejecting control chars, so an unusual-but-legitimate reason still records.)

**Round 7 — simplification (drop the audit history):**

- **[Blocker] Optimistic stat-check is not atomic.** The R6-#1 check-then-rename is
  a TOCTOU race: two writers can both pass the guard check before either renames,
  so it cannot deliver "cannot silently drop a decision" (the design even admitted
  the window was open while the plan/banner claimed prevention). Rather than adopt a
  per-task lock or event-file model, **the append-only `decision_history` is dropped
  entirely.** `--evaluate` is a keyed upsert (by `task_id`) — re-running replaces
  the record — so there is no cross-run decision to lose, and no guarantee to make.
  This **supersedes R2-#1, R2-#2, R3-#1, R4-#1, R4-#2, R4-#3, R5-#1, R5-#2, R6-#1**
  and the concurrency findings R7-#1/#2/#4; the R7-#3 `statSync` fix is moot (its
  reader is removed). Kept: `decided_by`/`decided_at` provenance (R1-#3), `--by`
  scope (R2-#3), canonical `decided_at` (R2-#4), env-trim (R3-#3), lockfile bump
  (R3-#2), Task 0 (R6-#2), status (R6-#3), and all routing findings.

**Round 6:**

- **[High] Concurrent `--evaluate` could lose a manual decision.** The flow is
  read-prior → build-history → atomic overwrite; the writer's temp-file+rename only
  guards against a *partial* write. Two processes reading the same history `H` both
  overwrite, and the later writer drops the earlier decision — breaking "never
  silently lost". Chosen fix (**optimistic concurrency**): capture a stat guard
  (`mtimeMs`+`size`) at read time and re-check it immediately before the rename;
  abort (exit 1, no write) if the file changed. A per-task lock would close the
  window entirely but is heavier than warranted; the residual TOCTOU window is
  documented.
- **[Medium] Planning docs were untracked with no commit step.** Added **Task 0**
  to commit the spec + plan before implementation.
- **[Low] Design status.** Raised from "approved for planning" to "approved for
  implementation".

**Round 5 (correctness of the round-4 fixes):**

- **[Blocker] Happy-path fixture missing history.** The `manual_override`
  round-trip fixture had no `decision_history`, so under the R3-#1/R4-#2 invariant
  the "valid" assertion would fail even against a correct implementation. Fixed:
  one shared `override` object used as both `outcome_source` and the sole history
  entry; tamper cases now patch source **and** the last history entry together.
- **[High] Timestamp-ordering check was self-defeating.** R4-#3 required
  `decided_at` to be non-decreasing, but the build path stamps each new decision
  with `input.now`; a prior record written on a fast-clock machine could make the
  next decision's timestamp smaller, so the write path would emit a record that
  fails its own validator on the next read. **Reverted** — append order is the
  array position; wall-clock need not be monotonic. (If logical ordering is ever
  needed, add an explicit sequence index, not a clock dependency.)
- **[Low] Stale descriptions.** Removed the "else legacy seed" note from the data
  flow, corrected the build prose to use only `decision_history`, and renamed the
  mis-titled "legacy review_scorecard" test (it exercises a manual override).

**Round 4 (correctness of the round-3 fixes):**

- **[High] Legacy-seed branch unreachable.** The strict invariant (R3-#1) makes
  every valid `manual_override` record carry history, so the build path's
  fallback that seeded history from a prior `outcome_source` can never run.
  Contract chosen: manual override and `decision_history` ship together in 3.10.0,
  so **no legacy-manual support** — the fallback branch is removed and the
  validator stays strict.
- **[Medium] Empty `decision_history` accepted.** The non-empty check only fired
  for a `manual_override` source, so a `review_scorecard` record with
  `decision_history: []` validated — contradicting "omit when never overridden".
  Now any *present* `decision_history` must be non-empty.
- **[Medium] History order unchecked.** ~~The validator requires `decided_at` to
  be non-decreasing across entries.~~ **Superseded by R5-#2** — this was reverted;
  append order is the array position, not the clock.
- **[Low] Plan metadata.** The plan banner still said "two review rounds"; fixed.

**Round 3 (correctness of the round-2 fixes):**

- **[High] Validator did not enforce the `outcome_source`↔`decision_history`
  invariant.** Checking each history entry independently let a record where the
  current override is *not* the last history element read back valid, so the next
  `--evaluate` (history-authoritative) would drop it. Fixed: require the last
  history element to equal `outcome_source` when the source is a `manual_override`.
- **[Medium] Version bump missed `package-lock.json`.** The lockfile pins the
  version at both the top level and the root package; Task 5 now updates it (via
  `npm install --package-lock-only`) and stages it.
- **[Low] `decided_by` env fallback not normalized.** A whitespace-only
  `$USER`/`$USERNAME` would produce a record the validator then rejects; trim the
  env value before use, falling back to `unknown`.

**Round 2 (correctness of the round-1 fixes):**

- **[High] `decision_history` double-count.** Carrying forward *both*
  `prior.decision_history` and `prior.outcome_source` re-adds the prior override
  (history grows 1→3 on the second override). Fixed: prefer the existing
  `decision_history` (already authoritative), seed from `outcome_source` only for
  a legacy record. *(Superseded by R7 — history removed.)*
- **[High] Corrupt prior record silently overwritten.** `readEvaluationRecord`
  returns `null` for both missing and corrupt, so a re-evaluate would clobber a
  tampered record's audit history. Fixed with a status-aware read that fails
  closed on `invalid`. *(Superseded by R7 — no history to protect; overwrite is
  by design.)*
- **[Medium] `--by` without an override silently ignored.** Now a usage error.
- **[Low] `decided_at` accepted non-canonical dates.** Validator now requires
  canonical ISO (`new Date(v).toISOString() === v`), matching `generated_at`.

**Round 1:**

1. **[Blocker] No 13D code yet.** The plan and this spec are the only artifacts;
   the implementation checklist is entirely unchecked. `--outcome`/`--reason` are
   not registered in `bin/lib/context.ts`, `EvaluationRecord.outcome_source` is
   still the single `review_scorecard` shape (`bin/lib/types.ts:343`),
   `buildEvaluationRecord` always derives outcome from the verdict, `--report`
   has no routing, and `ROADMAP.md` still lists both items as deferred. Status is
   corrected from "complete" to **not started**; the plan is the source of truth
   for the work remaining.
2. **[High] Release assumption is wrong.** This design assumed 3.9.0 was
   "unreleased" so 13D could fold into it. **3.9.0 is published**
   (`forgeai-agentic-init@3.9.0`, npm `dist-tags.latest = 3.9.0`, published
   2026-07-28; CHANGELOG dated; `package.json` at 3.9.0). 13D therefore ships as a
   **new minor, 3.10.0** (additive, `schema_version` stays 1). See the revised
   Release section.
3. **[Medium] Provenance was thin.** The original `manual_override` variant stored
   only verdict/outcome/reason — no *who* or *when*. Resolution: the variant gains
   `decided_by` and `decided_at`. See §1. *(The append-only `decision_history`
   originally proposed here was dropped in R7 — re-`--evaluate` overwrites by
   design.)*
4. **[Medium] Routing may compare non-equivalent workloads.** Gating only on
   per-tier evaluation count says nothing about task difficulty; if premium draws
   hard tasks and standard draws easy ones, pass-rate/cost can mislead.
   Resolution: the recommendation is explicitly labelled a **heuristic** in both
   the terminal advisory and the `--json` payload, with a caveat noting it does
   not control for task difficulty. See §2.

## Problem

Phase 13A/B/C shipped structured evaluation, experiments, context-mode advice,
and real context-escape measurement, leaving two items deferred:

1. **No routing recommendation.** `--report` aggregates evaluation records by
   model tier (pass rate, token cost, latency, retries) but never advises *which*
   tier to route to. The roadmap requires this to stay advisory until enough
   valid runs exist.
2. **Outcome cannot be human-decided.** `--evaluate` derives the outcome purely
   from the review `Verdict` (`approve→pass`, `request changes→fail`, `needs human
   decision→partial`). A `needs human decision` case is stuck at `partial`; there
   is no auditable way for a human to resolve it to `pass` or `fail`.

## Goals

- Add an **advisory** model-tier routing recommendation to `--report`: the
  lowest-token tier (by mean tokens per evaluation) whose pass rate holds within
  tolerance of the best tier, withheld until enough samples exist.
- Add a `--outcome pass|fail` override to `--evaluate`, allowed **only** when the
  derived outcome is `partial` (verdict `needs human decision`), requiring a
  `--reason`, and recorded with full provenance.
- Keep every change additive (`schema_version` stays `1`); existing records read
  back unchanged.

## Non-goals

- Overriding a clear `approve`/`request changes` verdict (would contradict the
  consistency gate). Rejected.
- Auto-selecting a tier at route time; the recommendation is report-only advice.
- A dashboard, or persisting the recommendation anywhere (it is derived on
  `--report`).
- New Phase 13 scope beyond these two items.

## Design

### 1. `--outcome` manual override in `--evaluate`

**When allowed.** Only when the review `Verdict` is `needs human decision` (i.e.
the derived outcome would be `partial`). The full consistency gate still runs
first; the override applies on top of a record that already passes the gate.

**CLI.** Two new flags, used together, plus a `--clear-outcome` reset (finding R10):

```bash
forgeai-init --evaluate --task <id> --outcome pass|fail --reason "<text>" [--by "<name>"]
forgeai-init --evaluate --task <id> --clear-outcome    # drop a prior override, re-derive
```

- `--outcome` accepts only `pass` or `fail`.
- `--clear-outcome` (optional, finding R10) removes a previously recorded
  `manual_override` so the outcome is re-derived from the verdict. It takes no
  value; combined with `--outcome`/`--reason`/`--by` it is a **usage error** (exit
  1) — you either set an override or clear one, not both. With no prior override it
  is a harmless no-op. As a **boolean** flag it is validated (finding R11-#5) to
  appear at most once and **without** a value: `--clear-outcome=true` or a duplicate
  is a usage error (exit 1), so a mistyped equals-form can't be silently ignored.
- `--force` (existing global flag) is honored here for one purpose (finding R11-#1):
  overwriting a prior evaluation record that is **corrupt/invalid**. Without it, any
  `--evaluate` that would overwrite an invalid record exits 1 and leaves the file
  untouched. With it, the corrupt file is preserved as
  `<taskId>.json.corrupt-<timestamp>` (finding R13-#4) — but only **after the build
  succeeds, immediately before the atomic write**, via `copyFileSync(…, COPYFILE_EXCL)`
  (finding R14-#3): backing up earlier would lose the corrupt file from the canonical
  path if the build then failed (the report would stop flagging it). A build failure
  leaves the canonical corrupt file exactly as-is.
- `--reason` is required whenever `--outcome` is given (and vice versa). Missing
  one, or an out-of-range `--outcome`, is a usage error (**exit 1**, matching
  `--evaluate`'s existing usage errors), before any record work.
- `--by` (optional) records **who** decided, for provenance (finding #3). When
  omitted it falls back to `git config user.name`, then `$USER`/`$USERNAME`, then
  the literal `unknown`. It is meaningful only with an override; supplied **without**
  `--outcome`/`--reason` it is a **usage error** (exit 1,
  `--by is only valid with --outcome and --reason`) — silently ignoring it would
  make the user believe provenance was recorded when no override was written.
- `--outcome`, `--reason`, and `--by` are registered in the shared value-flag
  validator (`context.ts` `validateArgFlag`, run eagerly at module load) alongside
  `--task`/`--mode`/etc. (`--clear-outcome` is a **boolean** flag with no value, so
  it is read via `args.has(...)`, not the value-flag validator.) It validates
  **both the spaced (`--outcome pass`) and
  equals (`--outcome=pass`) forms** — accepting a valid value in either form and
  rejecting (exit 1, before command dispatch) a duplicate
  (`--outcome pass --outcome fail`), a bare flag, an empty value (`--outcome=`),
  or a whitespace-only / `--`-prefixed value. A duplicated human decision must
  never be silently resolved to the first occurrence. `getArgValue` likewise reads
  either form, so `runEvaluate` sees the value regardless of syntax.
- Neither flag → today's behavior (outcome derived from verdict).

**Gate interaction.** Inside `buildEvaluationRecord`, after the gate passes and
the verdict is known: if an override was supplied but the verdict is **not**
`needs human decision`, the build fails with a gate-style error and writes
nothing:

> `--outcome override is only allowed when the review Verdict is 'Needs human decision' (got: <verdict>)`

When the override applies:
- `outcome` = the `--outcome` value.
- `outcome_source` becomes the `manual_override` variant.

**Type.** `EvaluationRecord.outcome_source` becomes a discriminated union
(`types.ts`):

```ts
export type EvaluationOutcomeSource =
  | { type: 'review_scorecard'; scorecard: string; verdict: string }
  | { type: 'manual_override';  scorecard: string; verdict: string;   // verdict is always 'needs human decision'
      decided_outcome: 'pass' | 'fail'; reason: string;
      decided_by: string;   // who resolved it (--by, or git/user fallback)   [finding #3]
      decided_at: string;   // ISO-8601 timestamp of the decision             [finding #3]
    };
```

The `manual_override` variant keeps `scorecard` + `verdict` for the audit trail
and adds the human decision, its justification, **and who decided it and when**
(finding R1-#3). There is **no** `decision_history` (finding R7 — dropped).
`schema_version` stays `1`; existing records are the `review_scorecard` variant and
read unchanged.

**Validator** (`isValidEvaluationRecord`): require `scorecard`/`verdict` strings,
then branch on `type`:
- `review_scorecard` → keep the existing `VERDICT_TO_OUTCOME[verdict] === outcome`
  check.
- `manual_override` → require `verdict === 'needs human decision'`,
  `decided_outcome ∈ {pass, fail}`, `decided_outcome === outcome`, a `reason`
  that is non-empty **after trimming** (rejects a whitespace-only reason on a
  tampered record, matching the CLI's `--reason` check), a non-empty `decided_by`,
  and a `decided_at` that is a **canonical** ISO-8601 string —
  `new Date(v).toISOString() === v`, the same standard as `generated_at`, not
  merely `Date.parse`-able (finding R2-#4).
- any other `type` → invalid.

**Output.** The success line names the override and who made it:

> `TASK-… → pass (manual override of "needs human decision" by <decided_by>: <reason>, N runs)`

The user-supplied `decided_by`/`reason` are interpolated into this terminal line;
since the CLI only checks non-empty, the success line **collapses line-breaking
chars — C0/C1 controls incl. `\r`/`\n` (finding R8-#3) plus U+2028/U+2029 (finding
R9-#1) — to spaces for display** so a crafted value cannot spoof extra log lines.
The stored record keeps the **raw** value. A value that is empty once those chars
are stripped is rejected at the CLI (finding R9-#2), so no record shows blank
provenance.

The `validation` block (test evidence) is unchanged — it reflects evidence, while
`outcome` reflects the human decision; they are intentionally independent.

**Keyed upsert that preserves the human decision (findings R7 + R10).** The record
is keyed by `task_id`; re-running `--evaluate` rewrites the file with the existing
`writeEvaluationRecord` (temp-file + rename, unchanged). There is still **no
append-only history and no concurrency guard** (R7's simplification stands — an
audit history would have needed a per-task lock or event-file model to honor a
"never lost" promise, judged over-built for 13D). What R10 changes is the *override
carry-forward*: a plain re-evaluate no longer silently reverts a human decision.

`runEvaluate` first reads the prior record with a **status-aware**
`readEvaluationRecordStatus(taskId, root)` → `{ status: 'missing' }`,
`{ status: 'valid', record }`, or `{ status: 'invalid', reason }` (finding R11-#1).
The reader also rejects a record whose **`task_id` ≠ the requested `taskId`** as
`invalid` (finding R12-#1) — a valid record for another task planted in
`<taskId>.json` must not be preserved (the schema validator already ties
`evaluation_id === eval-${task_id}`, so this also pins the `evaluation_id`).

- **Invalid prior → fail closed.** If the prior file exists but is corrupt/tampered,
  *any* `--evaluate` that would overwrite it (plain, `--outcome`, or `--clear-outcome`)
  exits 1 and leaves the file untouched — a corrupt record may still hold a human
  decision worth recovering. Passing the existing global **`--force`** overrides this
  and overwrites the bad record.

Given a `missing` or `valid` prior, the effective override is resolved by this
precedence:

1. `--outcome`/`--reason` given → a **new** override (stamped `decided_at = now`),
   replacing any prior one. Scope-gated: the current verdict must be
   `needs human decision`.
2. `--clear-outcome` given → **no** override; the outcome is re-derived from the
   verdict.
3. Neither, and the valid prior is a `manual_override`:
   - current verdict **still** `needs human decision` → **preserve** its
     `outcome_source` verbatim (same `verdict` snapshot, `decided_outcome`, `reason`,
     `decided_by`, `decided_at`), while metrics/validation/runs/context are rebuilt
     fresh.
   - current verdict **changed** to a clear verdict → **fail closed** (exit 1, finding
     R11-#3): the build returns an error asking for `--clear-outcome` (accept the
     derived outcome) or `--outcome` (record a new decision). No record ever pairs
     fresh validation with a stale verdict snapshot.
4. Otherwise → outcome derived from the verdict (today's behavior).

Internally this is two `buildEvaluationRecord` inputs — a new `override` (stamped
`decided_at = now`, scope-gated) and a `preservedSource` (used verbatim). The build
enforces both guards: a new `override` requires `needs human decision`, **and** a
`preservedSource` requires the current verdict to still be `needs human decision`
(else the R11-#3 error). A same-input re-run is idempotent; only `--clear-outcome` or
a new `--outcome` changes a preserved decision.

**Concurrency (finding R11-#6).** Because a plain re-evaluate reads and re-writes the
prior override, a concurrent `--clear-outcome` can be undone (the reader resurrects
the old override). 13D adds no per-task lock (R7); **concurrent `--evaluate` on the
same `task_id` is unsupported** — last-writer-wins, and preservation can resurrect a
just-cleared override. This is stated in the help text, not defended against.

### 2. Model-tier routing recommendation in `--report`

Report-only advice derived from the existing `byTier` aggregate, mirroring the
13B context-mode advisory (raw-value decisions, display-only rounding, a sample
gate, an `[advisory]` line, and a `--json` object).

**Heuristic caveat (findings #4 + R10).** The recommendation gates on per-tier
evaluation *count* — it does **not** control for task difficulty or task class. If
one tier happens to draw harder tasks than another, its pass rate and token cost
are not directly comparable, and the "lowest-token tier within tolerance" pick can
mislead. It also compares **token counts, not cost** — a provider's price per
input/output/cached token varies, so the lowest-token tier is not necessarily the
cheapest (a pricing-aware `mean_cost_per_eval` is a future refinement). A tier whose
records span more than one `provider/model` signature is excluded, and so is a tier
whose records carry **no** signature (finding R11-#2, see eligibility) — the
signature is derived from each record's runs, so drift is caught even without a
context artifact. Because the output is advisory (never auto-applied), the risk is
bounded, but the recommendation is explicitly presented
as a **heuristic**: the terminal line is tagged `[advisory · heuristic]` and carries
a short caveat, and the `--json` `routing` object includes a `heuristic: true` flag
and a `caveat` string. Restricting comparison to equivalent task cohorts/classes is
noted as a future refinement, not built here.

**Per-tier inputs.** From `aggregateEvaluations(...).byTier`, for each tier
except `unknown`:
- `pass_rate = pass / count * 100`
- `mean_tokens_per_eval = (input_tokens + output_tokens) / count`
- `routing_signatures` = the set of distinct `{provider, model}` pairs seen across
  that tier's records, taken from each record's **structured** `routing_signatures`
  (a new `EvaluationRecord.routing_signatures: RoutingSignature[]` field, always
  derived from the record's runs — findings R11-#2, R13-#1; a record with no runs has
  `[]` and contributes none). `aggregateEvaluations` unions the pairs by
  `(provider, model)`. The structured shape avoids the delimiter collision of a
  `provider/model` string — `--model` is not charset-restricted and may contain `/`
  or `,` (finding R13-#1). The validator requires each element to be
  `{ provider, model }` with both **non-empty after trimming** (finding R16-#1). To
  keep the writer and reader symmetric, the run-record validator rejects an
  empty/whitespace `model` and the builder skips an empty-signature run, so
  `--evaluate` can never write a record `--report` would reject.

**Eligibility (findings R10, R11-#2, R13-#5).** A tier is eligible when it is
`tier !== 'unknown'`, has `count >= minSamples` (see below), **and carries exactly
one distinct `{provider, model}` signature**. It is *excluded* with a per-tier `excluded_reason`
(human) **and** an `excluded_reason_code` (stable): `mixed_signatures` when it has
more than one signature (a tier remapped from model A→B is not blended),
`missing_signature` when it has zero (a tier we can't attribute to a model is never
silently trusted), or `insufficient_samples` (`only N evals (< minSamples)`).

**Recommendation.**
- If fewer than **two** eligible tiers exist → withheld (`reason_code:
  'insufficient_eligible_tiers'`), with the human `reason`, `eligible_tiers`, and
  `required_tiers` in the JSON (findings R10, R12-#4).
- If any evaluation record is **invalid** (see "Invalid records" below) → withheld
  (`reason_code: 'invalid_records_present'`), regardless of tier counts (finding
  R13-#3).
- `best` = eligible tier with the highest `pass_rate`.
- `candidates` = eligible tiers with `pass_rate >= best.pass_rate −
  MAX_PASS_RATE_DROP_PCT` (reuse the 13B constant, 5 pts).
- `recommended` = the candidate with the lowest `mean_tokens_per_eval`; ties
  broken by tier name ascending, for determinism. (If the lowest-token overall tier
  is also the best-pass-rate tier, it is recommended — advice and quality agree.)

**Sample gate (finding R10).** Routing uses its own **`MIN_TIER_SAMPLES = 20`**,
separate from the experiment advisory's `MIN_EXPERIMENT_PAIRS = 5`: with only 5
evals a tier's pass rate moves in 20-pt steps, so a 5-pt tolerance is nearly
degenerate. The `--min-samples` flag, **when supplied**, overrides *both* gates;
when absent, experiments default to 5 and routing to 20. (The earlier plan reused a
single 5-sample default for both — that alias is dropped.)

**Pure functions** (`evaluation-report.ts`):

```ts
export type RoutingSignature = { provider: string; model: string };  // structured [finding R13-#1]
export type TierRouting = {
  tier: string; count: number; pass_rate: number; mean_tokens_per_eval: number;
  routing_signatures: RoutingSignature[];  // distinct {provider, model} seen     [findings R10, R13-#1]
  excluded_reason: string | null;          // non-null => not a routing candidate  [finding R10]
  excluded_reason_code: 'missing_signature' | 'mixed_signatures' | 'insufficient_samples' | null; // [finding R13-#5]
};
export type RoutingRecommendation = {
  recommended_tier: string | null;
  best_tier: string | null;
  withheld: boolean;
  reason: string | null;           // human-readable message when withheld (null otherwise) [finding R10]
  reason_code: 'insufficient_eligible_tiers' | 'invalid_records_present' | null; // stable machine code [findings R12-#4, R13-#3]
  eligible_tiers: number;          // count of tiers that passed all eligibility gates [finding R10]
  required_tiers: number;          // always 2 [finding R12-#4]
  min_samples: number;
  heuristic: true;                 // always advisory; not difficulty-controlled  [finding #4]
  caveat: string;                  // human-readable caveat surfaced in --json     [finding #4]
  tiers: TierRouting[];            // all non-unknown tiers, sorted by tier name
};
export function recommendRouting(aggregate: Aggregate, minSamples: number): RoutingRecommendation;
```

**Terminal output.** A Routing section prints for any **non-empty** report,
independent of whether experiments exist (it comes after the Experiments
section). It is *not* printed on the existing zero-record early return
("no evaluation records"). Two lines, following the 13B convention (`skipped`
status for withheld, an `[advisory]` tag for an active recommendation):

- Withheld: `formatStatus('skipped', 'routing recommendation withheld — <reason>')`
  where `<reason>` is the machine-readable reason (e.g.
  `fewer than 2 eligible tiers with >= 20 evaluations (1 eligible)`).
- Otherwise: `formatStatus('metric', '[advisory · heuristic] route to <tier> — <n> evals, pass <X>%, mean <Y> tokens/eval (lowest-token within 5 pts of best <best_tier> <W>%; heuristic — token count, not cost; does not control for task difficulty)')`.

**`--json`.** Add a `routing` object alongside `experiments`/`recommendation`.
It carries a `heuristic` flag, a `caveat` string (finding #4), and — when withheld —
a stable `reason_code` + `required_tiers` alongside the human `reason` and the
`eligible_tiers` count (findings R10, R12-#4):

```json
{ "recommended_tier": "standard", "best_tier": "premium", "withheld": false,
  "reason": null, "reason_code": null, "eligible_tiers": 2, "required_tiers": 2,
  "min_samples": 20, "heuristic": true,
  "caveat": "Lowest-token tier (token count, not cost); gated on per-tier eval count only; does not control for task difficulty or task class.",
  "tiers": [ { "tier": "premium", "count": 22, "pass_rate": 100.0, "mean_tokens_per_eval": 5200.0, "routing_signatures": [{ "provider": "anthropic", "model": "claude-opus-4-8" }], "excluded_reason": null, "excluded_reason_code": null },
             { "tier": "standard", "count": 24, "pass_rate": 96.0, "mean_tokens_per_eval": 3100.0, "routing_signatures": [{ "provider": "anthropic", "model": "claude-sonnet-4-6" }], "excluded_reason": null, "excluded_reason_code": null } ] }
```

Alongside `routing`, the report payload gains a top-level **`invalid_records`** array
(findings R13-#3, R15-#3): `[{ "file": "TASK-x.json", "reason_code": "invalid_json" | "invalid_schema" | "task_id_mismatch" | "read_error" }]`, empty when all records parse. This is the **general** `--json` payload (full schema — `experiments`/`recommendation`/`byTier` all present), used even for 0 valid + N invalid; there is no separate reduced payload (finding R15-#2).

When withheld, `reason_code` is `"insufficient_eligible_tiers"` and `reason` the
matching sentence (e.g. `"fewer than 2 eligible tiers with >= 20 evaluations (1
eligible)"`).

Values rounded for display/JSON via the existing `round1`; decisions use raw
values.

**Invalid records (findings R13-#3, R15).** `--report` loads records through a detailed
listing (`listEvaluationRecordsDetailed`) that returns the valid records **and** the
files it rejected, each with a stable `reason_code` (`invalid_json` /
`invalid_schema` / `task_id_mismatch` / `read_error`). The listing is fail-closed and
deterministic (findings R15-#3, R16-#2): it does **not** use `fs.existsSync` (which
returns false for an inaccessible directory as well as a missing one — defeating
fail-closed); instead it classifies straight from `readdirSync` — `ENOENT` is truly
absent (empty result), any other error yields a `read_error` entry (with the
**relative** path) so routing withholds rather than looking empty. It also separates
the file read from the JSON parse (a permission error is `read_error`, not
`invalid_json`), and sorts its output (records newest-first, `invalid` by file). The
validator it calls is **total** — it never throws on a malformed timestamp (finding
R15-#1). The report no longer drops these silently: it
prints a terminal warning naming the files, adds `invalid_records` to `--json`, and
**withholds routing** (`reason_code: 'invalid_records_present'`) whenever any exist —
a corrupt record can't be attributed to a tier, so it could have changed the
recommendation (fail-closed, consistent with `--evaluate`). `.corrupt-<ts>` backup
files (finding R13-#4) do not match `*.json` and are ignored by the listing. The
zero-record early return fires **only** when there are no valid *and* no invalid
records (finding R14-#4); a directory of only corrupt files still prints the warning
and a withheld routing rather than "no evaluation records".

## Data flow

```
--evaluate --task T [--outcome pass|fail --reason "…" [--by "…"]] [--clear-outcome] [--force]
    parse flags (usage errors: --outcome/--reason one-without-the-other,
                 bad --outcome value, --by without an override,
                 --clear-outcome combined with --outcome/--reason/--by,
                 --clear-outcome=<value> or duplicate — R11-#5)
 -> readEvaluationRecordStatus(T): missing | valid | invalid           [R11-#1, task_id check R12-#1]
      invalid & !--force -> exit 1, file untouched
      invalid & --force  -> remember; back up AFTER a successful build     [R13-#4, R14-#3]
 -> consistency gate (unchanged) ; verdict resolved
 -> resolve effective override (precedence — R10/R11):
      --outcome given                 -> NEW override (decided_at = now; gated)
      --clear-outcome given           -> none (re-derive)
      valid prior is manual_override  -> PRESERVE verbatim, BUT
           verdict != needs human decision -> FAIL exit 1 (R11-#3)
      else                            -> none (re-derive)
 -> new override & verdict != 'needs human decision' -> FAIL (no record)
 -> build record; build FAILS -> exit 1, canonical (corrupt) file untouched  [R14-#3]
 -> outcome/outcome_source from preservedSource | new override | derived
 -> routing_signatures = derive structured {provider,model}[] from runs  [R11-#2, R13-#1]
 -> if invalid & --force: copyFileSync -> <T>.json.corrupt-<ts>          [R14-#3]
 -> write .ai/state/evaluations/<T>.json  (keyed upsert; decision preserved/hardened)

--report [--json] [--min-samples N]
 -> { records, invalid } = listEvaluationRecordsDetailed()             [R13-#3]
      (total validator, no throw on bad timestamp — R15-#1; readdir/read errors
       -> read_error entries; output sorted — R15-#3)
 -> if --json: emit ONE general payload (routing + invalid_records), return  [R15-#2]
 -> (terminal) records==0 && invalid==0 -> "no evaluation records", return    [R14-#4]
 -> (terminal) records==0 && invalid>0  -> warn + withheld routing, return    [R14-#4]
 -> aggregate byTier (+ per-tier routing_signatures from record.routing_signatures)  [R11-#2, R13-#1]
 -> routingMinSamples = getArgValue('--min-samples') != null ? N : MIN_TIER_SAMPLES  [R11-#4]
 -> routing = recommendRouting(aggregate, routingMinSamples)  [default 20]
      invalid.length > 0 -> withhold routing (invalid_records_present)  [R13-#3]
 -> print invalid warning + Routing section / add `routing` + `invalid_records` to --json
```

## Testing

- **override happy path**: a `needs human decision` task + `--outcome pass
  --reason "…"` writes a record with `outcome: pass`,
  `outcome_source.type: manual_override`, `decided_outcome: pass`, the reason,
  `verdict: 'needs human decision'`, and a non-empty `decided_by`/`decided_at`
  (finding #3); `--outcome fail` → `fail`. `--by "Alice"` is recorded verbatim;
  omitting `--by` falls back to git/user and is still non-empty.
- **override replaced by a new override (finding R7)**: after one override, a second
  `--evaluate --outcome fail` replaces the record (outcome `fail`, new reason/`decided_by`),
  and there is **no** `decision_history` field.
- **override preserved on plain re-evaluate (finding R10)**: after `--outcome pass`,
  a bare `--evaluate` (verdict still `needs human decision`) keeps `outcome: pass`
  and the same `decided_by`/`decided_at`/`reason` (not restamped), while other fields
  refresh.
- **verdict drift fails closed (finding R11-#3)**: after `--outcome pass`, editing the
  review to a clear verdict (Approve/Request changes) and running a bare `--evaluate`
  exits 1 (no write); `--clear-outcome` or a new `--outcome` then succeeds.
- **corrupt prior fails closed (finding R11-#1)**: with a corrupt
  `.ai/state/evaluations/<T>.json`, a bare `--evaluate` (and `--outcome`, and
  `--clear-outcome`) exits 1 and leaves the file untouched; `--force` overwrites it.
- **task_id mismatch fails closed (finding R12-#1)**: a schema-valid record whose
  `task_id` is `TASK-B` planted in `TASK-A.json` reads back `invalid`; `--evaluate
  TASK-A` exits 1 (does not preserve TASK-B's decision) and the file is untouched.
- **routing_signatures validation (findings R13-#1)**: a record with a malformed
  `routing_signatures` (not an array, or an element missing `provider`/`model`, or an
  empty-string field) is rejected; a structured
  `[{ provider: 'anthropic', model: 'claude-opus-4-8' }]` and a model id containing
  `/`/`,` (e.g. `meta-llama/llama-3.1`) are accepted; a legacy record without the
  field validates and normalizes to `[]`.
- **corrupt --force backup (findings R13-#4, R14-#3)**: `--evaluate --force` over a
  corrupt record preserves it as `<T>.json.corrupt-<ts>` (contents intact) — but only
  after a successful build. **Build failure** (corrupt + `--force` + a broken
  journal/scorecard) leaves the canonical corrupt file untouched, makes **no** backup,
  and the report still flags it (routing withheld).
- **invalid records in report (finding R13-#3)**: a corrupt file makes
  `--report --json` list it under `invalid_records` (with a `reason_code`), print a
  terminal warning, and withhold routing (`reason_code: 'invalid_records_present'`).
- **invalid-only directory (findings R14-#4, R15-#2)**: a directory with 0 valid + 1
  invalid record does **not** print "no evaluation records" — it surfaces the invalid
  file, the warning, and a withheld routing (both `--json` and terminal); the `--json`
  payload is the **full** schema (`experiments`/`recommendation`/`byTier` present).
- **total validator, no crash (finding R15-#1)**: a record that parses but has
  `generated_at: "invalid"` reads back invalid (`readEvaluationRecord`/-`Status` return
  null/`invalid`, not a thrown `RangeError`), and `--report --json` lists it as
  `invalid_schema` without crashing.
- **writer/reader symmetry (finding R16-#1)**: a run with `model: "   "` (whitespace)
  is rejected by the run-record validator, so `--evaluate` writes an evaluation record
  with empty `routing_signatures` that reads back **valid** (not `invalid_schema`) — the
  writer never emits what the reader rejects.
- **fail-closed read_error (finding R16-#2)**: a path under `.ai/state/evaluations`
  that can't be read as a file (e.g. a directory named `TASK-….json`) is reported as
  `read_error` (not `invalid_json`) and withholds routing; an inaccessible directory is
  not mistaken for empty.
- **--clear-outcome resets to derived (finding R10)**: after `--outcome pass`,
  `--evaluate --clear-outcome` re-derives the outcome (`partial`) and the
  `outcome_source.type` returns to `review_scorecard`. `--clear-outcome` together
  with `--outcome`/`--reason`/`--by` is a usage error (exit 1, no record); a
  `--clear-outcome=true` or a duplicated `--clear-outcome` is a usage error
  (finding R11-#5).
- **--by scope (finding R2-#3)**: `--by` without `--outcome`/`--reason` is a usage
  error (exit 1, no record).
- **decided_at canonical (finding R2-#4)**: a parseable but non-canonical ISO
  timestamp on a tampered `manual_override` reads back invalid.
- **terminal sanitization (findings R8-#3, R9-#1)**: a `--reason`/`--by` containing
  `\n`/control chars **or U+2028/U+2029** produces a single-line success message
  (chars collapsed to spaces), while the JSON record keeps the raw value.
- **blank-once-stripped rejected (finding R9-#2)**: a `--reason`/`--by` that is
  empty after stripping line-breakers (e.g. only control chars) is a usage error
  (exit 1, no record).
- **override rejected**: `--outcome` on an `approve` (or `request changes`) task
  fails and writes nothing; `--outcome` without `--reason` (and vice versa), and
  an invalid `--outcome` value, are usage errors (exit 1).
- **flag validation (shared layer)**: a duplicate `--outcome pass --outcome fail`
  (and duplicate `--reason`), a bare `--outcome`, and a whitespace-only
  `--reason "   "` are all rejected at load (exit 1) — the duplicate must never
  resolve silently to the first value.
- **validator round-trip**: a `manual_override` record reads back valid; a
  tampered one (outcome ≠ decided_outcome, verdict ≠ needs human decision, empty
  **or whitespace-only** reason) reads back invalid; legacy `review_scorecard`
  records still validate.
- **override in report (E2E)**: after `--evaluate --outcome pass --reason …`,
  `--report --json` counts the record as `pass` in its tier aggregate and the
  routing recommendation reflects it (proves the `manual_override` record is
  listed and aggregated, not dropped).
- **routing**: with two eligible tiers, the lowest-token tier within tolerance is
  recommended; a lower-token tier whose pass rate is below tolerance is **not**
  recommended (the better tier wins); withheld with < 2 eligible tiers or when
  `--min-samples` is unmet, and the withheld terminal line + JSON `reason`/
  `eligible_tiers` are asserted; `unknown` tier excluded; `--json` `routing` object
  shape. The withheld payload's `reason_code` is `insufficient_eligible_tiers` and
  `required_tiers` is 2 (finding R12-#4).
- **routing signature exclusion (findings R10, R11-#2, R13-#1/#5)**: a tier whose
  records carry two distinct `{provider, model}` pairs is excluded
  (`excluded_reason_code: 'mixed_signatures'`) and does not count toward the ≥ 2
  eligible tiers; a tier whose records all have empty `routing_signatures` is excluded
  (`'missing_signature'`) — no caveat-only pass-through. Two same-name tiers with
  different models are **not** merged.
- **routing sample gate default (findings R10, R11-#4)**: with no `--min-samples`,
  routing uses `MIN_TIER_SAMPLES = 20` (two tiers of 5 each are withheld); a passed
  `--min-samples 1` **and** the equals form `--min-samples=1` both override it. The
  experiment advisory still defaults to 5.
- **decided_by env fallback (finding R10)**: with `--by` absent and git unset, a
  whitespace-only `$USER` falls through to a set `$USERNAME` (not `unknown`); all
  blank → `unknown`.
- **routing precision (unit, crafted aggregates)**: raw pass rates are compared
  at the tolerance boundary — an *exactly* 5.0-pt drop keeps the cheap tier
  eligible, while a raw drop just above 5.0 that *rounds* to 5.0 excludes it
  (proves rounding is display-only). A mean-token tie is broken by tier name
  ascending.
- **routing heuristic labelling (finding #4)**: an active `--json` `routing`
  object has `heuristic: true` and a non-empty `caveat`; the terminal advisory
  line is tagged `[advisory · heuristic]` and mentions task difficulty.

## Files

- `bin/lib/run-record.ts` — `isValidRunRecordInput` rejects an empty/whitespace `model` (finding R16-#1).
- `bin/lib/context.ts` — register `--outcome`/`--reason`/`--by` in the eager value-flag validator; add a boolean-flag validation for `--clear-outcome` (reject `=value`/duplicate — R11-#5).
- `bin/lib/init.ts` — document `--outcome`/`--reason`/`--by`/`--clear-outcome`/`--force` in the `--evaluate` help text, incl. the "concurrent evaluate unsupported" note (R11-#6).
- `bin/lib/types.ts` — `EvaluationOutcomeSource` union (with `decided_by`/`decided_at`); `EvaluationRecord.outcome_source` uses it; **`RoutingSignature = { provider; model }`** and **`EvaluationRecord.routing_signatures: RoutingSignature[]`** (R11-#2, structured — R13-#1); **`EvaluationRecordWire`** (`mode`/`experiment_id`/`comparability`/`routing_signatures` all optional — R13-#2, R14-#2). No `decision_history` (R7).
- `bin/lib/evaluation-record.ts` — **update imports** (`execFileSync` from `node:child_process`; `EvaluationOutcomeSource` from `./types.js`; `args`/`force` from `./context.js`) — findings R10-#2/R11-#1; add **`readEvaluationRecordStatus`** (`missing`/`valid`/`invalid`, incl. the `task_id === taskId` check — R12-#1) — R11-#1; `--outcome`/`--reason`/`--by`/`--clear-outcome` parse in `runEvaluate` (incl. usage errors); status-aware prior read + fail-closed on invalid unless `--force` (R11-#1); override carry-forward via a `preservedSource` with the verdict-drift guard (R11-#3); `decided_by` fallback (git/user, each env candidate trimmed and tested in turn — R3-#3 + R10-#6); derive structured `routing_signatures` from runs via a `JSON.stringify` dedup key — no NUL (R11-#2, R13-#1, R14-#1); `--force` backs up a corrupt record to `.corrupt-<ts>` via `copyFileSync(COPYFILE_EXCL)` **after a successful build, before the write** (R13-#4, R14-#3); make `isValidEvaluationRecord` **total** — `Date.parse` guard before `generated_at`'s `toISOString` (R15-#1) — and trim `routing_signatures[]` `provider`/`model` (R16-#1); add `listEvaluationRecordsDetailed` (valid + `invalid[]`, `read_error` reason, no `existsSync` — classifies from `readdirSync` incl. ENOENT, relative path — R16-#2; read/parse separated, output sorted — R15-#3) for the report (R13-#3); `override`/`preservedSource` threaded into `buildEvaluationRecord`; verdict-scope gate (new override) + verdict-drift gate (preserved); `isValidEvaluationRecord(raw): raw is EvaluationRecordWire` branch (reason non-empty after trim, `decided_by` present, `decided_at` canonical ISO — R2-#4; validate a structured `routing_signatures` array, legacy-absent tolerated — R13-#1/#2); success line. `writeEvaluationRecord` unchanged (keyed upsert — R7/R10).
- `package.json` **and** `package-lock.json` — version bump to `3.10.0` (R3-#2).
- `bin/lib/evaluation-report.ts` — `aggregateEvaluations` unions per-tier `{provider, model}` from `record.routing_signatures` (R11-#2, R13-#1); `recommendRouting` (with `heuristic`/`caveat`, `MIN_TIER_SAMPLES = 20`, mixed/missing-signature exclusion + `excluded_reason_code` — R13-#5, withheld `reason`/`reason_code`/`eligible_tiers`/`required_tiers`), routing sample-default via `getArgValue('--min-samples')` (R11-#4); `runReport` uses `listEvaluationRecordsDetailed`, adds `invalid_records` + a terminal warning and withholds routing when any invalid (R13-#3), and its zero-record early return fires only when *both* valid and invalid are empty (invalid-only still warns/withholds — R14-#4); terminal Routing section, `routing` in `--json`.
- Tests: `test/evaluate-command.test.ts`, `test/evaluation-record.test.ts`, `test/evaluation-report.test.ts`; plus `test/experiment-aggregation.test.ts` — every typed `EvaluationRecord` fixture gains `routing_signatures` (required field — findings R12-#2, R13-#1).
- Docs: `README.md`, `CHANGELOG.md` (new `## 3.10.0` section), `docs/migrations/3.10.0.md` (new file), `ROADMAP.md`.

## Release

**Corrected (finding #2).** 3.9.0 is **already published** (npm
`forgeai-agentic-init@3.9.0`, `dist-tags.latest = 3.9.0`, 2026-07-28), so 13D can
**not** fold into it. 13D ships as a **new minor, 3.10.0** — additive only
(`schema_version` stays `1`; 3.9.0 records read back unchanged).

- Bump `package.json` **and** `package-lock.json` to `3.10.0` (the lockfile pins
  the version at the top level and the root package; `npm install
  --package-lock-only` syncs both) — finding R3-#2.
- Add a new `## 3.10.0 — <ship-date>` section to `CHANGELOG.md` (routing advisory +
  `--outcome`/`--clear-outcome` override, with the provenance and heuristic notes),
  leaving the published `3.9.0` section untouched. Use the **actual ship date**, not
  a pre-dated one (finding R10-#7).
- Add a new `docs/migrations/3.10.0.md` (do not edit the shipped `3.9.0.md`).
- Add the README notes.
- Update `ROADMAP.md` so the Phase 13 deferred list is **empty** — 13A–13C
  shipped in 3.9.0, 13D ships in 3.10.0.
