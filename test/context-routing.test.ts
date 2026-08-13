import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompiledContextArtifact } from '../bin/lib/types.js';
import { cli, type ExecError, runTs } from './helpers.js';
import { validateArtifact } from '../bin/lib/router.js';
import { computeArtifactEstimate } from '../bin/lib/context-compiler.js';
import { generateDependencyGraph, readDependencyGraph, DEPENDENCY_GRAPH_PATH, checkDependencyGraphHealth } from '../bin/lib/dependency-graph.js';

function initAndCompile(target: string, objective = 'change runCli implementation'): CompiledContextArtifact {
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.writeFileSync(path.join(target, 'src', 'entry.ts'), 'export function runCli() { return 42; }\n');
  runTs(cli, [], { cwd: target });
  runTs(cli, ['--refresh-codegraph'], { cwd: target });
  const json = runTs(cli, ['--compile-context', '--objective', objective, '--budget', '4000'], { cwd: target });
  return JSON.parse(json) as CompiledContextArtifact;
}

function writeArtifact(target: string, artifact: CompiledContextArtifact): string {
  const dir = path.join(target, '.ai', 'state', 'context');
  fs.mkdirSync(dir, { recursive: true });
  const artifactPath = path.join(dir, 'TASK-01.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');
  return artifactPath;
}

