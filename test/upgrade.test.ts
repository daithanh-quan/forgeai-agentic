import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, type HarnessManifest, runTs } from './helpers.js';
import { collectMigrationNotes } from '../bin/lib/upgrade-notes.js';
import { shouldRunUpdateCheck } from '../bin/lib/update-check.js';

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

test('--upgrade without --profile exits 1 when manifest JSON is truncated', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-bad-manifest-'));

  try {
    runTs(cli, ['--profile', 'go'], { cwd: target });
    const manifestPath = path.join(target, '.ai', 'manifest.json');
    fs.writeFileSync(manifestPath, '{ "profile": "go", '); // corrupt JSON

    let stderr = '';
    try {
      runTs(cli, ['--upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      stderr = String((error as ExecError).stderr ?? '');
    }
    assert.match(stderr, /corrupt/i);
    // Manifest must not have been overwritten
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), '{ "profile": "go", ');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade without --profile exits 1 when manifest JSON is null', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-null-manifest-'));

  try {
    runTs(cli, ['--profile', 'go'], { cwd: target });
    const manifestPath = path.join(target, '.ai', 'manifest.json');
    fs.writeFileSync(manifestPath, 'null');

    let stderr = '';
    try {
      runTs(cli, ['--upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      stderr = String((error as ExecError).stderr ?? '');
    }
    assert.match(stderr, /corrupt/i);
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), 'null');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade --profile <name> recovers from a truncated manifest JSON', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-recover-corrupt-'));

  try {
    runTs(cli, ['--profile', 'go'], { cwd: target });
    fs.writeFileSync(path.join(target, '.ai', 'manifest.json'), '{ "profile": "go", ');

    runTs(cli, ['--upgrade', '--profile', 'go'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'go');
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
    assert.match(gitignore, /\.ai\/state\/runs\//);
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
    // Must contain all three entries exactly once
    const lines = content.split('\n');
    assert.equal(lines.filter((l) => l === '.ai/state/context/').length, 1);
    assert.ok(lines.includes('.ai/state/context-routes.md'));
    assert.ok(lines.includes('.ai/state/runs/'));
    // Run again — no duplicates
    runTs(cli, [], { cwd: target });
    const content2 = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
    const lines2 = content2.split('\n');
    assert.equal(lines2.filter((l) => l === '.ai/state/context/').length, 1);
    assert.equal(lines2.filter((l) => l === '.ai/state/runs/').length, 1);
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
    assert.match(content, /\.ai\/state\/runs\//);
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

test('collectMigrationNotes returns notes strictly newer than fromVersion', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mig-range-'));
  try {
    fs.writeFileSync(path.join(tempDir, '3.2.0.md'), '# Migration 3.2.0\nNotes A.');
    fs.writeFileSync(path.join(tempDir, '3.3.0.md'), '# Migration 3.3.0\nNotes B.');
    fs.writeFileSync(path.join(tempDir, '3.4.0.md'), '# Migration 3.4.0\nNotes C.');

    const notes = collectMigrationNotes('3.2.0', '3.4.0', tempDir);
    assert.equal(notes.length, 2);
    assert.match(notes[0], /3\.3\.0/);
    assert.match(notes[1], /3\.4\.0/);
    assert.doesNotMatch(notes.join('\n'), /3\.2\.0/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collectMigrationNotes with null fromVersion returns only the toVersion note', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mig-null-'));
  try {
    fs.writeFileSync(path.join(tempDir, '3.2.0.md'), '# Migration 3.2.0\nOld notes.');
    fs.writeFileSync(path.join(tempDir, '3.4.0.md'), '# Migration 3.4.0\nLatest notes.');

    const notes = collectMigrationNotes(null, '3.4.0', tempDir);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /3\.4\.0/);
    assert.doesNotMatch(notes[0], /3\.2\.0/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collectMigrationNotes with invalid fromVersion returns only the toVersion note', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mig-invalid-from-'));
  try {
    fs.writeFileSync(path.join(tempDir, '3.3.0.md'), '# Migration 3.3.0\nNotes.');
    fs.writeFileSync(path.join(tempDir, '3.4.0.md'), '# Migration 3.4.0\nLatest.');

    const notes = collectMigrationNotes('unknown', '3.4.0', tempDir);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /3\.4\.0/);
    assert.doesNotMatch(notes.join('\n'), /3\.3\.0/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collectMigrationNotes returns empty array for downgrade or same version', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mig-downgrade-'));
  try {
    fs.writeFileSync(path.join(tempDir, '3.4.0.md'), '# Migration 3.4.0\nNotes.');

    assert.deepEqual(collectMigrationNotes('3.4.0', '3.4.0', tempDir), []);
    assert.deepEqual(collectMigrationNotes('4.0.0', '3.4.0', tempDir), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collectMigrationNotes returns empty array when toVersion is invalid', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-mig-badto-'));
  try {
    fs.writeFileSync(path.join(tempDir, '3.4.0.md'), '# Migration 3.4.0\nNotes.');

    assert.deepEqual(collectMigrationNotes('3.3.0', 'unknown', tempDir), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('--upgrade prints migration notes when harness version is older than CLI', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-notes-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = '3.2.0';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const output = runTs(cli, ['--upgrade'], { cwd: target });

    assert.match(output, /Migration notes/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade refuses to downgrade the harness', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-downgrade-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = '99.0.0';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Stale a managed file to prove the guard runs before any file mutation
    const agentPath = path.join(target, '.ai', 'agents', 'orchestrator.md');
    fs.writeFileSync(agentPath, 'LOCAL CONTENT\n');

    let combined = '';
    try {
      runTs(cli, ['--upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      combined = String((error as ExecError).stdout ?? '') + String((error as ExecError).stderr ?? '');
    }
    assert.match(combined, /refusing downgrade/i);
    assert.match(fs.readFileSync(manifestPath, 'utf8'), /99\.0\.0/);
    assert.equal(fs.readFileSync(agentPath, 'utf8'), 'LOCAL CONTENT\n');
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

test('shouldRunUpdateCheck skips npm preflight for --check-upgrade even in an interactive TTY outside CI', () => {
  assert.equal(shouldRunUpdateCheck({ checkUpgrade: true, interactive: true, ci: false }), false);
});

test('--check-upgrade exits 0 when harness version matches CLI version', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-ok-'));
  try {
    runTs(cli, [], { cwd: target });

    const output = runTs(cli, ['--check-upgrade'], { cwd: target });

    assert.match(output, /\bok\b/i);
    assert.match(output, /harness.*matches CLI/i);
    assert.doesNotMatch(output, /initialized/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 and reports outdated when harness version is older than CLI', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-old-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = '1.0.0';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /outdated/i);
    assert.match(output, /1\.0\.0/);
    assert.doesNotMatch(output, /cli.too.old/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 and reports cli-too-old when harness version is newer than CLI', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-cli-old-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = '99.0.0';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /cli.too.old/i);
    assert.match(output, /99\.0\.0/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 when no harness is installed', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-none-'));
  try {
    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /no harness installed/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 when manifest package_version is invalid', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-bad-ver-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = 'not-a-version';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /invalid.*package_version/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 when manifest package_version is missing', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-missing-ver-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete manifest.package_version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /invalid.*package_version/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 when manifest package_version is a number', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-ver-num-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = 350;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /invalid.*package_version/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 when manifest package_version is an array', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-ver-arr-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = [3, 5, 0];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /invalid.*package_version/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade does not crash when manifest package_version is a number', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-ver-num-'));
  try {
    runTs(cli, ['--profile', 'nextjs'], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = 350;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Should succeed — version comparison is skipped gracefully for invalid version
    runTs(cli, ['--upgrade'], { cwd: target });
    const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as HarnessManifest;
    assert.equal(updated.profile, 'nextjs');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade does not crash when manifest package_version is an object', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-ver-obj-'));
  try {
    runTs(cli, ['--profile', 'nextjs'], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package_version = { major: 3, minor: 5, patch: 0 };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    runTs(cli, ['--upgrade'], { cwd: target });
    const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as HarnessManifest;
    assert.equal(updated.profile, 'nextjs');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// --- Task 3: Explicit profile during upgrade ---

test('--upgrade --profile <name> uses explicit profile over manifest profile', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-explicit-'));
  try {
    runTs(cli, ['--profile', 'mobile'], { cwd: target });
    const beforeManifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(beforeManifest.profile, 'mobile');

    runTs(cli, ['--upgrade', '--profile', 'react-native'], { cwd: target });
    const afterManifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(afterManifest.profile, 'react-native');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade --profile=react-native (equals syntax) uses explicit profile over manifest profile', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-explicit-eq-'));
  try {
    runTs(cli, ['--profile', 'mobile'], { cwd: target });
    runTs(cli, ['--upgrade', '--profile=react-native'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'react-native');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade without --profile keeps manifest profile', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-keep-'));
  try {
    runTs(cli, ['--profile', 'mobile'], { cwd: target });
    runTs(cli, ['--upgrade'], { cwd: target });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'mobile');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade without --profile exits 1 when manifest profile is a number', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-corrupt-num-'));
  try {
    runTs(cli, ['--profile', 'mobile'], { cwd: target });
    fs.writeFileSync(path.join(target, '.ai', 'manifest.json'), JSON.stringify({ version: 1, profile: 123 }));

    let stderr = '';
    try {
      runTs(cli, ['--upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      stderr = String((error as ExecError).stderr ?? '');
    }
    assert.match(stderr, /corrupt|wrong type|unreadable/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade without --profile exits 1 when manifest profile is an array', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-corrupt-arr-'));
  try {
    runTs(cli, ['--profile', 'mobile'], { cwd: target });
    fs.writeFileSync(path.join(target, '.ai', 'manifest.json'), JSON.stringify({ version: 1, profile: ['mobile'] }));

    let stderr = '';
    try {
      runTs(cli, ['--upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      stderr = String((error as ExecError).stderr ?? '');
    }
    assert.match(stderr, /corrupt|wrong type|unreadable/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--upgrade --profile <name> recovers a corrupt manifest profile', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-upgrade-recover-'));
  try {
    runTs(cli, ['--profile', 'mobile'], { cwd: target });
    fs.writeFileSync(path.join(target, '.ai', 'manifest.json'), JSON.stringify({ version: 1, profile: 123 }));

    // Explicit --profile overrides the corrupt manifest; should succeed
    runTs(cli, ['--upgrade', '--profile', 'go'], { cwd: target });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')
    ) as HarnessManifest;
    assert.equal(manifest.profile, 'go');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 and reports corrupt when manifest JSON is invalid', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-corrupt-'));
  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(path.join(target, '.ai', 'manifest.json'), '{ "profile": "base", ');

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /corrupt/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('--check-upgrade exits 1 when manifest belongs to a different package', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-cu-foreign-'));
  try {
    runTs(cli, [], { cwd: target });

    const manifestPath = path.join(target, '.ai', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.package = 'some-other-package';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    let output = '';
    try {
      runTs(cli, ['--check-upgrade'], { cwd: target });
      assert.fail('should have exited 1');
    } catch (error) {
      output = String((error as ExecError).stdout ?? '');
    }
    assert.match(output, /invalid.*package/i);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
