# ForgeAI Roadmap

`Task` -> `Select` -> `Compile Context` -> `Route` -> `Agents` -> `Review` -> `Done`

ForgeAI's primary direction is to control what enters model context before a
model reads it. Orchestration, integrations, and analytics build on that
boundary; they do not replace it.

## Product Principles

1. Select context from repository evidence, not confidence or file order.
2. Send the smallest complete input that preserves relevant contracts.
3. Treat token budgets as enforced boundaries where technically possible, not
   documentation-only hints.
4. Expand context explicitly and incrementally when the initial input is
   insufficient.
5. Claim scope control and consistency by default. Claim token savings only
   when supported by provider usage data.
6. Keep the core workflow local, deterministic, and model-agnostic. Provider
   integrations are optional adapters.

## Current Delivery Priority

Phase numbers describe the product architecture; they are not the current
delivery order. Near-term work prioritizes core user value and upgrade trust
before audience expansion and distribution:

1. ~~**Phase 14 - Upgrade and release UX.**~~ Shipped in 3.4.0. Managed-file
   previews, consistent apply/dry-run output, downgrade protection, migration
   notes, `--check-upgrade` for CI, and dynamic version test fixtures.
2. **Phase 16 - Profiles and composition.** Expand backend and mobile coverage
   after the dependency graph contract is stable enough for language-specific
   parsers.
3. **Phase 15 - CI/CD integration.** Add the adoption loop after the local
   value proposition and upgrade path are dependable.

---

## Completed Foundation

### Phase 1 - Multi-agent harness baseline

Root pointer files (`CLAUDE.md`, `AGENTS.md`), agent registry, agent role
templates, model-agnostic skills, Claude-native skill wrappers, and first-run
context bootstrap guidance.

### Phase 2 - Lifecycle state management

Agentic lifecycle states, task journals, task-type templates, stale-task
detection, closure rules, and `forgeai-init --check-lifecycle`.

### Phase 3 - CodeGraph foundation

`.ai/codegraph/` artifacts, graph validation, graph-guided context-pack
workflow, `forgeai-init --check-codegraph`, and bootstrap/read-order
integration.

This phase established a context index. It does not yet provide semantic
dependency traversal or source-level context compilation.

### Phase 4 - Quality gates

Review scorecards, `forgeai-init --check-review`, pre-merge checks, validation
evidence, and lifecycle gates from review through acceptance and closure.

### Phase 5 - Supply-chain safety and memory management

`forgeai-init --check-security`, security policy, private-key and unsafe install
detection, `forgeai-init --check-memory`, structured memory, and stale-memory
checks.

### Phase 6 - Multi-agent orchestration

Worktree strategy, C+R+A+X task scoring, model tiers, bounded assignments,
`forgeai-init --decompose`, approval and evaluation checks, CLI routing, and
graceful fallback.

### Phase 7 - Terminal workflow monitor

Ink-based monitor, named-pipe event bus, NDJSON workflow events, live agent and
check panels, and `forgeai-init --watch` / `--emit`.

### Phase 8 - Scope guidance v1

`forgeai-init --context-pack` for keyword-based CodeGraph node selection,
`--decompose --compact` for bounded delegation templates, compact
status/diff/test diagnostics, and RTK guidance.

What this phase delivers:

- Tokenise objective into keywords, match against node metadata.
- Return a ranked list of up to five file paths as read guidance.
- Return an explicit no-match result when the objective matches nothing;
  never fall back to confidence ranking or graph order.
- Compact assignment template with explicit write scope and validation command.
- Diagnostic summaries for git status, diff, and test output.

Scope and limits:

- Selection is keyword-based, not import-graph or symbol-aware.
- Output is a file list, not a compiled excerpt payload.
- No deduplication of contracts, rules, or repeated source.
- No enforcement preventing an agent from reading outside the suggested paths.

This phase is scope guidance. Context compilation begins in Phase 9.

