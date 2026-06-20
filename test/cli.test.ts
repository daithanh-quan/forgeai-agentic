import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

type RouterPayload = {
  status?: string;
  reason?: string;
  behavior?: string;
  provider?: string;
  command?: string;
  args?: string[];
  input?: string;
};

type ExecError = Error & {
  stdout?: string | Buffer;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(projectRoot, 'bin/forgeai-init.js');

function parseRouterPayload(output: string): RouterPayload {
  return JSON.parse(output) as RouterPayload;
}

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

test('check reports an incomplete harness when required files are missing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-missing-'));

  try {
    assert.throws(
      () =>
        execFileSync(process.execPath, [cli, '--check'], {
          cwd: target,
          encoding: 'utf8',
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
    execFileSync(process.execPath, [cli], { cwd: target });

    const output = execFileSync(process.execPath, [cli, '--check'], {
      cwd: target,
      encoding: 'utf8',
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
    execFileSync(process.execPath, [cli], { cwd: target });
    fs.mkdirSync(fakeBin);

    for (const command of ['agy', 'codex']) {
      const commandPath = path.join(fakeBin, command);
      fs.writeFileSync(commandPath, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(commandPath, 0o755);
    }

    const output = execFileSync(process.execPath, [cli, '--check'], {
      cwd: target,
      encoding: 'utf8',
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
  const output = execFileSync(
    process.execPath,
    [
      path.join(projectRoot, 'templates', '.ai', 'router', 'run-model.js'),
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
    {
      cwd: projectRoot,
      encoding: 'utf8'
    }
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
    const payload = parseRouterPayload(output);

    assert.equal(payload.status, 'fallback');
    assert.equal(payload.reason, 'command_failed');
    assert.equal(payload.behavior, 'current_model_executes_locally');
    assert.equal(payload.provider, 'failing-test-provider');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
