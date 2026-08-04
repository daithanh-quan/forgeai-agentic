import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectContextForObjective } from '../bin/lib/context-pack.js';
import type { CodeGraph, DependencyGraph, ResolvedExclusionRule } from '../bin/lib/types.js';

const rules: ResolvedExclusionRule[] = [
  { pattern: 'migrations/', reason: 'auto-generated migrations', profiles: ['django'] },
];

function depGraph(
  nodes: { id: string; path: string }[],
  edges: { from: string; to: string }[] = []
): DependencyGraph {
  return {
    schema_version: 1,
    kind: 'forgeai_dependency_graph',
    generated_at: new Date().toISOString(),
    repository: { revision: null, fingerprint: 'f' },
    nodes: nodes.map((n) => ({ ...n, exports: [], imports: [], hash: 'h' })),
    edges: edges.map((e) => ({ ...e, kind: 'import', specifier: './x' })),
    settings: { extensions: ['.ts'], ignored_directories: [] }
  } as unknown as DependencyGraph;
}

const curated = { schema_version: 1, nodes: [] } as unknown as CodeGraph;

test('an excluded seed is omitted, not selected', () => {
  const dg = depGraph([{ id: 'app/migrations/0001.ts', path: 'app/migrations/0001.ts' }]);
  const sel = selectContextForObjective('migrations 0001', curated, dg, { rules, includeGlobs: [] });
  assert.equal(sel.selected.length, 0);
  assert.equal(sel.omitted.length, 1);
  assert.equal(sel.omitted[0].pattern, 'migrations/');
  assert.equal(sel.omitted[0].path, 'app/migrations/0001.ts');
  assert.deepEqual(sel.omitted[0].profiles, ['django']);
});

test('excluded high-ranked seeds do not consume the seed candidate limit', () => {
  const dg = depGraph([
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `migrations/target-${index}.ts`, path: `migrations/target-${index}.ts`
    })),
    { id: 'src/target.ts', path: 'src/target.ts' }
  ]);
  const sel = selectContextForObjective('target', curated, dg, { maxNodes: 1, rules, includeGlobs: [] });
  assert.deepEqual(sel.selected.map((entry) => entry.node.path), ['src/target.ts']);
  assert.equal(sel.omitted.length, 5);
});

test('--include-excluded keeps an otherwise-excluded seed', () => {
  const dg = depGraph([{ id: 'app/migrations/0001.ts', path: 'app/migrations/0001.ts' }]);
  const sel = selectContextForObjective('migrations 0001', curated, dg, {
    rules,
    includeGlobs: ['**/migrations/**']
  });
  assert.equal(sel.selected.length, 1);
  assert.equal(sel.omitted.length, 0);
});

test('an excluded neighbor is not selected and does not block an allowed sibling', () => {
  // seed -> excluded migration; seed -> allowed helper. Both are depth-1 neighbors.
  const dg = depGraph(
    [
      { id: 'app/service.ts', path: 'app/service.ts' },
      { id: 'app/migrations/0001.ts', path: 'app/migrations/0001.ts' },
      { id: 'app/helper.ts', path: 'app/helper.ts' }
    ],
    [
      { from: 'app/service.ts', to: 'app/migrations/0001.ts' },
      { from: 'app/service.ts', to: 'app/helper.ts' }
    ]
  );
  const sel = selectContextForObjective('service', curated, dg, { rules, includeGlobs: [] });
  const paths = sel.selected.map((s) => s.node.path).sort();
  assert.deepEqual(paths, ['app/helper.ts', 'app/service.ts']);
  assert.equal(sel.omitted.some((o) => o.path === 'app/migrations/0001.ts'), true);
});

test('no rules means nothing is omitted', () => {
  const dg = depGraph([{ id: 'app/migrations/0001.ts', path: 'app/migrations/0001.ts' }]);
  const sel = selectContextForObjective('migrations 0001', curated, dg, {});
  assert.equal(sel.selected.length, 1);
  assert.equal(sel.omitted.length, 0);
});
