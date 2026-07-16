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

## Formal PR addition — 2026-07-16

### Problem

`DependencyGraphNode` only stores `exports: string[]` — the names of exported
symbols. `analyzeSource()` already parses all top-level declarations (exported
and non-exported), but the names are discarded when building the graph. An
objective such as "fix handleRequest routing" cannot find a seed when
`handleRequest` is not exported, silently missing the most relevant file.

### Solution

Add `declarations?: string[]` (optional) to `DependencyGraphNode`. Store all
top-level declaration `search_names` from `analyzeSource()`. Update
`scoreGeneratedNode()` with a new scoring bucket weighted at 1 (below path = 3
and exports = 2).

#### Schema

```ts
type DependencyGraphNode = {
  id: string;
  path: string;
  hash: string;
  exports: string[];
  declarations?: string[];   // all top-level declared names, exported + non-exported
};
```

Optional field — existing graphs without `declarations` remain valid and degrade
gracefully (`node.declarations ?? []` scores 0 for this bucket).

#### Scoring buckets

| Bucket | Weight | Field |
|---|---:|---|
| source path match | 3 | `node.path` |
| exported symbol match | 2 | `node.exports` |
| declaration name match | 1 | `node.declarations` |

Weight 1 ensures class member names cannot override path or export matches in
ranking. Short names such as `get`, `set`, `use` (exactly 3 chars) pass the
`tokenizeObjective` length filter and will be indexed, but their score of 1
cannot outrank a path match (3) or export match (2) for the same term.

#### What is stored

`search_names` from every top-level `SourceDeclaration` where `kind !== 'test'`,
deduplicated via `Set`. Test-case labels (`test('login works', ...)` →
`search_names: ['test', 'login works']`) are excluded because they are test
descriptions, not symbol names, and including them causes test files to become
spurious seeds for objectives that share words with test labels.

- Function `handleRequest` → `['handleRequest']`
- Class `Router` with methods `get`, `post` → `['Router', 'get', 'post']`
- Variable `defaultConfig` → `['defaultConfig']`
- `test('login works', ...)` → excluded

`exports` is unchanged — it continues to hold only exported names.

#### Scoring rule

For each objective term, per node:
```
path match      (+3) substring — always
exports match   (+2) substring — when term found in joined exports text
declarations    (+1) exact token — when term matches a declaration name exactly
                     AND no declaration match has already scored for this node
                     AND term did not already match exports (else if)
```

Declaration matching uses a `Set` of lowercased declaration names and `Set.has`
for exact comparison. `"set"` does not match `"resetState"` (normalized:
`"resetstate"`). A node can earn at most +1 from declarations regardless of how
many member names match; a `declarationMatched` flag prevents further additions
once the first declaration term scores.

### Safety properties (unchanged)

All six original safety properties remain valid. The optional field does not
affect stale detection, traversal bounds, or no-match behavior.

### Files changed

| File | Change |
|---|---|
| `bin/lib/types.ts` | add `declarations?: string[]` to `DependencyGraphNode` |
| `bin/lib/dependency-graph.ts` | store declarations in `generateDependencyGraph`; optional validator check in `isDependencyGraph` |
| `bin/lib/context-pack.ts` | new scoring bucket in `scoreGeneratedNode` |
| `test/codegraph.test.ts` | 4 new tests: stored declarations, non-exported seed match, exact token match, +1 score cap |

No version bump.

## Safety properties

1. No objective match produces an explicit no-match result.
2. Confidence and graph order never create fallback seeds.
3. A changed, added, or removed source file invalidates the graph.
4. Traversal cannot exceed the configured depth or file count.
5. Every non-seed result identifies a concrete import edge and graph path.
6. Refresh builds in memory and replaces the generated graph only after all
   scanned files parse successfully.
