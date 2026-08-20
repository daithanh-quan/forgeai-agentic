import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCuratedGraph, parseTryObjective, buildTryReport, formatTryOutput } from '../bin/lib/try.js';
import type { CodeGraph, DependencyGraph, DependencyGraphNode } from '../bin/lib/types.js';
import type { TryReport } from '../bin/lib/try.js';
import type { SelectedContextNode } from '../bin/lib/context-pack.js';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeDepGraph(
  nodes: { id: string; path: string; language?: string }[]
): DependencyGraph {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: 'forgeai-static-analysis',
    repository: { root: '.', revision: null, fingerprint: 'f'.repeat(64) },
    settings: { extensions: ['.ts', '.go'], ignored_directories: [] },
    nodes: nodes.map((n) => ({
      id: n.id,
      path: n.path,
      hash: 'h'.repeat(64),
      exports: [],
      language: n.language ?? 'typescript',
    })),
    edges: [],
    unresolved: [],
  } as unknown as DependencyGraph;
}

const emptyCurated: CodeGraph = normalizeCuratedGraph({ nodes: [], edges: [] });

// ── normalizeCuratedGraph — shape validation ───────────────────────────────────

test('normalizeCuratedGraph: null returns empty graph', () => {
  const g = normalizeCuratedGraph(null);
  assert.deepEqual(g.nodes, []);
  assert.deepEqual(g.edges, []);
});

test('normalizeCuratedGraph: undefined returns empty graph', () => {
  const g = normalizeCuratedGraph(undefined);
  assert.deepEqual(g.nodes, []);
});

test('normalizeCuratedGraph: non-object (string) returns empty graph', () => {
  const g = normalizeCuratedGraph('bad json');
  assert.deepEqual(g.nodes, []);
});

test('normalizeCuratedGraph: nodes=string becomes empty array', () => {
  const g = normalizeCuratedGraph({ nodes: 'not-an-array', edges: [] });
  assert.deepEqual(g.nodes, []);
});

test('normalizeCuratedGraph: edges=null becomes empty array', () => {
  const g = normalizeCuratedGraph({ nodes: [], edges: null });
  assert.deepEqual(g.edges, []);
});

test('normalizeCuratedGraph: null items inside nodes are filtered out', () => {
  const g = normalizeCuratedGraph({ nodes: [null, { id: 'src/a.ts' }, undefined], edges: [] });
  assert.equal(g.nodes?.length, 1);
});

test('normalizeCuratedGraph: path=42 becomes undefined (not crash)', () => {
  const g = normalizeCuratedGraph({ nodes: [{ path: 42, id: 'a' }], edges: [] });
  assert.equal(g.nodes?.length, 1);
  assert.equal((g.nodes?.[0] as { path: unknown })?.path, undefined);
});

test('normalizeCuratedGraph: dependencies=1 becomes [] (prevents spread TypeError)', () => {
  const g = normalizeCuratedGraph({ nodes: [{ id: 'a', dependencies: 1 }], edges: [] });
  const node = g.nodes?.[0] as { dependencies: unknown };
  assert.deepEqual(node?.dependencies, []);
});

test('normalizeCuratedGraph: tags={} becomes [] (prevents spread TypeError)', () => {
  const g = normalizeCuratedGraph({ nodes: [{ id: 'a', tags: {} }], edges: [] });
  const node = g.nodes?.[0] as { tags: unknown };
  assert.deepEqual(node?.tags, []);
});

test('normalizeCuratedGraph: mixed-type array filters to strings only', () => {
  const g = normalizeCuratedGraph({
    nodes: [{ id: 'a', tags: ['valid', 123, null, 'also-valid'] }], edges: []
  });
  const node = g.nodes?.[0] as { tags: unknown };
  assert.deepEqual(node?.tags, ['valid', 'also-valid']);
});

test('normalizeCuratedGraph: all six spread-iterated fields are normalized', () => {
  const g = normalizeCuratedGraph({
    nodes: [{
      id: 'a',
      tags: 'bad',
      entrypoints: 99,
      public_contracts: {},
      dependencies: true,
      dependents: null,
      owners: undefined,
    }],
    edges: [],
  });
  const node = g.nodes?.[0] as {
    tags: unknown; entrypoints: unknown; public_contracts: unknown;
    dependencies: unknown; dependents: unknown; owners: unknown;
  };
  assert.deepEqual(node?.tags, []);
  assert.deepEqual(node?.entrypoints, []);
  assert.deepEqual(node?.public_contracts, []);
  assert.deepEqual(node?.dependencies, []);
  assert.deepEqual(node?.dependents, []);
  assert.deepEqual(node?.owners, []);
});

test('normalizeCuratedGraph: valid graph is preserved', () => {
  const valid = {
    schema_version: 1,
    nodes: [{ id: 'src/a.ts', path: 'src/a.ts', tags: ['auth'] }],
    edges: [],
  };
  const g = normalizeCuratedGraph(valid);
  assert.equal(g.nodes?.length, 1);
  assert.equal(g.schema_version, 1);
  assert.deepEqual((g.nodes?.[0] as { tags: unknown })?.tags, ['auth']);
});

