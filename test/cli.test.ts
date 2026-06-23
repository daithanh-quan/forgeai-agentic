import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

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
  stderr?: string | Buffer;
};

type HarnessManifest = {
  package_version?: string;
  profile?: string;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxLoader = pathToFileURL(path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
const cli = path.join(projectRoot, 'bin/forgeai-init.ts');

function parseRouterPayload(output: string): RouterPayload {
  return JSON.parse(output) as RouterPayload;
}

function runTs(file: string, args: string[], options: Parameters<typeof execFileSync>[2] = {}): string {
  return execFileSync(process.execPath, ['--import', tsxLoader, file, ...args], {
    ...options,
    encoding: 'utf8'
  }) as string;
}

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
    assert.equal(
      fs.existsSync(path.join(target, '.ai', 'workflows', 'delegated-assignment.md')),
      true
    );
    assert.equal(fs.existsSync(path.join(target, 'openspec', 'project.md')), true);

    const routing = fs.readFileSync(path.join(target, '.ai', 'model-routing.yaml'), 'utf8');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;

    assert.equal(manifest.package_version, '1.4.0');
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
  assert.match(helpOutput, /forgeai-init --check-profile/);
  assert.match(helpOutput, /--profile\s+Apply an optional stack profile/);
  assert.match(helpOutput, /--version\s+Print the package version/);
  assert.equal(versionOutput.trim(), '1.4.0');
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

test('profile initialization installs stack-specific files and manifest', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-profile-nextjs-'));

  try {
    runTs(cli, ['--profile', 'nextjs'], { cwd: target });

    assert.equal(fs.existsSync(path.join(target, '.ai', 'profiles', 'nextjs.md')), true);
    assert.equal(
      fs.existsSync(path.join(target, '.ai', 'skills', 'nextjs-implementation', 'SKILL.md')),
      true
    );
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'nextjs-change.md')), true);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.package_version, '1.4.0');
    assert.equal(manifest.profile, 'nextjs');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('auto profile detects Next.js project signals', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-profile-auto-'));

  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ dependencies: { next: '^15.0.0' } }, null, 2)
    );

    const output = runTs(cli, ['--profile', 'auto'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;

    assert.match(output, /created \.ai\/profiles\/nextjs\.md/);
    assert.equal(manifest.profile, 'nextjs');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-profile validates installed profile files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-profile-'));

  try {
    fs.writeFileSync(
      path.join(target, 'package.json'),
      JSON.stringify({ dependencies: { express: '^5.0.0' } }, null, 2)
    );
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

test('check validates a freshly initialized harness', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-check-ready-'));

  try {
    runTs(cli, [], { cwd: target });

    const output = runTs(cli, ['--check'], {
      cwd: target,
      env: { ...process.env, PATH: '' }
    });

    assert.match(output, /ok\s+\.ai\/skills\/frontend-implementation\/SKILL\.md/);
    assert.match(output, /ok\s+\.claude\/skills\/reviewer\/SKILL\.md/);
    assert.match(output, /ok\s+openspec\/changes\/_template\/tasks\.md/);
    assert.match(output, /Result: harness installed, but project context still needs bootstrap\./);
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

test('git check reports missing repository outside git', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-git-missing-'));

  try {
    assert.throws(
      () => runTs(cli, ['--check-git'], { cwd: target }),
      (error: unknown) => {
        const execError = error as ExecError;
        const stdout = String(execError.stdout ?? '');
        assert.match(stdout, /ForgeAI git check/);
        assert.match(stdout, /missing\s+not inside a git worktree/);
        assert.match(stdout, /Result: git repository not found/);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('git check allows semantic local branch without a remote', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-git-local-'));

  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: target });
    fs.writeFileSync(path.join(target, 'README.md'), '# Test\n');
    execFileSync('git', ['add', 'README.md'], { cwd: target });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'chore: init'], {
      cwd: target
    });
    execFileSync('git', ['switch', '-c', 'feat/local-worktree-check'], { cwd: target });

    const output = runTs(cli, ['--check-git'], { cwd: target });

    assert.match(output, /provider: none/);
    assert.match(output, /remote: not configured/);
    assert.match(output, /ok\s+feat\/local-worktree-check/);
    assert.match(output, /Recommendation: no remote is connected/);
    assert.match(output, /Result: git workflow is usable/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('git check rejects invalid branch names', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-git-invalid-'));

  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: target });
    fs.writeFileSync(path.join(target, 'README.md'), '# Test\n');
    execFileSync('git', ['add', 'README.md'], { cwd: target });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'chore: init'], {
      cwd: target
    });
    execFileSync('git', ['switch', '-c', 'agent/test-task'], { cwd: target });

    assert.throws(
      () => runTs(cli, ['--check-git'], { cwd: target }),
      (error: unknown) => {
        const execError = error as ExecError;
        const stdout = String(execError.stdout ?? '');
        assert.match(stdout, /invalid\s+agent\/test-task should use feat\/, fix\/, docs\//);
        assert.match(stdout, /Result: git workflow needs attention/);
        return true;
      }
    );
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
  const router = path.join(projectRoot, 'templates', '.ai', 'router', 'run-model.ts');

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

    const output = runTs(
      router,
      [
        '--tier',
        'fast',
        '--routing',
        routingPath,
        '--adapters',
        adaptersPath,
        '--assignment',
        assignmentPath
      ],
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

    const output = runTs(
      router,
      [
        '--tier',
        'standard',
        '--routing',
        routingPath,
        '--adapters',
        adaptersPath,
        '--assignment',
        assignmentPath
      ],
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
