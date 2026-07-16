import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

function writeGraph(target: string, generatedAt: string): void {
  fs.writeFileSync(
    path.join(target, '.ai', 'codegraph', 'graph.json'),
    JSON.stringify(
      {
        schema_version: 1,
        generated_at: generatedAt,
        source: 'test-fixture',
        repository: {
          name: 'fixture',
          root: '.',
          profile: 'base'
        },
        nodes: [
          {
            id: 'cli',
            path: 'bin/forgeai-init.ts',
            type: 'module',
            summary: 'CLI entrypoint and diagnostics',
            owners: [],
            entrypoints: ['forgeai-init'],
            public_contracts: ['CLI flags and output text'],
            dependencies: [],
            dependents: ['tests'],
            tags: ['typescript'],
            confidence: 'high'
          },
          {
            id: 'tests',
            path: 'test/*.test.ts',
            type: 'test-suite',
            summary: 'Node test coverage for CLI behavior',
            owners: [],
            entrypoints: [],
            public_contracts: [],
            dependencies: ['cli'],
            dependents: [],
            tags: ['test'],
            confidence: 'high'
          }
        ],
        edges: [
          {
            from: 'tests',
            to: 'cli',
            kind: 'validates',
            summary: 'Tests execute the CLI through tsx',
            confidence: 'high'
          }
        ]
      },
      null,
      2
    )
  );
}

