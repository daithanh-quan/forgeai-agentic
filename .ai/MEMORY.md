# Project Memory

This file stores durable memory for the ForgeAI Agentic Init repository itself.
It is not part of the npm package because `package.json#files` only publishes
`bin`, `profiles`, `templates`, `README.md`, and `tsconfig.json`.

## Architecture decisions

### 2026-06-23 - ForgeAI long-term agentic roadmap

- **Decision:** ForgeAI should evolve into a small, transparent operating
  system for agentic software work: markdown first, model-agnostic by default,
  and extensible only where the workflow has proven value.
- **Why:** The project needs a durable strategic direction that future agents
  can follow without exposing internal planning phases to users who run
  `npx forgeai-agentic-init`.
- **Impact:** Future work should be evaluated against this roadmap before new
  templates, adapters, plugins, or automation become default. Public templates
  should stay generic unless the roadmap item is intentionally productized.

#### Phase 1: stronger project initialization

- Add project profiles: `--profile nextjs`, `--profile node-api`,
  `--profile tauri`, `--profile monorepo`, `--profile python-api`, and
  `--profile mobile`.
- Generate profile-specific rules, validation commands, testing strategy, and
  agent responsibilities.
- Add `forgeai-init --check-profile` to detect whether the installed harness
  matches the real stack.
- Add safer update mode so existing `.ai/` files can receive new templates
  without overwriting project-specific context.
- Add a migration guide for teams moving from single-agent instructions to the
  ForgeAI harness.

#### Phase 2: agentic lifecycle management

- Define a complete task lifecycle: intake, triage, planning, specification,
  assignment, execution, validation, review, revision, acceptance, delivery,
  memory update, and closure.
- Add lifecycle state files under `.ai/state/` so long-running work can resume
  without losing decisions, blockers, validation evidence, or ownership.
- Add lifecycle transitions with explicit entry and exit criteria for each
  state, including when work can move from draft to implementation, from
  implementation to review, and from review to accepted.
- Add lifecycle-specific templates for bugs, features, refactors, research,
  audits, incidents, release tasks, and dependency upgrades.
- Add a task journal format that records prompts, assumptions, decisions,
  files touched, commands run, tests executed, reviewer findings, and final
  outcome.
- Add stale-task detection for work that has been paused too long, has outdated
  assumptions, or needs rebasing against the current repository state.
- Add lifecycle closure rules that decide what should be written back to
  `.ai/MEMORY.md`, what belongs in changelogs or PR notes, and what should be
  discarded as temporary task context.

### 2026-06-26 - Phase 2 lifecycle foundation started

- **Decision:** Start Phase 2 by adding markdown-first lifecycle primitives to
  the installable harness: lifecycle state definitions, task journals,
  lifecycle management workflow, and task-type templates.
- **Why:** These files satisfy the core "agentic lifecycle management" roadmap
  without adding database-backed orchestration or brittle automation before the
  workflow has proven value.
- **Impact:** Future Phase 2 work should build on `.ai/state/lifecycle.md`,
  `.ai/state/tasks/_template.md`, `.ai/workflows/lifecycle-management.md`, and
  `.ai/workflows/task-types/*.md` rather than creating competing task-state
  formats.

### 2026-06-28 - Phase 2 lifecycle checker added

- **Decision:** Add `forgeai-init --check-lifecycle` as the first tooling gate
  for lifecycle state files and task journals.
- **Why:** Markdown lifecycle files help agents resume work, but long-running
  handoffs also need a cheap local check for missing lifecycle files, invalid
  task metadata, stale active journals, and closed tasks without a memory
  update decision.
- **Impact:** Agents should run `forgeai-init --check-lifecycle` before
  resuming paused work, handing off a task, or closing a task journal.

### 2026-07-01 - Phase 4 dropped; Phase 6 quality gates delivered

- **Decision:** Drop Phase 4 (plugin/marketplace layer). Deliver Phase 6
  (quality gates) instead: `forgeai-init --check-review`, a reviewer scorecard
  template, a quality-gates workflow, a pre-merge checklist, and a CI example.
- **Why:** A Claude Code plugin would be vendor-specific (the harness is
  model-agnostic) and its workflow skill would duplicate the `.ai/` markdown
  that `CLAUDE.md` already points to, causing version drift. The review gate
  closes the missing validate/review link in the lifecycle Phase 2 built and is
  model-agnostic markdown + a Node checker.
- **Impact:** The review gate requires real validation evidence and a completed
  scorecard before a task journal in `review|revision|acceptance|delivery|
  closed` can pass. It is part of `--check-all` and the CI example. Future work
  should extend this gate (e.g. deeper OpenSpec validation) rather than adding a
  competing review-state format. Plugin/marketplace work is deferred, not
  scheduled.

#### Phase 3: CodeGraph and legacy context discovery