### Phase 9 - Dependency-aware context selection

Static import/export/require parsing for TypeScript and JavaScript, forward and
reverse module edge traversal, seed selection from objective-matched source
paths and symbol names (exported and non-exported), test prioritization, SHA-256
fingerprinting and stale detection, explicit no-match result, and traversal
bounds. Shipped in 3.2.0 alongside the context compiler. Non-exported
declaration names added to seed scoring in 3.3.x.

---

## Core Context Roadmap

### Phase 10 - Context Compiler

Status: TypeScript/JavaScript MVP implemented in 3.2.0. Applicable rule packing
and read-only diagnostics are included; memory selection, symbol-level caller
analysis, and additional language extractors remain open.

Turn selected files into the actual bounded payload given to a model.

Deliverables:

- Extract relevant functions, classes, interfaces, imports, callers, and tests
  instead of sending whole files by default.
- Preserve public contracts and line/source provenance for every excerpt.
- Select only task-applicable rules, workflow instructions, and project memory.
- Deduplicate contracts, rules, summaries, and repeated source excerpts.
- Exclude lockfiles, generated artifacts, snapshots, fixtures, and large data
  files unless the task or dependency graph explicitly requires them.
- Pack assignment, rules, contracts, source excerpts, tests, and diagnostics by
  priority into a configured input budget.
- Never truncate in the middle of a syntax node or public contract.
- Emit machine-readable JSON as the source of truth and a Markdown rendering
  for inspection.

Proposed command:

```bash
forgeai-init --compile-context \
  --objective "refactor router fallback" \
  --budget 6000 \
  --output .ai/state/context/TASK-01.json
```

Exit criteria:

- Compiled input is deterministic and never exceeds its configured estimate.
- Every included excerpt has a reason and source location.
- The router can consume the compiled payload without reopening selected files.

### Phase 11 - Enforced context boundary and controlled expansion

Make compiled context the router input rather than optional guidance.

Deliverables:

- Require a compiled context artifact for bounded delegated assignments.
- Reject malformed, stale, or over-budget payloads before invoking an adapter.
- Pass only the compiled payload through CLI adapter `stdin` or API messages.
- Add a structured `need_context` response for requesting missing symbols,
  callers, tests, or contracts.
- Validate each request against the CodeGraph and assignment read scope.
- Compile small delta payloads without resending unchanged context.
- Record included and intentionally omitted context in the task journal.

Input-size enforcement is adapter-independent and can apply to CLI wrappers.
Provider-native limits and exact usage reporting remain responsibilities of the
LLM-native adapter phase.

Exit criteria:

- A delegated model cannot receive arbitrary repository files through the
  normal router path.
- Additional context is explicit, justified, bounded, and incremental.

### Phase 12 - LLM-native adapter layer

Add first-class API adapters alongside existing CLI adapters.

Deliverables:

- OpenAI, Anthropic, and Gemini adapter interfaces with provider-specific
  implementations kept behind a common contract.
- Streaming output and normalized lifecycle events.
- Provider-native output limits and supported token-budget parameters.
- Structured input, output, cached-token, latency, retry, and quota metadata.
- Normalized rate-limit and quota fallback behavior.
- Secret handling that does not write credentials into project files.
- CLI adapters remain supported as local and model-agnostic fallbacks.

Exit criteria:

- API and CLI adapters consume the same compiled context artifact.
- Provider usage data is stored without requiring manual transcription.
- Adapter failures preserve assignment and context boundaries during fallback.

### Phase 13 - Evaluation and routing feedback

Build evaluation on structured adapter and context records, not manually entered
dashboard data.

Deliverables:

- JSON run records for model calls, context artifacts, outcomes, and validation.
- Optional baseline and compact task modes using the same acceptance criteria.
- Context metrics such as selected files, excerpts, expansion requests, and
  context escapes.
