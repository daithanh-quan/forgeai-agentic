# Lifecycle Management Workflow

Use this workflow for non-trivial work, long-running tasks, delegated tasks,
and any task where decisions or validation evidence must survive context loss.

## 1. Create Or Update The Task Journal

Start from `.ai/state/tasks/_template.md` and create:

```text
.ai/state/tasks/<task-id>.md
```

Use a stable ID such as:

```text
TASK-20260626-add-lifecycle-state
```

For tiny one-step fixes, a response-local mini spec is enough. Create a journal
when the task is delegated, risky, paused/resumed, touches multiple areas, or
requires review evidence.

## 2. Classify The Task

Choose one lifecycle task type:

- `bug`
- `feature`
- `refactor`
- `research`
- `audit`
- `incident`
- `release`
- `dependency-upgrade`

Then apply the matching template under `.ai/workflows/task-types/`.

## 3. Move Through States Explicitly

Use `.ai/state/lifecycle.md` as the state machine. Record each meaningful
transition in the journal's Lifecycle Log.

Minimum transition evidence:

- `intake -> triage`: requirement, source, priority, and affected area.
- `triage -> planning`: task type, risk, owner, and OpenSpec decision.
- `planning -> assignment`: scope, assumptions, subtasks, and validation plan.
- `assignment -> execution`: owner/model, read/write scope, and acceptance criteria.
- `execution -> validation`: files touched and implementation notes.
- `validation -> review`: command/manual check results.
- `review -> acceptance`: reviewer status and resolved findings.
- `acceptance -> delivery`: accepted risk and final summary.
- `delivery -> memory-update`: decision about durable memory.
- `memory-update -> closed`: final outcome and closure date.

## 4. Detect Stale Work Before Resuming

Before resuming paused work:

1. Check the journal's `Last updated` date.
2. Compare the current branch/base, lockfiles, schema/config files, and touched
   files against the journal assumptions.
3. Re-run or refresh validation if implementation changed after the last test.
4. Run `forgeai-init --check-sessions` when more than one session may be active.
5. Mark `Stale status` as `stale` until assumptions and validation are refreshed.

## 5. Close The Task Deliberately

Before marking `closed`:

- Delivery notes are complete.
- Review findings are resolved or accepted.
- Validation evidence is present or skipped with a reason.
- `.ai/MEMORY.md` update decision is explicit.
- Temporary session rows in `.ai/state/sessions.md` are marked `done` or removed.

Do not close a task just because the implementation is complete. Closure
requires delivery and memory disposition.
