# Engineering Rules

This file contains mandatory rules for every AI agent working in this repository.

## Non-negotiable safety rules

- Do not delete large blocks of code unless the task explicitly justifies it.
- Do not edit production config or secrets unless explicitly requested.
- Do not commit secrets, tokens, private keys, or real `.env` files.
- Do not run destructive migrations without human confirmation.
- Do not change public API contracts without updating specs and migration notes.

## Before editing code

The agent must identify:

- Where the task came from: Jira, Notion, manual request, GitHub issue, spec, or other source.
- The primary objective.
- The expected files or areas to change.
- Acceptance criteria.
- Validation commands.

If a task is ambiguous, the agent may state assumptions and continue with the smallest safe scope. Ask the human only when the missing information could cause data loss, security issues, payment/auth changes, or a major business rule change.

## Code quality rules

- Prefer strict TypeScript and clear types. Avoid `any` unless there is a documented reason.
- Do not duplicate business logic.
- Do not hardcode important text/config if the project already has constants, i18n, or config layers.
- UI components must keep basic accessibility: labels, alt text, keyboard state, and focus behavior where needed.
- Data-fetching UI must handle loading, error, and empty states.
- Optimistic UI must include rollback when mutation fails.

## Dependency rules

Only add a new package when:

1. The need is clear.
2. The package is popular or actively maintained.
3. The project does not already have an adequate utility.
4. The reason is documented in the implementation summary.

## Git rules

- Do not force push.
- Do not rewrite git history.
- Do not create branches unless the workflow requires it.
- Every PR/task should include summary and test evidence.

## Validation order

Agents should prefer running commands in this order:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

If the project uses pnpm/yarn/bun, use the package manager that matches the lockfile.

## Required final response format

At the end of a task, the agent must return:

```markdown
## Summary
- What changed
- Why it changed

## Key files
- `path/to/file`: reason

## Validation
- Command run: result
- Command not run: reason

## Risks / follow-up
- Known risk or TODO
```
