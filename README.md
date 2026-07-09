<div align="center">

<p align="center">
  <img src="docs/assets/banner.png" alt="ForgeAI Agentic Init" width="720" />
</p>

### A G E N T I C &nbsp;&nbsp; I N I T

`Task` → `Decompose` → `Score` → `Route` → `Agents` → `Review` → `✓`

**The AI workflow operating system for multi-agent coding teams**

[![npm version](https://img.shields.io/npm/v/forgeai-agentic-init?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/forgeai-agentic-init)
[![Node.js ≥20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

[Install](#install) · [Terminal UI](#terminal-ui) · [Model Routing](#model-routing) · [Checks](#basic-checks)

</div>

---

Install a shared AI workflow harness so every agent starts from the same rules,
memory, task workflow, model routing, review gates, and terminal monitor for
multi-agent orchestration.

## Why Use It

- **Consistent agent context**: every agent starts from the same `.ai/` rules,
  project notes, workflow, and memory.
- **Model-agnostic workflow**: works with Codex, Claude Code, AGY, Aider,
  local models, or any tool that can read markdown instructions.
- **Safer delegation**: includes task decomposition, session-scope checks,
  review gates, supply-chain checks, and fallback behavior when a model CLI is
  unavailable.
- **Terminal visibility**: `forgeai-init --watch` shows assignment progress,
  agents, checks, and activity logs in an Ink UI.
- **Plain files**: no server or database required; everything is markdown,
  JSON/YAML, and small local scripts.

## Requirements

- Node.js `>=20`
- npm / npx

ForgeAI does not install or authenticate model providers. If you want routed
delegation, install and authenticate the CLIs you configure, such as `codex`,
`agy`, `claude`, or another custom adapter.

## Install

For a new project, install the harness once:

```bash
npx forgeai-agentic-init@latest
```

Or install with stack detection:

```bash
npx forgeai-agentic-init@latest --profile auto
```

Preview files before writing if you want to inspect the install:

```bash
npx forgeai-agentic-init@latest --dry-run
```

After the harness is installed, agents that read `AGENTS.md` or `CLAUDE.md`
will run the ForgeAI preflight at the start of a session:

```bash
npx forgeai-agentic-init@latest --check-updates --check
```

If the installed harness is behind the latest package, the agent should ask
whether to skip for now or upgrade. If you approve the upgrade, the agent runs:

```bash
npx forgeai-agentic-init@latest --upgrade
```

## What Gets Installed

```text
AGENTS.md
CLAUDE.md
.ai/
  PROJECT.md
  RULES.md
  MEMORY.md
  WORKFLOW.md
  AGENT_REGISTRY.md
  MODEL_ROUTING.md
  model-routing.yaml
  cli-adapters.json
  router/run-model.ts
  agents/
  skills/
  workflows/
  state/
  codegraph/
  evaluation/
.claude/
openspec/
```

These files tell agents how to understand the project, split work, route
subtasks, validate changes, review delegated output, and hand work back to a
human.

## Basic Checks

Run a lightweight harness check:

```bash
npx forgeai-agentic-init@latest --check
```

Run the full local gate:

```bash
npx forgeai-agentic-init@latest --check-all
```

Useful focused checks:

```bash
npx forgeai-agentic-init@latest --check-sessions
npx forgeai-agentic-init@latest --check-codegraph --strict
npx forgeai-agentic-init@latest --check-review
npx forgeai-agentic-init@latest --check-security
```

## Terminal UI

Start the Ink monitor in one terminal:

```bash
forgeai-init --watch
```

When the orchestrator routes assignments through `.ai/router/run-model.ts`, the
UI updates automatically.

```text
╭────────────────────────────────────────────────────────╮
│ ForgeAI Orchestration Monitor              ● LIVE 10:42 │
├────────────────────────────────────────────────────────┤
│ TASK                                                   │
│ Build terminal workflow monitor                        │
├──────────────────────────────┬─────────────────────────┤
│ AGENTS                       │ ACTIVITY LOG            │
│ ⟳ orchestrator [lead]        │ assigned codex-1        │
│ ✓ codex-1 [backend]          │ codex-1 success         │
│ ⟳ reviewer-1 [reviewer]      │ security check pass     │
├──────────────────────────────┴─────────────────────────┤
│ CHECKS  ✓ security   ⟳ codegraph   ○ approval          │
╰────────────────────────────────────────────────────────╯
```

You can also emit a manual event:

```bash
forgeai-init --emit '{"type":"orchestrator.start","task":"Build auth flow","ts":1720000000}'
```

## Model Routing

ForgeAI ships with routing policy in:

```text
.ai/model-routing.yaml
.ai/cli-adapters.json
.ai/router/run-model.ts
```

The router can run a delegated assignment:

```bash
npx tsx .ai/router/run-model.ts \
  --tier standard \
  --assignment .ai/state/assignments/TASK-01.md
```

Register a custom provider CLI:

```bash
forgeai-init --add-model glm --model glm-4.6 --tier standard
```

### Important Routing Note

Model routing is a harness and router, not a magic controller. The active
orchestrator still needs to be prompted to use the ForgeAI workflow.

When using multiple routers or multiple model CLIs, give the orchestrator an
explicit instruction like:

```text
Use the ForgeAI workflow in this repo. Read AGENTS.md, then decompose the task,
score subtasks with .ai/model-routing.yaml, create bounded assignments, and
route delegated work through .ai/router/run-model.ts when useful. If a routed
model is unavailable, complete the bounded assignment locally and report the
fallback.
```

Without that instruction, many agent tools will read the code and solve the
task directly instead of invoking the router.

## Recommended Workflow

1. Install the harness with `npx forgeai-agentic-init@latest`.
2. Ask the agent to read `AGENTS.md` or `CLAUDE.md`.
3. For larger work, ask it to decompose and route subtasks.
4. Run `forgeai-init --watch` if you want terminal visibility.
5. Run `forgeai-init --check-all` before review or release.

## License

MIT