function writeSourceFixture(target: string): void {
  fs.mkdirSync(path.join(target, 'bin', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(target, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(target, 'bin', 'forgeai-init.ts'),
    "import { formatDiagnostics } from './lib/diagnostics.js';\nexport const runCli = () => formatDiagnostics();\n"
  );
  fs.writeFileSync(
    path.join(target, 'bin', 'lib', 'diagnostics.ts'),
    "import { sharedValue } from './shared.js';\nexport const formatDiagnostics = () => sharedValue;\n"
  );
  fs.writeFileSync(path.join(target, 'bin', 'lib', 'shared.ts'), 'export const sharedValue = 42;\n');
  fs.writeFileSync(
    path.join(target, 'test', 'cli.test.ts'),
    "import { runCli } from '../bin/forgeai-init.js';\nexport const result = runCli();\n"
  );
  fs.writeFileSync(path.join(target, 'unrelated.ts'), 'export const unrelatedFeature = true;\n');
}

function refreshDependencyGraph(target: string): string {
  return runTs(cli, ['--refresh-codegraph'], { cwd: target });
}

function runContextPackCli(target: string, extraArgs: string[] = []): { output: string; failed: boolean } {
  try {
    const output = runTs(cli, ['--context-pack', ...extraArgs], { cwd: target });
    return { output, failed: false };
  } catch (error) {
    const execError = error as ExecError;
    return { output: `${String(execError.stdout ?? '')}${String(execError.stderr ?? '')}`, failed: true };
  }
}

test('codegraph check reports freshly installed template needs bootstrap', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-codegraph-template-'));

  try {
    runTs(cli, [], { cwd: target });

    const output = runTs(cli, ['--check-codegraph'], { cwd: target });

    assert.match(output, /ForgeAI CodeGraph check/);
    assert.match(output, /ok\s+\.ai\/codegraph\/README\.md/);
    assert.match(output, /ok\s+\.ai\/workflows\/codegraph-context\.md/);
    assert.match(output, /needs bootstrap\s+\.ai\/codegraph\/graph\.json still contains template TODOs/);
    assert.match(output, /Result: CodeGraph installed, but repository graph still needs bootstrap\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('codegraph check validates populated graph metadata and edges', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-codegraph-valid-'));

  try {
    runTs(cli, [], { cwd: target });
    writeGraph(target, new Date().toISOString().slice(0, 10));
    writeSourceFixture(target);
    refreshDependencyGraph(target);

    const output = runTs(cli, ['--check-codegraph'], { cwd: target });

    assert.match(output, /ok\s+schema_version: 1/);
    assert.match(output, /ok\s+2 graph nodes/);
    assert.match(output, /ok\s+1 graph edge/);
    assert.match(output, /ok\s+5 dependency graph nodes/);
    assert.match(output, /Result: CodeGraph is usable for graph-guided context selection\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('context-pack emits relevant CodeGraph nodes for an objective', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-pack-'));

  try {
    runTs(cli, [], { cwd: target });
    writeGraph(target, new Date().toISOString().slice(0, 10));
    writeSourceFixture(target);
    refreshDependencyGraph(target);

    const { output, failed } = runContextPackCli(target, ['--objective', 'change runCli implementation']);

    assert.equal(failed, false);
    assert.match(output, /CodeGraph Context Pack/);
    assert.match(output, /Objective: change runCli implementation/);
    assert.match(output, /\| bin\/forgeai-init\.ts \| 0 \| seed:/);
    assert.match(output, /\| bin\/lib\/diagnostics\.ts \| 1 \| dependency of bin\/forgeai-init\.ts/);
    assert.match(output, /\| test\/cli\.test\.ts \| 1 \| test validating bin\/forgeai-init\.ts/);
    assert.doesNotMatch(output, /unrelated\.ts \|/);
    assert.match(output, /Required Files to Read Before Editing/);
    assert.match(output, /Context Budget/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('context-pack does not select high-confidence nodes when the objective does not match', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-pack-no-match-'));

  try {
    runTs(cli, [], { cwd: target });
    writeGraph(target, new Date().toISOString().slice(0, 10));
    writeSourceFixture(target);
    refreshDependencyGraph(target);

    const { output, failed } = runContextPackCli(target, ['--objective', 'migrate database schema']);

    assert.equal(failed, false);
    assert.match(output, /\| none \| n\/a \| no objective-matched source seed \| n\/a \|/);
    assert.match(output, /No source node matched the objective/);
    assert.doesNotMatch(output, /bin\/forgeai-init\.ts/);
    assert.doesNotMatch(output, /test\/\*\.test\.ts/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('context-pack writes output to a file', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-pack-file-'));

  try {
    runTs(cli, [], { cwd: target });
    writeGraph(target, new Date().toISOString().slice(0, 10));
    writeSourceFixture(target);
    refreshDependencyGraph(target);

    const outputFile = '.ai/codegraph/context-packs/cli-diagnostics.md';
    const { failed } = runContextPackCli(target, ['--objective', 'update CLI diagnostics', '--output', outputFile]);

    assert.equal(failed, false);
    const written = fs.readFileSync(path.join(target, outputFile), 'utf8');
    assert.match(written, /CodeGraph Context Pack/);
    assert.match(written, /bin\/forgeai-init\.ts/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('context-pack does not silently create a missing dependency graph', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-pack-template-'));

  try {
    runTs(cli, [], { cwd: target });

    const { output, failed } = runContextPackCli(target, ['--objective', 'update CLI diagnostics']);

    assert.equal(failed, true);
    assert.match(output, /dependency graph is missing/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('context-pack works from generated source evidence before curated graph bootstrap', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-pack-generated-only-'));

  try {
    runTs(cli, [], { cwd: target });
    writeSourceFixture(target);
    refreshDependencyGraph(target);

    const { output, failed } = runContextPackCli(target, ['--objective', 'change runCli implementation']);

    assert.equal(failed, false);
    assert.match(output, /bin\/forgeai-init\.ts/);
    assert.match(output, /bin\/lib\/diagnostics\.ts/);
    assert.match(output, /test\/cli\.test\.ts/);
    assert.doesNotMatch(output, /template TODO/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('refresh-codegraph parses static, dynamic, re-export, and require edges', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dependency-refresh-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'shared.ts'), 'export const shared = true;\n');
    fs.writeFileSync(path.join(target, 'src', 'lazy.ts'), 'export const lazy = true;\n');
    fs.writeFileSync(path.join(target, 'src', 'legacy.cjs'), 'module.exports = true;\n');
    fs.writeFileSync(
      path.join(target, 'src', 'component.tsx'),
      "import { shared } from './shared.js';\nexport const Component = () => <div>{String(shared)}</div>;\n"
    );
    fs.writeFileSync(
      path.join(target, 'src', 'entry.ts'),
      [
        "import { shared } from './shared.js';",
        "export { shared as publicShared } from './shared.js';",
        "const lazy = import('./lazy.js');",
        "const legacy = require('./legacy.cjs');",
        "import React from 'react';",
        "// require('./ignored.cjs');",
        "const pattern = /require\\('.\\/also-ignored.cjs'\\)/;",
        'export { lazy, legacy, shared };',
        ''
      ].join('\n')
    );

    const output = refreshDependencyGraph(target);
    const graph = JSON.parse(fs.readFileSync(path.join(target, '.ai', 'codegraph', 'dependency-graph.json'), 'utf8')) as {
      nodes: Array<{ path: string; hash: string; exports: string[] }>;
      edges: Array<{ from: string; to: string; kind: string }>;
      unresolved: Array<{ specifier: string; reason: string }>;
    };

    assert.match(output, /5 source files/);
    assert.deepEqual(
      graph.edges.map((edge) => [edge.from, edge.to, edge.kind]),
      [
        ['src/component.tsx', 'src/shared.ts', 'static_import'],
        ['src/entry.ts', 'src/lazy.ts', 'dynamic_import'],
        ['src/entry.ts', 'src/legacy.cjs', 'require'],
        ['src/entry.ts', 'src/shared.ts', 'static_import']
      ]
    );
    assert.equal(graph.nodes.every((node) => /^[a-f0-9]{64}$/.test(node.hash)), true);
    assert.equal(graph.unresolved.some((entry) => entry.specifier === 'react' && entry.reason === 'external_package'), true);
    assert.equal(graph.unresolved.some((entry) => entry.specifier.includes('ignored')), false);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('refresh-codegraph keeps the previous graph when parsing fails', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dependency-atomic-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(path.join(target, 'entry.ts'), 'export const valid = true;\n');
    refreshDependencyGraph(target);
    const graphPath = path.join(target, '.ai', 'codegraph', 'dependency-graph.json');
    const previous = fs.readFileSync(graphPath, 'utf8');
    fs.writeFileSync(path.join(target, 'entry.ts'), "import { broken from './missing.js';\n");

    assert.throws(
      () => refreshDependencyGraph(target),
      (error: unknown) => {
        assert.match(String((error as ExecError).stderr ?? ''), /refresh failed/);
        return true;
      }
    );
    assert.equal(fs.readFileSync(graphPath, 'utf8'), previous);
    assert.equal(fs.readdirSync(path.dirname(graphPath)).some((file) => file.includes('.tmp-')), false);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('context-pack refuses a stale dependency graph after source changes', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-pack-stale-source-'));

  try {
    runTs(cli, [], { cwd: target });
    writeGraph(target, new Date().toISOString().slice(0, 10));
    writeSourceFixture(target);
    refreshDependencyGraph(target);
    fs.appendFileSync(path.join(target, 'bin', 'forgeai-init.ts'), 'export const changedAfterRefresh = true;\n');

    const { output, failed } = runContextPackCli(target, ['--objective', 'update CLI diagnostics']);

    assert.equal(failed, true);
    assert.match(output, /dependency graph is stale/);
    assert.match(output, /source file set or contents changed/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('context-pack enforces traversal depth and node bounds', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-pack-bounds-'));

  try {
    runTs(cli, [], { cwd: target });
    writeGraph(target, new Date().toISOString().slice(0, 10));
    writeSourceFixture(target);
    refreshDependencyGraph(target);

    const depthZero = runContextPackCli(target, [
      '--objective', 'update CLI diagnostics', '--max-depth', '0', '--max-nodes', '2'
    ]);
    assert.equal(depthZero.failed, false);
    assert.match(depthZero.output, /Traversal bounds: depth 0, nodes 2/);
    assert.match(depthZero.output, /bin\/forgeai-init\.ts/);
    assert.doesNotMatch(depthZero.output, /bin\/lib\/diagnostics\.ts \|/);

    const invalid = runContextPackCli(target, ['--objective', 'update CLI diagnostics', '--max-nodes', '0']);
    assert.equal(invalid.failed, true);
    assert.match(invalid.output, /--max-nodes must be between 1 and 50/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('codegraph check rejects stale graph metadata', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-codegraph-stale-'));

  try {
    runTs(cli, [], { cwd: target });
    writeGraph(target, '2000-01-01');
    writeSourceFixture(target);
    refreshDependencyGraph(target);

    assert.throws(
      () => runTs(cli, ['--check-codegraph'], { cwd: target }),
      (error: unknown) => {
        const execError = error as ExecError;
        const stdout = String(execError.stdout ?? '');
        assert.match(stdout, /stale\s+generated_at: 2000-01-01/);
        assert.match(stdout, /Result: CodeGraph needs fixes before graph-guided context selection is reliable\./);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('codegraph check --strict exits non-zero on a template graph', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-codegraph-strict-'));

  try {
    runTs(cli, [], { cwd: target });

    assert.throws(
      () => runTs(cli, ['--check-codegraph', '--strict'], { cwd: target }),
      (error: unknown) => {
        const stdout = String((error as ExecError).stdout ?? '');
        assert.match(stdout, /still contains template TODOs/);
        assert.match(stdout, /Result: CodeGraph installed, but repository graph still needs bootstrap\./);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('codegraph check without --strict stays exit 0 on a template graph', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-codegraph-nonstrict-'));

  try {
    runTs(cli, [], { cwd: target });

    const output = runTs(cli, ['--check-codegraph'], { cwd: target });

    assert.match(output, /Result: CodeGraph installed, but repository graph still needs bootstrap\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('codegraph check flags a half-filled graph whose summary is still TODO', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-codegraph-half-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, '.ai', 'codegraph', 'graph.json'),
      JSON.stringify({
        schema_version: 1,
        generated_at: new Date().toISOString().slice(0, 10),
        source: 'test-fixture',
        repository: { name: 'fixture', root: '.', profile: 'base' },
        nodes: [
          { id: 'cli', path: 'bin/forgeai-init.ts', type: 'module', summary: 'TODO: what this area owns', confidence: 'high' }
        ],
        edges: []
      })
    );

    let output = '';
    try {
      output = runTs(cli, ['--check-codegraph'], { cwd: target });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }

    assert.match(output, /still contains template TODOs/);
    assert.doesNotMatch(output, /Result: CodeGraph is usable/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('refresh-codegraph stores declaration names including non-exported symbols', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-declarations-stored-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(target, 'src', 'handler.ts'),
      [
        'export function publicApi() { return handleRequest(); }',
        'function handleRequest() { return 42; }',
        'class Router { get() {} post() {} }',
        ''
      ].join('\n')
    );
    refreshDependencyGraph(target);

    const graph = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'codegraph', 'dependency-graph.json'), 'utf8')
    ) as { nodes: Array<{ path: string; exports: string[]; declarations?: string[] }> };

    const node = graph.nodes.find((n) => n.path === 'src/handler.ts');
    assert.ok(node, 'handler.ts node must exist');
    assert.deepEqual(node.exports, ['publicApi'], 'exports must contain only exported names');
    assert.ok(Array.isArray(node.declarations), 'declarations must be an array');
    assert.ok(node.declarations!.includes('publicApi'), 'declarations must include exported function');
    assert.ok(node.declarations!.includes('handleRequest'), 'declarations must include non-exported function');
    assert.ok(node.declarations!.includes('Router'), 'declarations must include class name');
    assert.ok(node.declarations!.includes('get'), 'declarations must include class method names');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('context-pack seeds on non-exported declaration name', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-declarations-seed-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(target, 'src', 'handler.ts'),
      'export function publicApi() {}\nfunction handleRequest() {}\n'
    );
    fs.writeFileSync(path.join(target, 'src', 'unrelated.ts'), 'export const x = 1;\n');
    refreshDependencyGraph(target);

    const { output, failed } = runContextPackCli(target, ['--objective', 'fix handleRequest routing']);

    assert.equal(failed, false);
    assert.match(output, /src\/handler\.ts/);
    assert.match(output, /declaration name match/);
    assert.doesNotMatch(output, /src\/unrelated\.ts \|/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('context-pack declaration match uses exact name not substring', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-declarations-exact-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    // "resetState" must NOT match term "set" — substring must be rejected
    fs.writeFileSync(path.join(target, 'src', 'state.ts'), 'function resetState() {}\n');
    fs.writeFileSync(path.join(target, 'src', 'unrelated.ts'), 'export const x = 1;\n');
    refreshDependencyGraph(target);

    const { output, failed } = runContextPackCli(target, ['--objective', 'set the value']);

    assert.equal(failed, false);
    // "set" must not substring-match "resetState"
    assert.doesNotMatch(output, /src\/state\.ts \|/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('context-pack declaration match caps at +1 per node regardless of how many members match', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-declarations-cap-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    // Router has 6 method names that each match a term in the objective.
    // Without cap: declaration score = 6, beating configure.ts path score of 3.
    // With cap:    declaration score = 1, losing to configure.ts path score of 3.
    fs.writeFileSync(
      path.join(target, 'src', 'router.ts'),
      'class Router { configure() {} get() {} post() {} put() {} delete() {} patch() {} }\n'
    );
    // configure.ts has "configure" in its path → path match score 3
    fs.writeFileSync(path.join(target, 'src', 'configure.ts'), 'export const x = 1;\n');
    refreshDependencyGraph(target);

    const { output, failed } = runContextPackCli(target, [
      '--objective', 'configure get post put delete patch'
    ]);

    assert.equal(failed, false);
    const configureIndex = output.indexOf('src/configure.ts');
    const routerIndex = output.indexOf('src/router.ts');
    assert.ok(configureIndex !== -1, 'configure.ts must be selected');
    assert.ok(routerIndex !== -1, 'router.ts must be selected');
    // configure.ts must rank before router.ts (path score 3 > capped declaration score 1)
    assert.ok(configureIndex < routerIndex, 'configure.ts (path match) must rank before router.ts (declarations only)');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('codegraph check rejects a generated_at date in the future', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-codegraph-future-'));

  try {
    runTs(cli, [], { cwd: target });
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    writeGraph(target, future);

    assert.throws(
      () => runTs(cli, ['--check-codegraph'], { cwd: target }),
      (error: unknown) => {
        const stdout = String((error as ExecError).stdout ?? '');
        assert.match(stdout, /future/i);
        assert.match(stdout, /Result: CodeGraph needs fixes/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
