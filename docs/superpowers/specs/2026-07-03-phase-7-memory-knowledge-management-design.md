# Phase 7 — Memory & Knowledge Management

- **Date:** 2026-07-03
- **Status:** Approved design, ready for implementation plan
- **Package:** `forgeai-agentic-init` (this repo)
- **Numbering note:** Phase 7 under the consolidated roadmap numbering in
  `.ai/MEMORY.md` (old Phase 8). The existing spec file titled "Phase 7 —
  Supply-chain" uses the old numbering and is Phase 6 in the new sequence.

## Problem

`.ai/MEMORY.md` is step 4 of the mandatory read order in `CLAUDE.md`: every
agent session reads it before touching code, and every decision the agent
makes — which conventions to follow, which pitfalls to avoid, which commands
to run — is shaped by it. Yet it is the weakest artifact in the harness:

1. **The template is nearly empty guidance.** The current
   `templates/.ai/MEMORY.md` is 43 lines of TODO placeholders. It gives teams
   no structure for the knowledge that agents actually need: recurring bugs,
   project commands, test strategy, ownership, deployment notes.
2. **Stale memory is silently harmful.** Agents do not doubt memory — they
   follow it. An entry that says "API clients live in `src/api/`" after that
   directory was refactored away misleads every future session, and the
   resulting mistakes are hard to trace back to the bad entry. Nothing today
   flags an outdated assumption.
3. **Drift is already observable in this repo.** The template still ships an
   "External integrations" table referencing Jira/Trello — connectors were
   dropped from the roadmap on 2026-07-02.
4. **Memory is the only read-order pillar without a gate.** Profiles,
   lifecycle, CodeGraph, review, and supply-chain safety each have a
   `--check-*` command; memory — the input to all of them — has none.

This must land before Phase 8 (advanced orchestration): when one agent reads
bad memory the damage is one session; when an orchestrator fans work out to
many agents reading the same memory, the damage multiplies.

## Goal

1. **Structured memory sections.** Redesign `templates/.ai/MEMORY.md` around
   the sections agents need: architecture decisions, coding conventions,
   business rules, recurring bugs & pitfalls, commands, test strategy,
   ownership, deployment notes.
2. **Stale-memory checks.** A new `--check-memory` gate (aggregated into
   `--check-all`) that flags dead path references, leftover TODO
   placeholders, entries past a configurable age threshold, and malformed
   entries — so agents flag outdated assumptions instead of blindly
   following them.

## Non-goals

- **No project context diffing** (roadmap bullet 3). `git diff`/`git log`
  already cover how `.ai/*.md` evolve; a bespoke tool adds surface without
  clear value. Revisit only with a concrete need.
- **No import/export tooling** (roadmap bullet 4). Deferred; may return as
  guidance-only docs later.
- **No multi-file memory store.** Memory stays a single `.ai/MEMORY.md`; a
  `.ai/memory/` directory would break the read order in `CLAUDE.md`, the
  upgrade-preserve rules, and every existing reference, for scale the harness
  does not yet need.
- **No new config file and no new runtime dependencies.** Configuration is a
  single inline directive in `MEMORY.md` itself; the checker stays offline
  and hand-rolled, consistent with `bin/lib/security.ts`.
- **No semantic staleness detection.** The checker verifies mechanical
  signals (paths, dates, placeholders, shape). Judging whether a decision is
  still *conceptually* right remains a human/agent task, guided by the
  workflow doc.

## Approach (chosen)

**Convention over configuration.** The checker ships sensible hardcoded
defaults (age threshold 180 days) overridable by one HTML-comment directive
at the top of `MEMORY.md`:

```html
<!-- forgeai-memory: max-age-days=180 -->
```

Rejected alternatives:

- **`memory-policy.yaml`** (the `security-policy.yaml` precedent) —
  configurable required-sections, ignored paths, thresholds. More surface, a
  new template, a new upgrade-preserve rule, and most repos would never edit
  it. The single directive covers the one knob that plausibly varies.
- **Minimal checker (dead paths + TODO only)** — drops the age and format
  signals that motivated the phase.

## Components / deliverables

### 1. `templates/.ai/MEMORY.md` — restructured template

Single file, opening with the `forgeai-memory` directive, then:

| Section | Content | Entry format |
| --- | --- | --- |
| Architecture decisions | Durable decisions | `### YYYY-MM-DD — Title` + **Decision/Why/Impact** bullets |
| Coding conventions | Kept from current template | Bullet list |
| Business rules | Kept from current template | Bullet list |
| Recurring bugs & pitfalls | Renamed from "Known pitfalls" | Table with Date, Pitfall, Prevention |
| Commands | Repo-specific build/test/deploy commands | Table or fenced blocks |
| Test strategy | What to run, when, expected coverage | Prose + bullets |
| Ownership | Who owns which area | Table: Area, Owner, Notes |
| Deployment notes | Release process, environments | Prose + bullets |

