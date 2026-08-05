import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompiledContextArtifact } from '../bin/lib/types.js';
import { cli, type ExecError, runTs } from './helpers.js';

function pyRepo(profile: string): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-py-ctx-'));
  runTs(cli, ['--profile', profile], { cwd: target });
  fs.mkdirSync(path.join(target, 'app'), { recursive: true });
  fs.writeFileSync(path.join(target, 'app', '__init__.py'), '');
  fs.writeFileSync(path.join(target, 'app', 'service.py'), 'def compute_total(items):\n    return sum(items)\n');
  return target;
}

function compile(target: string, args: string[]): { artifact?: CompiledContextArtifact; output: string; failed: boolean } {
  try {
    const output = runTs(cli, ['--compile-context', ...args], { cwd: target });
    return { artifact: JSON.parse(output) as CompiledContextArtifact, output, failed: false };
  } catch (error) {
    const e = error as ExecError;
    return { output: `${String(e.stdout ?? '')}${String(e.stderr ?? '')}`, failed: true };
  }
}

test('compiles a Python file into a full-body compact excerpt with a python fence', () => {
  const target = pyRepo('python-api');
  try {
    runTs(cli, ['--refresh-codegraph'], { cwd: target });
    // --markdown-output is only honored alongside --output, so write both to files
    // and read the artifact from disk (stdout is status lines in this mode).
    runTs(cli, ['--compile-context', '--objective', 'compute_total service', '--mode', 'compact', '--budget', '8000',
      '--output', '.ai/state/context/py.json', '--markdown-output', '.ai/state/context/py.md'], { cwd: target });
    const artifact = JSON.parse(fs.readFileSync(path.join(target, '.ai', 'state', 'context', 'py.json'), 'utf8')) as CompiledContextArtifact;
    const excerpt = artifact.excerpts.find((e) => e.path === 'app/service.py');
    assert.ok(excerpt, 'python excerpt present');
    assert.ok(excerpt!.content.includes('return sum(items)'), 'full body, not just signature');
    assert.match(fs.readFileSync(path.join(target, '.ai', 'state', 'context', 'py.md'), 'utf8'), /```python/, 'markdown uses a python fence');
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
});

test('baseline mode emits the whole Python file', () => {
  const target = pyRepo('python-api');
  try {
    runTs(cli, ['--refresh-codegraph'], { cwd: target });
    const { artifact } = compile(target, ['--objective', 'compute_total service', '--mode', 'baseline', '--budget', '8000']);
    const excerpt = artifact!.excerpts.find((e) => e.path === 'app/service.py')!;
    assert.equal(excerpt.mode, 'full');
    assert.ok(excerpt.content.includes('def compute_total'));
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
});

test('django migration .py is omitted in the compiled artifact; override restores the excerpt', () => {
  const target = pyRepo('django');
  try {
    fs.mkdirSync(path.join(target, 'app', 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(target, 'app', 'migrations', '__init__.py'), '');
    fs.writeFileSync(path.join(target, 'app', 'migrations', 'initial.py'), 'def migrate():\n    return 1\n');
    // service imports the migration so it is a graph neighbor of the seed
    fs.writeFileSync(path.join(target, 'app', 'service.py'), 'from .migrations.initial import migrate\ndef compute_total(items):\n    return migrate() + sum(items)\n');
    runTs(cli, ['--refresh-codegraph'], { cwd: target });

    const omitted = compile(target, ['--objective', 'migrate compute_total', '--budget', '8000']).artifact!;
    assert.ok(omitted.omitted_context.some((o) => o.path === 'app/migrations/initial.py' && o.pattern === 'migrations/'));
    // Excluded paths are filtered before selection, so they never reach the analyzer;
    // the observable proof is that no excerpt is ever produced from them.
    assert.equal(omitted.excerpts.some((e) => e.path.includes('migrations/')), false);

    const kept = compile(target, ['--objective', 'migrate compute_total', '--budget', '8000', '--include-excluded', '**/migrations/**']).artifact!;
    assert.ok(kept.excerpts.some((e) => e.path === 'app/migrations/initial.py'), 'override restores the excerpt');
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
});

// Writes a primary artifact to a file (expansion needs a file, and compile only
// writes files when --output is given; stdout is status lines in that mode).
function compilePrimary(target: string, taskId: string, objective: string): string {
  const rel = path.join('.ai', 'state', 'context', `${taskId}.json`);
  runTs(cli, ['--compile-context', '--task', taskId, '--objective', objective, '--budget', '8000', '--output', rel], { cwd: target });
  return path.join(target, rel);
}

test('expand-context succeeds for a non-excluded Python file, test, and symbol', () => {
  const target = pyRepo('python-api');
  try {
    // helper/test/symbols are NOT referenced by service.py and NOT named in the
    // primary objective, so none are already in the primary artifact — otherwise
    // expansion dedups candidates already present at full mode (see
    // test/context-expansion.test.ts) and the assertions below would be vacuous.
    fs.writeFileSync(path.join(target, 'app', 'helper.py'), 'def load_user(uid):\n    return uid\n');
    // Named/bodied with terms unrelated to the objective ('compute_total service')
    // so neither the path nor the declaration can match it into the primary
    // selection — otherwise expansion would dedup it and the assertion below would fail.
    fs.writeFileSync(path.join(target, 'app', 'test_health.py'), 'def test_health():\n    assert True\n');
    fs.writeFileSync(path.join(target, 'app', 'symbols.py'), 'def load_account(uid):\n    return uid\n');
    runTs(cli, ['--refresh-codegraph'], { cwd: target });
    const artifactPath = compilePrimary(target, 'TASK-20260805-ok', 'compute_total service');
    const needPath = path.join(target, '.ai', 'state', 'context', 'need.json');
    fs.writeFileSync(needPath, JSON.stringify({
      kind: 'forgeai_need_context', schema_version: 1, artifact: artifactPath,
      requests: [
        { kind: 'file', path: 'app/helper.py', reason: 'need helper' },
        { kind: 'test', path: 'app/test_health.py', reason: 'need test' },
        { kind: 'symbol', name: 'load_account', reason: 'need symbol' }
      ]
    }, null, 2) + '\n');
    const out = runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needPath, '--budget', '8000'], { cwd: target });
    const expansion = JSON.parse(out) as CompiledContextArtifact;
    const paths = expansion.excerpts.map((e) => e.path);
    assert.ok(paths.includes('app/helper.py'), 'file request');
    assert.ok(paths.includes('app/test_health.py'), 'test request');
    assert.ok(paths.includes('app/symbols.py'), 'symbol load_account resolves to app/symbols.py');
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
});

test('expand-context rejects an excluded Python request and records a profile_excluded escape', () => {
  const target = pyRepo('django');
  try {
    fs.mkdirSync(path.join(target, 'app', 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(target, 'app', 'migrations', '__init__.py'), '');
    fs.writeFileSync(path.join(target, 'app', 'migrations', '0002_data.py'), 'def run():\n    return 2\n');
    runTs(cli, ['--refresh-codegraph'], { cwd: target });
    const artifactPath = compilePrimary(target, 'TASK-20260805-x', 'compute_total service');
    const needPath = path.join(target, '.ai', 'state', 'context', 'need.json');
    fs.writeFileSync(needPath, JSON.stringify({
      kind: 'forgeai_need_context', schema_version: 1, artifact: artifactPath,
      requests: [{ kind: 'file', path: 'app/migrations/0002_data.py', reason: 'inspect migration' }]
    }, null, 2) + '\n');

    // Only an excluded request → command exits non-zero and writes no artifact;
    // the rejection surfaces on stderr and as a context-escape event file.
    let failed = false, combined = '';
    try {
      runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needPath], { cwd: target });
    } catch (error) {
      const e = error as ExecError;
      failed = true;
      combined = `${String(e.stdout ?? '')}${String(e.stderr ?? '')}`;
    }
    assert.equal(failed, true, 'expansion with only an excluded request should exit non-zero');
    assert.match(combined, /profile_excluded|excluded by/);

    const escapeDir = path.join(target, '.ai', 'state', 'context-escapes', 'TASK-20260805-x', 'events');
    const events = (fs.existsSync(escapeDir) ? fs.readdirSync(escapeDir) : [])
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(escapeDir, f), 'utf8')) as { reason_code?: string });
    assert.ok(events.some((ev) => ev.reason_code === 'profile_excluded'), 'a profile_excluded escape event is recorded');
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
});

test('a legacy graph lacking node.language still compiles', () => {
  const target = pyRepo('python-api');
  try {
    runTs(cli, ['--refresh-codegraph'], { cwd: target });
    const graphPath = path.join(target, '.ai', 'codegraph', 'dependency-graph.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as { nodes: Array<Record<string, unknown>> };
    for (const node of graph.nodes) delete node.language;
    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n');
    const { artifact, output } = compile(target, ['--objective', 'compute_total service', '--budget', '8000']);
    assert.ok(artifact, output);
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) { fs.rmSync(target, { recursive: true, force: true }); throw error; }
});
