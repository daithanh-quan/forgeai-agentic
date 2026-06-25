import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

test('git check reports missing repository outside git', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-git-missing-'));

  try {
    assert.throws(
      () => runTs(cli, ['--check-git'], { cwd: target }),
      (error: unknown) => {
        const execError = error as ExecError;
        const stdout = String(execError.stdout ?? '');
        assert.match(stdout, /ForgeAI git check/);
        assert.match(stdout, /missing\s+not inside a git worktree/);
        assert.match(stdout, /Result: git repository not found/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('git check allows semantic local branch without a remote', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-git-local-'));

  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: target });
    fs.writeFileSync(path.join(target, 'README.md'), '# Test\n');
    execFileSync('git', ['add', 'README.md'], { cwd: target });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'chore: init'], {
      cwd: target
    });
    execFileSync('git', ['switch', '-c', 'feat/local-worktree-check'], { cwd: target });

    const output = runTs(cli, ['--check-git'], { cwd: target });

    assert.match(output, /provider: none/);
    assert.match(output, /remote: not configured/);
    assert.match(output, /ok\s+feat\/local-worktree-check/);
    assert.match(output, /Recommendation: no remote is connected/);
    assert.match(output, /Result: git workflow is usable/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('git check rejects invalid branch names', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-git-invalid-'));

  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: target });
    fs.writeFileSync(path.join(target, 'README.md'), '# Test\n');
    execFileSync('git', ['add', 'README.md'], { cwd: target });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'chore: init'], {
      cwd: target
    });
    execFileSync('git', ['switch', '-c', 'agent/test-task'], { cwd: target });

    assert.throws(
      () => runTs(cli, ['--check-git'], { cwd: target }),
      (error: unknown) => {
        const execError = error as ExecError;
        const stdout = String(execError.stdout ?? '');
        assert.match(stdout, /invalid\s+agent\/test-task should use feat\/, fix\/, docs\//);
        assert.match(stdout, /Result: git workflow needs attention/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
