# Agentic Workflow

This file defines the default flow from task intake to human review.

## Overview

```text
Task intake
  -> Triage
  -> Clarify scope
  -> Decide if spec is needed
  -> Plan subtasks
  -> Score and route subtasks
  -> Route to agent/skill
  -> Implement
  -> Validate
  -> Review
  -> Human approval
  -> Delivery
  -> Memory update
  -> Closure
```

For resumable, delegated, risky, or multi-step work, use
`.ai/workflows/lifecycle-management.md` and create a task journal from
`.ai/state/tasks/_template.md`. Use `.ai/state/lifecycle.md` for state names,
transition criteria, stale-task detection, and closure rules.

## 1. Task intake

The agent collects:

- Source: Jira, GitHub issue, Bitbucket PR, Notion, Trello, manual request, or design link.
- Requirement.
- Acceptance criteria.
- Screenshots/design links if any.
- Related files if known.
- Deadline/priority if any.

Use `.ai/workflows/task-intake.md` as the template.

For long-running work, create or update the task journal during intake and set
its state to `intake`.

## 1a. Triage lifecycle type and state

Classify the work before planning:

- Task type: `bug`, `feature`, `refactor`, `research`, `audit`, `incident`,
  `release`, or `dependency-upgrade`.
- Lifecycle state: use `.ai/state/lifecycle.md`.
- Task-type template: use `.ai/workflows/task-types/<type>.md`.
- Journal: create `.ai/state/tasks/<task-id>.md` when the task is delegated,
  risky, resumable, multi-step, or needs durable validation evidence.

Move from `intake` to `triage` only after source, priority, affected area,
and initial acceptance criteria are recorded.

## 2. Clarify scope

If information is missing, the agent should not stop immediately. The agent writes:

```markdown
## Assumptions
- Assumption 1

## Safe minimal scope
- Smallest implementation that satisfies the task

## Out of scope
- What will not be changed
```

Only ask the human when missing information could cause data loss, change a major business rule, or affect security/payment/auth.

## 3. Decide if OpenSpec is needed

Small tasks can use a mini spec in the response.

Medium or large tasks should create an OpenSpec-style change:

```text
openspec/changes/<change-id>/
  proposal.md
  design.md
  tasks.md
  specs/<capability>.md
```

Use OpenSpec when the task changes behavior, adds a feature, changes an API contract, or creates a new workflow.

## 4. Plan subtasks

The plan should be short and executable:

```markdown
- [ ] Inspect current implementation
- [ ] Update types/contracts
- [ ] Implement UI/API changes
- [ ] Add or update tests
- [ ] Run validation
- [ ] Prepare review summary
```

Move from `planning` to `assignment` only when scope, assumptions, subtasks,
and validation are explicit in the response, OpenSpec artifact, or task journal.

## 5. Score and route subtasks

Follow `.ai/MODEL_ROUTING.md` and `.ai/model-routing.yaml`.

- Score complexity, risk, ambiguity, and context for each subtask.
- Apply minimum-tier overrides for architecture and sensitive work.
- Give delegated models bounded assignments and only required context.
- For parallel work, the orchestrator records each active session in
  `.ai/state/sessions.md` with read/write scope and runs
  `forgeai-init --check-sessions`.
- Route by `.ai/model-routing.yaml`. By default, scores `0-2` go to the fast
  tier, scores `3-5` to the standard tier, scores `6-8` to the strong tier,
  and scores `9-10` stay with the current orchestrator.
- Send delegated output to the configured reviewer before final delivery. If
  no dedicated reviewer is available, the current orchestrator performs the
  review using `.ai/skills/code-review/SKILL.md`.

If the environment cannot invoke the selected model, use the configured
fallback instead of blocking the task. The default fallback is for the current
model to execute the bounded assignment locally.

If session write scopes overlap, do not run those assignments in parallel.
Narrow the write scopes, sequence the work, or ask the human which session
owns the shared files.

## 5a. Branch and worktree naming

