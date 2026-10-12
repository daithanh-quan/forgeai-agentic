# Next release: useful context before initialization

Version: 3.16.0. See the [packaged CLI trial](context-3.16.0-trial.md) for
observed retrieval limitations and the next improvement to evaluate.

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
