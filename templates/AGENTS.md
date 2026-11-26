# AGENTS.md

This project was initialized with the ForgeAI agentic harness (`.ai/`).

## Fast Path: Bounded Context & Quality Gates

Before reading broad repository files, compile bounded source excerpts and applicable rules for your current objective:

```bash
npx forgeai-agentic-init context "<objective>"
```

After implementing changes, verify code quality (complexity `< 10` and structural duplication `< 0.8`) and harness health offline:

```bash
npx forgeai-agentic-init --check-quality
npx forgeai-agentic-init --check-upgrade
```

If `--check-upgrade` reports an outdated harness, ask the human whether to skip for now or upgrade (`npx forgeai-agentic-init@latest --upgrade`).

### MCP Code Mode (`forgeai_code`)

When connected to the ForgeAI MCP server (`forgeai-init mcp`), prefer the `forgeai_code` tool for multi-step investigation. It runs a JavaScript snippet inside an isolated sandbox where you can chain `forgeai.try()`, `forgeai.context()`, `forgeai.symbols()`, `forgeai.callers()`, `forgeai.expandContext()`, and `forgeai.checkQuality()` in a single turn and `return` only the filtered excerpts or metrics you need.

## Full Harness Read Order

For architectural, multi-step, or delegated tasks, read these files in order:

1. `.ai/README.md` — harness overview and full recommended read order
2. `.ai/PROJECT.md` — project identity, stack, architecture, constraints
3. `.ai/RULES.md` — mandatory engineering and safety rules
4. `.ai/MEMORY.md` — durable decisions, conventions, known pitfalls
5. `.ai/TASTE.md` — style and communication preferences
6. `.ai/MODEL_ROUTING.md` and `.ai/model-routing.yaml` — model tiers,
   task scoring, token budgets, and delegation protocol
7. `.ai/WORKFLOW.md` — task intake to human review flow

## Naming note

This root `AGENTS.md` follows the Codex convention: a short, repo-level
entry point that any AI coding agent reads automatically. ForgeAI's own
agent role definitions and model-routing strategy live separately in
`.ai/AGENT_REGISTRY.md` (with per-role detail in `.ai/agents/*.md`) — read
that for sub-agent responsibilities, not this file.

If `.ai/PROJECT.md` still contains `TODO` placeholders, follow
`.ai/BOOTSTRAP.md` before starting implementation work.
