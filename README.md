# ForgeAI Agentic Init

A minimal CLI for installing a markdown-based project harness for AI coding agents.

The goal is simple: every new project should start with the same AI-readable context layer: project context, rules, taste, memory, agents, workflows, skills, and OpenSpec-style change templates.

## Required Runtime

ForgeAI installs markdown instructions and small helper scripts. It does not
install or authenticate AI providers for you. To run the full workflow, the
host environment should provide these tools:

| Capability | Required for full workflow | CLI/plugin expected |
| --- | --- | --- |
| Orchestration | The current model handles task intake, decomposition, scoring, final synthesis, and any work that cannot be delegated | Any AI coding tool that can read the harness: Claude Code, Codex CLI, AGY CLI, Cline, RooCode, Aider, local models, or custom agents |
| Reviewer | Reviews delegated results before final delivery | Configured reviewer model/agent, Claude Code reviewer skill from `.claude/skills/reviewer/SKILL.md`, or the current model applying `.ai/skills/code-review/SKILL.md` |
| Cheap/fast delegation | AGY handles score `0-2` tasks | `agy` CLI |
| Standard/strong delegation | Codex handles score `3-8` tasks by default, but tiers are configurable | `codex` CLI or any configured adapter |
| Token-output compression | RTK filters noisy shell output before it reaches the model context | `rtk` CLI and tool hook/plugin |
| Project initialization | Runs this installer and tests | Node.js `>=18.18.0` |

If a model CLI is missing, unavailable, out of quota, or fails, the router
returns `current_model_executes_locally`; the orchestrator/current model must
complete that bounded assignment locally instead of blocking the task.

RTK is recommended, not mandatory. When installed, agents should prefer `rtk`
wrappers for high-output shell commands such as `git diff`, `git status`,
`rg`/`grep`, `cat`/file reads, and test runners. If `rtk` is not installed,
agents fall back to the original command.

## Install in a new project

Use the latest published CLI directly with npm:

```bash
npx forgeai-agentic-init@latest
```

Preview without writing files:

```bash
npx forgeai-agentic-init@latest --dry-run
```

Install with automatic stack detection:

```bash
npx forgeai-agentic-init@latest --profile auto
```

Pin a version only when you need a reproducible setup:

```bash
npx forgeai-agentic-init@2.3.1
```

`2.3.1` hardens the harness against data loss and stale-context blind spots:
`--upgrade` preserves populated project/run state (and `--force` overrides it),
malformed `package.json`/`.ai/manifest.json` degrade gracefully instead of
crashing, and it adds `--check-all`, `--check-codegraph --strict`, stricter
CodeGraph template detection, a monorepo secondary-stack warning, and
escaped-pipe-safe session parsing. `2.3.0` adds CodeGraph artifacts and
`forgeai-init --check-codegraph` for graph-guided context selection in large or
legacy repositories. `2.2.0` added
orchestrator-run lifecycle diagnostics with
`forgeai-init --check-lifecycle`, so agents can validate task journals, stale
work, and closed-task memory decisions automatically. `2.1.0` added the Phase
2 lifecycle foundation: lifecycle state tracking, task journals, task-type
workflow templates, stale-task detection guidance, closure rules, and a
Claude-native planner skill wrapper. `1.5.0` added
multi-session coordination with `.ai/state/sessions.md` and
`--check-sessions`. `1.4.1` added update preflight checks and `--upgrade`.
Optional stack profiles (`nextjs`, `node-api`, `tauri`, `monorepo`,
`python-api`, and `mobile`), `--profile auto`, `.ai/manifest.json`,
`--check-profile`, and `--list-profiles` were added in `1.4.0`. npm package
versions are immutable, so publish this only if
`forgeai-agentic-init@2.3.1` has not already been published.

### Agent-run diagnostics

These commands are for the orchestrator/agent to run automatically at workflow
checkpoints. Humans do not need to run them during normal use; use them only
for diagnostics.

```bash
npx forgeai-agentic-init@latest --check
npx forgeai-agentic-init@latest --check-all
npx forgeai-agentic-init@latest --check-updates --check
npx forgeai-agentic-init@latest --check-lifecycle
npx forgeai-agentic-init@latest --check-codegraph
npx forgeai-agentic-init@latest --check-codegraph --strict
npx forgeai-agentic-init@latest --upgrade
npx forgeai-agentic-init@latest --list-profiles
```

