# Changelog

## 3.10.0 — 2026-07-31

Phase 13D — model-tier routing advice and a human outcome override. Additive
only (`schema_version` stays `1`); 3.9.0 records read back unchanged.

### Added

- **SvelteKit profile** (`--profile sveltekit`): auto-detected from the
  `@sveltejs/kit` dependency, or `svelte.config.js`/`.mjs` with `src/routes/`.
  Adds guidance for
  filesystem routing, server/universal load boundaries, form actions, hooks,
  adapters, and SSR/prerender behavior.
- **Model-tier routing recommendation** (13D): `--report` prints a `Routing`
  advisory naming the **lowest-token** tier (by mean tokens/eval) whose pass rate
  holds within 5 pts of the best tier, withheld until ≥ 2 tiers each have
  `MIN_TIER_SAMPLES` (default **20**, overridable via `--min-samples`) evaluations.
  A tier whose records span more than one provider/model, or that has no derived
  routing signature, is excluded rather than blended/trusted. Presented as an
  explicit **heuristic** (token count, not cost; does not control for task
  difficulty); `--report --json` gains a `routing` object (with
  `heuristic`/`caveat` and, when withheld, `reason`/`reason_code`/`eligible_tiers`)
  and an `invalid_records` array — a corrupt evaluation record is now surfaced (with
  a terminal warning) and withholds routing rather than being silently dropped.
- **`--evaluate --outcome pass|fail --reason "<text>" [--by "<name>"]`** (13D): a
  human can override the outcome of a `Needs human decision` task. Recorded as a
  `manual_override` `outcome_source` with the reason, original verdict, and
  provenance (`decided_by`, `decided_at`). Rejected (no record) for any other
  verdict. Re-evaluating without override flags **preserves** an existing override
  while its verdict is still `Needs human decision` (refreshing metrics only);
  `--clear-outcome` removes it. If the review has since changed to a clear verdict,
  or the stored record is corrupt, `--evaluate` exits 1 rather than overwrite (use
  `--clear-outcome`/`--outcome`, or `--force` — which backs the corrupt file up as
  `<task>.json.corrupt-<ts>` — for a corrupt record). Concurrent `--evaluate` on one
  task is unsupported.

### Changed

- Evaluation records gain a structured `routing_signatures` (`{provider, model}[]`)
  derived from their runs; the run-record validator now requires a non-empty `model`.
- `--outcome`/`--reason`/`--by`/`--clear-outcome` are now a usage error unless
  `--evaluate` is the selected command (previously the override flags were silently
  ignored when another command ran — including a higher-precedence one like `--version`
  given alongside `--evaluate`).

## 3.9.0 — 2026-07-28

Phase 13 — structured evaluation, context experiments, and context-escape
measurement. All schema changes are additive (`schema_version` stays `1`); data
written by earlier 3.x versions reads back with safe defaults.

### Added

- **Structured evaluation records** (13A): `--evaluate --task <id>` joins a
  task's review scorecard, journal, run records, and compiled-context artifact by
  a real `task_id` key, enforces a strict consistency gate, derives the outcome
  from the review `Verdict` (`approve→pass`, `request changes→fail`, `needs human
  decision→partial`), and writes `.ai/state/evaluations/<task_id>.json`.
- **`--report [--json]`** (13A): aggregates evaluation records by model tier
  (pass rate, token cost, latency, retries); `--json` emits the aggregate for CI.
- **`task_id` linkage** (13A): `--compile-context --task <id>` stamps `task_id`
  and `artifact_role` into the artifact; `--route` carries `task_id` into the run
  record.
- **Context experiments** (13B): `--compile-context --mode baseline|compact
  --experiment <EXP-id>`. `baseline` sends selected files whole (budget-honest);
  `compact` is the bounded compilation. Artifacts/evaluation records gain `mode`
  and `experiment_id`; evaluation records gain a `comparability` block; run
  records gain `mode`.
- **Experiment report** (13B): `--report` pairs baseline/compact records by
  `experiment_id` under a comparability gate, reports per-pair and aggregate
  token/latency savings and pass-rate deltas, honors a sample-sufficiency gate
  (`--min-samples`, default 5), and prints an advisory context-mode
  recommendation. `--report --json` gains `experiments` and `recommendation`.
- **Context escapes** (13C): `--expand-context` records every declined
  `need_context` request to a per-task, digest-attributed store at
  `.ai/state/context-escapes/<task_id>/` (`observed/<primary_digest>.json`
  markers + `events/<escape_id>.json` records), covering schema/graph rejections,
  whole-set `budget_exceeded`/`no_new_context`, and the low-capacity early
  return. Records are deduped by `escape_id` filename with atomic writes.
- **`context_escapes` metric** (13C): `--evaluate` reports the count of distinct
  declined context needs for the evaluated primary by content digest — `null`
  when the primary was never observed, `0` when observed with no escapes, `N`
  otherwise; a malformed store fails evaluation and writes no record.
- **`parent_artifact`** (13C): expansion artifacts record their primary's path
  (`null` for primary artifacts).
- Evaluation records and the context-escape store are gitignored (local derived
  state) and preserved on `--upgrade`.

