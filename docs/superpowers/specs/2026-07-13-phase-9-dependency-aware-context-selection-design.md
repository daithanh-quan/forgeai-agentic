# Phase 9 — Dependency-aware Context Selection

## User outcome

Given a natural-language objective, ForgeAI returns the smallest bounded set of
source files that is justified by repository evidence. A user can see which
file matched the objective and the exact dependency path that caused every
neighbor, caller, or test to be selected.

## Artifacts and commands

- `.ai/codegraph/graph.json` remains curated project knowledge and is never
  overwritten by static analysis.
- `.ai/codegraph/dependency-graph.json` is generated file-level evidence.
- `forgeai-init --refresh-codegraph` is the only Phase 9 command that writes
  the generated graph.
- `forgeai-init --context-pack` is read-only unless `--output` is explicit. It
  refuses a missing, invalid, or stale generated graph.

## MVP scope

- TypeScript and JavaScript source extensions, including ESM and CommonJS.
- Static imports, re-exports, literal dynamic imports, and static `require`
  calls.
- Relative local-module resolution with extension and `index` probing.
- Forward dependency and reverse dependent traversal.
- Test prioritization, deterministic ordering, depth bounds, and node bounds.
- SHA-256 file hashes plus a source-set fingerprint for stale detection.

Package aliases, tsconfig path mapping, workspace package-name resolution, and
Python, Go, and Rust parsers are follow-up work behind the same graph contract.
Non-literal dynamic imports are recorded as unresolved evidence and are never
guessed.

## Safety properties

1. No objective match produces an explicit no-match result.
2. Confidence and graph order never create fallback seeds.
3. A changed, added, or removed source file invalidates the graph.
4. Traversal cannot exceed the configured depth or file count.
5. Every non-seed result identifies a concrete import edge and graph path.
6. Refresh builds in memory and replaces the generated graph only after all
   scanned files parse successfully.
