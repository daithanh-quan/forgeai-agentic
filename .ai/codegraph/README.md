# CodeGraph

CodeGraph is the repository context map agents use before editing code in
large or unfamiliar projects. It is intentionally lightweight: markdown for
human-readable summaries and JSON for machine-checkable relationships.

## Files

- `graph.json` — canonical machine-readable graph of important modules,
  ownership, dependencies, and confidence.
- `hotspots.md` — high-risk areas, churn, fragile contracts, and files that
  deserve extra review.
- `context-packs/_template.md` — template for task-specific context packs.
  Copy it to `context-packs/TASK-YYYYMMDD-short-slug.md` before substantial
  edits in a legacy or broad codebase.

## When agents must use this

Use CodeGraph before editing when any of these are true:

- The repository is large, old, unfamiliar, or weakly documented.
- The task touches shared architecture, cross-module contracts, migrations,
  routing, authentication, billing, persistence, build tooling, or public API.
- The relevant files are not obvious after reading `.ai/PROJECT.md` and
  `.ai/MEMORY.md`.
- Multiple agents are working in parallel and need disjoint context/write
  scopes.

## Maintenance Rules

- Prefer summaries and relationships over exhaustive file listings.
- Record confidence honestly: `high`, `medium`, or `low`.
- Leave `TODO` only when the repository cannot answer the question yet.
- Refresh stale graph data before planning risky edits.
- Do not use CodeGraph as a substitute for reading the actual files before
  changing them.