`--check-all` runs the harness, CodeGraph, lifecycle, and profile checks in one
pass and returns a single aggregated exit code; it runs CodeGraph in strict
mode, so a still-template graph fails the run. Use it as a readiness gate before
risky edits. `--check` stays lightweight and only validates harness files and
adapters. Add `--strict` to `--check-codegraph` to exit non-zero (instead of
exit 0) while the repository graph still contains template TODOs — useful when
the graph gates CI or automated edits.

### Version preflight

ForgeAI records the installed harness package version in
`.ai/manifest.json`. On interactive runs, the CLI checks npm for the latest
`forgeai-agentic-init` version before initialization/check commands. If a
newer package exists, it prompts:

```text
1. Skip for now
2. Update the ForgeAI harness to latest
```

For non-interactive agent sessions or CI, the agent runs the check explicitly:

```bash
npx forgeai-agentic-init@latest --check-updates --check
```

Use `--skip-update-check` when offline or when a workflow must avoid network
access.

When the human chooses to update, the agent runs:

```bash
npx forgeai-agentic-init@latest --upgrade
```

`--upgrade` refreshes the installed ForgeAI harness files with the selected
package version and preserves the profile recorded in `.ai/manifest.json`.
Populated project content and run state are never clobbered on upgrade: if they
already exist, `.ai/PROJECT.md`, `.ai/MEMORY.md`, `.ai/AGENT_REGISTRY.md`,
`.ai/codegraph/graph.json`, `.ai/codegraph/hotspots.md`, `.ai/state/CURRENT.md`,
`.ai/state/sessions.md`, and per-task journals (`.ai/state/tasks/*.md` except
`_template.md`) are preserved (reported as `preserved <path>`). Harness-managed
state docs still update on upgrade — `.ai/state/lifecycle.md`, the task journal
template, and the smoke assignments under `.ai/state/assignments/`. Use
`--force` to overwrite the preserved files too.

### Optional stack profiles

The base harness works for any project. Profiles add stack-specific guidance
without replacing the shared `.ai/` workflow:

```bash
npx forgeai-agentic-init@latest --profile nextjs
```

Use `--profile auto` to detect a supported stack from project files such as
`package.json`, `next.config.*`, `pnpm-workspace.yaml`, `src-tauri/`,
`pyproject.toml`, or mobile framework files. Supported profiles are
`nextjs`, `node-api`, `tauri`, `monorepo`, `python-api`, and `mobile`; the
agent can run `npx forgeai-agentic-init@latest --list-profiles` for the
current list. After initialization,
`.ai/manifest.json` records the package version and selected profile.

The agent checks the installed profile when stack-specific guidance is needed:

```bash
forgeai-init --check-profile
```

## Optional RTK Setup

RTK can be initialized for the tools you use:

```bash
rtk init -g
rtk init -g --codex
rtk init -g --agy
```

After setup, restart the AI tool and run a simple command such as
`rtk git status` or `rtk gain`. The ForgeAI workflow treats RTK as a
token-saving layer only; it is not part of model routing.

## What gets installed

```text
CLAUDE.md
AGENTS.md
.ai/
  manifest.json
  README.md
  BOOTSTRAP.md
  PROJECT.md
  RULES.md
  TASTE.md
  MEMORY.md
  AGENT_REGISTRY.md
  MODEL_ROUTING.md
  model-routing.yaml
  cli-adapters.json
  router/run-model.ts
  WORKFLOW.md
  codegraph/
    README.md
    graph.json
    hotspots.md
    context-packs/_template.md
  state/CURRENT.md
  state/lifecycle.md
  state/sessions.md
  state/tasks/_template.md
  state/assignments/TASK-CODEX-TEST.md
  state/assignments/TASK-REVIEWER-SMOKE.md
  workflows/task-intake.md
  workflows/delegated-assignment.md
  workflows/lifecycle-management.md
  workflows/codegraph-context.md
  workflows/task-types/
    bug.md
    feature.md
    refactor.md
    research.md
    audit.md
    incident.md
    release.md
    dependency-upgrade.md
  profiles/<profile>.md
  workflows/<profile-specific-workflow>.md
  agents/
    orchestrator.md
    planner.md
    architect.md
    frontend.md
    backend.md
    tester.md
    reviewer.md
    pr-writer.md
  skills/
    frontend-implementation/SKILL.md
    backend-implementation/SKILL.md
    code-review/SKILL.md
    spec-planning/SKILL.md
    testing/SKILL.md
    <profile-specific-skill>/SKILL.md
.claude/
  skills/
    planner/SKILL.md
    frontend/SKILL.md
    backend/SKILL.md
    testing/SKILL.md
    reviewer/SKILL.md
openspec/
  README.md
  project.md
  changes/_template/
    proposal.md
    design.md
    tasks.md
    specs/capability.md
```

