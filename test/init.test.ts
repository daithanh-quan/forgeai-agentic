import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mock } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runRepairCodeGraph } from '../bin/lib/init.js';
import { projectRoot } from './helpers.js';

const VALID_GRAPH = JSON.stringify({ schema_version: 1, generated_at: '2026-01-01', source: 'test', nodes: [], edges: [] });
const MALFORMED = 'not valid json {{{';
const templateGraphPath = path.join(projectRoot, 'templates', '.ai', 'codegraph', 'graph.json');

type CaptureResult = { exitCode: number | undefined; stdout: string; stderr: string };

// Captures console.log (stdout) and process.stderr.write output, saves and restores
// process.exitCode, and restores both streams unconditionally — even if fn throws.
function captureRepair(fn: () => void): CaptureResult {
  const prevExitCode = process.exitCode;
  process.exitCode = undefined;
  let stdout = '';
  let stderr = '';
  const origLog = console.log.bind(console);
  const origWrite = process.stderr.write.bind(process.stderr);
  console.log = (...args: unknown[]) => { stdout += args.join(' ') + '\n'; };
  process.stderr.write = (chunk: unknown) => { stderr += String(chunk); return true; };
  try {
    fn();
    return { exitCode: process.exitCode as number | undefined, stdout, stderr };
  } finally {
    console.log = origLog;
    process.stderr.write = origWrite;
    process.exitCode = prevExitCode;
  }
}

function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-repair-'));
  fs.mkdirSync(path.join(dir, '.ai', 'codegraph'), { recursive: true });
  return dir;
}

function writeGraph(dir: string, content: string): string {
  const p = path.join(dir, '.ai', 'codegraph', 'graph.json');
  fs.writeFileSync(p, content);
  return p;
}

// ── read failure ───────────────────────────────────────────────────────────────

test('runRepairCodeGraph: read failure → exit 1, stderr contains "could not read", canonical unchanged', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, MALFORMED);
    const origRead = fs.readFileSync.bind(fs);
    const mockHandle = mock.method(fs, 'readFileSync', (p: unknown, enc: unknown) => {
      if (p === graphPath) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      return (origRead as typeof fs.readFileSync)(p as Parameters<typeof fs.readFileSync>[0], enc as Parameters<typeof fs.readFileSync>[1]);
    });
    let result: CaptureResult;
    try {
      result = captureRepair(() => runRepairCodeGraph({ graphPath, templateGraphPath }));
    } finally {
      mockHandle.mock.restore();
    }
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('could not read'), `stderr: ${result.stderr}`);
    assert.equal(fs.readFileSync(graphPath, 'utf-8'), MALFORMED, 'canonical content must be unchanged');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── valid JSON → refuse ─────────────────────────────────────────────────────────

test('runRepairCodeGraph: valid JSON → exit 0, stdout contains "already valid JSON"', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, VALID_GRAPH);
    const result = captureRepair(() => runRepairCodeGraph({ graphPath, templateGraphPath }));
    assert.equal(result.exitCode, undefined);
    assert.ok(result.stdout.includes('already valid JSON'), `stdout: ${result.stdout}`);
    assert.equal(fs.readFileSync(graphPath, 'utf-8'), VALID_GRAPH);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── graph not found ─────────────────────────────────────────────────────────────

