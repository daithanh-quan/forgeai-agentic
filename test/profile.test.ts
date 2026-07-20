import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, type HarnessManifest, runTs, projectRoot } from './helpers.js';

const CURRENT_VERSION = (
  JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as { version: string }
).version;

test('profile initialization installs stack-specific files and manifest', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-profile-nextjs-'));

  try {
    runTs(cli, ['--profile', 'nextjs'], { cwd: target });

    assert.equal(fs.existsSync(path.join(target, '.ai', 'profiles', 'nextjs.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'skills', 'nextjs-implementation', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'nextjs-change.md')), true);

    const manifest = JSON.parse(fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')) as HarnessManifest;
    assert.equal(manifest.package_version, CURRENT_VERSION);
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

test('--profile without a value exits 1 and reports error', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-profile-novalue-'));
  try {
    assert.throws(
      () => runTs(cli, ['--profile'], { cwd: target }),
      (error: unknown) => {
        const execError = error as ExecError;
        assert.match(String(execError.stderr ?? ''), /--profile requires a value/i);
        assert.equal(fs.existsSync(path.join(target, '.ai')), false);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade --profile (no value) exits 1 and reports error', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-profile-novalue-'));
  try {
    runTs(cli, [], { cwd: target }); // install base first
    assert.throws(
      () => runTs(cli, ['--upgrade', '--profile'], { cwd: target }),
      (error: unknown) => {
        assert.match(String((error as ExecError).stderr ?? ''), /--profile requires a value/i);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('duplicate --profile where the second occurrence has no value exits 1', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-profile-dup-novalue-'));
  try {
    assert.throws(
      () => runTs(cli, ['--profile', 'go', '--profile'], { cwd: target }),
      (error: unknown) => {
        assert.match(String((error as ExecError).stderr ?? ''), /--profile requires a value/i);
        assert.equal(fs.existsSync(path.join(target, '.ai')), false);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--profile --upgrade (flag as value) exits 1 and reports error', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-profile-flag-as-value-'));
  try {
    assert.throws(
      () => runTs(cli, ['--profile', '--upgrade'], { cwd: target }),
      (error: unknown) => {
        assert.match(String((error as ExecError).stderr ?? ''), /--profile requires a value/i);
        assert.equal(fs.existsSync(path.join(target, '.ai')), false);
        return true;
      }
    );
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
        assert.match(stderr, /unknown profile(?: component)? "rails"/);
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

    assert.match(output, /invalid.*\.ai\/manifest\.json/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-profile reports corrupt manifest when profile field is a number', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-manifest-num-'));

  try {
    runTs(cli, ['--profile', 'node-api'], { cwd: target });
    fs.writeFileSync(path.join(target, '.ai', 'manifest.json'), JSON.stringify({ version: 1, profile: 123 }));

    let output = '';
    try {
      output = runTs(cli, ['--check-profile'], { cwd: target });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }

    assert.match(output, /wrong type|corrupt/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-profile reports corrupt manifest when profile field is an array', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-manifest-arr-'));

  try {
    runTs(cli, ['--profile', 'node-api'], { cwd: target });
    fs.writeFileSync(path.join(target, '.ai', 'manifest.json'), JSON.stringify({ version: 1, profile: ['node-api'] }));

    let output = '';
    try {
      output = runTs(cli, ['--check-profile'], { cwd: target });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }

    assert.match(output, /wrong type|corrupt/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--profile on existing install without --upgrade fails before writing files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-profile-existing-'));
  try {
    runTs(cli, [], { cwd: target }); // base install
    const manifestBefore = fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8');
    assert.throws(
      () => runTs(cli, ['--profile', 'go'], { cwd: target }),
      (error: unknown) => {
        const execError = error as ExecError;
        assert.match(String(execError.stderr ?? ''), /already installed/i);
        // manifest must be unchanged
        assert.equal(fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8'), manifestBefore);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade --profile go on existing install succeeds and updates manifest', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-profile-go-'));
  try {
    runTs(cli, [], { cwd: target }); // base install
    runTs(cli, ['--upgrade', '--profile', 'go'], { cwd: target });
    const manifest = JSON.parse(fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')) as HarnessManifest;
    assert.equal(manifest.profile, 'go');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--profile= (empty value via = form) exits 1 and reports error', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-profile-eq-empty-'));
  try {
    assert.throws(
      () => runTs(cli, ['--profile='], { cwd: target }),
      (error: unknown) => {
        assert.match(String((error as ExecError).stderr ?? ''), /--profile requires a value/i);
        assert.equal(fs.existsSync(path.join(target, '.ai')), false);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('duplicate --profile go --profile node-api exits 1', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-profile-dup-values-'));
  try {
    assert.throws(
      () => runTs(cli, ['--profile', 'go', '--profile', 'node-api'], { cwd: target }),
      (error: unknown) => {
        assert.match(String((error as ExecError).stderr ?? ''), /--profile cannot be specified more than once/i);
        assert.equal(fs.existsSync(path.join(target, '.ai')), false);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
