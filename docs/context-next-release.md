# Next release: useful context before initialization

Version: 3.17.0. See the [packaged CLI trial](context-3.16.0-trial.md) for
observed retrieval limitations and the next improvement to evaluate.

## Retrieval follow-up (2026-10-13, unreleased)

Address the trial's missing implementation before broadening the product:

- Search declaration source for objective terms within seed files, including
  private helpers. Keep symbol matches ahead of body matches.
- Prioritize matched declarations before test bodies and imports; break ties
  using the selector's evidence ranking rather than alphabetical file order.
- Report selected files without full implementation excerpts in Markdown.
  Contract-only files can legitimately appear in this list.

The local built CLI now includes full `routeCliAdapter` and `routeToAdapter`
declarations for `fix router fallback` within the default 6,000 estimated-token
budget. This addresses the observed omission; it does not establish task success
or token savings. Body matching remains lexical and can match comments or strings.
The external developer trials and comparable task evaluation below remain open.

Validation: `npm test` passed typecheck, build, and all 962 tests. The 27 focused
context-command and expansion tests also passed. A built-CLI smoke check confirmed
both router declarations above fit the default budget. Regression fixtures cover
test/import crowding, private body matches, deterministic output, estimated-budget
accounting, and reporting signature-only files.

## Scope

Deliver a single `context` command that prints usable code excerpts from an
existing repository. Reuse the dependency graph and compiler, preserve profile
exclusions, and require neither a model nor harness installation. Keep the full
workflow available as an optional next step.

## Acceptance criteria

- A fresh TypeScript repository produces source excerpts and provenance.
- Default execution leaves the repository unchanged and skips update checks.
- JSON output is a compiled artifact; Markdown explains budget limitations.
- No matches, invalid arguments, and budgets with no usable excerpts fail clearly.
- Explicit output creation never overwrites an existing file.
- Existing workflow tests continue to pass.

## Follow-up validation

The [local retrieval evaluation](context-retrieval-evaluation.md) now provides a
repeatable built-CLI measurement via `npm run --silent evaluate:context`. It
checks nine required implementations across five investigations and exposes
implementation misses rather than counting file selection as success. The initial
result was 4/5 cases and 6/9 implementations; declaration-name word normalization
now yields 5/5 and 9/9 with the same corpus and estimated budget. The strict
`npm run --silent evaluate:context -- --check` invocation passes.
This development tool does not replace the external trials below.

Before expanding features, observe five outside developers on their own tasks.
Record time to first usable context, missing necessary files, and repeat use.
Then compare 20 real tasks using the same model, revision, and acceptance checks
with and without ForgeAI. Measure task success, context expansion, elapsed time,
and provider-reported usage when available. Do not equate source exclusion with
token savings. Publishing the package and recruiting users are separate steps.

## Implementation validation (2026-10-12)

- `npm test`: typecheck, build, and all 941 tests passed.
- Targeted context/try/task integration checks: 64 tests passed.
- Built CLI smoke check on ForgeAI itself: `context "fix router fallback"
  --json` returned 12 selected files and 13 excerpts within the 6,000 estimated
  token artifact budget; omissions were explicitly reported.
- This verifies CLI behavior, not retrieval accuracy or end-to-end token savings.
