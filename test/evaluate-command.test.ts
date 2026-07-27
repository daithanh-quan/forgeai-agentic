import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, runTs, type ExecError } from './helpers.js';

function run(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = runTs(cli, args, { cwd });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as ExecError;
    return { status: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
}

function setupRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-evalcmd-'));
  fs.mkdirSync(path.join(dir, '.ai/state/tasks'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.ai/state/reviews'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ai/state/tasks/TASK-20260724-x.md'),
    ['- Task ID: TASK-20260724-x', '', '## Commands And Validation', '| Date | Command | Result |', '| --- | --- | --- |', '| 2026-07-24 | npm test | pass |'].join('\n'));
  fs.writeFileSync(path.join(dir, '.ai/state/reviews/TASK-20260724-x.md'),
    ['- Task ID: `TASK-20260724-x`', '', '## Scorecard', '| Dimension | Rating | Notes |', '| --- | --- | --- |', '| Correctness | pass | ok |', '', 'Unresolved blockers: none', '', 'Verdict: Approve'].join('\n'));
  return dir;
}

// Compiles a real, structurally-valid artifact stamped with the given task id,
// then returns its JSON string.
function compileArtifact(dir: string, taskId: string): string {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'entry.ts'), 'export function runCli() { return 42; }\n');
  runTs(cli, [], { cwd: dir });
  runTs(cli, ['--refresh-codegraph'], { cwd: dir });
  return runTs(cli, ['--compile-context', '--objective', 'change runCli implementation', '--budget', '4000', '--task', taskId], { cwd: dir });
}

// Writes a run record for the task under .ai/state/runs, as the API adapter
// does (see api-adapter.ts — task_id is carried from the artifact).
function writeRunRecord(dir: string, runId: string, taskId: string, provider: string, model: string): void {
  const runsDir = path.join(dir, '.ai/state/runs');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify({
    schema_version: 1, kind: 'forgeai_run_record', run_id: runId, timestamp: '2026-07-24T00:00:00.000Z',
    adapter: provider, provider, model, artifact: '.ai/state/context/x.json', objective: 'change runCli implementation',
    task_id: taskId, budget_tokens: 4000, estimated_tokens: 100, input_tokens: 80, output_tokens: 20, cached_tokens: 0,
    latency_ms: 250, http_status: 200, outcome: 'ok', retry_count: 1, error: null,
  }, null, 2));
}

test('--evaluate writes a pass record for an approved task', () => {
  const dir = setupRepo();
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8'));
  assert.equal(record.outcome, 'pass');
});

test('--evaluate captures run ids, resolved tier, and metrics end-to-end', () => {
  const dir = setupRepo();
  // A compiled primary artifact plus a second copy flipped to artifact_role
  // "expansion" — the record must count one expansion round and populate context metrics.
  const compiled = compileArtifact(dir, 'TASK-20260724-x');
  const ctxDir = path.join(dir, '.ai/state/context');
  fs.mkdirSync(ctxDir, { recursive: true });
  fs.writeFileSync(path.join(ctxDir, 'primary.json'), compiled);
  const expansion = { ...JSON.parse(compiled), artifact_role: 'expansion' };
  fs.writeFileSync(path.join(ctxDir, 'expansion.json'), JSON.stringify(expansion));
  // A run record whose provider/model matches a routing tier so tier resolves.
  writeRunRecord(dir, 'run-1', 'TASK-20260724-x', 'anthropic', 'claude-sonnet-4-6');
  fs.mkdirSync(path.join(dir, '.ai'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ai/model-routing.yaml'),
    'tiers:\n  standard:\n    provider: anthropic\n    model: claude-sonnet-4-6\n');

  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8'));
  assert.deepEqual(record.run_ids, ['run-1']);
  assert.equal(record.tier, 'standard');
  assert.equal(record.metrics.context.expansion_rounds, 1);
  assert.ok(record.metrics.context.selected_files > 0);
  assert.equal(record.metrics.calls.model_calls, 1);
  assert.equal(record.metrics.calls.retries, 1);
});

test('--evaluate is idempotent — a rerun overwrites to a single identical record', () => {
  const dir = setupRepo();
  const evalPath = path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json');
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x']).status, 0);
  const first = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x']).status, 0);
  assert.equal(fs.readdirSync(path.join(dir, '.ai/state/evaluations')).length, 1);
  const second = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
  // generated_at is a fresh timestamp on each run; everything else must be stable.
  delete first.generated_at; delete second.generated_at;
  assert.deepEqual(second, first);
});

test('--evaluate fails on a scorecard whose Task ID does not match --task', () => {
  const dir = setupRepo();
  fs.writeFileSync(path.join(dir, '.ai/state/reviews/TASK-20260724-x.md'),
    ['- Task ID: `TASK-20260724-y`', '', '## Scorecard', '| Dimension | Rating | Notes |', '| --- | --- | --- |', '| Correctness | pass | ok |', '', 'Unresolved blockers: none', '', 'Verdict: Approve'].join('\n'));
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('--evaluate fails when two journals match the same task', () => {
  const dir = setupRepo();
  fs.writeFileSync(path.join(dir, '.ai/state/tasks/TASK-20260724-x-dup.md'),
    ['- Task ID: TASK-20260724-x', '', '## Commands And Validation', '| Date | Command | Result |', '| --- | --- | --- |', '| 2026-07-24 | npm test | pass |'].join('\n'));
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /multiple task journals/);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('--evaluate fails and writes nothing when the scorecard is missing', () => {
  const dir = setupRepo();
  fs.rmSync(path.join(dir, '.ai/state/reviews/TASK-20260724-x.md'));
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('--evaluate errors on a missing --task argument', () => {
  const dir = setupRepo();
  const result = run(dir, ['--evaluate']);
  assert.equal(result.status, 1);
});

test('--evaluate errors on a bare --task with no value', () => {
  const dir = setupRepo();
  const result = run(dir, ['--evaluate', '--task']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--task requires a value/);
});

test('--evaluate fails on two primary artifacts for the same task', () => {
  const dir = setupRepo();
  const compiled = compileArtifact(dir, 'TASK-20260724-x'); // structurally valid, artifact_role primary
  const ctxDir = path.join(dir, '.ai/state/context');
  fs.mkdirSync(ctxDir, { recursive: true }); // compileArtifact prints to stdout, so the dir may not exist yet
  fs.writeFileSync(path.join(ctxDir, 'copy-a.json'), compiled);
  fs.writeFileSync(path.join(ctxDir, 'copy-b.json'), compiled);
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('--evaluate ignores a malformed context artifact and still succeeds', () => {
  const dir = setupRepo();
  const ctxDir = path.join(dir, '.ai/state/context');
  fs.mkdirSync(ctxDir, { recursive: true });
  fs.writeFileSync(path.join(ctxDir, 'broken.json'), '{ not valid');
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 0, result.stderr);
});
