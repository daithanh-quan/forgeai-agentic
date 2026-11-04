# Local context retrieval evaluation

Run from this development checkout (after installing dependencies):

```bash
npm run --silent evaluate:context
```

The command builds the CLI and prints a JSON report for five investigations in
the ForgeAI repository. It does not initialize a harness, invoke a model, or
write a report into the repository. The build updates the ignored `dist/` folder.
To retain a snapshot, redirect stdout to a new report path outside the repository.

For an optional strict gate:

```bash
npm run --silent evaluate:context -- --check
```

The default command reports retrieval misses without failing. `--check` exits 1
if any required implementation is missing or incomplete. Both modes fail on CLI
errors, inconsistent repository fingerprints, or invalid budget accounting.
The strict gate now passes all five local cases after the symbol-matching update
below. It remains a separate development command from `npm test`, since coverage
on the evolving ForgeAI source tree is distinct from fixture-based regression tests.

## What is measured

The corpus in `scripts/context-retrieval.ts` specifies objectives, required
symbols, and rationales. These are investigation requirements, not the symbols
the retriever happens to return. Change expectations only when the task or source
structure changes; increment `corpus_version` when changing the corpus.

Each requirement records whether its file was selected and whether the named
declaration was returned in full, signature-only, missing, or with invalid source
provenance. Full excerpts must agree with the reported source lines. Merely
selecting the file, returning an import, or returning a signature does not count
as implementation coverage. The report also checks the serialized artifact's
character-based estimate against its declared estimate and the 6,000-token budget.

Reports include repository revision and source fingerprint for each case.
Keep these when comparing changes. Working-tree diagnostics also consume budget,
so compare equivalent working-tree states and retain the original reports.

## Initial observation (2026-10-13)

| Investigation | Required implementations | Full implementations |
| --- | ---: | ---: |
| Router fallback | 2 | 2 |
| Context budget estimation | 3 | 0 |
| Profile detection | 1 | 1 |
| Task validation | 2 | 2 |
| Source import analysis | 1 | 1 |

Four of five investigations retrieved every required implementation; six of
nine required implementations were present. All five respected the estimated
budget. The budget-estimation case selected `context-compiler.ts` but omitted
`estimateTokens`, `stableArtifactEstimate`, and `computeArtifactEstimate`.

Validation: typecheck, build, and all 947 tests passed. The default evaluator
completed successfully; the strict invocation returned exit code 1 for the
documented missing implementations.

This exposed a retrieval problem: `estimation` did not match names containing
`Estimate`, so broad words such as `context` and `budget` took priority over the
helper implementations that perform estimation.

## Symbol-matching update (2026-10-13)

Declaration-name matching now splits camelCase, acronym boundaries, and
snake_case, then compares limited English word stems. For example, `estimation`
matches `estimateTokens` and `stableArtifactEstimate`, and `detection` matches
`detectProjectProfile`. Existing substring matching is preserved. The additional
matching only applies inside already selected files; it does not broaden the
file-selection or exclusion policy, and it is not semantic translation.

| Metric | Before | After |
| --- | ---: | ---: |
| Investigations with all required implementations | 4/5 | 5/5 |
| Required implementations returned in full | 6/9 | 9/9 |
| Cases within the estimated 6,000-token budget | 5/5 | 5/5 |

The objectives, nine required symbols, corpus version, and budget were unchanged.
All three previously missing estimation helpers are now included in full.
Independent TypeScript and Python fixtures exercise private helpers with different
names, source fidelity, deterministic output, budgets, and read-only execution.
Matcher tests also cover acronym boundaries, existing exact queries, and unrelated
words that must not match. Limited suffix normalization can still miss irregular
English forms or introduce false positives; this is not a general language model.

Validation after the update: typecheck, build, and all 951 tests passed. All eight
focused matching/context-command tests passed, including the two-language fixture.
The strict evaluator returned exit code 0 with all five cases passing.

## Limits and next validation

This is a small, manually labeled self-repository corpus. Coverage does not show
that the context is sufficient to fix a task, that included code is all relevant,
or that an agent succeeds. It measures no provider tokens, cost, or token savings.
Unit tests validate the evaluator's treatment of signatures, imports, provenance,
and budgets; they do not turn these five observations into an external benchmark.

Next, observe five outside developers on their own repositories and collect
required files/symbols before running retrieval. Then compare 20 real tasks with
and without ForgeAI using the same model, revision, and acceptance checks, as
described in [the delivery plan](context-next-release.md). Record missing context,
task success, elapsed time, and provider usage where available. Those trials have
not been run by this local evaluation.
