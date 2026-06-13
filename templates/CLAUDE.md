# CLAUDE.md

This project was initialized with the ForgeAI agentic harness (`.ai/`).

Before making any code changes, read these files in order:

1. `.ai/README.md` — harness overview and full recommended read order
2. `.ai/PROJECT.md` — project identity, stack, architecture, constraints
3. `.ai/RULES.md` — mandatory engineering and safety rules
4. `.ai/MEMORY.md` — durable decisions, conventions, known pitfalls
5. `.ai/TASTE.md` — style and communication preferences
6. `.ai/WORKFLOW.md` — task intake to human review flow

For agent roles and routing, see `.ai/AGENT_REGISTRY.md` and the per-role
templates in `.ai/agents/`.

If `.ai/PROJECT.md` still contains `TODO` placeholders, follow
`.ai/BOOTSTRAP.md` before starting implementation work.

## Skills

- Model-agnostic guidance for any agent: `.ai/skills/*/SKILL.md`
- Claude Code native skills (auto-discoverable): `.claude/skills/*/SKILL.md`
