import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvaluationRecord, EvaluationComparability } from '../bin/lib/types.js';
import {
  pairExperiments, aggregateExperiments, recommend, MIN_EXPERIMENT_PAIRS,
  type ExperimentAggregate,
} from '../bin/lib/evaluation-report.js';

const CMP: EvaluationComparability = { objective: 'demo', repository_fingerprint: 'fp', selection_signature: '1:5:a.ts', acceptance_signature: 'npm test', routing_signature: 'anthropic/claude-opus-4-8' };

function rec(opts: {
  task: string; mode: 'baseline' | 'compact'; exp: string | null; outcome: EvaluationRecord['outcome'];
  input: number; output: number; latency: number;
  tier?: string; expansion?: number; comparability?: EvaluationComparability | null;
}): EvaluationRecord {
  return {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: `eval-${opts.task}`, task_id: opts.task,
    generated_at: '2026-07-27T00:00:00.000Z', outcome: opts.outcome, mode: opts.mode, experiment_id: opts.exp,
    comparability: opts.comparability === undefined ? CMP : opts.comparability,
    outcome_source: { type: 'review_scorecard', scorecard: 's', verdict: opts.outcome === 'pass' ? 'approve' : opts.outcome === 'fail' ? 'request changes' : 'needs human decision' },
    validation: { status: 'pass', evidence_count: 1, results: { pass: 1, fail: 0, skipped: 0 } },
    run_ids: [], context_artifact: '.ai/state/context/x.json', task_journal: 't', tier: opts.tier ?? 'standard',
    metrics: {
      context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: opts.expansion ?? 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: opts.input, output_tokens: opts.output, cached_tokens: 0, latency_ms: opts.latency, retries: 0 },
    },
  };
}

function agg(over: Partial<ExperimentAggregate>): ExperimentAggregate {
  return { pairs: 5, baseline_pass_rate: 100, compact_pass_rate: 100, pass_rate_drop_pct: 0, mean_token_saving_pct: 0, mean_latency_saving_pct: 0, ...over };
}

test('pairExperiments matches one comparable baseline + one compact per experiment id', () => {
  const records = [
    rec({ task: 'TASK-20260727-ab', mode: 'baseline', exp: 'EXP-20260727-p1', outcome: 'pass', input: 1000, output: 100, latency: 500 }),
    rec({ task: 'TASK-20260727-ac', mode: 'compact', exp: 'EXP-20260727-p1', outcome: 'pass', input: 400, output: 100, latency: 300 }),
    rec({ task: 'TASK-20260727-solo', mode: 'compact', exp: null, outcome: 'pass', input: 10, output: 1, latency: 10 }),
  ];
  const { pairs, skipped } = pairExperiments(records);
  assert.equal(pairs.length, 1);
  assert.equal(skipped.length, 0);
  assert.equal(pairs[0].experiment_id, 'EXP-20260727-p1');
  assert.ok(Math.abs(pairs[0].token_saving_pct - 54.5) < 0.2); // (1100-500)/1100*100
  assert.equal(pairs[0].outcome_preserved, true);
});

test('pairExperiments reports incomplete experiments as skipped', () => {
  const records = [
    rec({ task: 'TASK-20260727-x', mode: 'baseline', exp: 'EXP-20260727-p2', outcome: 'pass', input: 100, output: 10, latency: 10 }),
    rec({ task: 'TASK-20260727-y', mode: 'baseline', exp: 'EXP-20260727-p3', outcome: 'pass', input: 100, output: 10, latency: 10 }),
    rec({ task: 'TASK-20260727-z', mode: 'compact', exp: 'EXP-20260727-p3', outcome: 'pass', input: 100, output: 10, latency: 10 }),
    rec({ task: 'TASK-20260727-w', mode: 'compact', exp: 'EXP-20260727-p3', outcome: 'pass', input: 100, output: 10, latency: 10 }),
  ];
  const { pairs, skipped } = pairExperiments(records);
  assert.equal(pairs.length, 0); // p2 missing compact; p3 has two compacts
  assert.deepEqual(skipped.map((s) => s.experiment_id).sort(), ['EXP-20260727-p2', 'EXP-20260727-p3']);
});

test('pairExperiments excludes a non-comparable pair (different model or objective)', () => {
  const records = [
    rec({ task: 'TASK-20260727-nt1', mode: 'baseline', exp: 'EXP-20260727-nt', outcome: 'pass', input: 1000, output: 0, latency: 100, tier: 'unknown', comparability: { ...CMP, routing_signature: 'openai/gpt-x' } }),
    rec({ task: 'TASK-20260727-nt2', mode: 'compact', exp: 'EXP-20260727-nt', outcome: 'pass', input: 400, output: 0, latency: 100, tier: 'unknown', comparability: { ...CMP, routing_signature: 'anthropic/claude-opus-4-8' } }),
    rec({ task: 'TASK-20260727-no1', mode: 'baseline', exp: 'EXP-20260727-no', outcome: 'pass', input: 1000, output: 0, latency: 100, comparability: { ...CMP, objective: 'A' } }),
    rec({ task: 'TASK-20260727-no2', mode: 'compact', exp: 'EXP-20260727-no', outcome: 'pass', input: 400, output: 0, latency: 100, comparability: { ...CMP, objective: 'B' } }),
  ];
  const { pairs, skipped } = pairExperiments(records);
  assert.equal(pairs.length, 0);
  assert.deepEqual(skipped.map((s) => s.experiment_id).sort(), ['EXP-20260727-no', 'EXP-20260727-nt']);
});