test('--validate-artifact exits 0 for a fresh valid artifact', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    // Success message goes to stderr; runTs returns stdout. Assert no exception thrown.
    runTs(cli, ['--validate-artifact', '--artifact', artifactPath], { cwd: target });
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('validateArtifact accepts a legacy artifact and attaches exclusion defaults', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-legacy-excl-'));
  try {
    const artifact = initAndCompile(target);
    // Simulate a pre-3.11.0 artifact: strip the additive fields, then recompute the
    // estimate against that legacy shape (matching how such a file was written).
    const legacy = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    delete legacy.context_exclusions;
    delete legacy.omitted_context;
    legacy.budget = { ...(legacy.budget as object) };
    (legacy.budget as Record<string, unknown>).estimated_tokens =
      computeArtifactEstimate(legacy as unknown as CompiledContextArtifact);
    const artifactPath = writeArtifact(target, legacy as unknown as CompiledContextArtifact);

    const result = validateArtifact(artifactPath, target);
    assert.equal(result.status, 'ok', JSON.stringify(result));
    if (result.status === 'ok') {
      assert.deepEqual(result.artifact.context_exclusions, { profiles: [], include_globs: [], rules: [] });
      assert.deepEqual(result.artifact.omitted_context, []);
    }
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--validate-artifact exits 1 for wrong kind', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-kind-'));
  try {
    const artifact = initAndCompile(target);
    (artifact as Record<string, unknown>).kind = 'wrong';
    const artifactPath = writeArtifact(target, artifact);
    let threw = false;
    try {
      runTs(cli, ['--validate-artifact', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'expected non-zero exit');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--validate-artifact exits 1 for out-of-bounds limit_tokens', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-bounds-'));
  try {
    const artifact = initAndCompile(target);
    artifact.budget.limit_tokens = 10_000_000;
    // Set estimated_tokens very large so both the bounds check and token check will catch it
    artifact.budget.estimated_tokens = 9_999_999;
    const artifactPath = writeArtifact(target, artifact);
    let threw = false;
    try {
      runTs(cli, ['--validate-artifact', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--validate-artifact exits 1 for stale artifact (fingerprint mismatch)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-stale-'));
  try {
    const artifact = initAndCompile(target);
    // Add a new source file to change fingerprint, then refresh graph
    fs.writeFileSync(path.join(target, 'src', 'new.ts'), 'export const x = 1;\n');
    runTs(cli, ['--refresh-codegraph'], { cwd: target });
    // Artifact still has old fingerprint
    const artifactPath = writeArtifact(target, artifact);
    let threw = false;
    try {
      runTs(cli, ['--validate-artifact', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--route without --adapter writes JSON to stdout', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-stdout-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const output = runTs(cli, ['--route', '--artifact', artifactPath], { cwd: target });
    const routed = JSON.parse(output) as CompiledContextArtifact;
    assert.equal(routed.kind, 'forgeai_compiled_context');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--route writes journal entry on stdout routing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-journal-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    runTs(cli, ['--route', '--artifact', artifactPath], { cwd: target });
    const journalPath = path.join(target, '.ai', 'state', 'context-routes.md');
    assert.ok(fs.existsSync(journalPath), 'journal file should be created');
    const journal = fs.readFileSync(journalPath, 'utf8');
    assert.match(journal, /Status: ok/);
    assert.match(journal, /Adapter: stdout/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--validate-artifact rejects artifact with falsified estimated_tokens', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-falsified-'));
  try {
    const artifact = initAndCompile(target);
    // Falsify the token estimate
    artifact.budget.estimated_tokens = artifact.budget.estimated_tokens + 999;
    const artifactPath = writeArtifact(target, artifact);
    let threw = false;
    try {
      runTs(cli, ['--validate-artifact', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'should reject artifact with falsified estimated_tokens');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--route exits 1 for invalid artifact before any adapter is invoked', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-invalid-'));
  try {
    const artifact = initAndCompile(target);
    (artifact as Record<string, unknown>).kind = 'bad';
    const artifactPath = writeArtifact(target, artifact);
    let threw = false;
    try {
      runTs(cli, ['--route', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw);
    // Journal should NOT be written (rejected before routing)
    assert.ok(!fs.existsSync(path.join(target, '.ai', 'state', 'context-routes.md')));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// ─── adapter routing tests ────────────────────────────────────────────────────

function writeAdapterConfig(target: string, adapters: Record<string, unknown>): void {
  const configPath = path.join(target, '.ai', 'cli-adapters.json');
  const existing: unknown = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : {};
  fs.writeFileSync(configPath, JSON.stringify({ ...(existing as object), adapters }, null, 2) + '\n');
}

function writeTempScript(dir: string, name: string, code: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, code);
  return p;
}

test('stdin adapter receives compiled context JSON and outputs adapter result', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-stdin-'));
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-stdin-s-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const script = writeTempScript(scriptDir, 'adapter.mjs',
      'const c=[]; process.stdin.on("data",d=>c.push(d)); process.stdin.on("end",()=>{ const j=JSON.parse(Buffer.concat(c).toString()); process.stdout.write(j.kind+"\\n"); });'
    );
    writeAdapterConfig(target, {
      'test-stdin': { command: process.execPath, args: [script], input: 'stdin' }
    });
    const output = runTs(cli, ['--route', '--adapter', 'test-stdin', '--artifact', artifactPath], { cwd: target });
    assert.equal(output.trim(), 'forgeai_compiled_context');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
});

test('--route resolves {model} and {token_budget} placeholders in adapter args', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-placeholder-'));
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-placeholder-s-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const script = writeTempScript(scriptDir, 'echo-args.mjs',
      'process.stdin.resume(); process.stdout.write(process.argv.slice(2).join("|")+"\\n");'
    );
    writeAdapterConfig(target, {
      'placeholder-adapter': {
        command: process.execPath,
        args: [script, '{model}', '{token_budget}'],
        input: 'stdin'
      }
    });
    const output = runTs(cli, ['--route', '--adapter', 'placeholder-adapter', '--model', 'claude-test', '--artifact', artifactPath], { cwd: target });
    const parts = output.trim().split('|');
    assert.equal(parts[0], 'claude-test', '{model} must be replaced');
    assert.equal(parts[1], String(artifact.budget.limit_tokens), '{token_budget} must be replaced');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
});

test('--route succeeds when adapter healthcheck exits 0', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-hc-ok-'));
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-hc-ok-s-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const script = writeTempScript(scriptDir, 'noop.mjs', 'process.stdin.resume();');
    writeAdapterConfig(target, {
      'hc-ok': {
        command: process.execPath,
        args: [script],
        input: 'stdin',
        healthcheck: { args: ['-e', 'process.exit(0)'], timeout_ms: 5000 }
      }
    });
    // Should not throw
    runTs(cli, ['--route', '--adapter', 'hc-ok', '--artifact', artifactPath], { cwd: target });
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
});

test('--route exits 1 when healthcheck exits non-zero', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-hc-fail-'));
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-hc-fail-s-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const script = writeTempScript(scriptDir, 'noop.mjs', 'process.stdin.resume();');
    writeAdapterConfig(target, {
      'hc-fail': {
        command: process.execPath,
        args: [script],
        input: 'stdin',
        healthcheck: { args: ['-e', 'process.exit(1)'], timeout_ms: 5000 }
      }
    });
    let threw = false;
    try {
      runTs(cli, ['--route', '--adapter', 'hc-fail', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'must exit non-zero when healthcheck fails');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
});

test('--route exits 1 when healthcheck times out', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-hc-timeout-'));
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-hc-timeout-s-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const script = writeTempScript(scriptDir, 'noop.mjs', 'process.stdin.resume();');
    writeAdapterConfig(target, {
      'hc-timeout': {
        command: process.execPath,
        args: [script],
        input: 'stdin',
        healthcheck: { args: ['-e', 'setTimeout(()=>{},30000)'], timeout_ms: 300 }
      }
    });
    let threw = false;
    try {
      runTs(cli, ['--route', '--adapter', 'hc-timeout', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'must exit non-zero when healthcheck times out');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
});

test('--route exits 1 for argv adapter', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-argv-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    writeAdapterConfig(target, {
      'argv-adapter': { command: process.execPath, args: [], input: 'argv' }
    });
    let threw = false;
    try {
      runTs(cli, ['--route', '--adapter', 'argv-adapter', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'argv adapter must be rejected');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--route exits 1 for adapter with non-string command', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-badcmd-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    // Write config bypassing TypeScript types to simulate malformed JSON from disk
    const configPath = path.join(target, '.ai', 'cli-adapters.json');
    fs.writeFileSync(configPath, JSON.stringify({ adapters: { 'bad-cmd': { command: {}, input: 'stdin' } } }));
    let threw = false;
    try {
      runTs(cli, ['--route', '--adapter', 'bad-cmd', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'non-string command must be rejected before spawn');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--route exits 1 for unknown input mode', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-input-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const configPath = path.join(target, '.ai', 'cli-adapters.json');
    fs.writeFileSync(configPath, JSON.stringify({ adapters: { 'bad-input': { command: process.execPath, input: 'websocket' } } }));
    let threw = false;
    try {
      runTs(cli, ['--route', '--adapter', 'bad-input', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'unknown input mode must be rejected');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--route exits 1 and writes failed journal when adapter exits non-zero', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-adapter-fail-'));
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-adapter-fail-s-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const script = writeTempScript(scriptDir, 'fail.mjs',
      'process.stdin.resume(); process.stdin.on("end", () => process.exit(2));'
    );
    writeAdapterConfig(target, {
      'failing': { command: process.execPath, args: [script], input: 'stdin' }
    });
    let threw = false;
    try {
      runTs(cli, ['--route', '--adapter', 'failing', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'CLI must exit non-zero when adapter exits non-zero');
    const journal = fs.readFileSync(path.join(target, '.ai', 'state', 'context-routes.md'), 'utf8');
    assert.match(journal, /Status: failed/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
});

test('--route exits 1 for adapter with non-object healthcheck', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-hc-badtype-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const configPath = path.join(target, '.ai', 'cli-adapters.json');
    fs.writeFileSync(configPath, JSON.stringify({
      adapters: { 'bad-hc': { command: process.execPath, input: 'stdin', healthcheck: 'not-an-object' } }
    }));
    let threw = false;
    try {
      runTs(cli, ['--route', '--adapter', 'bad-hc', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'non-object healthcheck must be rejected');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--route exits 1 for adapter config whose top-level JSON value is null', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-null-config-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const configPath = path.join(target, '.ai', 'cli-adapters.json');
    fs.writeFileSync(configPath, 'null');
    let threw = false;
    try {
      runTs(cli, ['--route', '--adapter', 'any', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'null adapter config must be rejected before any lookup');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--route exits 1 when adapter args contain unresolved placeholder', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-unresolved-'));
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-unresolved-s-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const script = writeTempScript(scriptDir, 'noop.mjs', 'process.stdin.resume();');
    writeAdapterConfig(target, {
      'needs-model': { command: process.execPath, args: [script, '{model}'], input: 'stdin' }
    });
    let threw = false;
    try {
      // deliberately omit --model so {model} stays unresolved
      runTs(cli, ['--route', '--adapter', 'needs-model', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'unresolved placeholder must cause exit 1 before spawn');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
});

test('--route exits 1 when journal cannot be appended after adapter run', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-journal-fail-'));
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-journal-fail-s-'));
  try {
    const artifact = initAndCompile(target);
    const artifactPath = writeArtifact(target, artifact);
    const script = writeTempScript(scriptDir, 'noop.mjs', 'process.stdin.resume();');
    writeAdapterConfig(target, {
      'journal-adapter': { command: process.execPath, args: [script], input: 'stdin' }
    });
    // Block journal writes by creating context-routes.md as a directory
    const stateDir = path.join(target, '.ai', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(path.join(stateDir, 'context-routes.md'));
    let threw = false;
    try {
      runTs(cli, ['--route', '--adapter', 'journal-adapter', '--artifact', artifactPath], { cwd: target });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'journal append failure must cause exit 1 after adapter completes');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
});

test('globMatches src/**/*.ts matches direct child (zero-level **) and nested file', async () => {
  const { globMatches } = await import('../bin/lib/context-pack.js');
  // zero-level: direct child under src/
  assert.ok(globMatches('src/**/*.ts', 'src/foo.ts'), 'zero-level direct child must match');
  // one-level nested
  assert.ok(globMatches('src/**/*.ts', 'src/bar/foo.ts'), 'one-level nested must match');
  // two-level nested
  assert.ok(globMatches('src/**/*.ts', 'src/bar/baz/foo.ts'), 'two-level nested must match');
  // wrong prefix
  assert.ok(!globMatches('src/**/*.ts', 'other/foo.ts'), 'wrong prefix must not match');
  // wrong extension
  assert.ok(!globMatches('src/**/*.ts', 'src/foo.js'), 'wrong extension must not match');
});

test('globMatches trailing ** matches deeply nested paths without mangling', async () => {
  // Regression: trailing ** was converted to .* but then the * inside .* was mangled by
  // the single-* pass, turning src/** into src/.[^/]* which rejected nested paths.
  const { globMatches } = await import('../bin/lib/context-pack.js');
  assert.ok(globMatches('src/**', 'src/a/b.ts'), 'trailing ** must match deeply nested path');
  assert.ok(globMatches('src/**', 'src/a.ts'), 'trailing ** must match direct child');
});

test('globMatches leading ** without surrounding slashes does not match rootless file', async () => {
  // **/*.ts has no leading /; the ** expands to .* which requires at least one char before /
  // so foo.ts (no slash) does not match. This documents the defined boundary.
  const { globMatches } = await import('../bin/lib/context-pack.js');
  assert.ok(!globMatches('**/*.ts', 'foo.ts'), '**/*.ts without leading slash must not match root-level file');
  assert.ok(globMatches('**/*.ts', 'a/foo.ts'), '**/*.ts must match file in subdirectory');
});

test('globMatches mid-word ** matches paths including separators', async () => {
  // foo**bar: ** not surrounded by / must still match any chars including /
  const { globMatches } = await import('../bin/lib/context-pack.js');
  assert.ok(globMatches('foo**bar', 'foo/a/bar'), 'mid-word ** must match path with separators');
  assert.ok(globMatches('foo**bar', 'foobar'), 'mid-word ** must match zero chars');
});

test('validateArtifact normalizes a legacy artifact without task_id/artifact_role', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-legacy-'));
  try {
    const artifact = initAndCompile(target);
    const legacy = { ...artifact } as Record<string, unknown>;
    delete legacy.task_id;
    delete legacy.artifact_role;
    delete legacy.mode;
    delete legacy.experiment_id;
    // Recompute the estimate for the field-less shape so the record stays self-consistent.
    legacy.budget = { ...(legacy.budget as Record<string, unknown>) };
    (legacy.budget as Record<string, unknown>).estimated_tokens = computeArtifactEstimate(legacy as unknown as CompiledContextArtifact);
    const artifactPath = writeArtifact(target, legacy as unknown as CompiledContextArtifact);
    const result = validateArtifact(artifactPath, target);
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') {
      assert.equal(result.artifact.task_id, null);
      assert.equal(result.artifact.artifact_role, 'primary');
      assert.equal(result.artifact.mode, 'compact');
      assert.equal(result.artifact.experiment_id, null);
    }
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('validateArtifact rejects a malformed task_id', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-badtask-'));
  try {
    const artifact = initAndCompile(target);
    (artifact as Record<string, unknown>).task_id = 'not-a-task-id';
    const artifactPath = writeArtifact(target, artifact);
    assert.equal(validateArtifact(artifactPath, target).status, 'invalid');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('validateArtifact rejects an unknown artifact_role', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-validate-badrole-'));
  try {
    const artifact = initAndCompile(target);
    (artifact as Record<string, unknown>).artifact_role = 'sidecar';
    const artifactPath = writeArtifact(target, artifact);
    assert.equal(validateArtifact(artifactPath, target).status, 'invalid');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// --- Phase 16.2: language registry in the dependency graph ---

test('indexes Python nodes with language and resolves relative + absolute edges', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-py-graph-'));
  fs.mkdirSync(path.join(target, 'app'), { recursive: true });
  fs.writeFileSync(path.join(target, 'app', '__init__.py'), '');
  fs.writeFileSync(path.join(target, 'app', 'models.py'), 'class User:\n    pass\n');
  fs.writeFileSync(path.join(target, 'app', 'views.py'), 'from .models import User\nfrom app.models import User\nimport os\n');
  const graph = generateDependencyGraph(target);
  assert.equal(graph.nodes.find((n) => n.path === 'app/views.py')!.language, 'python');
  assert.ok(graph.edges.some((e) => e.from === 'app/views.py' && e.to === 'app/models.py'));
  assert.ok(graph.unresolved.some((u) => u.from === 'app/views.py' && u.specifier === 'os' && u.reason === 'external_package'));
  fs.rmSync(target, { recursive: true, force: true });
});

test('ignores .venv and __pycache__, including via the fallback walker (no git)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-py-ignore-'));
  fs.mkdirSync(path.join(target, '.venv', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(target, '__pycache__'), { recursive: true });
  fs.writeFileSync(path.join(target, '.venv', 'lib', 'dep.py'), 'def x():\n    pass\n');
  fs.writeFileSync(path.join(target, '__pycache__', 'c.py'), 'def y():\n    pass\n');
  fs.writeFileSync(path.join(target, 'main.py'), 'def main():\n    pass\n');
  // no `git init` here, so listSourceFiles falls back to the filesystem walker
  const graph = generateDependencyGraph(target);
  assert.deepEqual(graph.nodes.map((n) => n.path), ['main.py']);
  fs.rmSync(target, { recursive: true, force: true });
});

test('golden regression: JS/TS graph unchanged apart from additive language', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-ts-golden-'));
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.writeFileSync(path.join(target, 'src', 'shared.ts'), 'export const v = 1;\n');
  fs.writeFileSync(path.join(target, 'src', 'util.ts'), "export { v } from './shared.js';\n");
  fs.writeFileSync(path.join(target, 'src', 'entry.ts'),
    "import { v } from './util.js';\nconst r = require('./shared');\nexport async function load() { return import('./util.js'); }\nexport const total = v + r;\n");
  const graph = generateDependencyGraph(target);
  const nodes = graph.nodes.map(({ path: p, exports, language }) => ({ path: p, exports, language }));
  assert.deepEqual(nodes, [
    { path: 'src/entry.ts', exports: ['load', 'total'], language: 'typescript' },
    { path: 'src/shared.ts', exports: ['v'], language: 'typescript' },
    { path: 'src/util.ts', exports: ['v'], language: 'typescript' }
  ]);
  assert.deepEqual(graph.edges, [
    { from: 'src/entry.ts', to: 'src/shared.ts', kind: 'require', specifier: './shared' },
    { from: 'src/entry.ts', to: 'src/util.ts', kind: 'dynamic_import', specifier: './util.js' },
    { from: 'src/entry.ts', to: 'src/util.ts', kind: 'static_import', specifier: './util.js' },
    { from: 'src/util.ts', to: 'src/shared.ts', kind: 'static_import', specifier: './shared.js' }
  ]);
  assert.deepEqual(graph.unresolved, []);
  fs.rmSync(target, { recursive: true, force: true });
});

test('does not create cross-language edges', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-crosslang-'));
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.writeFileSync(path.join(target, 'src', 'a.py'), 'def a():\n    pass\n');
  fs.writeFileSync(path.join(target, 'src', 'entry.ts'), "import { a } from './a';\n");
  const graph = generateDependencyGraph(target);
  assert.equal(graph.edges.filter((e) => e.from === 'src/entry.ts').length, 0);
  fs.rmSync(target, { recursive: true, force: true });
});

function writeValidGraphWithLanguage(target: string, language: unknown): void {
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.writeFileSync(path.join(target, 'src', 'a.ts'), 'export const a = 1;\n');
  const base = generateDependencyGraph(target);
  const node = base.nodes[0] as Record<string, unknown>;
  if (language === undefined) delete node.language; else node.language = language;
  fs.mkdirSync(path.join(target, '.ai', 'codegraph'), { recursive: true });
  fs.writeFileSync(path.join(target, DEPENDENCY_GRAPH_PATH), JSON.stringify(base, null, 2) + '\n');
}

test('validator accepts missing/valid language, rejects empty/whitespace/non-string', () => {
  for (const [value, ok] of [[undefined, true], ['typescript', true], ['rustlang', true], ['', false], ['   ', false], [42, false]] as const) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-lang-valid-'));
    writeValidGraphWithLanguage(target, value);
    assert.equal(readDependencyGraph(target) !== null, ok, `language=${JSON.stringify(value)}`);
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// --- Phase 16.2b: Go parser integration ---

test('Go node carries language: go', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-go-lang-'));
  fs.writeFileSync(path.join(target, 'main.go'), 'package main\nfunc main() {}\n');
  const graph = generateDependencyGraph(target);
  assert.equal(graph.nodes.find((n) => n.path === 'main.go')!.language, 'go');
  fs.rmSync(target, { recursive: true, force: true });
});

test('no go.mod → Go imports all external, no crash', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-go-nomod-'));
  fs.writeFileSync(path.join(target, 'main.go'), 'package main\nimport "fmt"\nfunc main() {}\n');
  const graph = generateDependencyGraph(target);
  assert.ok(graph.unresolved.some((u) => u.from === 'main.go' && u.specifier === 'fmt' && u.reason === 'external_package'));
  fs.rmSync(target, { recursive: true, force: true });
});

test('go.mod present: intra-module import fans out to every non-test .go file', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-go-mod-'));
  fs.mkdirSync(path.join(target, 'store'), { recursive: true });
  fs.writeFileSync(path.join(target, 'go.mod'), 'module github.com/acme/svc\n\ngo 1.21\n');
  fs.writeFileSync(path.join(target, 'main.go'), 'package main\nimport "github.com/acme/svc/store"\nfunc main() {}\n');
  fs.writeFileSync(path.join(target, 'store', 'db.go'), 'package store\nfunc Open() {}\n');
  fs.writeFileSync(path.join(target, 'store', 'repo.go'), 'package store\nfunc Find() {}\n');
  fs.writeFileSync(path.join(target, 'store', 'repo_test.go'), 'package store\nfunc TestFind(t interface{}) {}\n');
  const graph = generateDependencyGraph(target);
  const edges = graph.edges.filter((e) => e.from === 'main.go');
  assert.equal(edges.length, 2, 'fan-out: one import → two non-test files');
  assert.ok(edges.some((e) => e.to === 'store/db.go'));
  assert.ok(edges.some((e) => e.to === 'store/repo.go'));
  assert.ok(!edges.some((e) => e.to === 'store/repo_test.go'), 'test file excluded');
  fs.rmSync(target, { recursive: true, force: true });
});

test('stdlib Go import → external_package', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-go-stdlib-'));
  fs.writeFileSync(path.join(target, 'go.mod'), 'module github.com/acme/svc\n\ngo 1.21\n');
  fs.writeFileSync(path.join(target, 'main.go'), 'package main\nimport "fmt"\nfunc main() {}\n');
  const graph = generateDependencyGraph(target);
  assert.ok(graph.unresolved.some((u) => u.specifier === 'fmt' && u.reason === 'external_package'));
  fs.rmSync(target, { recursive: true, force: true });
});

test('vendor/ excluded under fallback walker (no git)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-go-vendor-'));
  fs.mkdirSync(path.join(target, 'vendor', 'github.com', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(target, 'vendor', 'github.com', 'lib', 'util.go'), 'package lib\nfunc Util() {}\n');
  fs.writeFileSync(path.join(target, 'main.go'), 'package main\nfunc main() {}\n');
  const graph = generateDependencyGraph(target);
  assert.ok(!graph.nodes.some((n) => n.path.startsWith('vendor/')), 'vendor/ files not indexed');
  fs.rmSync(target, { recursive: true, force: true });
});

test('no cross-language edges: Go import path never resolves to .ts file', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-go-crosslang-'));
  fs.writeFileSync(path.join(target, 'go.mod'), 'module github.com/acme/svc\n\ngo 1.21\n');
  fs.writeFileSync(path.join(target, 'main.go'), 'package main\nimport "github.com/acme/svc/util"\nfunc main() {}\n');
  fs.writeFileSync(path.join(target, 'util.ts'), 'export const x = 1;\n');
  const graph = generateDependencyGraph(target);
  assert.ok(!graph.edges.some((e) => e.from === 'main.go' && e.to === 'util.ts'));
  fs.rmSync(target, { recursive: true, force: true });
});

test('changing go.mod module path makes dependency graph stale', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-go-stale-mod-'));
  try {
    fs.writeFileSync(path.join(target, 'go.mod'), 'module github.com/acme/svc\n\ngo 1.21\n');
    fs.writeFileSync(path.join(target, 'main.go'), 'package main\nfunc main() {}\n');
    const graph = generateDependencyGraph(target);
    fs.mkdirSync(path.dirname(path.join(target, DEPENDENCY_GRAPH_PATH)), { recursive: true });
    fs.writeFileSync(path.join(target, DEPENDENCY_GRAPH_PATH), JSON.stringify(graph, null, 2) + '\n');
    assert.equal(checkDependencyGraphHealth(target).status, 'ok', 'sanity: should be healthy before change');
    fs.writeFileSync(path.join(target, 'go.mod'), 'module github.com/acme/renamed\n\ngo 1.21\n');
    assert.equal(checkDependencyGraphHealth(target).status, 'stale', 'module rename must make graph stale');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('adding go.mod after graph built without it makes graph stale', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-go-stale-add-'));
  try {
    fs.writeFileSync(path.join(target, 'main.go'), 'package main\nfunc main() {}\n');
    const graph = generateDependencyGraph(target);
    fs.mkdirSync(path.dirname(path.join(target, DEPENDENCY_GRAPH_PATH)), { recursive: true });
    fs.writeFileSync(path.join(target, DEPENDENCY_GRAPH_PATH), JSON.stringify(graph, null, 2) + '\n');
    fs.writeFileSync(path.join(target, 'go.mod'), 'module github.com/acme/svc\n\ngo 1.21\n');
    assert.equal(checkDependencyGraphHealth(target).status, 'stale', 'adding go.mod must make graph stale');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('golden regression: pure JS/TS graph edges unchanged after paths[] contract change', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-go-golden-'));
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.writeFileSync(path.join(target, 'src', 'shared.ts'), 'export const v = 1;\n');
  fs.writeFileSync(path.join(target, 'src', 'util.ts'), "export { v } from './shared.js';\n");
  fs.writeFileSync(path.join(target, 'src', 'entry.ts'),
    "import { v } from './util.js';\nconst r = require('./shared');\nexport async function load() { return import('./util.js'); }\nexport const total = v + r;\n");
  const graph = generateDependencyGraph(target);
  assert.deepEqual(graph.edges, [
    { from: 'src/entry.ts', to: 'src/shared.ts', kind: 'require', specifier: './shared' },
    { from: 'src/entry.ts', to: 'src/util.ts', kind: 'dynamic_import', specifier: './util.js' },
    { from: 'src/entry.ts', to: 'src/util.ts', kind: 'static_import', specifier: './util.js' },
    { from: 'src/util.ts', to: 'src/shared.ts', kind: 'static_import', specifier: './shared.js' }
  ]);
  assert.deepEqual(graph.unresolved, []);
  fs.rmSync(target, { recursive: true, force: true });
});
