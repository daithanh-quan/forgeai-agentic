import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, type HarnessManifest, runTs } from './helpers.js';

test('auto profile warns when a monorepo also has framework signals', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mono-warn-'));

  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'], dependencies: { next: '^15.0.0' } }, null, 2)
    );

    const output = runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;

    assert.equal(manifest.profile, 'monorepo');
    assert.match(output, /monorepo \+ nextjs/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-profile warns about a secondary stack inside a monorepo', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mono-check-'));

  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'], dependencies: { express: '^5.0.0' } }, null, 2)
    );
    runTs(cli, ['--profile', 'monorepo'], { cwd: target });

    let output = '';
    try {
      output = runTs(cli, ['--check-profile'], { cwd: target });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }

    assert.match(output, /monorepo \+ node-api/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
