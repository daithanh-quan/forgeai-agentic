import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseRouterPayload, projectRoot, runTs } from './helpers.js';

test('router falls back to the current model when selected CLI is missing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-router-'));
  const aiDir = path.join(target, '.ai');
  const assignmentPath = path.join(target, 'assignment.md');
  const routingPath = path.join(aiDir, 'model-routing.yaml');
  const adaptersPath = path.join(aiDir, 'cli-adapters.json');
  const router = path.join(projectRoot, 'templates', '.ai', 'router', 'run-model.ts');

  try {
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(
      routingPath,
      ['version: 1', 'tiers:', '  fast:', '    provider: missing-test-provider', '    model: missing-test-model', '    token_budget: 1000'].join('\n')
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

    const output = runTs(
      router,
      ['--tier', 'fast', '--routing', routingPath, '--adapters', adaptersPath, '--assignment', assignmentPath],
      { cwd: target }
    );
    const payload = parseRouterPayload(output);

    assert.equal(payload.status, 'fallback');
    assert.equal(payload.reason, 'missing_command');
    assert.equal(payload.behavior, 'current_model_executes_locally');
    assert.equal(payload.provider, 'missing-test-provider');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('router dry-run uses the AGY fast-tier adapter', () => {
  const output = runTs(
    path.join(projectRoot, 'templates', '.ai', 'router', 'run-model.ts'),
    [
      '--tier',
      'fast',
      '--routing',
      path.join(projectRoot, 'templates', '.ai', 'model-routing.yaml'),
      '--adapters',
      path.join(projectRoot, 'templates', '.ai', 'cli-adapters.json'),
      '--assignment',
      path.join(projectRoot, 'templates', '.ai', 'state', 'assignments', 'TASK-CODEX-TEST.md'),
      '--dry-run'
    ],
    { cwd: projectRoot }
  );
  const payload = parseRouterPayload(output);

  assert.equal(payload.command, 'agy');
  assert.deepEqual(payload.args, ['--model', 'Gemini 3.5 Flash (Low)', '--print']);
  assert.equal(payload.input, 'stdin');
});

test('router falls back to the current model when delegated CLI command fails', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-router-fail-'));
  const aiDir = path.join(target, '.ai');
  const assignmentPath = path.join(target, 'assignment.md');
  const routingPath = path.join(aiDir, 'model-routing.yaml');
  const adaptersPath = path.join(aiDir, 'cli-adapters.json');
  const router = path.join(projectRoot, 'templates', '.ai', 'router', 'run-model.ts');

  try {
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(
      routingPath,
      ['version: 1', 'tiers:', '  standard:', '    provider: failing-test-provider', '    model: failing-test-model', '    token_budget: 1000'].join('\n')
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

    const output = runTs(
      router,
      ['--tier', 'standard', '--routing', routingPath, '--adapters', adaptersPath, '--assignment', assignmentPath],
      { cwd: target }
    );
    const payload = parseRouterPayload(output);

    assert.equal(payload.status, 'fallback');
    assert.equal(payload.reason, 'command_failed');
    assert.equal(payload.behavior, 'current_model_executes_locally');
    assert.equal(payload.provider, 'failing-test-provider');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
