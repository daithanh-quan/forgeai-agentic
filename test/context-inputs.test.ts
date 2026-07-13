import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectDiagnostics } from '../bin/lib/context-inputs.js';

function git(target: string, args: string[]): void {
  execFileSync('git', args, { cwd: target, stdio: 'ignore' });
}

test('collectDiagnostics returns deterministic git and validation evidence without running scripts', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-context-diagnostics-'));
  try {
    git(target, ['init']);
    git(target, ['config', 'user.email', 'forgeai@example.test']);
    git(target, ['config', 'user.name', 'ForgeAI Test']);
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
      scripts: { typecheck: 'tsc --noEmit', test: 'node --test', deploy: 'never-run' }
    }));
    fs.writeFileSync(path.join(target, 'tracked.txt'), 'first\n');
    git(target, ['add', '.']);
    git(target, ['commit', '-m', 'fixture']);
    fs.appendFileSync(path.join(target, 'tracked.txt'), 'second\n');
    fs.writeFileSync(path.join(target, 'untracked.txt'), 'new\n');

    const first = collectDiagnostics(target);
    const second = collectDiagnostics(target);

    assert.deepEqual(first, second);
    assert.equal(first.git.available, true);
    assert.match(first.git.revision ?? '', /^[a-f0-9]{40}$/);
    assert.equal(first.git.unstaged, 1);
    assert.equal(first.git.untracked, 1);
    assert.ok(first.git.changed_files.some((entry) => entry.path === 'tracked.txt' && entry.state === 'unstaged'));
    assert.ok(first.git.diff.some((entry) => entry.path === 'tracked.txt' && entry.insertions === 1));
    assert.equal(first.validation.package_manager, 'npm');
    assert.deepEqual(first.validation.scripts.map((entry) => entry.name), ['typecheck', 'test']);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
