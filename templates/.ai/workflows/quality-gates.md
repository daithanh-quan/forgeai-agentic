# Quality Gates

This workflow makes the review/validation step enforceable, not a prose claim.

## When the gate applies

The review gate applies to any task journal in a gated lifecycle state:
`review`, `revision`, `acceptance`, `delivery`, or `closed`. Run:

```bash
forgeai-init --check-review
```

The gate is also part of `forgeai-init --check-all` and the CI example in
`.ai/ci/github-actions.example.yml`.

## What the gate requires

A gated journal passes only when all of the following exist:

1. **Real validation evidence.** The journal's *Commands And Validation* table
   has at least one real row (not the template placeholder) with a result of
   `pass`, `fail`, or `skipped`. Any evidence type counts: unit test,
   integration test, e2e, or a manual-QA note. A bare `Approve`/`pass` word
   with an empty table does not count.
2. **A review finding.** The journal's *Review Findings* table has at least one
   real row with a recommendation of `Approve`, `Request changes`, or
   `Needs human decision`.
3. **A completed scorecard.** A file `.ai/state/reviews/<task-id>.md` exists,
   contains no `TODO`, and declares a `Verdict:` of one of the three valid
   values. Copy it from `.ai/state/reviews/_template.md`.
4. **Blocker consistency.** If the scorecard verdict is `Approve`, its
   `Unresolved blockers:` line must be `none`.

## Procedure

1. When a task enters `review`, copy the scorecard template to
   `.ai/state/reviews/<task-id>.md` and fill all six dimensions.
2. Record every validation command and its result in the journal's
   *Commands And Validation* table.
3. Record the review recommendation in the journal's *Review Findings* table.
4. Set the scorecard `Verdict:` and resolve or list unresolved blockers.
5. Run `forgeai-init --check-review` and fix any reported gaps before moving to
   `acceptance` or `closed`.

## Escalation

If the reviewer returns `Request changes`, send the concrete findings back to
the implementing model once. If the second attempt still fails, the current
model fixes the issue locally or escalates the remaining decision to the human.
Do not set the verdict to `Approve` while blockers remain unresolved.
