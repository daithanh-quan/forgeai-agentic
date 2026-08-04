import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CompiledContextArtifact } from '../bin/lib/types.js';
import { cli, type ExecError, runTs } from './helpers.js';

// Self-contained copy of the context-compiler fixture (its helpers are not exported).
function makeCompilerRepo(): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-baseline-'));
  runTs(cli, [], { cwd: target });
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.mkdirSync(path.join(target, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(target, 'src', 'entry.ts'),
    "import { formatDiagnostics } from './diagnostics.js';\nexport function runCli() {\n  return formatDiagnostics();\n}\n"
  );
  fs.writeFileSync(
    path.join(target, 'src', 'diagnostics.ts'),
    "import { sharedValue } from './shared.js';\nexport function formatDiagnostics() { return String(sharedValue); }\n"
  );
  fs.writeFileSync(path.join(target, 'src', 'shared.ts'), 'export const sharedValue = 42;\n');
  fs.writeFileSync(
    path.join(target, 'test', 'entry.test.ts'),
    "import { runCli } from '../src/entry.js';\ntest('runCli returns diagnostics', () => { assert.equal(runCli(), '42'); });\n"
  );
  runTs(cli, ['--refresh-codegraph'], { cwd: target });
  return target;
}

function compileErr(dir: string, args: string[]): string {
  try {
    runTs(cli, ['--compile-context', ...args], { cwd: dir });
    return '';
  } catch (error) {
    const e = error as ExecError;
    return `${String(e.stdout ?? '')}${String(e.stderr ?? '')}`;
  }
}

test('--compile-context --mode baseline emits whole-file excerpts', () => {
  const dir = makeCompilerRepo();
  try {
    const out = runTs(cli, ['--compile-context', '--objective', 'change runCli implementation', '--mode', 'baseline', '--experiment', 'EXP-20260727-e', '--budget', '20000'], { cwd: dir });
    const artifact = JSON.parse(out) as CompiledContextArtifact;
    assert.equal(artifact.mode, 'baseline');
    assert.equal(artifact.experiment_id, 'EXP-20260727-e');
    assert.ok(artifact.excerpts.length > 0);
    assert.ok(artifact.excerpts.every((e) => e.kind === 'file' && e.mode === 'full'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('baseline excerpt content equals the whole source file and shares compact selection', () => {
  const dir = makeCompilerRepo();
  try {
    const baseline = JSON.parse(runTs(cli, ['--compile-context', '--objective', 'change runCli implementation', '--mode', 'baseline', '--budget', '20000'], { cwd: dir })) as CompiledContextArtifact;
    const compact = JSON.parse(runTs(cli, ['--compile-context', '--objective', 'change runCli implementation', '--mode', 'compact', '--budget', '20000'], { cwd: dir })) as CompiledContextArtifact;
    // Selection (seed files) is identical — mode only changes how files are rendered.
    assert.deepEqual(
      baseline.selection.files.map((f) => f.path).sort(),
      compact.selection.files.map((f) => f.path).sort()
    );
    // A baseline 'file' excerpt's content is the verbatim source file.
    const fileExc = baseline.excerpts.find((e) => e.kind === 'file');
    assert.ok(fileExc);
    const onDisk = fs.readFileSync(path.join(dir, fileExc!.path), 'utf8');
    assert.equal(fileExc!.content, onDisk);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--compile-context --mode baseline errors when whole files exceed the budget', () => {
  const dir = makeCompilerRepo();
  try {
    // base minimum ~1326 fits, whole-file baseline ~1735 does not.
    const out = compileErr(dir, ['--objective', 'change runCli implementation', '--mode', 'baseline', '--budget', '1500']);
    assert.match(out, /baseline mode needs \d+ tokens/);
    assert.match(out, /raise --budget/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--compile-context rejects an invalid --mode', () => {
  const dir = makeCompilerRepo();
  try {
    const out = compileErr(dir, ['--objective', 'demo', '--mode', 'full']);
    assert.match(out, /--mode must be/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a bare --mode, --experiment, or --include-excluded (no value) exits 1', () => {
  const dir = makeCompilerRepo();
  try {
    for (const flag of ['--mode', '--experiment', '--include-excluded']) {
      const out = compileErr(dir, ['--objective', 'demo', flag]);
      assert.match(out, new RegExp(`\\${flag} requires a value`));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate --include-excluded exits 1', () => {
  const dir = makeCompilerRepo();
  try {
    const out = compileErr(dir, [
      '--objective', 'demo', '--include-excluded', 'a/**', '--include-excluded', 'b/**'
    ]);
    assert.match(out, /--include-excluded cannot be specified more than once/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
