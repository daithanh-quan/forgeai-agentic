import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, type ExecError, type HarnessManifest, runTs, projectRoot } from './helpers.js';

const CURRENT_VERSION = (
  JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as { version: string }
).version;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function taskJournal(overrides: Partial<Record<'id' | 'type' | 'state' | 'updated' | 'stale' | 'memoryDecision', string>> = {}): string {
  const id = overrides.id ?? 'TASK-20260628-lifecycle-check';
  const type = overrides.type ?? 'feature';
  const state = overrides.state ?? 'execution';
  const updated = overrides.updated ?? today();
  const stale = overrides.stale ?? 'fresh';
  const memoryDecision = overrides.memoryDecision ?? '- [ ] Update `.ai/MEMORY.md`\n- [ ] No memory update needed';

  return [
    '# Task Journal Template',
    '',
    '## Identity',
    '',
    `- Task ID: \`${id}\``,
    '- Source: `manual`',
    '- Source link/ID: `local`',
    `- Task type: \`${type}\``,
    '- Priority: `medium`',
    '- Owner/orchestrator: `Codex`',
    `- Current state: \`${state}\``,
    '- Branch/worktree: `feat/lifecycle-check`',
    '- Created: `2026-06-28`',
    `- Last updated: \`${updated}\``,
    `- Stale status: \`${stale}\``,
    '',
    '## Requirement',
    '',
    'Validate lifecycle checker behavior.',
    '',
    '## Acceptance Criteria',
    '',
    '- [x] Checker has evidence.',
    '',
    '## Memory Update Decision',
    '',
    memoryDecision
  ].join('\n');
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
    assert.equal(fs.existsSync(path.join(target, '.ai', 'codegraph', 'README.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'codegraph', 'graph.json')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'codegraph', 'hotspots.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'codegraph', 'context-packs', '_template.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'state', 'lifecycle.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'state', 'tasks', '_template.md')), true);
    assert.equal(
      fs.existsSync(path.join(target, '.ai', 'state', 'assignments', 'TASK-REVIEWER-SMOKE.md')),
      true
    );
    assert.equal(fs.existsSync(path.join(target, '.ai', 'state', 'sessions.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'delegated-assignment.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'lifecycle-management.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'codegraph-context.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'context-compilation.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'task-types', 'feature.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'state', 'reviews', '_template.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'quality-gates.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'workflows', 'pre-merge-checklist.md')), true);
    assert.equal(fs.existsSync(path.join(target, '.claude', 'skills', 'planner', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(target, 'openspec', 'project.md')), true);

    const routing = fs.readFileSync(path.join(target, '.ai', 'model-routing.yaml'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(target, '.ai', 'manifest.json'), 'utf8')) as HarnessManifest;

    assert.equal(manifest.package_version, CURRENT_VERSION);
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
  assert.match(helpOutput, /forgeai-init --check-lifecycle/);
  assert.match(helpOutput, /forgeai-init --check-codegraph/);
  assert.match(helpOutput, /forgeai-init --compile-context/);
  assert.match(helpOutput, /forgeai-init --check-profile/);
  assert.match(helpOutput, /--profile\s+Apply an optional stack profile/);
  assert.match(helpOutput, /--version\s+Print the package version/);
  assert.equal(versionOutput.trim(), CURRENT_VERSION);
});

test('lifecycle check passes with no real task journals', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-lifecycle-empty-'));

  try {
    runTs(cli, [], { cwd: target });

    const output = runTs(cli, ['--check-lifecycle'], { cwd: target });

    assert.match(output, /ForgeAI lifecycle check/);
    assert.match(output, /ok\s+\.ai\/state\/lifecycle\.md/);
    assert.match(output, /ok\s+no real task journals recorded/);
    assert.match(output, /Result: lifecycle state is usable\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('lifecycle check validates an active task journal', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-lifecycle-active-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(path.join(target, '.ai', 'state', 'tasks', 'TASK-20260628-lifecycle-check.md'), taskJournal());

    const output = runTs(cli, ['--check-lifecycle'], { cwd: target });

    assert.match(output, /active\s+\.ai\/state\/tasks\/TASK-20260628-lifecycle-check\.md/);
    assert.match(output, /state: execution/);
    assert.match(output, /Result: lifecycle state is usable\./);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('lifecycle check rejects stale active task journals', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-lifecycle-stale-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, '.ai', 'state', 'tasks', 'TASK-20000101-stale-work.md'),
      taskJournal({ id: 'TASK-20000101-stale-work', updated: '2000-01-01' })
    );

    assert.throws(
      () => runTs(cli, ['--check-lifecycle'], { cwd: target }),
      (error: unknown) => {
        const execError = error as ExecError;
        const stdout = String(execError.stdout ?? '');
        assert.match(stdout, /needs refresh\s+\.ai\/state\/tasks\/TASK-20000101-stale-work\.md last updated/);
        assert.match(stdout, /Result: lifecycle journals have stale active work\./);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('lifecycle check rejects closed journals without memory decision', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-lifecycle-closed-invalid-'));

  try {
    runTs(cli, [], { cwd: target });
    fs.writeFileSync(
      path.join(target, '.ai', 'state', 'tasks', 'TASK-20260628-closed-work.md'),
      taskJournal({ id: 'TASK-20260628-closed-work', state: 'closed' })
    );

    assert.throws(
      () => runTs(cli, ['--check-lifecycle'], { cwd: target }),
      (error: unknown) => {
        const execError = error as ExecError;
        const stdout = String(execError.stdout ?? '');
        assert.match(stdout, /invalid\s+\.ai\/state\/tasks\/TASK-20260628-closed-work\.md closed without exactly one memory update decision/);
        assert.match(stdout, /Result: lifecycle journals need fixes before reliable agent handoff\./);
        return true;
      }
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('help text contains three Phase 11 commands', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-help-phase11-'));
  try {
    const output = runTs(cli, ['--help'], { cwd: target });
    assert.match(output, /--validate-artifact/);
    assert.match(output, /--route/);
    assert.match(output, /--expand-context/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
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

    assert.equal(manifest.package_version, CURRENT_VERSION);
    assert.equal(manifest.profile, 'nextjs');
    assert.match(readme, /# AI Project Harness/);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'profiles', 'nextjs.md')), true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
