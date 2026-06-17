# AGENTS.md

This project was initialized with the ForgeAI agentic harness (`.ai/`).

Before making any code changes, read these files in order:

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
