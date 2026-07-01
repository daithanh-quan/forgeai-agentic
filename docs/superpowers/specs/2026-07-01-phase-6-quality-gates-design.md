# Phase 6 — Quality Gates (enforceable review/validation)

- **Date:** 2026-07-01
- **Status:** Approved design, ready for implementation plan
- **Package:** `forgeai-agentic-init` (this repo)
- **Roadmap note:** Replaces Phase 4 (plugin/marketplace layer), which is
  dropped. See "Roadmap change" below.

## Problem

The harness plans and tracks work well: lifecycle journals record which state
a task is in (`review`, `acceptance`, `closed`, ...). But "reviewed" and
"done" are currently only prose claims. Nothing verifies them.

Right now an agent can:

- set a journal state to `closed`,
- write `Recommendation: Approve`,
- run no tests, record no findings, provide no validation evidence,

and `forgeai-init --check-lifecycle` still passes, because it only checks that
the state is valid and that a memory-update decision exists — not the quality
of the review.

This is the classic agentic failure mode: an agent declares "done / passing"
with no evidence (rubber-stamping). The `Definition of done` in `PROJECT.md`
is an unenforced prose promise.

## Goal

Turn "reviewed / done" from a claim into something a machine can verify.

After Phase 6, a task cannot pass the gate (`review` -> `acceptance` ->
`closed`) unless the journal contains **real evidence**, not just a claim word:

- at least one real validation-evidence row (not the template placeholder),
- a filled reviewer scorecard with a verdict,
- at least one review finding with a valid recommendation,
- if the verdict is `Approve`, no unresolved blockers.

The gate is exposed as `forgeai-init --check-review`, consistent with the
existing `--check-lifecycle` / `--check-codegraph` checkers, and wired into
`--check-all` and a CI example so it can block merges automatically.

## Non-goals

- The gate does **not** run the app or re-run tests. Running tests is the
  tester's / CI's job. The gate only enforces that appropriate evidence was
  recorded and a review verdict exists.
- The gate does **not** enforce evidence *by task type*. Any real evidence row
  counts (unit test, integration test, e2e, or a manual-QA note) as long as it
  is a real row with a concrete result — not the placeholder and not a bare
  `pass`/`approve` word with an empty validation table.
- No deep standalone `--check-openspec` validator this iteration (OpenSpec
  files already exist; deep validation is deferred to a later phase).
- No auto-scoring / numeric grading of scorecards.
- One CI example only (GitHub Actions). Other providers deferred.

## Evidence level (decided)

"Any real evidence." The gate must reject a journal whose only signal is the
word `Approve`/`pass`. Concretely, `--check-review` treats a journal as
**invalid** when, for a journal in a gated state:

- the *Commands And Validation* table is empty or contains only the template
  placeholder row (`| YYYY-MM-DD | ... | pass | fail | skipped | ... |`), or
- no filled scorecard file exists.

So a journal that records `Recommendation: Approve` with an empty validation
table fails. The evidence type does not matter (unit test, e2e, or manual-QA
note all count) as long as it is a real row with a concrete result.

## Worked example

Feature "Edit user profile", split into a UI assignment and an API assignment,
sharing one journal `.ai/state/tasks/TASK-20260701-profile-edit.md`.

During work, each assignment records evidence of its own kind into the shared
*Commands And Validation* table:

```markdown
| Date | Command/check | Result | Notes |
| --- | --- | --- | --- |
| 2026-07-01 | `npm run typecheck` (API)     | pass | contract types match |
| 2026-07-01 | `npm test -- profile.service` | pass | 8 unit tests |
| 2026-07-01 | `npm test -- profile.e2e`     | pass | PATCH 200 + 422 |
| 2026-07-01 | `npm test -- ProfileForm`     | pass | render + submit + error |
| 2026-07-01 | manual QA: edit name + reload | pass | docs/qa/profile.png |
```

