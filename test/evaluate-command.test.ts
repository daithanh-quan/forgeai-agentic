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

// A repo whose review verdict is "Needs human decision" (derived outcome partial).
function setupHumanDecisionRepo(): string {
  const dir = setupRepo();
  fs.writeFileSync(path.join(dir, '.ai/state/reviews/TASK-20260724-x.md'),
    ['- Task ID: `TASK-20260724-x`', '', '## Scorecard', '| Dimension | Rating | Notes |', '| --- | --- | --- |', '| Correctness | concern | needs a human |', '', 'Unresolved blockers: none', '', 'Verdict: Needs human decision'].join('\n'));
  return dir;
}

const EVAL_PATH = '.ai/state/evaluations/TASK-20260724-x.json';
function readEval(dir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, EVAL_PATH), 'utf8'));
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

// ── Phase 13B: experiment mode/comparability + provenance gate ──────────────

// Compiles a baseline experiment artifact for the task and writes it as the
// single primary under .ai/state/context/primary.json. Optionally writes a run
// record that routes it. Returns the repo dir.
function setupExperimentRepo(opts: { runMode?: 'baseline' | 'compact' | null; runArtifact?: string } = {}): string {
  const dir = setupRepo();
  // Initialize the harness + dependency graph so --compile-context can run.
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'entry.ts'), 'export function runCli() { return 42; }\n');
  runTs(cli, [], { cwd: dir });
  runTs(cli, ['--refresh-codegraph'], { cwd: dir });
  const json = runTs(cli, ['--compile-context', '--objective', 'change runCli implementation', '--budget', '4000',
    '--task', 'TASK-20260724-x', '--mode', 'baseline', '--experiment', 'EXP-20260724-router'], { cwd: dir });
  const ctxDir = path.join(dir, '.ai/state/context');
  fs.mkdirSync(ctxDir, { recursive: true });
  fs.writeFileSync(path.join(ctxDir, 'primary.json'), json);
  const runMode = opts.runMode === undefined ? 'baseline' : opts.runMode;
  if (runMode !== null) {
    const runsDir = path.join(dir, '.ai/state/runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, 'run-1.json'), JSON.stringify({
      schema_version: 1, kind: 'forgeai_run_record', run_id: 'run-1', timestamp: '2026-07-24T00:00:00.000Z',
      adapter: 'anthropic', provider: 'anthropic', model: 'claude-sonnet-4-6',
      artifact: opts.runArtifact ?? '.ai/state/context/primary.json', objective: 'change runCli implementation',
      task_id: 'TASK-20260724-x', mode: runMode, budget_tokens: 4000, estimated_tokens: 100,
      input_tokens: 80, output_tokens: 20, cached_tokens: 0, latency_ms: 250, http_status: 200,
      outcome: 'ok', retry_count: 0, error: null,
    }, null, 2));
  }
  return dir;
}

test('--evaluate stamps mode, experiment_id, and comparability from the primary artifact', () => {
  const dir = setupExperimentRepo();
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const record = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8'));
  assert.equal(record.mode, 'baseline');
  assert.equal(record.experiment_id, 'EXP-20260724-router');
  assert.equal(typeof record.comparability.objective, 'string');
  assert.equal(typeof record.comparability.repository_fingerprint, 'string');
  assert.match(record.comparability.selection_signature, /^\d+:\d+:/);
  // acceptance_signature is the Command column (cells[1]), never the Date column.
  assert.ok(record.comparability.acceptance_signature.length > 0);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(record.comparability.acceptance_signature), 'acceptance_signature must hold commands, not dates');
  assert.match(record.comparability.routing_signature, /.+\/.+/);
});

