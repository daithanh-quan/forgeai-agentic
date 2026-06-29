# CLAUDE.md

This project was initialized with the ForgeAI agentic harness (`.ai/`).

At the start of the first agent session, check whether the installed
ForgeAI harness is behind the latest package:

```bash
npx forgeai-agentic-init@latest --check-updates --check
```

If the check reports an outdated harness, ask the human whether to skip for
now or update to the latest version before implementation work. If the human
chooses update, the agent runs:

```bash
npx forgeai-agentic-init@latest --upgrade
```

Before making any code changes, read these files in order:

1. `.ai/README.md` — harness overview and full recommended read order
2. `.ai/PROJECT.md` — project identity, stack, architecture, constraints
3. `.ai/RULES.md` — mandatory engineering and safety rules
4. `.ai/MEMORY.md` — durable decisions, conventions, known pitfalls
5. `.ai/TASTE.md` — style and communication preferences
6. `.ai/MODEL_ROUTING.md` and `.ai/model-routing.yaml` — lead-model routing,
   task scoring, token budgets, and delegation protocol
7. `.ai/WORKFLOW.md` — task intake to human review flow

For agent roles and routing, see `.ai/AGENT_REGISTRY.md` and the per-role
templates in `.ai/agents/`.

The current model is the orchestrator by default unless the human explicitly
chooses another model. For non-trivial tasks, split work into bounded
subtasks, score each subtask using `.ai/model-routing.yaml`, delegate only
when the selected CLI/API/sub-agent is available, and run the configured
reviewer before final delivery. If the selected model is unavailable, the
current model executes the bounded assignment locally. Never place provider
credentials in repository files.

If `.ai/PROJECT.md` still contains `TODO` placeholders, follow
`.ai/BOOTSTRAP.md` before starting implementation work.

## Skills

- Model-agnostic guidance for any agent: `.ai/skills/*/SKILL.md`
- Claude Code native skills (auto-discoverable): `.claude/skills/*/SKILL.md`