API evidence is unit/integration/contract; UI evidence is component test plus
a manual-QA note. The gate accepts both — it only requires real rows with
concrete results.

At the end, one scorecard covers the whole change:

```markdown
# Review Scorecard — TASK-20260701-profile-edit

| Dimension | Rating | Notes |
| --- | --- | --- |
| Correctness      | pass    | happy path + 422 validation tested |
| Scope control    | pass    | only profile module touched |
| Security         | concern | no rate-limit on PATCH -> follow-up |
| Tests/validation | pass    | API integ + UI component + manual QA |
| Maintainability  | pass    | - |
| Release risk     | pass    | no breaking migration |

Unresolved blockers: none
Verdict: Approve
```

`--check-review` on a journal in state `review|acceptance|closed` then verifies:
real validation rows present, scorecard present and filled with a valid
verdict, at least one review finding with a recommendation, and (for `Approve`)
no unresolved blockers -> exit 0. Missing evidence or scorecard -> exit 1.

## Architecture

The checker reuses existing lifecycle primitives to avoid duplication:
`listTaskJournalFiles`, `parseTaskJournal`, `lifecycleStates`, `parseDateOnly`
from `bin/lib/lifecycle.ts`, and `formatStatus`, `isTodoValue`-style helpers
and `getErrorMessage` from `bin/lib/utils.ts` / `bin/lib/codegraph.ts`. It
follows the same shape as `runCheckCodeGraph`: print required-file statuses,
then per-item validation, then a single `Result:` line and an exit code.

### Gated states

```
review | revision | acceptance | delivery | closed
```

Journals in earlier states (intake..validation) are not gated by this check.
If there are no journals in a gated state, the check prints an `ok` line and
passes (mirrors how `--check-lifecycle` handles "no real task journals").

### New unit: `bin/lib/review.ts`

Exposes `runCheckReview()`:

1. Validate required harness files exist:
   - `.ai/state/reviews/_template.md`
   - `.ai/workflows/quality-gates.md`
   - `.ai/workflows/pre-merge-checklist.md`
2. For each gated journal:
   - **Validation evidence:** parse the *Commands And Validation* table; require
     at least one non-placeholder row with a result of `pass|fail|skipped`.
   - **Review finding:** parse the *Review Findings* table; require at least one
     non-placeholder row with a recommendation of
     `Approve|Request changes|Needs human decision`.
   - **Scorecard:** require `.ai/state/reviews/<task-id>.md` to exist, contain no
     `TODO`, and declare a `Verdict:` of a valid value.
   - **Blocker consistency:** if the scorecard verdict is `Approve`, the
     scorecard's `Unresolved blockers:` line must be `none` (or empty list).
3. Print `formatStatus` lines and a final `Result:` line; set
   `process.exitCode = 1` on any failure.

Parsing helpers (new, table-row aware, placeholder-aware) live in `review.ts`
and are unit-tested. Where a helper already exists in `lifecycle.ts`
(`cleanTableCell` via `sessions.ts`, `parseDateOnly`), reuse it.

### CLI wiring

- `bin/lib/context.ts`: add `export const checkReview = args.has('--check-review');`
- `bin/forgeai-init.ts`: import `runCheckReview` and dispatch on `checkReview`.
- `bin/lib/init.ts` `usage()`: document `--check-review`.
- `bin/lib/check.ts` `runCheckAll()`: call `runCheckReview()` after
  `runCheckProfile()` (or in review order) so the aggregate gate includes it.

### Preserve-on-upgrade

Real scorecards are run state, like real task journals. In
`bin/lib/init.ts`, extend `isPreservedOnUpgrade` so
`.ai/state/reviews/<task-id>.md` (any file except `_template.md`) is preserved
on `--upgrade`, while `_template.md` keeps updating.

## Templates and docs

