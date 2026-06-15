import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(projectRoot, 'bin/forgeai-init.js');

test('dry run lists files without writing them', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dry-run-'));

  try {
    const output = execFileSync(process.execPath, [cli, '--dry-run'], {
      cwd: target,
      encoding: 'utf8'
    });

    assert.match(output, /would create AGENTS\.md/);
    assert.match(output, /Dry run complete\./);
    assert.deepEqual(fs.readdirSync(target), []);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('initialization copies the template files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-init-'));

  try {
    execFileSync(process.execPath, [cli], { cwd: target });

    assert.equal(fs.existsSync(path.join(target, 'AGENTS.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'README.md')), true);
    assert.equal(fs.existsSync(path.join(target, 'openspec', 'project.md')), true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
