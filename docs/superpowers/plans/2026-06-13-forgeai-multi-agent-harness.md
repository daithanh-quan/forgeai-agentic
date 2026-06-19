# ForgeAI Multi-Agent Harness Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ForgeAI markdown harness work out-of-the-box with Claude Code, Codex, AGY CLI, Cline, RooCode, and Aider, while staying model-agnostic and backward compatible with the existing `npx forgeai-agentic-init` CLI.

**Architecture:** All new/changed content lives under `templates/`, which the existing `bin/forgeai-init.js` copies verbatim (recursively, preserving directory structure) into the target project root. No CLI code changes are needed — adding `templates/CLAUDE.md`, `templates/AGENTS.md`, `templates/.ai/agents/*`, and `templates/.claude/skills/*` automatically makes the installer emit those paths. The plan: (1) add root pointer files (`CLAUDE.md`, `AGENTS.md`) that any tool can auto-discover, (2) rename `.ai/AGENTS.md` → `.ai/AGENT_REGISTRY.md` to remove the naming collision with Codex's root `AGENTS.md`, (3) add 8 reusable agent role templates under `.ai/agents/`, (4) split skills into model-agnostic (`.ai/skills/`) vs. Claude-native (`.claude/skills/`) with thin Claude wrappers pointing back to the canonical docs, (5) add `.ai/BOOTSTRAP.md` for first-run context population, (6) annotate `.ai/PROJECT.md` placeholders with discovery instructions, (7) update both READMEs to document the new layout and bootstrap flow.

**Tech Stack:** Plain Markdown templates copied by a Node.js CLI (`bin/forgeai-init.js`, already implemented, no changes required). Verification is done via `node ./bin/forgeai-init.js --dry-run` / `--force` against a scratch directory plus `grep` checks — there is no test framework in this repo.

---

## File Structure

```
forgeai-agentic-mvp/
├── README.md                                  (MODIFY - "What gets installed" + new "After Initialization" section)
└── templates/
    ├── CLAUDE.md                              (NEW - root pointer for Claude Code)
    ├── AGENTS.md                              (NEW - root pointer for Codex)
    ├── .ai/
    │   ├── README.md                          (MODIFY - read order, naming note, skills dual-mode)
    │   ├── AGENT_REGISTRY.md                  (RENAMED from AGENTS.md, header updated)
    │   ├── BOOTSTRAP.md                       (NEW - first-run guide for any agent)
    │   ├── PROJECT.md                         (MODIFY - add discovery-guidance comments)
    │   ├── agents/
    │   │   ├── orchestrator.md                (NEW)
    │   │   ├── planner.md                     (NEW)
    │   │   ├── architect.md                   (NEW)
    │   │   ├── frontend.md                    (NEW)
    │   │   ├── backend.md                     (NEW)
    │   │   ├── tester.md                      (NEW)
    │   │   ├── reviewer.md                    (NEW)
    │   │   └── pr-writer.md                   (NEW)
    │   └── skills/
    │       └── testing/SKILL.md               (NEW - model-agnostic testing skill, referenced by tester.md)
    └── .claude/
        └── skills/
            ├── frontend/SKILL.md               (NEW - thin pointer to .ai/skills/frontend-implementation)
            ├── backend/SKILL.md                (NEW - thin pointer to .ai/skills/backend-implementation)
            ├── testing/SKILL.md                (NEW - thin pointer to .ai/skills/testing)
            └── reviewer/SKILL.md               (NEW - thin pointer to .ai/skills/code-review)
```

No existing files are deleted except via rename. `templates/openspec/*`, `templates/.ai/RULES.md`, `templates/.ai/TASTE.md`, `templates/.ai/WORKFLOW.md`, `templates/.ai/MEMORY.md`, `templates/.ai/state/CURRENT.md`, `templates/.ai/workflows/task-intake.md`, and the existing `.ai/skills/*-implementation` and `code-review`/`spec-planning` skills are untouched. `bin/forgeai-init.js` is untouched.

---

### Task 1: Rename `.ai/AGENTS.md` → `.ai/AGENT_REGISTRY.md`

**Files:**
- Rename: `templates/.ai/AGENTS.md` → `templates/.ai/AGENT_REGISTRY.md`

- [ ] **Step 1: Rename the file with git**

```bash
git mv templates/.ai/AGENTS.md templates/.ai/AGENT_REGISTRY.md
```

- [ ] **Step 2: Update the header to clarify the naming split**

Replace the first 4 lines of `templates/.ai/AGENT_REGISTRY.md`:

Old:
```markdown
# Agents

This file describes agent roles and task routing. It is model-agnostic and can be used with Claude, Codex, Cursor, local models, or custom orchestration.
```

