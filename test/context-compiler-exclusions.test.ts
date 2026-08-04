import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompiledContextArtifact } from '../bin/lib/types.js';
import { cli, type ExecError, runTs } from './helpers.js';

// Fixture: entry.ts depends on a generated migration under src/migrations/, which
// the django profile excludes. The migration is a graph neighbor of the seed.
function writeFixture(target: string): void {
  fs.mkdirSync(path.join(target, 'src', 'migrations'), { recursive: true });
  fs.writeFileSync(
    path.join(target, 'src', 'entry.ts'),
    "import { seed } from './migrations/0001_init.js';\nexport function runCli() { return seed; }\n"
  );
  fs.writeFileSync(
    path.join(target, 'src', 'migrations', '0001_init.ts'),
    'export const seed = 1;\n'
  );
}

function runCompile(target: string, args: string[]): { output: string; failed: boolean; error?: ExecError } {
  try {
    return { output: runTs(cli, ['--compile-context', ...args], { cwd: target }), failed: false };
  } catch (error) {
    const execError = error as ExecError;
    return { output: `${String(execError.stdout ?? '')}${String(execError.stderr ?? '')}`, failed: true, error: execError };
  }
}

test('compile-context persists exclusion policy and omits excluded neighbors', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-excl-'));
  try {
    runTs(cli, ['--profile', 'django'], { cwd: target });
    writeFixture(target);
    runTs(cli, ['--refresh-codegraph'], { cwd: target });

    const result = runCompile(target, ['--objective', 'change runCli implementation', '--budget', '4000']);
    assert.equal(result.failed, false, result.output);
    const artifact = JSON.parse(result.output) as CompiledContextArtifact;

    assert.deepEqual(artifact.context_exclusions.profiles, ['django']);
    assert.ok(
      artifact.context_exclusions.rules.some((r) => r.pattern === 'migrations/'),
      'policy should carry the django migrations rule'
    );
    assert.ok(
      artifact.omitted_context.some((o) => o.path === 'src/migrations/0001_init.ts' && o.pattern === 'migrations/'),
      'migration neighbor should be recorded as omitted'
    );
    assert.equal(
      artifact.excerpts.some((e) => e.path.includes('migrations/')),
      false,
      'no excerpt should come from an excluded path'
    );
    assert.equal(
      artifact.selection.files.some((f) => f.path.includes('migrations/')),
      false,
      'excluded path should not be in selection.files'
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--include-excluded keeps an otherwise-excluded neighbor in the compiled artifact', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-incl-'));
  try {
    runTs(cli, ['--profile', 'django'], { cwd: target });
    writeFixture(target);
    runTs(cli, ['--refresh-codegraph'], { cwd: target });

    const result = runCompile(target, [
      '--objective', 'change runCli implementation', '--budget', '4000',
      '--include-excluded', '**/migrations/**'
    ]);
    assert.equal(result.failed, false, result.output);
    const artifact = JSON.parse(result.output) as CompiledContextArtifact;

    assert.deepEqual(artifact.context_exclusions.include_globs, ['**/migrations/**']);
    assert.equal(artifact.omitted_context.length, 0);
    assert.ok(
      artifact.selection.files.some((f) => f.path === 'src/migrations/0001_init.ts'),
      'included path should appear in selection'
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('an invalid manifest does not corrupt compile-context JSON stdout', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-compile-invalid-manifest-'));
  try {
    runTs(cli, ['--profile', 'django'], { cwd: target });
    writeFixture(target);
    runTs(cli, ['--refresh-codegraph'], { cwd: target });
    fs.writeFileSync(path.join(target, '.ai', 'manifest.json'), '{ invalid json\n');

    const result = runCompile(target, ['--objective', 'change runCli implementation', '--budget', '4000']);
    assert.equal(result.failed, false, result.output);
    const artifact = JSON.parse(result.output) as CompiledContextArtifact;
    assert.deepEqual(artifact.context_exclusions, { profiles: [], include_globs: [], rules: [] });
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
