---
name: testing
description: Use this skill when adding or updating automated tests, running validation commands, or documenting manual QA steps for a change.
---

# Testing Skill

## Purpose

Ensure changes have adequate test coverage and validation evidence before
review.

## Read First

- `.ai/PROJECT.md`
- `.ai/RULES.md`
- `.ai/agents/tester.md`

## Workflow

### 1. Identify what changed

- New/changed functions, endpoints, components, or behaviors.
- Edge cases implied by the acceptance criteria.

### 2. Match existing test conventions

- Find existing tests near the changed code.
- Reuse fixtures/mocks/helpers already in the project.

### 3. Practice TDD (Red -> Green -> Refactor)

- Write the failing test before changing implementation code (or to reproduce a bug).
- See the test fail for the reason you expect.
- Make the smallest code change that makes the test pass, then refactor.
- Cover the happy path and the edge cases from the acceptance criteria.
- For UI: cover loading, error, and empty states where applicable.
- For APIs: cover success and key error responses.
- If an honest automated test is impractical, do not write a bad one; document manual QA instead.

### 4. Test behavior, not implementation

- Call the code the way its caller/user does and check the observable result.
- If a test would still pass when every target function returned nothing, throw it out.
- Avoid coupling tests to private helpers or internal mock call counts when observable outputs exist.

### 5. Run validation

Run, in order:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

If the project uses pnpm/yarn/bun, use the matching commands. If a command
does not exist, note that and choose the closest equivalent from
`package.json`.

### 6. Document results

- Command run → result.
- Command not run → reason.
- Manual QA steps for anything not covered by automated tests.

## Output Checklist

- [ ] New/changed behavior has test coverage or a documented reason it
      cannot be tested.
- [ ] Existing tests still pass.
- [ ] Validation commands run in order, results recorded.
- [ ] Manual QA steps documented where needed.
