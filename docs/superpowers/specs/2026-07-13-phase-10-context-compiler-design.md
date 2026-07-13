# Phase 10 — Context Compiler MVP

## Outcome

Convert dependency-selected TypeScript and JavaScript files into a bounded,
deterministic artifact containing relevant complete syntax nodes rather than a
file list that forces a model to reopen every file.

## Command

```bash
forgeai-init --compile-context \
  --objective "refactor router fallback" \
  --budget 6000 \
  --output .ai/state/context/TASK-01.json
```

Writing JSON also writes a sibling Markdown inspection rendering. Without
`--output`, JSON is emitted to stdout.

## Artifact guarantees

1. Schema-versioned JSON is the source of truth.
2. Repository revision and source fingerprint bind it to graph evidence.
3. Every excerpt has a path, original line range, kind, inclusion reason, and
   full-or-signature mode.
4. Complete AST nodes are preferred. Oversized functions, classes, and
   interfaces use synthesized signature fallbacks; nodes are never partially
   sliced.
5. The pretty-printed JSON estimate never exceeds the configured budget.
6. The same objective, graph, source, and options produce byte-identical JSON.
7. Mandatory and objective-applicable `.ai/RULES.md` sections are embedded with
   line provenance and deduplicated content.
8. Read-only git status/diff evidence and detected validation scripts are
   embedded without running validation commands.

## MVP boundary

The compiler handles TypeScript, TSX, JavaScript, and JSX imports, functions,
classes, interfaces, types, enums, variable declarations, and directly related
tests. Project-memory selection, caller-level symbol analysis, Python/Go/Rust
extraction, router enforcement, delta expansion, executed-test evidence, and
provider-native token accounting remain follow-up work.
