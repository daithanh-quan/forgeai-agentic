import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseTryObjective } from '../bin/lib/try.js';
import { findOutOfScopePaths, parseTaskObjective, parseWriteScope } from '../bin/lib/task.js';
import { createTaskReport, renderTaskReport } from '../bin/lib/task-report.js';
import { cli, projectRoot, runTs } from './helpers.js';

test('task objective parsing accepts positional and flag forms', () => {
  assert.equal(parseTaskObjective(['task', 'add auth', '--dry-run']), 'add auth');
  assert.equal(parseTaskObjective(['task', '--dry-run', 'add auth']), 'add auth');
  assert.equal(parseTaskObjective(['task', '--dry-run', '--objective', 'add auth']), 'add auth');
});

test('task objective parsing rejects flag-like and missing objectives', () => {
  assert.equal(parseTaskObjective(['task', '--dry-run']), null);
  assert.equal(parseTaskObjective(['task', '--dry-run', '--objective', '--bad']), null);
});

test('task execution parses a narrow explicit write scope', () => {
  assert.deepEqual(parseWriteScope('src/app.ts, tests/app.test.ts,src/app.ts'), {
    paths: ['src/app.ts', 'tests/app.test.ts'],
    error: null
  });
  assert.match(parseWriteScope('../outside').error ?? '', /safe repo-relative paths/);
  assert.match(parseWriteScope('.ai/state').error ?? '', /cannot grant/);
});

test('task execution rejects changed files outside the write scope', () => {
  const changed = findOutOfScopePaths(
    ['src/app.ts', 'src/app.test.ts', '.ai/state/context/TASK-20260914-app.json', 'README.md'],
    ['src/app.ts'],
    new Set(['.ai/state/context/TASK-20260914-app.json'])
  );
  assert.deepEqual(changed, ['README.md', 'src/app.test.ts']);
});

test('task execution does not treat an adapter no-op as a verified change', () => {
  assert.deepEqual(findOutOfScopePaths([], ['src/app.ts'], new Set()), []);
});

test('task report is deterministic and includes proof fields', () => {
  const report = createTaskReport({
    task_id: 'TASK-20260914-login', objective: 'fix login', adapter: 'codex', model: 'gpt-test',
    write_scope: ['src/login.ts'], changed_files: ['src/login.ts'], out_of_scope_files: [],
    validations: [{ name: 'test', passed: true, durationMs: 10, output: '' }], status: 'passed', error: null,
    next_action: 'Review the diff and commit when ready.'
  });
  assert.equal(report.schema_version, 1);
  assert.match(renderTaskReport(report), /Status: passed/);
  assert.match(renderTaskReport(report), /PASS test/);
  assert.deepEqual(report.changed_files, ['src/login.ts']);
});

function writeTaskFixture(target: string, script: string): void {
  fs.mkdirSync(path.join(target, '.ai'), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'templates', '.ai', 'RULES.md'), path.join(target, '.ai', 'RULES.md'));
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.writeFileSync(path.join(target, 'src', 'input.ts'), 'export const input = true;\n');
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
  fs.writeFileSync(path.join(target, '.ai', 'cli-adapters.json'), JSON.stringify({ version: 1, adapters: {
    fixture: { command: process.execPath, args: ['-e', script], input: 'stdin' }
  } }));
  execFileSync('git', ['init', '-q'], { cwd: target });
}

test('task execution applies an in-scope CLI change and writes a JSON report', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-task-e2e-'));
  try {
    writeTaskFixture(target, "require('fs').appendFileSync('src/input.ts', 'export const answer = 42;\\n')");
    const output = runTs(cli, ['task', '--yes', '--json', '--adapter', 'fixture', '--write-scope', 'src', 'add answer'], { cwd: target });
    const report = JSON.parse(output) as { status: string; changed_files: string[]; validations: Array<{ name: string; passed: boolean }> };
    assert.equal(report.status, 'passed');
    assert.deepEqual(report.changed_files, ['src/input.ts']);
    assert.deepEqual(report.validations.map((check) => [check.name, check.passed]), [['test', true]]);
    assert.match(fs.readFileSync(path.join(target, 'src', 'input.ts'), 'utf8'), /answer = 42/);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'state', 'tasks')), true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('task execution reports an out-of-scope CLI change without reverting it', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-task-scope-'));
  try {
    writeTaskFixture(target, "require('fs').writeFileSync('README.md', 'unexpected\\n')");
    const result = (() => {
      try {
        runTs(cli, ['task', '--yes', '--json', '--adapter', 'fixture', '--write-scope', 'src', 'update source'], { cwd: target });
        return null;
      } catch (error) { return error as { status?: number; stdout?: string | Buffer }; }
    })();
    assert.equal(result?.status, 1);
    const report = JSON.parse(String(result?.stdout ?? '')) as { status: string; out_of_scope_files: string[] };
    assert.equal(report.status, 'failed');
    assert.deepEqual(report.out_of_scope_files, ['README.md']);
    assert.equal(fs.readFileSync(path.join(target, 'README.md'), 'utf8'), 'unexpected\n');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('task execution detects a newly created in-scope file', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-task-new-file-'));
  try {
    writeTaskFixture(target, "require('fs').writeFileSync('src/new-file.ts', 'export const created = true;\\n')");
    const output = runTs(cli, ['task', '--yes', '--json', '--adapter', 'fixture', '--write-scope', 'src', 'create source file'], { cwd: target });
    const report = JSON.parse(output) as { status: string; changed_files: string[] };
    assert.equal(report.status, 'passed');
    assert.deepEqual(report.changed_files, ['src/new-file.ts']);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('task report records a validated agent response and matches git changes', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-task-response-'));
  try {
    writeTaskFixture(target, "require('fs').appendFileSync('src/input.ts', 'export const answer = 42;\\n'); process.stdout.write(JSON.stringify({status:'completed',summary:'implemented',changed_files:['src/input.ts'],validation:[{command:'npm test',passed:true}],risks:[],next_action:'review diff'}))");
    const configPath = path.join(target, '.ai', 'cli-adapters.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { adapters: Record<string, Record<string, unknown>> };
    config.adapters.fixture.payload = 'assignment';
    config.adapters.fixture.output = 'json';
    fs.writeFileSync(configPath, JSON.stringify(config));
    const output = runTs(cli, ['task', '--yes', '--json', '--adapter', 'fixture', '--write-scope', 'src', 'add answer'], { cwd: target });
    const report = JSON.parse(output) as { status: string; agent_response?: { status: string; changed_files: string[] } };
    assert.equal(report.status, 'passed');
    assert.equal(report.agent_response?.status, 'completed');
    assert.deepEqual(report.agent_response?.changed_files, ['src/input.ts']);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('task hands off to the current agent when no CLI adapter or harness is configured', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-task-handoff-'));
  try {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
    fs.writeFileSync(path.join(target, 'src', 'login.ts'), 'export function login() { return true; }\n');
    execFileSync('git', ['init', '-q'], { cwd: target });

    const output = runTs(cli, ['task', '--json', '--write-scope', 'src', 'fix login'], { cwd: target });
    const report = JSON.parse(output) as { status: string; adapter: string | null; next_action: string };
    assert.equal(report.status, 'needs-human');
    assert.equal(report.adapter, null);
    assert.match(report.next_action, /context\/TASK-/);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'cli-adapters.json')), false);
    assert.equal(fs.existsSync(path.join(target, '.ai', 'state', 'context')), true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
