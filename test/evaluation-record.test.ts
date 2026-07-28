import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  writeEvaluationRecord,
  readEvaluationRecord,
  listEvaluationRecords,
  readRoutingTiers,
  resolveTier,
  resolveTierForRuns,
  computeMetrics,
  buildEvaluationRecord,
} from '../bin/lib/evaluation-record.js';
import type { CompiledContextArtifact, EvaluationRecord, RunRecord } from '../bin/lib/types.js';

function makeEval(overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    kind: 'forgeai_evaluation_record',
    schema_version: 1,
    evaluation_id: 'eval-TASK-20260724-x',
    task_id: 'TASK-20260724-x',
    generated_at: '2026-07-24T00:00:00.000Z',
    mode: 'compact',
    experiment_id: null,
    comparability: null,
    outcome: 'pass',
    outcome_source: { type: 'review_scorecard', scorecard: '.ai/state/reviews/TASK-20260724-x.md', verdict: 'approve' },
    validation: { status: 'pass', evidence_count: 2, results: { pass: 2, fail: 0, skipped: 0 } },
    run_ids: ['run-1'],
    context_artifact: '.ai/state/context/TASK-20260724-x.json',
    task_journal: '.ai/state/tasks/TASK-20260724-x.md',
    tier: 'standard',
    metrics: {
      context: { selected_files: 3, excerpts: 5, omitted_candidates: 1, budget_limit_tokens: 6000, budget_estimated_tokens: 5000, budget_utilization: 0.833, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: 100, output_tokens: 20, cached_tokens: 0, latency_ms: 500, retries: 0 },
    },
    ...overrides,
  };
}

// ─── storage ──────────────────────────────────────────────────────────────────

test('write then read round-trips an evaluation record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeEvaluationRecord(makeEval(), dir);
  const read = readEvaluationRecord('TASK-20260724-x', dir);
  assert.equal(read?.outcome, 'pass');
  assert.equal(fs.existsSync(path.join(dir, '.ai/state/evaluations/TASK-20260724-x.json')), true);
});

test('write is idempotent — re-writing overwrites the same file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeEvaluationRecord(makeEval(), dir);
  writeEvaluationRecord(makeEval({
    outcome: 'fail',
    outcome_source: { type: 'review_scorecard', scorecard: '.ai/state/reviews/TASK-20260724-x.md', verdict: 'request changes' },
  }), dir);
  assert.equal(fs.readdirSync(path.join(dir, '.ai/state/evaluations')).length, 1);
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir)?.outcome, 'fail');
});

test('listEvaluationRecords skips malformed files and sorts newest first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeEvaluationRecord(makeEval({ task_id: 'TASK-20260724-a', evaluation_id: 'eval-TASK-20260724-a', generated_at: '2026-07-24T01:00:00.000Z' }), dir);
  writeEvaluationRecord(makeEval({ task_id: 'TASK-20260724-b', evaluation_id: 'eval-TASK-20260724-b', generated_at: '2026-07-24T02:00:00.000Z' }), dir);
  fs.writeFileSync(path.join(dir, '.ai/state/evaluations/broken.json'), '{ not json');
  const records = listEvaluationRecords(dir);
  assert.equal(records.length, 2);
  assert.equal(records[0].task_id, 'TASK-20260724-b');
});

test('writeEvaluationRecord refuses a task_id with a path separator', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  assert.throws(() => writeEvaluationRecord(makeEval({ task_id: '../../escape' }), dir));
  assert.equal(fs.existsSync(path.join(dir, 'escape.json')), false);
});

test('readEvaluationRecord refuses a traversal task_id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  assert.equal(readEvaluationRecord('../../etc/passwd', dir), null);
});

// Helper: write an arbitrary object to <taskId>.json.
function writeRaw(dir: string, fileTaskId: string, obj: unknown): void {
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  fs.writeFileSync(path.join(evalDir, `${fileTaskId}.json`), JSON.stringify(obj));
}

test('a record missing metrics.calls is rejected on read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  const broken = makeEval() as Record<string, unknown>;
  delete (broken.metrics as Record<string, unknown>).calls;
  writeRaw(dir, 'TASK-20260724-x', broken);
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir), null);
});

test('a record with a non-canonical generated_at is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeRaw(dir, 'TASK-20260724-x', makeEval({ generated_at: '2026-07-24' }));
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir), null);
});

test('a record whose evaluation_id does not match task_id is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeRaw(dir, 'TASK-20260724-x', makeEval({ evaluation_id: 'eval-wrong' }));
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir), null);
});

test('a record whose evidence_count != sum of results is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeRaw(dir, 'TASK-20260724-x', makeEval({ validation: { status: 'pass', evidence_count: 5, results: { pass: 2, fail: 0, skipped: 0 } } }));
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir), null);
});

