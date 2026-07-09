import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, type HarnessManifest, runTs } from './helpers.js';

test('profile initialization installs stack-specific files and manifest', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-profile-nextjs-'));

  try {
    runTs(cli, ['--profile', 'nextjs'], { cwd: target });

    assert.equal(fs.existsSync(path.join(target, '.ai', 'profiles', 'nextjs.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'skills', 'nextjs-implementation', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'nextjs-change.md')), true);

    const manifest = JSON.parse(fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')) as HarnessManifest;
    assert.equal(manifest.package_version, '3.0.1');
    assert.equal(manifest.profile, 'nextjs');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('auto profile detects Next.js project signals', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-profile-auto-'));

  try {
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ dependencies: { next: '^15.0.0' } }, null, 2));

    const output = runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')) as HarnessManifest;

    assert.match(output, /created \.ai\/profiles\/nextjs\.md/);
    assert.equal(manifest.profile, 'nextjs');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-profile validates installed profile files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-profile-'));

  try {
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ dependencies: { express: '^5.0.0' } }, null, 2));
    runTs(cli, ['--profile', 'node-api'], { cwd: target });

    const output = runTs(cli, ['--check-profile'], { cwd: target });

    assert.match(output, /ForgeAI profile check/);
    assert.match(output, /profile: node-api/);
    assert.match(output, /detected\s+node-api/);
    assert.match(output, /ok\s+\.ai\/profiles\/node-api\.md/);
    assert.match(output, /Result: profile installed and consistent\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('unknown profile fails before writing files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-profile-invalid-'));

  try {
    assert.throws(
      () => runTs(cli, ['--profile', 'rails'], { cwd: target }),
      (error: unknown) => {
        const execError = error as ExecError;
        const stderr = String(execError.stderr ?? '');
        assert.match(stderr, /unknown profile "rails"/);
        assert.equal(fs.existsSync(path.join(target, '.ai')), false);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-profile reports an invalid manifest instead of crashing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-bad-manifest-check-'));

  try {
    runTs(cli, ['--profile', 'node-api'], { cwd: target });
    fs.writeFileSync(path.join(target, '.ai', 'manifest.json'), '{ "profile": "node-api", ');

    let output = '';
    try {
      output = runTs(cli, ['--check-profile'], { cwd: target });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }

    assert.match(output, /invalid \.ai\/manifest\.json/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
