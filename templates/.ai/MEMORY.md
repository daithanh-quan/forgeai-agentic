<!-- forgeai-memory: max-age-days=180 -->

# Project Memory

This file is durable project memory. Only record information that is
expected to remain true for weeks or months. Every agent session reads this
file before making changes, so a wrong entry here silently misleads all
future work.

## How to use this file

- Add an entry when the team makes a decision future agents must remember.
- Do not store temporary task notes here; use `.ai/state/CURRENT.md`.
- Date decision entries as `### YYYY-MM-DD — Title`. The directive at the
  top of this file sets when entries are flagged for re-validation by
  `npx forgeai-agentic-init --check-memory` (default: 180 days).
- When the checker flags an entry, re-validate it: update the date if it
  still holds, rewrite it if it changed, delete it if it is superseded.
  See `.ai/workflows/memory-management.md`.

## Architecture decisions

### YYYY-MM-DD — Decision title

- **Decision:** TODO
- **Why:** TODO
- **Impact:** TODO

## Coding conventions

- TODO: Example: feature API clients follow `src/features/*/*Api.ts`.
- TODO: Example: shared UI components live under a `<components-dir>` folder.
- TODO: Example: use named exports for utilities.

## Business rules

- TODO: Rule that must not be broken by future agents.

## Recurring bugs & pitfalls

Record bugs or patterns that happened before so agents do not repeat them.

| Date | Pitfall | Prevention |
| --- | --- | --- |
| TODO | TODO | TODO |

## Commands

Repo-specific commands agents must use instead of guessing.

| Purpose | Command | Notes |
| --- | --- | --- |
| Build | TODO | TODO |
| Test | TODO | TODO |
| Lint | TODO | TODO |

## Test strategy

- TODO: What must be run before a change is considered validated.
- TODO: Where tests live and how new ones should be structured.
- TODO: Coverage or evidence expectations for the review gate.

## Ownership

| Area | Owner | Notes |
| --- | --- | --- |
| TODO | TODO | TODO |

## Deployment notes

- TODO: How releases are cut and what must be checked first.
- TODO: Environments and their differences.
- TODO: Rollback procedure.
