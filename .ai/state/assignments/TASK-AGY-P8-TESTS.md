## Assignment
- ID: TASK-AGY-P8-TESTS
- Role: tester
- Objective: Write test files for three new Phase 8 CLI modules:
  `--check-approval`, `--check-evaluation`, and `--decompose`. Follow the
  exact patterns used in the existing test suite.
- Model tier: fast
- Token budget: 4000
- Session ID: agt-p8-tests

## Allowed context
- This assignment file only.
- Read-only access to:
  - `test/memory.test.ts` — reference pattern for check tests
  - `test/helpers.ts` — test utilities
  - `bin/lib/approval.ts` — module under test
  - `bin/lib/evaluation.ts` — module under test
  - `bin/lib/decompose.ts` — module under test

## Coordination scope
- Read scope: `test/`, `bin/lib/approval.ts`, `bin/lib/evaluation.ts`, `bin/lib/decompose.ts`
- Write scope: `test/approval.test.ts`, `test/evaluation.test.ts`, `test/decompose.test.ts`
- Parallel safety: independent

## Constraints
- Use `node:test` and `node:assert/strict` exactly as in existing tests.
- Use `runTs(cli, [...], { cwd: target })` from `./helpers.js`.
- Each test file must have at least two tests: one passing case and one failing case.
- Do not use vitest, jest, or any other test framework.
- Do not install new packages.

## Key behaviours to test

### approval.test.ts
- Pass: no task journals in `.ai/state/tasks/` → `approval gate satisfied`
- Pass: task journal with high-risk keyword but with `## Approval` section + date → ok
- Fail: task journal with `auth` keyword in `review` state, no `## Approval` section → exit code 1

### evaluation.test.ts
- Pass: `.ai/evaluation/` dir does not exist → `evaluation check passed (no runs to validate)`
- Pass: valid run file with all required fields → ok
- Fail: run file missing required `Mode` field → exit code 1, `missing required field: Mode`

### decompose.test.ts
- Pass: `--decompose --objective "add login form"` → output contains `Scoring Table` and `Subtask 1`
- Fail: `--decompose` without `--objective` → exit code 2

## Validation
- Confirm three files are created and non-empty.
- Tests should pass when run as part of `npm test`.

## Return format
- Files changed: list each file
- Summary: one sentence per test file describing what is tested
- Validation result: confirm tests compile (TypeScript)
- Risks: any assumptions made