### Changed

- **`--check-evaluation` deprecated (soft)**: it still validates the manual
  `.ai/evaluation/*.md` files but prints a notice pointing to `--evaluate` /
  `--report`. No files are removed.
- **`--expand-context` rejects an expansion artifact as `--artifact`**
  (expansion-of-expansion is not supported) and an artifact outside the
  repository root.

### Migration

Run `forgeai-init --upgrade`. Additive — see `docs/migrations/3.9.0.md`.
Artifacts and run records written before 3.9.0 lack `task_id` / `mode` /
`experiment_id` / `parent_artifact` and read as `null` / `compact`; they are not
retro-evaluated or retro-paired.

## 3.8.0 — 2026-07-23

### Added

- **Streaming output** (Phase 12B): `--route --adapter <name> --stream` streams
  incremental model output to stdout as it arrives, for all three API providers
  (Anthropic, OpenAI, Gemini). Streaming is opt-in; without `--stream` the
  buffered Phase 12A behavior is unchanged. CLI adapters ignore `--stream` (they
  already stream via inherited stdio).
- **Retry with exponential backoff**: per-adapter `max_retries` (0–5, default 2)
  and `retry_base_ms` (default 500) in `.ai/api-adapters.json`. Retryable
  failures (network, 5xx, 429) are retried with `retry_base_ms * 2^attempt`
  backoff before the existing quota→CLI fallback. Auth failures and mid-stream
  failures are never retried.
- **Lifecycle events**: `run_start`, `retry_attempt`, and `run_complete` are
  emitted as NDJSON to the `--watch` pipe (best-effort) and rendered in the
  activity log. `run_complete` describes the API-adapter run only — a `quota`
  completion may precede a successful CLI fallback.
- **`retry_count`** on run records. Records written before 3.8.0 (no
  `retry_count`) are read as `0`.

### Migration

Run `forgeai-init --upgrade`. Additive change — see `docs/migrations/3.8.0.md`.

## 3.7.0 — 2026-07-22

### Added

