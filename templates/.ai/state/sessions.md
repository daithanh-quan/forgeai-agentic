# Agent Sessions

Track active agent sessions here before running parallel work. This file is
for short-lived coordination only; durable decisions belong in `.ai/MEMORY.md`.

## Active Sessions

| ID | Owner | Task | Branch | Status | Started | Read scope | Write scope | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| example-session | Codex | Example only | feat/example | done | YYYY-MM-DD | `README.md` | `README.md` | Remove this row when real work starts |

## Rules

- Add or update a row before starting a session that may read or edit project
  files.
- Use `active`, `paused`, or `blocked` for unfinished sessions; use `done`
  when the session is complete.
- Keep write scopes exact: prefer files or narrow directories over broad
  entries such as `.` or `src/`.
- Do not run sessions in parallel when their write scopes overlap.
- If a session needs broad repository context, mark the read scope as `repo`
  but keep the write scope narrow.
- The orchestrator runs `forgeai-init --check-sessions` before launching
  parallel delegated work or before resuming after a long pause.
- For active runtime enforcement across parallel terminals or git worktrees,
  acquire an atomic lock with `forgeai-init --lock-session --session <id> --write-scope <paths>`,
  extend long runs with `--heartbeat-session --session <id>`, and release with
  `--unlock-session --session <id>` (or recover expired/crashed locks via
  `forgeai-init --check-sessions --recover-stale`).
