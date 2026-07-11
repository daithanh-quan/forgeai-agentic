import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

function runCli(flag: string, cwd: string): { output: string; failed: boolean } {
  try {
    const output = runTs(cli, [flag], { cwd });
    return { output, failed: false };
  } catch (error) {
    const execError = error as ExecError;
    return { output: String(execError.stdout ?? execError.stderr ?? ''), failed: true };
  }
}

function initGit(dir: string): void {
  const opts = { cwd: dir, stdio: 'pipe' as const };
  execFileSync('git', ['init'], opts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], opts);
  execFileSync('git', ['config', 'user.name', 'Test'], opts);
}

function makeCommit(dir: string, message = 'initial commit'): void {
  const opts = { cwd: dir, stdio: 'pipe' as const };
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], opts);
  execFileSync('git', ['commit', '-m', message], opts);
}

test('--status-summary emits branch and change counts in a clean repo', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-status-clean-'));
  try {
    initGit(target);
    makeCommit(target);

    const { output, failed } = runCli('--status-summary', target);
    assert.equal(failed, false);
    assert.match(output, /Git Status Summary/);
    assert.match(output, /Branch:/);
    assert.match(output, /Last commit:/);
    assert.match(output, /Staged: 0/);
    assert.match(output, /Unstaged: 0/);
    assert.match(output, /Working tree is clean/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--status-summary lists staged and untracked files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-status-dirty-'));
  try {
    initGit(target);
    makeCommit(target);
    fs.writeFileSync(path.join(target, 'new-file.ts'), 'export const x = 1;\n');
    execFileSync('git', ['add', 'new-file.ts'], { cwd: target, stdio: 'pipe' });
    fs.writeFileSync(path.join(target, 'untracked.ts'), 'export const y = 2;\n');

    const { output, failed } = runCli('--status-summary', target);
    assert.equal(failed, false);
    assert.match(output, /Staged: 1/);
    assert.match(output, /Untracked: 1/);
    assert.match(output, /Changed Files/);
    assert.match(output, /new-file\.ts/);
    assert.match(output, /untracked\.ts/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--status-summary handles missing git gracefully', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-status-nogit-'));
  try {
    const { output } = runCli('--status-summary', target);
    assert.match(output, /Git Status Summary/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--diff-summary emits no-changes message in clean repo', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-diff-clean-'));
  try {
    initGit(target);
    makeCommit(target);

    const { output, failed } = runCli('--diff-summary', target);
    assert.equal(failed, false);
    assert.match(output, /Diff Summary/);
    assert.match(output, /No changes detected/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--diff-summary shows changed files table when diff exists', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-diff-dirty-'));
  try {
    initGit(target);
    makeCommit(target);
    fs.writeFileSync(path.join(target, 'README.md'), '# test\n\nmore content\n');

    const { output, failed } = runCli('--diff-summary', target);
    assert.equal(failed, false);
    assert.match(output, /Diff Summary/);
    assert.match(output, /Changed Files/);
    assert.match(output, /README\.md/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--diff-summary reports exact integer insertion and deletion counts', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-diff-exact-'));
  try {
    initGit(target);
    // Commit a file with 5 lines
    fs.writeFileSync(path.join(target, 'src.ts'), 'a\nb\nc\nd\ne\n');
    makeCommit(target, 'initial');
    // Replace with 3 lines: net -2 deletions, +3 insertions, -5 deletions vs original
    // git diff --numstat shows lines added and removed relative to HEAD
    fs.writeFileSync(path.join(target, 'src.ts'), 'x\ny\nz\n');

    const { output, failed } = runCli('--diff-summary', target);
    assert.equal(failed, false);
    // numstat should report exactly 3 insertions and 5 deletions
    assert.match(output, /Insertions: \+3/);
    assert.match(output, /Deletions: -5/);
    assert.match(output, /\| src\.ts \| \+3 \| -5 \|/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--diff-summary shows binary label for binary files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-diff-binary-'));
  try {
    initGit(target);
    // Commit a binary file (non-UTF-8 bytes)
    fs.writeFileSync(path.join(target, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
    makeCommit(target, 'add binary');
    // Modify it
    fs.writeFileSync(path.join(target, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0xfd, 0xfc]));

    const { output, failed } = runCli('--diff-summary', target);
    assert.equal(failed, false);
    assert.match(output, /image\.png.*binary.*binary/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--test-summary reports no scripts when package.json is absent', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-test-nopkg-'));
  try {
    const { output, failed } = runCli('--test-summary', target);
    assert.equal(failed, false);
    assert.match(output, /Test Summary/);
    assert.match(output, /package\.json not found/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--test-summary reports no recognised scripts when none match', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-test-noscripts-'));
  try {
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ scripts: { start: 'node index.js' } }));

    const { output, failed } = runCli('--test-summary', target);
    assert.equal(failed, false);
    assert.match(output, /Test Summary/);
    assert.match(output, /No recognised scripts found/);
    assert.match(output, /start/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--test-summary runs detected scripts and reports pass/fail', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-test-pass-'));
  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } })
    );

    const { output, failed } = runCli('--test-summary', target);
    assert.equal(failed, false);
    assert.match(output, /Test Summary/);
    assert.match(output, /Scripts detected:.*test/);
    assert.match(output, /Results/);
    assert.match(output, /test.*pass/);
    assert.match(output, /Overall:.*pass/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--test-summary stops at first failure and reports fail', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-test-fail-'));
  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({
        scripts: {
          test: 'node -e "console.error(\'tests failed\');process.exit(1)"',
          build: 'node -e "process.exit(0)"'
        }
      })
    );

    const { output, failed } = runCli('--test-summary', target);
    assert.equal(failed, false);
    assert.match(output, /Overall:.*fail/);
    assert.match(output, /test.*fail/);
    assert.match(output, /Failure: test/);
    assert.match(output, /Stopped after first failure.*Skipped: build/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