`profiles/<profile>.md`, profile-specific skills, and profile-specific
workflows are installed only when `--profile <name>` or a successful
`--profile auto` is used. Profile-specific skills are additive guidance on
top of the shared skills unless a profile explicitly says it replaces one.

## After Initialization

Once the files are installed, populate the project-specific context before
relying on an agent for real tasks:

1. Open the project in your AI coding tool (Claude Code, Codex CLI, AGY
   CLI, Cline, RooCode, Aider, ...).
2. Ask it to bootstrap the harness from the real repository, for example:

   > Read the ForgeAI harness and populate PROJECT.md, MEMORY.md, and
   > AGENT_REGISTRY.md from the current repository. Do not modify source
   > code.

3. The agent should follow `.ai/BOOTSTRAP.md`, which explains what to read,
   what to populate, what must not change, how to discover repo context
   (package.json, lockfiles, config files), and how to handle unknown
   information (leave `TODO`, never guess).

4. The agent checks the installed harness automatically:

   ```bash
   forgeai-init --check
   forgeai-init --check-git
   forgeai-init --check-lifecycle
   forgeai-init --check-codegraph
   ```

   If no extra model CLIs are available, the checker reports single-agent
   mode: the current model must orchestrate, implement, review, and validate
   locally. If multiple model CLIs are available, it reports multi-agent mode:
   the human can choose which available model acts as orchestrator.

   The git checker reports repository provider, remote, base branch, current
   branch, semantic branch naming, dirty worktree state, local merge-conflict
   risk, hook detection, and provider PR/MR tooling. If no GitHub, GitLab,
   Bitbucket, or other remote is connected, it recommends local-only work:
   create a semantic branch such as `feat/<short-slug>` or `fix/<short-slug>`,
   validate locally, and do not push or create a PR/MR until a remote is
   configured.

   The lifecycle checker validates `.ai/state/lifecycle.md`, task journal
   metadata under `.ai/state/tasks/`, stale active tasks, and closed-task
   memory update decisions.

   The CodeGraph checker validates `.ai/codegraph/` artifacts so agents can
   refresh stale module maps and build task context packs before risky edits.

   Before launching multiple agent sessions in parallel, the orchestrator records
   each session in `.ai/state/sessions.md` with a narrow write scope and runs:

   ```bash
   forgeai-init --check-sessions
   ```

   The session checker fails when unfinished sessions have overlapping write
   scopes, so the orchestrator can sequence the work or narrow assignments
   before agents edit the same files with stale context.

5. The agent verifies optional integrations when it needs them:

   ```bash
   claude --version
   codex --version
   agy --version
   rtk --version
   ```

   Missing commands do not make the harness unusable, but they change
   delegation behavior. Missing model CLIs fall back to the current model;
   missing RTK falls back to normal shell commands.

### How each tool finds the harness

- **Claude Code** auto-reads `CLAUDE.md` at the project root. It points the
  agent at `.ai/README.md` and the recommended read order.
- **Codex** auto-reads `AGENTS.md` at the project root, following the same
  pointer pattern. ForgeAI's own agent-role registry lives separately at
  `.ai/AGENT_REGISTRY.md` to avoid colliding with this convention.
- **AGY CLI, Cline, RooCode, Aider** (and other tools) do not auto-load
  either file today — tell the agent to read `.ai/README.md` first, as
  shown in step 2 above.

### Working across multiple agents

Because all context lives in plain markdown under `.ai/` (plus `.claude/`
for Claude-native skill wrappers), the same project can be worked on by
different tools without duplicating instructions:

- `.ai/PROJECT.md`, `.ai/RULES.md`, `.ai/TASTE.md`, `.ai/MEMORY.md`,
  `.ai/WORKFLOW.md` — shared context and rules for any agent.