test('acceptance_signature distinguishes commands (gate behavior)', () => {
  const same = pairExperiments([
    rec({ task: 'TASK-20260727-s1', mode: 'baseline', exp: 'EXP-20260727-s', outcome: 'pass', input: 1000, output: 0, latency: 100, comparability: { ...CMP, acceptance_signature: 'npm test' } }),
    rec({ task: 'TASK-20260727-s2', mode: 'compact', exp: 'EXP-20260727-s', outcome: 'pass', input: 400, output: 0, latency: 100, comparability: { ...CMP, acceptance_signature: 'npm test' } }),
  ]);
  assert.equal(same.pairs.length, 1);
  const diff = pairExperiments([
    rec({ task: 'TASK-20260727-d1', mode: 'baseline', exp: 'EXP-20260727-d', outcome: 'pass', input: 1000, output: 0, latency: 100, comparability: { ...CMP, acceptance_signature: 'npm test' } }),
    rec({ task: 'TASK-20260727-d2', mode: 'compact', exp: 'EXP-20260727-d', outcome: 'pass', input: 400, output: 0, latency: 100, comparability: { ...CMP, acceptance_signature: 'npm run build' } }),
  ]);
  assert.equal(diff.pairs.length, 0);
});

test('pairExperiments excludes a pair with an expansion round or a null comparability', () => {
  const expanded = pairExperiments([
    rec({ task: 'TASK-20260727-ex1', mode: 'baseline', exp: 'EXP-20260727-ex', outcome: 'pass', input: 1000, output: 0, latency: 100, expansion: 1 }),
    rec({ task: 'TASK-20260727-ex2', mode: 'compact', exp: 'EXP-20260727-ex', outcome: 'pass', input: 400, output: 0, latency: 100 }),
  ]);
  assert.equal(expanded.pairs.length, 0);
  assert.equal(expanded.skipped.length, 1);
  const noArtifact = pairExperiments([
    rec({ task: 'TASK-20260727-na1', mode: 'baseline', exp: 'EXP-20260727-na', outcome: 'pass', input: 1000, output: 0, latency: 100, comparability: null }),
    rec({ task: 'TASK-20260727-na2', mode: 'compact', exp: 'EXP-20260727-na', outcome: 'pass', input: 400, output: 0, latency: 100 }),
  ]);
  assert.equal(noArtifact.pairs.length, 0);
  assert.equal(noArtifact.skipped.length, 1);
});

test('aggregateExperiments avoids divide-by-zero on a zero-baseline pair', () => {
  const { pairs } = pairExperiments([
    rec({ task: 'TASK-20260727-z1', mode: 'baseline', exp: 'EXP-20260727-z', outcome: 'pass', input: 0, output: 0, latency: 0 }),
    rec({ task: 'TASK-20260727-z2', mode: 'compact', exp: 'EXP-20260727-z', outcome: 'pass', input: 0, output: 0, latency: 0 }),
  ]);
  const a = aggregateExperiments(pairs);
  assert.equal(a.mean_token_saving_pct, 0);
  assert.equal(a.mean_latency_saving_pct, 0);
});

test('recommend withholds below the sample threshold with a null verdict', () => {
  const r = recommend(agg({ pairs: 2 }), MIN_EXPERIMENT_PAIRS);
  assert.equal(r.withheld, true);
  assert.equal(r.verdict, null);
});

test('recommend prefers compact at the exact tolerance boundary when savings are material', () => {
  const r = recommend(agg({ pass_rate_drop_pct: 5, mean_token_saving_pct: 20 }), MIN_EXPERIMENT_PAIRS);
  assert.equal(r.withheld, false);
  assert.equal(r.verdict, 'prefer_compact');
});

test('recommend prefers compact on material latency saving even when token saving is immaterial', () => {
  const r = recommend(agg({ mean_token_saving_pct: 5, mean_latency_saving_pct: 20 }), MIN_EXPERIMENT_PAIRS);
  assert.equal(r.verdict, 'prefer_compact');
});

test('recommend reports no material difference when neither token nor latency saving is material', () => {
  const r = recommend(agg({ mean_token_saving_pct: 5, mean_latency_saving_pct: 5 }), MIN_EXPERIMENT_PAIRS);
  assert.equal(r.verdict, 'no_material_difference');
});

test('recommend keeps baseline when the pass-rate drop exceeds tolerance', () => {
  const r = recommend(agg({ pass_rate_drop_pct: 6, mean_token_saving_pct: 90 }), MIN_EXPERIMENT_PAIRS);
  assert.equal(r.verdict, 'keep_baseline');
});

test('recommend applies tolerance to the raw drop, not the rounded one', () => {
  const r = recommend(agg({ pass_rate_drop_pct: 5.04, mean_token_saving_pct: 90 }), MIN_EXPERIMENT_PAIRS);
  assert.equal(r.verdict, 'keep_baseline');
});
