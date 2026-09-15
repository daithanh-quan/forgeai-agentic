<div align="center">

<img src="docs/assets/banner-readme.png" alt="ForgeAI Agentic Init" width="720" />

### A G E N T I C &nbsp;&nbsp; I N I T

`Task` → `Context` → `Route` → `Agents` → `Review` → `✓`

**A project-local workflow harness for AI coding agents**

[![npm version](https://img.shields.io/npm/v/forgeai-agentic-init?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/forgeai-agentic-init)
[![Node.js ≥20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

[Quick start](#quick-start) · [Monitor](#terminal-monitor) · [Profiles](#profiles) · [Commands](#core-commands)

</div>

---

ForgeAI installs a plain-file `.ai/` harness into your repository: shared
project context, rules, memory, task lifecycle, model routing, review gates,
and bounded context tools. It works with any coding agent that can read
Markdown; no server or database is required.

## Quick start

Requirements: Node.js 20+ and npm, pnpm, or Yarn.

Run the initializer from your project root:

| Package manager | Command |
| --- | --- |
| npm / npx | `npx --yes forgeai-agentic-init@latest --profile auto` |
| npm exec | `npm exec --yes --package=forgeai-agentic-init@latest -- forgeai-init --profile auto` |
| pnpm | `pnpm dlx forgeai-agentic-init@latest --profile auto` |
| Yarn 2+ | `yarn dlx forgeai-agentic-init@latest --profile auto` |

Then build the source graph and verify the harness:

```bash
npx --yes forgeai-agentic-init@latest --refresh-codegraph
npx --yes forgeai-agentic-init@latest --check
```

Finally, tell your coding agent:

```text
Read AGENTS.md and follow the ForgeAI workflow for this task.
```

ForgeAI creates root `AGENTS.md` and `CLAUDE.md` pointers, so Codex and Claude
Code discover the harness automatically. Other tools should start at
`.ai/README.md`.

> Installing the npm package is not initialization. `npm install`, `pnpm add`,
> or `yarn add` only adds a dependency. The commands above execute the CLI and
> create `.ai/`. ForgeAI deliberately has no `postinstall` hook that silently
> writes project files.

## See it before installing

Preview the complete task plan in one command:

```bash
npx --yes forgeai-agentic-init@latest task --dry-run "add authentication middleware"
```

This combines profile detection, relevant context, adapter availability, and
validation commands without writing `.ai/` or changing source files.

Adapter names are annotated as `available`, `unavailable`, or `unknown` using
their configured healthcheck, so a preview exposes setup problems before an
execution attempt.

With a CLI adapter configured, the same command can execute the bounded task
after confirmation:

```bash
npx --yes forgeai-agentic-init@latest task "fix the login validation bug" --yes
```

ForgeAI snapshots git state, checks changes against the selected context (or an
explicit `--write-scope`), and runs detected validation scripts. API-only
adapters remain previewable but cannot apply repository edits.

For CI or scripts, add `--json`; the result includes status, scope, changed
files, validation results, and the next action. Reports are also saved under
`.ai/state/tasks/`.

Preview context selection without creating `.ai/` or writing files:

```bash
npx --yes forgeai-agentic-init@latest try "add authentication middleware"
```

Preview the files initialization would create:

```bash
npx --yes forgeai-agentic-init@latest --dry-run --profile auto
```

## Terminal monitor

The Ink UI is an event monitor. Start it in terminal A from the project root:

```bash
npx --yes forgeai-agentic-init@latest --watch
```

It should immediately show `READY`. In terminal B, run a check to verify the
event connection:

```bash
npx --yes forgeai-agentic-init@latest --check-all
```

You can also send a manual event:

```bash
npx --yes forgeai-agentic-init@latest --emit \
  '{"type":"orchestrator.start","task":"Build auth flow","ts":1720000000}'
```

The monitor receives events from:

- ForgeAI check commands such as `--check` and `--check-all`.
- Native API routes run with `--route`.
- Delegated CLI assignments run through `.ai/router/run-model.ts`.
- Explicit `--emit` calls.

It does **not** inspect arbitrary Codex, Claude Code, or shell processes. If no
ForgeAI command emits an event, `READY` is the expected state. The watcher and
event producer must use the same project directory, or the same absolute
`FORGEAI_PIPE` path.

## What gets installed

```text
.ai/
├── PROJECT.md          project identity and constraints
├── RULES.md            mandatory engineering rules
├── MEMORY.md           durable decisions and pitfalls
├── WORKFLOW.md         task lifecycle
├── AGENT_REGISTRY.md   roles and delegation policy
├── model-routing.yaml  model tiers and token budgets
├── cli-adapters.json   local model CLI adapters
├── api-adapters.json   native API adapters
├── codegraph/          source map and dependency graph
├── skills/             model-agnostic task guidance
├── state/              tasks, reviews, runs, and context artifacts
└── workflows/          review, security, and lifecycle playbooks
```

The detailed operating guide lives in `.ai/README.md` after initialization.

## Profiles

`--profile auto` detects the project stack. You can also select or combine
profiles explicitly:

```bash
npx --yes forgeai-agentic-init@latest --profile nextjs
npx --yes forgeai-agentic-init@latest --profile fastapi+go
npx --yes forgeai-agentic-init@latest --profile tauri+react-native
```

Available profiles: `nextjs`, `sveltekit`, `node-api`, `python-api`, `fastapi`,
`django`, `go`, `rust`, `mobile`, `react-native`, `tauri`, and `monorepo`.

```bash
npx --yes forgeai-agentic-init@latest --list-profiles
```

## Bounded context and routing

Compile only the relevant source context for a task:

```bash
npx --yes forgeai-agentic-init@latest --compile-context \
  --objective "refactor router fallback" \
  --task TASK-20260903-router \
  --output .ai/state/context/TASK-20260903-router.json
```

Route that artifact through a configured adapter:

```bash
npx --yes forgeai-agentic-init@latest --route \
  --artifact .ai/state/context/TASK-20260903-router.json \
  --adapter anthropic
```

API keys are read only from environment variables: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `GOOGLE_API_KEY`. Never add keys to project files.

Model routing is explicit. ForgeAI provides policy and adapters; your active
agent still needs to follow `AGENTS.md` and invoke the router when delegation
is useful.

## Core commands

| Command | Purpose |
| --- | --- |
| `try "<objective>"` | Preview context selection without initialization |
| `task --dry-run "<objective>"` | Preview a complete bounded task plan |
| `task "<objective>" --yes` | Execute through a CLI adapter and validate the change |
| `--profile auto` | Initialize with stack detection |
| `--upgrade` | Update managed harness files while preserving project state |
| `--refresh-codegraph` | Rebuild the dependency graph |
| `--compile-context` | Create a bounded context artifact |
| `--route` | Send an artifact to a configured model adapter |
| `--watch` | Start the Ink terminal monitor |
| `--check` | Validate the installed harness |
| `--check-all` | Run all local ForgeAI gates |
| `--check-upgrade` | Compare installed harness and CLI versions offline |
| `--decompose` | Produce a scored task decomposition |
| `--evaluate` / `--report` | Record and aggregate task outcomes |

See every command and option:

```bash
npx --yes forgeai-agentic-init@latest --help
```

## CI

A GitHub Actions starter is included at
[`ci-templates/github/forgeai.yml`](./ci-templates/github/forgeai.yml). Pin the
ForgeAI version in CI rather than using `@latest`.

## Upgrade

```bash
npx --yes forgeai-agentic-init@latest --check-upgrade
npx --yes forgeai-agentic-init@latest --upgrade
```

Project context, task journals, run records, routing customizations, and memory
are preserved during a normal upgrade. Use `--force` only when you explicitly
want to overwrite preserved files.

## License

MIT
