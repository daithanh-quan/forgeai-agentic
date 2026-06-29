# Lifecycle State

Use this file to track durable task lifecycle state across agent sessions.
Short-lived parallel-session coordination belongs in `.ai/state/sessions.md`;
task-level evidence and decisions belong in `.ai/state/tasks/<task-id>.md`.

## State Model

| State | Purpose | Entry criteria | Exit criteria |
| --- | --- | --- | --- |
| `intake` | Capture request, source, priority, and initial acceptance criteria | Human or external system provides a task | Requirement, source, priority, affected areas, and known constraints are recorded |
| `triage` | Decide size, risk, task type, owner, and whether a spec is needed | Intake is complete enough to assess | Scope risk, task type, owner, and OpenSpec need are decided |
| `planning` | Convert the task into scope, subtasks, assignments, and validation | Triage has an owner and task type | In/out of scope, assumptions, subtasks, and validation plan are documented |
| `specification` | Create or update OpenSpec artifacts when needed | Planning says behavior/API/workflow changes need durable spec | Proposal, design, tasks, and capability spec are ready for approval |
| `assignment` | Route bounded work to agent/model sessions | Plan or spec is approved for implementation | Assignments have owner, read/write scope, acceptance criteria, and token budget |
| `execution` | Implement the scoped change | Assignment is accepted by owner/model | Files changed and implementation notes recorded in the task journal |
| `validation` | Prove the change works | Implementation is complete enough to test | Required commands/manual checks pass, or failures are documented with scope decision |
| `review` | Check correctness, scope, security, and evidence | Validation evidence exists or a blocker explains why it cannot | Reviewer returns `Approve`, `Request changes`, or `Needs human decision` |
| `revision` | Address review findings or failed validation | Review requests changes or validation reveals defects | Findings are fixed or explicitly escalated |
| `acceptance` | Human/orchestrator decides whether the work is ready to deliver | Review is approved or remaining risks are accepted | Acceptance decision, risks, and delivery notes are recorded |
| `delivery` | Prepare merge/PR/release/handoff notes | Acceptance is complete | Final summary, changed files, validation, and follow-up notes are ready |
| `memory-update` | Promote durable lessons to memory | Delivery revealed stable project knowledge | `.ai/MEMORY.md` update is made or explicitly skipped |
| `closed` | Mark task complete | Delivery and memory decision are complete | Outcome, date, and closure reason are recorded |

## Transition Rules

- Do not move from `planning` to `execution` until acceptance criteria and validation are explicit.
- Do not move from `specification` to `assignment` until required OpenSpec artifacts exist or the journal records why a mini spec is enough.
- Do not move from `assignment` to `execution` until read/write scope and owner are recorded.
- Do not move from `execution` to `review` until validation evidence exists or the journal records why validation could not run.
- Do not move from `review` to `acceptance` when reviewer status is `Request changes`; move to `revision` instead.
- Do not close a task until delivery notes and the memory update decision are recorded.

## Stale Task Detection

Mark a task `stale` in its journal when any condition applies:

- It has been paused for more than 7 calendar days.
- The base branch, dependency lockfile, API schema, database migration, or relevant config changed since the task was planned.
- Assumptions mention external behavior, versions, permissions, or product rules that may have changed.
- Validation evidence is older than the latest implementation change.
- The owner/model session is unavailable, out of quota, or no longer has the needed context.

Before resuming a stale task, re-run repository discovery for the affected area,
refresh the validation plan, update assumptions, and re-check session write
scope overlap with `forgeai-init --check-sessions`. The orchestrator runs
`forgeai-init --check-lifecycle` before resuming or handing off long-running
work.

## Closure Rules

Write back to `.ai/MEMORY.md` only when the task produced stable knowledge:

- Architecture decisions.
- Recurring bugs or pitfalls.
- New commands, test strategy, or deployment rules.
- Owner/team preferences that should apply to future work.

Keep temporary notes only in the task journal:

- Prompt drafts.
- One-off debugging hypotheses.
- Failed commands that did not reveal durable project behavior.
- Delegation details that matter only for the completed task.

Put user-facing release notes, PR notes, or changelog entries in the project
location that the repository already uses. Do not overload `.ai/MEMORY.md` with
release prose.

## CLI Check

The orchestrator runs this before resuming paused work, handing off to another
agent, or closing a task:

```bash
forgeai-init --check-lifecycle
```

The checker validates required lifecycle files, task journal identity fields,
allowed lifecycle states, stale active tasks, and closed-task memory update
decisions.
