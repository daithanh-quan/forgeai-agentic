# Phase 13D — Routing recommendations and `--outcome` override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revised 2026-07-30 (eighteen review rounds).** See the design's "Review findings".
> Round 18 (Task-4 import + scope): Task 4 now swaps the `evaluation-report.ts:4` import
> from `listEvaluationRecords` to `listEvaluationRecordsDetailed`, and its Step 6 stages
> `evaluation-record.ts` (which holds the new listing) with explicit test paths — R18-#1.
> Round 17 (test correctness + Task-1 scope): the R16 whitespace-model test asserted the
> wrong tier — with the run filtered there are no valid runs, so the record's tier is
> `unknown`, not `standard` — R17-#1; Task 1 now adds a `test/run-record.test.ts` unit
> test, runs it in Step 5, and stages `run-record.ts` + both fixture files in Step 6 so
> they don't leak into a later commit — R17-#2.
> Round 16 (writer/reader symmetry + fail-closed): the run-record validator now rejects
> an empty/whitespace `model`, the evaluation validator trims `provider`/`model`, and the
> builder skips empty signatures — so `--evaluate` can never write a record `--report`
> rejects — R16-#1; `listEvaluationRecordsDetailed` drops `existsSync` and classifies
> straight from `readdirSync` (ENOENT = empty; other errors = `read_error`, relative
> path) so an unreadable dir withholds instead of looking empty — R16-#2.
> Round 15 (report robustness): the validator is made **total** — a `Date.parse` guard
> so a bad `generated_at` reads back invalid instead of throwing `RangeError` and
> crashing `--report` (R13's callers invoke it outside a try) — R15-#1; the unreachable
> off-schema invalid-only JSON branch is removed (one general payload handles 0 valid +
> N invalid) — R15-#2; `listEvaluationRecordsDetailed` is fail-closed + deterministic
> (`readdirSync` caught → `read_error`, read/parse separated, output sorted) — R15-#3.
> Round 14 (R13 mechanics): the structured-signature dedup key drops a stray NUL byte
> for `JSON.stringify([provider, model])` — R14-#1; `EvaluationRecordWire` makes **all**
> normalized fields optional (`mode`/`experiment_id`/`comparability`/`routing_signatures`)
> — R14-#2; `--force` backs up the corrupt file with `copyFileSync(COPYFILE_EXCL)` only
> **after a successful build**, right before the write — R14-#3; the zero-record early
> return no longer hides an invalid-only directory — R14-#4.
> Round 13 (structured signature + corrupt visibility): the record stores a
> **structured** `routing_signatures: RoutingSignature[]` (`{provider,model}`), not a
> `provider/model` string that breaks on model IDs containing `/` or `,` — R13-#1; the
> validator narrows to an `EvaluationRecordWire` (normalized fields optional; all four
> per R14-#2) with a normalize step, fixing the type-predicate lie — R13-#2; `--report` reports `invalid_records`
> (+ terminal warning) and **withholds routing** when any exist — R13-#3; `--force`
> preserves a corrupt record as `.corrupt-<ts>` (timing corrected in R14-#3) — R13-#4;
> each tier gains `excluded_reason_code` — R13-#5.
> Round 12 (closing R11 gaps): `readEvaluationRecordStatus` now rejects a record whose
> internal `task_id` ≠ the requested task — R12-#1; Task 1 updates **all** typed
> `EvaluationRecord` fixtures for the new required `routing_signature` (else typecheck
> fails) — R12-#2; a mixed-signature tier's recovery is documented (signatures shown in
> `--json`) — R12-#3; the withheld `routing` JSON gains a stable `reason_code` +
> `required_tiers` — R12-#4; `routing_signature` is validated as canonical
> comma-separated `provider/model` pairs — R12-#5.
> Round 11 (hardening): a corrupt prior record now **fails closed** (status-aware
> `readEvaluationRecordStatus`; exit 1 unless `--force`) — R11-#1; the routing
> signature is a new always-derived `EvaluationRecord.routing_signature`, and a tier
> with zero or multiple signatures is excluded — R11-#2; a preserved override whose
> review has drifted to a clear verdict **fails closed** (exit 1, needs
> `--clear-outcome`/`--outcome`) — R11-#3; the routing sample-default is chosen with
> `getArgValue('--min-samples')` so the equals form works — R11-#4; `--clear-outcome`
> gets boolean-flag validation (no `=value`, no duplicate) — R11-#5; help/design state
> concurrent `--evaluate` on one task is unsupported — R11-#6.
> Round 10 (pre-implementation): a plain re-evaluate now **preserves** a human
> `manual_override` instead of reverting it; `--clear-outcome` resets it (R10-#1).
> Plan samples now update `evaluation-record.ts` imports — `execFileSync` +
> `EvaluationOutcomeSource` (R10-#2). Routing excludes a tier carrying more than one
> `comparability.routing_signature` (R10-#3), relabels the pick **lowest-token**
> (not "cheapest", R10-#4), splits `MIN_TIER_SAMPLES = 20` from `MIN_EXPERIMENT_PAIRS`
> and adds withheld `reason`/`eligible_tiers` JSON (R10-#5), fixes the
> `$USER`/`$USERNAME` fallback to trim each candidate (R10-#6), and uses the actual
> ship date, not `2026-07-29` (R10-#7).
> Round 9 (sanitizer completeness): `LINE_BREAKERS` also strips U+2028/U+2029
> (R9-#1); a `--reason`/`--by` empty once line-breakers are stripped is a usage
> error, so no record shows blank provenance (R9-#2); round-count metadata
> reconciled (R9-#3).
> Round 8 (wording + hardening): help text no longer claims prior overrides are
> preserved (R8-#1); "idempotent" reworded to "keyed upsert / replaces" where input
> changes (R8-#2); the success line sanitizes control chars in `reason`/`decided_by`
> for terminal render, keeping the raw value in JSON (R8-#3).
> **Round 7 is a deliberate simplification: the entire append-only
> `decision_history` audit feature (accreted over rounds 2–6) is DROPPED.** The
> optimistic concurrency guard could not atomically prevent lost updates, and the
> history was judged over-built for 13D. 13D now keeps only `decided_by`/`decided_at`
> provenance on `manual_override`; re-`--evaluate` overwrites the record. All the
> history/guard/invariant machinery below is removed — earlier round entries are
> kept only as decision history.
> Round 1: **(R1-#1)** nothing is built yet (checklist all `[ ]`); this plan is
> the work remaining. **(R1-#2)** 3.9.0 is **published**, so 13D ships as
> **3.10.0**, not a fold-in (Task 5 + Global Constraints). **(R1-#3)** the
> `manual_override` variant gains `decided_by`/`decided_at` and an append-only
> `decision_history` (Tasks 1–2). **(R1-#4)** the routing recommendation is
> labelled a **heuristic** with a caveat (Tasks 3–4).
> Round 2 (correctness of the round-1 fixes): **(R2-#1)** `decision_history`
> must prefer the existing history (not re-add `outcome_source`) or it grows
> 1→3 — Task 2 build. **(R2-#2)** a *corrupt* prior record must fail closed
> (`readEvaluationRecordStatus`), never be silently overwritten — Task 2.
> **(R2-#3)** `--by` without an override is a usage error — Task 2.
> **(R2-#4)** `decided_at` must be *canonical* ISO — Task 1 validator.
> Round 3 (correctness of the round-2 fixes): **(R3-#1)** validator must enforce
> the `outcome_source`↔`decision_history` invariant (last entry === source), else
> a tampered record drops the current decision — Task 1. **(R3-#2)** the version
> bump must also update `package-lock.json` — Task 5. **(R3-#3)** trim the
> `$USER`/`$USERNAME` fallback in `resolveDecidedBy` — Task 2.
> Round 4 (correctness of the round-3 fixes): **(R4-#1)** the legacy-seed branch
> is unreachable under the strict invariant — removed; strict validator kept
> (Task 2 build). **(R4-#2)** a present-but-empty `decision_history` must be
> rejected — Task 1 validator. **(R4-#3)** history `decided_at` non-decreasing —
> *reverted in Round 5*. **(R4-#4)** this banner's round count updated.
> Round 5 (correctness of the round-4 fixes): **(R5-#1)** the happy-path
> `manual_override` fixture must include `decision_history` or it fails the R3-#1
> invariant — Task 1 test. **(R5-#2)** **revert R4-#3** — append order is array
> position, not wall-clock; the ordering check could reject a record the write path
> legitimately produced — Task 1 validator. **(R5-#3)** sync stale prose (data
> flow "legacy seed", build description, mis-named test).
> Round 6: **(R6-#1)** optimistic-concurrency guard (`mtimeMs`+`size` re-checked
> before rename → `EvaluationRecordConflictError`, exit 1) so concurrent
> `--evaluate` cannot silently drop a decision — Task 2. **(R6-#2)** new **Task 0**
> commits the untracked spec + plan before implementation. **(R6-#3)** design
> status → "approved for implementation".

**Goal:** Add an advisory model-tier routing recommendation to `--report`, and a human `--outcome pass|fail` override to `--evaluate` (allowed only for `needs human decision`), closing the last two deferred Phase 13 items.

**Architecture:** `--evaluate` gains `--outcome`/`--reason` (and `--clear-outcome`); the derived-outcome path is unchanged, but when the review Verdict is `needs human decision` a human can override to `pass`/`fail`, recorded via a new `manual_override` `outcome_source` variant. A plain re-evaluate **preserves** an existing override; `--clear-outcome` resets it (R10). `--report` gains a `recommendRouting` pure function that picks the lowest-token tier (mean tokens/eval) holding pass rate within 5 pts of the best tier, excluding any tier with mixed or missing `routing_signatures`, gated by `MIN_TIER_SAMPLES = 20` (override via `--min-samples`).

**Tech Stack:** TypeScript (Node ESM), `node:test` + `node:assert/strict`, `tsx` loader. Tests run end-to-end via `runTs(cli, …)` and as unit imports from `../bin/lib/*.js`.

## Global Constraints

- `schema_version` stays `1`; the change is additive. Existing records are the `review_scorecard` variant and read back unchanged.
- `--outcome` override is allowed **only** when the review Verdict is `needs human decision` (derived outcome `partial`); otherwise `--evaluate` fails and writes nothing.
- `--outcome` accepts only `pass` or `fail`; `--reason` is required with it (and vice versa); a missing/invalid combination is a usage error (**exit 1**, matching `--evaluate`'s existing usage errors) before any record work.
- Routing recommendation is **advisory and report-only** — never persisted, never auto-applied. It is withheld unless ≥ 2 eligible tiers exist, where a tier is eligible when `tier !== 'unknown'`, `count >= minSamples`, **and it carries exactly one distinct routing signature** (findings R10-#3, R11-#2, R13-#1): a tier remapped across models (>1 signature) is excluded as `mixed_signatures`, and a tier whose records have none (0) is excluded as `missing_signature` — never trusted by caveat alone. The signature is the record's structured `routing_signatures: RoutingSignature[]`, always derived from its runs.
- `minSamples` for routing is **`MIN_TIER_SAMPLES = 20`** (finding R10-#5), separate from the experiment advisory's `MIN_EXPERIMENT_PAIRS = 5`; `--min-samples`, when supplied, overrides both. (5 evals move a pass rate in 20-pt steps, too coarse for a 5-pt tolerance.)
- Tolerance reuses the existing `MAX_PASS_RATE_DROP_PCT = 5`. Ranking is by `mean_tokens_per_eval = (input_tokens + output_tokens) / count` — the **lowest-token** tier, *not* "cheapest" (token count ≠ cost across differently-priced providers — finding R10-#4); ties broken by tier name ascending.
- Decisions use raw values; rounding (`round1`) is display/JSON only.
- **Version bumps to `3.10.0`** (finding #2): 3.9.0 is already published on npm, so 13D is a new additive minor — **not** a fold-in. `schema_version` stays `1`. Test one file: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/<file>.test.ts`. Full suite: `npm test`.
- The `manual_override` variant carries `decided_by` + `decided_at` for provenance (finding R1-#3). There is **no** `decision_history`, but re-`--evaluate` is a keyed upsert that **preserves** an existing override unless a new `--outcome` is given or `--clear-outcome` resets it (finding R10-#1; supersedes R7's silent-revert). Preservation is hardened (finding R11): a **corrupt** prior record fails closed (exit 1 unless `--force`), and a preserved override whose review has **drifted** to a clear verdict fails closed (exit 1, needs `--clear-outcome`/`--outcome`). Same-input re-runs are idempotent; concurrent `--evaluate` on one task is unsupported (R11-#6). The routing recommendation is labelled a heuristic (finding R1-#4).

---

### Task 0: Commit the planning docs (finding R6-#2)

The design and plan are currently untracked (`??`) and no later `git add` stages
them, so the work would ship without its own spec. Commit them first, before any
implementation, so review history is captured.

- [ ] **Step 1: Stage and commit the spec + plan**

```bash
git add docs/superpowers/specs/2026-07-28-phase-13d-routing-outcome-design.md \
        docs/superpowers/plans/2026-07-28-phase-13d-routing-outcome.md
git commit -m "docs(plan): add Phase 13D routing/outcome design and implementation plan"
```

(The user owns commits — if you are an agent executing this plan, surface this
step for them rather than committing on their behalf.)

---

### Task 1: `outcome_source` union type + validator branch

**Files:**
- Modify: `bin/lib/types.ts` (`~line 343`) — `outcome_source` union + `RoutingSignature`/`routing_signatures` + `EvaluationRecordWire`
- Modify: `bin/lib/evaluation-record.ts` (`isValidEvaluationRecord`, `~lines 66-71`) — incl. total `generated_at` guard (R15-#1) + trimmed `routing_signatures` (R16-#1)
- Modify: `bin/lib/run-record.ts` (`isValidRunRecordInput`, `~line 39`) — reject an empty/whitespace `model` (R16-#1)
- Test: `test/evaluation-record.test.ts`; `test/run-record.test.ts` — a unit test that an empty/whitespace `model` is filtered (finding R16-#1)
- Test (typecheck fixtures, findings R12-#2/R13-#1): `test/evaluation-report.test.ts`, `test/experiment-aggregation.test.ts` — add `routing_signatures` to their typed `rec()` helpers so `npm run typecheck` stays green.

**Interfaces:**
- Produces: `EvaluationOutcomeSource` union; `EvaluationRecord.outcome_source: EvaluationOutcomeSource`; `RoutingSignature = { provider: string; model: string }` and `EvaluationRecord.routing_signatures: RoutingSignature[]` (findings R11-#2, structured — R13-#1); `EvaluationRecordWire` (field optional — R13-#2). `isValidEvaluationRecord(raw): raw is EvaluationRecordWire` accepts both outcome_source variants and a legacy record without `routing_signatures`.

- [ ] **Step 1: Write the failing test**

Add to `test/evaluation-record.test.ts` (it imports `readEvaluationRecord`/writers; use a direct validator round-trip via `writeEvaluationRecord` + `readEvaluationRecord`, or import the record and assert. Simplest: build a record object and run it through `writeEvaluationRecord` then `readEvaluationRecord` in a temp root):

```ts
test('a manual_override outcome_source round-trips; a tampered one is rejected', async () => {
  const { writeEvaluationRecord, readEvaluationRecord } = await import('../bin/lib/evaluation-record.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-ovr-'));
  // A manual_override record (finding R7 — no decision_history). One `override`
  // object; tampers patch a single field on it.
  const override = { type: 'manual_override', scorecard: 's', verdict: 'needs human decision', decided_outcome: 'pass', reason: 'ok after review', decided_by: 'Alice', decided_at: '2026-07-28T00:00:00.000Z' };
  const base = {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: 'eval-TASK-20260728-x',
    task_id: 'TASK-20260728-x', generated_at: '2026-07-28T00:00:00.000Z', mode: 'compact',
    experiment_id: null, comparability: null, outcome: 'pass',
    outcome_source: override,
    validation: { status: 'partial', evidence_count: 1, results: { pass: 0, fail: 0, skipped: 1 } },
    run_ids: [], context_artifact: null, task_journal: 'j', tier: 'standard',
    metrics: { context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, latency_ms: 0, retries: 0 } },
  } as unknown as import('../bin/lib/types.js').EvaluationRecord;
  writeEvaluationRecord(base, root);
  assert.ok(readEvaluationRecord('TASK-20260728-x', root), 'valid manual_override round-trips');

  const tamper = (patch: Record<string, unknown>) =>
    ({ ...base, outcome_source: { ...override, ...patch } } as never);

  // tampered: outcome !== decided_outcome (record-level)
  writeEvaluationRecord({ ...base, outcome: 'fail' } as never, root);
  assert.equal(readEvaluationRecord('TASK-20260728-x', root), null);
  // tampered: verdict not needs human decision
  writeEvaluationRecord(tamper({ verdict: 'approve' }), root);
  assert.equal(readEvaluationRecord('TASK-20260728-x', root), null);
  // tampered: empty reason
  writeEvaluationRecord(tamper({ reason: '' }), root);
  assert.equal(readEvaluationRecord('TASK-20260728-x', root), null);
  // tampered: whitespace-only reason
  writeEvaluationRecord(tamper({ reason: '   ' }), root);
  assert.equal(readEvaluationRecord('TASK-20260728-x', root), null);
  // tampered: empty decided_by (finding R1-#3 provenance)
  writeEvaluationRecord(tamper({ decided_by: '' }), root);
  assert.equal(readEvaluationRecord('TASK-20260728-x', root), null);
  // tampered: unparseable decided_at
  writeEvaluationRecord(tamper({ decided_at: 'not-a-date' }), root);
  assert.equal(readEvaluationRecord('TASK-20260728-x', root), null);
  // tampered: parseable but NON-canonical ISO (missing ms / not what toISOString emits) — finding R2-#4
  writeEvaluationRecord(tamper({ decided_at: '2026-07-28T00:00:00Z' }), root);
  assert.equal(readEvaluationRecord('TASK-20260728-x', root), null);

  // tampered: an unparseable generated_at must read back invalid, NOT throw (finding R15-#1).
  // (new Date('invalid').toISOString() throws RangeError; the validator must guard it.)
  writeEvaluationRecord({ ...base, generated_at: 'invalid' } as never, root);
  assert.equal(readEvaluationRecord('TASK-20260728-x', root), null);

  // a legacy review_scorecard record still validates unchanged.
  writeEvaluationRecord({ ...base, outcome_source: { type: 'review_scorecard', scorecard: 's', verdict: 'approve' } } as never, root);
  assert.ok(readEvaluationRecord('TASK-20260728-x', root), 'review_scorecard still validates');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/evaluation-record.test.ts`
Expected: FAIL — typecheck rejects `type: 'manual_override'` (not in the current single-shape type), or the record is read as valid/invalid inconsistently.

- [ ] **Step 3: Add the union to `types.ts`**

Replace the inline `outcome_source` shape (`~line 343`) with a named union. Add before `EvaluationRecord`:

```ts
export type EvaluationOutcomeSource =
  | { type: 'review_scorecard'; scorecard: string; verdict: string }
  | { type: 'manual_override'; scorecard: string; verdict: string; decided_outcome: 'pass' | 'fail'; reason: string; decided_by: string; decided_at: string };
```

And in `EvaluationRecord`, change `outcome_source` to the union and add a **structured**
routing signature (finding R11-#2, structured per R13-#1 — always derived from the
record's runs; an empty array when there are no runs; feeds the routing eligibility
gate in Task 3). A structured `{provider, model}` array avoids the delimiter-collision
of a `provider/model` string (`--model` may itself contain `/` or `,`):

```ts
export type RoutingSignature = { provider: string; model: string };
```

```ts
  outcome_source: EvaluationOutcomeSource;
  routing_signatures: RoutingSignature[];
```

Also add a **wire** type (findings R13-#2, R14-#2) so the validator can honestly narrow
a legacy record, and a normalize step fills the defaults. The validator already accepts
a 3.9.0 record missing `mode`/`experiment_id`/`comparability` (each normalized on read —
`evaluation-record.ts` `~lines 100-108`), so the wire type must make **all** normalized
fields optional, not just `routing_signatures`:

```ts
export type EvaluationRecordWire = Omit<EvaluationRecord, 'mode' | 'experiment_id' | 'comparability' | 'routing_signatures'> & {
  mode?: EvaluationRecord['mode'];
  experiment_id?: EvaluationRecord['experiment_id'];
  comparability?: EvaluationRecord['comparability'];
  routing_signatures?: RoutingSignature[];
};
```

(No `decision_history`, per finding R7 — the append-only history is dropped.
Re-`--evaluate` is a keyed upsert that preserves an existing override unless
`--outcome`/`--clear-outcome` changes it — finding R10-#1, handled in Task 2.)

**Update every typed `EvaluationRecord` fixture (findings R12-#2, R13-#1).** Because
`routing_signatures` is a **required** field, `npm run typecheck` fails for every test
helper that constructs the type until each sets it. Add `routing_signatures` (an array
of `{provider, model}`; `[]` for a legacy/no-run fixture):

- `makeEval()` — `test/evaluation-record.test.ts` (`~line 18`): `routing_signatures: []` (its default record has no runs).
- `rec()` — `test/evaluation-report.test.ts` (`~line 10`): `routing_signatures: [{ provider: 'anthropic', model: tier }]` (see Task 3 — each tier needs exactly one signature to be routing-eligible).
- `rec()` — `test/experiment-aggregation.test.ts` (`~line 11`): `routing_signatures: [{ provider: 'anthropic', model: 'claude-opus-4-8' }]` (or `[]`; experiment aggregation ignores it).

(Records built as plain JSON via `JSON.stringify` are untyped and don't break
typecheck, but see Task 3/4 — the CLI report fixtures still need a signature to be
routing-eligible.) After this, `npm run typecheck` is green again.

- [ ] **Step 4: Branch the validator (narrowing to the wire type)**

Change the signature to narrow to the wire type (finding R13-#2), so a legacy 3.9.0
record without `routing_signatures` validates honestly (the predicate no longer claims
the required field is present): `function isValidEvaluationRecord(raw: unknown): raw is EvaluationRecordWire`.

**Make the validator total — it must never throw (finding R15-#1).** The existing
`generated_at` check (`~line 60`) is `new Date(r['generated_at']).toISOString() !== r['generated_at']`;
for a parseable JSON with `"generated_at": "invalid"`, `new Date('invalid').toISOString()`
throws `RangeError`. That was harmless while every caller wrapped the validator in a
`try` (old `readEvaluationRecord`/`listEvaluationRecords`), but R13's
`readEvaluationRecordStatus` and `listEvaluationRecordsDetailed` call it **outside** the
JSON-parse `try`, so a throw would crash `--report` instead of listing the record as
`invalid_schema`. Guard with `Date.parse` first (same pattern already used for
`decided_at` in `isValidManualOverride`):

```ts
  const generatedAt = r['generated_at'];
  if (typeof generatedAt !== 'string' || Number.isNaN(Date.parse(generatedAt))
      || new Date(generatedAt).toISOString() !== generatedAt) return false;
```

In `bin/lib/evaluation-record.ts` `isValidEvaluationRecord`, replace the two `outcome_source` lines (`~66-71`) with:

```ts
  const src = r['outcome_source'] as Record<string, unknown> | undefined;
  if (!src || typeof src['scorecard'] !== 'string' || typeof src['verdict'] !== 'string') return false;
  if (src['type'] === 'review_scorecard') {
    // verdict must map to the outcome — rejects e.g. verdict "request changes" claiming "pass".
    if (VERDICT_TO_OUTCOME[src['verdict'] as string] !== r['outcome']) return false;
  } else if (src['type'] === 'manual_override') {
    if (!isValidManualOverride(src, r['outcome'])) return false;
  } else {
    return false;
  }
  // findings R11-#2 / R13-#1 / R16-#1: routing_signatures is an array of { provider,
  // model } objects, each **non-empty after trimming** (must match the run-record
  // validator and the builder guard — see below — so the writer can never emit a record
  // the reader rejects). A structured shape sidesteps the delimiter problem of a
  // `provider/model` string (a model id may itself contain "/" or ","). A legacy record
  // predating the field (undefined) is tolerated (wire type) and normalized to [] on read.
  const rs = r['routing_signatures'];
  if (rs !== undefined) {
    const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
    if (!Array.isArray(rs) || !rs.every((s) => s !== null && typeof s === 'object'
        && nonEmpty((s as { provider?: unknown }).provider)
        && nonEmpty((s as { model?: unknown }).model))) return false;
  }
```

Also normalize the field on read: in `readEvaluationRecord`/`readEvaluationRecordStatus`/
`listEvaluationRecords`, where the wire record is spread with defaults
(`mode: raw.mode ?? 'compact'`, …), add `routing_signatures: raw.routing_signatures ?? []`
so a legacy record surfaces the field as `[]` and the result is a full
`EvaluationRecord` (not the wire type).

**Tighten the run-record validator so an empty `model` can't reach a signature
(finding R16-#1).** `isValidRunRecordInput` (`bin/lib/run-record.ts:39`) checks only that
`model` is a string, so `model: ""` / `"   "` is a *valid* run — and the builder copies
that straight into `routing_signatures`, producing an evaluation record the (now
trimmed) evaluation validator rejects on the next read. (`provider` is already
enum-checked against `VALID_PROVIDERS_REC`, so it can't be empty.) Require a non-empty
model:

```ts
  if (typeof r['model'] !== 'string' || r['model'].trim().length === 0) return false;
```

With this, `listRunRecords` filters an empty-model run, so it never reaches
`buildEvaluationRecord`; the builder guard (Task 2) is the final backstop so the writer
can never emit a record the reader rejects.

Add a unit test to the existing `test/run-record.test.ts` (finding R16-#1). It already
has a synchronous `makeRecord(overrides)` fixture and imports `writeRunRecord`/
`listRunRecords`; assert that an empty/whitespace `model` is filtered on read:

```ts
test('a run record with an empty or whitespace-only model is filtered out (finding R16-#1)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-run-model-'));
  writeRunRecord(makeRecord({ run_id: 'r-ok', model: 'claude-sonnet-4-6' }), root);
  writeRunRecord(makeRecord({ run_id: 'r-empty', model: '' }), root);
  writeRunRecord(makeRecord({ run_id: 'r-ws', model: '   ' }), root);
  assert.deepEqual(listRunRecords(root).map((r) => r.model), ['claude-sonnet-4-6']);
});
```
(there is no history to validate — finding R7):

```ts
function isValidManualOverride(src: Record<string, unknown>, expectedOutcome: unknown): boolean {
  // Human override is only for the 'needs human decision' case, must decide
  // pass|fail matching the outcome, carry a non-empty reason, and record who/when.
  if (src['verdict'] !== 'needs human decision') return false;
  if (src['decided_outcome'] !== 'pass' && src['decided_outcome'] !== 'fail') return false;
  if (src['decided_outcome'] !== expectedOutcome) return false;
  // reason must be non-empty after trimming (rejects a whitespace-only reason on
  // a tampered record, matching the CLI's --reason check).
  if (typeof src['reason'] !== 'string' || (src['reason'] as string).trim().length === 0) return false;
  // provenance (finding R1-#3): who decided, and (finding R2-#4) a *canonical* ISO
  // timestamp — same standard as generated_at, not just any parseable date.
  if (typeof src['decided_by'] !== 'string' || (src['decided_by'] as string).trim().length === 0) return false;
  const at = src['decided_at'];
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at)) || new Date(at).toISOString() !== at) return false;
  return true;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run the record validator test, the run-record test (R16-#1), and the two fixture files
whose typed `rec()` helpers now set `routing_signatures` (R12-#2/R13-#1) so typecheck
covers them:

`npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/evaluation-record.test.ts test/run-record.test.ts test/evaluation-report.test.ts test/experiment-aggregation.test.ts`

Expected: PASS. (`evaluation-report.test.ts` still fails its *routing* tests — those
are added in Task 3 — but must at least typecheck and pass its existing cases; if you
prefer, run only the two record tests here and defer the report/aggregation files to
their own tasks, as long as `npm run typecheck` is green across all of them.)

- [ ] **Step 6: Commit**

Stage **every** file Task 1 touched — including `run-record.ts` and the two fixture
files — so they don't leak into a later task's commit (finding R17-#2):

```bash
git add bin/lib/types.ts bin/lib/evaluation-record.ts bin/lib/run-record.ts \
        test/evaluation-record.test.ts test/run-record.test.ts \
        test/evaluation-report.test.ts test/experiment-aggregation.test.ts
git commit -m "feat(eval): add manual_override + structured routing_signatures, tighten run-record model"
```

---

### Task 2: `--outcome`/`--reason` override in `--evaluate`

**Files:**
- Modify: `bin/lib/evaluation-record.ts` **imports** (`~lines 1-5`) — add `execFileSync`, `EvaluationOutcomeSource`, and `args`/`force` (findings R10-#2, R11-#1)
- Modify: `bin/lib/context.ts` (eager value-flag list, `~line 45`; add a boolean-flag validation for `--clear-outcome` — R11-#5)
- Modify: `bin/lib/init.ts` (`--evaluate` help text, `~line 93`)
- Modify: `bin/lib/evaluation-record.ts` (`readEvaluationRecordStatus` — R11-#1; `BuildInput`, `buildEvaluationRecord` `~305-310`, `runEvaluate` `~376`, success line `~486`)
- Test: `test/evaluate-command.test.ts`

**Interfaces:**
- Consumes: `EvaluationOutcomeSource` (Task 1).
- Produces: `readEvaluationRecordStatus(taskId, root)` → `{ status: 'missing' } | { status: 'valid'; record } | { status: 'invalid'; reason }` (finding R11-#1). `BuildInput` gains **two** override inputs — `override: { outcome: 'pass' | 'fail'; reason: string; decidedBy: string } | null` for a **new** override (stamped `decided_at = input.now`, scope-gated against the current verdict), and `preservedSource: Extract<EvaluationOutcomeSource, { type: 'manual_override' }> | null` for a prior override carried **verbatim** (finding R10-#1). At most one is non-null. `buildEvaluationRecord` also derives the record's structured `routing_signatures: RoutingSignature[]` from runs (findings R11-#2, R13-#1) and enforces the **verdict-drift guard**: a `preservedSource` with a current verdict that is no longer `needs human decision` fails the build (R11-#3). `runEvaluate` parses `--outcome`/`--reason`/`--by`/`--clear-outcome`, rejects `--by` without an override and `--clear-outcome` with one, **reads the prior with `readEvaluationRecordStatus`** (invalid → exit 1 unless `--force`, which — only after a successful build, right before the write — copies the bad file to `.corrupt-<ts>` via `copyFileSync(COPYFILE_EXCL)` — R13-#4/R14-#3; valid `manual_override` → `preservedSource`), then writes the keyed upsert.
- **Imports (findings R10-#2, R11-#1):** the code below uses `execFileSync`, the `EvaluationOutcomeSource` type, and `args`/`force`; the current `evaluation-record.ts` imports none. Step 0 adds them, or `npm run typecheck` fails.
- The shared `validateArgFlag` layer (`context.ts`) validates every flag in its eager list in **both spaced and equals forms**: it accepts a valid value (`--outcome pass` or `--outcome=pass`) and rejects a duplicate, a bare flag, an empty (`--outcome=`), or a whitespace-only/`--`-prefixed value (exit 1). `--outcome`/`--reason`/`--by` are added to that list, so `runEvaluate` only needs the checks the shared layer cannot know: `--outcome`/`--reason` must appear together, `--outcome` must be `pass`|`fail`, and `--clear-outcome` must not be combined with an override. (`--by` is optional and independent. `--clear-outcome` is a **boolean** flag — no value — so it is *not* in the value-flag list; read it via `args.has('--clear-outcome')`.) `getArgValue` also reads either form. All usage errors here exit **1** (matching `--evaluate`'s existing usage errors, e.g. missing `--task`).

- [ ] **Step 0: Update imports (finding R10-#2)**

The samples below reference `execFileSync` and the `EvaluationOutcomeSource` type,
neither of which `evaluation-record.ts` currently imports. Update the top of
`bin/lib/evaluation-record.ts`:

```ts
import { execFileSync } from 'node:child_process';
import type { CompiledContextArtifact, EvaluationOutcomeSource, EvaluationRecord, RunRecord } from './types.js';
import { root, args, force, getArgValue } from './context.js';
```

(The existing `import type { CompiledContextArtifact, EvaluationRecord, RunRecord }`
line gains `EvaluationOutcomeSource`; the `execFileSync` import is new; and the
existing `import { root, getArgValue } from './context.js'` gains `args` — the
`--clear-outcome` boolean flag is read via `args.has(...)`, finding R10-#1 — and
`force` — the corrupt-record overwrite escape hatch, finding R11-#1.)

- [ ] **Step 1: Write the failing CLI test**

Add to `test/evaluate-command.test.ts`. The existing `setupRepo()` writes an `Approve` scorecard; add a helper for a `needs human decision` scorecard and cover the cases:

```ts
function setupHumanDecisionRepo(): string {
  const dir = setupRepo();
  fs.writeFileSync(path.join(dir, '.ai/state/reviews/TASK-20260724-x.md'),
    ['- Task ID: `TASK-20260724-x`', '', '## Scorecard', '| Dimension | Rating | Notes |', '| --- | --- | --- |', '| Correctness | concern | needs a human |', '', 'Unresolved blockers: none', '', 'Verdict: Needs human decision'].join('\n'));
  return dir;
}

test('--outcome overrides a needs-human-decision task with recorded provenance', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'approved after manual review']).status, 0);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8'));
  assert.equal(rec.outcome, 'pass');
  assert.equal(rec.outcome_source.type, 'manual_override');
  assert.equal(rec.outcome_source.decided_outcome, 'pass');
  assert.equal(rec.outcome_source.verdict, 'needs human decision');
  assert.equal(rec.outcome_source.reason, 'approved after manual review');
  // provenance (finding #3): decided_by falls back to git/user (non-empty); decided_at parses.
  assert.ok(rec.outcome_source.decided_by && rec.outcome_source.decided_by.length > 0);
  assert.ok(!Number.isNaN(Date.parse(rec.outcome_source.decided_at)));
});

test('--by records the decider verbatim', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'ok', '--by', 'Alice Reviewer']).status, 0);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8'));
  assert.equal(rec.outcome_source.decided_by, 'Alice Reviewer');
});

test('--by without --outcome/--reason is a usage error, not silently ignored (finding #3)', () => {
  const dir = setupHumanDecisionRepo();
  const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--by', 'Alice']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--by is only valid with --outcome and --reason/);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('a new --outcome replaces a prior override; no decision_history is kept (finding R7)', () => {
  const dir = setupHumanDecisionRepo();
  const p = path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json');
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'first', '--by', 'Alice']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).outcome, 'pass');
  // A second, explicit override replaces the first — no decision_history is kept.
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'fail', '--reason', 'second', '--by', 'Bob']).status, 0);
  const second = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(second.outcome, 'fail');
  assert.equal(second.outcome_source.reason, 'second');
  assert.equal(second.outcome_source.decided_by, 'Bob');
  assert.equal(second.decision_history, undefined); // no history field at all
});

test('a plain re-evaluate PRESERVES a prior override verbatim (finding R10-#1)', () => {
  const dir = setupHumanDecisionRepo();
  const p = path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json');
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'approved', '--by', 'Alice']).status, 0);
  const first = JSON.parse(fs.readFileSync(p, 'utf8'));
  // Re-evaluate with NO override flags: the human decision must survive, not revert to partial.
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x']).status, 0);
  const again = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(again.outcome, 'pass');
  assert.equal(again.outcome_source.type, 'manual_override');
  assert.equal(again.outcome_source.reason, 'approved');
  assert.equal(again.outcome_source.decided_by, 'Alice');
  assert.equal(again.outcome_source.decided_at, first.outcome_source.decided_at); // NOT restamped
});

test('verdict drift fails a plain re-evaluate closed; explicit flags recover (finding R11-#3)', () => {
  const dir = setupHumanDecisionRepo();
  const p = path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json');
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'approved']).status, 0);
  const before = fs.readFileSync(p, 'utf8');
  // Edit the review so its verdict is now a clear Request changes (no longer needs-human-decision).
  fs.writeFileSync(path.join(dir, '.ai/state/reviews/TASK-20260724-x.md'),
    ['- Task ID: `TASK-20260724-x`', '', '## Scorecard', '| Dimension | Rating | Notes |', '| --- | --- | --- |', '| Correctness | concern | regressed |', '', 'Unresolved blockers: none', '', 'Verdict: Request changes'].join('\n'));
  // A plain re-evaluate must FAIL closed — never pair fresh validation with the stale pass.
  const drift = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(drift.status, 1);
  assert.match(drift.stderr, /Verdict is now 'request changes'.*--clear-outcome.*--outcome/s);
  assert.equal(fs.readFileSync(p, 'utf8'), before); // record untouched
  // --clear-outcome re-derives from the new verdict (fail); a new --outcome re-decides.
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--clear-outcome']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).outcome, 'fail'); // request changes -> fail
});

test('a corrupt prior record fails closed unless --force (finding R11-#1)', () => {
  const dir = setupHumanDecisionRepo();
  const p = path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{ this is not valid json');
  // Plain, --outcome, and --clear-outcome all refuse to clobber a corrupt record.
  for (const extra of [[], ['--outcome', 'pass', '--reason', 'x'], ['--clear-outcome']]) {
    const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x', ...extra]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Refusing to overwrite an invalid evaluation record/);
    assert.equal(fs.readFileSync(p, 'utf8'), '{ this is not valid json'); // untouched
  }
  // --force overwrites it, but first preserves the corrupt file as evidence (findings R13-#4, R14-#3).
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'x', '--force']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).outcome, 'pass');
  const backups = fs.readdirSync(path.dirname(p)).filter((f) => f.startsWith('TASK-20260724-x.json.corrupt-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(p), backups[0]), 'utf8'), '{ this is not valid json');
});

test('corrupt prior + --force + build failure leaves the canonical corrupt file intact (finding R14-#3)', () => {
  const dir = setupRepo();
  const p = path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{ corrupt');
  // Remove the review scorecard so buildEvaluationRecord fails the consistency gate.
  fs.rmSync(path.join(dir, '.ai/state/reviews/TASK-20260724-x.md'), { force: true });
  const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--force']);
  assert.equal(res.status, 1);                                   // build failed
  assert.equal(fs.readFileSync(p, 'utf8'), '{ corrupt');         // canonical corrupt file untouched
  const backups = fs.readdirSync(path.dirname(p)).filter((f) => f.includes('.json.corrupt-'));
  assert.equal(backups.length, 0);                               // no premature backup
  // The report still sees the record as invalid and withholds routing (fail-closed).
  const payload = JSON.parse(run(dir, ['--report', '--json']).stdout);
  assert.equal(payload.invalid_records.length, 1);
  assert.equal(payload.routing.reason_code, 'invalid_records_present');
});

test('a record whose task_id does not match its filename fails closed (finding R12-#1)', () => {
  const dir = setupHumanDecisionRepo();
  const p = path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // A schema-valid record for a DIFFERENT task, planted under TASK-20260724-x.json.
  const foreign = {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: 'eval-TASK-20260724-y', task_id: 'TASK-20260724-y',
    generated_at: '2026-07-28T00:00:00.000Z', mode: 'compact', experiment_id: null, comparability: null, outcome: 'pass',
    outcome_source: { type: 'manual_override', scorecard: 's', verdict: 'needs human decision', decided_outcome: 'pass', reason: 'foreign', decided_by: 'Eve', decided_at: '2026-07-28T00:00:00.000Z' },
    routing_signatures: [],
    validation: { status: 'partial', evidence_count: 1, results: { pass: 0, fail: 0, skipped: 1 } },
    run_ids: [], context_artifact: null, task_journal: 'j', tier: 'standard',
    metrics: { context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, latency_ms: 0, retries: 0 } },
  };
  fs.writeFileSync(p, JSON.stringify(foreign));
  const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(res.status, 1); // must NOT preserve TASK-...-y's decision
  assert.match(res.stderr, /task_id "TASK-20260724-y" does not match/);
  assert.equal(fs.readFileSync(p, 'utf8'), JSON.stringify(foreign)); // untouched (no --force)
});

test('--clear-outcome drops the override and re-derives (finding R10-#1)', () => {
  const dir = setupHumanDecisionRepo();
  const p = path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json');
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'approved']).status, 0);
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--clear-outcome']).status, 0);
  const cleared = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(cleared.outcome, 'partial');                       // back to the derived outcome
  assert.equal(cleared.outcome_source.type, 'review_scorecard');  // override gone
});

test('--clear-outcome combined with --outcome/--reason/--by is a usage error (finding R10-#1)', () => {
  const dir = setupHumanDecisionRepo();
  const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--clear-outcome', '--outcome', 'pass', '--reason', 'x']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--clear-outcome cannot be combined with --outcome/);
});

test('--clear-outcome=<value> and a duplicated --clear-outcome are usage errors (finding R11-#5)', () => {
  const dir = setupHumanDecisionRepo();
  // A --clear-outcome=true must NOT be silently ignored (which would preserve the override).
  const withValue = run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--clear-outcome=true']);
  assert.equal(withValue.status, 1);
  assert.match(withValue.stderr, /--clear-outcome is a boolean flag/);
  // A duplicate is rejected too.
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--clear-outcome', '--clear-outcome']).status, 1);
});

test('--outcome fail is honored', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'fail', '--reason', 'rejected']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8')).outcome, 'fail');
});

for (const verdict of ['Approve', 'Request changes'] as const) {
  test(`--outcome on a ${verdict} verdict is rejected and writes nothing`, () => {
    const dir = setupRepo();
    // Overwrite the scorecard verdict (setupRepo defaults to Approve). Both clear
    // verdicts must reject the override — not just Approve.
    fs.writeFileSync(path.join(dir, '.ai/state/reviews/TASK-20260724-x.md'),
      ['- Task ID: `TASK-20260724-x`', '', '## Scorecard', '| Dimension | Rating | Notes |', '| --- | --- | --- |',
       '| Correctness | pass | ok |', '', 'Unresolved blockers: none', '', `Verdict: ${verdict}`].join('\n'));
    const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'fail', '--reason', 'x']);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /only allowed when the review Verdict is 'Needs human decision'/);
    assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
  });
}

test('--outcome without --reason, and an invalid value, are usage errors (exit 1)', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass']).status, 1);
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--reason', 'x']).status, 1);
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'maybe', '--reason', 'x']).status, 1);
});

test('the success line collapses control chars AND U+2028/U+2029 in reason/decided_by; the record keeps raw (findings R8-#3, R9-#1)', () => {
  const dir = setupHumanDecisionRepo();
  // A newline OR a Unicode line separator (U+2028) in --reason/--by must not spoof extra terminal lines.
  const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'first\nmid\u2028end', '--by', 'a\tb']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /by a b: first mid end/);            // \n, \t, U+2028 → single spaces on the terminal line
  const rec = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8'));
  assert.equal(rec.outcome_source.reason, 'first\nmid\u2028end'); // raw value preserved in the record
  assert.equal(rec.outcome_source.decided_by, 'a\tb');
});

test('a reason/--by empty once line-breakers are stripped is a usage error (finding R9-#2)', () => {
  const dir = setupHumanDecisionRepo();
  // control-only reason (avoid NUL in argv) → rejected before any write.
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', '\x01\x02']).status, 1);
  // control-only --by (a lone U+2028)
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'ok', '--by', '\u2028']).status, 1);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('the shared flag validator rejects duplicate/bare/whitespace --outcome/--reason (exit 1)', () => {
  const dir = setupHumanDecisionRepo();
  // duplicate --outcome must NOT silently resolve to the first value
  const dup = run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--outcome', 'fail', '--reason', 'x']);
  assert.equal(dup.status, 1);
  assert.match(dup.stderr, /--outcome cannot be specified more than once/);
  // duplicate --reason too
  assert.match(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'a', '--reason', 'b']).stderr, /--reason cannot be specified more than once/);
  // bare --outcome (no value / followed by another flag)
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', '--reason', 'x']).status, 1);
  // empty equals form
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome=', '--reason=x']).status, 1);
  // whitespace-only --reason
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', '   ']).status, 1);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('--outcome=pass --reason=x (equals form) is accepted', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome=pass', '--reason=approved after review']).status, 0);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8'));
  assert.equal(rec.outcome, 'pass');
  assert.equal(rec.outcome_source.reason, 'approved after review');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/evaluate-command.test.ts`
Expected: FAIL — flags ignored; override record not written; no usage errors.

- [ ] **Step 3: Add `override` to `BuildInput` and apply it in `buildEvaluationRecord`**

In `bin/lib/evaluation-record.ts`, extend `BuildInput` with a **new**-override input
and a **preserved**-source input (finding R10-#1). A new override is stamped and
scope-gated by the build; a preserved source is carried verbatim (its `decided_by`/
`decided_at`/`reason` are the snapshot from when the human decided):

```ts
  override: { outcome: 'pass' | 'fail'; reason: string; decidedBy: string } | null;
  preservedSource: Extract<EvaluationOutcomeSource, { type: 'manual_override' }> | null;
```

In `buildEvaluationRecord`, destructure it (`const { taskId, journalContent, scorecardContent, scorecardPath } = input;` already exists — add `override`/`preservedSource` where used). After the gate returns (`if (errors.length > 0) return { ok: false, errors };`), add **two** verdict checks — the new-override scope gate, and the preserved-source drift guard (finding R11-#3: a preserved override whose review has drifted to a clear verdict must not be paired with fresh validation; fail closed so the user re-runs with `--clear-outcome` or `--outcome`):

```ts
  if (input.override && verdict !== 'needs human decision') {
    return { ok: false, errors: [`--outcome override is only allowed when the review Verdict is 'Needs human decision' (got: ${verdict})`] };
  }
  if (input.preservedSource && verdict !== 'needs human decision') {
    return { ok: false, errors: [`the review Verdict is now '${verdict}', not 'Needs human decision'; the prior manual override no longer applies — re-run with --clear-outcome to accept the derived outcome, or --outcome to record a new decision`] };
  }
```

Build the `outcome_source`: a **preserved** source is used verbatim (keeping its own
`verdict`/`decided_at` snapshot — finding R10-#1); a **new** override stamps
`decided_by`/`decided_at = input.now` against the current verdict (finding R1-#3);
otherwise it is derived from the verdict (finding R7 — no `decision_history`):

```ts
  const outcomeSource: EvaluationOutcomeSource = input.preservedSource
    ? input.preservedSource
    : input.override
      ? { type: 'manual_override', scorecard: scorecardPath, verdict,
          decided_outcome: input.override.outcome, reason: input.override.reason,
          decided_by: input.override.decidedBy, decided_at: input.now }
      : { type: 'review_scorecard', scorecard: scorecardPath, verdict };
```

Derive the structured `routing_signatures` from the record's runs (findings R11-#2,
R13-#1) — deduped and sorted deterministically (provider then model), independent of
whether a context artifact exists:

```ts
  const seen = new Set<string>();
  const routingSignatures: RoutingSignature[] = [];
  for (const r of input.runs) {
    // finding R16-#1: skip a run with an empty/whitespace provider or model — the
    // validator requires trimmed-non-empty, so this backstop guarantees the writer
    // never emits a routing_signatures entry the reader would reject (even if a bad run
    // slipped past run-record validation). Runs are pre-validated by listRunRecords, so
    // this normally never fires.
    if (r.provider.trim().length === 0 || r.model.trim().length === 0) continue;
    const key = JSON.stringify([r.provider, r.model]); // delimiter-free dedup key (finding R14-#1)
    if (!seen.has(key)) { seen.add(key); routingSignatures.push({ provider: r.provider, model: r.model }); }
  }
  routingSignatures.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
```

Then set `outcome` / `outcome_source` / `routing_signatures` in the record literal
(`~309-310`) — a preserved source's `decided_outcome` takes precedence, then a new
override, else the derived outcome:

```ts
    outcome: input.preservedSource ? input.preservedSource.decided_outcome
           : input.override ? input.override.outcome
           : VERDICT_TO_OUTCOME[verdict],
    outcome_source: outcomeSource,
    routing_signatures: routingSignatures,
```

(The existing `comparability.routing_signature` string — `~line 327`, used only for
experiment-pair equality, never parsed — is left unchanged; it and the structured
field are derived from the same runs but serve different purposes.)

- [ ] **Step 4: Register the flags centrally, document them, and parse them in `runEvaluate`**

First, register both flags in the shared eager validator. It validates both the
spaced and equals forms — accepting a valid value (`--outcome pass` or
`--outcome=pass`) and rejecting duplicates, bare flags, empty (`--outcome=`), or
whitespace-only/`--`-prefixed values at load (exit 1).
In `bin/lib/context.ts`, extend the eager-validation flag list (`~line 45`):

```ts
for (const name of ['--profile', '--emit', '--adapter', '--model', '--task', '--mode', '--experiment', '--min-samples', '--outcome', '--reason', '--by'] as const) {
```

(`--clear-outcome` is a boolean flag — do **not** add it to the value-flag list; it
is read in `runEvaluate` via `args.has('--clear-outcome')`.)

`--clear-outcome` still needs its own **boolean-flag validation** (finding R11-#5),
because `args.has('--clear-outcome')` matches only a bare token — `--clear-outcome=true`
would look absent (silently preserving the override) and a duplicate would go
unnoticed. In `bin/lib/context.ts`, after the value-flag loop, add an eager check
over `rawArgs` (which `context.ts` already exposes):

```ts
// boolean flags carry no value and must appear at most once, never as --flag=...
for (const name of ['--clear-outcome'] as const) {
  const bare = rawArgs.filter((a) => a === name).length;
  const withValue = rawArgs.some((a) => a.startsWith(`${name}=`));
  if (withValue || bare > 1) {
    process.stderr.write(`Error: ${name} is a boolean flag; pass it at most once with no value.\n`);
    process.exit(1);
  }
}
```

Document them in the `--evaluate` help text in `bin/lib/init.ts` (`~line 93`):

```
  --evaluate --task <id> [--outcome pass|fail --reason "<text>" [--by "<name>"]]
             [--clear-outcome] [--force]
                Build a structured evaluation record for a task from its review
                scorecard, journal, run records, and context artifact. For a
                "Needs human decision" verdict, --outcome pass|fail (with a
                required --reason, and optional --by naming the decider) records a
                human override with provenance. Re-evaluating without override flags
                PRESERVES an existing override while its verdict is still
                "Needs human decision" (refreshing metrics only); if the verdict has
                changed, or the prior record is corrupt, it exits 1 — use
                --clear-outcome to re-derive, --outcome to re-decide, or --force to
                overwrite a corrupt record. Do not run --evaluate on one task
                concurrently (last-writer-wins; no locking).
```

Then in `runEvaluate`, after the `isValidTaskId(taskId)` check (`~383`), parse
the two checks the shared layer cannot know — the flags must appear together, and
`--outcome` must be `pass`|`fail` (usage error → **exit 1**, matching the missing
`--task` error above):

Define a module-level `LINE_BREAKERS` regex once (shared by this check and the
success-line renderer): C0/C1 controls plus the Unicode line separators
U+2028/U+2029 (finding R9-#1):

```ts
// eslint-disable-next-line no-control-regex
const LINE_BREAKERS = /[\x00-\x1F\x7F-\x9F\u2028\u2029]+/g;
```

```ts
  const outcomeArg = getArgValue('--outcome');
  const reasonArg = getArgValue('--reason');
  const clearOutcome = args.has('--clear-outcome');
  const byArg = getArgValue('--by');

  // --clear-outcome resets; it cannot also set an override (finding R10-#1).
  if (clearOutcome && (outcomeArg !== null || reasonArg !== null || byArg !== null)) {
    process.stderr.write("Usage: --clear-outcome cannot be combined with --outcome, --reason, or --by.\n");
    process.exitCode = 1;
    return;
  }
  // --by without an override is almost certainly a mistake (missing --outcome/--reason);
  // silently ignoring it would make the user think provenance was recorded (finding R2-#3).
  if (byArg !== null && outcomeArg === null && reasonArg === null) {
    process.stderr.write("Usage: --by is only valid with --outcome and --reason.\n");
    process.exitCode = 1;
    return;
  }

  let override: { outcome: 'pass' | 'fail'; reason: string; decidedBy: string } | null = null;
  if (outcomeArg !== null || reasonArg !== null) {
    if (outcomeArg === null || reasonArg === null || (outcomeArg !== 'pass' && outcomeArg !== 'fail')) {
      process.stderr.write("Usage: --outcome pass|fail and --reason \"<text>\" must be given together.\n");
      process.exitCode = 1;
      return;
    }
    // decided_by (finding R2-#3): --by, else git user.name, else $USER/$USERNAME, else 'unknown'.
    override = { outcome: outcomeArg, reason: reasonArg, decidedBy: resolveDecidedBy(byArg) };
    // Reject a reason/--by that is empty once line-breakers are stripped (finding
    // R9-#2): the shared validator only rejects whitespace-only values, so e.g.
    // "\0" would pass yet render as blank provenance. Validate the *displayable*
    // form so we never write a record whose provenance shows empty.
    if (override.reason.replace(LINE_BREAKERS, '').trim() === '' || override.decidedBy.replace(LINE_BREAKERS, '').trim() === '') {
      process.stderr.write("Usage: --reason and --by must contain at least one printable character.\n");
      process.exitCode = 1;
      return;
    }
  }

  // Status-aware prior read (finding R11-#1): an *invalid* (corrupt/tampered) prior
  // may still hold a human decision, so refuse to overwrite it unless --force. A
  // missing prior is fine; a valid manual_override is preserved (finding R10-#1)
  // unless --outcome (new) or --clear-outcome (re-derive) is given.
  const priorStatus = readEvaluationRecordStatus(taskId, root);
  // finding R13-#4/R14-#3: a corrupt prior fails closed unless --force. Do NOT move the
  // file yet — if the build fails later (bad journal/scorecard), the corrupt file must
  // stay on the canonical path so the report still flags it and routing stays withheld.
  // Just remember to back it up right before the atomic write, once the build succeeds.
  const forceOverwriteInvalid = priorStatus.status === 'invalid';
  if (forceOverwriteInvalid && !force) {
    process.stderr.write(`Refusing to overwrite an invalid evaluation record for ${taskId} (${priorStatus.reason}). Re-run with --force to overwrite.\n`);
    process.exitCode = 1;
    return;
  }
  let preservedSource: Extract<EvaluationOutcomeSource, { type: 'manual_override' }> | null = null;
  if (override === null && !clearOutcome && priorStatus.status === 'valid'
      && priorStatus.record.outcome_source.type === 'manual_override') {
    preservedSource = priorStatus.record.outcome_source;
  }
```

`readEvaluationRecordStatus` re-introduces the status-aware read dropped in R7 (the
existing `readEvaluationRecord` collapses missing and corrupt to `null`). Add it near
`readEvaluationRecord`:

```ts
export type EvaluationRecordReadStatus =
  | { status: 'missing' }
  | { status: 'valid'; record: EvaluationRecord }
  | { status: 'invalid'; reason: string };

export function readEvaluationRecordStatus(taskId: string, repositoryRoot: string): EvaluationRecordReadStatus {
  if (!isValidTaskId(taskId)) return { status: 'invalid', reason: 'invalid task id' };
  const filePath = path.join(evaluationDir(repositoryRoot), `${taskId}.json`);
  if (!fs.existsSync(filePath)) return { status: 'missing' };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { status: 'invalid', reason: `not valid JSON: ${String(err)}` };
  }
  if (!isValidEvaluationRecord(raw)) return { status: 'invalid', reason: 'does not match the evaluation record schema' };
  // isValidEvaluationRecord narrows `raw` to EvaluationRecordWire (finding R13-#2).
  const wire = raw; // : EvaluationRecordWire
  // finding R12-#1: the file is read by path (`${taskId}.json`), but its *contents*
  // must belong to that task — else a record for TASK-B sitting in TASK-A.json would
  // let `--evaluate TASK-A` preserve TASK-B's decision. (The validator already ties
  // evaluation_id === `eval-${task_id}`, so this also guarantees the evaluation_id.)
  if (wire.task_id !== taskId) {
    return { status: 'invalid', reason: `record task_id "${String(wire.task_id)}" does not match requested task ${taskId}` };
  }
  // normalize wire -> full EvaluationRecord (routing_signatures defaults to []).
  return { status: 'valid', record: { ...wire, mode: wire.mode ?? 'compact', experiment_id: wire.experiment_id ?? null, comparability: wire.comparability ?? null, routing_signatures: wire.routing_signatures ?? [] } };
}
```

(`readEvaluationRecord` can delegate to this — `return status.status === 'valid' ? status.record : null` — so the two never diverge; existing callers reading by the correct filename are unaffected, since a correctly-written record's `task_id` matches its filename.)

`resolveDecidedBy` is a small helper near `runEvaluate` (whitespace-only values
are already rejected by the shared validator when the flag is present, so the
fallbacks handle only the *absent* case):

```ts
function resolveDecidedBy(byArg: string | null): string {
  if (byArg !== null) return byArg;
  try {
    const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim();
    if (name) return name;
  } catch { /* git may be absent or unconfigured */ }
  // Env fallbacks, trimmed and tested *in turn* (finding R10-#6): a whitespace-only
  // $USER must not shadow a set $USERNAME. `??`/`||` on the joined value would pick
  // the first non-null, not the first non-blank — so filter each candidate.
  for (const candidate of [process.env.USER, process.env.USERNAME]) {
    const trimmed = (candidate ?? '').trim();
    if (trimmed) return trimmed;
  }
  return 'unknown';
}
```

(The `reasonArg.trim() === ''` case is already rejected by the shared validator,
so it is not repeated here.)

Then add `override` and `preservedSource` to the `buildEvaluationRecord({ … })` call
(`now` stamps a *new* override's `decided_at`; a preserved source keeps its own):

```ts
    runs, artifact, artifactPath, expansionCount: lookup.expansionCount, escapeCount, tiers, override, preservedSource, now: new Date().toISOString(),
```

**Write (findings R7 + R10 + R11 + R14-#3 — keyed upsert, decision preserved & hardened).**
The build runs first; on failure (`if (!result.ok)`), print the errors and exit **without
touching the file** — so a corrupt prior stays on the canonical path and the report keeps
flagging it. Only after a **successful** build, and only when overwriting an invalid prior
under `--force`, back up the corrupt file **immediately before** the atomic write — copy
(not rename) so the canonical path is never briefly missing, and use `COPYFILE_EXCL` so a
same-millisecond backup can't be clobbered:

```ts
  // ... build succeeded (result.ok) ...
  if (forceOverwriteInvalid) {  // finding R14-#3: back up only now, just before the write
    const badPath = path.join(evaluationDir(root), `${taskId}.json`);
    fs.copyFileSync(badPath, `${badPath}.corrupt-${Date.now()}`, fs.constants.COPYFILE_EXCL);
    process.stderr.write(`${formatStatus('warn', `preserved invalid record as ${taskId}.json.corrupt-<ts> before overwriting`)}\n`);
  }
  writeEvaluationRecord(result.record, root); // existing temp-file + rename overwrites the canonical path
```

`--evaluate` writes with the existing `writeEvaluationRecord` (unchanged temp-file +
rename). The prior record is read once (above) to fail closed on a corrupt record
(R11-#1) and to carry a valid human override forward (R10-#1); the build then fails
closed if that override's verdict has drifted (R11-#3). There is still no append-only
history and no per-task lock — **concurrent `--evaluate` on the same task is
unsupported** (last-writer-wins, and preservation can resurrect a just-cleared
override — finding R11-#6), stated in the help text.

- [ ] **Step 5: Update the success line**

Replace the success `console.log` (`~486`) with a source-aware message. The
user-supplied `decided_by`/`reason` are interpolated into the terminal line, and
the shared validator only checks non-empty — so a newline or control character
could spoof extra log lines (finding R7-#3b). Sanitize **for terminal render
only** (collapse `\r`, `\n`, and other C0/C1 control chars to a single space); the
**raw** value is still stored in the JSON record, so audit fidelity is preserved:

Use the shared `LINE_BREAKERS` regex from Step 4 (C0/C1 controls **plus** the
Unicode line separators U+2028/U+2029 — finding R9-#1, else those still break the
terminal line):

```ts
  // display-only: keep line-breaking chars out of the terminal line; the record keeps raw.
  const oneLine = (s: string) => s.replace(LINE_BREAKERS, ' ').trim();
  const src = result.record.outcome_source;
  const detail = src.type === 'manual_override'
    ? `manual override of "needs human decision" by ${oneLine(src.decided_by)}: ${oneLine(src.reason)}`
    : `verdict: ${src.verdict}`;
  console.log(formatStatus('ok', `${taskId} → ${result.record.outcome} (${detail}, ${runs.length} run${runs.length === 1 ? '' : 's'})`));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/evaluate-command.test.ts`
Expected: PASS. If any existing `buildEvaluationRecord` caller/test lacks the new fields, set `override: null` **and** `preservedSource: null` there (e.g. `test/evaluation-record.test.ts` `baseInput()`).

- [ ] **Step 7: Commit**

```bash
git add bin/lib/context.ts bin/lib/init.ts bin/lib/evaluation-record.ts test/
git commit -m "feat(eval): add --outcome/--reason human override for needs-human-decision"
```

---

### Task 3: `recommendRouting` pure function

**Files:**
- Modify: `bin/lib/evaluation-report.ts` (collect per-tier `signatures` in `aggregateEvaluations`; export `Aggregate`; add routing types + `recommendRouting`, near the 13B constants `~28-33`)
- Test: `test/evaluation-report.test.ts`

**Interfaces:**
- Consumes: `Aggregate` (existing type in `evaluation-report.ts`), `MAX_PASS_RATE_DROP_PCT`.
- Produces:
  - `TierAgg` gains `signatures?: RoutingSignature[]` — the distinct `{provider, model}` pairs seen for that tier, taken from each record's structured `routing_signatures` (findings R10-#3, R11-#2, R13-#1); `aggregateEvaluations` unions them (a record with an empty `routing_signatures` contributes none).
  - `export type Aggregate` (was file-private).
  - `type TierRouting = { tier: string; count: number; pass_rate: number; mean_tokens_per_eval: number; routing_signatures: RoutingSignature[]; excluded_reason: string | null; excluded_reason_code: 'missing_signature' | 'mixed_signatures' | 'insufficient_samples' | null }` (findings R10-#3, R13-#1/#5).
  - `type RoutingRecommendation = { recommended_tier: string | null; best_tier: string | null; withheld: boolean; reason: string | null; reason_code: 'insufficient_eligible_tiers' | null; eligible_tiers: number; required_tiers: number; min_samples: number; heuristic: true; caveat: string; tiers: TierRouting[] }` (findings #4, R10-#5, R12-#4).
  - `const MIN_TIER_SAMPLES = 20` — its **own** default, no longer aliasing `MIN_EXPERIMENT_PAIRS` (finding R10-#5).
  - `const ROUTING_CAVEAT` — the human-readable heuristic caveat string (findings #4, R10-#3/#4).
  - `recommendRouting(aggregate: Aggregate, minSamples: number): RoutingRecommendation`.

- [ ] **Step 1: Write the failing test**

Because routing now requires **exactly one** signature per tier (findings R11-#2,
R13-#1), the shared `rec(tier, outcome, input)` helper must stamp a per-tier structured
signature so a tier is eligible by default. Update it (`~line 20`) to include
`routing_signatures: [{ provider: 'anthropic', model: tier }]`, giving each tier a
single distinct signature. (Records that should be *missing* a signature set
`routing_signatures: []`.)

Add to `test/evaluation-report.test.ts` (reuses the updated `rec(...)` helper and `aggregateEvaluations`):

```ts
test('recommendRouting picks the lowest-token tier holding pass rate within tolerance', async () => {
  const { aggregateEvaluations, recommendRouting } = await import('../bin/lib/evaluation-report.js');
  // premium: 5 evals all pass (100%, mean tokens ~ (5000+10)); standard: 5 evals, 5/5 pass, fewer tokens.
  const recs = [
    ...Array.from({ length: 5 }, () => rec('premium', 'pass', 5000)),
    ...Array.from({ length: 5 }, () => rec('standard', 'pass', 3000)),
  ];
  const r = recommendRouting(aggregateEvaluations(recs), 5);   // explicit minSamples overrides the 20 default
  assert.equal(r.withheld, false);
  assert.equal(r.reason, null);
  assert.equal(r.eligible_tiers, 2);
  assert.equal(r.best_tier, 'premium');           // ties on pass rate -> tier-name order, premium < standard
  assert.equal(r.recommended_tier, 'standard');   // both 100%, standard has fewer tokens/eval
  // finding #4: always labelled a heuristic, with a non-empty caveat.
  assert.equal(r.heuristic, true);
  assert.ok(r.caveat.length > 0);
});

test('recommendRouting keeps the better tier when the lower-token one drops pass rate past tolerance', async () => {
  const { aggregateEvaluations, recommendRouting } = await import('../bin/lib/evaluation-report.js');
  const recs = [
    ...Array.from({ length: 5 }, () => rec('premium', 'pass', 5000)),
    // standard: 5 evals, 3 pass / 2 fail => 60%, far below 100% - 5
    ...Array.from({ length: 3 }, () => rec('standard', 'pass', 1000)),
    ...Array.from({ length: 2 }, () => rec('standard', 'fail', 1000)),
  ];
  const r = recommendRouting(aggregateEvaluations(recs), 5);
  assert.equal(r.recommended_tier, 'premium');
});

test('recommendRouting withholds — with a reason and eligible count — below two eligible tiers or samples', async () => {
  const { aggregateEvaluations, recommendRouting } = await import('../bin/lib/evaluation-report.js');
  const one = recommendRouting(aggregateEvaluations(Array.from({ length: 5 }, () => rec('only', 'pass', 100))), 5);
  assert.equal(one.withheld, true);
  assert.ok(one.reason && one.reason.length > 0);          // display message
  assert.equal(one.reason_code, 'insufficient_eligible_tiers'); // finding R12-#4: stable code
  assert.equal(one.eligible_tiers, 1);
  assert.equal(one.required_tiers, 2);
  // two tiers but below min samples
  const few = [rec('a', 'pass', 100), rec('b', 'pass', 100)];
  assert.equal(recommendRouting(aggregateEvaluations(few), 5).withheld, true);
  // 'unknown' tier is excluded
  const withUnknown = [...Array.from({ length: 5 }, () => rec('unknown', 'pass', 100)), ...Array.from({ length: 5 }, () => rec('a', 'pass', 100))];
  assert.equal(recommendRouting(aggregateEvaluations(withUnknown), 5).withheld, true);
});

test('recommendRouting uses MIN_TIER_SAMPLES = 20 by default (finding R10-#5)', async () => {
  const { aggregateEvaluations, recommendRouting, MIN_TIER_SAMPLES } = await import('../bin/lib/evaluation-report.js');
  assert.equal(MIN_TIER_SAMPLES, 20);
  // two tiers of 5 each: withheld under the default 20, allowed under an explicit 5.
  const recs = [...Array.from({ length: 5 }, () => rec('premium', 'pass', 5000)), ...Array.from({ length: 5 }, () => rec('standard', 'pass', 3000))];
  assert.equal(recommendRouting(aggregateEvaluations(recs), MIN_TIER_SAMPLES).withheld, true);
  assert.equal(recommendRouting(aggregateEvaluations(recs), 5).withheld, false);
});

test('recommendRouting excludes a tier that mixes routing signatures (findings R10-#3, R11-#2, R13-#1)', async () => {
  const { aggregateEvaluations, recommendRouting } = await import('../bin/lib/evaluation-report.js');
  // standard's records span two structured routing_signatures (tier remapped A->B) => excluded.
  const withSig = (tier: string, sigs: { provider: string; model: string }[], input: number) =>
    ({ ...rec(tier, 'pass', input), routing_signatures: sigs } as EvaluationRecord);
  const recs = [
    ...Array.from({ length: 5 }, () => withSig('premium', [{ provider: 'anthropic', model: 'opus' }], 5000)),
    ...Array.from({ length: 3 }, () => withSig('standard', [{ provider: 'anthropic', model: 'sonnet' }], 3000)),
    // model id containing '/' and ',' — structured storage handles it; a string join would not.
    ...Array.from({ length: 2 }, () => withSig('standard', [{ provider: 'openrouter', model: 'meta-llama/llama-3.1,exp' }], 3000)),
  ];
  const r = recommendRouting(aggregateEvaluations(recs), 5);
  const standard = r.tiers.find((t) => t.tier === 'standard')!;
  assert.equal(standard.excluded_reason_code, 'mixed_signatures'); // finding R13-#5
  assert.ok(standard.excluded_reason && /mixed routing signatures/.test(standard.excluded_reason));
  assert.equal(r.eligible_tiers, 1);   // only premium remains eligible -> fewer than 2 -> withheld
  assert.equal(r.withheld, true);
});

test('recommendRouting excludes a tier with no routing signature (findings R11-#2, R13-#5)', async () => {
  const { aggregateEvaluations, recommendRouting } = await import('../bin/lib/evaluation-report.js');
  const withSig = (tier: string, sigs: { provider: string; model: string }[], input: number) =>
    ({ ...rec(tier, 'pass', input), routing_signatures: sigs } as EvaluationRecord);
  // standard has records but no signatures (e.g. no runs) => excluded 'missing', not trusted.
  const recs = [
    ...Array.from({ length: 5 }, () => withSig('premium', [{ provider: 'anthropic', model: 'opus' }], 5000)),
    ...Array.from({ length: 5 }, () => withSig('standard', [], 1000)),
  ];
  const r = recommendRouting(aggregateEvaluations(recs), 5);
  const standard = r.tiers.find((t) => t.tier === 'standard')!;
  assert.equal(standard.excluded_reason_code, 'missing_signature');
  assert.equal(standard.excluded_reason, 'missing routing signature');
  assert.equal(r.eligible_tiers, 1);
  assert.equal(r.withheld, true);
});

// Build an Aggregate directly so pass rates and token costs can be set exactly —
// this exercises the raw-value tolerance boundary and the token tie-break, which
// records built from whole evals cannot express precisely. `signatures` defaults to a
// single per-tier signature so tiers are eligible unless a test overrides it.
function aggOf(tiers: Record<string, { count: number; pass: number; input: number; signatures?: { provider: string; model: string }[] }>) {
  const byTier: Record<string, { count: number; pass: number; partial: number; fail: number; input_tokens: number; output_tokens: number; latency_ms: number; retries: number; signatures?: { provider: string; model: string }[] }> = {};
  for (const [t, v] of Object.entries(tiers)) {
    byTier[t] = { count: v.count, pass: v.pass, partial: 0, fail: v.count - v.pass, input_tokens: v.input, output_tokens: 0, latency_ms: 0, retries: 0, signatures: v.signatures ?? [{ provider: 'anthropic', model: t }] };
  }
  return { total: 0, outcomes: { pass: 0, partial: 0, fail: 0 }, byTier };
}

test('recommendRouting compares RAW pass rates at the 5-point tolerance boundary', async () => {
  const { recommendRouting } = await import('../bin/lib/evaluation-report.js');
  // exactly 5.0 drop (best 100%, low-token 95% = 19/20): still eligible and fewer tokens -> recommended
  const exact = recommendRouting(aggOf({ premium: { count: 20, pass: 20, input: 5000 }, standard: { count: 20, pass: 19, input: 1000 } }), 5);
  assert.equal(exact.recommended_tier, 'standard');
  // raw drop 5.04 (low-token 94.96% = 9496/10000) that rounds to 5.0 -> EXCLUDED -> premium.
  // A buggy impl that rounds pass rate to 95.0 before comparing would wrongly recommend standard.
  const justOver = recommendRouting(aggOf({ premium: { count: 10000, pass: 10000, input: 5000 }, standard: { count: 10000, pass: 9496, input: 1000 } }), 5);
  assert.equal(justOver.recommended_tier, 'premium');
});

test('recommendRouting breaks a mean-token tie by tier name ascending', async () => {
  const { recommendRouting } = await import('../bin/lib/evaluation-report.js');
  // both 100% pass and identical mean tokens (200/eval) -> the name-first tier wins
  const r = recommendRouting(aggOf({ bbb: { count: 5, pass: 5, input: 1000 }, aaa: { count: 5, pass: 5, input: 1000 } }), 5);
  assert.equal(r.recommended_tier, 'aaa');
  assert.equal(r.best_tier, 'aaa');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/evaluation-report.test.ts`
Expected: FAIL — `recommendRouting` is not exported.

- [ ] **Step 3: Collect signatures, export `Aggregate`, and implement `recommendRouting`**

First, teach `aggregateEvaluations` to collect the distinct `{provider, model}` pairs
per tier (findings R10-#3, R11-#2, R13-#1), from each record's structured
**`routing_signatures`** (always derived from runs, so drift is caught even without a
context artifact). Add `signatures?: RoutingSignature[]` to `TierAgg` (`~line 6`) and,
in the loop body (`~line 19`), union each record's pairs (a single record may span more
than one via retries):

```ts
  // findings R10-#3/R11-#2/R13-#1: track distinct {provider, model} pairs per tier so a
  // tier remapped across models is excluded (mixed) and a tier with no signature is
  // excluded (missing) rather than blended/trusted. An empty routing_signatures adds none.
  for (const s of r.routing_signatures) {
    tier.signatures ??= [];
    if (!tier.signatures.some((x) => x.provider === s.provider && x.model === s.model)) {
      tier.signatures.push(s);
    }
  }
```

Change `type Aggregate = …` (`~line 7`) to `export type Aggregate = …`. Then, after
the 13B constants (`~line 33`), add:

```ts
// finding R10-#5: routing needs a stronger gate than the 5-pair experiment default —
// at 5 evals a pass rate moves in 20-pt steps, degenerate against a 5-pt tolerance.
export const MIN_TIER_SAMPLES = 20;

// findings #4 + R10-#3/#4: the pick is the lowest-*token* tier (not cost), gated on
// per-tier eval COUNT only; it does not control for task difficulty/class. A tier with
// mixed or missing routing signatures is excluded (R11-#2), not merely caveated.
export const ROUTING_CAVEAT =
  'Lowest-token tier (token count, not cost); gated on per-tier eval count only; does not control for task difficulty or task class.';

export type TierExclusionCode = 'missing_signature' | 'mixed_signatures' | 'insufficient_samples';
export type TierRouting = { tier: string; count: number; pass_rate: number; mean_tokens_per_eval: number; routing_signatures: RoutingSignature[]; excluded_reason: string | null; excluded_reason_code: TierExclusionCode | null };
export type RoutingWithholdCode = 'insufficient_eligible_tiers' | 'invalid_records_present';
export type RoutingRecommendation = {
  recommended_tier: string | null;
  best_tier: string | null;
  withheld: boolean;
  reason: string | null;               // human-readable message (display)
  reason_code: RoutingWithholdCode | null; // stable machine code (finding R12-#4)
  eligible_tiers: number;
  required_tiers: number;              // always 2 (finding R12-#4)
  min_samples: number;
  heuristic: true;
  caveat: string;
  tiers: TierRouting[];
};

export function recommendRouting(aggregate: Aggregate, minSamples: number): RoutingRecommendation {
  // Build every non-'unknown' tier, marking why any is not a routing candidate.
  // Sorted by name so best/recommended tie-breaks are deterministic.
  const tiers: TierRouting[] = Object.entries(aggregate.byTier)
    .filter(([tier]) => tier !== 'unknown')
    .map(([tier, t]) => {
      const signatures = [...(t.signatures ?? [])].sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
      // findings R10-#3/R11-#2/R13-#1: exactly one signature is required. >1 blends
      // models (mixed); 0 means the tier can't be attributed to a model (missing) —
      // neither is trusted. Sample-count exclusion is checked last. Each exclusion
      // carries a stable `excluded_reason_code` beside the human message (R13-#5).
      const fmt = (s: RoutingSignature) => `${s.provider}/${s.model}`;
      let excluded_reason: string | null = null;
      let excluded_reason_code: TierExclusionCode | null = null;
      if (signatures.length > 1) { excluded_reason_code = 'mixed_signatures'; excluded_reason = `mixed routing signatures: ${signatures.map(fmt).join(', ')}`; }
      else if (signatures.length === 0) { excluded_reason_code = 'missing_signature'; excluded_reason = 'missing routing signature'; }
      else if (t.count < minSamples) { excluded_reason_code = 'insufficient_samples'; excluded_reason = `only ${t.count} evals (< ${minSamples})`; }
      return {
        tier, count: t.count,
        pass_rate: (t.pass / t.count) * 100,
        mean_tokens_per_eval: (t.input_tokens + t.output_tokens) / t.count,
        routing_signatures: signatures,
        excluded_reason,
        excluded_reason_code,
      };
    })
    .sort((a, b) => a.tier.localeCompare(b.tier));

  const eligible = tiers.filter((t) => t.excluded_reason === null);
  // finding R12-#4: `reason` is the display message; `reason_code`/`required_tiers`
  // are the stable machine-readable contract for automation.
  const REQUIRED_TIERS = 2;
  const base = { min_samples: minSamples, heuristic: true as const, caveat: ROUTING_CAVEAT, tiers, eligible_tiers: eligible.length, required_tiers: REQUIRED_TIERS };
  if (eligible.length < REQUIRED_TIERS) {
    return { recommended_tier: null, best_tier: null, withheld: true, reason_code: 'insufficient_eligible_tiers', reason: `fewer than ${REQUIRED_TIERS} eligible tiers with >= ${minSamples} evaluations (${eligible.length} eligible)`, ...base };
  }
  const best = eligible.reduce((m, t) => (t.pass_rate > m.pass_rate ? t : m));
  const candidates = eligible.filter((t) => t.pass_rate >= best.pass_rate - MAX_PASS_RATE_DROP_PCT);
  const recommended = candidates.reduce((m, t) => (t.mean_tokens_per_eval < m.mean_tokens_per_eval ? t : m));
  return { recommended_tier: recommended.tier, best_tier: best.tier, withheld: false, reason: null, reason_code: null, ...base };
}
```

(Note: `tiers` now lists *all* non-unknown tiers with a per-tier `excluded_reason`,
so the `--json` payload can show why a tier was dropped; only `eligible` tiers feed
the recommendation.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/evaluation-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bin/lib/evaluation-report.ts test/evaluation-report.test.ts
git commit -m "feat(report): add recommendRouting lowest-token-tier advisory"
```

---

### Task 4: Routing section in `--report` (terminal + `--json`)

**Files:**
- Modify: `bin/lib/evaluation-record.ts` — total-validator `generated_at` guard (R15-#1); add `listEvaluationRecordsDetailed` (valid records + `invalid: {file, reason_code}[]`, `reason_code` incl. `read_error`; catches `readdirSync`, separates read from parse, sorts output) — findings R13-#3, R15-#3
- Modify: `bin/lib/evaluation-report.ts` (`runReport`: use the detailed listing; `--json` payload `~192-207` gains `routing` + `invalid_records`; withhold routing on any invalid record; terminal invalid warning + Experiments tail `~229-255`)
- Test: `test/evaluation-report.test.ts` (routing JSON/terminal, invalid_records), `test/evaluate-command.test.ts` (override→routing E2E)

**Interfaces:**
- Consumes: `recommendRouting`, `RoutingRecommendation` (Task 3); `listEvaluationRecordsDetailed` (this task).
- Produces: `--report --json` payload gains a `routing` object and an `invalid_records` array; terminal gains an invalid-records warning and a `Routing` section that prints regardless of whether experiments exist; routing is withheld (`invalid_records_present`) when any record is invalid.

- [ ] **Step 1: Write the failing CLI test**

Add to `test/evaluation-report.test.ts` (there is an existing CLI-style test in this file using `runTs`; follow it — write evaluation records to `.ai/state/evaluations/` and a `model-routing.yaml`, then run `--report`). Minimal version asserting JSON `routing`:

```ts
test('--report --json includes a routing recommendation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-routing-'));
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  const write = (id: string, tier: string, outcome: string, input: number) =>
    fs.writeFileSync(path.join(evalDir, `${id}.json`), JSON.stringify({
      ...rec(tier, outcome as never, input), task_id: id, evaluation_id: `eval-${id}`,
    }));
  // 5 premium (pass, 5000) + 5 standard (pass, 3000); --min-samples 5 overrides the
  // MIN_TIER_SAMPLES=20 default so 5-eval tiers are eligible (finding R10-#5).
  for (let i = 0; i < 5; i += 1) write(`TASK-20260728-p${i}`, 'premium', 'pass', 5000);
  for (let i = 0; i < 5; i += 1) write(`TASK-20260728-s${i}`, 'standard', 'pass', 3000);
  const out = runTs(cli, ['--report', '--json', '--min-samples', '5'], { cwd: dir });
  const payload = JSON.parse(out);
  assert.equal(payload.routing.withheld, false);
  assert.equal(payload.routing.reason, null);            // finding R10-#5
  assert.equal(payload.routing.reason_code, null);       // finding R12-#4
  assert.equal(payload.routing.eligible_tiers, 2);       // finding R10-#5
  assert.equal(payload.routing.required_tiers, 2);       // finding R12-#4
  assert.equal(payload.routing.min_samples, 5);
  assert.equal(payload.routing.recommended_tier, 'standard');
  assert.equal(payload.routing.best_tier, 'premium');
  assert.equal(payload.routing.tiers.length, 2);
  assert.equal(payload.routing.tiers[0].excluded_reason, null);       // finding R10-#3 field present
  assert.equal(payload.routing.tiers[0].excluded_reason_code, null);  // finding R13-#5 field present
  assert.deepEqual(payload.routing.tiers[0].routing_signatures, [{ provider: 'anthropic', model: 'premium' }]); // finding R13-#1 structured
  assert.deepEqual(payload.invalid_records, []);          // finding R13-#3: present, empty here
  assert.equal(payload.routing.heuristic, true);         // finding #4
  assert.ok(payload.routing.caveat.length > 0);          // finding #4
});

test('--report surfaces invalid records and withholds routing (finding R13-#3)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-routing-invalid-'));
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  const write = (id: string, tier: string, input: number) =>
    fs.writeFileSync(path.join(evalDir, `${id}.json`), JSON.stringify({ ...rec(tier, 'pass', input), task_id: id, evaluation_id: `eval-${id}` }));
  for (let i = 0; i < 5; i += 1) write(`TASK-20260728-p${i}`, 'premium', 5000);
  for (let i = 0; i < 5; i += 1) write(`TASK-20260728-s${i}`, 'standard', 3000);
  // A corrupt file: routing must fail closed and the file must be listed.
  fs.writeFileSync(path.join(evalDir, 'TASK-20260728-bad.json'), '{ not valid');
  const payload = JSON.parse(runTs(cli, ['--report', '--json', '--min-samples', '5'], { cwd: dir }));
  assert.equal(payload.invalid_records.length, 1);
  assert.equal(payload.invalid_records[0].file, 'TASK-20260728-bad.json');
  assert.ok(payload.invalid_records[0].reason_code);          // e.g. 'invalid_json' | 'invalid_schema'
  assert.equal(payload.routing.withheld, true);               // fail closed
  assert.equal(payload.routing.reason_code, 'invalid_records_present');
  // terminal warning
  const human = runTs(cli, ['--report', '--min-samples', '5'], { cwd: dir });
  assert.match(human, /1 invalid evaluation record/);
});

test('--report with ONLY invalid records still warns and withholds (findings R14-#4, R15-#2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-routing-invalidonly-'));
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  fs.writeFileSync(path.join(evalDir, 'TASK-20260728-bad.json'), '{ not valid'); // 0 valid, 1 invalid
  // Must NOT short-circuit to "no evaluation records" — the invalid file must surface.
  const payload = JSON.parse(runTs(cli, ['--report', '--json'], { cwd: dir }));
  assert.equal(payload.invalid_records.length, 1);
  assert.equal(payload.routing.withheld, true);
  assert.equal(payload.routing.reason_code, 'invalid_records_present');
  // finding R15-#2: the JSON is the general payload — full schema, not a reduced one.
  assert.ok(payload.experiments);      // present even with 0 valid records
  assert.ok(payload.recommendation);   // present
  assert.ok('byTier' in payload);
  const human = runTs(cli, ['--report'], { cwd: dir });
  assert.doesNotMatch(human, /no evaluation records/);
  assert.match(human, /1 invalid evaluation record/);
});

test('--report does not crash on a record with a bad timestamp; lists it invalid_schema (finding R15-#1)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-badts-'));
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  // Parses as JSON but `new Date('invalid').toISOString()` would throw — the total
  // validator must reject it as invalid_schema rather than crash --report.
  fs.writeFileSync(path.join(evalDir, 'TASK-20260728-x.json'), JSON.stringify({ ...rec('standard', 'pass', 100), task_id: 'TASK-20260728-x', evaluation_id: 'eval-TASK-20260728-x', generated_at: 'invalid' }));
  const res = runTs(cli, ['--report', '--json'], { cwd: dir });
  const payload = JSON.parse(res);
  assert.equal(payload.invalid_records.length, 1);
  assert.equal(payload.invalid_records[0].reason_code, 'invalid_schema');
  assert.equal(payload.routing.reason_code, 'invalid_records_present');
});

test('--report reports read_error (not invalid_json) when a record path is unreadable (finding R16-#2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-readerr-'));
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  // A *directory* named like a record: readFileSync throws EISDIR — must be read_error,
  // not mislabelled invalid_json (the read is separated from the parse — R15-#3).
  fs.mkdirSync(path.join(evalDir, 'TASK-20260728-x.json'));
  const payload = JSON.parse(runTs(cli, ['--report', '--json'], { cwd: dir }));
  assert.equal(payload.invalid_records.length, 1);
  assert.equal(payload.invalid_records[0].reason_code, 'read_error');
  assert.equal(payload.routing.withheld, true);
  assert.equal(payload.routing.reason_code, 'invalid_records_present');
});

test('--report human output shows a Routing advisory line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-routing-human-'));
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  const write = (id: string, tier: string, input: number) =>
    fs.writeFileSync(path.join(evalDir, `${id}.json`), JSON.stringify({ ...rec(tier, 'pass', input), task_id: id, evaluation_id: `eval-${id}` }));
  for (let i = 0; i < 5; i += 1) write(`TASK-20260728-p${i}`, 'premium', 5000);
  for (let i = 0; i < 5; i += 1) write(`TASK-20260728-s${i}`, 'standard', 3000);
  const out = runTs(cli, ['--report', '--min-samples', '5'], { cwd: dir });
  assert.match(out, /Routing/);
  assert.match(out, /\[advisory · heuristic\] route to standard/);
  assert.match(out, /lowest-token/);                          // finding R10-#4 wording
  assert.match(out, /does not control for task difficulty/);  // finding #4 caveat surfaced
});

test('--report Routing is withheld (with a printed line) when only one tier is eligible', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-routing-withheld-'));
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  for (let i = 0; i < 5; i += 1) {
    const id = `TASK-20260728-p${i}`;
    fs.writeFileSync(path.join(evalDir, `${id}.json`), JSON.stringify({ ...rec('premium', 'pass', 5000), task_id: id, evaluation_id: `eval-${id}` }));
  }
  // --min-samples 5 makes the single premium tier eligible; still < 2 tiers -> withheld.
  const out = runTs(cli, ['--report', '--min-samples', '5'], { cwd: dir });
  assert.match(out, /Routing/);
  assert.match(out, /routing recommendation withheld — fewer than 2 eligible tiers/);
});

test('--report Routing default gate withholds two 5-eval tiers under MIN_TIER_SAMPLES=20 (finding R10-#5)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-routing-default-'));
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  const write = (id: string, tier: string, input: number) =>
    fs.writeFileSync(path.join(evalDir, `${id}.json`), JSON.stringify({ ...rec(tier, 'pass', input), task_id: id, evaluation_id: `eval-${id}` }));
  for (let i = 0; i < 5; i += 1) write(`TASK-20260728-p${i}`, 'premium', 5000);
  for (let i = 0; i < 5; i += 1) write(`TASK-20260728-s${i}`, 'standard', 3000);
  // No --min-samples: routing uses the 20 default, so 5-eval tiers are withheld.
  const payload = JSON.parse(runTs(cli, ['--report', '--json'], { cwd: dir }));
  assert.equal(payload.routing.min_samples, 20);
  assert.equal(payload.routing.withheld, true);
  // Equals form must override the routing default too (finding R11-#4) — not just spaced.
  const eq = JSON.parse(runTs(cli, ['--report', '--json', '--min-samples=5'], { cwd: dir }));
  assert.equal(eq.routing.min_samples, 5);
  assert.equal(eq.routing.withheld, false);
});
```

Note: `readEvaluationRecord` requires the filename to equal `${task_id}.json`; the `write` helper stamps a matching `task_id`/`evaluation_id`.

Also add an **end-to-end** test to `test/evaluate-command.test.ts` (it has
`setupHumanDecisionRepo`, `writeRunRecord`, and `run` from Task 2) proving a
`manual_override` record is listed, aggregated by tier, **and drives the routing
recommendation** — a single-tier version would be withheld (needs ≥ 2 tiers), so
add a second, pricier tier and run with `--min-samples 1`:

```ts
test('a manual override is listed, aggregated, and drives the routing recommendation', () => {
  const dir = setupHumanDecisionRepo();
  // The override's task routes to a low-token 'standard' tier (run-1: 80+20 tokens).
  writeRunRecord(dir, 'run-1', 'TASK-20260724-x', 'anthropic', 'claude-sonnet-4-6');
  fs.mkdirSync(path.join(dir, '.ai'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ai/model-routing.yaml'), 'tiers:\n  standard:\n    provider: anthropic\n    model: claude-sonnet-4-6\n');
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'ok after review']).status, 0);

  // A second, higher-token tier so routing has >= 2 tiers to compare.
  const premium = {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: 'eval-TASK-20260728-pr', task_id: 'TASK-20260728-pr',
    generated_at: '2026-07-28T00:00:00.000Z', mode: 'compact', experiment_id: null, comparability: null, outcome: 'pass',
    outcome_source: { type: 'review_scorecard', scorecard: 's', verdict: 'approve' },
    routing_signatures: [{ provider: 'anthropic', model: 'claude-opus-4-8' }], // findings R11-#2/R13-#1: a tier without a signature is excluded (missing)
    validation: { status: 'pass', evidence_count: 1, results: { pass: 1, fail: 0, skipped: 0 } },
    run_ids: [], context_artifact: null, task_journal: 'j', tier: 'premium',
    metrics: { context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: 5000, output_tokens: 10, cached_tokens: 0, latency_ms: 100, retries: 0 } },
  };
  fs.writeFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260728-pr.json'), JSON.stringify(premium));

  const payload = JSON.parse(run(dir, ['--report', '--json', '--min-samples', '1']).stdout);
  assert.equal(payload.outcomes.pass, 2);
  assert.equal(payload.byTier.standard.pass, 1);              // overridden record aggregated under its tier
  assert.equal(payload.routing.withheld, false);
  assert.equal(payload.routing.recommended_tier, 'standard'); // the override's lower-token tier is recommended
});

test('a run with an empty/whitespace model never yields a record the reader rejects (finding R16-#1)', () => {
  const dir = setupHumanDecisionRepo();
  // A run whose model is whitespace-only: the run-record validator now rejects it, so
  // listRunRecords filters it and it never becomes a routing signature.
  writeRunRecord(dir, 'run-1', 'TASK-20260724-x', 'anthropic', '   ');
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'ok']).status, 0);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8'));
  assert.deepEqual(rec.routing_signatures, []);              // empty, not [{ model: '   ' }]
  // The record round-trips: --report reads it as valid (NOT invalid_schema). With the run
  // filtered there are no valid runs, so resolveTierForRuns([]) → 'unknown' (finding R17-#1;
  // setupHumanDecisionRepo has no routing config anyway) — the record is still valid.
  const payload = JSON.parse(run(dir, ['--report', '--json']).stdout);
  assert.deepEqual(payload.invalid_records, []);
  assert.equal(payload.byTier.unknown.count, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/evaluation-report.test.ts test/evaluate-command.test.ts`
Expected: FAIL — no `routing` in JSON; no `Routing` section; the E2E `--report --json` has no `routing` field.

- [ ] **Step 3: Surface invalid records, compute routing, and add both to the `--json` payload**

First, stop silently dropping corrupt records (finding R13-#3). Add a detailed listing
in `bin/lib/evaluation-record.ts` that returns the valid records **and** the invalid
files with a stable code (leaving the existing `listEvaluationRecords` for other
callers):

```ts
export type InvalidEvaluationRecord = { file: string; reason_code: 'invalid_json' | 'invalid_schema' | 'task_id_mismatch' | 'read_error' };
export function listEvaluationRecordsDetailed(repositoryRoot: string): { records: EvaluationRecord[]; invalid: InvalidEvaluationRecord[] } {
  const dir = evaluationDir(repositoryRoot);
  const records: EvaluationRecord[] = [];
  const invalid: InvalidEvaluationRecord[] = [];
  let names: string[];
  // findings R15-#3 / R16-#2: do NOT pre-check with fs.existsSync — it returns false both
  // for a missing dir AND for one we can't traverse, which would look "empty" and defeat
  // fail-closed. Classify straight from readdirSync: ENOENT is truly absent (empty result);
  // any other error (EACCES, …) is a read_error so routing withholds. Report the *relative*
  // path, never the absolute repo path.
  try { names = fs.readdirSync(dir); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { records, invalid };
    return { records, invalid: [{ file: EVAL_DIR, reason_code: 'read_error' }] };
  }
  names.sort(); // deterministic order, independent of the filesystem
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.tmp')) continue; // .corrupt-<ts> backups are ignored
    // Separate the read from the parse so an EACCES isn't mislabelled invalid_json (R15-#3).
    let text: string;
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); }
    catch { invalid.push({ file: name, reason_code: 'read_error' }); continue; }
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch { invalid.push({ file: name, reason_code: 'invalid_json' }); continue; }
    if (!isValidEvaluationRecord(raw)) { invalid.push({ file: name, reason_code: 'invalid_schema' }); continue; }
    if (name !== `${raw.task_id}.json`) { invalid.push({ file: name, reason_code: 'task_id_mismatch' }); continue; }
    records.push({ ...raw, mode: raw.mode ?? 'compact', experiment_id: raw.experiment_id ?? null, comparability: raw.comparability ?? null, routing_signatures: raw.routing_signatures ?? [] });
  }
  // Deterministic output ordering (records newest-first; invalid by file) — R15-#3.
  records.sort((a, b) => b.generated_at.localeCompare(a.generated_at));
  invalid.sort((a, b) => a.file.localeCompare(b.file));
  return { records, invalid };
}
```

In `runReport`, replace the existing `const records = listEvaluationRecords(root);`
with `const { records, invalid } = listEvaluationRecordsDetailed(root);` so `invalid`
is in hand (the rest of the report — aggregation, experiments — uses `records`
unchanged). Also update the import at `bin/lib/evaluation-report.ts:4` — swap
`import { listEvaluationRecords } from './evaluation-record.js';` for
`import { listEvaluationRecordsDetailed } from './evaluation-record.js';` (finding
R18-#1; `listEvaluationRecords` has no other caller in this file, so it is fully
replaced — otherwise typecheck reports an unused import / missing name). Routing has its own default (`MIN_TIER_SAMPLES = 20`); `--min-samples`, when
supplied, overrides *both* gates, so compute a routing-specific sample count (finding
R10-#5). **When any record is invalid, withhold routing** (`invalid_records_present` —
finding R13-#3): a corrupt record can't be attributed to a tier, so it may have changed
the pick.

```ts
  const routingMinSamples = getArgValue('--min-samples') !== null ? minSamples : MIN_TIER_SAMPLES;
  const agg0 = aggregateEvaluations(records);
  let routing = recommendRouting(agg0, routingMinSamples);
  if (invalid.length > 0) {
    routing = { ...routing, withheld: true, recommended_tier: null, best_tier: null,
      reason_code: 'invalid_records_present',
      reason: `${invalid.length} invalid evaluation record${invalid.length === 1 ? '' : 's'} present; routing withheld until resolved` };
  }
  const outRouting = {
    ...routing,
    tiers: routing.tiers.map((t) => ({ ...t, pass_rate: round1(t.pass_rate), mean_tokens_per_eval: round1(t.mean_tokens_per_eval) })),
  };
```

(`MIN_TIER_SAMPLES` is defined in this module (Task 3). `minSamples` is the existing
experiment value parsed from `--min-samples`.)

In the `args.has('--json')` payload object (`~192`), add `routing: outRouting,` **and**
`invalid_records: invalid,` alongside `recommendation: outRecommendation,`.

- [ ] **Step 4: Print the Routing section (for any non-empty report, independent of experiments)**

Contract: the Routing section prints whenever the report has ≥ 1 evaluation
record — it is independent of whether *experiments* exist. The change: (a) the
existing zero-record early return must not swallow **invalid-only** directories
(finding R14-#4), and (b) stop the Experiments block from `return`ing early.

**(a) Tighten the zero-record early return (findings R14-#4, R15-#2).** The `--json`
path already returned above (`~line 209`) with the **general** payload from Step 3 —
which includes `routing` (withheld via `invalid_records_present`) and `invalid_records`
and works for 0 valid + N invalid with the full schema (experiments/recommendation
present). So this **terminal-only** branch must not build a second, reduced JSON
payload (that code was unreachable and off-schema — finding R15-#2). The existing
`if (records.length === 0) { console.log(formatStatus('skipped', 'no evaluation records')); return; }`
(`~line 214`) still fires for a directory of only *corrupt* files, hiding them. Gate it
on **both** being empty; for invalid-only, print the warning + withheld line:

```ts
  if (records.length === 0) {
    if (invalid.length === 0) {
      console.log(formatStatus('skipped', 'no evaluation records'));
    } else {
      console.log(formatStatus('skipped', 'no valid evaluation records'));
      console.log(formatStatus('warn', `${invalid.length} invalid evaluation record${invalid.length === 1 ? '' : 's'} skipped (${invalid.map((i) => i.file).join(', ')}); routing withheld until resolved`));
    }
    return;
  }
```

(No `args.has('--json')` here — JSON is handled entirely by the Step 3 payload before
this point.)

**(b)** With ≥ 1 valid record, stop the Experiments block from `return`ing early.

In the terminal tail, the Experiments block currently `return`s early when there are no pairs/skipped — that would suppress Routing. Replace the early-return with an `else` so control continues, then print Routing. Change:

```ts
  console.log('');
  console.log('Experiments');
  if (pairs.length === 0 && skipped.length === 0) {
    console.log(formatStatus('skipped', 'no paired experiments recorded'));
    return;
  }
  for (const p of pairs) { /* … */ }
  for (const s of skipped) { /* … */ }
  if (pairs.length > 0) { /* … */ }
  if (recommendation.withheld) { /* … */ } else { /* … */ }
}
```

to:

```ts
  console.log('');
  console.log('Experiments');
  if (pairs.length === 0 && skipped.length === 0) {
    console.log(formatStatus('skipped', 'no paired experiments recorded'));
  } else {
    for (const p of pairs) {
      console.log(formatStatus('metric', `${p.experiment_id}: baseline ${p.baseline.outcome} vs compact ${p.compact.outcome}, tokens saved ${round1(p.token_saving_pct)}%, latency saved ${round1(p.latency_saving_pct)}%`));
    }
    for (const s of skipped) {
      console.log(formatStatus('skipped', `${s.experiment_id}: ${s.reason}`));
    }
    if (pairs.length > 0) {
      console.log(formatStatus('metric', `pairs ${aggregate.pairs}: baseline pass ${outAggregate.baseline_pass_rate}% vs compact pass ${outAggregate.compact_pass_rate}% (drop ${outAggregate.pass_rate_drop_pct} pts), mean tokens saved ${outAggregate.mean_token_saving_pct}%, mean latency saved ${outAggregate.mean_latency_saving_pct}%`));
    }
    if (recommendation.withheld) {
      console.log(formatStatus('skipped', `insufficient samples (${aggregate.pairs}/${minSamples}) — recommendation withheld`));
    } else {
      const n = `${aggregate.pairs} comparable pair${aggregate.pairs === 1 ? '' : 's'}`;
      const verdictText = recommendation.verdict === 'prefer_compact'
        ? `prefer compact — ${n}, outcomes held (drop ${outAggregate.pass_rate_drop_pct} pts), savings material (tokens ${outAggregate.mean_token_saving_pct}%, latency ${outAggregate.mean_latency_saving_pct}%)`
        : recommendation.verdict === 'keep_baseline'
          ? `keep baseline — ${n}, compact degrades pass rate by ${outAggregate.pass_rate_drop_pct} pts (tolerance ${MAX_PASS_RATE_DROP_PCT})`
          : `no material difference — ${n}, either mode acceptable (tokens ${outAggregate.mean_token_saving_pct}%, latency ${outAggregate.mean_latency_saving_pct}%)`;
      console.log(formatStatus('metric', `[advisory] ${verdictText}`));
    }
  }

  // finding R13-#3: never let corrupt records vanish silently — warn on the terminal
  // (the JSON carries the full invalid_records list).
  if (invalid.length > 0) {
    console.log('');
    console.log(formatStatus('warn', `${invalid.length} invalid evaluation record${invalid.length === 1 ? '' : 's'} skipped (${invalid.map((i) => i.file).join(', ')}); routing withheld until resolved`));
  }

  console.log('');
  console.log('Routing');
  if (routing.withheld) {
    // findings R10-#5 / R13-#3: surface the machine-readable reason (also in --json).
    console.log(formatStatus('skipped', `routing recommendation withheld — ${routing.reason}`));
  } else {
    const r = routing.tiers.find((t) => t.tier === routing.recommended_tier)!;
    const best = routing.tiers.find((t) => t.tier === routing.best_tier)!;
    // finding R10-#4: "lowest-token", not "cheapest" — this compares token counts, not cost.
    console.log(formatStatus('metric', `[advisory · heuristic] route to ${routing.recommended_tier} — ${r.count} eval${r.count === 1 ? '' : 's'}, pass ${round1(r.pass_rate)}%, mean ${Math.round(r.mean_tokens_per_eval)} tokens/eval (lowest-token within ${MAX_PASS_RATE_DROP_PCT} pts of best ${routing.best_tier} ${round1(best.pass_rate)}%; heuristic — token count, not cost; does not control for task difficulty)`));
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run typecheck && node --import ./node_modules/tsx/dist/loader.mjs --test test/evaluation-report.test.ts test/experiment-report-cli.test.ts test/evaluate-command.test.ts`
Expected: PASS (including the override→routing E2E in `evaluate-command.test.ts`). Existing experiment-report tests still pass (the block content is unchanged, only wrapped in `else`).

- [ ] **Step 6: Commit**

Stage `evaluation-record.ts` too — it now holds `listEvaluationRecordsDetailed` (finding
R18-#1) — and prefer explicit test paths over `test/` so no stray file is swept in:

```bash
git add bin/lib/evaluation-report.ts bin/lib/evaluation-record.ts \
        test/evaluation-report.test.ts test/evaluate-command.test.ts
git commit -m "feat(report): add Routing advisory, invalid_records, and detailed listing to --report"
```

---

### Task 5: Release — ship 13D as **3.10.0** (finding #2)

3.9.0 is already published on npm, so 13D is a **new additive minor**, not a
fold-in. Bump the version, add a fresh CHANGELOG section and migration doc, and
leave the shipped 3.9.0 entries untouched.

**Files:**
- Modify: `package.json` (version), `package-lock.json` (version, finding R3-#2), `CHANGELOG.md` (new `## 3.10.0` section), `README.md`, `ROADMAP.md`
- Create: `docs/migrations/3.10.0.md`

**Interfaces:** none.

- [ ] **Step 1: Bump the package version (and the lockfile)**

In `package.json`, change `"version": "3.9.0"` to `"version": "3.10.0"`. Then sync
the lockfile — it also pins `3.9.0` at both the top level and the root package
(`package-lock.json` lines ~3 and ~9), so run:

```bash
npm install --package-lock-only
```

which rewrites both `version` fields to `3.10.0` without touching `node_modules`.
(Equivalently, edit those two `"version": "3.9.0"` lines by hand.) Confirm with
`grep -n '"version": "3.9.0"' package-lock.json` returning nothing.

- [ ] **Step 2: Add a new CHANGELOG `3.10.0` section**

In `CHANGELOG.md`, above the published `## 3.9.0 — 2026-07-28` section, add (use the
**actual ship date**, not a pre-dated one — finding R10-#7):

```markdown
## 3.10.0 — <ship-date>

Phase 13D — model-tier routing advice and a human outcome override. Additive
only (`schema_version` stays `1`); 3.9.0 records read back unchanged.

### Added

- **Model-tier routing recommendation** (13D): `--report` prints a `Routing`
  advisory naming the **lowest-token** tier (by mean tokens/eval) whose pass rate
  holds within 5 pts of the best tier, withheld until ≥ 2 tiers each have
  `MIN_TIER_SAMPLES` (default **20**, overridable via `--min-samples`) evaluations.
  A tier whose records span more than one provider/model is excluded rather than
  blended. Presented as an explicit **heuristic** (token count, not cost; does not
  control for task difficulty); `--report --json` gains a `routing` object with
  `heuristic`/`caveat` and, when withheld, a `reason` and `eligible_tiers` count.
- **`--evaluate --outcome pass|fail --reason "<text>" [--by "<name>"]`** (13D): a
  human can override the outcome of a `Needs human decision` task. Recorded as a
  `manual_override` `outcome_source` with the reason, original verdict, and
  provenance (`decided_by`, `decided_at`). Rejected (no record) for any other
  verdict. Re-evaluating **preserves** an existing override while its verdict is still
  `Needs human decision` (refreshing metrics only); `--clear-outcome` removes it. If
  the review has since changed to a clear verdict, or the stored record is corrupt,
  `--evaluate` exits 1 rather than overwrite (use `--clear-outcome`/`--outcome`, or
  `--force` for a corrupt record). Concurrent `--evaluate` on one task is unsupported.
```

- [ ] **Step 3: Create the migration guide**

Create `docs/migrations/3.10.0.md`:

```markdown
# Migrating to 3.10.0

Phase 13D is additive; `schema_version` stays `1` and 3.9.0 records read back
unchanged. No action is required.

### Routing recommendations (13D)

`--report` adds a `Routing` advisory (and a `routing` object under `--json`): the
**lowest-token** model tier by mean tokens/eval that holds pass rate within 5 pts of
the best tier, withheld until `MIN_TIER_SAMPLES` (default 20, override with
`--min-samples`) evaluations exist for ≥ 2 tiers. A tier that mixes provider/models,
or that has no derived routing signature, is excluded rather than blended/trusted. It
is a **heuristic** — token count is not cost, and it does not control for task
difficulty — and is advisory only: nothing is auto-routed or persisted.

**Recovering an excluded (remapped) tier (finding R12-#3).** Once a tier is pointed
at a new model, its old and new records carry different `routing_signatures`, so the
tier reads as `mixed` and is excluded until the old cohort ages out. Each tier's
`routing_signatures` (structured `{provider, model}`) are listed in the `--json`
`routing.tiers[]` (with a per-tier `excluded_reason_code`) so you can see the split;
to restore a recommendation, delete (or re-evaluate) the evaluation records from the
retired model so a single signature remains. (Comparing only the cohort that matches a
tier's *current* routing config is a future refinement; today the advisory simply
withholds rather than guess across models.)

**Invalid records (finding R13-#3).** `--report` no longer silently skips a corrupt
evaluation file: it lists it under `--json` `invalid_records` (with a `reason_code`),
prints a terminal warning, and **withholds routing** until you resolve it (a corrupt
record can't be attributed to a tier). If you overwrite a corrupt record with
`--evaluate --force`, the bad file is preserved as `<task>.json.corrupt-<timestamp>`
(finding R13-#4) — inspect or delete it once you've recovered anything you need.

### Outcome override (13D)

`--evaluate --outcome pass|fail --reason "<text>" [--by "<name>"]` lets a human
resolve a `Needs human decision` task. It is rejected for any other verdict. The
record stores a `manual_override` `outcome_source` with the reason, original
verdict, and provenance (`decided_by`, `decided_at`). Re-running `--evaluate`
without override flags **preserves** the decision (refreshing metrics only) while the
verdict is still `Needs human decision`; `--evaluate --clear-outcome` removes it. If
the review has changed to a clear verdict, or the record is corrupt, `--evaluate`
exits 1 (use `--clear-outcome`/`--outcome`, or `--force` for a corrupt record). Do
not run `--evaluate` on one task concurrently.
```

- [ ] **Step 4: Add README notes**

In `README.md`, in the Evaluation section: (a) after the Verdict→Outcome table, note the override:

```markdown
A `Needs human decision` task can be resolved by a human with
`--evaluate --task <id> --outcome pass|fail --reason "<why>" [--by "<name>"]`; the
record keeps a `manual_override` source with the reason, original verdict, and who
decided it and when. Override is rejected for any other verdict. Re-running
`--evaluate` without override flags preserves the decision while the verdict is still
`Needs human decision`; `--clear-outcome` removes it. If the review changed to a clear
verdict, or the record is corrupt, `--evaluate` exits 1 (use `--clear-outcome`/
`--outcome`, or `--force` for a corrupt record); concurrent `--evaluate` on one task
is unsupported.
```

and (b) near the `--report` docs:

```markdown
`--report` also prints a **Routing** advisory: the lowest-token model tier (by mean
tokens per evaluation) whose pass rate stays within 5 points of the best tier,
withheld until `MIN_TIER_SAMPLES` (default 20, override with `--min-samples`)
evaluations exist for at least two tiers, and excluding any tier that mixes
provider/models or lacks a derived routing signature. It is a heuristic (token count
is not cost; it does not control for task difficulty) and advice only — ForgeAI never
auto-selects a tier.
```

- [ ] **Step 5: Update the ROADMAP**

In `ROADMAP.md`, in the Phase 13 block, replace the deferred sentence
(`ROADMAP.md:242`):

```markdown
Still deferred: model-tier routing recommendations and a `--outcome` manual
override.
```

with:

```markdown
- *13D — routing feedback and outcome override (3.10.0).* A `--report` model-tier
  routing advisory (lowest-token tier holding pass rate within tolerance,
  sample-gated at 20, mixed-model tiers excluded, surfaced as a heuristic), and a
  `--evaluate --outcome pass|fail --reason [--by]` human override (preserved on
  re-evaluate, cleared with `--clear-outcome`) for `Needs human decision` tasks,
  with provenance (`decided_by`/`decided_at`). Phase 13 is complete.
```

- [ ] **Step 6: Verify the full suite is green**

Run: `npm test`
Expected: typecheck, build, and all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json CHANGELOG.md docs/migrations/3.10.0.md README.md ROADMAP.md
git commit -m "docs: release Phase 13D routing advisory and outcome override in 3.10.0"
```

---

## Self-Review Notes

- **Spec coverage:** outcome_source union (+`decided_by`/`decided_at`) + structured `routing_signatures` field (trimmed non-empty — R16-#1) + `EvaluationRecordWire` validator (R13-#1/#2) + run-record `model` non-empty (R16-#1) + all typed fixtures updated (R12-#2/R13-#1) (Task 1, no `decision_history` — R7); `--outcome`/`--reason`/`--by`/`--clear-outcome`/`--force` parse, scope gate + verdict-drift guard (R11-#3), build, provenance, status-aware prior read + fail-closed-on-corrupt + `--force` backup (R11-#1/R13-#4) + override preserve (R10-#1), structured `routing_signatures` derivation (R11-#2/R13-#1), `--clear-outcome` boolean validation (R11-#5), imports (R10-#2/R11-#1), env-fallback fix (R10-#6), success line (Task 2); `recommendRouting` with `heuristic`/`caveat`, `MIN_TIER_SAMPLES=20`, mixed/missing-signature exclusion + `excluded_reason_code` (R11-#2/R13-#5), withheld `reason`/`reason_code`/`eligible_tiers` (Task 3); total validator (`Date.parse` guard — R15-#1); `listEvaluationRecordsDetailed` (fail-closed `read_error`, sorted — R15-#3) + `invalid_records` + routing withhold-on-invalid (R13-#3), single general `--json` payload for invalid-only (R15-#2), Routing terminal + `--json` with routing sample default via `getArgValue` (R11-#4), incl. the Experiments early-return restructure (Task 4); 3.10.0 version bump + new CHANGELOG/migration (ship-date placeholder — R10-#7) + README/ROADMAP (Task 5). Every spec section maps to a task.
- **Review findings (2026-07-29/30):** Round 1 — R1-#1 not-built status corrected (this plan is the work remaining); R1-#2 ships as **3.10.0** (3.9.0 published) — Task 5; R1-#3 provenance (`decided_by`/`decided_at`) + append-only `decision_history` — Tasks 1–2; R1-#4 routing labelled a heuristic with a caveat — Tasks 3–4. Round 2 (fix-the-fixes) — R2-#1 history prefers existing `decision_history` (no double-count, asserted length 2 not 3); R2-#2 `readEvaluationRecordStatus` fails closed on a corrupt prior record (exit 1, file untouched); R2-#3 `--by` without an override is a usage error; R2-#4 `decided_at` validated as canonical ISO. Round 3 (fix-the-fixes²) — R3-#1 validator enforces `outcome_source` === last `decision_history` entry (tamper tests for not-last and no-history); R3-#2 `package-lock.json` bumped alongside `package.json`; R3-#3 `resolveDecidedBy` trims env fallbacks. Round 4 (fix-the-fixes³) — R4-#1 removed the unreachable legacy-seed branch (strict validator kept); R4-#2 validator rejects present-but-empty `decision_history`; R4-#3 validator enforced non-decreasing `decided_at` (reverted in R5); R4-#4 banner round count fixed. Round 5 (fix-the-fixes⁴) — R5-#1 happy-path fixture now carries `decision_history` (was failing the R3-#1 invariant); R5-#2 reverted R4-#3 timestamp ordering (append order = array position, avoids clock-skew self-invalidation); R5-#3 synced stale prose (data-flow "legacy seed", build description, mis-named test). Round 6 — R6-#1 optimistic-concurrency guard on write (stat re-check before rename, `EvaluationRecordConflictError` → exit 1, unit test asserts the other writer's decision survives); R6-#2 Task 0 commits the untracked spec + plan first; R6-#3 design status raised to "approved for implementation". **Round 7 (simplification) — R7 drops the entire `decision_history` audit feature**: the optimistic guard (R6-#1) could not atomically prevent concurrent lost updates (TOCTOU), and re-review judged the append-only history over-built for 13D. Keep only `decided_by`/`decided_at` provenance; re-`--evaluate` overwrites (idempotent). This supersedes R2-#1/#2, R3-#1, R4-#1/#2/#3, R5-#1/#2, R6-#1, and the R7-#3 `statSync` fix (its reader is removed). R7-#3(stat) note: the corrupt-record guard and `readEvaluationRecordStatus`/guard/`EvaluationRecordConflictError` are all removed; `writeEvaluationRecord` keeps its original signature. Round 8 (wording + hardening) — R8-#1 help text no longer claims "prior overrides are preserved"; R8-#2 "idempotent" reworded to keyed-upsert/replace where input changes; R8-#3 success line strips control chars from `reason`/`decided_by` for terminal render (raw kept in JSON), with a test asserting no log-line spoofing and raw preservation. Round 9 (sanitizer completeness) — R9-#1 `LINE_BREAKERS` shared regex adds U+2028/U+2029 (with a test); R9-#2 CLI rejects a `--reason`/`--by` empty once line-breakers are stripped (validates the displayable form, so no blank-provenance record is written); R9-#3 header round-count reconciled with the log. **Round 10 (pre-implementation)** — R10-#1 a plain re-evaluate now **preserves** an existing `manual_override` (prior-record read; `decided_at` not restamped) and `--clear-outcome` resets it (usage error if combined with an override), partially superseding R7's silent-revert; R10-#2 Task 2 Step 0 updates `evaluation-record.ts` imports (`execFileSync`, `EvaluationOutcomeSource`, `args`) so the samples typecheck; R10-#3 `aggregateEvaluations` collects per-tier `routing_signatures` and `recommendRouting` excludes any tier with >1 signature (`excluded_reason`, tested with two provider/models under one tier name); R10-#4 "cheapest" → **lowest-token** everywhere (terminal, JSON caveat, CHANGELOG, README, ROADMAP) since token count ≠ cost; R10-#5 `MIN_TIER_SAMPLES = 20` split from `MIN_EXPERIMENT_PAIRS = 5` (routing-specific default, `--min-samples` overrides both), withheld JSON gains `reason` + `eligible_tiers` (tested); R10-#6 `resolveDecidedBy` trims and tests each `$USER`/`$USERNAME` candidate in turn (whitespace `$USER` no longer shadows a set `$USERNAME`); R10-#7 CHANGELOG/migration use a `<ship-date>` placeholder, not a pre-dated 2026-07-29 (version stays 3.10.0). **Round 11 (hardening)** — R11-#1 status-aware `readEvaluationRecordStatus` (`missing`/`valid`/`invalid`); any `--evaluate` overwriting an *invalid* prior exits 1 unless `--force` (re-adds the R2-#2 fail-closed idea R7 had dropped, now for a single record not history); R11-#2 top-level `EvaluationRecord.routing_signature` always derived from runs — routing eligibility requires **exactly one** signature (zero → `missing`, >1 → `mixed`), no caveat-only pass-through, with mixed + missing tests and `rec()`/E2E fixtures updated; R11-#3 preserved override fails closed on verdict drift (build returns an error when a `preservedSource`'s current verdict is no longer `needs human decision`; the R10 "survives edited review" test is **inverted** to expect exit 1); R11-#4 routing sample-default detected via `getArgValue('--min-samples')` so the equals form overrides it (with a CLI test); R11-#5 boolean-flag validation for `--clear-outcome` (reject `=value`/duplicate); R11-#6 help text + design state concurrent `--evaluate` on one task is unsupported. **Round 12 (closing R11 gaps)** — R12-#1 `readEvaluationRecordStatus` rejects a record whose internal `task_id` ≠ the requested task (a foreign valid record in `<taskId>.json` no longer preserves the wrong decision; evaluation_id equality is transitively guaranteed by the existing validator), with a CLI fail-closed test; R12-#2 the required `routing_signature` field forces updating **all** typed `EvaluationRecord` fixtures (`makeEval`, both `rec()` helpers) in Task 1 or typecheck fails; R12-#3 mixed-signature recovery is documented (signatures shown in `--json`; delete/re-evaluate retired-model records), current-cohort comparison deferred; R12-#4 withheld `routing` JSON gains a stable `reason_code` (`insufficient_eligible_tiers`) + `required_tiers` (2) beside the human `reason`; R12-#5 `routing_signature` validated as canonical comma-separated `provider/model` pairs (rejects `""`/`"a,,b"`). **Round 13 (structured signature + corrupt visibility)** — R13-#1 the string signature is replaced by a **structured** `routing_signatures: RoutingSignature[]` (`{provider, model}`) — a `provider/model`+comma string breaks on model IDs containing `/` or `,` (`--model` is not charset-restricted, unlike `provider`); aggregation unions structured pairs, a mixed test uses a `meta-llama/llama-3.1,exp` model id, and this supersedes R12-#5's string validation; R13-#2 the validator narrows to `EvaluationRecordWire` (field optional) with a normalize step, fixing the type-predicate lie about legacy records (my earlier "not a type guard" note was wrong); R13-#3 `listEvaluationRecordsDetailed` returns valid records **and** `invalid_records` (`{file, reason_code}`) — `--report` prints a terminal warning, adds `invalid_records` to `--json`, and **withholds routing** (`reason_code: 'invalid_records_present'`) when any exist; R13-#4 `--force` renames a corrupt record to `.corrupt-<ts>` before overwriting so evidence survives (tested); R13-#5 each tier carries a stable `excluded_reason_code` (`missing_signature`/`mixed_signatures`/`insufficient_samples`). **Round 14 (R13 mechanics)** — R14-#1 the structured-signature dedup key was a literal `\0` (real NUL byte, made the plan a "binary" file) → `JSON.stringify([provider, model])`; R14-#2 `EvaluationRecordWire` under-declared the legacy schema (only `routing_signatures` optional) — now `mode`/`experiment_id`/`comparability`/`routing_signatures` are **all** optional, matching what the validator already accepts (`~lines 100-108`); R14-#3 `--force` moved the corrupt file before the build, so a later build failure lost it from the canonical path (report could no longer flag it) — the backup now runs **only after a successful build, right before the atomic write**, via `copyFileSync(COPYFILE_EXCL)` (copy, not rename), with a corrupt+`--force`+build-failure test asserting the canonical file survives and routing stays fail-closed; R14-#4 the zero-record early return fired before the invalid warning, so an invalid-only directory printed "no evaluation records" — the guard is now `records.length === 0 && invalid.length === 0`, with the invalid-only case surfacing the files + a withheld routing (0-valid+1-invalid test). **Round 15 (report robustness)** — R15-#1 the validator was non-total: `new Date('invalid').toISOString()` throws `RangeError`, and R13's new callers invoke the validator outside the JSON-parse `try`, so a parseable record with a bad `generated_at` would crash `--report` instead of listing `invalid_schema`; guarded with `Date.parse` (like `decided_at`), with validator + `--report --json` no-crash tests; R15-#2 the R14 invalid-only *terminal* branch re-emitted a reduced JSON payload that was unreachable (the `--json` path returns earlier) and off-schema — removed; the single general Step-3 payload already handles 0 valid + N invalid (full schema), and the invalid-only test now asserts `experiments`/`recommendation` present; R15-#3 `listEvaluationRecordsDetailed` is now fail-closed and deterministic — catches `readdirSync` (→ a `read_error` entry so routing withholds on an unreadable dir), separates the file read from the parse (`read_error` vs `invalid_json`), and sorts names/records (newest first)/invalid (by file). **Round 16 (writer/reader symmetry + fail-closed)** — R16-#1 the run-record validator accepted `model: ""`/`"   "` (only a string check), so the builder could copy an empty model into `routing_signatures` and produce a record the (structured, non-empty) evaluation validator then rejects on read — write/read asymmetry, silently withholding routing; fixed at all three layers: `isValidRunRecordInput` requires a trimmed-non-empty `model` (`provider` is already enum-checked), the evaluation validator trims `provider`/`model`, and the builder skips empty-signature runs as a backstop, with a whitespace-model test proving the written record round-trips valid; R16-#2 `listEvaluationRecordsDetailed` dropped `fs.existsSync` (false for *inaccessible* as well as missing — defeating R15's fail-closed goal) and now classifies from `readdirSync` directly (ENOENT → truly empty; other errors → a `read_error` entry with the *relative* path, so an unreadable dir withholds routing), with a directory-named-like-a-record `read_error` test. **Round 17 (test correctness + Task-1 scope)** — R17-#1 the R16-#1 whitespace-model test asserted `byTier.standard.count` but the filtered run leaves the eval with no valid runs, so `resolveTierForRuns([])` → `unknown` (and `setupHumanDecisionRepo` has no routing config) — corrected to `byTier.unknown.count`, keeping the round-trip-valid + empty-`routing_signatures` assertions; R17-#2 Task 1 declared `run-record.ts` + the two fixture files in its Files but Step 5 ran only `evaluation-record.test.ts` and Step 6 staged only three files — now a `test/run-record.test.ts` unit test (empty/whitespace `model` filtered, using the file's existing `makeRecord`) is added and run in Step 5, and Step 6 stages `run-record.ts` + `run-record.test.ts` + both fixture files so they can't be pulled into a Task 2/4 commit via `git add … test/`. **Round 18 (Task-4 import + scope)** — R18-#1 Task 4 adds `listEvaluationRecordsDetailed` and switches `runReport`'s caller, but hadn't said to update the `evaluation-report.ts:4` import (`listEvaluationRecords` → `listEvaluationRecordsDetailed`, fully replaced since it has no other caller in that file) — now specified; and Step 6 staged only `evaluation-report.ts test/`, omitting `evaluation-record.ts` (which holds the new listing) — now staged explicitly with named test paths so nothing stray is swept in.
- **Placeholder scan:** no TBD/TODO; every code step shows the code.
- **Type consistency:** `EvaluationOutcomeSource` (with `decided_by`/`decided_at`), `override: { outcome: 'pass' | 'fail'; reason: string; decidedBy: string } | null` plus `preservedSource: Extract<EvaluationOutcomeSource, { type: 'manual_override' }> | null` (a preserved prior override carried verbatim — R10-#1), `Aggregate` (its `TierAgg` gains `signatures?: RoutingSignature[]`), `TierRouting` (with structured `routing_signatures`/`excluded_reason`/`excluded_reason_code` — R13-#1/#5), `RoutingRecommendation` (with `heuristic`/`caveat`/`reason`/`reason_code`/`eligible_tiers`/`required_tiers`), `recommendRouting`, `MIN_TIER_SAMPLES = 20`, `ROUTING_CAVEAT`, `listEvaluationRecordsDetailed` (R13-#3), and `readEvaluationRecordStatus` / `EvaluationRecordReadStatus` (R11-#1, with the `task_id` check — R12-#1) are used with identical names/signatures across tasks. `RoutingWithholdCode` adds `invalid_records_present` (R13-#3). `RoutingSignature = { provider; model }` and `EvaluationRecord.routing_signatures: RoutingSignature[]` (R11-#2, structured — R13-#1) with `EvaluationRecordWire` (all of `mode`/`experiment_id`/`comparability`/`routing_signatures` optional) for legacy validation (R13-#2/R14-#2); every typed fixture sets `routing_signatures` (R12-#2/R13-#1). `override`/`preservedSource` are added to `BuildInput` (Task 2) — any existing `buildEvaluationRecord` test caller (e.g. `baseInput()` in `test/evaluation-record.test.ts`) must set both to `null`. (No `decision_history`/`RecordGuard` — dropped in R7; the R11 `readEvaluationRecordStatus` is a status-aware *reader*, not the removed optimistic-write guard.)
- **Reused constants:** `MAX_PASS_RATE_DROP_PCT` (5), `MIN_EXPERIMENT_PAIRS` (5, via `--min-samples`) — no new thresholds. New string constant `ROUTING_CAVEAT` (display only).
- **Version bump:** **3.10.0** — 3.9.0 is already published (npm `dist-tags.latest = 3.9.0`, 2026-07-28), so 13D cannot fold in; it ships as an additive minor (`schema_version` stays `1`).
- **Review findings addressed:** (1) `--outcome`/`--reason` registered in the shared `validateArgFlag` layer (`context.ts`), which validates both spaced and equals forms — rejecting duplicates/bare/empty/whitespace values (a valid `--outcome=pass` is accepted); help text updated (`init.ts`); usage errors unified to **exit 1** (matching `--evaluate`). (2) validator rejects a whitespace-only `reason` via `trim()`. (3) an E2E test runs `--evaluate --outcome pass` then `--report --json --min-samples 1` with a second tier, asserting the `manual_override` record is listed, aggregated by tier, and drives `routing.recommended_tier`. (4) Routing prints for any non-empty report but is explicitly *not* printed on the zero-record early return (contract clarified). (5) withheld/active Routing lines follow the 13B `skipped`/`[advisory]` convention and both are asserted in tests. Exit code unified to **1** everywhere in the plan (Global Constraints included); the shared validator handles both spaced and equals forms (a valid `--outcome=pass` is accepted), with equals-form + duplicate-`--reason` tests; Task 4's red/green runs include `test/evaluate-command.test.ts`. Routing unit tests use crafted `Aggregate`s to check the **raw** tolerance boundary (exact 5.0 drop keeps the cheap tier; a raw drop that rounds to 5.0 excludes it) and the mean-token tie-break (name ascending); the override-rejected test is parameterized over **Approve and Request changes**.
