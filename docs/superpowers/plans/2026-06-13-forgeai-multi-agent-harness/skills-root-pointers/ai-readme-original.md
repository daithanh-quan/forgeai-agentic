# AI Project Harness

This markdown directory is the minimum **project harness** for AI coding agents. Its purpose is to give every new project a consistent way to declare context, rules, workflow, memory, agents, skills, and specs before coding starts.

## Quick usage

After installation, tell any coding agent:

> Read `.ai/README.md` first. Then read the files in the recommended order before planning or editing code.

For the local MVP:

```bash
npx forgeai-agentic-init@latest
```

## Recommended read order for agents

1. `PROJECT.md` — what the project is, its stack, constraints, and boundaries.
2. `RULES.md` — mandatory engineering and safety rules.
3. `TASTE.md` — owner/team preferences and style.
4. `MEMORY.md` — durable decisions, conventions, and lessons learned.
5. `AGENTS.md` — agent roles, sub-agents, and routing strategy.
6. `WORKFLOW.md` — flow from task intake to human review.
7. `state/CURRENT.md` — current project state and active focus.
8. Relevant `skills/*/SKILL.md` — task-specific operating instructions.
9. Relevant `openspec/changes/*` — spec-driven change artifacts.

## MVP principles

- Do not automate too much too early.
- Every task must have intent, scope, acceptance criteria, and validation.
- Agents must not edit code outside the task scope without documenting the reason.
- Human review is the final gate before merge or deployment.
```

New (full replacement):
```markdown