test('--evaluate rejects an experiment task with no runs', () => {
  const dir = setupExperimentRepo({ runMode: null });
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /no run records|No record written/);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('--evaluate rejects an experiment run whose mode differs from the artifact', () => {
  const dir = setupExperimentRepo({ runMode: 'compact' });
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /does not match artifact mode|No record written/);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('--evaluate rejects an experiment run that routed a different artifact', () => {
  const dir = setupExperimentRepo({ runArtifact: '.ai/state/context/OTHER.json' });
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /did not route the primary artifact|No record written/);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('--evaluate treats a legacy artifact (no mode/experiment_id) as a non-experiment', () => {
  const dir = setupRepo();
  // Init the harness + graph, compile a normal artifact, then strip the additive
  // fields to simulate a pre-3.9.0 primary artifact (no run record, like an old evaluation).
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'entry.ts'), 'export function runCli() { return 42; }\n');
  runTs(cli, [], { cwd: dir });
  runTs(cli, ['--refresh-codegraph'], { cwd: dir });
  const compiled = JSON.parse(runTs(cli, ['--compile-context', '--objective', 'change runCli implementation',
    '--budget', '4000', '--task', 'TASK-20260724-x'], { cwd: dir })) as Record<string, unknown>;
  delete compiled.mode;
  delete compiled.experiment_id;
  const ctxDir = path.join(dir, '.ai/state/context');
  fs.mkdirSync(ctxDir, { recursive: true });
  fs.writeFileSync(path.join(ctxDir, 'primary.json'), JSON.stringify(compiled, null, 2));

  // No run record — a legacy (non-experiment) evaluation must still succeed.
  const result = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const record = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8'));
  assert.equal(record.mode, 'compact');
  assert.equal(record.experiment_id, null);
});

test('--evaluate counts observed escapes and fails on a malformed escape record', async () => {
  const dir = setupRepo();
  const compiled = compileArtifact(dir, 'TASK-20260724-x');
  const ctxDir = path.join(dir, '.ai/state/context');
  fs.mkdirSync(ctxDir, { recursive: true });
  const primaryRel = '.ai/state/context/primary.json';
  fs.writeFileSync(path.join(dir, primaryRel), compiled);

  const { artifactDigest, recordObservation, recordEscapes } = await import('../bin/lib/context-escapes.js');
  const digest = artifactDigest(fs.readFileSync(path.join(dir, primaryRel), 'utf8'));
  recordObservation('TASK-20260724-x', { primary_artifact: primaryRel, primary_digest: digest }, dir);
  recordEscapes('TASK-20260724-x', [{
    primary_artifact: primaryRel, primary_digest: digest,
    request: { kind: 'file', path: 'src/x.ts', reason: 'r' }, reason_code: 'path_not_in_graph', detail: 'd',
  }], dir);

  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x']).status, 0);
  const record = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8'));
  assert.equal(record.metrics.context.context_escapes, 1);

  // malformed event -> evaluate fails, writes no record
  fs.rmSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'));
  fs.writeFileSync(path.join(dir, '.ai/state/context-escapes/TASK-20260724-x/events/deadbeefdeadbeef.json'), '{ broken');
  const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.notEqual(res.status, 0);
  assert.match(res.stdout + res.stderr, /unreadable|malformed|not valid JSON/);
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), false);
});

test('--evaluate reports context_escapes null when there is no escape store', () => {
  const dir = setupRepo();
  const compiled = compileArtifact(dir, 'TASK-20260724-x');
  fs.mkdirSync(path.join(dir, '.ai/state/context'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ai/state/context/primary.json'), compiled);
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x']).status, 0);
  const record = JSON.parse(fs.readFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json'), 'utf8'));
  assert.equal(record.metrics.context.context_escapes, null);
});

// ─── manual override (--outcome / --reason / --by / --clear-outcome) ──────────

test('--outcome overrides a needs-human-decision task with recorded provenance', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'approved after manual review']).status, 0);
  const rec = readEval(dir);
  const src = rec.outcome_source as Record<string, unknown>;
  assert.equal(rec.outcome, 'pass');
  assert.equal(src.type, 'manual_override');
  assert.equal(src.decided_outcome, 'pass');
  assert.equal(src.verdict, 'needs human decision');
  assert.equal(src.reason, 'approved after manual review');
  assert.ok(typeof src.decided_by === 'string' && (src.decided_by as string).length > 0);
  assert.ok(!Number.isNaN(Date.parse(src.decided_at as string)));
});

