## After Initialization

Once the files are installed, populate the project-specific context before
relying on an agent for real tasks:

1. Open the project in your AI coding tool (Claude Code, Codex CLI, AGY
   CLI, Cline, RooCode, Aider, ...).
2. Ask it to bootstrap the harness from the real repository, for example:

   > Read the ForgeAI harness and populate PROJECT.md, MEMORY.md, and
   > AGENT_REGISTRY.md from the current repository. Do not modify source
   > code.

3. The agent should follow `.ai/BOOTSTRAP.md`, which explains what to read,
   what to populate, what must not change, how to discover repo context
   (package.json, lockfiles, config files), and how to handle unknown
   information (leave `TODO`, never guess).

### How each tool finds the harness

- **Claude Code** auto-reads `CLAUDE.md` at the project root. It points the
  agent at `.ai/README.md` and the recommended read order.
- **Codex** auto-reads `AGENTS.md` at the project root, following the same
  pointer pattern. ForgeAI's own agent-role registry lives separately at
  `.ai/AGENT_REGISTRY.md` to avoid colliding with this convention.
- **AGY CLI, Cline, RooCode, Aider** (and other tools) do not auto-load
  either file today — tell the agent to read `.ai/README.md` first, as
  shown in step 2 above.

### Working across multiple agents

Because all context lives in plain markdown under `.ai/` (plus `.claude/`
for Claude-native skill wrappers), the same project can be worked on by
different tools without duplicating instructions:

- `.ai/PROJECT.md`, `.ai/RULES.md`, `.ai/TASTE.md`, `.ai/MEMORY.md`,
  `.ai/WORKFLOW.md` — shared context and rules for any agent.
- `.ai/AGENT_REGISTRY.md` + `.ai/agents/*.md` — shared agent-role
  definitions and model routing.
- `.ai/skills/*` — shared, model-agnostic task guidance.
- `.claude/skills/*` — Claude Code-specific skill entry points that point
  back to `.ai/skills/*` for the full content.
```

- [x] **Step 3: Verify**

```bash
grep -n "After Initialization" README.md
grep -n "AGENT_REGISTRY.md" README.md
grep -n ".claude/skills" README.md
```

Expected: each grep returns at least one match.

- [x] **Step 4: Commit**

```bash
git add README.md
git commit -m "document root pointer files, bootstrap flow, and multi-agent layout in README"
```

---

### Task 13: End-to-end verification of the installer

**Files:**
- None (verification only — confirms `bin/forgeai-init.js` needs no changes)

- [x] **Step 1: Dry-run against a scratch directory**

```bash
rm -rf /tmp/forgeai-scratch && mkdir -p /tmp/forgeai-scratch
cd /tmp/forgeai-scratch && node /Users/admin/Documents/Learn/forgeai-agentic-mvp/bin/forgeai-init.js --dry-run
```

Expected: output lists `would create CLAUDE.md`, `would create AGENTS.md`,
`would create .ai/AGENT_REGISTRY.md`, `would create .ai/BOOTSTRAP.md`,
`would create .ai/agents/orchestrator.md` (and the other 7 agent files),
`would create .ai/skills/testing/SKILL.md`, and
`would create .claude/skills/frontend/SKILL.md` (and the other 3 Claude
skill files), among the existing entries. No `.ai/AGENTS.md` entry should
appear.

- [x] **Step 2: Real run and inspect the resulting tree**

```bash
cd /tmp/forgeai-scratch && node /Users/admin/Documents/Learn/forgeai-agentic-mvp/bin/forgeai-init.js
find /tmp/forgeai-scratch -type f | sort
```

Expected: file list matches the updated "What gets installed" tree from
Task 12, plus `bin`/`templates` are not present (only `templates/` contents
are copied). No leftover `.ai/AGENTS.md`.

- [x] **Step 3: Re-run without `--force` to confirm backward-compatible skip behavior**

```bash
cd /tmp/forgeai-scratch && node /Users/admin/Documents/Learn/forgeai-agentic-mvp/bin/forgeai-init.js
```

Expected: every file prints `skip <path> already exists. Use --force to
overwrite.` — confirms existing idempotent CLI behavior is unchanged.

- [x] **Step 4: Clean up scratch directory**

```bash
rm -rf /tmp/forgeai-scratch
```

- [x] **Step 5: No commit needed for this task** (verification only).

---

## Deliverables (produced after all tasks complete)

When all tasks above are done, provide:

1. **Architecture summary** — one paragraph restating the final layout
   (root pointers, `.ai/AGENT_REGISTRY.md` + `.ai/agents/*`, dual-mode
   skills, `.ai/BOOTSTRAP.md`).
2. **File tree diff** — `git diff --stat` against the commit before Task 1.
3. **Rationale** — for each of the 8 objectives in the original spec, one
   sentence on how it was satisfied and which task(s) implemented it.
4. **Remaining risks / future improvements**, e.g.:
   - `.ai/skills/spec-planning/SKILL.md` has no `.claude/skills/` mirror
     (not required by the spec's 4-skill list — flag if a "planner" Claude
     skill is wanted later).
   - Profiles (`--profile nextjs`, etc.) from the README's "Future roadmap"
     are still unimplemented.
   - `.ai/PROJECT.md` guidance comments rely on the agent actually removing
     them after filling sections — not enforced by tooling.

---

## Phase 1 Closeout

**Status:** Complete.

**Closed on:** 2026-06-24.

**Released package version:** `1.5.0`.

**Implemented beyond the original task list:**

- Optional stack profiles: `nextjs`, `node-api`, `tauri`, `monorepo`,
  `python-api`, and `mobile`.
- `.ai/manifest.json` with package version and selected profile.
- `--check`, `--check-profile`, `--check-git`, and `--list-profiles`.
- Model routing files, CLI adapters, delegated assignment workflow, and
  smoke-test assignments.
- Multi-session coordination through `.ai/state/sessions.md`, assignment
  read/write scopes, and `forgeai-init --check-sessions` overlap detection.
- Version preflight with `--check-updates`, `--skip-update-check`, and
  `--upgrade`.

**Verification completed:**

```bash
npm test
node --import /Users/admin/Documents/Learn/forgeai-agentic/node_modules/tsx/dist/loader.mjs /Users/admin/Documents/Learn/forgeai-agentic/bin/forgeai-init.ts --version
node --import /Users/admin/Documents/Learn/forgeai-agentic/node_modules/tsx/dist/loader.mjs /Users/admin/Documents/Learn/forgeai-agentic/bin/forgeai-init.ts --help
node --import /Users/admin/Documents/Learn/forgeai-agentic/node_modules/tsx/dist/loader.mjs /Users/admin/Documents/Learn/forgeai-agentic/bin/forgeai-init.ts --dry-run --skip-update-check
```

Observed results:

- `npm test` passed: `23/23`.
- `--version` returned `1.5.0`.
- `--help` includes `--upgrade`, `--check-updates`, and
  `--skip-update-check`.
- Dry-run from a clean scratch directory listed the full expected harness
  tree, including root pointers, `.ai/`, `.claude/skills/`, and `openspec/`.

**Known follow-up outside Phase 1:**

- Add a Claude-native planner/spec skill wrapper if Claude Code should
  discover `.ai/skills/spec-planning/SKILL.md` directly.
- Decide whether future harness upgrades need a merge-aware updater instead
  of overwriting managed harness files with `--upgrade`.
