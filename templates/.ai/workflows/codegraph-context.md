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

Generate the file-level dependency graph first:

```bash
forgeai-init --refresh-codegraph
```

This is an explicit write. Context-pack creation never refreshes the graph
silently. The generated graph records source hashes and a repository
fingerprint, so any added, removed, or changed TypeScript/JavaScript file makes
the graph stale.

For the curated `graph.json`, read repository evidence:

- package/build config and workspace boundaries
- top-level directories and entrypoints
- route/API definitions, data models, migrations, generated code markers
- tests and fixtures that reveal public behavior
- recent churn from git history when available

Update `.ai/codegraph/graph.json` with important modules and dependency
relationships. Update `.ai/codegraph/hotspots.md` with risky areas and
required checks.

## 4. Build a Task Context Pack

Generate a dependency-aware context pack:

```bash
forgeai-init --context-pack --objective "<task objective>" \
  --output .ai/codegraph/context-packs/TASK-YYYYMMDD-short-slug.md
```

Fill only task-relevant context:

- objective-matched seeds and justified dependency paths
- files that must be read before editing
- likely write scope
- contracts and callers to preserve
- validation plan
- unknowns that still need direct inspection

## 5. Use the Pack During Work

For delegated or context-sensitive work, compile the selected files before
routing:

```bash
forgeai-init --compile-context --objective "<task objective>" \
  --budget 6000 \
  --output .ai/state/context/TASK-ID.json
```

Inspect the sibling Markdown file, but treat JSON as the source of truth. See
`.ai/workflows/context-compilation.md` for budget and expansion rules.

Read every required file listed in the context pack before editing it. Keep
the task journal write scope aligned with the context pack and session table.
If direct code reading contradicts the graph, trust the code, update the
graph, and note the correction in the task journal.

## 6. Closeout

Before delivery, update the graph only when the task changed architecture,
module boundaries, public contracts, ownership, or risk hotspots. Otherwise,
record that no CodeGraph update was needed.
