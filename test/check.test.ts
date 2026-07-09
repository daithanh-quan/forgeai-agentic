import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

test('check validates a freshly initialized harness', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-ready-'));

  try {
    runTs(cli, [], { cwd: target });

    const output = runTs(cli, ['--check'], {
      cwd: target,
      env: { ...process.env, PATH: '' }
    });

    assert.match(output, /ok\s+\.ai\/skills\/frontend-implementation\/SKILL\.md/);
    assert.match(output, /ok\s+\.ai\/codegraph\/README\.md/);
    assert.match(output, /ok\s+\.ai\/codegraph\/graph\.json/);
    assert.match(output, /ok\s+\.ai\/codegraph\/hotspots\.md/);
    assert.match(output, /ok\s+\.ai\/workflows\/codegraph-context\.md/);
    assert.match(output, /ok\s+\.ai\/security-policy\.yaml/);
    assert.match(output, /ok\s+\.ai\/workflows\/supply-chain-safety\.md/);
    assert.match(output, /ok\s+\.ai\/state\/lifecycle\.md/);
    assert.match(output, /ok\s+\.ai\/state\/tasks\/_template\.md/);
    assert.match(output, /ok\s+\.ai\/workflows\/lifecycle-management\.md/);
    assert.match(output, /ok\s+\.ai\/workflows\/task-types\/dependency-upgrade\.md/);
    assert.match(output, /ok\s+\.claude\/skills\/planner\/SKILL\.md/);
    assert.match(output, /ok\s+\.claude\/skills\/reviewer\/SKILL\.md/);
    assert.match(output, /ok\s+openspec\/changes\/_template\/tasks\.md/);
    assert.match(output, /Session coordination/);
    assert.match(output, /ok\s+\.ai\/state\/sessions\.md \(0 active\)/);
    assert.match(output, /Result: harness installed, but project context still needs bootstrap\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check suggests updating when installed harness is behind latest version', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-outdated-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, '.ai', 'manifest.json'),
      JSON.stringify(
        {
          version: 1,
          package: 'forgeai-agentic-init',
          package_version: '1.3.0',
          profile: 'base',
          initialized_at: '2026-06-01T00:00:00.000Z'
        },
        null,
        2
      )
    );

    const output = runTs(cli, ['--check'], {
      cwd: target,
      env: { ...process.env, PATH: '', FORGEAI_TEST_LATEST_VERSION: '3.0.1' }
    });

    assert.match(output, /ForgeAI update check/);
    assert.match(output, /outdated\s+installed harness: 1\.3\.0/);
    assert.match(output, /ok\s+current CLI: 3\.0\.1/);
    assert.match(output, /latest\s+forgeai-agentic-init@3\.0\.1/);
    assert.match(output, /Recommendation: ask the human to run npx forgeai-agentic-init@latest --upgrade/);
    assert.match(output, /ForgeAI harness check/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('skip-update-check suppresses version preflight', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-skip-update-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, '.ai', 'manifest.json'),
      JSON.stringify(
        {
          version: 1,
          package: 'forgeai-agentic-init',
          package_version: '1.3.0',
          profile: 'base',
          initialized_at: '2026-06-01T00:00:00.000Z'
        },
        null,
        2
      )
    );

    const output = runTs(cli, ['--check', '--skip-update-check'], {
      cwd: target,
      env: { ...process.env, PATH: '', FORGEAI_TEST_LATEST_VERSION: '3.0.1' }
    });

    assert.doesNotMatch(output, /ForgeAI update check/);
    assert.match(output, /ForgeAI harness check/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check reports an incomplete harness when required files are missing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-missing-'));

  try {
    assert.throws(
      () =>
        runTs(cli, ['--check'], {
          cwd: target,
          env: { ...process.env, PATH: '' }
        }),
      (error: unknown) => {
        const execError = error as ExecError;
        const stdout = String(execError.stdout ?? '');
        assert.match(stdout, /ForgeAI harness check/);
        assert.match(stdout, /missing\s+CLAUDE\.md/);
        assert.match(stdout, /Result: harness incomplete/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check reports single-agent mode when no adapter CLIs are available', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-single-'));

  try {
    runTs(cli, [], { cwd: target });

    const output = runTs(cli, ['--check'], {
      cwd: target,
      env: { ...process.env, PATH: '' }
    });

    assert.match(output, /single-agent\s+current model must orchestrate, implement, review, and validate locally/);
    assert.match(output, /Result: harness installed, but project context still needs bootstrap\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check reports multi-agent mode when multiple adapter CLIs are available', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-multi-'));
  const fakeBin = path.join(target, 'bin');

  try {
    runTs(cli, [], { cwd: target });
    fs.mkdirSync(fakeBin);

    for (const command of ['agy', 'codex']) {
      const commandPath = path.join(fakeBin, command);
      fs.writeFileSync(commandPath, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(commandPath, 0o755);
    }

    const output = runTs(cli, ['--check'], {
      cwd: target,
      env: { ...process.env, PATH: fakeBin }
    });

    assert.match(output, /optional ok\s+codex \(codex\)/);
    assert.match(output, /optional ok\s+agy \(agy\)/);
    assert.match(output, /multi-agent\s+orchestrator can be current model or:/);
    assert.match(output, /human chooses orchestrator/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-all runs harness, codegraph, lifecycle, and profile checks', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-all-'));

  try {
    runTs(cli, [], { cwd: target });

    let output = '';
    try {
      output = runTs(cli, ['--check-all'], { cwd: target, env: { ...process.env, PATH: '' } });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }

    assert.match(output, /ForgeAI harness check/);
    assert.match(output, /ForgeAI CodeGraph check/);
    assert.match(output, /ForgeAI lifecycle check/);
    assert.match(output, /ForgeAI profile check/);
    assert.match(output, /ForgeAI approval gate check/);
    assert.match(output, /ForgeAI evaluation check/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-all exits non-zero while the CodeGraph is still a template', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-all-fail-'));

  try {
    runTs(cli, [], { cwd: target });

    assert.throws(
      () => runTs(cli, ['--check-all'], { cwd: target, env: { ...process.env, PATH: '' } }),
      (error: unknown) => {
        const stdout = String((error as ExecError).stdout ?? '');
        assert.match(stdout, /still contains template TODOs/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-all runs the supply-chain safety gate', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-checkall-security-'));

  try {
    runTs(cli, [], { cwd: target });
    let stdout = '';
    try {
      stdout = runTs(cli, ['--check-all'], { cwd: target, env: { ...process.env, PATH: '' } });
    } catch (error) {
      stdout = String((error as ExecError).stdout ?? '');
    }
    assert.match(stdout, /ForgeAI supply-chain safety check/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