// ── parseTryObjective ──────────────────────────────────────────────────────────

test('parseTryObjective: positional arg after "try"', () => {
  assert.equal(parseTryObjective(['try', 'add authentication']), 'add authentication');
});

test('parseTryObjective: --objective flag', () => {
  assert.equal(parseTryObjective(['try', '--objective', 'add authentication']), 'add authentication');
});

test('parseTryObjective: --objective=value flag', () => {
  assert.equal(parseTryObjective(['try', '--objective=add authentication']), 'add authentication');
});

test('parseTryObjective: returns null when no objective given', () => {
  assert.equal(parseTryObjective(['try']), null);
});

test('parseTryObjective: skips positional when it starts with --', () => {
  assert.equal(parseTryObjective(['try', '--objective', 'auth']), 'auth');
});

test('parseTryObjective: --objective followed by a flag-like value returns null', () => {
  assert.equal(parseTryObjective(['try', '--objective', '--bad']), null);
});

test('parseTryObjective: --objective with no following arg returns null', () => {
  assert.equal(parseTryObjective(['try', '--objective']), null);
});

test('parseTryObjective: --objective=--bad returns null', () => {
  assert.equal(parseTryObjective(['try', '--objective=--bad']), null);
});

test('parseTryObjective: --objective= (empty) returns null', () => {
  assert.equal(parseTryObjective(['try', '--objective=']), null);
});

test('parseTryObjective: duplicate --objective returns null', () => {
  assert.equal(parseTryObjective(['try', '--objective', 'auth', '--objective', 'billing']), null);
});

// ── buildTryReport ─────────────────────────────────────────────────────────────

test('buildTryReport: empty graph returns zero counts', () => {
  const report = buildTryReport('add auth', makeDepGraph([]), emptyCurated, {});
  assert.equal(report.totalFiles, 0);
  assert.equal(report.selected.length, 0);
  assert.equal(report.omittedCount, 0);
  assert.equal(report.selectedSourceBytes, 0);
  assert.deepEqual([...report.languages.entries()], []);
});

test('buildTryReport: language breakdown counted from all dep graph nodes', () => {
  const depGraph = makeDepGraph([
    { id: 'src/a.ts', path: 'src/a.ts', language: 'typescript' },
    { id: 'src/b.ts', path: 'src/b.ts', language: 'typescript' },
    { id: 'main.go', path: 'main.go', language: 'go' },
  ]);
  const report = buildTryReport('irrelevant', depGraph, emptyCurated, {});
  assert.equal(report.totalFiles, 3);
  assert.equal(report.languages.get('typescript'), 2);
  assert.equal(report.languages.get('go'), 1);
});

test('buildTryReport: matching objective selects files', () => {
  const depGraph = makeDepGraph([
    { id: 'src/auth/middleware.ts', path: 'src/auth/middleware.ts' },
    { id: 'src/unrelated.ts', path: 'src/unrelated.ts' },
  ]);
  const report = buildTryReport('auth middleware', depGraph, emptyCurated, {});
  assert.ok(report.selected.length > 0);
  assert.ok(report.selected.some((s) => s.node.path === 'src/auth/middleware.ts'));
});

test('buildTryReport: selectedSourceBytes uses fileSizer callback', () => {
  const depGraph = makeDepGraph([{ id: 'src/auth/middleware.ts', path: 'src/auth/middleware.ts' }]);
  const fileSizer = (p: string) => (p === 'src/auth/middleware.ts' ? 4096 : 0);
  const report = buildTryReport('auth middleware', depGraph, emptyCurated, {}, fileSizer);
  assert.equal(report.selectedSourceBytes, 4096);
});

test('buildTryReport: selectedSourceBytes is 0 when no files selected', () => {
  const report = buildTryReport('auth', makeDepGraph([]), emptyCurated, {});
  assert.equal(report.selectedSourceBytes, 0);
});

test('buildTryReport: omittedCount reflects exclusion rules', () => {
  const rules = [{ pattern: 'migrations/', reason: 'auto-generated', profiles: ['django'] }];
  const depGraph = makeDepGraph([
    { id: 'app/migrations/0001.ts', path: 'app/migrations/0001.ts' },
    { id: 'src/auth.ts', path: 'src/auth.ts' },
  ]);
  const report = buildTryReport('migrations auth', depGraph, emptyCurated, { rules });
  assert.equal(report.omittedCount, 1);
});

test('buildTryReport: control chars in objective are stripped', () => {
  const report = buildTryReport('add\x00auth\nhere', makeDepGraph([]), emptyCurated, {});
  assert.ok(!report.objective.includes('\x00'));
  assert.ok(!report.objective.includes('\n'));
  assert.ok(report.objective.includes('auth'));
});

// ── formatTryOutput ────────────────────────────────────────────────────────────

