import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

function runDecomposeCli(target: string, extraArgs: string[] = []): { output: string; failed: boolean } {
  try {
    const output = runTs(cli, ['--decompose', ...extraArgs], { cwd: target });
    return { output, failed: false };
  } catch (error) {
    const execError = error as ExecError;
    return { output: String(execError.stdout ?? execError.stderr ?? ''), failed: true };
  }
}

test('decompose emits a scored template for a given objective', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-decompose-ok-'));

  try {
    const { output, failed } = runDecomposeCli(target, ['--objective', 'add login form to the frontend']);

    assert.equal(failed, false);
    assert.match(output, /Task Decomposition/);
    assert.match(output, /add login form to the frontend/);
    assert.match(output, /Scoring Table/);
    assert.match(output, /Subtask 1/);
    assert.match(output, /Session coordination/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('decompose writes output to a file when --output is specified', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-decompose-file-'));

  try {
    const outputFile = '.ai/state/tasks/decompose-test.md';
    const { failed } = runDecomposeCli(target, ['--objective', 'refactor router fallback', '--output', outputFile]);

    assert.equal(failed, false);
    const written = fs.readFileSync(path.join(target, outputFile), 'utf8');
    assert.match(written, /refactor router fallback/);
    assert.match(written, /Scoring Table/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('decompose exits with code 2 when --objective is missing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-decompose-no-obj-'));

  try {
    const { failed } = runDecomposeCli(target);
    assert.equal(failed, true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
