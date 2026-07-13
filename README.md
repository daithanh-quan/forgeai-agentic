<div align="center">

<p align="center">
  <img src="docs/assets/banner-readme.png" alt="ForgeAI Agentic Init" width="720" />
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

### Compact Delegation Context

For large tasks, generate a bounded assignment plan and graph-guided context
pack before routing work to another model:

```bash
forgeai-init --decompose --compact --objective "refactor router fallback"
forgeai-init --refresh-codegraph
forgeai-init --context-pack --objective "refactor router fallback"
```

The refresh command parses local TypeScript and JavaScript imports, exports,
literal dynamic imports, and CommonJS `require` calls. The context pack starts
from objective-matched paths, exported symbols, or curated CodeGraph metadata,
then follows recorded dependencies and dependents. Every selected file includes
a graph-path explanation.

`--context-pack` refuses a missing, invalid, or stale dependency graph. It does
not silently rewrite project state; refresh explicitly after source files
change. Traversal defaults to depth 2 and 12 files and can be bounded further:

```bash
forgeai-init --context-pack \
  --objective "refactor router fallback" \
  --max-depth 1 \
  --max-nodes 8
```

Compile the selected files into syntax-aware excerpts before sending context to
a model:

```bash
forgeai-init --compile-context \
  --objective "refactor router fallback" \
  --budget 6000 \
  --output .ai/state/context/router-fallback.json
```

The JSON file is the deterministic source of truth. ForgeAI also writes a
Markdown rendering beside it for human inspection. Functions, classes,
interfaces, types, imports, and directly related tests retain source-line
provenance. Complete syntax nodes are included when they fit; oversized
functions and classes fall back to signatures instead of being truncated in
the middle. Mandatory and task-applicable sections from `.ai/RULES.md`, compact
git status/diff evidence, and available validation scripts are packed into the
same artifact, so a consumer does not need to reopen the full rules file.

The budget estimate is deterministic (`characters / 4`) and applies
to the serialized JSON artifact, not to the optional Markdown rendering or a
provider's exact tokenizer.

Use the resulting read scope, write scope, and validation plan as the
delegated assignment boundary. This controls scope and keeps delegation
consistent; it does not by itself guarantee lower token usage. Record token
cost, model calls, files read, and latency in `.ai/evaluation/<run-id>.md` so
future routing decisions can be based on measured evidence rather than
assumptions. Exact provider token savings remain an evaluation claim, not a
guarantee of the compiler's deterministic estimate.

## RTK Integration

[RTK (Read Tool Kit)](https://github.com/nahco314/rtk) is an optional tool
that wraps noisy shell commands so large output is filtered before it reaches
model context. ForgeAI's agent templates treat it as the preferred path for
high-output operations.

### When to use each RTK command

| Command | Use when |
| --- | --- |
| `rtk git status` | Checking working tree state before committing or delegating |
| `rtk git diff` | Reviewing unstaged or staged changes — output can be very large |
| `rtk grep "pattern" .` | Searching the codebase for symbols, strings, or patterns |
| `rtk read path/to/file` | Reading a file whose content may exceed useful context size |
| `rtk test <cmd>` | Running tests or validation where output is expected to be large |

### Fallback: built-in compact diagnostics

If RTK is not installed, ForgeAI's CLI provides structured Markdown
equivalents that agents can use directly:

```bash
forgeai-init --status-summary   # branch, staged/unstaged/untracked counts, file list
forgeai-init --diff-summary     # changed files table, exact insertions/deletions
forgeai-init --test-summary     # auto-detects typecheck/lint/test/build, reports pass/fail
```

These flags are also useful for scripting and CI pipelines where RTK is not
available. Both RTK and the built-in flags help control diagnostic scope and
present consistent evidence to agents. They do not guarantee lower total token
usage for a completed task.

The template guidance in `.ai/RULES.md` and `.ai/WORKFLOW.md` explains when
each command is required during implementation and validation.

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
