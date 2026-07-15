import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompiledContextArtifact, ResolvedContextRequest } from '../bin/lib/types.js';
import { cli, runTs } from './helpers.js';

function writeNeedContext(
  target: string,
  artifactPath: string,
  requests: Array<{ kind: string; name?: string; path?: string; reason: unknown }>
): string {
  const needContext = {
    kind: 'forgeai_need_context',
    schema_version: 1,
    artifact: artifactPath,
    requests
  };
  const dir = path.join(target, '.ai', 'state', 'context');
  fs.mkdirSync(dir, { recursive: true });
  const needContextPath = path.join(dir, 'TASK-01-need-context.json');
  fs.writeFileSync(needContextPath, JSON.stringify(needContext, null, 2) + '\n');
  return needContextPath;
}

function buildFixture(target: string): void {
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.mkdirSync(path.join(target, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(target, 'src', 'auth.ts'),
    'export function login(user: string) { return internalCheck(user); }\nfunction internalCheck(u: string) { return u.length > 0; }\n'
  );
  fs.writeFileSync(
    path.join(target, 'test', 'auth.test.ts'),
    "import test from 'node:test';\ntest('login works', () => {});\n"
  );
  runTs(cli, [], { cwd: target });
  runTs(cli, ['--refresh-codegraph'], { cwd: target });
}

function compile(target: string, objective: string, budget = 4000): CompiledContextArtifact {
  const json = runTs(cli, ['--compile-context', '--objective', objective, '--budget', String(budget)], { cwd: target });
  return JSON.parse(json) as CompiledContextArtifact;
}

test('--expand-context produces supplemental artifact for file request', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-cli-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    const artifactPath = path.join(target, '.ai', 'state', 'context', 'TASK-01.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(primary, null, 2) + '\n');
    const needContextPath = writeNeedContext(target, artifactPath, [
      { kind: 'file', path: 'src/auth.ts', reason: 'need private helper' }
    ]);
    const outputPath = path.join(target, '.ai', 'state', 'context', 'TASK-01-expansion-1.json');
    runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needContextPath, '--output', outputPath], { cwd: target });
    assert.ok(fs.existsSync(outputPath));
    const expansion = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as CompiledContextArtifact;
    assert.equal(expansion.kind, 'forgeai_compiled_context');
    assert.match(expansion.objective, /\[expansion\]/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--expand-context exits 1 when all candidates deduplicate against primary', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-dedup-'));
  try {
    buildFixture(target);
    // Primary already captures 'login' at full mode since 'login function' is the objective
    const primary = compile(target, 'login function', 4000);
    const artifactPath = path.join(target, '.ai', 'state', 'context', 'TASK-01.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(primary, null, 2) + '\n');
    // Request the 'login' symbol which is already in primary at full mode — expansion produces 0 excerpts
    const needContextPath = writeNeedContext(target, artifactPath, [
      { kind: 'symbol', name: 'login', reason: 'already in primary at full mode' }
    ]);
    let threw = false;
    try {
      runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needContextPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('expansion sends full body when primary only has signature mode', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-sig-upgrade-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    // Find a full excerpt and force it to signature mode in primary
    const targetExcerpt = primary.excerpts.find((e) => e.mode === 'full' && e.kind !== 'import');
    assert.ok(targetExcerpt, 'fixture must contain a full non-import excerpt');
    const modifiedPrimary = {
      ...primary,
      excerpts: primary.excerpts.map((e) =>
        e === targetExcerpt ? { ...e, mode: 'signature' as const } : e
      )
    };
    // Recompute estimated_tokens for modified primary
    const { computeArtifactEstimate } = await import('../bin/lib/context-compiler.js');
    modifiedPrimary.budget.estimated_tokens = computeArtifactEstimate(modifiedPrimary as CompiledContextArtifact);
    const artifactPath = path.join(target, '.ai', 'state', 'context', 'TASK-01.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(modifiedPrimary, null, 2) + '\n');
    const needContextPath = writeNeedContext(target, artifactPath, [
      { kind: 'symbol', name: targetExcerpt.name, reason: 'need full implementation' }
    ]);
    const output = runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needContextPath], { cwd: target });
    const expansion = JSON.parse(output) as CompiledContextArtifact;
    const fullExcerpt = expansion.excerpts.find((e) => e.name === targetExcerpt.name);
    assert.ok(fullExcerpt, `expected ${targetExcerpt.name} in expansion excerpts`);
    assert.equal(fullExcerpt?.mode, 'full');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('file and test requests for same path are treated independently and deterministically', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-dedup-kind-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    const { compileContextExpansion } = await import('../bin/lib/context-compiler.js');
    const { readCuratedCodeGraph } = await import('../bin/lib/context-pack.js');
    const { readDependencyGraph } = await import('../bin/lib/dependency-graph.js');
    const curatedGraph = readCuratedCodeGraph(target);
    const depGraph = readDependencyGraph(target);
    const requests: ResolvedContextRequest[] = [
      { requestKind: 'file', path: 'test/auth.test.ts', reason: 'need test file' },
      { requestKind: 'test', path: 'test/auth.test.ts', reason: 'need test declarations' }
    ];
    const expansion1 = compileContextExpansion(primary, requests, curatedGraph, depGraph!, target, { budget: 4000 });
    const expansion2 = compileContextExpansion(primary, requests, curatedGraph, depGraph!, target, { budget: 4000 });
    // Results must be identical across runs
    assert.deepEqual(
      expansion1.excerpts.map((e) => `${e.path}:${e.source_start_line}:${e.kind}`),
      expansion2.excerpts.map((e) => `${e.path}:${e.source_start_line}:${e.kind}`)
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('compileContextExpansion includes file request declarations regardless of export status', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-compiler-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    const { compileContextExpansion } = await import('../bin/lib/context-compiler.js');
    const { readCuratedCodeGraph } = await import('../bin/lib/context-pack.js');
    const { readDependencyGraph, checkDependencyGraphHealth } = await import('../bin/lib/dependency-graph.js');
    const curatedGraph = readCuratedCodeGraph(target);
    const depGraph = readDependencyGraph(target);
    const requests: ResolvedContextRequest[] = [
      { requestKind: 'file', path: 'src/auth.ts', reason: 'need private helper' }
    ];
    const expansion = compileContextExpansion(primary, requests, curatedGraph, depGraph!, target, { budget: 4000 });
    assert.equal(expansion.kind, 'forgeai_compiled_context');
    assert.match(expansion.objective, /\[expansion\]/);
    // expansion should contain internalCheck (not exported, not objective-matching in primary)
    const names = expansion.excerpts.map((e) => e.name);
    assert.ok(names.includes('internalCheck'), `expected internalCheck in expansion excerpts, got: ${names.join(', ')}`);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--expand-context with non-.json output writes two distinct files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-output-ext-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    const artifactPath = path.join(target, '.ai', 'state', 'context', 'TASK-01.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(primary, null, 2) + '\n');
    const needContextPath = writeNeedContext(target, artifactPath, [
      { kind: 'file', path: 'src/auth.ts', reason: 'need private helper' }
    ]);
    const outputPath = path.join(target, '.ai', 'state', 'context', 'TASK-01-expansion.out');
    runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needContextPath, '--output', outputPath], { cwd: target });
    const jsonPath = outputPath;
    const mdPath = `${outputPath}.md`;
    assert.ok(fs.existsSync(jsonPath), 'JSON output must exist');
    assert.ok(fs.existsSync(mdPath), 'Markdown sidecar must exist');
    assert.notEqual(jsonPath, mdPath);
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as CompiledContextArtifact;
    assert.equal(json.kind, 'forgeai_compiled_context');
    assert.ok(fs.readFileSync(mdPath, 'utf8').includes('ForgeAI Compiled Context'));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--expand-context rejects --output and --markdown-output pointing to same path', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-same-path-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    const artifactPath = path.join(target, '.ai', 'state', 'context', 'TASK-01.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(primary, null, 2) + '\n');
    const needContextPath = writeNeedContext(target, artifactPath, [
      { kind: 'file', path: 'src/auth.ts', reason: 'need private helper' }
    ]);
    const sharedPath = path.join(target, '.ai', 'state', 'context', 'out.json');
    let threw = false;
    try {
      runTs(cli, [
        '--expand-context', '--artifact', artifactPath, '--need-context', needContextPath,
        '--output', sharedPath, '--markdown-output', sharedPath
      ], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'must exit non-zero when JSON and Markdown paths collide');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('all candidates dominated throws NoNewContextError regardless of budget', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-nocontext-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    const { compileContextExpansion, NoNewContextError } = await import('../bin/lib/context-compiler.js');
    const { tryReadCuratedCodeGraph } = await import('../bin/lib/context-pack.js');
    const { readDependencyGraph } = await import('../bin/lib/dependency-graph.js');
    const curatedGraph = tryReadCuratedCodeGraph(target);
    const depGraph = readDependencyGraph(target)!;
    // 'login' is in primary at full mode — expansion candidate is fully dominated
    const requests: ResolvedContextRequest[] = [
      { requestKind: 'symbol', path: 'src/auth.ts', symbol: 'login', reason: 'need login' }
    ];
    // Use a budget so tiny it would trigger base-overhead ContextBudgetError if NoNewContextError
    // were not thrown first — verifying Fix 3 ordering
    assert.throws(
      () => compileContextExpansion(primary, requests, curatedGraph, depGraph, target, { budget: 256 }),
      (err: unknown) => err instanceof NoNewContextError
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('invalid reason type per item is rejected; valid sibling still processed', async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-reason-'));
  try {
    buildFixture(target);
    const { validateNeedContext } = await import('../bin/lib/context-expansion.js');
    const { tryReadCuratedCodeGraph } = await import('../bin/lib/context-pack.js');
    const { readDependencyGraph } = await import('../bin/lib/dependency-graph.js');
    const curatedGraph = tryReadCuratedCodeGraph(target);
    const depGraph = readDependencyGraph(target)!;
    const request = {
      kind: 'forgeai_need_context' as const,
      schema_version: 1 as const,
      artifact: 'some-artifact.json',
      requests: [
        { kind: 'file', path: 'src/auth.ts', reason: 42 },   // bad reason
        { kind: 'file', path: 'src/auth.ts', reason: 'need impl' }  // valid
      ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const { valid, rejected } = validateNeedContext(request, depGraph, curatedGraph);
    assert.equal(rejected.length, 1, 'one item should be rejected');
    assert.match(rejected[0]!.reason, /reason/);
    assert.equal(valid.length, 1, 'valid sibling must still be processed');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('source hash mismatch in expansion is rejected with exit 1', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-hash-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    const artifactPath = path.join(target, '.ai', 'state', 'context', 'TASK-01.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(primary, null, 2) + '\n');
    // Modify src/auth.ts AFTER the dependency graph was built — now hash is stale
    fs.writeFileSync(
      path.join(target, 'src', 'auth.ts'),
      'export function login(user: string) { return user !== ""; }\n// modified\n'
    );
    const needContextPath = writeNeedContext(target, artifactPath, [
      { kind: 'file', path: 'src/auth.ts', reason: 'need impl after edit' }
    ]);
    let threw = false;
    try {
      runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needContextPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'must exit non-zero when source hash mismatches the dependency graph');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--expand-context works when curated graph is absent (uses dep graph exports)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-expand-nocurated-'));
  try {
    buildFixture(target);
    const primary = compile(target, 'login function', 4000);
    // Remove the curated graph so tryReadCuratedCodeGraph returns null silently
    const graphPath = path.join(target, '.ai', 'codegraph', 'graph.json');
    if (fs.existsSync(graphPath)) fs.rmSync(graphPath);
    const artifactPath = path.join(target, '.ai', 'state', 'context', 'TASK-01.json');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(primary, null, 2) + '\n');
    // Request a file — no curated graph needed for file requests
    const needContextPath = writeNeedContext(target, artifactPath, [
      { kind: 'file', path: 'src/auth.ts', reason: 'need private helper' }
    ]);
    const output = runTs(cli, ['--expand-context', '--artifact', artifactPath, '--need-context', needContextPath], { cwd: target });
    const expansion = JSON.parse(output) as CompiledContextArtifact;
    assert.equal(expansion.kind, 'forgeai_compiled_context');
    assert.match(expansion.objective, /\[expansion\]/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