test('--by records the decider verbatim; --outcome fail is honored; equals form works', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'fail', '--reason', 'rejected', '--by', 'Alice Reviewer']).status, 0);
  let rec = readEval(dir);
  assert.equal(rec.outcome, 'fail');
  assert.equal((rec.outcome_source as Record<string, unknown>).decided_by, 'Alice Reviewer');
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome=pass', '--reason=ok now']).status, 0);
  rec = readEval(dir);
  assert.equal(rec.outcome, 'pass');
  assert.equal((rec.outcome_source as Record<string, unknown>).reason, 'ok now');
});

test('--by without --outcome/--reason is a usage error, not silently ignored', () => {
  const dir = setupHumanDecisionRepo();
  const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--by', 'Alice']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--by is only valid with --outcome and --reason/);
  assert.equal(fs.existsSync(path.join(dir, EVAL_PATH)), false);
});

test('--outcome without --reason, and an invalid --outcome value, are usage errors', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass']).status, 1);
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--reason', 'x']).status, 1);
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'maybe', '--reason', 'x']).status, 1);
});

for (const verdict of ['Approve', 'Request changes'] as const) {
  test(`--outcome on a ${verdict} verdict is rejected and writes nothing`, () => {
    const dir = setupRepo();
    fs.writeFileSync(path.join(dir, '.ai/state/reviews/TASK-20260724-x.md'),
      ['- Task ID: `TASK-20260724-x`', '', '## Scorecard', '| Dimension | Rating | Notes |', '| --- | --- | --- |',
       '| Correctness | pass | ok |', '', 'Unresolved blockers: none', '', `Verdict: ${verdict}`].join('\n'));
    const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'fail', '--reason', 'x']);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /only allowed when the review Verdict is 'Needs human decision'/);
    assert.equal(fs.existsSync(path.join(dir, EVAL_PATH)), false);
  });
}

test('a new --outcome replaces a prior override; no decision_history is kept', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'first', '--by', 'Alice']).status, 0);
  assert.equal(readEval(dir).outcome, 'pass');
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'fail', '--reason', 'second', '--by', 'Bob']).status, 0);
  const second = readEval(dir);
  assert.equal(second.outcome, 'fail');
  assert.equal((second.outcome_source as Record<string, unknown>).reason, 'second');
  assert.equal((second.outcome_source as Record<string, unknown>).decided_by, 'Bob');
  assert.equal(second.decision_history, undefined);
});

test('a plain re-evaluate PRESERVES a prior override verbatim', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'approved', '--by', 'Alice']).status, 0);
  const first = readEval(dir).outcome_source as Record<string, unknown>;
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x']).status, 0);
  const again = readEval(dir).outcome_source as Record<string, unknown>;
  assert.equal(readEval(dir).outcome, 'pass');
  assert.equal(again.type, 'manual_override');
  assert.equal(again.reason, 'approved');
  assert.equal(again.decided_by, 'Alice');
  assert.equal(again.decided_at, first.decided_at); // NOT restamped
});

test('verdict drift fails a plain re-evaluate closed; explicit flags recover', () => {
  const dir = setupHumanDecisionRepo();
  const p = path.join(dir, EVAL_PATH);
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'approved']).status, 0);
  const before = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(path.join(dir, '.ai/state/reviews/TASK-20260724-x.md'),
    ['- Task ID: `TASK-20260724-x`', '', '## Scorecard', '| Dimension | Rating | Notes |', '| --- | --- | --- |', '| Correctness | fail | regressed |', '', 'Unresolved blockers: none', '', 'Verdict: Request changes'].join('\n'));
  const drift = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(drift.status, 1);
  assert.match(drift.stdout + drift.stderr, /Verdict is now 'request changes'/);
  assert.equal(fs.readFileSync(p, 'utf8'), before); // untouched
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--clear-outcome']).status, 0);
  assert.equal(readEval(dir).outcome, 'fail'); // request changes -> fail
});

