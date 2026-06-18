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
    assert.equal(fs.existsSync(path.join(target, '.ai', 'MODEL_ROUTING.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'model-routing.yaml')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'cli-adapters.json')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'router', 'run-model.js')), true);
    assert.equal(
      fs.existsSync(path.join(target, '.ai', 'state', 'assignments', 'TASK-REVIEWER-SMOKE.md')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(target, '.ai', 'workflows', 'delegated-assignment.md')),
      true
    );
    assert.equal(fs.existsSync(path.join(target, 'openspec', 'project.md')), true);

    const routing = fs.readFileSync(path.join(target, '.ai', 'model-routing.yaml'), 'utf8');
    assert.match(routing, /provider: gemini/);
    assert.match(routing, /score_range: \[0, 2\]/);
    assert.match(routing, /provider: codex/);
    assert.match(routing, /score_range: \[3, 5\]/);
    assert.match(routing, /score_range: \[6, 8\]/);
    assert.match(routing, /score_range: \[9, 10\]/);
    assert.match(routing, /provider: claude/);
    assert.match(routing, /current_model_executes_locally/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('router falls back to the current model when selected CLI is missing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-router-'));
  const aiDir = path.join(target, '.ai');
  const assignmentPath = path.join(target, 'assignment.md');
  const routingPath = path.join(aiDir, 'model-routing.yaml');
  const adaptersPath = path.join(aiDir, 'cli-adapters.json');
  const router = path.join(projectRoot, 'templates', '.ai', 'router', 'run-model.js');

  try {
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(
      routingPath,
      [
        'version: 1',
        'tiers:',
        '  fast:',
        '    provider: missing-test-provider',
        '    model: missing-test-model',
        '    token_budget: 1000'
      ].join('\n')
    );
    fs.writeFileSync(
      adaptersPath,
      JSON.stringify(
        {
          version: 1,
          fallback: {
            behavior: 'current_model_executes_locally',
            on: ['missing_command']
          },
          adapters: {
            'missing-test-provider': {
              command: 'forgeai-definitely-missing-cli',
              args: ['--model', '{model}'],
              healthcheck: {
                args: ['--version'],
                timeout_ms: 5000
              },
              input: 'stdin',
              quota_patterns: []
            }
          }
        },
        null,
        2
      )
    );
    fs.writeFileSync(assignmentPath, '# Assignment\n');

    const output = execFileSync(
      process.execPath,
      [
        router,
        '--tier',
        'fast',
        '--routing',
        routingPath,
        '--adapters',
        adaptersPath,
        '--assignment',
        assignmentPath
      ],
      {
        cwd: target,
        encoding: 'utf8'
      }
    );
    const payload = JSON.parse(output);

    assert.equal(payload.status, 'fallback');
    assert.equal(payload.reason, 'missing_command');
    assert.equal(payload.behavior, 'current_model_executes_locally');
    assert.equal(payload.provider, 'missing-test-provider');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('router falls back to the current model when delegated CLI command fails', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-router-fail-'));
  const aiDir = path.join(target, '.ai');
  const assignmentPath = path.join(target, 'assignment.md');
  const routingPath = path.join(aiDir, 'model-routing.yaml');
  const adaptersPath = path.join(aiDir, 'cli-adapters.json');
  const router = path.join(projectRoot, 'templates', '.ai', 'router', 'run-model.js');

  try {
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(
      routingPath,
      [
        'version: 1',
        'tiers:',
        '  standard:',
        '    provider: failing-test-provider',
        '    model: failing-test-model',
        '    token_budget: 1000'
      ].join('\n')
    );
    fs.writeFileSync(
      adaptersPath,
      JSON.stringify(
        {
          version: 1,
          fallback: {
            behavior: 'current_model_executes_locally',
            on: ['command_failed']
          },
          adapters: {
            'failing-test-provider': {
              command: process.execPath,
              args: ['-e', "console.error('delegated failure'); process.exit(2);"],
              healthcheck: {
                args: ['--version'],
                timeout_ms: 5000
              },
              input: 'stdin',
              quota_patterns: []
            }
          }
        },
        null,
        2
      )
    );
    fs.writeFileSync(assignmentPath, '# Assignment\n');

    const output = execFileSync(
      process.execPath,
      [
        router,
        '--tier',
        'standard',
        '--routing',
        routingPath,
        '--adapters',
        adaptersPath,
        '--assignment',
        assignmentPath
      ],
      {
        cwd: target,
        encoding: 'utf8'
      }
    );
    const payload = JSON.parse(output);

    assert.equal(payload.status, 'fallback');
    assert.equal(payload.reason, 'command_failed');
    assert.equal(payload.behavior, 'current_model_executes_locally');
    assert.equal(payload.provider, 'failing-test-provider');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