test('a record whose verdict does not map to its outcome is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  // verdict "request changes" maps to fail, but outcome claims pass.
  writeRaw(dir, 'TASK-20260724-x', makeEval({
    outcome: 'pass',
    outcome_source: { type: 'review_scorecard', scorecard: '.ai/state/reviews/TASK-20260724-x.md', verdict: 'request changes' },
  }));
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir), null);
});

test('a record with an unknown verdict is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeRaw(dir, 'TASK-20260724-x', makeEval({
    outcome_source: { type: 'review_scorecard', scorecard: '.ai/state/reviews/TASK-20260724-x.md', verdict: 'maybe' },
  }));
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir), null);
});

test('a record whose validation.status contradicts its result counts is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  // status "pass" but there is a failing result — counts imply fail.
  writeRaw(dir, 'TASK-20260724-x', makeEval({ validation: { status: 'pass', evidence_count: 2, results: { pass: 1, fail: 1, skipped: 0 } } }));
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir), null);
});

test('listEvaluationRecords drops a record whose filename != task_id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  writeRaw(dir, 'TASK-20260724-other', makeEval());
  assert.deepEqual(listEvaluationRecords(dir), []);
});

test('computeMetrics tolerates a decimal latency and the record still validates on read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  const withDecimalLatency = makeEval();
  withDecimalLatency.metrics.calls.latency_ms = 123.5;
  writeEvaluationRecord(withDecimalLatency, dir);
  assert.equal(readEvaluationRecord('TASK-20260724-x', dir)?.metrics.calls.latency_ms, 123.5);
});

// ─── tier + metrics ───────────────────────────────────────────────────────────

test('resolveTier matches provider+model and falls back to unknown', () => {
  const tiers = { standard: { provider: 'anthropic', model: 'claude-sonnet-4-6' } };
  assert.equal(resolveTier('anthropic', 'claude-sonnet-4-6', tiers), 'standard');
  assert.equal(resolveTier('openai', 'gpt-4.1', tiers), 'unknown');
});

test('resolveTierForRuns returns unknown for no runs or disagreement', () => {
  const tiers = {
    fast: { provider: 'gemini', model: 'gemini-2.5-flash' },
    standard: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  };
  assert.equal(resolveTierForRuns([], tiers), 'unknown');
  const agree = [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }, { provider: 'anthropic', model: 'claude-sonnet-4-6' }] as unknown as RunRecord[];
  assert.equal(resolveTierForRuns(agree, tiers), 'standard');
  const disagree = [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }, { provider: 'gemini', model: 'gemini-2.5-flash' }] as unknown as RunRecord[];
  assert.equal(resolveTierForRuns(disagree, tiers), 'unknown');
});

test('readRoutingTiers parses tiers from model-routing.yaml', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-eval-'));
  fs.mkdirSync(path.join(dir, '.ai'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ai/model-routing.yaml'),
    'tiers:\n  fast:\n    provider: gemini\n    model: gemini-2.5-flash\n  standard:\n    provider: anthropic\n    model: claude-sonnet-4-6\n');
  const tiers = readRoutingTiers(dir);
  assert.equal(tiers.fast.model, 'gemini-2.5-flash');
  assert.equal(tiers.standard.provider, 'anthropic');
});

test('computeMetrics sums call metrics and derives context metrics', () => {
  const artifact = {
    selection: { files: [{}, {}, {}] },
    excerpts: [{}, {}],
    omitted_candidates: 4,
    budget: { limit_tokens: 6000, estimated_tokens: 4800 },
  } as unknown as CompiledContextArtifact;
  const runs = [
    { input_tokens: 100, output_tokens: 20, cached_tokens: 5, latency_ms: 300, retry_count: 1 },
    { input_tokens: 50, output_tokens: 10, cached_tokens: null, latency_ms: 200, retry_count: 0 },
  ] as unknown as RunRecord[];
  const metrics = computeMetrics(artifact, runs, 2);
  assert.equal(metrics.context.selected_files, 3);
  assert.equal(metrics.context.excerpts, 2);
  assert.equal(metrics.context.omitted_candidates, 4);
  assert.equal(metrics.context.budget_utilization, 0.8);
  assert.equal(metrics.context.expansion_rounds, 2);
  assert.equal(metrics.context.context_escapes, null);
  assert.equal(metrics.calls.model_calls, 2);
  assert.equal(metrics.calls.input_tokens, 150);
  assert.equal(metrics.calls.cached_tokens, 5);
  assert.equal(metrics.calls.retries, 1);
});

test('computeMetrics records a provided escape count and defaults to null', () => {
  const artifact = {
    selection: { files: [] }, excerpts: [], omitted_candidates: 0,
    budget: { limit_tokens: 6000, estimated_tokens: 0 },
  } as unknown as CompiledContextArtifact;
  assert.equal(computeMetrics(artifact, [], 0).context.context_escapes, null);
  assert.equal(computeMetrics(artifact, [], 0, 3).context.context_escapes, 3);
  assert.equal(computeMetrics(artifact, [], 0, 0).context.context_escapes, 0);
});

