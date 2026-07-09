# Project Context

This file explains the project to any AI coding agent before it edits code.
Keep it short, accurate, and updated. See `.ai/BOOTSTRAP.md` for how to
populate this file on first run.

## Project identity

- **Project name:** forgeai-agentic-init
- **Repository:** git@github.com:daithanh-quan/forgeai-agentic.git
- **Owner:** daithanh-quan
- **Primary language:** TypeScript
- **Runtime:** Node.js
- **Main framework:** Ink terminal UI for `--watch`; otherwise Node.js CLI modules
- **Package manager:** npm (`package-lock.json`)

## Product goal

This project helps AI coding agents and their human operators initialize a
consistent markdown-based agentic workflow harness by installing shared project
context, rules, memory, agents, workflows, skills, OpenSpec templates, model
routing helpers, and local validation checks.

## Current scope

The initial version should focus on:

1. Install and upgrade the `.ai/`, `.claude/`, and `openspec/` harness templates.
2. Provide CLI checks for harness completeness, git/session coordination,
   lifecycle journals, CodeGraph, reviews, security, memory, approval, and
   evaluation artifacts.
3. Provide model adapter registration and a template router for delegated agent
   assignments with fallback behavior.
4. Provide an Ink terminal monitor for real-time orchestration events.

Out of scope for now:

- Hosting or authenticating external AI model providers.
- Database-backed orchestration or persistent server state.
- Vendor-specific workflow connectors unless a future spec reintroduces them.
- Production deployment infrastructure beyond publishing the npm package.

## Technology stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | Ink + React | Terminal UI components under `bin/ui/` |
| Backend | Node.js CLI | No server framework; CLI entrypoint is `bin/forgeai-init.ts` |
| Database | None | Markdown/filesystem-first harness |
| ORM | None | No database layer |
| Auth | None | Provider auth is intentionally external to this package |
| Styling | Ink props | Terminal layout and color through Ink components |
| Testing | TypeScript + Node test runner | `npm test` runs typecheck, build, and `node --import tsx --test test/*.test.ts` |
| Deployment | npm package | Published package includes `dist`, `profiles`, `templates`, and `README.md` |

## Architecture overview

```text
User or agent -> forgeai-init CLI -> bin/lib/* command module -> filesystem templates/checks
Orchestrator -> .ai/router/run-model.ts -> configured provider CLI -> fallback JSON or delegated output
Router/--emit -> .forgeai.pipe -> Ink --watch UI -> reducer-driven terminal dashboard
```

## Important directories

| Path | Purpose |
| --- | --- |
| `bin/forgeai-init.ts` | CLI entrypoint and flag dispatch |
| `bin/lib` | CLI command implementations, checks, init/upgrade, routing config helpers |
| `bin/ui` | Ink terminal monitor components, reducer, and pipe utilities |
| `templates` | Base harness files copied into target projects |
| `profiles` | Optional stack-specific overlays copied during init/profile selection |
| `test` | Automated Node test suites |
| `docs/superpowers` | Internal implementation plans and design notes |
| `openspec` | OpenSpec-style change scaffolding and active specs |

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
