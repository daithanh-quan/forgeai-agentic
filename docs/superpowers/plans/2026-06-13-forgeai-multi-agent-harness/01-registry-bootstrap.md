# Agents

This file describes agent roles and task routing. It is model-agnostic and can be used with Claude, Codex, Cursor, local models, or custom orchestration.
```

New:
```markdown
# Agent Registry

> **Naming note:** the root-level `AGENTS.md` follows the Codex convention
> (a short pointer with repo-wide instructions for any AI coding agent).
> This file, `.ai/AGENT_REGISTRY.md`, defines ForgeAI's own internal agent
> roles, routing, and model strategy. Read the root file first to learn
> where to start, then read this file to learn which role to play.

This file describes agent roles and task routing. It is model-agnostic and can be used with Claude Code, Codex, AGY CLI, Cline, RooCode, Aider, or custom orchestration.

For detailed per-role templates (responsibilities, required inputs/outputs,
completion checklists), see `.ai/agents/*.md`.
```

Leave the rest of the file (Orchestrator/Frontend/Backend/Spec/Review agent sections, model routing table, human review gate) unchanged.

- [x] **Step 3: Verify**

```bash
ls templates/.ai/ | grep -E '^AGENT'
```

Expected: only `AGENT_REGISTRY.md` is listed (no `AGENTS.md`).

- [x] **Step 4: Commit**

```bash
git add templates/.ai/AGENT_REGISTRY.md
git commit -m "rename .ai/AGENTS.md to .ai/AGENT_REGISTRY.md to avoid Codex naming collision"
```

---

### Task 2: Add root `templates/CLAUDE.md` pointer file

**Files:**
- Create: `templates/CLAUDE.md`

- [x] **Step 1: Create the file**

```markdown
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
```

- [x] **Step 2: Verify**

```bash
test -f templates/CLAUDE.md && head -1 templates/CLAUDE.md
```

Expected: `# CLAUDE.md`

- [x] **Step 3: Commit**

```bash
git add templates/CLAUDE.md
git commit -m "add root CLAUDE.md pointer for Claude Code auto-discovery"
```

---

### Task 3: Add root `templates/AGENTS.md` pointer file

**Files:**
- Create: `templates/AGENTS.md`

- [x] **Step 1: Create the file**

```markdown
# AGENTS.md

This project was initialized with the ForgeAI agentic harness (`.ai/`).

Before making any code changes, read these files in order:

1. `.ai/README.md` — harness overview and full recommended read order
2. `.ai/PROJECT.md` — project identity, stack, architecture, constraints
3. `.ai/RULES.md` — mandatory engineering and safety rules
4. `.ai/MEMORY.md` — durable decisions, conventions, known pitfalls
5. `.ai/TASTE.md` — style and communication preferences
6. `.ai/WORKFLOW.md` — task intake to human review flow

## Naming note

This root `AGENTS.md` follows the Codex convention: a short, repo-level
entry point that any AI coding agent reads automatically. ForgeAI's own
agent role definitions and model-routing strategy live separately in
`.ai/AGENT_REGISTRY.md` (with per-role detail in `.ai/agents/*.md`) — read
that for sub-agent responsibilities, not this file.

If `.ai/PROJECT.md` still contains `TODO` placeholders, follow
`.ai/BOOTSTRAP.md` before starting implementation work.
```

- [x] **Step 2: Verify**

```bash
test -f templates/AGENTS.md && head -1 templates/AGENTS.md
```

Expected: `# AGENTS.md`

- [x] **Step 3: Commit**

```bash
git add templates/AGENTS.md
git commit -m "add root AGENTS.md pointer for Codex auto-discovery"
```

---

### Task 4: Add `.ai/BOOTSTRAP.md`

**Files:**
- Create: `templates/.ai/BOOTSTRAP.md`

- [x] **Step 1: Create the file**

```markdown
# Bootstrap Instructions

This file guides any AI coding agent (Claude Code, Codex, AGY CLI, Cline,
RooCode, Aider, or other) through first-run setup of a project that was just
initialized with `npx forgeai-agentic-init`.

## 1. Files to Read First

Read in this order before doing anything else:

1. `.ai/README.md`
2. `.ai/PROJECT.md`
3. `.ai/RULES.md`
4. `.ai/MEMORY.md`
5. `.ai/TASTE.md`
6. `.ai/WORKFLOW.md`
7. `.ai/AGENT_REGISTRY.md`

## 2. Files to Populate

These files ship with placeholders. Fill them in from the real repository —
never from assumptions:

- **`.ai/PROJECT.md`** — project identity, stack, architecture, important
  directories. Each section now contains an HTML comment describing where
  to find the answer (e.g. `package.json`, lockfiles, config files, folder
  layout). Remove each comment once that section is filled in.
- **`.ai/MEMORY.md`** — keep the structure intact; add entries only for
  decisions or conventions that are already true today (something you
  discovered in the existing code). Do not invent future decisions.
- **`.ai/AGENT_REGISTRY.md`** — adjust agent descriptions only if this
  project has roles that differ from the defaults. Otherwise leave as-is.
- **`.ai/state/CURRENT.md`** — set "Active task" and "Last updated" once the
  first real task begins. Leave as `none` until then.

## 3. Files That Must Not Be Modified During Bootstrap

- `.ai/RULES.md`
- `.ai/TASTE.md`
- `.ai/WORKFLOW.md`
- `.ai/agents/*`
- `.ai/skills/*`
- `.claude/skills/*`
- `openspec/*`
- Any application source code

Bootstrap is a context-population step, not an implementation step. Do not
edit application code, rules, or workflow definitions while bootstrapping.

## 4. How to Discover Repository Context

Before writing into `.ai/PROJECT.md`, inspect:

- `package.json` (or `pyproject.toml`, `go.mod`, `Cargo.toml`, etc.) for
  project name, scripts, dependencies, and package manager — check which
  lockfile is present (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
  `bun.lockb`).
- The top-level folder layout for architecture and important directories.
- Existing config files (`tsconfig.json`, `next.config.*`, `vite.config.*`,
  `docker-compose.yml`, etc.) for framework and deployment clues.
- Existing README files for product intent and setup instructions.
- `git remote -v` for the repository URL, if available.

## 5. Handling Unknown Information

- If a field cannot be determined from the repository, leave it as `TODO`
  and add a short note explaining what is missing — do not guess.
- Do not invent business rules, integrations, or architecture decisions.
- If a placeholder blocks safe progress (e.g. unknown package manager before
  running install scripts), ask the human rather than guessing.
- Mark uncertain entries clearly, e.g. `TODO (unconfirmed): ...`, so future
  agents know to verify rather than trust them.
```

- [x] **Step 2: Verify**

```bash
test -f templates/.ai/BOOTSTRAP.md && head -1 templates/.ai/BOOTSTRAP.md
```

Expected: `# Bootstrap Instructions`

- [x] **Step 3: Commit**

```bash
git add templates/.ai/BOOTSTRAP.md
git commit -m "add .ai/BOOTSTRAP.md first-run guide for any coding agent"
```

---

### Task 5: Add `.ai/agents/orchestrator.md` and `.ai/agents/planner.md`

**Files:**
- Create: `templates/.ai/agents/orchestrator.md`
- Create: `templates/.ai/agents/planner.md`

- [x] **Step 1: Create `templates/.ai/agents/orchestrator.md`**

```markdown