test('computeMetrics handles a null artifact and empty runs', () => {
  const metrics = computeMetrics(null, [], 0);
  assert.equal(metrics.context.selected_files, 0);
  assert.equal(metrics.calls.model_calls, 0);
  assert.equal(metrics.context.budget_utilization, 0);
});

// ─── consistency gate + outcome ───────────────────────────────────────────────

const APPROVE_SCORECARD = [
  '- Task ID: `TASK-20260724-x`',
  '',
  '## Scorecard',
  '| Dimension | Rating | Notes |',
  '| --- | --- | --- |',
  '| Correctness | pass | ok |',
  '',
  'Unresolved blockers: none',
  '',
  'Verdict: Approve',
].join('\n');

const JOURNAL_WITH_EVIDENCE = [
  '- Task ID: TASK-20260724-x',
  '',
  '## Commands And Validation',
  '| Date | Command | Result |',
  '| --- | --- | --- |',
  '| 2026-07-24 | npm test | pass |',
].join('\n');

function baseInput(overrides = {}) {
  return {
    taskId: 'TASK-20260724-x',
    journalContent: JOURNAL_WITH_EVIDENCE,
    journalPath: '.ai/state/tasks/TASK-20260724-x.md',
    scorecardContent: APPROVE_SCORECARD,
    scorecardPath: '.ai/state/reviews/TASK-20260724-x.md',
    runs: [] as RunRecord[],
    artifact: null,
    artifactPath: null,
    expansionCount: 0,
    escapeCount: null,
    tiers: {},
    now: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

test('buildEvaluationRecord maps Approve to pass', () => {
  const result = buildEvaluationRecord(baseInput());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.record.outcome, 'pass');
    assert.equal(result.record.evaluation_id, 'eval-TASK-20260724-x');
    assert.equal(result.record.validation.status, 'pass');
  }
});

test('buildEvaluationRecord maps Request changes to fail and Needs human decision to partial', () => {
  const fail = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD.replace('Verdict: Approve', 'Verdict: Request changes') }));
  assert.equal(fail.ok && fail.record.outcome, 'fail');
  const partial = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD.replace('Verdict: Approve', 'Verdict: Needs human decision') }));
  assert.equal(partial.ok && partial.record.outcome, 'partial');
});

test('buildEvaluationRecord rejects a scorecard with lowercase todo', () => {
  const result = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD + '\ntodo' }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects Approve with unresolved blockers', () => {
  const result = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD.replace('Unresolved blockers: none', 'Unresolved blockers: security review pending') }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects Approve contradicted by a fail dimension rating', () => {
  const result = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD.replace('| Correctness | pass | ok |', '| Correctness | fail | broken |') }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects Approve contradicted by fail evidence', () => {
  const journal = JOURNAL_WITH_EVIDENCE.replace('npm test | pass', 'npm test | fail');
  const result = buildEvaluationRecord(baseInput({ journalContent: journal }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects when no real validation evidence', () => {
  const journal = ['## Commands And Validation', '| Date | Command | Result |', '| --- | --- | --- |'].join('\n');
  const result = buildEvaluationRecord(baseInput({ journalContent: journal }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects a scorecard task-id mismatch', () => {
  const result = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD.replace('TASK-20260724-x', 'TASK-20260724-y') }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects an invalid verdict', () => {
  const result = buildEvaluationRecord(baseInput({ scorecardContent: APPROVE_SCORECARD.replace('Verdict: Approve', 'Verdict: Maybe') }));
  assert.equal(result.ok, false);
});

test('buildEvaluationRecord rejects an empty or invalid dimension rating', () => {
  const empty = APPROVE_SCORECARD.replace('| Correctness | pass | ok |', '| Correctness |  | ok |');
  assert.equal(buildEvaluationRecord(baseInput({ scorecardContent: empty })).ok, false);
  const invalid = APPROVE_SCORECARD.replace('| Correctness | pass | ok |', '| Correctness | maybe | ok |');
  assert.equal(buildEvaluationRecord(baseInput({ scorecardContent: invalid })).ok, false);
});

test('buildEvaluationRecord rejects a dimension row with a blank name', () => {
  // Valid rating but empty dimension name — must not slip past the gate.
  const blank = APPROVE_SCORECARD.replace('| Correctness | pass | ok |', '|  | pass | ok |');
  assert.equal(buildEvaluationRecord(baseInput({ scorecardContent: blank })).ok, false);
});

test('buildEvaluationRecord rejects a scorecard with no dimension rows', () => {
  const noRows = ['- Task ID: `TASK-20260724-x`', '', '## Scorecard', '| Dimension | Rating | Notes |', '| --- | --- | --- |', '', 'Unresolved blockers: none', '', 'Verdict: Approve'].join('\n');
  assert.equal(buildEvaluationRecord(baseInput({ scorecardContent: noRows })).ok, false);
});