The "External integrations" Jira/Trello table is **removed** (connectors
dropped 2026-07-02). "How to use this file" is rewritten to explain the
directive, the entry format, and when to prune (link to the workflow doc).

Any example paths in the template must be globs or `<placeholder>` forms the
checker skips, or paths that exist in a fresh install — the shipped template
must produce zero FAILs against its own checker (verified by test 1).

### 2. `bin/lib/memory.ts` — the checker

Follows the structure of `bin/lib/security.ts`: no dependencies, exported
pure helpers plus a `runCheckMemory()` entry point using
`formatStatus`/`getErrorMessage` from `bin/lib/utils.ts`.

Signals and severities:

| Signal | Detection | Severity |
| --- | --- | --- |
| Dead path reference | Backtick-quoted token that looks like a repo path (contains `/` or a known source extension) and fails `fs.existsSync` against the repo root. Skips URLs, globs (`*`), placeholders (`<...>`, `TODO`, `YYYY`), and command-looking tokens (leading `-`, contains spaces). | **FAIL** |
| Leftover TODO | Line containing `TODO` inside a standard section | WARN |
| Entry past age threshold | `### YYYY-MM-DD — Title` heading older than `max-age-days` | WARN |
| Malformed entry | `###` heading in the Architecture decisions section not matching `YYYY-MM-DD — Title`, or an entry missing any of Decision/Why/Impact | WARN |

Behavior details:

- Missing `.ai/MEMORY.md` → fail with the same "not initialized" style as the
  other checkers.
- Directive parsing: first `<!-- forgeai-memory: ... -->` comment wins;
  unknown keys ignored; invalid `max-age-days` (non-numeric, ≤ 0) → warn and
  fall back to 180.
- Structural signals are **warn-only by design**: `--upgrade` preserves a
  populated `MEMORY.md`, so upgraded repos keep old formats forever; the gate
  must not hard-fail them. Only dead path references fail, because they are
  objectively wrong regardless of format.
- Exit behavior mirrors the other checkers (non-zero exit code only on FAIL).
- Output ends with a one-line recommendation when findings exist (fix the
  path, prune or re-date the entry, fill the TODO).

### 3. CLI wiring — `bin/forgeai-init.ts` and `bin/lib/check.ts`

- New `--check-memory` flag, parsed alongside the existing `--check-*` flags.
- `runCheckAll()` appends `runCheckMemory()` after `runCheckSecurity()`.
- Help text gains the new flag with a one-line description.

### 4. `templates/.ai/workflows/memory-management.md` — workflow doc

Short guidance for agents and humans: when to add a memory entry (decision
expected to hold for weeks+), when to prune (superseded, refactored away,
proven wrong), how to respond to each `--check-memory` finding, and the rule
that an agent noticing stale memory should flag it to the human rather than
silently obey or silently delete it.

### 5. Documentation updates

- `templates/.ai/README.md` (and this repo's `.ai/README.md` via self-sync):
  mention the memory workflow and `--check-memory`.
- Root `README.md`: changelog line for the release that ships this phase.
- `.ai/MEMORY.md` (this repo): move Phase 7 from "Upcoming" to "Delivered"
  with artifacts, and record the design decision entry.

### 6. Self-sync (dogfooding)

This repo eats its own harness. After implementation:

- Update this repo's `.ai/MEMORY.md` to carry the directive and pass
  `--check-memory` (its roadmap-heavy content must produce zero FAILs and
  only actionable WARNs).
- `--check-all` on this repo stays green.

## Testing

`test/memory.test.ts`, same style as `test/check.test.ts` (temp dir via
`mkdtempSync`, run the CLI, assert on output):

1. Fresh init → `--check-memory` reports the template's TODO warns, no fails.
2. Dead path reference → FAIL naming the path and location.
3. Existing path reference → ok.
4. Entry older than threshold → WARN; directive `max-age-days=10000` on the
   same file → no age warn (directive respected).
5. Invalid directive value → warn + fallback to default.
6. Malformed decision heading / missing Decision/Why/Impact → WARN.
7. Missing `.ai/MEMORY.md` → fail.
8. `--check-all` output includes the memory check section.

Full `npm test` must stay green (85 existing tests).

## Acceptance criteria

- `npx forgeai-init --check-memory` runs offline, zero new dependencies, and
  reports the four signals with the severities above.
- A dead path reference is the only condition that exits non-zero.
- The directive overrides the age threshold without any new config file.
- Fresh installs receive the restructured `MEMORY.md` and the
  memory-management workflow; upgrades preserve existing `MEMORY.md` content
  untouched.
- `--check-all` includes the memory gate; this repo's own `--check-all`
  passes.
- All new and existing tests pass.

## Roadmap change

Phase 7 narrows to roadmap bullets 1–2 (structured sections, stale-memory
checks). Bullet 3 (context diffing) is dropped as covered by git; bullet 4
(import/export guidance) is deferred. `.ai/MEMORY.md` "Upcoming" will be
updated accordingly when this phase ships.
