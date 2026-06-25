import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type HarnessManifest, runTs } from './helpers.js';

test('dry run lists files without writing them', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-dry-run-'));

  try {
    const output = runTs(cli, ['--dry-run'], { cwd: target });

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
    runTs(cli, [], { cwd: target });

    assert.equal(fs.existsSync(path.join(target, 'AGENTS.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'README.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'MODEL_ROUTING.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'model-routing.yaml')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'cli-adapters.json')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'router', 'run-model.ts')), true);
    assert.equal(
      fs.existsSync(path.join(target, '.ai', 'state', 'assignments', 'TASK-REVIEWER-SMOKE.md')),
      true
    );
    assert.equal(fs.existsSync(path.join(target, '.ai', 'state', 'sessions.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'delegated-assignment.md')), true);
    assert.equal(fs.existsSync(path.join(target, 'openspec', 'project.md')), true);

    const routing = fs.readFileSync(path.join(target, '.ai', 'model-routing.yaml'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')) as HarnessManifest;

    assert.equal(manifest.package_version, '1.5.0');
    assert.equal(manifest.profile, 'base');
    assert.match(routing, /provider: agy/);
    assert.match(routing, /score_range: \[0, 2\]/);
    assert.match(routing, /provider: codex/);
    assert.match(routing, /score_range: \[3, 5\]/);
    assert.match(routing, /score_range: \[6, 8\]/);
    assert.match(routing, /score_range: \[9, 10\]/);
    assert.match(routing, /provider: current/);
    assert.match(routing, /route_behavior: keep_with_orchestrator/);
    assert.match(routing, /current_model_executes_locally/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('help and version report CLI metadata', () => {
  const helpOutput = runTs(cli, ['--help']);
  const versionOutput = runTs(cli, ['--version']);

  assert.match(helpOutput, /Usage:/);
  assert.match(helpOutput, /forgeai-init --check-git/);
  assert.match(helpOutput, /forgeai-init --check-sessions/);
  assert.match(helpOutput, /forgeai-init --check-profile/);
  assert.match(helpOutput, /--profile\s+Apply an optional stack profile/);
  assert.match(helpOutput, /--version\s+Print the package version/);
  assert.equal(versionOutput.trim(), '1.5.0');
});

test('list-profiles reports supported profiles', () => {
  const output = runTs(cli, ['--list-profiles']);

  assert.match(output, /^base$/m);
  assert.match(output, /^nextjs$/m);
  assert.match(output, /^node-api$/m);
  assert.match(output, /^tauri$/m);
  assert.match(output, /^monorepo$/m);
  assert.match(output, /^python-api$/m);
  assert.match(output, /^mobile$/m);
});

test('upgrade overwrites harness files and preserves installed profile', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-'));

  try {
    runTs(cli, ['--profile', 'nextjs'], { cwd: target });
    fs.writeFileSync(path.join(target, '.ai', 'README.md'), '# Old harness\n');
    fs.writeFileSync(
      path.join(target, '.ai', 'manifest.json'),
      JSON.stringify(
        {
          version: 1,
          package: 'forgeai-agentic-init',
          package_version: '1.3.0',
          profile: 'nextjs',
          initialized_at: '2026-06-01T00:00:00.000Z'
        },
        null,
        2
      )
    );

    runTs(cli, ['--upgrade', '--skip-update-check'], { cwd: target });

    const manifest = JSON.parse(fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')) as HarnessManifest;
    const readme = fs.readFileSync(path.join(target, '.ai', 'README.md'), 'utf8');

    assert.equal(manifest.package_version, '1.5.0');
    assert.equal(manifest.profile, 'nextjs');
    assert.match(readme, /# AI Project Harness/);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'profiles', 'nextjs.md')), true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
