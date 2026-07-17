# Changelog

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
