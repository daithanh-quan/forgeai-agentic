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
- Do not use agent-owned branch prefixes such as `agent/...`.
- Branch names must describe the work type using semantic prefixes:
  `feat/<short-slug>`, `fix/<short-slug>`, `docs/<short-slug>`,
  `refactor/<short-slug>`, `test/<short-slug>`, `chore/<short-slug>`,
  `perf/<short-slug>`, `ci/<short-slug>`, or `build/<short-slug>`.
- Use lowercase kebab-case slugs. Include an issue/task id when available:
  `feat/PROJ-123-agentic-check`, `fix/GH-42-router-fallback`.
- Prefer one task per branch/worktree.
- If no remote is configured, keep work local: create a semantic local branch
  from the current base branch, do not push, and do not attempt PR/MR creation.
- If a remote exists but provider authentication is unavailable, finish local
  validation and tell the human which push/PR/MR command to run after login.
- Never commit directly to protected branches such as `main`, `master`,
  `production`, or `release/*` unless the human explicitly requests it.
- Commit messages must follow Conventional Commits:
  `feat: add harness check`, `fix(router): handle missing adapter`,
  `docs: update bootstrap flow`.
- Use `!` for breaking changes and include a footer when needed:
  `feat!: change routing config shape` plus `BREAKING CHANGE: ...`.
- Respect repository git hooks. If Husky, lint-staged, pre-commit, Lefthook,
  or another hook runner is configured, run the same checks before committing.
- Do not bypass hooks with `--no-verify` unless the human explicitly approves
  and the final response documents the reason and risk.
- If a hook fails because of formatting, run the repository's formatter or
  lint fix command, inspect the diff, and rerun the hook/validation.
- Every PR/task should include summary and test evidence.

## Token-output rules

- Prefer compact shell output when it preserves enough evidence to make a
  correct engineering decision.
- If `rtk` is installed, use it for noisy commands such as `git status`,
  `git diff`, repository search, file reads through shell, and test runners.
- If `rtk` is missing or its output is too compact for the task, use the
  original command and document the relevant result.
- Never let token optimization hide failing tests, security issues, migration
  risk, or reviewer findings.

## Validation order

Agents should prefer running commands in this order:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

If the project uses pnpm/yarn/bun, use the package manager that matches the lockfile.
If `rtk` is available and output is expected to be large, wrap validation with
`rtk test <command>`.

If git hooks are configured, agents should also inspect and run the relevant
pre-commit checks before creating a commit:

```bash
ls .husky
npm run lint-staged
npm run format
npm run lint -- --fix
```

Only run commands that exist in the project. If the hook invokes a different
tool such as `pnpm lint-staged`, `yarn lint-staged`, `bun lint-staged`, or
`pre-commit run --all-files`, use the command configured by the repository.

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
