import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, parseRouterPayload, projectRoot, runTs } from './helpers.js';

const router = path.join(projectRoot, 'templates', '.ai', 'router', 'run-model.ts');

function initHarness(prefix: string): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  runTs(cli, ['--skip-update-check'], { cwd: target });
  return target;
}

function readAdapters(target: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(target, '.ai/cli-adapters.json'), 'utf8')).adapters;
}

function readRouting(target: string): string {
  return fs.readFileSync(path.join(target, '.ai/model-routing.yaml'), 'utf8');
}

test('add-model registers an adapter with defaults and leaves routing untouched', () => {
  const target = initHarness('forgeai-add-min-');
  try {
    const before = readRouting(target);
    runTs(cli, ['--skip-update-check', '--add-model', 'glm', '--model', 'glm-4.6'], { cwd: target });

    const glm = readAdapters(target).glm;
    assert.equal(glm.command, 'glm');
    assert.deepEqual(glm.args, ['--model', '{model}']);
    assert.equal(glm.input, 'stdin');
    assert.deepEqual(glm.healthcheck, { args: ['--version'], timeout_ms: 5000 });
    assert.ok(Array.isArray(glm.quota_patterns) && glm.quota_patterns.includes('rate limit'));

    // No --tier: the YAML must be byte-identical.
    assert.equal(readRouting(target), before);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('add-model --tier repoints exactly one tier and the router resolves it', () => {
  const target = initHarness('forgeai-add-tier-');
  try {
    runTs(cli, ['--skip-update-check', '--add-model', 'glm', '--model', 'glm-4.6', '--tier', 'standard'], {
      cwd: target
    });

    const yaml = readRouting(target);
    const standardBlock = yaml.slice(yaml.indexOf('\n  standard:'), yaml.indexOf('\n  strong:'));
    assert.match(standardBlock, /\n    provider: glm\n/);
    assert.match(standardBlock, /\n    model: glm-4\.6\n/);
    // The tier's other fields survive untouched.
    assert.match(standardBlock, /\n    score_range: \[3, 5\]\n/);
    assert.match(standardBlock, /\n    token_budget: 8000\n/);
    assert.match(standardBlock, /- localized bug fixes/);
    // Other tiers are not touched.
    assert.match(yaml, /\n  fast:\n    provider: agy\n/);
    assert.match(yaml, /\n  strong:\n    provider: codex\n/);
    assert.match(yaml, /\n  lead:\n    provider: current\n/);

    // The hand-rolled readTier() in run-model.ts still parses the tier to glm.
    const assignment = path.join(target, 'task.md');
    fs.writeFileSync(assignment, 'do work');
    let output = '';
    try {
      output = runTs(router, ['--tier', 'standard', '--assignment', assignment], {
        cwd: target,
        env: { ...process.env, PATH: '' }
      });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.equal(parseRouterPayload(output).provider, 'glm');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('add-model stores overriding flags verbatim', () => {
  const target = initHarness('forgeai-add-override-');
  try {
    runTs(
      cli,
      [
        '--skip-update-check',
        '--add-model',
        'zai',
        '--command',
        'zai-cli',
        '--input',
        'argv',
        '--args',
        '["chat","--model","{model}","--message","{assignment}"]',
        '--healthcheck-args',
        'version',
        '--healthcheck-timeout',
        '8000'
      ],
      { cwd: target }
    );

    const zai = readAdapters(target).zai;
    assert.equal(zai.command, 'zai-cli');
    assert.equal(zai.input, 'argv');
    assert.deepEqual(zai.args, ['chat', '--model', '{model}', '--message', '{assignment}']);
    assert.deepEqual(zai.healthcheck, { args: ['version'], timeout_ms: 8000 });
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('add-model refuses to overwrite without --force, succeeds with it', () => {
  const target = initHarness('forgeai-add-force-');
  try {
    runTs(cli, ['--skip-update-check', '--add-model', 'glm', '--model', 'glm-4.6'], { cwd: target });

    assert.throws(
      () => runTs(cli, ['--skip-update-check', '--add-model', 'glm', '--model', 'glm-5'], { cwd: target }),
      (error: unknown) => {
        assert.match(String((error as ExecError).stderr ?? ''), /already exists.*--force/);
        return true;
      }
    );

    runTs(cli, ['--skip-update-check', '--add-model', 'glm', '--model', 'glm-5', '--command', 'glm5', '--force'], {
      cwd: target
    });
    assert.equal(readAdapters(target).glm.command, 'glm5');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('remove-model deletes the adapter and warns about dangling tiers', () => {
  const target = initHarness('forgeai-remove-');
  try {
    runTs(cli, ['--skip-update-check', '--add-model', 'glm', '--model', 'glm-4.6', '--tier', 'standard'], {
      cwd: target
    });

    const output = runTs(cli, ['--skip-update-check', '--remove-model', 'glm'], { cwd: target });
    assert.equal(readAdapters(target).glm, undefined);
    assert.match(output, /still references "glm"/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('list-models reports PATH availability per adapter', () => {
  const target = initHarness('forgeai-list-');
  const fakeBin = path.join(target, 'fakebin');
  try {
    runTs(cli, ['--skip-update-check', '--add-model', 'glm', '--model', 'glm-4.6'], { cwd: target });

    fs.mkdirSync(fakeBin);
    const glmPath = path.join(fakeBin, 'glm');
    fs.writeFileSync(glmPath, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(glmPath, 0o755);

    const available = runTs(cli, ['--skip-update-check', '--list-models'], {
      cwd: target,
      env: { ...process.env, PATH: fakeBin }
    });
    assert.match(available, /available\s+glm -> glm \(input: stdin\)/);

    const missing = runTs(cli, ['--skip-update-check', '--list-models'], {
      cwd: target,
      env: { ...process.env, PATH: '' }
    });
    assert.match(missing, /missing\s+glm -> glm/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('add-model errors when the harness is not initialized and writes nothing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-add-noharness-'));
  try {
    assert.throws(
      () => runTs(cli, ['--skip-update-check', '--add-model', 'glm', '--model', 'glm-4.6'], { cwd: target }),
      (error: unknown) => {
        assert.match(String((error as ExecError).stderr ?? ''), /not found.*forgeai-init/);
        return true;
      }
    );
    assert.equal(fs.existsSync(path.join(target, '.ai/cli-adapters.json')), false);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('add-model --dry-run changes no files', () => {
  const target = initHarness('forgeai-add-dryrun-');
  try {
    const adaptersBefore = fs.readFileSync(path.join(target, '.ai/cli-adapters.json'), 'utf8');
    const routingBefore = readRouting(target);

    const output = runTs(
      cli,
      ['--skip-update-check', '--add-model', 'glm', '--model', 'glm-4.6', '--tier', 'fast', '--dry-run'],
      { cwd: target }
    );

    assert.match(output, /would update .ai\/cli-adapters\.json/);
    assert.match(output, /would update .ai\/model-routing\.yaml/);
    assert.equal(fs.readFileSync(path.join(target, '.ai/cli-adapters.json'), 'utf8'), adaptersBefore);
    assert.equal(readRouting(target), routingBefore);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('add-model --tier handles a tier at the end of the routing file', () => {
  const target = initHarness('forgeai-add-eof-');
  try {
    // A minimal routing file whose target tier is the final block, no trailing key.
    const yamlPath = path.join(target, '.ai/model-routing.yaml');
    fs.writeFileSync(
      yamlPath,
      ['version: 1', 'tiers:', '  standard:', '    provider: codex', '    model: gpt-5.5', ''].join('\n')
    );

    runTs(cli, ['--skip-update-check', '--add-model', 'glm', '--model', 'glm-4.6', '--tier', 'standard'], {
      cwd: target
    });

    const assignment = path.join(target, 'task.md');
    fs.writeFileSync(assignment, 'do work');
    let output = '';
    try {
      output = runTs(router, ['--tier', 'standard', '--assignment', assignment], {
        cwd: target,
        env: { ...process.env, PATH: '' }
      });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.equal(parseRouterPayload(output).provider, 'glm');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
