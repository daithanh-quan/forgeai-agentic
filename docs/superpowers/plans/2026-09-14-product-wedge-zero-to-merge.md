# ForgeAI Product Wedge: Zero-to-Verified-Change

## Problem

ForgeAI currently has strong infrastructure but weak immediate user value. A
new user must understand initialization, CodeGraph refresh, context compilation,
routing, checks, lifecycle state, and evaluation before getting a useful result.
The product promise is therefore about internal control rather than a finished
engineering outcome.

The next release should optimize for one visible result: a user describes a
small repository change and gets an implemented, checked, reviewable result
without manually chaining ForgeAI commands.

## Product promise

> Give ForgeAI one engineering objective. It finds the relevant context, asks a
> configured coding agent to work inside an explicit scope, runs local checks,
> and reports exactly what changed and what evidence supports it.

Working command:

```bash
forgeai-init task "add rate limiting to the login endpoint"
```

The command must remain local-first, provider-agnostic, and safe by default.
It should work with an existing CLI adapter and degrade to a useful dry-run
when no adapter is configured.

## Target user and first use case

Target: an individual developer using Codex, Claude Code, or another CLI agent
on an unfamiliar or medium-sized repository.

First use case: a bounded bug fix or small feature that can be validated by an
existing test/build command. Avoid multi-repository orchestration, remote
queues, autonomous issue intake, and general-purpose project management in the
first release.

## MVP user journey

1. `task` validates the objective and detects whether the harness exists.
2. If needed, it offers or performs a safe bootstrap/repair preview.
3. It refreshes a stale dependency graph locally.
4. It compiles a bounded context artifact and displays the selected scope.
5. It creates a task journal with objective, scope, adapter, and safety policy.
6. It invokes one configured adapter with the compiled artifact and explicit
   write scope.
7. It runs the repository's detected validation command(s), stopping at the
   first failure.
8. It prints a final report: files changed, checks run, failures, and next
   action. It never claims success merely because the adapter exited zero.

No adapter configured:

- return a copy/paste-ready assignment containing the compiled context and
  write scope;
- show the exact command to rerun after configuring an adapter;
- exit zero for preview and non-zero only for invalid input or broken state.

## Scope of the first release

### 1. User-facing command contract

- Add `task` to help and README.
- Support `--objective`/positional objective, `--adapter`, `--dry-run`,
  `--budget`, `--max-depth`, `--max-nodes`, `--yes`, and `--no-check`.
- Use a stable task id and persist artifacts under `.ai/state/tasks/`.
- Make stdout a human-readable report; provide `--json` for automation.
- Keep all writes previewable and refuse unsafe/ambiguous write scopes.

### 2. Execution session

- Reuse existing graph, compiler, router, lifecycle, session, and diagnostics
  modules instead of creating a second orchestration model.
- Add explicit session states: `planned`, `running`, `checking`, `passed`,
  `failed`, `needs-human`.
- Emit existing monitor events so `--watch` becomes an optional view of a real
  user workflow rather than a separate demo feature.
- Record adapter/model, artifact digest, changed files, exit codes, and timing.

### 3. Change safety

- Capture the initial git status and reject unexpected changes outside the
  declared write scope.
- Run the adapter in the current repository only after a confirmation unless
  `--yes` or non-interactive policy explicitly allows it.
- Never expose files omitted by context policy to the adapter.
- On failure, preserve the journal and diagnostics; never auto-reset user
  changes.

### 4. Validation and proof

- Detect existing `test`, `typecheck`, `lint`, and `build` scripts through the
  current test-summary logic.
- Add a concise final report with a proof matrix:
  `changed file → relevant check → result`.
- Add a `--report-task <id>` command or equivalent JSON output for reruns and CI.
- Make review scorecards optional for MVP, but link the task journal to a
  scorecard when the repository uses gated lifecycle states.

## Deliberate non-goals

- No autonomous issue tracker integration.
- No multi-agent fan-out in the first release.
- No background daemon requirement.
- No embeddings/vector database.
- No automatic commit, push, merge, or destructive rollback.
- No claim of token savings without provider usage evidence.

## Release slices

### Slice A — Preview that already feels useful

Implement `task --dry-run` as a polished single report combining objective,
detected stack, selected files, excluded files, token estimate, proposed write
scope, validation commands, and adapter availability. This is the shareable
demo and should work with no `.ai/` directory.

Exit criterion: a new user can run one command and understand what ForgeAI
would do within 30 seconds.

### Slice B — One-command execution

Wire the existing compile and route paths into a persisted execution session.
Add confirmation, adapter invocation, scope checks, and final status output.

Exit criterion: a small task can go from objective to adapter result without
manual ForgeAI subcommands, and all intermediate artifacts are inspectable.

### Slice C — Verified change

Run detected checks, capture git diff/stat, classify pass/fail/needs-human, and
produce JSON plus Markdown reports. Add failure-path and out-of-scope tests.

Exit criterion: ForgeAI can explain why a task is considered complete and can
prove when it is not complete.

### Slice D — Distribution and demo

- Rewrite the README around the one-command outcome.
- Add a tiny fixture repository and a scripted 60-second demo.
- Publish before/after examples for one Node, one Python, and one Rust repo.
- Add a `try`/`task --dry-run` GIF or terminal recording.
- Measure first-success time, preview-to-execution conversion, and task pass
  rate before adding more architecture.

## Success metrics for 3.14.0

- First useful output in under 60 seconds from `npx ... task --dry-run ...`.
- At least 80% of demo tasks reach a valid context + proposed scope without
  manual repair.
- At least 70% of fixture tasks reach `passed` with an existing local check.
- Zero out-of-scope file writes in automated tests.
- README quick start requires one primary command, not a command chain.
- Every failure has a concrete next action rather than a generic error.

## Version and sequencing decision

Do not bump version for planning-only work. Ship the first preview slice as
`3.14.0` only when the new command, fixture demo, tests, and README are ready.
Defer new parsers, remote orchestration, plugin distribution, and deeper
analytics until this command demonstrates repeated user value.

