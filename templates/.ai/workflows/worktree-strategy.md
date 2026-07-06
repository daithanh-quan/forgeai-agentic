# Multi-Agent Worktree Strategy

Use this guide when running two or more agents in parallel on independent
subtasks. Read `.ai/WORKFLOW.md` section 5a for branch and worktree naming
rules before following this guide.

## When to use a worktree

Use a separate worktree when:

- Two or more subtasks have disjoint write scopes and can run in parallel.
- An implementing agent and a reviewing agent need to work at the same time.
- You want to isolate risky or experimental work from `main`.

Use a single session (no worktree) when:

- Subtasks must run sequentially (one depends on the other's output).
- Write scopes overlap — sequence the work instead.
- The task is small enough that context-switching overhead exceeds the
  parallelism benefit.

## Setup

**1. Verify write scopes are disjoint before creating worktrees.**

Check `.ai/state/sessions.md` for any unfinished sessions:

```bash
forgeai-init --check-sessions
```

If overlap is detected, do not proceed — sequence the work or narrow scopes.

**2. Create a worktree per parallel agent.**

```bash
# With a remote
git worktree add ../.worktrees/<slug> -b feat/<slug> origin/main

# Without a remote
git worktree add ../.worktrees/<slug> -b feat/<slug> main
```

Use the task-type prefix (`feat/`, `fix/`, `docs/`, etc.) from `WORKFLOW.md`
section 5a, not an agent identity (`agent/...` is not allowed).

**3. Register the session in `.ai/state/sessions.md` before starting.**

The parser requires **exactly 9 columns** — incorrect formatting silently
skips the row and bypasses overlap detection.

```markdown
| <session-id> | <agent> | <objective> | <branch> | active | YYYY-MM-DD | <read-scope> | <write-scope> | <notes> |
```

Example:

```markdown
| agt-p8-worktree | codex | write worktree-strategy.md | feat/p8-worktree | active | 2026-07-06 | .ai/WORKFLOW.md | .ai/workflows/worktree-strategy.md | independent |
```

**4. Run `--check-sessions` again** to confirm no overlap before launching
the delegated model.

## Running parallel agents

- Each agent receives a bounded assignment from
  `.ai/state/assignments/<task-id>.md` with explicit read/write scope.
- Send only the assignment file and the listed allowed context — not the full
  repository.
- The orchestrator records every active session in `.ai/state/sessions.md`
  and re-runs `--check-sessions` if a new session is added mid-flight.

## Conflict detection

`forgeai-init --check-sessions` detects write-scope overlap between unfinished
sessions and exits with code `1` if a conflict is found. It does not resolve
conflicts — that is the orchestrator's responsibility.

If overlap is detected after work has started:

1. Pause both sessions.
2. Identify which session owns the shared files.
3. Sequence the remaining work: finish one session, then start the other.
4. Ask the human if the ownership decision affects business logic or security.

## Merge-back rules

1. Each worktree's branch must pass `forgeai-init --check-all` before
   the human is asked to review.
2. The orchestrator prepares a summary (changed files, validation, risks).
3. **The human approves the merge** — agents must not merge or push without
   explicit human confirmation.
4. Merge in dependency order: if session B depended on session A's output,
   merge A first.
5. Resolve any conflicts manually; do not use `git merge -X ours/theirs`
   without documenting the reason.

## Cleanup

After the human approves and the branch is merged:

```bash
# Remove the worktree
git worktree remove ../.worktrees/<slug>

# Delete the local branch
git branch -d feat/<slug>
```

Update `.ai/state/sessions.md` — mark the session row `done` or remove it.
If the session was the last active one, run `--check-sessions` once more to
confirm the file is clean.

## Known limitations (Phase 8 baseline)

- No automated CLI to create, switch, or remove worktrees — all git commands
  are manual.
- Session registration in `.ai/state/sessions.md` is manual; a formatting
  error silently skips the row.
- `--check-sessions` detects overlap but does not suggest a resolution.
- `router/run-model.ts` fallback exits with code `0` by default. Pass
  `--fail-on-fallback` to exit with code `1` instead. Callers that parse the
  JSON payload can check `status === "fallback"` regardless of the flag.
