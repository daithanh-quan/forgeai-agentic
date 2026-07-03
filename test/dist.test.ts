import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { projectRoot } from './helpers.js';

const distCli = path.join(projectRoot, 'dist', 'forgeai-init.js');

// Run the compiled CLI with plain node — no tsx loader — the way an npm
// install executes the published bin.
function runDist(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [distCli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORGEAI_SKIP_UPDATE_CHECK: '1' }
  }) as string;
}

test('compiled dist CLI starts with a plain node shebang', () => {
  const firstLine = fs.readFileSync(distCli, 'utf8').split('\n')[0];
  assert.equal(firstLine, '#!/usr/bin/env node');
});

test('compiled dist CLI reports the package version without tsx', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
    version: string;
  };
  const output = runDist(['--version'], projectRoot);
  assert.equal(output.trim(), packageJson.version);
});

test('compiled dist CLI initializes a harness and passes --check', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dist-init-'));
  try {
    runDist([], target);
    assert.ok(fs.existsSync(path.join(target, '.ai', 'RULES.md')));
    const output = runDist(['--check'], target);
    assert.match(output, /Result: harness installed/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
