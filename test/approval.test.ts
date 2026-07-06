import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

function runCheckApprovalCli(target: string): { output: string; failed: boolean } {
  try {
    const output = runTs(cli, ['--check-approval'], { cwd: target });
    return { output, failed: false };
  } catch (error) {
    const execError = error as ExecError;
    return { output: String(execError.stdout ?? ''), failed: true };
  }
}

function writeTaskJournal(target: string, name: string, content: string): void {
  const dir = path.join(target, '.ai', 'state', 'tasks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

test('check-approval passes with no task journals', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-approval-empty-'));

  try {
    const { output, failed } = runCheckApprovalCli(target);
    assert.equal(failed, false);
    assert.match(output, /ForgeAI approval gate check/);
    assert.match(output, /Result: approval gate satisfied\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-approval passes for non-gated lifecycle state', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-approval-planning-'));

  try {
    writeTaskJournal(target, 'task-001.md', [
      '- Task ID: task-001',
      '- Task type: feature',
      '- Current state: planning',
      '- Last updated: 2026-07-06',
      '',
      'This task touches authentication.'
    ].join('\n'));

    const { output, failed } = runCheckApprovalCli(target);
    assert.equal(failed, false);
    assert.match(output, /Result: approval gate satisfied\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-approval passes when high-risk journal has approval section', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-approval-ok-'));

  try {
    writeTaskJournal(target, 'task-auth.md', [
      '- Task ID: task-auth',
      '- Task type: feature',
      '- Current state: review',
      '- Last updated: 2026-07-06',
      '',
      'Refactoring authentication middleware.',
      '',
      '## Approval',
      '',
      'Signed by: thanh on 2026-07-06'
    ].join('\n'));

    const { output, failed } = runCheckApprovalCli(target);
    assert.equal(failed, false);
    assert.match(output, /ok\s+.*task-auth.*approval section found/);
    assert.match(output, /Result: approval gate satisfied\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-approval fails when high-risk journal lacks approval section', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-approval-fail-'));

  try {
    writeTaskJournal(target, 'task-security.md', [
      '- Task ID: task-security',
      '- Task type: feature',
      '- Current state: review',
      '- Last updated: 2026-07-06',
      '',
      'Update security policy and authentication tokens.'
    ].join('\n'));

    const { output, failed } = runCheckApprovalCli(target);
    assert.equal(failed, true);
    assert.match(output, /fail\s+.*task-security.*high-risk task/);
    assert.match(output, /Result: approval gate failed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-approval fails for dependency-upgrade type regardless of content', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-approval-dep-'));

  try {
    writeTaskJournal(target, 'task-dep.md', [
      '- Task ID: task-dep',
      '- Task type: dependency-upgrade',
      '- Current state: acceptance',
      '- Last updated: 2026-07-06',
      '',
      'Upgrade eslint to v9.'
    ].join('\n'));

    const { output, failed } = runCheckApprovalCli(target);
    assert.equal(failed, true);
    assert.match(output, /fail\s+.*task-dep.*high-risk task/);
    assert.match(output, /Result: approval gate failed\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