- Add a CodeGraph/context graph layer so agents can orient themselves in very
  large legacy projects without reading the entire repository blindly.
- Define graph artifacts under `.ai/codegraph/` for modules, symbols,
  imports/exports, call edges, entrypoints, domain groupings, tests, risks,
  and generated summaries.
- Add a legacy bootstrap workflow that detects stacks, identifies entrypoints,
  maps high-risk modules, links tests to source, and records unknowns instead
  of guessing.
- Add task-time graph usage rules so agents select relevant context from the
  graph, then verify against real source files before editing.
- Add incremental refresh guidance for changed files, specific directories,
  and stale graph data so very large repositories do not require full reindexing
  for every task.
- Keep CodeGraph model-agnostic and artifact-first before adding parser-heavy
  automation or language-specific generators.

### 2026-06-27 - Phase 3 should be CodeGraph after lifecycle

- **Decision:** The phase after lifecycle management is CodeGraph/context
  discovery, focused on helping agents understand large, old, complex
  repositories before implementation work.
- **Why:** Legacy projects often fail agent workflows because the difficult
  part is finding the relevant entrypoints, hidden dependencies, side effects,
  tests, and domain boundaries before editing code.
- **Impact:** Plugin and marketplace work moves later. Near-term work should
  design `.ai/codegraph/` artifacts, bootstrap/update workflows, and rules for
  using graph context as a map while still verifying behavior in source code.

#### Phase 4: plugin and marketplace layer

- Add optional Claude Code plugin templates with `.claude-plugin/plugin.json`,
  marketplace metadata, workflow skills, and reviewer sub-agent wrappers.
- Add optional Codex plugin templates with `.codex-plugin/plugin.json`,
  marketplace metadata, and ForgeAI workflow skills.
- Keep plugins opt-in: the markdown harness remains usable without installing
  any plugin.
- Add a shared plugin authoring guide for Claude, Codex, Cline, RooCode,
  Aider, AGY, and local models.
- Add plugin smoke tests that verify workflow skill discovery, reviewer
  behavior, and marketplace metadata.

#### Phase 5: model routing and delegation

- Add provider adapter templates for Claude, Codex, AGY, local models, and
  custom CLI/API runners.
- Add routing policies for cost, latency, context size, risk, and model
  availability.
- Add assignment lifecycle tracking: created, delegated, returned, reviewed,
  rejected, fixed, and accepted.
- Add retry policy per task type so failed delegation does not loop forever.
- Add token and cost budgets per task, per model tier, and per session.

#### Phase 6: review, validation, and quality gates

- Add OpenSpec validation commands for proposal, design, task, and spec files.
- Add reviewer scorecards for correctness, scope control, security, tests,
  maintainability, and release risk.
- Add mandatory validation evidence fields to delegated assignment results.
- Add pre-merge checklist templates for GitHub, GitLab, Bitbucket, and
  local-only repositories.
- Add CI examples that run `forgeai-init --check`, `--check-git`, OpenSpec
  validation, lint, typecheck, and tests.

#### Phase 7: external workflow connectors

- Add Jira, Linear, GitHub Issues, GitLab Issues, and Bitbucket issue intake
  templates.
- Add PR/MR description generation through the `pr-writer` role.
- Add release-note and changelog workflows.
- Add incident/debug workflows that preserve timelines, hypotheses, evidence,
  and follow-up tasks.
- Add team handoff templates for async review and multi-day agent work.

#### Phase 8: memory and knowledge management

- Add structured memory sections for architecture decisions, recurring bugs,
  commands, test strategy, ownership, and deployment notes.
- Add stale-memory checks so agents can flag outdated assumptions instead of
  blindly following them.
- Add project context diffing so teams can review how `.ai/PROJECT.md`,
  `.ai/RULES.md`, and `.ai/MEMORY.md` evolve over time.
- Add import/export guidance for sharing stable knowledge across related
  repositories.

#### Phase 9: advanced agentic orchestration

- Add explicit multi-agent worktree strategy for parallel implementation,
  review, and conflict resolution.
- Add dynamic task decomposition where the orchestrator can split large work
  into bounded assignments with acceptance criteria.
- Add stronger fallback behavior when a delegated model is unavailable, out of
  quota, or returns incomplete work.
- Add human approval gates for high-risk edits, dependency changes, database
  migrations, security-sensitive code, and production workflows.
- Add evaluation tasks that compare single-agent vs. multi-agent outcomes on
  correctness, speed, cost, and review quality.

#### Phase 10: ecosystem and governance

- Publish stable template versioning and migration notes.
- Add contribution guidelines for new agents, skills, profiles, adapters, and
  plugin templates.
- Add compatibility notes for major AI coding tools.
- Add example repositories that demonstrate real workflows end to end.
- Keep the core small: new automation should prove that it improves
  reliability, reviewability, or team handoff before becoming default.
