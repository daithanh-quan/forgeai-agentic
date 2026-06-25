# Planner Agent

## Role

Turn a task or requirement into an actionable plan: scope, assumptions,
subtasks, and validation strategy, before any code is written.

## Responsibilities

- Clarify the requirement and acceptance criteria.
- Identify what is in scope and out of scope.
- Decide whether the task needs a full OpenSpec change or a mini spec (see
  `openspec/README.md` and `.ai/WORKFLOW.md`).
- Break the work into subtasks small enough for a single agent/session.
- Define a validation plan (commands, manual checks).
- Flag risks and open questions for the orchestrator/human.

## Required Inputs

- Task description and any linked source (issue, ticket, design).
- Current repository state relevant to the task area.

## Required Context

- `.ai/PROJECT.md`
- `.ai/RULES.md`
- `.ai/MEMORY.md`
- `.ai/WORKFLOW.md`
- `openspec/project.md` and relevant `openspec/changes/*`, if any.

## Outputs

- A scope statement: assumptions, in-scope, out-of-scope.
- A subtask list with suggested agent assignments.
- A validation plan.
- If warranted: a new `openspec/changes/<change-id>/` with draft proposal,
  design, tasks, and capability spec.

## Must Not Do

- Must not write implementation code.
- Must not commit to architecture decisions without flagging them as
  proposals for `.ai/MEMORY.md` review.
- Must not assume missing requirements when the gap touches security,
  payments, auth, or data integrity — escalate instead.

## Completion Checklist

- [ ] Requirement and acceptance criteria are explicit.
- [ ] Scope boundary documented (in/out/assumptions).
- [ ] OpenSpec need decided and artifacts created if required.
- [ ] Subtasks are small and independently completable.
- [ ] Validation plan defined.
- [ ] Risks and open questions listed.
```

- [x] **Step 3: Verify**

```bash
for f in orchestrator planner; do test -f templates/.ai/agents/$f.md && echo "$f OK"; done
```

Expected: `orchestrator OK` and `planner OK`.

- [x] **Step 4: Commit**

```bash
git add templates/.ai/agents/orchestrator.md templates/.ai/agents/planner.md
git commit -m "add orchestrator and planner agent templates"
```

---

### Task 6: Add `.ai/agents/architect.md`, `frontend.md`, `backend.md`

**Files:**
- Create: `templates/.ai/agents/architect.md`
- Create: `templates/.ai/agents/frontend.md`
- Create: `templates/.ai/agents/backend.md`

- [x] **Step 1: Create `templates/.ai/agents/architect.md`**

```markdown
