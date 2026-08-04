import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateNeedContext } from '../bin/lib/context-expansion.js';
import { cli, runTs, type ExecError } from './helpers.js';
import type {
  CompiledContextArtifact, DependencyGraph, NeedContextArtifact, ResolvedExclusionRule
} from '../bin/lib/types.js';

const rules: ResolvedExclusionRule[] = [
  { pattern: 'migrations/', reason: 'auto-generated migrations', profiles: ['django'] },
];

function depGraph(nodes: { id: string; path: string; exports?: string[] }[]): DependencyGraph {
  return {
    schema_version: 1,
    kind: 'forgeai_dependency_graph',
    generated_at: new Date().toISOString(),
    repository: { revision: null, fingerprint: 'f' },
    nodes: nodes.map((n) => ({ id: n.id, path: n.path, exports: n.exports ?? [], imports: [], hash: 'h' })),
    edges: [],
    settings: { extensions: ['.ts'], ignored_directories: [] }
  } as unknown as DependencyGraph;
}

function need(requests: NeedContextArtifact['requests']): NeedContextArtifact {
  return { kind: 'forgeai_need_context', schema_version: 1, artifact: 'p.json', requests } as NeedContextArtifact;
}

test('validateNeedContext rejects an excluded file request as profile_excluded', () => {
  const dg = depGraph([{ id: 'app/migrations/0001.ts', path: 'app/migrations/0001.ts' }]);
  const { valid, rejected } = validateNeedContext(
    need([{ kind: 'file', path: 'app/migrations/0001.ts', reason: 'inspect migration' }]),
    dg, null, rules, []
  );
  assert.equal(valid.length, 0);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason_code, 'profile_excluded');
  assert.equal(rejected[0].omitted?.pattern, 'migrations/');
});

test('--include-excluded allows an otherwise-excluded file request', () => {
  const dg = depGraph([{ id: 'app/migrations/0001.ts', path: 'app/migrations/0001.ts' }]);
  const { valid, rejected } = validateNeedContext(
    need([{ kind: 'file', path: 'app/migrations/0001.ts', reason: 'inspect migration' }]),
    dg, null, rules, ['**/migrations/**']
  );
  assert.equal(valid.length, 1);
  assert.equal(rejected.length, 0);
});

test('a symbol resolving to kept and excluded paths partially succeeds', () => {
  const dg = depGraph([
    { id: 'app/service.ts', path: 'app/service.ts', exports: ['helper'] },
    { id: 'app/migrations/util.ts', path: 'app/migrations/util.ts', exports: ['helper'] }
  ]);
  const { valid, rejected } = validateNeedContext(
    need([{ kind: 'symbol', name: 'helper', reason: 'need helper' }]),
    dg, null, rules, []
  );
  assert.deepEqual(valid.map((v) => v.path), ['app/service.ts']);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason_code, 'profile_excluded');
  assert.equal(rejected[0].omitted?.path, 'app/migrations/util.ts');
});