test('--clear-outcome drops the override and re-derives', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'approved']).status, 0);
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--clear-outcome']).status, 0);
  const cleared = readEval(dir);
  assert.equal(cleared.outcome, 'partial');
  assert.equal((cleared.outcome_source as Record<string, unknown>).type, 'review_scorecard');
});

test('--clear-outcome combined with an override, or as =value / duplicate, is a usage error', () => {
  const dir = setupHumanDecisionRepo();
  assert.match(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--clear-outcome', '--outcome', 'pass', '--reason', 'x']).stderr, /--clear-outcome cannot be combined with --outcome/);
  assert.match(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--clear-outcome=true']).stderr, /--clear-outcome is a boolean flag/);
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--clear-outcome', '--clear-outcome']).status, 1);
});

test('a corrupt prior record fails closed unless --force (which backs it up first)', () => {
  const dir = setupHumanDecisionRepo();
  const p = path.join(dir, EVAL_PATH);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{ this is not valid json');
  for (const extra of [[], ['--outcome', 'pass', '--reason', 'x'], ['--clear-outcome']]) {
    const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x', ...extra]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Refusing to overwrite an invalid evaluation record/);
    assert.equal(fs.readFileSync(p, 'utf8'), '{ this is not valid json');
  }
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'x', '--force']).status, 0);
  assert.equal(readEval(dir).outcome, 'pass');
  const backups = fs.readdirSync(path.dirname(p)).filter((f) => f.startsWith('TASK-20260724-x.json.corrupt-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(p), backups[0]), 'utf8'), '{ this is not valid json');
});

test('a record whose task_id does not match its filename fails closed', () => {
  const dir = setupHumanDecisionRepo();
  const p = path.join(dir, EVAL_PATH);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const foreign = {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: 'eval-TASK-20260724-y', task_id: 'TASK-20260724-y',
    generated_at: '2026-07-28T00:00:00.000Z', mode: 'compact', experiment_id: null, comparability: null, outcome: 'pass',
    outcome_source: { type: 'manual_override', scorecard: 's', verdict: 'needs human decision', decided_outcome: 'pass', reason: 'foreign', decided_by: 'Eve', decided_at: '2026-07-28T00:00:00.000Z' },
    routing_signatures: [],
    validation: { status: 'partial', evidence_count: 1, results: { pass: 0, fail: 0, skipped: 1 } },
    run_ids: [], context_artifact: null, task_journal: 'j', tier: 'standard',
    metrics: { context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, latency_ms: 0, retries: 0 } },
  };
  fs.writeFileSync(p, JSON.stringify(foreign));
  const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /task_id "TASK-20260724-y" does not match/);
  assert.equal(fs.readFileSync(p, 'utf8'), JSON.stringify(foreign));
});

test('the success line collapses control chars/line separators in reason and by', () => {
  const dir = setupHumanDecisionRepo();
  const res = run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'first\nmid end', '--by', 'a\tb']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /by a b: first mid end/);
  const src = readEval(dir).outcome_source as Record<string, unknown>;
  assert.equal(src.reason, 'first\nmid end'); // raw preserved in the record
  assert.equal(src.decided_by, 'a\tb');
});

test('a reason/--by empty once line-breakers are stripped is a usage error', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', '\x01\x02']).status, 1);
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'ok', '--by', ' ']).status, 1);
  assert.equal(fs.existsSync(path.join(dir, EVAL_PATH)), false);
});

