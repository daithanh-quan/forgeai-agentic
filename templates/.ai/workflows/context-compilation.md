# Context Compilation Workflow

Use compiled context for delegated tasks after dependency-aware selection.

## Compile

```bash
forgeai-init --check-codegraph
forgeai-init --compile-context --objective "<task objective>" \
  --budget 6000 \
  --output .ai/state/context/TASK-ID.json
```

If CodeGraph is missing or stale, run `forgeai-init --refresh-codegraph` and
retry. Compilation never refreshes project state silently.

## Artifact contract

- JSON is the deterministic source of truth and the future router input.
- Markdown is an inspection rendering and is not covered by the JSON budget.
- Every excerpt records path, complete source-line provenance, kind, reason,
  and whether it contains a full syntax node or a signature fallback.
- Mandatory baseline rules and objective-applicable rule sections are embedded
  with `.ai/RULES.md` line provenance and deduplicated content.
- Read-only diagnostics include git branch/revision, bounded status and diff
  records, plus detected validation scripts. Compilation never runs tests.
- The estimator is `ceil(serialized JSON characters / 4)`. Provider tokenizers
  may report different exact usage.
- Never cut a function, class, interface, type, variable declaration, import,
  or test in the middle.

## When the budget is exhausted

Do not append arbitrary source. First refine the objective, reduce traversal
depth, or raise the explicit budget. Signature excerpts show that a relevant
node exists but do not contain its implementation body; request the complete
node before asking a model to modify that implementation.

## Current language boundary

Syntax compilation currently supports TypeScript and JavaScript, including
TSX and JSX. Python, Go, and Rust require language-specific parser and excerpt
providers behind the same artifact contract.
