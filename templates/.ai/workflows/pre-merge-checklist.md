# Pre-Merge Checklist

Run before requesting merge. The review gate (`forgeai-init --check-review`)
covers evidence and scorecard; this checklist covers the surrounding hygiene.

## All repositories

- [ ] `forgeai-init --check-all` passes (harness, codegraph, lifecycle, profile,
      review gate).
- [ ] Lint, typecheck, and tests pass, or the reason they could not run is
      documented in the journal.
- [ ] Scope matches the task; no unrelated files changed.
- [ ] Scorecard `Verdict:` is set and consistent with unresolved blockers.
- [ ] Delivery notes list changed files, validation, risks, and follow-up.

## GitHub

- [ ] Branch pushed and PR opened with the delivery summary.
- [ ] Required status checks green.
- [ ] At least one approving review or documented human decision.

## GitLab

- [ ] MR opened with the delivery summary.
- [ ] Pipeline green.
- [ ] Approvals satisfied.

## Bitbucket

- [ ] PR opened with the delivery summary.
- [ ] Pipelines green.
- [ ] Required reviewers approved.

## Local-only (no remote)

- [ ] Commits are Conventional-Commit formatted on a semantic branch.
- [ ] Report the exact push/PR command for the human to run after connecting a
      remote.
