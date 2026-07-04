<!-- forgeai-memory: max-age-days=180 -->
# Project Memory

This file stores durable memory for the ForgeAI Agentic Init repository itself.
It is not part of the npm package because `package.json#files` only publishes
`dist`, `profiles`, `templates`, and `README.md`.

## Roadmap

Consolidated 2026-07-03. Phases are renumbered to a clean sequence; the dated
decision entries below keep the original numbering, so use this mapping when
reading history: old Phase 5 -> new Phase 4, old Phase 6 -> new Phase 5, old
Phase 7 (pivoted) -> new Phase 6, old Phase 8/9/10 -> new Phase 7/8/9. Old
Phase 4 (plugins) and the original Phase 7 (connectors) were dropped and
carry no new number.

### Delivered

- **Phase 1 — stronger project initialization.** Stack profiles
  (`--profile <name|auto>`, `--check-profile`), safer `--upgrade` with
  preserve-on-upgrade rules. Artifacts: `profiles/`, `bin/lib/profiles.ts`,
  `bin/lib/init.ts`.
- **Phase 2 — agentic lifecycle management.** Lifecycle states, task
  journals, `--check-lifecycle`. Artifacts: `.ai/state/lifecycle.md`,
  `.ai/state/tasks/_template.md`, `.ai/workflows/lifecycle-management.md`,
  `.ai/workflows/task-types/`.
- **Phase 3 — CodeGraph and legacy context discovery.** Artifact-first
  repository map with `--check-codegraph [--strict]`. Artifacts:
  `.ai/codegraph/`, `.ai/workflows/codegraph-context.md`.
- **Phase 4 — model routing and delegation** (old Phase 5). Tiered routing
  with token budgets, CLI adapters, delegation runtime with healthcheck and
  fallback, retry policies, `--add-model`/`--list-models`/`--remove-model`.
  Artifacts: `.ai/model-routing.yaml`, `.ai/cli-adapters.json`,
  `.ai/router/run-model.ts`, `.ai/workflows/delegated-assignment.md`.
- **Phase 5 — review, validation, and quality gates** (old Phase 6).
  Review gate requiring validation evidence and a completed scorecard,
  `--check-review`, pre-merge checklist, CI example. Artifacts:
  `.ai/state/reviews/_template.md`, `.ai/workflows/quality-gates.md`,
  `.ai/workflows/pre-merge-checklist.md`.
- **Phase 6 — supply-chain and untrusted-source safety** (pivot of old
  Phase 7). `--check-security` scanning pipe-to-shell installs,
  off-registry/unpinned deps, install scripts, committed private keys, with
  human-approved dependency and path exceptions. Artifacts:
  `.ai/security-policy.yaml`, `.ai/workflows/supply-chain-safety.md`,
  `bin/lib/security.ts`.
- **Phase 7 — memory and knowledge management** (old Phase 8, narrowed).
  Structured `templates/.ai/MEMORY.md` template (decisions, conventions, business rules,
  recurring bugs, commands, test strategy, ownership, deployment notes) and
  a `--check-memory` stale-memory gate (dead path refs fail; TODOs, over-age
  entries, malformed decision entries warn), configured by an inline
  `forgeai-memory: max-age-days` directive and aggregated into
  `--check-all`. Context diffing was dropped (covered by git); import/export
  guidance was deferred. Artifacts: `templates/.ai/MEMORY.md`,
  `.ai/workflows/memory-management.md`, `bin/lib/memory.ts`.

### Dropped

- **Plugin and marketplace layer** (old Phase 4). Dropped 2026-07-01:
  vendor-specific, and its workflow skills would duplicate the `.ai/`
  markdown causing version drift. Empty scaffolding directories were
  removed 2026-07-03. Revisit only with a concrete need that the markdown
  harness cannot serve.
- **External workflow connectors** (original old Phase 7: Jira/Linear/board
  issue intake). Dropped 2026-07-02: users prompt the agent with their own
  task descriptions, so connectors add integration surface without clear
  value.

### Upcoming

- **Phase 8 — advanced agentic orchestration** (old Phase 9).
  - Explicit multi-agent worktree strategy for parallel implementation,
    review, and conflict resolution.
  - Dynamic task decomposition where the orchestrator can split large work
    into bounded assignments with acceptance criteria.
  - Stronger fallback behavior when a delegated model is unavailable, out of
    quota, or returns incomplete work.
  - Human approval gates for high-risk edits, dependency changes, database
    migrations, security-sensitive code, and production workflows.
  - Evaluation tasks that compare single-agent vs. multi-agent outcomes on
    correctness, speed, cost, and review quality.
- **Phase 9 — ecosystem and governance** (old Phase 10).
  - Publish stable template versioning and migration notes.
  - Contribution guidelines for new agents, skills, profiles, and adapters.
  - Compatibility notes for major AI coding tools.
  - Example repositories that demonstrate real workflows end to end.
  - Keep the core small: new automation should prove that it improves
    reliability, reviewability, or team handoff before becoming default.

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

### 2026-07-02 - Phase 7 pivoted to supply-chain safety

- **Decision:** Drop the original Phase 7 (external workflow connectors:
  Jira/Linear/board issue intake). Deliver a supply-chain & untrusted-source
  safety gate instead: hardened `.ai/RULES.md`, `.ai/security-policy.yaml`,
  `.ai/workflows/supply-chain-safety.md`, and `forgeai-init --check-security`
  (aggregated into `--check-all`).
- **Why:** Users prompt the agent with their own task descriptions, so board
  connectors add integration surface without clear value. Meanwhile an
  autonomous agent installing packages and reading the open web can bring
  malicious code onto the machine — a real, present risk with no machine
  check today. Mirrors the earlier Phase 4 drop.
- **Impact:** `--check-security` fails on pipe-to-shell installs, off-registry
  or unpinned dependencies, suspicious install scripts, and committed private
  keys, unless an exception is recorded in `.ai/security-policy.yaml`.

### 2026-07-03 - Roadmap consolidated; dropped phases removed

- **Decision:** Collapse the scattered phase sections into one Roadmap section
  (Delivered / Dropped / Upcoming), remove the full specs of the two dropped
  phases, and renumber the remaining phases into a gapless sequence (mapping
  recorded at the top of the Roadmap section). Also delivered the same day:
  path exceptions for `--check-security`, harness drift fixed via `--upgrade`,
  CodeGraph populated, and the published CLI switched to compiled JS with zero
  runtime dependencies.
- **Why:** The old layout interleaved delivered, dropped, and future phase
  specs with dated decisions, so agents had to reverse-engineer the real
  status. Dropped-phase specs invited accidental resurrection (empty plugin
  scaffolding lingered for a week).
- **Impact:** Agents should read the Roadmap section for current status and
  the dated entries only for rationale. New phases get the next free number;
  dropped work is recorded under Dropped with a one-line reason instead of a
  full spec.

### 2026-07-03 - Phase 7 memory gate is convention-first and warn-biased

- **Decision:** `--check-memory` ships with hardcoded defaults plus a single
  inline directive (`forgeai-memory: max-age-days`) instead of a policy
  file; only dead path references fail, all structural signals warn.
- **Why:** `--upgrade` preserves populated `.ai/MEMORY.md` files, so upgraded
  repos keep old formats forever — a hard-failing format gate would block
  them. A policy file (the `.ai/security-policy.yaml` route) adds a template and
  an upgrade-preserve rule for one knob most repos never tune.
- **Impact:** New config needs for the memory gate should extend the
  directive, not add files. Structural checks must stay warn-only.
