# Delegated Assignment

## Assignment

- ID: `TASK-...`
- Parent task: `...`
- Role: `planner | architect | frontend | backend | tester | reviewer`
- Objective: `One measurable outcome`
- Model tier: `fast | standard | strong | lead`
- Provider route: `AGY for score 0-2, Codex for score 3-5, Claude for score 6-10`
- Score: `C0 + R0 + A0 + X0 = 0`
- Token budget: `...`
- Session ID: `agent-task-...`

## Allowed Context

- `path/to/file`
- `path/to/directory/`
- Relevant contract or decision: `...`
- Prefer a compact context pack generated with
  `forgeai-init --context-pack --objective "<task>"`.

## Coordination Scope

- Read scope: `path/to/file`, `path/to/directory/`, or `repo`
- Write scope: `exact/file.ts`, `narrow/directory/`
- Parallel safety: `independent | sequential | needs-human-decision`

## Constraints

- Preserve: `existing pattern or contract`
- Do not change: `files, behavior, or public surface`
- Escalate when: `condition requiring the lead`

## Acceptance Criteria

- [ ] ...
- [ ] ...

## Validation

```bash
# Exact command the delegated model must run
```

## Return Format

- Files changed.
- Concise summary.
- Validation evidence (required): each command run and its result
  (`pass | fail | skipped`). "Done" without a command and result is rejected
  by the review gate (`forgeai-init --check-review`).
- Reviewer result: `Approve | Request changes | Needs human decision`.
- Unresolved blockers, or `none`.
- Risks, assumptions, or unresolved questions.

## Token Discipline

- Do not send full harness docs or broad command output to delegated models.
- Use `forgeai-init --decompose --compact --objective "<task>"` for a small assignment plan.
- Use the context pack to justify any file added to the read scope.
