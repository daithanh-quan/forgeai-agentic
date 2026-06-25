# Project Context

This file explains the project to any AI coding agent before it edits code.
Keep it short, accurate, and updated. See `.ai/BOOTSTRAP.md` for how to
populate this file on first run.

## Project identity

<!--
Fill from package.json (name, "repository" field), git remote -v (Owner,
Repository), and the primary language/runtime actually used in the repo
(check file extensions and lockfiles). Do not guess a framework — check
config files (next.config.*, nest-cli.json, vite.config.*, etc.) or
dependencies in package.json.
-->

- **Project name:** TODO
- **Repository:** TODO
- **Owner:** TODO
- **Primary language:** TypeScript
- **Runtime:** Node.js
- **Main framework:** TODO
- **Package manager:** TODO: npm / pnpm / yarn / bun

## Product goal

<!--
Write the product goal in one short paragraph, based on existing README
files, package.json "description", and top-level documentation. Do not
invent a goal if none of these exist — leave the TODO and note that the
product goal needs confirmation from a human.
-->

Write the product goal in one short paragraph:

> This project helps [target users] solve [problem] by [core solution].

## Current MVP scope

<!--
Derive from existing features/routes/modules if this is an established
codebase. For a brand-new project, leave these as TODO until the human
defines the MVP scope — do not invent scope items.
-->

The MVP should focus on:

1. TODO: Core user flow
2. TODO: Critical data model
3. TODO: Minimal UI/API integration
4. TODO: Validation and error handling

Out of scope for MVP:

- TODO: Advanced automation
- TODO: Multi-tenant complexity
- TODO: Premature infrastructure optimization

## Technology stack

<!--
Fill each row by inspecting package.json dependencies/devDependencies and
config files. Only list a technology if it is actually present as a
dependency or config file — do not assume an example value listed in the
"Notes" column applies to this project.
-->

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | TODO | Example: Next.js, React, Vite |
| Backend | TODO | Example: Node.js, NestJS, Express, Fastify |
| Database | TODO | Example: PostgreSQL, SQLite, Supabase |
| ORM | TODO | Example: Prisma, Drizzle, TypeORM |
| Auth | TODO | Example: NextAuth, Supabase Auth, custom JWT |
| Styling | TODO | Example: Tailwind, CSS Modules, SCSS |
| Testing | TODO | Example: Vitest, Jest, Playwright |
| Deployment | TODO | Example: Vercel, Docker, VPS |

## Architecture overview

<!--
Describe the actual request/data flow you find in the codebase (entry
points, routing layer, service/data layer, external integrations). If the
codebase is empty/new, leave the example flow below as a placeholder and
mark it TODO once real architecture exists.
-->

Describe the current architecture clearly enough that an agent does not
guess.

```text
User -> UI -> API/Server Actions -> Service Layer -> Database/External APIs
```

## Important directories

<!--
Verify each path actually exists in the repo before listing it. Remove rows
for directories that do not exist, and add rows for important directories
that do exist but are not listed here.
-->

| Path | Purpose |
| --- | --- |
| `src/app` | Application routes/pages |
| `src/components` | Shared UI components |
| `src/containers` | Page-level or feature-level containers |
| `src/features` | Feature state, API clients, types |
| `src/lib` | Shared utilities and infrastructure |
| `src/server` | Backend/server logic if present |
| `tests` | Automated tests |

## Constraints

Agents should avoid the following unless the task explicitly requires it:

- Do not rewrite the whole architecture for a bug fix.
- Do not change the package manager without a clear reason.
- Do not add heavy dependencies if existing code can solve the problem.
- Do not create abstractions before there are at least two real use cases.

## Definition of done

A task is only done when:

- The code runs.
- The main happy path is implemented.
- Relevant test/lint/typecheck commands pass, or the reason they could not
  run is documented.
- Specs/tasks are updated if behavior changed.
- The final summary states what changed, the key files, validation evidence,
  and risks.
```

- [x] **Step 2: Verify**

```bash
grep -c "<!--" templates/.ai/PROJECT.md
```

Expected: `6` (one guidance comment per TODO-bearing section: Project
identity, Product goal, Current MVP scope, Technology stack, Architecture
overview, Important directories).

- [x] **Step 3: Commit**

```bash
git add templates/.ai/PROJECT.md
git commit -m "annotate .ai/PROJECT.md placeholders with discovery guidance"
```

---

### Task 12: Update root `README.md`

**Files:**
- Modify: `README.md`

- [x] **Step 1: Update "What gets installed" tree**

Replace:
```text
.ai/
  README.md
  PROJECT.md
  RULES.md
  TASTE.md
  MEMORY.md
  AGENTS.md
  WORKFLOW.md
  state/CURRENT.md
  workflows/task-intake.md
  skills/
    frontend-implementation/SKILL.md
    backend-implementation/SKILL.md
    code-review/SKILL.md
    spec-planning/SKILL.md
openspec/
  README.md
  project.md
  changes/_template/
    proposal.md
    design.md
    tasks.md
    specs/capability.md
```

With:
```text
CLAUDE.md
AGENTS.md
.ai/
  README.md
  BOOTSTRAP.md
  PROJECT.md
  RULES.md
  TASTE.md
  MEMORY.md
  AGENT_REGISTRY.md
  WORKFLOW.md
  state/CURRENT.md
  workflows/task-intake.md
  agents/
    orchestrator.md
    planner.md
    architect.md
    frontend.md
    backend.md
    tester.md
    reviewer.md
    pr-writer.md
  skills/
    frontend-implementation/SKILL.md
    backend-implementation/SKILL.md
    code-review/SKILL.md
    spec-planning/SKILL.md
    testing/SKILL.md
.claude/
  skills/
    frontend/SKILL.md
    backend/SKILL.md
    testing/SKILL.md
    reviewer/SKILL.md
openspec/
  README.md
  project.md
  changes/_template/
    proposal.md
    design.md
    tasks.md
    specs/capability.md
```

- [x] **Step 2: Add "After Initialization" section**

Insert a new section after "## What gets installed" and before
"## MVP principles":

```markdown
