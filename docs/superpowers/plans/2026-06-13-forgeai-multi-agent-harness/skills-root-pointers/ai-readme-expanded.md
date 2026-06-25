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

For the local MVP:

```bash
npx forgeai-agentic-init@latest
```

## Recommended read order for agents

1. `PROJECT.md` — what the project is, its stack, constraints, and boundaries.
2. `RULES.md` — mandatory engineering and safety rules.
3. `TASTE.md` — owner/team preferences and style.
4. `MEMORY.md` — durable decisions, conventions, and lessons learned.
5. `AGENT_REGISTRY.md` — agent roles, sub-agents, and routing strategy.
6. `WORKFLOW.md` — flow from task intake to human review.
7. `state/CURRENT.md` — current project state and active focus.
8. `agents/*.md` — per-role templates (responsibilities, inputs, outputs,
   completion checklists).
9. Relevant `skills/*/SKILL.md` — task-specific operating instructions.
10. Relevant `openspec/changes/*` — spec-driven change artifacts.

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

## MVP principles

- Do not automate too much too early.
- Every task must have intent, scope, acceptance criteria, and validation.
- Agents must not edit code outside the task scope without documenting the
  reason.
- Human review is the final gate before merge or deployment.
```

- [x] **Step 2: Verify**

```bash
grep -n "AGENT_REGISTRY.md" templates/.ai/README.md
grep -n "BOOTSTRAP.md" templates/.ai/README.md
grep -n ".claude/skills" templates/.ai/README.md
```

Expected: each grep returns at least one match.

- [x] **Step 3: Commit**

```bash
git add templates/.ai/README.md
git commit -m "update .ai/README.md for AGENT_REGISTRY rename, BOOTSTRAP, and dual-mode skills"
```

---

### Task 11: Annotate `.ai/PROJECT.md` placeholders with discovery guidance

**Files:**
- Modify: `templates/.ai/PROJECT.md`

- [x] **Step 1: Replace the full content**

Replace the full content of `templates/.ai/PROJECT.md`:

Old (current full file, 87 lines as read from repo) — keep all section
headers and table structure, but add an HTML comment under each
TODO-bearing section.

New (full replacement):
```markdown
