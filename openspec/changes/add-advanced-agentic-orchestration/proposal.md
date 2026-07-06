# Proposal: add-advanced-agentic-orchestration

## Summary

Phase 8 advances the ForgeAI harness from single-agent delegation to
explicit multi-agent orchestration. It adds a documented worktree strategy
for parallel work, TypeScript-level dynamic task decomposition, stronger
fallback and human-approval gates, and a lightweight evaluation framework to
measure single-agent vs. multi-agent outcomes.

## Problem

Phase 4 (model routing) and Phase 5 (review gates) showed that delegated
assignments work, but the harness has no first-class support for:

- Running multiple agents in parallel worktrees without write-scope collisions.
- Breaking large work into bounded subtasks automatically at runtime.
- Blocking high-risk actions (destructive migrations, auth changes) until the
  human explicitly approves.
- Measuring whether multi-agent workflows are faster, cheaper, or more correct
  than single-agent runs.

Without these, parallel delegation is possible in theory but brittle in
practice, and there is no feedback loop to justify or calibrate its use.

## Goals

- Add a `worktree-strategy.md` workflow guide covering setup, conflict
  detection, and merge-back rules.
- Extend `run-model.ts` with a `--decompose` mode that reads a high-level
  objective and emits a scored, bounded task list.
- Add a `--check-approval` gate that fails when high-risk task journals lack
  explicit human-approval evidence.
- Add an `evaluation/` folder under `.ai/` with a lightweight run-log schema
  and a `--check-evaluation` command.
- Update `--check-all` to include the new gates.

## Non-goals

- Full CI/CD pipeline integration (Phase 9 scope).
- External board connectors (dropped, see MEMORY.md).
- Automated conflict resolution beyond documenting overlapping write scopes
  and asking the human.

## Users / Actors

- **Orchestrator agent**: uses worktree strategy and decompose mode to split
  and run parallel work.
- **Human reviewer**: benefits from approval gates before high-risk changes
  land, and from evaluation logs to calibrate multi-agent use.
- **Delegated sub-agents** (Gemini fast tier, Codex standard/strong): receive
  better-scoped assignments with clearer acceptance criteria.

## Acceptance Criteria

- Given a task journal in `review` state that touched auth code, when
  `--check-approval` runs, then it fails unless an `## Approval` section
  with a human sign-off date is present.
- Given two parallel sessions with overlapping write scopes, when
  `--check-sessions` runs, then it fails with a clear conflict report.
- Given a high-level objective passed to `--decompose`, when the command
  completes, then it emits a scored task list with tier, token budget, and
  acceptance criteria per subtask.
- Given a completed evaluation run, when `--check-evaluation` runs, then it
  reports outcome metrics (correctness, latency, token cost) without failing
  on missing optional fields.
- `--check-all` aggregates the new gates alongside existing checks.

## Risks

- `--decompose` output quality depends on model reasoning; treat it as a
  proposal requiring human review, not an authoritative plan.
- Worktree merge-back is inherently manual; the guide must be explicit that
  agents cannot auto-merge conflicting branches.
- Approval gate adds friction — must not block non-risky tasks with false
  positives.
