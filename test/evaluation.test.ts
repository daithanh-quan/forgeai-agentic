import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

function runCheckEvaluationCli(target: string): { output: string; failed: boolean } {
  try {
    const output = runTs(cli, ['--check-evaluation'], { cwd: target });
    return { output, failed: false };
  } catch (error) {
    const execError = error as ExecError;
    return { output: String(execError.stdout ?? ''), failed: true };
  }
}

function writeEvalRun(target: string, name: string, content: string): void {
  const dir = path.join(target, '.ai', 'evaluation');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

test('check-evaluation passes when .ai/evaluation dir does not exist', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-none-'));

  try {
    const { output, failed } = runCheckEvaluationCli(target);
    assert.equal(failed, false);
    assert.match(output, /ForgeAI evaluation check/);
    assert.match(output, /ok\s+\.ai\/evaluation not present/);
    assert.match(output, /Result: evaluation check passed \(no runs to validate\)\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-evaluation passes with a valid run file', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-ok-'));

  try {
    writeEvalRun(target, 'eval-001.md', [
      '# Evaluation Run',
      '',
      '- Run ID: eval-001',
      '- Date: 2026-07-06',
      '- Task: P8 worktree strategy docs',
      '- Mode: multi-agent',
      '- Outcome: pass',
      '- Correctness: high',
      '- Notes: Gemini fast tier completed research in under 30s.'
    ].join('\n'));

    const { output, failed } = runCheckEvaluationCli(target);
    assert.equal(failed, false);
    assert.match(output, /ok\s+\.ai\/evaluation\/eval-001\.md \(multi-agent \/ pass\)/);
    assert.match(output, /Result: evaluation check passed \(1 run validated\)\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-evaluation fails when required field is missing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-missing-'));

  try {
    writeEvalRun(target, 'eval-002.md', [
      '# Evaluation Run',
      '',
      '- Run ID: eval-002',
      '- Date: 2026-07-06',
      '- Task: test decompose command',
      '- Outcome: pass'
      // Mode is intentionally missing
    ].join('\n'));

    const { output, failed } = runCheckEvaluationCli(target);
    assert.equal(failed, true);
    assert.match(output, /invalid\s+\.ai\/evaluation\/eval-002\.md missing required field: Mode/);
    assert.match(output, /Result: evaluation check failed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-evaluation fails on invalid Mode value', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-invalid-mode-'));

  try {
    writeEvalRun(target, 'eval-003.md', [
      '# Evaluation Run',
      '',
      '- Run ID: eval-003',
      '- Date: 2026-07-06',
      '- Task: router fallback test',
      '- Mode: parallel',
      '- Outcome: pass'
    ].join('\n'));

    const { output, failed } = runCheckEvaluationCli(target);
    assert.equal(failed, true);
    assert.match(output, /invalid\s+.*Mode must be single-agent or multi-agent/);
    assert.match(output, /Result: evaluation check failed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
