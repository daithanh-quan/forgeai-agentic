# CodeGraph Context Workflow

Use this workflow before substantial edits in large, legacy, or unfamiliar
repositories.

## 1. Decide Whether CodeGraph Is Required

CodeGraph is required when the task crosses modules, changes shared contracts,
touches risky infrastructure, or when the relevant code is not obvious from
`.ai/PROJECT.md`, `.ai/MEMORY.md`, and direct search.

For small, obvious edits, record that CodeGraph was not needed in the task
journal and continue with normal lifecycle management.

## 2. Check Graph Health

Run:

```bash
forgeai-init --check-codegraph
```

If the graph is missing, still a template, invalid, or stale, refresh it
before relying on it for task planning.

## 3. Refresh the Graph

Read repository evidence first:

- package/build config and workspace boundaries
- top-level directories and entrypoints
- route/API definitions, data models, migrations, generated code markers
- tests and fixtures that reveal public behavior
- recent churn from git history when available

Update `.ai/codegraph/graph.json` with important modules and dependency
relationships. Update `.ai/codegraph/hotspots.md` with risky areas and
required checks.

## 4. Build a Task Context Pack

Copy `.ai/codegraph/context-packs/_template.md` to
`.ai/codegraph/context-packs/TASK-YYYYMMDD-short-slug.md`.

Fill only task-relevant context:

- relevant graph nodes and paths
- files that must be read before editing
- likely write scope
- contracts and callers to preserve
- validation plan
- unknowns that still need direct inspection

## 5. Use the Pack During Work

Read every required file listed in the context pack before editing it. Keep
the task journal write scope aligned with the context pack and session table.
If direct code reading contradicts the graph, trust the code, update the
graph, and note the correction in the task journal.

## 6. Closeout

Before delivery, update the graph only when the task changed architecture,
module boundaries, public contracts, ownership, or risk hotspots. Otherwise,
record that no CodeGraph update was needed.