- `.ai/AGENT_REGISTRY.md` + `.ai/agents/*.md` — shared agent-role
  definitions and model routing.
- `.ai/codegraph/*` — shared module map, hotspots, and task context packs for
  graph-guided context selection.
- `.ai/skills/*` — shared, model-agnostic task guidance.
- `.claude/skills/*` — Claude Code-specific skill entry points that point
  back to `.ai/skills/*` for the full content.

## Design principles

- Keep the first version small and usable.
- Use markdown as the source of truth before adding databases or complex orchestration.
- Make the harness model-agnostic: Claude, Codex, Cursor, local models, or custom agents can all read the same files.
- Prefer explicit task intake, spec, implementation, validation, and human review.

## Model routing

ForgeAI uses the current model as the orchestrator by default unless the human
explicitly chooses another model. Claude Code, Codex, AGY, Cline, RooCode,
Aider, local models, or custom agents can all act as orchestrator when they can
read the harness. For each subtask, the orchestrator scores complexity, risk,
ambiguity, and required context, then routes by `.ai/model-routing.yaml`.
Defaults route scores `0-2` to AGY, scores `3-5` to Codex, scores `6-8` to the
configured strong tier, and scores `9-10` stay with the current orchestrator.
If the selected CLI is not installed, the current model executes the bounded
assignment locally instead of blocking on the router.

For multi-session work, the orchestrator records active sessions in
`.ai/state/sessions.md` and runs `forgeai-init --check-sessions` before
parallel delegation. This catches overlapping write scopes early; it is a
coordination gate, not a replacement for git review or the reviewer agent.

After delegated work finishes, the configured reviewer checks the result. In
Claude Code this can be the Claude reviewer sub-agent; in other tools it can be
the current model applying `.ai/agents/reviewer.md` and
`.ai/skills/code-review/SKILL.md`. If the review fails, the findings go back to
the implementing model once; if that still fails or the model is unavailable,
the current model fixes locally or escalates the remaining decision.

Configure provider/model names and token budgets after initialization:

```text
.ai/model-routing.yaml
```

Configure local CLI commands separately:

```text
.ai/cli-adapters.json
```

When delegation is available through local CLIs, invoke a tier with:

```bash
npx tsx .ai/router/run-model.ts --tier standard --assignment .ai/state/assignments/TASK-01.md
```

### Register your own model CLI

Add any model CLI you already have (for example a GLM CLI) as a routable
adapter with one command — no hand-editing required:

```bash
# Minimal: registers an adapter named "glm" running the "glm" command.
forgeai-init --add-model glm --model glm-4.6

# Also point a routing tier at it (edits .ai/model-routing.yaml):
forgeai-init --add-model glm --model glm-4.6 --tier standard

# A CLI whose command name or call shape differs from the defaults:
forgeai-init --add-model zai --command zai-cli --input argv \
  --args '["chat","--model","{model}","--message","{assignment}"]'
```

Defaults keep the common case a one-liner: `--command` defaults to the provider
name, `--args` to `["--model","{model}"]`, `--input` to `stdin`, healthcheck to
`--version`. Keep the `{model}` placeholder in `--args` (the router substitutes
the real id at run time). Without `--tier`, only `.ai/cli-adapters.json` is
touched and the provider is usable via `run-model.ts --provider <name> --model
<id>`. Inspect or remove adapters with `forgeai-init --list-models` and
`forgeai-init --remove-model <name>`. Custom adapters and tier edits are
preserved across `forgeai-init --upgrade`. API keys belong in environment
variables, never in these files.

The full scoring, handoff, fallback, and review protocol is documented in
`.ai/MODEL_ROUTING.md`. ForgeAI does not store provider credentials or install
model integrations; the host tool must expose models through a CLI, API, MCP,
or sub-agent capability.

## Smoke Tests

After initialization, run these checks in a real AI tool environment:

```bash
npx tsx .ai/router/run-model.ts --tier standard --assignment .ai/state/assignments/TASK-CODEX-TEST.md
```

Ask your configured reviewer to review the smoke assignment. In Claude Code,
ask:

```text
Use the reviewer sub-agent/skill to review .ai/state/assignments/TASK-REVIEWER-SMOKE.md
```

The reviewer smoke test should return `Request changes` because the simulated
delegated result is intentionally missing validation evidence.
