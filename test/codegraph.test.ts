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

    const output = runTs(cli, ['--check-codegraph'], { cwd: target });

    assert.match(output, /ok\s+schema_version: 1/);
    assert.match(output, /ok\s+2 graph nodes/);
    assert.match(output, /ok\s+1 graph edge/);
    assert.match(output, /Result: CodeGraph is usable for graph-guided context selection\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('codegraph check rejects stale graph metadata', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-codegraph-stale-'));

  try {
    runTs(cli, [], { cwd: target });
    writeGraph(target, '2000-01-01');

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
