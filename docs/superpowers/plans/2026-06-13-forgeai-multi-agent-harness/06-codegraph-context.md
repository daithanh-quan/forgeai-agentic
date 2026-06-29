# Phase 3 CodeGraph Context Support

**Status:** Complete.

**Goal:** Add lightweight repository context graph support so agents can select
the right context before editing large, legacy, or unfamiliar projects.

## Implemented

- Added `.ai/codegraph/README.md` with purpose, usage triggers, and maintenance
  rules.
- Added `.ai/codegraph/graph.json` as the canonical machine-readable module
  graph template.
- Added `.ai/codegraph/hotspots.md` for risky areas, shared contracts, legacy
  constraints, and refresh evidence.
- Added `.ai/codegraph/context-packs/_template.md` for task-specific context
  packs that tie graph nodes to required file reads, write scope, contracts,
  validation, and unknowns.
- Added `.ai/workflows/codegraph-context.md` for graph health checks, graph
  refresh, context-pack creation, use during edits, and closeout.
- Integrated CodeGraph into `.ai/README.md`, `.ai/BOOTSTRAP.md`, and the root
  README installation/diagnostic docs.
- Added `forgeai-init --check-codegraph` to validate CodeGraph installation,
  detect unbootstrapped template graphs, reject invalid graph metadata, detect
  stale graphs older than 30 days, and validate node/edge references.
- Bumped the package version to `2.3.0`.

## Verification

```bash
npm test
```

Observed result: `30/30` tests passed.
