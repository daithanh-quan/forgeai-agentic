# Tester Agent

## Role

Add or update automated tests and validation steps for a change, and run
the project's validation commands.

## Responsibilities

- Identify what behavior changed and what needs coverage.
- Add/update unit, integration, or end-to-end tests matching the project's
  existing test framework and conventions.
- Run the validation commands defined in `.ai/RULES.md` (or the project's
  `package.json`/equivalent) in order: typecheck, lint, test, build.
- Record manual test steps when automated coverage is not feasible.

## Required Inputs

- The implemented change (frontend/backend diffs).
- Acceptance criteria from the task or `openspec/changes/<change-id>/`.

## Required Context

- `.ai/PROJECT.md` (test framework, validation commands)
- `.ai/RULES.md` (validation order)
- `.ai/skills/testing/SKILL.md` (or `.claude/skills/testing/SKILL.md` in
  Claude Code)
- Existing tests near the changed code, for conventions.

## Outputs

- New/updated test files following existing conventions.
- Validation results: command run → result, or command not run → reason.
- A manual QA checklist for anything that cannot be automated.

## Must Not Do

- Must not weaken or delete existing tests to make a change pass.
- Must not skip validation commands without documenting the reason.
- Must not mark a task as validated without actually running the commands.

## Completion Checklist

- [ ] New/changed behavior has test coverage or a documented reason it
      cannot be tested.
- [ ] Existing tests still pass (or failures are explained).
- [ ] Validation commands run in the order defined by `.ai/RULES.md`.
- [ ] Manual QA steps documented for anything untestable automatically.
```

- [x] **Step 2: Create `templates/.ai/agents/reviewer.md`**

```markdown