// End-to-end: an excluded expansion request is rejected and recorded as a
// profile_excluded escape under the django profile.
test('--expand-context rejects an excluded request and records a profile_excluded escape', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-excl-'));
  try {
    fs.mkdirSync(path.join(target, 'src', 'migrations'), { recursive: true });
    fs.writeFileSync(
      path.join(target, 'src', 'entry.ts'),
      'export function runCli() { return 1; }\n'
    );
    fs.writeFileSync(
      path.join(target, 'src', 'migrations', '0001_init.ts'),
      'export const seed = 1;\n'
    );
    runTs(cli, ['--profile', 'django'], { cwd: target });
    runTs(cli, ['--refresh-codegraph'], { cwd: target });

    const json = runTs(cli, ['--compile-context', '--task', 'TASK-20260802-x', '--objective', 'change runCli', '--budget', '4000'], { cwd: target });
    const primary = JSON.parse(json) as CompiledContextArtifact;
    const dir = path.join(target, '.ai', 'state', 'context');
    fs.mkdirSync(dir, { recursive: true });
    const artifactPath = path.join(dir, 'TASK-20260802-x.json');
    fs.writeFileSync(artifactPath, JSON.stringify(primary, null, 2) + '\n');

    const needContext = {
      kind: 'forgeai_need_context', schema_version: 1, artifact: artifactPath,
      requests: [{ kind: 'file', path: 'src/migrations/0001_init.ts', reason: 'inspect migration' }]
    };
    const needPath = path.join(dir, 'need.json');
    fs.writeFileSync(needPath, JSON.stringify(needContext, null, 2) + '\n');

    let failed = false;
    let combined = '';
    try {
      runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needPath], { cwd: target });
    } catch (error) {
      const e = error as ExecError;
      failed = true;
      combined = `${String(e.stdout ?? '')}${String(e.stderr ?? '')}`;
    }
    assert.equal(failed, true, 'expansion with only an excluded request should exit non-zero');
    assert.match(combined, /profile_excluded|excluded by/);

    // An escape event file should have been recorded for the task.
    const escapeDir = path.join(target, '.ai', 'state', 'context-escapes', 'TASK-20260802-x', 'events');
    const files = fs.existsSync(escapeDir) ? fs.readdirSync(escapeDir) : [];
    const events = files.filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(escapeDir, f), 'utf8')));
    assert.ok(
      events.some((ev) => ev.reason_code === 'profile_excluded'),
      'a profile_excluded escape event should be recorded'
    );

    const overrideJson = runTs(cli, [
      '--expand-context', '--artifact', artifactPath, '--need-context', needPath,
      '--budget', '4000', '--include-excluded', '**/migrations/**'
    ], { cwd: target });
    const override = JSON.parse(overrideJson) as CompiledContextArtifact;
    assert.ok(override.excerpts.some((excerpt) => excerpt.path === 'src/migrations/0001_init.ts'));
    assert.deepEqual(override.context_exclusions.include_globs, ['**/migrations/**']);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('an explicitly empty primary policy is not replaced by a later manifest profile', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-empty-policy-'));
  try {
    fs.mkdirSync(path.join(target, 'src', 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(target, 'src', 'entry.ts'), 'export function runCli() { return 1; }\n');
    fs.writeFileSync(path.join(target, 'src', 'migrations', '0001.ts'), 'export const seed = 1;\n');
    runTs(cli, [], { cwd: target });
    runTs(cli, ['--refresh-codegraph'], { cwd: target });

    const primary = JSON.parse(runTs(cli, [
      '--compile-context', '--objective', 'change runCli', '--budget', '4000'
    ], { cwd: target })) as CompiledContextArtifact;
    assert.deepEqual(primary.context_exclusions, { profiles: [], include_globs: [], rules: [] });

    const stateDir = path.join(target, '.ai', 'state', 'context');
    fs.mkdirSync(stateDir, { recursive: true });
    const artifactPath = path.join(stateDir, 'primary.json');
    fs.writeFileSync(artifactPath, JSON.stringify(primary, null, 2) + '\n');
    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.profile = 'django';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    const needPath = path.join(stateDir, 'need.json');
    fs.writeFileSync(needPath, JSON.stringify({
      kind: 'forgeai_need_context', schema_version: 1, artifact: artifactPath,
      requests: [{ kind: 'file', path: 'src/migrations/0001.ts', reason: 'inspect migration' }]
    }, null, 2) + '\n');

    const expansion = JSON.parse(runTs(cli, [
      '--expand-context', '--artifact', artifactPath, '--need-context', needPath, '--budget', '4000'
    ], { cwd: target })) as CompiledContextArtifact;
    assert.deepEqual(expansion.context_exclusions, { profiles: [], include_globs: [], rules: [] });
    assert.ok(expansion.excerpts.some((excerpt) => excerpt.path === 'src/migrations/0001.ts'));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