test('runRepairCodeGraph: missing graph.json → exit 1, stderr contains "nothing to repair"', () => {
  const dir = makeFixture();
  try {
    const graphPath = path.join(dir, '.ai', 'codegraph', 'graph.json');
    const result = captureRepair(() => runRepairCodeGraph({ graphPath, templateGraphPath }));
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('nothing to repair'), `stderr: ${result.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── successful repair ──────────────────────────────────────────────────────────

test('runRepairCodeGraph: malformed graph → repair succeeds, canonical becomes valid JSON', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, MALFORMED);
    const result = captureRepair(() => runRepairCodeGraph({ graphPath, templateGraphPath }));
    assert.equal(result.exitCode, undefined);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(graphPath, 'utf-8')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── template missing ──────────────────────────────────────────────────────────

test('runRepairCodeGraph: template missing → exit 1, canonical unchanged, no tmp left behind, backup may remain', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, MALFORMED);
    const missingTemplate = path.join(dir, 'nonexistent-template.json');
    const result = captureRepair(() => runRepairCodeGraph({ graphPath, templateGraphPath: missingTemplate }));
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('repair failed'), `stderr: ${result.stderr}`);
    assert.equal(fs.readFileSync(graphPath, 'utf-8'), MALFORMED, 'canonical must be unchanged');
    const leftover = fs.readdirSync(path.dirname(graphPath)).filter((f) => f.includes('.tmp.'));
    assert.equal(leftover.length, 0, 'no tmp files should remain');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── template malformed ─────────────────────────────────────────────────────────

test('runRepairCodeGraph: template malformed → exit 1, stderr contains "not valid JSON", canonical unchanged, backup may remain', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, MALFORMED);
    const badTemplate = path.join(dir, 'bad-template.json');
    fs.writeFileSync(badTemplate, 'not json');
    const result = captureRepair(() => runRepairCodeGraph({ graphPath, templateGraphPath: badTemplate }));
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('not valid JSON'), `stderr: ${result.stderr}`);
    assert.equal(fs.readFileSync(graphPath, 'utf-8'), MALFORMED, 'canonical must be unchanged');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── backup collision retry ─────────────────────────────────────────────────────

test('runRepairCodeGraph: backup collision retries until unique suffix found', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, MALFORMED);
    fs.writeFileSync(`${graphPath}.backup.X`, 'existing backup');
    let calls = 0;
    const suffixes = ['X', 'X', 'Y'];
    const result = captureRepair(() => runRepairCodeGraph({
      graphPath, templateGraphPath,
      randomSuffix: () => suffixes[calls++] ?? 'Z',
    }));
    assert.equal(result.exitCode, undefined, 'repair must succeed after retry');
    assert.ok(fs.existsSync(`${graphPath}.backup.Y`), 'backup with suffix Y must exist');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── backup retry exhaustion ────────────────────────────────────────────────────

test('runRepairCodeGraph: backup retry exhausted → exit 1, "could not create unique backup path"', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, MALFORMED);
    fs.writeFileSync(`${graphPath}.backup.X`, 'existing');
    const result = captureRepair(() => runRepairCodeGraph({
      graphPath, templateGraphPath,
      randomSuffix: () => 'X',
    }));
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('could not create unique backup path after 10 attempts'), `stderr: ${result.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── tmp collision retry ────────────────────────────────────────────────────────

test('runRepairCodeGraph: tmp collision retries until unique suffix found', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, MALFORMED);
    fs.writeFileSync(`${graphPath}.tmp.X`, 'stale tmp');
    let calls = 0;
    // backup call 1 = 'Y' (succeeds), tmp calls 2,3 = 'X' (EEXIST on pre-created), call 4 = 'Z' (succeeds)
    const suffixes = ['Y', 'X', 'X', 'Z'];
    const result = captureRepair(() => runRepairCodeGraph({
      graphPath, templateGraphPath,
      randomSuffix: () => suffixes[calls++] ?? 'W',
    }));
    assert.equal(result.exitCode, undefined, 'repair must succeed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── tmp retry exhaustion ───────────────────────────────────────────────────────

test('runRepairCodeGraph: tmp retry exhausted → exit 1, "could not create unique tmp path"', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, MALFORMED);
    fs.writeFileSync(`${graphPath}.tmp.X`, 'stale');
    let calls = 0;
    // backup gets 'Y' and succeeds, all 10 tmp attempts get 'X' (EEXIST)
    const suffixes = ['Y', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X'];
    const result = captureRepair(() => runRepairCodeGraph({
      graphPath, templateGraphPath,
      randomSuffix: () => suffixes[calls++] ?? 'X',
    }));
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('could not create unique tmp path after 10 attempts'), `stderr: ${result.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── template read failure (separate from parse failure) ────────────────────────

test('runRepairCodeGraph: template-copy read failure → exit 1, "could not read template copy", canonical unchanged, tmp cleaned up', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, MALFORMED);
    const tmpPath = `${graphPath}.tmp.FIXED`;
    const origRead = fs.readFileSync.bind(fs);
    const mockHandle = mock.method(fs, 'readFileSync', (p: unknown, enc: unknown) => {
      if (p === tmpPath) throw Object.assign(new Error('EIO: input/output error'), { code: 'EIO' });
      return (origRead as typeof fs.readFileSync)(p as Parameters<typeof fs.readFileSync>[0], enc as Parameters<typeof fs.readFileSync>[1]);
    });
    let result: CaptureResult;
    try {
      result = captureRepair(() => runRepairCodeGraph({
        graphPath, templateGraphPath,
        randomSuffix: () => 'FIXED',
      }));
    } finally {
      mockHandle.mock.restore();
    }
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('could not read template copy'), `stderr: ${result.stderr}`);
    assert.equal(fs.readFileSync(graphPath, 'utf-8'), MALFORMED, 'canonical must be unchanged');
    assert.ok(!fs.existsSync(tmpPath), 'tmp file must be cleaned up');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gitignore written and idempotent ───────────────────────────────────────────

test('runRepairCodeGraph: gitignore written with backup and tmp patterns', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, MALFORMED);
    const gitignorePath = path.join(path.dirname(graphPath), '.gitignore');
    const result = captureRepair(() => runRepairCodeGraph({ graphPath, templateGraphPath, gitignorePath }));
    assert.equal(result.exitCode, undefined);
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    assert.ok(content.includes('graph.json.backup.*'), content);
    assert.ok(content.includes('graph.json.tmp.*'), content);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runRepairCodeGraph: gitignore is idempotent on second repair', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, MALFORMED);
    const gitignorePath = path.join(path.dirname(graphPath), '.gitignore');
    captureRepair(() => runRepairCodeGraph({ graphPath, templateGraphPath, gitignorePath }));
    // Re-malform so second call also reaches gitignore logic
    fs.writeFileSync(graphPath, MALFORMED);
    captureRepair(() => runRepairCodeGraph({ graphPath, templateGraphPath, gitignorePath }));
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    assert.equal(lines.filter((l) => l === 'graph.json.backup.*').length, 1, 'no duplicate backup pattern');
    assert.equal(lines.filter((l) => l === 'graph.json.tmp.*').length, 1, 'no duplicate tmp pattern');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gitignore write failure (non-fatal) ────────────────────────────────────────

test('runRepairCodeGraph: gitignore write failure → warning in stderr, repair still succeeds', () => {
  const dir = makeFixture();
  try {
    const graphPath = writeGraph(dir, MALFORMED);
    const badGitignorePath = path.join(dir, 'nonexistent-parent', '.gitignore');
    const result = captureRepair(() => runRepairCodeGraph({
      graphPath, templateGraphPath,
      gitignorePath: badGitignorePath,
    }));
    assert.equal(result.exitCode, undefined, 'repair must succeed despite gitignore failure');
    assert.ok(result.stderr.includes('Warning: could not write .ai/codegraph/.gitignore'), `stderr: ${result.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
