# Bootstrap Instructions

This file guides any AI coding agent (Claude Code, Codex, AGY CLI, Cline,
RooCode, Aider, or other) through first-run setup of a project that was just
initialized with the ForgeAI agentic-init harness.

## 1. Files to Read First

Before reading or editing project context, the agent runs a ForgeAI version
preflight:

```bash
npx forgeai-agentic-init@latest --check-updates --check
```

If the installed harness is outdated, ask the human whether to skip for now
or update to the latest version. If the human chooses update, the agent runs
`npx forgeai-agentic-init@latest --upgrade`. Do not modify source code while
this decision is pending.

Read in this order before doing anything else:

1. `.ai/README.md`
2. `.ai/PROJECT.md`
3. `.ai/RULES.md`
4. `.ai/MEMORY.md`
5. `.ai/TASTE.md`
6. `.ai/WORKFLOW.md`
7. `.ai/AGENT_REGISTRY.md`
8. `.ai/codegraph/README.md`

## 2. Files to Populate

These files ship with placeholders. Fill them in from the real repository —
never from assumptions:

- **`.ai/PROJECT.md`** — project identity, stack, architecture, important
  directories. Each section now contains an HTML comment describing where
  to find the answer (e.g. `package.json`, lockfiles, config files, folder
  layout). Remove each comment once that section is filled in.
- **`.ai/MEMORY.md`** — keep the structure intact; add entries only for
  decisions or conventions that are already true today (something you
  discovered in the existing code). Do not invent future decisions.
- **`.ai/AGENT_REGISTRY.md`** — adjust agent descriptions only if this
  project has roles that differ from the defaults. Otherwise leave as-is.
- **`.ai/state/CURRENT.md`** — set "Active task" and "Last updated" once the
  first real task begins. Leave as `none` until then.
- **`.ai/codegraph/graph.json`** — replace the template with a concise module
  graph when the repository is large, legacy, or cross-module work is likely.
  Keep `generated_at` as `YYYY-MM-DD`, record confidence, and include only
  modules that help future agents choose context.
  **Stay shallow at bootstrap.** Map only top-level modules/packages and the
  obvious relationships you can see from the directory layout, entrypoints, and
  manifests — do **not** read source files exhaustively just to populate the
  graph. Mark uncertain nodes/edges with `confidence: low`. Expand a node only
  when a real task touches that area, refreshing `generated_at` then. The goal
  is a navigation aid, not a complete code map.
- **`.ai/codegraph/hotspots.md`** — record risky shared areas, contracts, and
  required checks discovered from the current repository. Leave TODOs only
  where evidence is unavailable.

## 3. Files That Must Not Be Modified During Bootstrap

- `.ai/RULES.md`
- `.ai/TASTE.md`
- `.ai/WORKFLOW.md`
- `.ai/workflows/*`
- `.ai/codegraph/context-packs/*`
- `.ai/agents/*`
- `.ai/skills/*`
- `.claude/skills/*`
- `openspec/*`
- Any application source code

Bootstrap is a context-population step, not an implementation step. Do not
edit application code, rules, or workflow definitions while bootstrapping.

## 4. How to Discover Repository Context

Before writing into `.ai/PROJECT.md`, inspect:

- `package.json` (or `pyproject.toml`, `go.mod`, `Cargo.toml`, etc.) for
  project name, scripts, dependencies, and package manager — check which
  lockfile is present (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
  `bun.lockb`).
- The top-level folder layout for architecture and important directories.
- Existing config files (`tsconfig.json`, `next.config.*`, `vite.config.*`,
  `docker-compose.yml`, etc.) for framework and deployment clues.
- Existing README files for product intent and setup instructions.
- `git remote -v` for the repository URL, if available.

## 5. Handling Unknown Information

- If a field cannot be determined from the repository, leave it as `TODO`
  and add a short note explaining what is missing — do not guess.
- Do not invent business rules, integrations, or architecture decisions.
- If a placeholder blocks safe progress (e.g. unknown package manager before
  running install scripts), ask the human rather than guessing.
- Mark uncertain entries clearly, e.g. `TODO (unconfirmed): ...`, so future
  agents know to verify rather than trust them.
