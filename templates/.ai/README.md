# AI Project Harness

This markdown directory is the minimum **project harness** for AI coding
agents. Its purpose is to give every new project a consistent way to declare
context, rules, workflow, memory, agents, skills, and specs before coding
starts.

## Quick usage

Root-level `CLAUDE.md` (Claude Code) and `AGENTS.md` (Codex) are pointer
files that are auto-discovered by those tools and tell the agent to read
this directory first. For other tools (AGY CLI, Cline, RooCode, Aider),
tell the agent:

> Read `.ai/README.md` first. Then read the files in the recommended order
> before planning or editing code. If `.ai/PROJECT.md` still has `TODO`
> placeholders, follow `.ai/BOOTSTRAP.md` first.

## Recommended read order for agents

1. `PROJECT.md` — what the project is, its stack, constraints, and boundaries.
2. `RULES.md` — mandatory engineering and safety rules.
3. `MEMORY.md` — durable decisions, conventions, and lessons learned.
4. `TASTE.md` — owner/team preferences and style.
5. `AGENT_REGISTRY.md` — agent roles, sub-agents, and routing strategy.
6. `MODEL_ROUTING.md`, `model-routing.yaml`, `cli-adapters.json`, and
   `router/run-model.js` — scoring, model tiers, CLI adapters, token
   budgets, delegation, and fallbacks.
7. `WORKFLOW.md` — flow from task intake to human review.
8. `state/CURRENT.md` — current project state and active focus.
9. `agents/*.md` — per-role templates (responsibilities, inputs, outputs,
   completion checklists).
10. Relevant `skills/*/SKILL.md` — task-specific operating instructions.
11. Relevant `openspec/changes/*` — spec-driven change artifacts.

## Smoke tests

- Delegation CLI check: `.ai/state/assignments/TASK-CODEX-TEST.md`
- Claude reviewer check: `.ai/state/assignments/TASK-REVIEWER-SMOKE.md`

For the reviewer check, ask Claude Code to use the reviewer sub-agent/skill to
review the smoke-test assignment. It should return `Request changes` because
the simulated delegated result omits required validation evidence.

## Optional token optimization

RTK can be used as a token-saving shell proxy for noisy commands. If available,
prefer `rtk git status`, `rtk git diff`, `rtk grep`, `rtk read`, and
`rtk test <command>`. If RTK is not installed or the compact output omits
needed evidence, use the original command.

## Naming: root `AGENTS.md` vs. `.ai/AGENT_REGISTRY.md`

- Root `AGENTS.md` follows the **Codex convention**: a short, repo-level
  pointer that Codex (and similarly, Claude Code's `CLAUDE.md`) reads
  automatically. It tells an agent *where to start*.
- `.ai/AGENT_REGISTRY.md` defines ForgeAI's **internal agent roles and model
  routing**. It tells an agent *which role to play* and how to route work
  between specialist agents (see `.ai/agents/*.md` for the full per-role
  templates).

## Skills: model-agnostic vs. Claude-native

- `.ai/skills/*/SKILL.md` — **model-agnostic** guidance. Any agent (Claude
  Code, Codex, AGY CLI, Cline, RooCode, Aider) should read these as plain
  documentation before doing related work.
- `.claude/skills/*/SKILL.md` — **Claude Code native skills**. These are
  thin wrappers with valid Skill frontmatter so Claude Code can discover and
  invoke them directly; each one points back to the canonical doc in
  `.ai/skills/` to avoid duplication.

## Core principles

- Do not automate too much too early.
- Every task must have intent, scope, acceptance criteria, and validation.
- Agents must not edit code outside the task scope without documenting the
  reason.
- Human review is the final gate before merge or deployment.
