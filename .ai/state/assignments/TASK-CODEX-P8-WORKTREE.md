## Assignment
- ID: TASK-CODEX-P8-WORKTREE
- Role: backend
- Objective: Write `.ai/workflows/worktree-strategy.md` — a practical multi-agent
  worktree strategy guide covering setup, conflict detection, and merge-back rules
  for parallel agent work. Also add a one-line cross-reference in `.ai/WORKFLOW.md`
  section 5a pointing to the new file.
- Model tier: standard
- Token budget: 8000
- Session ID: agt-p8-worktree

## Allowed context
- This assignment file only.
- Read-only access to:
  - `.ai/WORKFLOW.md` (section 5a: Branch and worktree naming)
  - `.ai/state/sessions.md`
  - `.ai/state/tasks/p8-research-inventory.md`

## Coordination scope
- Read scope: `.ai/WORKFLOW.md`, `.ai/state/sessions.md`, `.ai/state/tasks/p8-research-inventory.md`
- Write scope: `.ai/workflows/worktree-strategy.md` (new file), `.ai/WORKFLOW.md` (one-line addition only)
- Parallel safety: independent

## Constraints
- Do not edit any file other than the two listed in write scope.
- Do not write TypeScript or implementation code.
- Keep the guide under 200 lines.
- Do not invent tooling that does not exist — the inventory confirmed there is no
  automated worktree CLI yet.

## Key findings from P8-01 research (use as design input)
- No automated worktree lifecycle management exists (no CLI to create/switch/cleanup).
- Session registration in `.ai/state/sessions.md` is manual.
- Parser requires exactly 9 columns — strict formatting needed.
- `--check-sessions` detects overlap but does not resolve it.

## Acceptance criteria
- [ ] `.ai/workflows/worktree-strategy.md` exists and covers:
  - When to use a worktree vs. a single session.
  - Step-by-step setup (git commands).
  - How to register a session in `.ai/state/sessions.md` before starting.
  - Conflict detection: run `forgeai-init --check-sessions` before parallel work.
  - Merge-back rules: who merges, when, and what the human must approve.
  - Cleanup: remove worktree and mark session `done` after merge.
- [ ] `.ai/WORKFLOW.md` section 5a has one sentence referencing the new file.

## Validation
- Confirm `.ai/workflows/worktree-strategy.md` exists and is non-empty.
- Confirm `.ai/WORKFLOW.md` diff is minimal (one line added only).

## Return format
- Files changed: list each file and what changed.
- Summary: one paragraph.
- Validation result: confirm acceptance criteria are met.
- Risks or open questions.
