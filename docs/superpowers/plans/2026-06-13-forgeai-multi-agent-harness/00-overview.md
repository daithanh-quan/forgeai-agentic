# ForgeAI Multi-Agent Harness Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ForgeAI markdown harness work out-of-the-box with Claude Code, Codex, AGY CLI, Cline, RooCode, and Aider, while staying model-agnostic and backward compatible with the existing `npx forgeai-agentic-init` CLI.

**Architecture:** All new/changed content lives under `templates/`, which the existing `bin/forgeai-init.js` copies verbatim (recursively, preserving directory structure) into the target project root. No CLI code changes are needed — adding `templates/CLAUDE.md`, `templates/AGENTS.md`, `templates/.ai/agents/*`, and `templates/.claude/skills/*` automatically makes the installer emit those paths. The plan: (1) add root pointer files (`CLAUDE.md`, `AGENTS.md`) that any tool can auto-discover, (2) rename `.ai/AGENTS.md` → `.ai/AGENT_REGISTRY.md` to remove the naming collision with Codex's root `AGENTS.md`, (3) add 8 reusable agent role templates under `.ai/agents/`, (4) split skills into model-agnostic (`.ai/skills/`) vs. Claude-native (`.claude/skills/`) with thin Claude wrappers pointing back to the canonical docs, (5) add `.ai/BOOTSTRAP.md` for first-run context population, (6) annotate `.ai/PROJECT.md` placeholders with discovery instructions, (7) update both READMEs to document the new layout and bootstrap flow.

**Tech Stack:** Plain Markdown templates copied by a Node.js CLI (`bin/forgeai-init.js`, already implemented, no changes required). Verification is done via `node ./bin/forgeai-init.js --dry-run` / `--force` against a scratch directory plus `grep` checks — there is no test framework in this repo.

---

## File Structure

```
forgeai-agentic-mvp/
├── README.md                                  (MODIFY - "What gets installed" + new "After Initialization" section)
└── templates/
    ├── CLAUDE.md                              (NEW - root pointer for Claude Code)
    ├── AGENTS.md                              (NEW - root pointer for Codex)
    ├── .ai/
    │   ├── README.md                          (MODIFY - read order, naming note, skills dual-mode)
    │   ├── AGENT_REGISTRY.md                  (RENAMED from AGENTS.md, header updated)
    │   ├── BOOTSTRAP.md                       (NEW - first-run guide for any agent)
    │   ├── PROJECT.md                         (MODIFY - add discovery-guidance comments)
    │   ├── agents/
    │   │   ├── orchestrator.md                (NEW)
    │   │   ├── planner.md                     (NEW)
    │   │   ├── architect.md                   (NEW)
    │   │   ├── frontend.md                    (NEW)
    │   │   ├── backend.md                     (NEW)
    │   │   ├── tester.md                      (NEW)
    │   │   ├── reviewer.md                    (NEW)
    │   │   └── pr-writer.md                   (NEW)
    │   └── skills/
    │       └── testing/SKILL.md               (NEW - model-agnostic testing skill, referenced by tester.md)
    └── .claude/
        └── skills/
            ├── frontend/SKILL.md               (NEW - thin pointer to .ai/skills/frontend-implementation)
            ├── backend/SKILL.md                (NEW - thin pointer to .ai/skills/backend-implementation)
            ├── testing/SKILL.md                (NEW - thin pointer to .ai/skills/testing)
            └── reviewer/SKILL.md               (NEW - thin pointer to .ai/skills/code-review)
```

No existing files are deleted except via rename. `templates/openspec/*`, `templates/.ai/RULES.md`, `templates/.ai/TASTE.md`, `templates/.ai/WORKFLOW.md`, `templates/.ai/MEMORY.md`, `templates/.ai/state/CURRENT.md`, `templates/.ai/workflows/task-intake.md`, and the existing `.ai/skills/*-implementation` and `code-review`/`spec-planning` skills are untouched. `bin/forgeai-init.js` is untouched.

---

### Task 1: Rename `.ai/AGENTS.md` → `.ai/AGENT_REGISTRY.md`

**Files:**
- Rename: `templates/.ai/AGENTS.md` → `templates/.ai/AGENT_REGISTRY.md`

- [x] **Step 1: Rename the file with git**

```bash
git mv templates/.ai/AGENTS.md templates/.ai/AGENT_REGISTRY.md
```

- [x] **Step 2: Update the header to clarify the naming split**

Replace the first 4 lines of `templates/.ai/AGENT_REGISTRY.md`:

Old:
```markdown