- Terminal reports for token cost, latency, retries, pass rate, and model tier.
- Routing recommendations remain advisory until enough valid runs exist.
- A dashboard is optional presentation, not the data model or primary outcome.

ForgeAI continues to claim bounded input without benchmark data. Quantified
token-saving claims require provider-reported usage from comparable runs.

---

## Platform Hardening

### Phase 14 - Upgrade and release UX ✓ Shipped in 3.4.0

Extend the existing `--upgrade` and preservation behavior rather than replacing
it.

Deliverables:

- Preview managed-file changes before overwrite. ✓
- Changelog and migration notes for breaking template or schema changes. ✓
- Schema migrations for CodeGraph, context artifacts, and evaluation records.
  (schema-specific migrations deferred to ship alongside schemas they migrate)
- Preserve project-owned memory, graph content, routing, security policy, and
  run state unless `--force` is explicit. ✓
- Opt-in CI upgrade checks; never silently rewrite a working harness. ✓

### Phase 15 - CI/CD integration

Provide official GitHub Actions and GitLab CI templates for deterministic
checks.

Deliverables:

- Jobs for `--check-all`, security, review, CodeGraph freshness, and compiled
  context schema validation.
- Required-check examples without provider credentials.
- Optional adapter integration tests when CI secrets are configured.
- Harness version and check-status reporting.

### Phase 16 - Profiles and composition

Build on the existing Next.js, Node API, Python API, mobile, monorepo, and Tauri
detection rather than treating them as new foundations.

Deliverables (3.5.0):

- Add missing Go, Rust, FastAPI-specific, Django, and React Native guidance.
- Support explicit composition such as `nextjs+monorepo`.
- Add confidence and ambiguity reporting to auto-detection.
- Defer a community profile registry until package verification exists.

Deferred to Phase 16.1:

- Profile-registered language-specific dependency parsers. Hard-coded
  detection covers the 3.5.0 profiles; a registry interface requires a
  stable parser contract which does not yet exist.
- Code-level context exclusion enforcement. Each 3.5.0 profile documents
  exclusion hints in Markdown; wiring these hints to `--context-pack` /
  `--compile-context` follows in 16.1 once the parser interface is defined.

### Phase 17 - Concurrent session locking

Extend the existing write-scope overlap detection with active coordination.

Deliverables:

- Atomic lock acquisition for files or normalized scope prefixes.
- Ownership, expiry, heartbeat, and stale-lock recovery.
- Worktree-aware conflict messages.
- Crash-safe release without treating a lock file as source code state.
- Keep `--check-sessions` as the read-only validation and recovery surface.

---

## Ecosystem and Scale

These phases begin only after compiled context and adapter boundaries are
stable. Each increases the cost of a context-selection or security mistake.

### Phase 18 - Multi-repo and advanced monorepo coordination

- Federated CodeGraph indexes with explicit repository identity and revision.
- Cross-repository contracts without copying unrestricted source context.
- Per-package context budgets and session scopes.
- Shared routing policy with repository-local security and ownership rules.

### Phase 19 - Verified plugin and skill distribution

- Versioned skill and profile packages.
- Signature, provenance, permission, and supply-chain verification.
- Installation preview showing all rules and context added by a package.
- Context-cost declaration so plugins cannot silently inflate every prompt.

### Phase 20 - Remote orchestration and workflow triggers

- Authenticated task intake from GitHub, Linear, Jira, and webhooks.
- Queue-backed execution with idempotency, retry, timeout, and dead-letter
  handling.
- Human approval for risky task types and context expansion.
- Tenant, repository, credential, and context isolation.
- Remote execution uses the same compiled-context and review gates as local
  execution.

---

## Explicit Non-Goals Until The Core Is Stable

- No embedding or vector database requirement for context selection.
- No autonomous broad repository reads after context compilation.
- No marketplace that can inject unreviewed instructions into every task.
- No remote unattended execution that bypasses approval or context boundaries.
- No token-saving percentage in public documentation without provider-reported
  evidence.
