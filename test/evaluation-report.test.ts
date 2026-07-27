import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { aggregateEvaluations } from '../bin/lib/evaluation-report.js';
import type { EvaluationRecord } from '../bin/lib/types.js';
import { cli, runTs } from './helpers.js';

function rec(tier: string, outcome: EvaluationRecord['outcome'], input: number): EvaluationRecord {
  return {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: 'e', task_id: 't',
    generated_at: '2026-07-24T00:00:00.000Z', outcome, mode: 'compact', experiment_id: null, comparability: null,
    outcome_source: { type: 'review_scorecard', scorecard: 's', verdict: 'approve' },
    validation: { status: 'pass', evidence_count: 1, results: { pass: 1, fail: 0, skipped: 0 } },
    run_ids: [], context_artifact: null, task_journal: '.ai/state/tasks/t.md', tier,
    metrics: {
      context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: input, output_tokens: 10, cached_tokens: 0, latency_ms: 100, retries: 0 },
    },
  };
}

test('aggregateEvaluations groups by tier, counts outcomes, and totals tokens', () => {
  const agg = aggregateEvaluations([rec('standard', 'pass', 100), rec('standard', 'fail', 200), rec('fast', 'pass', 50)]);
  assert.equal(agg.total, 3);
  assert.equal(agg.outcomes.pass, 2);
  assert.equal(agg.outcomes.fail, 1);
  assert.equal(agg.byTier.standard.count, 2);
  assert.equal(agg.byTier.standard.input_tokens, 300);
  assert.equal(agg.byTier.standard.output_tokens, 20);
  assert.equal((agg.byTier.standard.input_tokens + agg.byTier.standard.output_tokens) / agg.byTier.standard.count, 160);
  assert.equal(agg.byTier.fast.pass, 1);
});

test('aggregateEvaluations handles an empty list', () => {
  const agg = aggregateEvaluations([]);
  assert.equal(agg.total, 0);
  assert.deepEqual(agg.byTier, {});
});

function writeRecordFile(dir: string, taskId: string, tier: string): void {
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  const record = {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: `eval-${taskId}`, task_id: taskId,
    generated_at: '2026-07-24T00:00:00.000Z', outcome: 'pass',
    outcome_source: { type: 'review_scorecard', scorecard: `.ai/state/reviews/${taskId}.md`, verdict: 'approve' },
    validation: { status: 'pass', evidence_count: 1, results: { pass: 1, fail: 0, skipped: 0 } },
    run_ids: [], context_artifact: null, task_journal: `.ai/state/tasks/${taskId}.md`, tier,
    metrics: {
      context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: 100, output_tokens: 20, cached_tokens: 0, latency_ms: 100, retries: 0 },
    },
  };
  fs.writeFileSync(path.join(evalDir, `${taskId}.json`), JSON.stringify(record, null, 2) + '\n');
}

test('--report prints a human-readable report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-report-'));
  writeRecordFile(dir, 'TASK-20260724-a', 'standard');
  const out = runTs(cli, ['--report'], { cwd: dir });
  assert.match(out, /evaluation report/i);
  assert.match(out, /standard: 1 evaluation/);
});

test('--report --json emits parseable aggregate JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-report-'));
  writeRecordFile(dir, 'TASK-20260724-a', 'standard');
  const out = runTs(cli, ['--report', '--json'], { cwd: dir });
  const agg = JSON.parse(out);
  assert.equal(agg.total, 1);
  assert.equal(agg.byTier.standard.count, 1);
});