test('the shared flag validator rejects duplicate/bare/whitespace --outcome/--reason', () => {
  const dir = setupHumanDecisionRepo();
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--outcome', 'fail', '--reason', 'x']).status, 1);
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'a', '--reason', 'b']).status, 1);
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', '   ']).status, 1);
  assert.equal(fs.existsSync(path.join(dir, EVAL_PATH)), false);
});

test('a run with an empty/whitespace model never yields a record the reader rejects', () => {
  const dir = setupHumanDecisionRepo();
  writeRunRecord(dir, 'run-1', 'TASK-20260724-x', 'anthropic', '   ');
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'ok']).status, 0);
  assert.deepEqual(readEval(dir).routing_signatures, []); // empty, not [{ model: '   ' }]
  // The record round-trips valid: a plain re-evaluate reads the prior via
  // readEvaluationRecordStatus and preserves it (exit 0). A corrupt record would exit 1.
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x']).status, 0);
  assert.equal((readEval(dir).outcome_source as Record<string, unknown>).type, 'manual_override');
});

test('a manual override is listed, aggregated, and drives the routing recommendation', () => {
  const dir = setupHumanDecisionRepo();
  writeRunRecord(dir, 'run-1', 'TASK-20260724-x', 'anthropic', 'claude-sonnet-4-6');
  fs.mkdirSync(path.join(dir, '.ai'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ai/model-routing.yaml'), 'tiers:\n  standard:\n    provider: anthropic\n    model: claude-sonnet-4-6\n');
  assert.equal(run(dir, ['--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'ok after review']).status, 0);

  // A second, higher-token tier so routing has >= 2 tiers to compare.
  const premium = {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: 'eval-TASK-20260728-pr', task_id: 'TASK-20260728-pr',
    generated_at: '2026-07-28T00:00:00.000Z', mode: 'compact', experiment_id: null, comparability: null, outcome: 'pass',
    outcome_source: { type: 'review_scorecard', scorecard: 's', verdict: 'approve' },
    routing_signatures: [{ provider: 'anthropic', model: 'claude-opus-4-8' }],
    validation: { status: 'pass', evidence_count: 1, results: { pass: 1, fail: 0, skipped: 0 } },
    run_ids: [], context_artifact: null, task_journal: 'j', tier: 'premium',
    metrics: { context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: 5000, output_tokens: 10, cached_tokens: 0, latency_ms: 100, retries: 0 } },
  };
  fs.writeFileSync(path.join(dir, '.ai/state/evaluations/TASK-20260728-pr.json'), JSON.stringify(premium));

  const payload = JSON.parse(run(dir, ['--report', '--json', '--min-samples', '1']).stdout);
  assert.equal(payload.outcomes.pass, 2);
  assert.equal(payload.byTier.standard.pass, 1); // overridden record aggregated under its tier
  assert.deepEqual(payload.invalid_records, []);
  assert.equal(payload.routing.withheld, false);
  assert.equal(payload.routing.recommended_tier, 'standard'); // the override's lower-token tier
});

test('override flags are a usage error unless --evaluate is the selected command', () => {
  const dir = setupRepo();
  for (const extra of [
    // (a) no --evaluate at all
    ['--dry-run', '--outcome', 'pass', '--reason', 'reviewed'],
    ['--report', '--outcome', 'pass', '--reason', 'reviewed'],
    ['--outcome', 'pass', '--reason', 'reviewed'], // default command
    ['--report', '--clear-outcome'],
    ['--report', '--by', 'Alice', '--outcome', 'pass', '--reason', 'x'],
    // (b) --evaluate present but a higher-precedence command wins the dispatch — the
    // override would be silently dropped, so this must fail rather than exit 0.
    ['--version', '--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'reviewed'],
    ['--help', '--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'reviewed'],
    ['--check', '--evaluate', '--task', 'TASK-20260724-x', '--outcome', 'pass', '--reason', 'reviewed'],
  ]) {
    const res = run(dir, extra);
    assert.equal(res.status, 1, extra.join(' '));
    assert.match(res.stderr, /is only valid with --evaluate/);
  }
});