test('formatTryOutput: contains sanitized objective in header', () => {
  const report = buildTryReport('add auth', makeDepGraph([]), emptyCurated, {});
  const output = formatTryOutput(report);
  assert.ok(output.includes('"add auth"'), output);
});

test('formatTryOutput: shows no-match message when nothing selected', () => {
  const report = buildTryReport('xyz', makeDepGraph([]), emptyCurated, {});
  assert.ok(formatTryOutput(report).includes('no objective-matched files'));
});

test('formatTryOutput: shows language names for known languages', () => {
  const depGraph = makeDepGraph([
    { id: 'src/a.ts', path: 'src/a.ts', language: 'typescript' },
    { id: 'main.go', path: 'main.go', language: 'go' },
  ]);
  const report = buildTryReport('irrelevant', depGraph, emptyCurated, {});
  const output = formatTryOutput(report);
  assert.ok(output.includes('TypeScript'), output);
  assert.ok(output.includes('Go'), output);
  assert.ok(output.includes('2 source files'), output);
});

test('formatTryOutput: excluded count shown when omits > 0', () => {
  const rules = [{ pattern: 'migrations/', reason: 'auto-generated', profiles: ['django'] }];
  const depGraph = makeDepGraph([
    { id: 'app/migrations/0001.ts', path: 'app/migrations/0001.ts' },
    { id: 'src/auth.ts', path: 'src/auth.ts' },
  ]);
  const report = buildTryReport('migrations auth', depGraph, emptyCurated, { rules });
  assert.ok(formatTryOutput(report).includes('profile exclusion'));
});

test('formatTryOutput: shows source size and clarifies it is raw source', () => {
  const depGraph = makeDepGraph([{ id: 'src/auth/middleware.ts', path: 'src/auth/middleware.ts' }]);
  const report = buildTryReport('auth middleware', depGraph, emptyCurated, {}, () => 8192);
  const output = formatTryOutput(report);
  assert.ok(output.includes('KB') || output.includes('bytes'), output);
  assert.ok(output.includes('raw source'), output);
  assert.ok(!output.includes('token budget'), output);
});

test('formatTryOutput: CTA shows three-step install flow', () => {
  const report = buildTryReport('auth', makeDepGraph([]), emptyCurated, {});
  const output = formatTryOutput(report);
  assert.ok(output.includes('--profile auto'), output);
  assert.ok(output.includes('--refresh-codegraph'), output);
  assert.ok(output.includes('--compile-context'), output);
});

test('formatTryOutput: CTA does not embed raw objective in shell command', () => {
  const dangerous = 'add $(rm -rf /) "auth"';
  const report = buildTryReport(dangerous, makeDepGraph([]), emptyCurated, {});
  const output = formatTryOutput(report);
  const ctaLine = output.split('\n').find((l) => l.includes('--compile-context')) ?? '';
  assert.ok(!ctaLine.includes('$(rm'), `Shell injection in CTA: ${ctaLine}`);
  assert.ok(!ctaLine.includes('"auth"'), `Raw objective embedded in CTA: ${ctaLine}`);
});

test('formatTryOutput: sanitizes objective even when called with manually constructed TryReport', () => {
  const report: TryReport = {
    objective: 'add\x00auth\x1b[31mred\x1b[0m',
    terms: [],
    languages: new Map(),
    totalFiles: 0,
    selected: [],
    omittedCount: 0,
    selectedSourceBytes: 0,
  };
  const output = formatTryOutput(report);
  const headerLine = output.split('\n')[0];
  assert.ok(!headerLine.includes('\x00'), 'null byte must be stripped from header');
  assert.ok(!headerLine.includes('\x1b'), 'ANSI escape must be stripped from header');
  assert.ok(headerLine.includes('auth'), 'safe portion of objective must be preserved');
});

test('formatTryOutput: control chars in path and reason are sanitized', () => {
  const unsafeNode: DependencyGraphNode = {
    id: 'src/a\x01b.ts',
    path: 'src/a\x01b.ts',
    hash: 'h'.repeat(64),
    exports: [],
    language: 'typescript',
  } as unknown as DependencyGraphNode;
  const unsafeSelected: SelectedContextNode = {
    node: unsafeNode,
    depth: 0,
    reason: 'seed: match\x00bad\nnewline',
    graphPath: 'src/a.ts',
  };
  const report: TryReport = {
    objective: 'auth',
    terms: ['auth'],
    languages: new Map([['typescript', 1]]),
    totalFiles: 1,
    selected: [unsafeSelected],
    omittedCount: 0,
    selectedSourceBytes: 0,
  };
  const output = formatTryOutput(report);
  const includedLine = output.split('\n').find((line) => line.includes('src/a b.ts'));
  assert.ok(includedLine !== undefined, 'selected file line must be present in output');
  assert.equal(includedLine?.includes('\x01'), false, 'control char in path must be stripped');
  assert.equal(includedLine?.includes('\x00'), false, 'null byte in reason must be stripped');
  assert.match(includedLine ?? '', /seed: match bad newline/);
});
