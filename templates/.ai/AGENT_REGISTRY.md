# Agent Registry

> **Naming note:** the root-level `AGENTS.md` follows the Codex convention
> (a short pointer with repo-wide instructions for any AI coding agent).
> This file, `.ai/AGENT_REGISTRY.md`, defines ForgeAI's own internal agent
> roles, routing, and model strategy. Read the root file first to learn
> where to start, then read this file to learn which role to play.

This file describes agent roles and task routing. It is model-agnostic and can be used with Claude Code, Codex, AGY CLI, Cline, RooCode, Aider, or custom orchestration.

For detailed per-role templates (responsibilities, required inputs/outputs,
completion checklists), see `.ai/agents/*.md`.

## Orchestrator agent

**Purpose:** Receive a task, analyze scope, split it into subtasks, assign work to the correct sub-agent, and prepare the final result for human review.

**Responsibilities:**

- Read `.ai/PROJECT.md`, `.ai/RULES.md`, and `.ai/MEMORY.md` before working.
- Create a short task plan.
- Choose the correct agent or skill.
- Check the final result against the definition of done.

## Frontend agent

Use for:

- React/Next.js UI implementation.
- Figma-to-UI conversion.
- Component refactoring.
- State management, RTK Query, forms, loading/error/empty states.

Recommended skills:

- `.ai/skills/frontend-implementation/SKILL.md`
- `.ai/skills/code-review/SKILL.md`

## Backend agent

Use for:

- API design and implementation.
- Database models and migrations.
- Authentication/authorization.
- Integration with Jira, Bitbucket, GitHub, Notion, or other tools.

Recommended skills:

- `.ai/skills/backend-implementation/SKILL.md`
- `.ai/skills/code-review/SKILL.md`

## Spec agent

Use for:

- Turning vague requirements into proposal/spec/tasks.
- Updating OpenSpec artifacts.
- Clarifying acceptance criteria.

Recommended skills:

- `.ai/skills/spec-planning/SKILL.md`

## Review agent

Use for:

- Reviewing diffs.
- Checking risks.
- Checking validation evidence.
- Confirming the implementation did not exceed scope.

Recommended skills:

- `.ai/skills/code-review/SKILL.md`

## Model routing strategy

The active routing configuration lives in `.ai/model-routing.yaml`. Local CLI
commands live in `.ai/cli-adapters.json`. The current model is the
orchestrator by default unless the human explicitly chooses another model. It
follows `.ai/MODEL_ROUTING.md` to score each subtask from 0-10, route by the
configured tiers, invoke a configured adapter when useful and available,
minimize delegated context, and send returned work to the configured reviewer
before final delivery.

| Task type | Recommended model class | Reason |
| --- | --- | --- |
| Task classification | AGY fast tier | Low risk, repeatable |
| Simple UI change | AGY or Codex by score | Mostly pattern matching |
| API wiring | Codex | Needs type and contract awareness |
| Architecture/design | Current orchestrator or configured strong tier | High reasoning requirement |
| Complex debugging | Current orchestrator or configured strong tier | Requires multi-step reasoning |
| Large refactor | Current orchestrator + human review | High blast radius |
| Documentation cleanup | AGY fast tier | Low risk |

The table is guidance only. The score and minimum-tier rules in
`.ai/model-routing.yaml` decide the actual route.

If the selected AGY, Codex, Claude, local, or custom model CLI is not
installed, the current model should execute the bounded assignment locally.
After implementation, the configured reviewer reviews the output; any failed
review goes back to the implementing model once before the current model takes
over or escalates.

## Human review gate

Agents must not merge or deploy by themselves. The human should review:

- Is the scope correct?
- Does the code follow project conventions?
- Is test evidence sufficient?
- Are risks documented clearly?