- `templates/.ai/state/reviews/_template.md` — scorecard template: 6 dimensions
  (correctness, scope control, security, tests/validation, maintainability,
  release risk), each rated `pass|concern|fail` with notes; an
  `Unresolved blockers:` line; a `Verdict:` line
  (`Approve | Request changes | Needs human decision`); a `task-id` reference.
- `templates/.ai/workflows/quality-gates.md` — when the gate applies, the
  scorecard procedure, the mandatory validation-evidence rule, and escalation
  when the reviewer returns `Request changes`.
- `templates/.ai/workflows/pre-merge-checklist.md` — sections for GitHub,
  GitLab, Bitbucket, and local-only repositories.
- `templates/.ai/ci/github-actions.example.yml` — CI example running
  `npx forgeai-init --check-all`, `--check-git`, plus lint/typecheck/test
  placeholders, so the gate blocks merges automatically.
- `templates/.ai/workflows/delegated-assignment.md` — add mandatory
  validation-evidence fields to the assignment return format so delegated
  results must carry evidence.
- `templates/.ai/WORKFLOW.md` §8 (Review) — point to the scorecard, the gate
  command, and the pre-merge checklist.
- `templates/.ai/README.md` — add the new files to the read order / file list
  where the other workflows are listed.

Note: files added under `templates/.ai/...` are copied into every project by
`runInit` and required by `runCheck` (this is intended — they are harness
files). `.ai/ci/...` installs to `<project>/.ai/ci/`.

## Testing

`test/review.test.ts` (Node test runner, mirrors `test/lifecycle.test.ts`
scaffolding via `test/helpers.ts`):

- `--check-review` passes when there are no journals in a gated state.
- Passes for a gated journal with real validation rows + filled scorecard +
  valid recommendation + no unresolved blockers.
- Fails when a gated journal has an empty/placeholder-only validation table.
- Fails when the scorecard file is missing.
- Fails when the scorecard still contains `TODO` or lacks a `Verdict:`.
- Fails when verdict is `Approve` but `Unresolved blockers:` is not `none`.
- Fails when the *Review Findings* table has no valid recommendation.
- Required-file checks fail when a required template is missing.

## Roadmap change

Phase 4 (plugin/marketplace layer) is dropped. Rationale: the plugin would be
Claude-Code-specific (the harness is model-agnostic), and its main "workflow
skill" would duplicate the `.ai/` markdown that repo `CLAUDE.md` already points
to, creating version drift. The few genuine plugin-only capabilities
(isolated-context sub-agent, auto-activation, slash commands) did not justify
the maintenance surface now. Phase 6 (quality gates) is brought forward because
it closes the missing validate/review link in the lifecycle Phase 2 built, is
model-agnostic, and directly serves the "reliability and reviewability"
north-star.

`.ai/MEMORY.md` records both: Phase 4 dropped (with rationale) and Phase 6
delivered.

## Acceptance criteria

- [ ] `forgeai-init --check-review` exists, documented in `usage()`, and wired
      into `--check-all`.
- [ ] Passes when no journals are in a gated state.
- [ ] Fails (exit 1) for a gated journal missing real validation evidence.
- [ ] Fails for a gated journal with a missing/TODO/verdict-less scorecard.
- [ ] Fails for an `Approve` verdict with unresolved blockers.
- [ ] Scorecard template, quality-gates workflow, pre-merge checklist, and CI
      example are added under `templates/`.
- [ ] `delegated-assignment.md` requires validation evidence in results.
- [ ] Real scorecards are preserved on `--upgrade`; `_template.md` still updates.
- [ ] `test/review.test.ts` covers pass and each failure mode; `npm test`
      passes (existing 56 tests + new ones).
- [ ] `.ai/MEMORY.md` records Phase 4 dropped and Phase 6 delivered.

## Definition of done

`npm test` green, `--check-review` behaves per acceptance criteria on manual
fixtures, docs updated, MEMORY updated, changes committed on
`feat/phase-6-quality-gates`.
