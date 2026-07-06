# Tasks: add-advanced-agentic-orchestration

## Scoring Legend

| Symbol | Dimension | Range |
| --- | --- | --- |
| C | Complexity | 0–3 |
| R | Risk | 0–3 |
| A | Ambiguity | 0–2 |
| X | Context size | 0–2 |

## Subtask Routing Table

| ID | Subtask | C | R | A | X | Total | Tier | Agent |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| P8-01 | Research: inventory worktree/session/fallback patterns in repo | 0 | 0 | 0 | 1 | 1 | fast | Gemini (agy) |
| P8-02 | Multi-agent worktree strategy docs and workflow template | 2 | 1 | 1 | 1 | 5 | standard | codex |
| P8-03 | Dynamic task decomposition CLI (`--decompose`) TypeScript | 3 | 2 | 1 | 1 | 7 | strong | current model |
| P8-04 | Fallback enhancements in `router/run-model.ts` | 2 | 2 | 1 | 1 | 6 | strong | current model |
| P8-05 | Human approval gate `--check-approval` TypeScript | 2 | 3 | 1 | 2 | 8 → min:lead | lead | current orchestrator |
| P8-06 | Evaluation schema + `--check-evaluation` TypeScript | 1 | 0 | 1 | 1 | 3 | standard | codex |
| P8-07 | Update `--check-all` to include new gates | 1 | 0 | 0 | 1 | 2 | fast | Gemini (agy) |
| P8-08 | Update tests for new CLI flags | 1 | 0 | 0 | 1 | 2 | fast | Gemini (agy) |
| P8-09 | Review and human approval of full Phase 8 diff | — | — | — | — | — | lead | current orchestrator |

## Implementation

- [x] P8-01: Research — Gemini (agy fast tier) ✓ 2026-07-06
  - Assignment: `.ai/state/assignments/TASK-AGY-P8-RESEARCH.md`
  - Outputs: `.ai/state/tasks/p8-research-inventory.md`

- [x] P8-02: Worktree strategy docs — orchestrator fallback (codex unavailable) ✓ 2026-07-06
  - Assignment: `.ai/state/assignments/TASK-CODEX-P8-WORKTREE.md`
  - Outputs: `.ai/workflows/worktree-strategy.md`, `.ai/WORKFLOW.md` (one-line ref added)

- [x] P8-03: `--decompose` CLI command — current model ✓ 2026-07-06
  - Files: `bin/lib/decompose.ts`, `bin/lib/context.ts`, `bin/forgeai-init.ts`, `bin/lib/init.ts`

- [x] P8-04: Fallback enhancements — current model ✓ 2026-07-06
  - Files: `.ai/router/run-model.ts` (added `--fail-on-fallback` flag)

- [x] P8-05: `--check-approval` gate — current orchestrator ✓ 2026-07-06
  - Files: `bin/lib/approval.ts`, `bin/lib/context.ts`, `bin/forgeai-init.ts`, `bin/lib/init.ts`

- [x] P8-06: Evaluation schema + `--check-evaluation` — current model (codex unavailable) ✓ 2026-07-06
  - Files: `.ai/evaluation/README.md`, `.ai/evaluation/_template.md`, `bin/lib/evaluation.ts`

- [x] P8-07: Integrate new gates into `--check-all` — current model ✓ 2026-07-06
  - Files: `bin/lib/check.ts` (added `runCheckApproval`, `runCheckEvaluation`)

- [x] P8-08: Tests — current model (Gemini output insufficient) ✓ 2026-07-06
  - Files: `test/approval.test.ts`, `test/evaluation.test.ts`, `test/decompose.test.ts`
  - 112/112 tests pass

- [ ] P8-09: Final review — current orchestrator

## Validation

- [ ] `npm run typecheck` (or `tsc --noEmit`)
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Manual: `npx forgeai-agentic-init@latest --check-all` on a fresh repo
- [ ] Manual: verify `--check-approval` fails on a task journal with auth code and no approval section
- [ ] Manual: verify `--decompose` emits scored subtasks for a simple objective
