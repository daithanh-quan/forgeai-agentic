import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, runTs } from './helpers.js';

test('upgrade preserves populated project context and state files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-preserve-'));

  try {
    runTs(cli, [], { cwd: target });

    const projectPath = path.join(target, '.ai', 'PROJECT.md');
    const memoryPath = path.join(target, '.ai', 'MEMORY.md');
    const registryPath = path.join(target, '.ai', 'AGENT_REGISTRY.md');
    const graphPath = path.join(target, '.ai', 'codegraph', 'graph.json');
    const currentPath = path.join(target, '.ai', 'state', 'CURRENT.md');

    fs.writeFileSync(projectPath, '# Real Project\n\nPopulated by the team.\n');
    fs.writeFileSync(memoryPath, '# Real Memory\n\nDecision log entry.\n');
    fs.writeFileSync(registryPath, '# Real Registry\n\nProject agents listed here.\n');
    fs.writeFileSync(graphPath, JSON.stringify({ schema_version: 1, source: 'real-scan', nodes: [{ id: 'app' }] }));
    fs.writeFileSync(currentPath, '# Current\n\nActive task notes.\n');

    const output = runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(fs.readFileSync(projectPath, 'utf8'), /Real Project/);
    assert.match(fs.readFileSync(memoryPath, 'utf8'), /Real Memory/);
    assert.match(fs.readFileSync(registryPath, 'utf8'), /Real Registry/);
    assert.match(fs.readFileSync(graphPath, 'utf8'), /real-scan/);
    assert.match(fs.readFileSync(currentPath, 'utf8'), /Active task notes/);
    assert.match(output, /preserved \.ai\/PROJECT\.md/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('upgrade preserves a tuned security policy with approved exceptions', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-policy-'));

  try {
    runTs(cli, [], { cwd: target });

    const policyPath = path.join(target, '.ai', 'security-policy.yaml');
    fs.appendFileSync(policyPath, '\nallowed_path_exceptions:\n  - test/fixtures/dummy-key.pem\n');

    const output = runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(fs.readFileSync(policyPath, 'utf8'), /test\/fixtures\/dummy-key\.pem/);
    assert.match(output, /preserved \.ai\/security-policy\.yaml/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('upgrade still refreshes framework template files', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-refresh-'));

  try {
    runTs(cli, [], { cwd: target });

    const agentPath = path.join(target, '.ai', 'agents', 'orchestrator.md');
    fs.writeFileSync(agentPath, 'STALE LOCAL EDIT\n');

    runTs(cli, ['--upgrade'], { cwd: target });

    assert.doesNotMatch(fs.readFileSync(agentPath, 'utf8'), /STALE LOCAL EDIT/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('upgrade --force overwrites preserved files too', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-force-'));

  try {
    runTs(cli, [], { cwd: target });

    const projectPath = path.join(target, '.ai', 'PROJECT.md');
    fs.writeFileSync(projectPath, '# Real Project\n');

    runTs(cli, ['--upgrade', '--force'], { cwd: target });

    assert.doesNotMatch(fs.readFileSync(projectPath, 'utf8'), /Real Project/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('upgrade refreshes harness-managed state templates but keeps run state', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-state-'));

  try {
    runTs(cli, [], { cwd: target });

    const lifecyclePath = path.join(target, '.ai', 'state', 'lifecycle.md');
    const taskTemplatePath = path.join(target, '.ai', 'state', 'tasks', '_template.md');
    const assignmentPath = path.join(target, '.ai', 'state', 'assignments', 'TASK-CODEX-TEST.md');
    const currentPath = path.join(target, '.ai', 'state', 'CURRENT.md');
    const sessionsPath = path.join(target, '.ai', 'state', 'sessions.md');

    fs.writeFileSync(lifecyclePath, 'STALE LIFECYCLE\n');
    fs.writeFileSync(taskTemplatePath, 'STALE TEMPLATE\n');
    fs.writeFileSync(assignmentPath, 'STALE ASSIGNMENT\n');
    fs.writeFileSync(currentPath, '# Current\n\nActive task notes.\n');
    fs.writeFileSync(sessionsPath, '# Sessions\n\nMy real session row.\n');

    runTs(cli, ['--upgrade'], { cwd: target });

    assert.doesNotMatch(fs.readFileSync(lifecyclePath, 'utf8'), /STALE LIFECYCLE/);
    assert.doesNotMatch(fs.readFileSync(taskTemplatePath, 'utf8'), /STALE TEMPLATE/);
    assert.doesNotMatch(fs.readFileSync(assignmentPath, 'utf8'), /STALE ASSIGNMENT/);
    assert.match(fs.readFileSync(currentPath, 'utf8'), /Active task notes/);
    assert.match(fs.readFileSync(sessionsPath, 'utf8'), /My real session row/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('upgrade survives an invalid manifest instead of crashing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-bad-manifest-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(path.join(target, '.ai', 'manifest.json'), '{ "profile": "base", ');

    const output = runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(output, /invalid \.ai\/manifest\.json/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('auto profile reports invalid package.json instead of crashing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-invalid-pkg-auto-'));

  try {
    fs.writeFileSync(path.join(target, 'package.json'), '{ "name": "broken", ');

    const output = runTs(cli, ['--profile', 'auto'], { cwd: target });

    assert.match(output, /invalid package\.json/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('forgeai-init creates .gitignore with context-state entries when absent', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-gitignore-create-'));
  try {
    assert.ok(!fs.existsSync(path.join(target, '.gitignore')));
    runTs(cli, [], { cwd: target });
    const gitignore = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    assert.match(gitignore, /\.ai\/state\/context\//);
    assert.match(gitignore, /\.ai\/state\/context-routes\.md/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('forgeai-init appends context-state entries idempotently with trailing newline', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-gitignore-idem-'));
  try {
    // Pre-existing .gitignore without trailing newline, with one of the entries
    fs.writeFileSync(path.join(target, '.gitignore'), 'node_modules\n.ai/state/context/');
    runTs(cli, [], { cwd: target });
    const content = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    // Must have trailing newline
    assert.ok(content.endsWith('\n'));
    // Must contain both entries exactly once
    const lines = content.split('\n');
    assert.equal(lines.filter((l) => l === '.ai/state/context/').length, 1);
    assert.ok(lines.includes('.ai/state/context-routes.md'));
    // Run again — no duplicates
    runTs(cli, [], { cwd: target });
    const content2 = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    const lines2 = content2.split('\n');
    assert.equal(lines2.filter((l) => l === '.ai/state/context/').length, 1);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade also writes context-state gitignore entries', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-gitignore-upgrade-'));
  try {
    runTs(cli, [], { cwd: target });
    // Delete .gitignore to simulate older install
    fs.rmSync(path.join(target, '.gitignore'), { force: true });
    runTs(cli, ['--upgrade'], { cwd: target });
    const content = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    assert.match(content, /\.ai\/state\/context\//);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// --- Preview path ---

test('--upgrade --dry-run reports "would update" for managed files with changed content', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-preview-update-'));
  try {
    runTs(cli, [], { cwd: target });

    const agentPath = path.join(target, '.ai', 'agents', 'orchestrator.md');
    fs.writeFileSync(agentPath, fs.readFileSync(agentPath, 'utf8') + '\nSTALE_MARKER\n');

    const output = runTs(cli, ['--upgrade', '--dry-run'], { cwd: target });

    assert.match(output, /would update \.ai\/agents\/orchestrator\.md/);
    // Dry run must not modify anything
    assert.match(fs.readFileSync(agentPath, 'utf8'), /STALE_MARKER/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade --dry-run reports "no change" for managed files already up-to-date', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-preview-nochange-'));
  try {
    runTs(cli, [], { cwd: target });
    const output = runTs(cli, ['--upgrade', '--dry-run'], { cwd: target });

    assert.match(output, /no change/);
    assert.doesNotMatch(output, /would update/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// --- Apply path ---

test('--upgrade logs "updated" and overwrites managed files with changed content', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-apply-update-'));
  try {
    runTs(cli, [], { cwd: target });

    const agentPath = path.join(target, '.ai', 'agents', 'orchestrator.md');
    fs.writeFileSync(agentPath, fs.readFileSync(agentPath, 'utf8') + '\nSTALE_MARKER\n');

    const output = runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(output, /updated \.ai\/agents\/orchestrator\.md/);
    assert.doesNotMatch(fs.readFileSync(agentPath, 'utf8'), /STALE_MARKER/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade logs "no change" and skips copy for managed files already up-to-date', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-apply-nochange-'));
  try {
    runTs(cli, [], { cwd: target });
    const output = runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(output, /no change/);
    assert.doesNotMatch(output, /\bupdated\b/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade creates a missing managed file and logs "created"', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-apply-create-'));
  try {
    runTs(cli, [], { cwd: target });

    const agentPath = path.join(target, '.ai', 'agents', 'orchestrator.md');
    fs.rmSync(agentPath);

    const output = runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(output, /created \.ai\/agents\/orchestrator\.md/);
    assert.ok(fs.existsSync(agentPath));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('upgrade does not touch user-created evaluation run records', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-eval-'));
  try {
    runTs(cli, [], { cwd: target });

    const evalDir = path.join(target, '.ai', 'evaluation');
    fs.mkdirSync(evalDir, { recursive: true });
    const evalFile = path.join(evalDir, 'run-001.md');
    fs.writeFileSync(evalFile, '# Run 001\n\n- Run ID: run-001\n- Outcome: pass\n');

    runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(fs.readFileSync(evalFile, 'utf8'), /run-001/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('upgrade --force does not touch user-created evaluation run records', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-eval-force-'));
  try {
    runTs(cli, [], { cwd: target });

    const evalDir = path.join(target, '.ai', 'evaluation');
    fs.mkdirSync(evalDir, { recursive: true });
    const evalFile = path.join(evalDir, 'run-001.md');
    fs.writeFileSync(evalFile, '# Run 001\n\n- Run ID: run-001\n- Outcome: pass\n');

    runTs(cli, ['--upgrade', '--force'], { cwd: target });

    assert.match(fs.readFileSync(evalFile, 'utf8'), /run-001/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('check-profile reports invalid package.json instead of crashing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-invalid-pkg-check-'));

  try {
    runTs(cli, ['--profile', 'node-api'], { cwd: target });
    fs.writeFileSync(path.join(target, 'package.json'), '{ "name": "broken", ');

    let output = '';
    try {
      output = runTs(cli, ['--check-profile'], { cwd: target });
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }

    assert.match(output, /invalid package\.json/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
