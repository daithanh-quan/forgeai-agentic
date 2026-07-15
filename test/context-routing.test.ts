import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompiledContextArtifact } from '../bin/lib/types.js';
import { cli, type ExecError, runTs } from './helpers.js';

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