- **LLM-Native Adapter Layer** (Phase 12A — buffered MVP): `--route --adapter
  anthropic|openai|gemini` delivers a compiled context artifact to the provider
  API via Node.js built-in `fetch` (no new runtime deps). API keys from env
  vars only (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`); never
  stored in project files. Gemini key sent via `x-goog-api-key` header.
- **Normalized error taxonomy:** `ApiCallResult` carries `error_kind`
  (`auth | quota | network | provider | invalid_response`), `http_status`, and
  `retryable`. Auth errors fail fast; quota (HTTP 429) falls back to CLI adapter.
  HTTP 408/5xx responses are `retryable: true`.
- **Config validation:** `loadApiAdapters()` distinguishes missing config (null)
  from invalid config (error), preventing silent CLI fallthrough on typos.
  Validation rejects arrays, unknown providers, empty names, non-string system,
  max_tokens > 65536, and version ≠ 1.
- **Run records:** every API call writes a best-effort JSON record to
  `.ai/state/runs/<run-id>.json`. View with `forgeai-init --list-runs`.
- **`--list-runs`:** prints all run records newest-first.
- **`templates/.ai/api-adapters.json`**: starter config for Anthropic
  (`claude-sonnet-4-6`), OpenAI (`gpt-4.1`), and Gemini (`gemini-2.5-flash`).
  Copy to `.ai/api-adapters.json` and set the relevant env var.
- **`.ai/api-adapters.json` preserved on upgrade** — added to
  `PRESERVE_ON_UPGRADE_FILES`.
- Streaming output, retry loop, and lifecycle events deferred to Phase 12B.

## 3.6.0 — 2026-07-21

### Added

- **CI/CD Integration** (Phase 15): `ci-templates/github/forgeai.yml` ships
  in the npm package — a GitHub Actions workflow with five critical gates
  (`upgrade-check`, `harness-check`, `security`, `codegraph`, `review`). Copy into `.github/workflows/`, replace `VERSION`
  with your harness version from `.ai/manifest.json`. No provider credentials
  required. See [CI/CD Integration](README.md#cicd-integration) in the README.

## 3.5.0 — 2026-07-17

### Added

- **Go profile** (`--profile go`): auto-detected from `go.mod`. Package-boundary,
  `go vet`/`go test` workflow, and context exclusion hints for `vendor/` and
  generated files.
- **Rust profile** (`--profile rust`): auto-detected from `Cargo.toml`. Ownership/
  borrowing guidance, `cargo clippy` workflow, context exclusion hints for `target/`.
- **FastAPI profile** (`--profile fastapi`): auto-detected from exact `fastapi` package
  name in Python dependency files. Pydantic schema guidance and Alembic awareness.
- **Django profile** (`--profile django`): auto-detected from exact `django` package
  name in Python dependency files. App structure, ORM, and migration workflow.
- **React Native profile** (`--profile react-native`): auto-detected from
  `react-native` or `expo` dependencies. Platform targeting, navigation, and native
  module boundary guidance.
- **Profile composition**: `--profile nextjs+monorepo` applies both profiles, stores
  the composite name in the manifest, validates structural correctness (empty
  segments, duplicates, reserved names), and validates each component during
  `--check-profile`.
- **Three-state confidence**: `--check-profile` shows `(confident)`, `(ambiguous)`,
  or `(confidence: unknown)`. `--profile auto` logs a composition suggestion including
  monorepo when multiple primary stacks are found.
- `--upgrade --profile <name>` now uses the explicit profile instead of the manifest
  profile, enabling in-place profile migration (e.g., `mobile` → `react-native`).

### Changed

- Python detection uses format-specific exact-match parsers; `django-stubs` and
  comments no longer produce false positives.
- FastAPI and Django are detected independently; a project with both is reported
  as `ambiguous`.
- Mobile detection separates React Native/Expo (`react-native`) from Flutter/native
  (`mobile`).
- Monorepo secondary-stack warning suggests the composite form
  (`--profile monorepo+<secondary>`).
- `--help` lists all profiles including `go`, `rust`, `fastapi`, `django`,
  `react-native`, and the `a+b` composition syntax.

### Migration

Run `forgeai-init --upgrade`. See `docs/migrations/3.5.0.md`.
React Native/Expo projects: run `forgeai-init --upgrade --profile react-native`
and remove leftover mobile profile files (see migration guide for exact paths).

## 3.4.0 — 2026-07-17

### Added

- `--check-upgrade` command: offline three-state harness version check (`ok` /
  `outdated` / `cli-too-old`). Validates manifest package identity and version
  format. No network access — designed for CI use.
- `--upgrade --dry-run` now classifies managed files as `no change`, `would
  update`, or `would create`. The real apply path uses the same classifier —
  what the preview reports is what the apply does.
- `--upgrade` now logs `updated` (not `created`) when overwriting changed
  managed files, and skips unchanged files entirely (`no change`).
- `--upgrade` refuses to downgrade the harness and exits 1 with a clear message.
- `--upgrade` prints migration notes filtered to the installed-to-current
  version range after a successful update.

### Changed

- Version assertions in `test/lifecycle.test.ts` and `test/profile.test.ts` now
  read from `package.json` dynamically — version bumps no longer require manual
  test edits.
- Upgrade file-operation log paths are normalized to `/` on all platforms.

### Migration

Run `forgeai-init --upgrade`. See `docs/migrations/3.4.0.md`.

## 3.3.0 — 2026-07-14

### Added

- `--validate-artifact` command: validates a compiled context artifact against
  its dependency graph — structural schema, Phase 10 compiler bounds, path
  membership, fingerprint freshness, and token estimate consistency.
- `--route` command: validates and delivers a compiled context artifact to a
  configured `input: 'stdin'` CLI adapter. Writes an append-only routing journal
  to `.ai/state/context-routes.md`. Falls back to stdout when `--adapter` is
  omitted.
- `--expand-context` command: validates a `forgeai_need_context` request,
  resolves symbol/file/test requests against both graphs, and compiles a
  supplemental artifact with kind-aware inclusion and mode-aware deduplication
  against the primary artifact.
- `computeArtifactEstimate()` exported from `context-compiler` as a pure shared
  helper for consistent token estimation.
- `tokenizeObjective()` exported from `context-pack` for use by the expansion
  compiler.
- **Phase 9 (formal)** — `DependencyGraphNode` now stores `declarations: string[]`
  (all top-level non-test symbol names, exported and non-exported). Context pack
  seed scoring gains a declaration name match bucket (weight 1, capped at +1 per
  node, exact token match only) so objectives can find files by internal function
  or class names that are not exported.

### Changed

- `forgeai-init` and `--upgrade` now maintain `.ai/state/context/` and
  `.ai/state/context-routes.md` entries in the project `.gitignore`.

### Migration

Run `forgeai-init --upgrade`. See `docs/migrations/3.3.0.md`.

## 3.2.0 — 2026-07-13

This release delivers Phase 9 (dependency-aware context selection) and Phase 10
(context compiler) together.

### Added

- **Phase 9** — Dependency-aware CodeGraph refresh for TypeScript, TSX,
  JavaScript, and JSX. File hashes and repository fingerprints for stale graph
  detection. Forward/reverse dependency traversal with test prioritization and
  graph-path explanations. Explicit no-match result; no fallback to confidence
  or graph order.
- `forgeai-init --compile-context` for budgeted AST excerpts with JSON and
  Markdown output.
- Full-node extraction with signature fallback and source-line provenance.
- Mandatory and task-applicable rule packing from `.ai/RULES.md`.
- Deterministic read-only git diagnostics and validation-script discovery in
  compiled context artifacts.

### Changed

- `--context-pack` now requires a valid generated dependency graph and refuses
  stale source evidence.
- The default context selection bound is 12 files at traversal depth 2.

### Migration

Existing installations must run `forgeai-init --upgrade`, then explicitly run
`forgeai-init --refresh-codegraph` before using `--context-pack` or
`--compile-context`. Curated `.ai/codegraph/graph.json` and project-owned state
remain preserved. See `docs/migrations/3.2.0.md`.
