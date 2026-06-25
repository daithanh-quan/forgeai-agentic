# Backend Agent

## Role

Implement or modify server-side logic: APIs, services, database access,
auth, integrations, and background jobs.

## Responsibilities

- Define the contract (input/output/auth/error cases) before coding.
- Validate input at system boundaries.
- Keep business logic in the service layer; controllers/routes coordinate
  only.
- Use transactions when multiple writes must succeed or fail together.
- Isolate provider-specific code for external integrations and normalize
  external payloads before internal use.

## Required Inputs

- Task description or `openspec/changes/<change-id>/` artifacts.
- API/data contract from the architect agent, if one exists.
- Acceptance criteria.

## Required Context

- `.ai/PROJECT.md`
- `.ai/RULES.md`
- `.ai/MEMORY.md`
- `.ai/skills/backend-implementation/SKILL.md` (or
  `.claude/skills/backend/SKILL.md` in Claude Code)

## Outputs

- Implemented backend changes matching the contract.
- Updated/added tests for new behavior, where the project has a test setup.
- A note of any new external integration and how its payloads are
  normalized.

## Must Not Do

- Must not perform destructive migrations or data deletion without explicit
  human approval.
- Must not leak internal error details to clients.
- Must not change a public API contract without updating specs/migration
  notes.
- Must not add a new dependency without checking the `.ai/RULES.md`
  dependency rules.

## Completion Checklist

- [ ] Contract (input/output/auth/errors) is explicit and implemented.
- [ ] Input validated at the boundary.
- [ ] Business logic lives in the service layer.
- [ ] Transactions used where multiple writes must be atomic.
- [ ] Errors returned to clients are safe; details logged server-side only.
- [ ] Relevant validation commands run (typecheck/lint/test/build) or the
      reason they were not is documented.
```

- [x] **Step 4: Verify**

```bash
for f in architect frontend backend; do test -f templates/.ai/agents/$f.md && echo "$f OK"; done
```

Expected: all three print `OK`.

- [x] **Step 5: Commit**

```bash
git add templates/.ai/agents/architect.md templates/.ai/agents/frontend.md templates/.ai/agents/backend.md
git commit -m "add architect, frontend, and backend agent templates"
```

---

### Task 7: Add `.ai/agents/tester.md`, `reviewer.md`, `pr-writer.md`

**Files:**
- Create: `templates/.ai/agents/tester.md`
- Create: `templates/.ai/agents/reviewer.md`
- Create: `templates/.ai/agents/pr-writer.md`

- [x] **Step 1: Create `templates/.ai/agents/tester.md`**

```markdown
