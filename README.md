# ForgeAI Agentic Init

A minimal CLI for installing a markdown-based project harness for AI coding agents.

The goal is simple: every new project should start with the same AI-readable context layer: project context, rules, taste, memory, agents, workflows, skills, and OpenSpec-style change templates.

## Install in a new project

This package is not yet published to npm, so install it by running the CLI
directly from this repository:

```bash
node ./bin/forgeai-init.js --dry-run
node ./bin/forgeai-init.js
```

## What gets installed

```text
CLAUDE.md
AGENTS.md
.ai/
  README.md
  BOOTSTRAP.md
  PROJECT.md
  RULES.md
  TASTE.md
  MEMORY.md
  AGENT_REGISTRY.md
  WORKFLOW.md
  state/CURRENT.md
  workflows/task-intake.md
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
.claude/
  skills/
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

## After Initialization

Once the files are installed, populate the project-specific context before
relying on an agent for real tasks:

1. Open the project in your AI coding tool (Claude Code, Codex CLI, Gemini
   CLI, Cline, RooCode, Aider, ...).
2. Ask it to bootstrap the harness from the real repository, for example:

   > Read the ForgeAI harness and populate PROJECT.md, MEMORY.md, and
   > AGENT_REGISTRY.md from the current repository. Do not modify source
   > code.

3. The agent should follow `.ai/BOOTSTRAP.md`, which explains what to read,
   what to populate, what must not change, how to discover repo context
   (package.json, lockfiles, config files), and how to handle unknown
   information (leave `TODO`, never guess).

### How each tool finds the harness

- **Claude Code** auto-reads `CLAUDE.md` at the project root. It points the
  agent at `.ai/README.md` and the recommended read order.
- **Codex** auto-reads `AGENTS.md` at the project root, following the same
  pointer pattern. ForgeAI's own agent-role registry lives separately at
  `.ai/AGENT_REGISTRY.md` to avoid colliding with this convention.
- **Gemini CLI, Cline, RooCode, Aider** (and other tools) do not auto-load
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
- `.ai/skills/*` — shared, model-agnostic task guidance.
- `.claude/skills/*` — Claude Code-specific skill entry points that point
  back to `.ai/skills/*` for the full content.

## Design principles

- Keep the first version small and usable.
- Use markdown as the source of truth before adding databases or complex orchestration.
- Make the harness model-agnostic: Claude, Codex, Cursor, local models, or custom agents can all read the same files.
- Prefer explicit task intake, spec, implementation, validation, and human review.

## Future roadmap

- Add `--profile nextjs`, `--profile node-api`, `--profile tauri`, and `--profile monorepo`.
- Add Jira/GitHub/Bitbucket connector templates.
- Add model routing configuration.
- Add local model execution notes.
- Add OpenSpec validation commands.