When the workflow requires a branch or worktree, use a semantic branch name
based on the task type, not the agent identity:

```text
feat/<short-slug>
fix/<short-slug>
docs/<short-slug>
refactor/<short-slug>
test/<short-slug>
chore/<short-slug>
perf/<short-slug>
ci/<short-slug>
build/<short-slug>
```

Examples:

```bash
git worktree add ../.worktrees/forgeai-check -b feat/forgeai-check origin/main
git worktree add ../.worktrees/router-fallback -b fix/router-fallback origin/main
```

If `git remote -v` has no GitHub, GitLab, Bitbucket, or other remote, do not
block the task. Create a local branch from the current checked-out branch:

```bash
git switch -c feat/forgeai-check
```

If using worktrees without a remote base, create the worktree from the current
local branch or an explicit local base branch:

```bash
git worktree add ../.worktrees/forgeai-check -b feat/forgeai-check main
```

Do not push or create a PR/MR until the human connects a remote and
authenticates the provider CLI. If a remote exists but `gh`, `glab`, `bb`, or
provider authentication is missing, complete local validation and report the
exact push and PR/MR command for the human to approve or run after login.

Use lowercase kebab-case unless preserving an external issue id such as
`feat/PROJ-123-agentic-check`. Do not use `agent/...` branch names.

Commit messages must follow Conventional Commits:

```text
feat: add forgeai check command
fix(router): fall back when adapter is missing
docs: document dynamic orchestration
```

## 6. Implementation

Before implementation, check whether `.ai/profiles/<profile>.md` or a
profile-specific skill exists for the detected stack. Profile guidance is
additive: apply it together with the shared role and skill files unless the
profile explicitly states that it replaces a shared skill.

Agents should work in small steps. Each step should have a checkpoint:

- What changed?
- Why was it needed?
- What should be tested?

## 6a. Token-efficient shell usage

When `rtk` is installed, prefer RTK wrappers for high-output shell commands so
large command output is filtered before it enters model context:

```bash
rtk git status
rtk git diff
rtk grep "pattern" .
rtk read path/to/file
rtk test npm test
```

If `rtk` is not installed, run the original command. Token optimization must
not block implementation, validation, or review.

## 7. Validation

Prefer commands already defined in `package.json`.

Before committing, inspect project hooks when present:

```bash
ls .husky
git config --get core.hooksPath
```

If Husky, lint-staged, pre-commit, Lefthook, or another hook runner is
configured, run the equivalent checks before committing. Common commands are:

```bash
npm run lint-staged
npm run format
npm run lint -- --fix
pre-commit run --all-files
```

Use the package manager and commands actually configured by the repository.
If a hook changes files, inspect the diff and rerun validation. Do not use
`git commit --no-verify` unless the human explicitly approves it.

When validation output is large and `rtk` is available, prefer:

```bash
rtk test <validation command>
```

If validation cannot run, document:

- Command attempted.
- Main error.
- Why the agent did not continue fixing it in this task scope.

Record validation evidence in the task journal before moving to `review`.

## 8. Review

The review agent checks:

- Scope control.
- Type safety.
- Error handling.
- Test coverage or manual validation.
- Security concerns.
- Migration/API risks.

If the configured reviewer returns `Request changes`, send the concrete
findings back to the implementing model once. If the second attempt still
fails, the current model fixes the issue locally or escalates the remaining
decision to the human.

## 9. Human approval

The final result should be easy for a human to review:

```markdown
## Summary
## Key files
## Validation
## Risks / follow-up
```

## 10. Delivery, memory update, and closure

Before closing a task:

- Delivery notes summarize changed files, validation, review status, risks, and
  follow-up.
- `.ai/MEMORY.md` is updated only for durable project knowledge: architecture
  decisions, recurring pitfalls, stable commands, test strategy, or owner/team
  preferences.
- Temporary details stay in `.ai/state/tasks/<task-id>.md`.
- Active session rows in `.ai/state/sessions.md` are marked `done` or removed.
- The task journal is moved to `closed` with final outcome and date.