New:
```markdown
# Agent Registry

> **Naming note:** the root-level `AGENTS.md` follows the Codex convention
> (a short pointer with repo-wide instructions for any AI coding agent).
> This file, `.ai/AGENT_REGISTRY.md`, defines ForgeAI's own internal agent
> roles, routing, and model strategy. Read the root file first to learn
> where to start, then read this file to learn which role to play.

This file describes agent roles and task routing. It is model-agnostic and can be used with Claude Code, Codex, AGY CLI, Cline, RooCode, Aider, or custom orchestration.

For detailed per-role templates (responsibilities, required inputs/outputs,
completion checklists), see `.ai/agents/*.md`.
```

Leave the rest of the file (Orchestrator/Frontend/Backend/Spec/Review agent sections, model routing table, human review gate) unchanged.

- [ ] **Step 3: Verify**

```bash
ls templates/.ai/ | grep -E '^AGENT'
```

Expected: only `AGENT_REGISTRY.md` is listed (no `AGENTS.md`).

- [ ] **Step 4: Commit**

```bash
git add templates/.ai/AGENT_REGISTRY.md
git commit -m "rename .ai/AGENTS.md to .ai/AGENT_REGISTRY.md to avoid Codex naming collision"
```

---

### Task 2: Add root `templates/CLAUDE.md` pointer file

**Files:**
- Create: `templates/CLAUDE.md`

- [ ] **Step 1: Create the file**

```markdown
# CLAUDE.md

This project was initialized with the ForgeAI agentic harness (`.ai/`).

Before making any code changes, read these files in order:

1. `.ai/README.md` — harness overview and full recommended read order
2. `.ai/PROJECT.md` — project identity, stack, architecture, constraints
3. `.ai/RULES.md` — mandatory engineering and safety rules
4. `.ai/MEMORY.md` — durable decisions, conventions, known pitfalls
5. `.ai/TASTE.md` — style and communication preferences
6. `.ai/WORKFLOW.md` — task intake to human review flow

For agent roles and routing, see `.ai/AGENT_REGISTRY.md` and the per-role
templates in `.ai/agents/`.

If `.ai/PROJECT.md` still contains `TODO` placeholders, follow
`.ai/BOOTSTRAP.md` before starting implementation work.

## Skills

- Model-agnostic guidance for any agent: `.ai/skills/*/SKILL.md`
- Claude Code native skills (auto-discoverable): `.claude/skills/*/SKILL.md`
```

- [ ] **Step 2: Verify**

```bash
test -f templates/CLAUDE.md && head -1 templates/CLAUDE.md
```

Expected: `# CLAUDE.md`

- [ ] **Step 3: Commit**

```bash
git add templates/CLAUDE.md
git commit -m "add root CLAUDE.md pointer for Claude Code auto-discovery"
```

---

### Task 3: Add root `templates/AGENTS.md` pointer file

**Files:**
- Create: `templates/AGENTS.md`

- [ ] **Step 1: Create the file**

```markdown
# AGENTS.md

This project was initialized with the ForgeAI agentic harness (`.ai/`).

Before making any code changes, read these files in order:

1. `.ai/README.md` — harness overview and full recommended read order
2. `.ai/PROJECT.md` — project identity, stack, architecture, constraints
3. `.ai/RULES.md` — mandatory engineering and safety rules
4. `.ai/MEMORY.md` — durable decisions, conventions, known pitfalls
5. `.ai/TASTE.md` — style and communication preferences
6. `.ai/WORKFLOW.md` — task intake to human review flow

## Naming note

This root `AGENTS.md` follows the Codex convention: a short, repo-level
entry point that any AI coding agent reads automatically. ForgeAI's own
agent role definitions and model-routing strategy live separately in
`.ai/AGENT_REGISTRY.md` (with per-role detail in `.ai/agents/*.md`) — read
that for sub-agent responsibilities, not this file.

If `.ai/PROJECT.md` still contains `TODO` placeholders, follow
`.ai/BOOTSTRAP.md` before starting implementation work.
```

- [ ] **Step 2: Verify**

```bash
test -f templates/AGENTS.md && head -1 templates/AGENTS.md
```

Expected: `# AGENTS.md`

- [ ] **Step 3: Commit**

```bash
git add templates/AGENTS.md
git commit -m "add root AGENTS.md pointer for Codex auto-discovery"
```

---

### Task 4: Add `.ai/BOOTSTRAP.md`

**Files:**
- Create: `templates/.ai/BOOTSTRAP.md`

- [ ] **Step 1: Create the file**

```markdown
# Bootstrap Instructions

This file guides any AI coding agent (Claude Code, Codex, AGY CLI, Cline,
RooCode, Aider, or other) through first-run setup of a project that was just
initialized with `npx forgeai-agentic-init`.

## 1. Files to Read First

Read in this order before doing anything else:

1. `.ai/README.md`
2. `.ai/PROJECT.md`
3. `.ai/RULES.md`
4. `.ai/MEMORY.md`
5. `.ai/TASTE.md`
6. `.ai/WORKFLOW.md`
7. `.ai/AGENT_REGISTRY.md`

## 2. Files to Populate

These files ship with placeholders. Fill them in from the real repository —
never from assumptions:

- **`.ai/PROJECT.md`** — project identity, stack, architecture, important
  directories. Each section now contains an HTML comment describing where
  to find the answer (e.g. `package.json`, lockfiles, config files, folder
  layout). Remove each comment once that section is filled in.
- **`.ai/MEMORY.md`** — keep the structure intact; add entries only for
  decisions or conventions that are already true today (something you
  discovered in the existing code). Do not invent future decisions.
- **`.ai/AGENT_REGISTRY.md`** — adjust agent descriptions only if this
  project has roles that differ from the defaults. Otherwise leave as-is.
- **`.ai/state/CURRENT.md`** — set "Active task" and "Last updated" once the
  first real task begins. Leave as `none` until then.

## 3. Files That Must Not Be Modified During Bootstrap

- `.ai/RULES.md`
- `.ai/TASTE.md`
- `.ai/WORKFLOW.md`
- `.ai/agents/*`
- `.ai/skills/*`
- `.claude/skills/*`
- `openspec/*`
- Any application source code

Bootstrap is a context-population step, not an implementation step. Do not
edit application code, rules, or workflow definitions while bootstrapping.

## 4. How to Discover Repository Context

Before writing into `.ai/PROJECT.md`, inspect:

- `package.json` (or `pyproject.toml`, `go.mod`, `Cargo.toml`, etc.) for
  project name, scripts, dependencies, and package manager — check which
  lockfile is present (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
  `bun.lockb`).
- The top-level folder layout for architecture and important directories.
- Existing config files (`tsconfig.json`, `next.config.*`, `vite.config.*`,
  `docker-compose.yml`, etc.) for framework and deployment clues.
- Existing README files for product intent and setup instructions.
- `git remote -v` for the repository URL, if available.

## 5. Handling Unknown Information

- If a field cannot be determined from the repository, leave it as `TODO`
  and add a short note explaining what is missing — do not guess.
- Do not invent business rules, integrations, or architecture decisions.
- If a placeholder blocks safe progress (e.g. unknown package manager before
  running install scripts), ask the human rather than guessing.
- Mark uncertain entries clearly, e.g. `TODO (unconfirmed): ...`, so future
  agents know to verify rather than trust them.
```

- [ ] **Step 2: Verify**

```bash
test -f templates/.ai/BOOTSTRAP.md && head -1 templates/.ai/BOOTSTRAP.md
```

Expected: `# Bootstrap Instructions`

- [ ] **Step 3: Commit**

```bash
git add templates/.ai/BOOTSTRAP.md
git commit -m "add .ai/BOOTSTRAP.md first-run guide for any coding agent"
```

---

### Task 5: Add `.ai/agents/orchestrator.md` and `.ai/agents/planner.md`

**Files:**
- Create: `templates/.ai/agents/orchestrator.md`
- Create: `templates/.ai/agents/planner.md`

- [ ] **Step 1: Create `templates/.ai/agents/orchestrator.md`**

```markdown
# Orchestrator Agent

## Role

Receive an incoming task, determine scope, break it into subtasks, route
each subtask to the correct specialist agent, and assemble the final result
for human review.

## Responsibilities

- Read `.ai/PROJECT.md`, `.ai/RULES.md`, `.ai/MEMORY.md`, and
  `.ai/WORKFLOW.md` before planning.
- Classify the task (bug fix, small feature, large feature, refactor,
  spec-only).
- Decide whether an OpenSpec change is needed (see `.ai/WORKFLOW.md`).
- Split the task into subtasks with clear boundaries.
- Assign each subtask to the matching agent template in `.ai/agents/`.
- Track subtask status and collect outputs.
- Run the reviewer agent before presenting the final result.

## Required Inputs

- Task description (from `.ai/workflows/task-intake.md` or equivalent).
- Acceptance criteria, if known.
- Any linked spec/issue/design reference.

## Required Context

- `.ai/PROJECT.md`
- `.ai/RULES.md`
- `.ai/MEMORY.md`
- `.ai/AGENT_REGISTRY.md`
- `.ai/state/CURRENT.md`

## Outputs

- A subtask plan (list of subtasks with assigned agent and order).
- Updated `.ai/state/CURRENT.md` reflecting the active task and next
  actions.
- A final summary in the format required by `.ai/RULES.md`.

## Must Not Do

- Must not implement code directly when a specialist agent template exists
  for that work.
- Must not skip the reviewer agent before final delivery.
- Must not merge or deploy — that decision belongs to the human.
- Must not expand scope beyond what the task and acceptance criteria
  justify.

## Completion Checklist

- [ ] Task classified and scope agreed.
- [ ] Subtasks defined with clear ownership.
- [ ] Each subtask completed or explicitly deferred with a reason.
- [ ] Reviewer agent has run on the combined changes.
- [ ] `.ai/state/CURRENT.md` updated.
- [ ] Final summary follows the required format from `.ai/RULES.md`.
```

- [ ] **Step 2: Create `templates/.ai/agents/planner.md`**

```markdown
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

- [ ] **Step 3: Verify**

```bash
for f in orchestrator planner; do test -f templates/.ai/agents/$f.md && echo "$f OK"; done
```

Expected: `orchestrator OK` and `planner OK`.

- [ ] **Step 4: Commit**

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

- [ ] **Step 1: Create `templates/.ai/agents/architect.md`**

```markdown
# Architect Agent

## Role

Make and document structural/design decisions for medium and large changes:
data flow, module boundaries, API/data contracts, and trade-offs.

## Responsibilities

- Review the current architecture relevant to the change.
- Propose an approach that fits existing patterns from `.ai/PROJECT.md` and
  `.ai/MEMORY.md`.
- Compare alternatives with explicit pros/cons.
- Define data/API contract changes and their impact on existing consumers.
- Identify security/permission implications.
- Define rollout/migration considerations.

## Required Inputs

- The plan/subtasks from the planner agent.
- Existing architecture description in `.ai/PROJECT.md`.
- Relevant `openspec/changes/<change-id>/design.md`, if one exists.

## Required Context

- `.ai/PROJECT.md`
- `.ai/MEMORY.md`
- `.ai/RULES.md`
- Relevant existing code structure (read before proposing changes).

## Outputs

- A filled `openspec/changes/<change-id>/design.md` (context, proposed
  approach, alternatives, data/API changes, UI changes, security/permission,
  rollout/migration).
- A short list of architecture decisions to add to `.ai/MEMORY.md` once the
  change ships.

## Must Not Do

- Must not propose a full rewrite for a bug fix or small feature.
- Must not introduce new infrastructure/dependencies without checking the
  `.ai/RULES.md` dependency rules.
- Must not finalize a breaking API change without flagging it for human
  review.

## Completion Checklist

- [ ] Current behavior described accurately.
- [ ] Proposed approach fits existing conventions or justifies deviation.
- [ ] At least one alternative considered and compared.
- [ ] Data/API/security/rollout sections completed.
- [ ] Decisions worth remembering are queued for `.ai/MEMORY.md`.
```

- [ ] **Step 2: Create `templates/.ai/agents/frontend.md`**

```markdown
# Frontend Agent

## Role

Implement or modify user-facing UI: components, pages, forms, client-side
state, and data fetching.

## Responsibilities

- Implement the UI behavior defined in the task/spec.
- Reuse existing components, hooks, and patterns before creating new ones.
- Handle loading, error, and empty states for all data-fetching UI.
- Apply optimistic UI with rollback only where the spec calls for it.
- Keep components small with a single, clear responsibility.

## Required Inputs

- Task description or `openspec/changes/<change-id>/` artifacts.
- Design/Figma reference, if any.
- Acceptance criteria for the UI behavior.

## Required Context

- `.ai/PROJECT.md`
- `.ai/RULES.md`
- `.ai/TASTE.md`
- `.ai/MEMORY.md`
- `.ai/skills/frontend-implementation/SKILL.md` (or
  `.claude/skills/frontend/SKILL.md` in Claude Code)

## Outputs

- Implemented UI changes matching the requirement.
- Updated/added tests for new behavior, where the project has a test setup.
- A short note on which existing patterns were reused vs. newly created.

## Must Not Do

- Must not introduce a new UI library or state management approach without
  checking the `.ai/RULES.md` dependency rules.
- Must not ship optimistic updates without a rollback path.
- Must not skip loading/error/empty states for data-fetching UI.
- Must not change unrelated components outside the task scope.

## Completion Checklist

- [ ] UI matches the requirement and acceptance criteria.
- [ ] Loading/error/empty states handled where applicable.
- [ ] Optimistic UI (if used) has a rollback on failure.
- [ ] Existing patterns reused where possible.
- [ ] Relevant validation commands run (typecheck/lint/test) or the reason
      they were not is documented.
```

- [ ] **Step 3: Create `templates/.ai/agents/backend.md`**

```markdown
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

- [ ] **Step 4: Verify**

```bash
for f in architect frontend backend; do test -f templates/.ai/agents/$f.md && echo "$f OK"; done
```

Expected: all three print `OK`.

- [ ] **Step 5: Commit**

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

- [ ] **Step 1: Create `templates/.ai/agents/tester.md`**

```markdown
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

- [ ] **Step 2: Create `templates/.ai/agents/reviewer.md`**

```markdown
# Reviewer Agent

## Role

Review implemented changes like a senior engineer focused on correctness,
safety, scope control, and maintainability before human approval.

## Responsibilities

- Check the change against the original requirement and acceptance
  criteria.
- Check for scope creep — unrelated files or behavior changed.
- Look for runtime bugs, type-safety issues, and missing error handling.
- Check security/auth implications and data exposure.
- Check that loading/error/empty states and rollback paths are handled
  where relevant.
- Assess whether tests/validation evidence are sufficient for the risk
  level of the change.

## Required Inputs

- The diff/changes to review.
- The original task, acceptance criteria, and any
  `openspec/changes/<change-id>/` artifacts.
- Validation results from the tester agent.

## Required Context

- `.ai/RULES.md`
- `.ai/TASTE.md`
- `.ai/MEMORY.md` (known pitfalls)
- `.ai/skills/code-review/SKILL.md` (or `.claude/skills/reviewer/SKILL.md`
  in Claude Code)

## Outputs

- A review report with findings grouped by severity: `blocker`, `major`,
  `minor`, `nit`.
- A recommendation: `Approve`, `Request changes`, or `Needs human decision`.

## Must Not Do

- Must not approve a change with unresolved `blocker` findings.
- Must not rubber-stamp without checking validation evidence.
- Must not expand the review into unrelated refactoring suggestions framed
  as blockers.

## Completion Checklist

- [ ] Requirement coverage checked.
- [ ] Scope creep checked.
- [ ] Runtime/type/error-handling issues checked.
- [ ] Security/auth/data exposure checked.
- [ ] Validation evidence assessed as sufficient, or gaps listed.
- [ ] Review report includes a clear recommendation.
```

- [ ] **Step 3: Create `templates/.ai/agents/pr-writer.md`**

```markdown
# PR Writer Agent

## Role

Produce the final human-facing summary of a completed task: what changed,
why, key files, validation evidence, and risks — in the format required by
`.ai/RULES.md`.

## Responsibilities

- Summarize the change in plain language: what changed and why.
- List key files touched with a one-line reason for each.
- Summarize validation: commands run and results, or commands not run and
  why.
- List known risks, follow-ups, or TODOs left for the human.
- Ensure the summary matches the actual diff — no unmentioned changes.

## Required Inputs

- The final diff.
- The reviewer agent's report and recommendation.
- Validation results from the tester agent.

## Required Context

- `.ai/RULES.md` (required final response format)
- The original task description and acceptance criteria.

## Outputs

- A final summary in the format:

  ```markdown
  ## Summary
  ## Key files
  ## Validation
  ## Risks / follow-up
  ```

## Must Not Do

- Must not omit a known risk or gap to make the change look more complete
  than it is.
- Must not describe changes that are not actually in the diff.
- Must not present the reviewer's `blocker` findings as resolved if they
  were not addressed.

## Completion Checklist

- [ ] Summary reflects the actual diff.
- [ ] Key files listed with reasons.
- [ ] Validation section accurate (run vs. not run, with reasons).
- [ ] Risks/follow-ups listed.
- [ ] Reviewer's recommendation status reflected accurately.
```

- [ ] **Step 4: Verify**

```bash
for f in tester reviewer pr-writer; do test -f templates/.ai/agents/$f.md && echo "$f OK"; done
ls templates/.ai/agents/ | wc -l
```

Expected: all three print `OK`, and the directory listing shows `8`.

- [ ] **Step 5: Commit**

```bash
git add templates/.ai/agents/tester.md templates/.ai/agents/reviewer.md templates/.ai/agents/pr-writer.md
git commit -m "add tester, reviewer, and pr-writer agent templates"
```

---

### Task 8: Add model-agnostic `.ai/skills/testing/SKILL.md`

**Files:**
- Create: `templates/.ai/skills/testing/SKILL.md`

This new skill is referenced by `tester.md` (Task 7) and is the canonical
source that `.claude/skills/testing/SKILL.md` (Task 9) will point to.

- [ ] **Step 1: Create the file**

```markdown
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

### 3. Write tests

- Cover the happy path and the edge cases from the acceptance criteria.
- For UI: cover loading, error, and empty states where applicable.
- For APIs: cover success and key error responses.

### 4. Run validation

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

### 5. Document results

- Command run → result.
- Command not run → reason.
- Manual QA steps for anything not covered by automated tests.

## Output Checklist

- [ ] New/changed behavior has test coverage or a documented reason it
      cannot be tested.
- [ ] Existing tests still pass.
- [ ] Validation commands run in order, results recorded.
- [ ] Manual QA steps documented where needed.
```

- [ ] **Step 2: Verify**

```bash
test -f templates/.ai/skills/testing/SKILL.md && head -4 templates/.ai/skills/testing/SKILL.md
```

Expected: shows the YAML frontmatter starting with `---` and `name: testing`.

- [ ] **Step 3: Commit**

```bash
git add templates/.ai/skills/testing/SKILL.md
git commit -m "add model-agnostic testing skill"
```

---

### Task 9: Add Claude-native skills under `.claude/skills/`

**Files:**
- Create: `templates/.claude/skills/frontend/SKILL.md`
- Create: `templates/.claude/skills/backend/SKILL.md`
- Create: `templates/.claude/skills/testing/SKILL.md`
- Create: `templates/.claude/skills/reviewer/SKILL.md`

These are thin, Claude Code-discoverable wrappers (valid `SKILL.md` with
`name`/`description` frontmatter) that point back to the canonical
model-agnostic skill docs in `.ai/skills/`, keeping content DRY.

- [ ] **Step 1: Create `templates/.claude/skills/frontend/SKILL.md`**

```markdown
---
name: frontend
description: Use this skill when implementing or modifying frontend features, React/Next.js components, forms, optimistic UI, or client-side data fetching.
---

# Frontend (ForgeAI)

This is the Claude Code entry point for ForgeAI's frontend implementation
guidance. The full workflow, rules, and output checklist live in the
model-agnostic skill file — read it before implementing:

- `.ai/skills/frontend-implementation/SKILL.md`

Also read, in order:

- `.ai/PROJECT.md`
- `.ai/RULES.md`
- `.ai/TASTE.md`
- `.ai/MEMORY.md`
- `.ai/agents/frontend.md` — agent role definition and completion checklist
```

- [ ] **Step 2: Create `templates/.claude/skills/backend/SKILL.md`**

```markdown
---
name: backend
description: Use this skill when implementing backend APIs, services, database queries, auth, transactions, integrations, webhooks, or server-side business logic.
---

# Backend (ForgeAI)

This is the Claude Code entry point for ForgeAI's backend implementation
guidance. The full workflow, rules, and output checklist live in the
model-agnostic skill file — read it before implementing:

- `.ai/skills/backend-implementation/SKILL.md`

Also read, in order:

- `.ai/PROJECT.md`
- `.ai/RULES.md`
- `.ai/MEMORY.md`
- `.ai/agents/backend.md` — agent role definition and completion checklist
```

- [ ] **Step 3: Create `templates/.claude/skills/testing/SKILL.md`**

```markdown
---
name: testing
description: Use this skill when adding or updating automated tests, running validation commands, or documenting manual QA steps for a change.
---

# Testing (ForgeAI)

This is the Claude Code entry point for ForgeAI's testing guidance. The full
workflow and output checklist live in the model-agnostic skill file — read
it before writing tests:

- `.ai/skills/testing/SKILL.md`

Also read:

- `.ai/PROJECT.md` (test framework, validation commands)
- `.ai/RULES.md` (validation order)
- `.ai/agents/tester.md` — agent role definition and completion checklist
```

- [ ] **Step 4: Create `templates/.claude/skills/reviewer/SKILL.md`**

```markdown
---
name: reviewer
description: Use this skill when reviewing code changes before human approval, checking diffs, identifying bugs, validating scope, or preparing review notes.
---

# Reviewer (ForgeAI)

This is the Claude Code entry point for ForgeAI's review guidance. The full
review order, questions, severity labels, and output format live in the
model-agnostic skill file — read it before reviewing:

- `.ai/skills/code-review/SKILL.md`

Also read:

- `.ai/RULES.md`
- `.ai/TASTE.md`
- `.ai/MEMORY.md` (known pitfalls)
- `.ai/agents/reviewer.md` — agent role definition and completion checklist
```

- [ ] **Step 5: Verify**

```bash
for f in frontend backend testing reviewer; do
  test -f templates/.claude/skills/$f/SKILL.md && echo "$f OK"
done
```

Expected: all four print `OK`.

- [ ] **Step 6: Commit**

```bash
git add templates/.claude/skills
git commit -m "add Claude Code native skill wrappers under .claude/skills"
```

---

### Task 10: Update `.ai/README.md`

**Files:**
- Modify: `templates/.ai/README.md`

- [ ] **Step 1: Update the recommended read order and add naming/skills notes**

Replace the full content of `templates/.ai/README.md`:

Old (current full file):
```markdown
# AI Project Harness

This markdown directory is the minimum **project harness** for AI coding agents. Its purpose is to give every new project a consistent way to declare context, rules, workflow, memory, agents, skills, and specs before coding starts.

## Quick usage

After installation, tell any coding agent:

> Read `.ai/README.md` first. Then read the files in the recommended order before planning or editing code.

For the local MVP:

```bash
npx forgeai-agentic-init@latest
```

## Recommended read order for agents

1. `PROJECT.md` — what the project is, its stack, constraints, and boundaries.
2. `RULES.md` — mandatory engineering and safety rules.
3. `TASTE.md` — owner/team preferences and style.
4. `MEMORY.md` — durable decisions, conventions, and lessons learned.
5. `AGENTS.md` — agent roles, sub-agents, and routing strategy.
6. `WORKFLOW.md` — flow from task intake to human review.
7. `state/CURRENT.md` — current project state and active focus.
8. Relevant `skills/*/SKILL.md` — task-specific operating instructions.
9. Relevant `openspec/changes/*` — spec-driven change artifacts.

## MVP principles

- Do not automate too much too early.
- Every task must have intent, scope, acceptance criteria, and validation.
- Agents must not edit code outside the task scope without documenting the reason.
- Human review is the final gate before merge or deployment.
```

New (full replacement):
```markdown
# AI Project Harness

This markdown directory is the minimum **project harness** for AI coding
agents. Its purpose is to give every new project a consistent way to declare
context, rules, workflow, memory, agents, skills, and specs before coding
starts.

## Quick usage

Root-level `CLAUDE.md` (Claude Code) and `AGENTS.md` (Codex) are pointer
files that are auto-discovered by those tools and tell the agent to read
this directory first. For other tools (AGY CLI, Cline, RooCode, Aider),
tell the agent:

> Read `.ai/README.md` first. Then read the files in the recommended order
> before planning or editing code. If `.ai/PROJECT.md` still has `TODO`
> placeholders, follow `.ai/BOOTSTRAP.md` first.

For the local MVP:

```bash
npx forgeai-agentic-init@latest
```

## Recommended read order for agents

1. `PROJECT.md` — what the project is, its stack, constraints, and boundaries.
2. `RULES.md` — mandatory engineering and safety rules.
3. `TASTE.md` — owner/team preferences and style.
4. `MEMORY.md` — durable decisions, conventions, and lessons learned.
5. `AGENT_REGISTRY.md` — agent roles, sub-agents, and routing strategy.
6. `WORKFLOW.md` — flow from task intake to human review.
7. `state/CURRENT.md` — current project state and active focus.
8. `agents/*.md` — per-role templates (responsibilities, inputs, outputs,
   completion checklists).
9. Relevant `skills/*/SKILL.md` — task-specific operating instructions.
10. Relevant `openspec/changes/*` — spec-driven change artifacts.

## Naming: root `AGENTS.md` vs. `.ai/AGENT_REGISTRY.md`

- Root `AGENTS.md` follows the **Codex convention**: a short, repo-level
  pointer that Codex (and similarly, Claude Code's `CLAUDE.md`) reads
  automatically. It tells an agent *where to start*.
- `.ai/AGENT_REGISTRY.md` defines ForgeAI's **internal agent roles and model
  routing**. It tells an agent *which role to play* and how to route work
  between specialist agents (see `.ai/agents/*.md` for the full per-role
  templates).

## Skills: model-agnostic vs. Claude-native

- `.ai/skills/*/SKILL.md` — **model-agnostic** guidance. Any agent (Claude
  Code, Codex, AGY CLI, Cline, RooCode, Aider) should read these as plain
  documentation before doing related work.
- `.claude/skills/*/SKILL.md` — **Claude Code native skills**. These are
  thin wrappers with valid Skill frontmatter so Claude Code can discover and
  invoke them directly; each one points back to the canonical doc in
  `.ai/skills/` to avoid duplication.

## MVP principles

- Do not automate too much too early.
- Every task must have intent, scope, acceptance criteria, and validation.
- Agents must not edit code outside the task scope without documenting the
  reason.
- Human review is the final gate before merge or deployment.
```

- [ ] **Step 2: Verify**

```bash
grep -n "AGENT_REGISTRY.md" templates/.ai/README.md
grep -n "BOOTSTRAP.md" templates/.ai/README.md
grep -n ".claude/skills" templates/.ai/README.md
```

Expected: each grep returns at least one match.

- [ ] **Step 3: Commit**

```bash
git add templates/.ai/README.md
git commit -m "update .ai/README.md for AGENT_REGISTRY rename, BOOTSTRAP, and dual-mode skills"
```

---

### Task 11: Annotate `.ai/PROJECT.md` placeholders with discovery guidance

**Files:**
- Modify: `templates/.ai/PROJECT.md`

- [ ] **Step 1: Replace the full content**

Replace the full content of `templates/.ai/PROJECT.md`:

Old (current full file, 87 lines as read from repo) — keep all section
headers and table structure, but add an HTML comment under each
TODO-bearing section.

New (full replacement):
```markdown
# Project Context

This file explains the project to any AI coding agent before it edits code.
Keep it short, accurate, and updated. See `.ai/BOOTSTRAP.md` for how to
populate this file on first run.

## Project identity

<!--
Fill from package.json (name, "repository" field), git remote -v (Owner,
Repository), and the primary language/runtime actually used in the repo
(check file extensions and lockfiles). Do not guess a framework — check
config files (next.config.*, nest-cli.json, vite.config.*, etc.) or
dependencies in package.json.
-->

- **Project name:** TODO
- **Repository:** TODO
- **Owner:** TODO
- **Primary language:** TypeScript
- **Runtime:** Node.js
- **Main framework:** TODO
- **Package manager:** TODO: npm / pnpm / yarn / bun

## Product goal

<!--
Write the product goal in one short paragraph, based on existing README
files, package.json "description", and top-level documentation. Do not
invent a goal if none of these exist — leave the TODO and note that the
product goal needs confirmation from a human.
-->

Write the product goal in one short paragraph:

> This project helps [target users] solve [problem] by [core solution].

## Current MVP scope

<!--
Derive from existing features/routes/modules if this is an established
codebase. For a brand-new project, leave these as TODO until the human
defines the MVP scope — do not invent scope items.
-->

The MVP should focus on:

1. TODO: Core user flow
2. TODO: Critical data model
3. TODO: Minimal UI/API integration
4. TODO: Validation and error handling

Out of scope for MVP:

- TODO: Advanced automation
- TODO: Multi-tenant complexity
- TODO: Premature infrastructure optimization

## Technology stack

<!--
Fill each row by inspecting package.json dependencies/devDependencies and
config files. Only list a technology if it is actually present as a
dependency or config file — do not assume an example value listed in the
"Notes" column applies to this project.
-->

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | TODO | Example: Next.js, React, Vite |
| Backend | TODO | Example: Node.js, NestJS, Express, Fastify |
| Database | TODO | Example: PostgreSQL, SQLite, Supabase |
| ORM | TODO | Example: Prisma, Drizzle, TypeORM |
| Auth | TODO | Example: NextAuth, Supabase Auth, custom JWT |
| Styling | TODO | Example: Tailwind, CSS Modules, SCSS |
| Testing | TODO | Example: Vitest, Jest, Playwright |
| Deployment | TODO | Example: Vercel, Docker, VPS |

## Architecture overview

<!--
Describe the actual request/data flow you find in the codebase (entry
points, routing layer, service/data layer, external integrations). If the
codebase is empty/new, leave the example flow below as a placeholder and
mark it TODO once real architecture exists.
-->

Describe the current architecture clearly enough that an agent does not
guess.

```text
User -> UI -> API/Server Actions -> Service Layer -> Database/External APIs
```

## Important directories

<!--
Verify each path actually exists in the repo before listing it. Remove rows
for directories that do not exist, and add rows for important directories
that do exist but are not listed here.
-->

| Path | Purpose |
| --- | --- |
| `src/app` | Application routes/pages |
| `src/components` | Shared UI components |
| `src/containers` | Page-level or feature-level containers |
| `src/features` | Feature state, API clients, types |
| `src/lib` | Shared utilities and infrastructure |
| `src/server` | Backend/server logic if present |
| `tests` | Automated tests |

## Constraints

Agents should avoid the following unless the task explicitly requires it:

- Do not rewrite the whole architecture for a bug fix.
- Do not change the package manager without a clear reason.
- Do not add heavy dependencies if existing code can solve the problem.
- Do not create abstractions before there are at least two real use cases.

## Definition of done

A task is only done when:

- The code runs.
- The main happy path is implemented.
- Relevant test/lint/typecheck commands pass, or the reason they could not
  run is documented.
- Specs/tasks are updated if behavior changed.
- The final summary states what changed, the key files, validation evidence,
  and risks.
```

- [ ] **Step 2: Verify**

```bash
grep -c "<!--" templates/.ai/PROJECT.md
```

Expected: `6` (one guidance comment per TODO-bearing section: Project
identity, Product goal, Current MVP scope, Technology stack, Architecture
overview, Important directories).

- [ ] **Step 3: Commit**

```bash
git add templates/.ai/PROJECT.md
git commit -m "annotate .ai/PROJECT.md placeholders with discovery guidance"
```

---

### Task 12: Update root `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update "What gets installed" tree**

Replace:
```text
.ai/
  README.md
  PROJECT.md
  RULES.md
  TASTE.md
  MEMORY.md
  AGENTS.md
  WORKFLOW.md
  state/CURRENT.md
  workflows/task-intake.md
  skills/
    frontend-implementation/SKILL.md
    backend-implementation/SKILL.md
    code-review/SKILL.md
    spec-planning/SKILL.md
openspec/
  README.md
  project.md
  changes/_template/
    proposal.md
    design.md
    tasks.md
    specs/capability.md
```

With:
```text
CLAUDE.md
AGENTS.md
.ai/
  README.md
  BOOTSTRAP.md
  PROJECT.md
  RULES.md
  TASTE.md
  MEMORY.md
  AGENT_REGISTRY.md
  WORKFLOW.md
  state/CURRENT.md
  workflows/task-intake.md
  agents/
    orchestrator.md
    planner.md
    architect.md
    frontend.md
    backend.md
    tester.md
    reviewer.md
    pr-writer.md
  skills/
    frontend-implementation/SKILL.md
    backend-implementation/SKILL.md
    code-review/SKILL.md
    spec-planning/SKILL.md
    testing/SKILL.md
.claude/
  skills/
    frontend/SKILL.md
    backend/SKILL.md
    testing/SKILL.md
    reviewer/SKILL.md
openspec/
  README.md
  project.md
  changes/_template/
    proposal.md
    design.md
    tasks.md
    specs/capability.md
```

- [ ] **Step 2: Add "After Initialization" section**

Insert a new section after "## What gets installed" and before
"## MVP principles":

```markdown
## After Initialization

Once the files are installed, populate the project-specific context before
relying on an agent for real tasks:

1. Open the project in your AI coding tool (Claude Code, Codex CLI, AGY
   CLI, Cline, RooCode, Aider, ...).
2. Ask it to bootstrap the harness from the real repository, for example:

   > Read the ForgeAI harness and populate PROJECT.md, MEMORY.md, and
   > AGENT_REGISTRY.md from the current repository. Do not modify source
   > code.

3. The agent should follow `.ai/BOOTSTRAP.md`, which explains what to read,
   what to populate, what must not change, how to discover repo context
   (package.json, lockfiles, config files), and how to handle unknown
   information (leave `TODO`, never guess).

### How each tool finds the harness

- **Claude Code** auto-reads `CLAUDE.md` at the project root. It points the
  agent at `.ai/README.md` and the recommended read order.
- **Codex** auto-reads `AGENTS.md` at the project root, following the same
  pointer pattern. ForgeAI's own agent-role registry lives separately at
  `.ai/AGENT_REGISTRY.md` to avoid colliding with this convention.
- **AGY CLI, Cline, RooCode, Aider** (and other tools) do not auto-load
  either file today — tell the agent to read `.ai/README.md` first, as
  shown in step 2 above.

### Working across multiple agents

Because all context lives in plain markdown under `.ai/` (plus `.claude/`
for Claude-native skill wrappers), the same project can be worked on by
different tools without duplicating instructions:

- `.ai/PROJECT.md`, `.ai/RULES.md`, `.ai/TASTE.md`, `.ai/MEMORY.md`,
  `.ai/WORKFLOW.md` — shared context and rules for any agent.
- `.ai/AGENT_REGISTRY.md` + `.ai/agents/*.md` — shared agent-role
  definitions and model routing.
- `.ai/skills/*` — shared, model-agnostic task guidance.
- `.claude/skills/*` — Claude Code-specific skill entry points that point
  back to `.ai/skills/*` for the full content.
```

- [ ] **Step 3: Verify**

```bash
grep -n "After Initialization" README.md
grep -n "AGENT_REGISTRY.md" README.md
grep -n ".claude/skills" README.md
```

Expected: each grep returns at least one match.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "document root pointer files, bootstrap flow, and multi-agent layout in README"
```

---

### Task 13: End-to-end verification of the installer

**Files:**
- None (verification only — confirms `bin/forgeai-init.js` needs no changes)

- [ ] **Step 1: Dry-run against a scratch directory**

```bash
rm -rf /tmp/forgeai-scratch && mkdir -p /tmp/forgeai-scratch
cd /tmp/forgeai-scratch && node /Users/admin/Documents/Learn/forgeai-agentic-mvp/bin/forgeai-init.js --dry-run
```

Expected: output lists `would create CLAUDE.md`, `would create AGENTS.md`,
`would create .ai/AGENT_REGISTRY.md`, `would create .ai/BOOTSTRAP.md`,
`would create .ai/agents/orchestrator.md` (and the other 7 agent files),
`would create .ai/skills/testing/SKILL.md`, and
`would create .claude/skills/frontend/SKILL.md` (and the other 3 Claude
skill files), among the existing entries. No `.ai/AGENTS.md` entry should
appear.

- [ ] **Step 2: Real run and inspect the resulting tree**

```bash
cd /tmp/forgeai-scratch && node /Users/admin/Documents/Learn/forgeai-agentic-mvp/bin/forgeai-init.js
find /tmp/forgeai-scratch -type f | sort
```

Expected: file list matches the updated "What gets installed" tree from
Task 12, plus `bin`/`templates` are not present (only `templates/` contents
are copied). No leftover `.ai/AGENTS.md`.

- [ ] **Step 3: Re-run without `--force` to confirm backward-compatible skip behavior**

```bash
cd /tmp/forgeai-scratch && node /Users/admin/Documents/Learn/forgeai-agentic-mvp/bin/forgeai-init.js
```

Expected: every file prints `skip <path> already exists. Use --force to
overwrite.` — confirms existing idempotent CLI behavior is unchanged.

- [ ] **Step 4: Clean up scratch directory**

```bash
rm -rf /tmp/forgeai-scratch
```

- [ ] **Step 5: No commit needed for this task** (verification only).

---

## Deliverables (produced after all tasks complete)

When all tasks above are done, provide:

1. **Architecture summary** — one paragraph restating the final layout
   (root pointers, `.ai/AGENT_REGISTRY.md` + `.ai/agents/*`, dual-mode
   skills, `.ai/BOOTSTRAP.md`).
2. **File tree diff** — `git diff --stat` against the commit before Task 1.
3. **Rationale** — for each of the 8 objectives in the original spec, one
   sentence on how it was satisfied and which task(s) implemented it.
4. **Remaining risks / future improvements**, e.g.:
   - `.ai/skills/spec-planning/SKILL.md` has no `.claude/skills/` mirror
     (not required by the spec's 4-skill list — flag if a "planner" Claude
     skill is wanted later).
   - Profiles (`--profile nextjs`, etc.) from the README's "Future roadmap"
     are still unimplemented.
   - `.ai/PROJECT.md` guidance comments rely on the agent actually removing
     them after filling sections — not enforced by tooling.
