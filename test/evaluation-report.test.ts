import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { aggregateEvaluations, recommendRouting, MIN_TIER_SAMPLES } from '../bin/lib/evaluation-report.js';
import type { EvaluationRecord } from '../bin/lib/types.js';
import { cli, runTs } from './helpers.js';

function rec(tier: string, outcome: EvaluationRecord['outcome'], input: number): EvaluationRecord {
  return {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: 'e', task_id: 't',
    generated_at: '2026-07-24T00:00:00.000Z', outcome, mode: 'compact', experiment_id: null, comparability: null,
    outcome_source: { type: 'review_scorecard', scorecard: 's', verdict: 'approve' },
    routing_signatures: [{ provider: 'anthropic', model: tier }],
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

// ─── recommendRouting (13D) ───────────────────────────────────────────────────

test('recommendRouting picks the lowest-token tier holding pass rate within tolerance', () => {
  const recs = [
    ...Array.from({ length: 5 }, () => rec('premium', 'pass', 5000)),
    ...Array.from({ length: 5 }, () => rec('standard', 'pass', 3000)),
  ];
  const r = recommendRouting(aggregateEvaluations(recs), 5); // explicit minSamples overrides the 20 default
  assert.equal(r.withheld, false);
  assert.equal(r.reason, null);
  assert.equal(r.reason_code, null);
  assert.equal(r.eligible_tiers, 2);
  assert.equal(r.required_tiers, 2);
  assert.equal(r.best_tier, 'premium'); // ties on pass rate -> tier-name order
  assert.equal(r.recommended_tier, 'standard'); // both 100%, standard has fewer tokens/eval
  assert.equal(r.heuristic, true);
  assert.ok(r.caveat.length > 0);
});

test('recommendRouting keeps the better tier when the lower-token one drops pass rate past tolerance', () => {
  const recs = [
    ...Array.from({ length: 5 }, () => rec('premium', 'pass', 5000)),
    ...Array.from({ length: 3 }, () => rec('standard', 'pass', 1000)),
    ...Array.from({ length: 2 }, () => rec('standard', 'fail', 1000)),
  ];
  assert.equal(recommendRouting(aggregateEvaluations(recs), 5).recommended_tier, 'premium');
});

test('recommendRouting withholds — with reason_code and counts — below two eligible tiers', () => {
  const one = recommendRouting(aggregateEvaluations(Array.from({ length: 5 }, () => rec('only', 'pass', 100))), 5);
  assert.equal(one.withheld, true);
  assert.equal(one.reason_code, 'insufficient_eligible_tiers');
  assert.ok(one.reason && one.reason.length > 0);
  assert.equal(one.eligible_tiers, 1);
  assert.equal(one.required_tiers, 2);
  const few = [rec('a', 'pass', 100), rec('b', 'pass', 100)];
  assert.equal(recommendRouting(aggregateEvaluations(few), 5).withheld, true); // below min samples
  const withUnknown = [...Array.from({ length: 5 }, () => rec('unknown', 'pass', 100)), ...Array.from({ length: 5 }, () => rec('a', 'pass', 100))];
  assert.equal(recommendRouting(aggregateEvaluations(withUnknown), 5).withheld, true); // 'unknown' excluded
});

test('recommendRouting uses MIN_TIER_SAMPLES = 20 by default', () => {
  assert.equal(MIN_TIER_SAMPLES, 20);
  const recs = [...Array.from({ length: 5 }, () => rec('premium', 'pass', 5000)), ...Array.from({ length: 5 }, () => rec('standard', 'pass', 3000))];
  assert.equal(recommendRouting(aggregateEvaluations(recs), MIN_TIER_SAMPLES).withheld, true);
  assert.equal(recommendRouting(aggregateEvaluations(recs), 5).withheld, false);
});

test('recommendRouting excludes a tier that mixes routing signatures', () => {
  const withSig = (tier: string, sigs: { provider: string; model: string }[], input: number) =>
    ({ ...rec(tier, 'pass', input), routing_signatures: sigs } as EvaluationRecord);
  const recs = [
    ...Array.from({ length: 5 }, () => withSig('premium', [{ provider: 'anthropic', model: 'opus' }], 5000)),
    ...Array.from({ length: 3 }, () => withSig('standard', [{ provider: 'anthropic', model: 'sonnet' }], 3000)),
    ...Array.from({ length: 2 }, () => withSig('standard', [{ provider: 'openrouter', model: 'meta-llama/llama-3.1,exp' }], 3000)),
  ];
  const r = recommendRouting(aggregateEvaluations(recs), 5);
  const standard = r.tiers.find((t) => t.tier === 'standard')!;
  assert.equal(standard.excluded_reason_code, 'mixed_signatures');
  assert.match(standard.excluded_reason!, /mixed routing signatures/);
  assert.equal(r.eligible_tiers, 1);
  assert.equal(r.withheld, true);
});

test('recommendRouting excludes a tier with no routing signature', () => {
  const withSig = (tier: string, sigs: { provider: string; model: string }[], input: number) =>
    ({ ...rec(tier, 'pass', input), routing_signatures: sigs } as EvaluationRecord);
  const recs = [
    ...Array.from({ length: 5 }, () => withSig('premium', [{ provider: 'anthropic', model: 'opus' }], 5000)),
    ...Array.from({ length: 5 }, () => withSig('standard', [], 1000)),
  ];
  const r = recommendRouting(aggregateEvaluations(recs), 5);
  const standard = r.tiers.find((t) => t.tier === 'standard')!;
  assert.equal(standard.excluded_reason_code, 'missing_signature');
  assert.equal(standard.excluded_reason, 'missing routing signature');
  assert.equal(r.withheld, true);
});

// Build an Aggregate directly so pass rates and token costs can be set exactly.
function aggOf(tiers: Record<string, { count: number; pass: number; input: number; signatures?: { provider: string; model: string }[] }>) {
  const byTier: Record<string, { count: number; pass: number; partial: number; fail: number; input_tokens: number; output_tokens: number; latency_ms: number; retries: number; signatures?: { provider: string; model: string }[] }> = {};
  for (const [t, v] of Object.entries(tiers)) {
    byTier[t] = { count: v.count, pass: v.pass, partial: 0, fail: v.count - v.pass, input_tokens: v.input, output_tokens: 0, latency_ms: 0, retries: 0, signatures: v.signatures ?? [{ provider: 'anthropic', model: t }] };
  }
  return { total: 0, outcomes: { pass: 0, partial: 0, fail: 0 }, byTier };
}

test('recommendRouting compares RAW pass rates at the 5-point tolerance boundary', () => {
  const exact = recommendRouting(aggOf({ premium: { count: 20, pass: 20, input: 5000 }, standard: { count: 20, pass: 19, input: 1000 } }), 5);
  assert.equal(exact.recommended_tier, 'standard'); // exactly 5.0 drop keeps the cheap tier
  const justOver = recommendRouting(aggOf({ premium: { count: 10000, pass: 10000, input: 5000 }, standard: { count: 10000, pass: 9496, input: 1000 } }), 5);
  assert.equal(justOver.recommended_tier, 'premium'); // raw drop 5.04 excludes the cheap tier
});

test('recommendRouting breaks a mean-token tie by tier name ascending', () => {
  const r = recommendRouting(aggOf({ bbb: { count: 5, pass: 5, input: 1000 }, aaa: { count: 5, pass: 5, input: 1000 } }), 5);
  assert.equal(r.recommended_tier, 'aaa');
  assert.equal(r.best_tier, 'aaa');
});

// ─── Routing section in --report (13D) ────────────────────────────────────────

function writeReportRepo(): { dir: string; evalDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-routing-'));
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  return { dir, evalDir };
}
function writeEvalFile(evalDir: string, id: string, tier: string, outcome: EvaluationRecord['outcome'], input: number): void {
  fs.writeFileSync(path.join(evalDir, `${id}.json`), JSON.stringify({ ...rec(tier, outcome, input), task_id: id, evaluation_id: `eval-${id}` }));
}

test('--report --json includes a routing recommendation with the full contract', () => {
  const { dir, evalDir } = writeReportRepo();
  for (let i = 0; i < 5; i += 1) writeEvalFile(evalDir, `TASK-20260728-p${i}`, 'premium', 'pass', 5000);
  for (let i = 0; i < 5; i += 1) writeEvalFile(evalDir, `TASK-20260728-s${i}`, 'standard', 'pass', 3000);
  const payload = JSON.parse(runTs(cli, ['--report', '--json', '--min-samples', '5'], { cwd: dir }));
  assert.equal(payload.routing.withheld, false);
  assert.equal(payload.routing.reason, null);
  assert.equal(payload.routing.reason_code, null);
  assert.equal(payload.routing.eligible_tiers, 2);
  assert.equal(payload.routing.required_tiers, 2);
  assert.equal(payload.routing.min_samples, 5);
  assert.equal(payload.routing.recommended_tier, 'standard');
  assert.equal(payload.routing.best_tier, 'premium');
  assert.equal(payload.routing.tiers.length, 2);
  assert.equal(payload.routing.tiers[0].excluded_reason, null);
  assert.equal(payload.routing.tiers[0].excluded_reason_code, null);
  assert.deepEqual(payload.routing.tiers[0].routing_signatures, [{ provider: 'anthropic', model: 'premium' }]);
  assert.deepEqual(payload.invalid_records, []);
  assert.equal(payload.routing.heuristic, true);
  assert.ok(payload.routing.caveat.length > 0);
});

test('--report human output shows a Routing advisory line', () => {
  const { dir, evalDir } = writeReportRepo();
  for (let i = 0; i < 5; i += 1) writeEvalFile(evalDir, `TASK-20260728-p${i}`, 'premium', 'pass', 5000);
  for (let i = 0; i < 5; i += 1) writeEvalFile(evalDir, `TASK-20260728-s${i}`, 'standard', 'pass', 3000);
  const out = runTs(cli, ['--report', '--min-samples', '5'], { cwd: dir });
  assert.match(out, /Routing/);
  assert.match(out, /\[advisory · heuristic\] route to standard/);
  assert.match(out, /lowest-token/);
  assert.match(out, /does not control for task difficulty/);
});

test('--report Routing default gate withholds two 5-eval tiers under MIN_TIER_SAMPLES=20', () => {
  const { dir, evalDir } = writeReportRepo();
  for (let i = 0; i < 5; i += 1) writeEvalFile(evalDir, `TASK-20260728-p${i}`, 'premium', 'pass', 5000);
  for (let i = 0; i < 5; i += 1) writeEvalFile(evalDir, `TASK-20260728-s${i}`, 'standard', 'pass', 3000);
  const payload = JSON.parse(runTs(cli, ['--report', '--json'], { cwd: dir }));
  assert.equal(payload.routing.min_samples, 20);
  assert.equal(payload.routing.withheld, true);
  const eq = JSON.parse(runTs(cli, ['--report', '--json', '--min-samples=5'], { cwd: dir }));
  assert.equal(eq.routing.min_samples, 5);
  assert.equal(eq.routing.withheld, false);
});

test('--report Routing is withheld (with a printed line) when only one tier is eligible', () => {
  const { dir, evalDir } = writeReportRepo();
  for (let i = 0; i < 5; i += 1) writeEvalFile(evalDir, `TASK-20260728-p${i}`, 'premium', 'pass', 5000);
  const out = runTs(cli, ['--report', '--min-samples', '5'], { cwd: dir });
  assert.match(out, /Routing/);
  assert.match(out, /routing recommendation withheld — fewer than 2 eligible tiers/);
});

test('--report surfaces invalid records and withholds routing', () => {
  const { dir, evalDir } = writeReportRepo();
  for (let i = 0; i < 5; i += 1) writeEvalFile(evalDir, `TASK-20260728-p${i}`, 'premium', 'pass', 5000);
  for (let i = 0; i < 5; i += 1) writeEvalFile(evalDir, `TASK-20260728-s${i}`, 'standard', 'pass', 3000);
  fs.writeFileSync(path.join(evalDir, 'TASK-20260728-bad.json'), '{ not valid');
  const payload = JSON.parse(runTs(cli, ['--report', '--json', '--min-samples', '5'], { cwd: dir }));
  assert.equal(payload.invalid_records.length, 1);
  assert.equal(payload.invalid_records[0].file, 'TASK-20260728-bad.json');
  assert.equal(payload.invalid_records[0].reason_code, 'invalid_json');
  assert.equal(payload.routing.withheld, true);
  assert.equal(payload.routing.reason_code, 'invalid_records_present');
  assert.match(runTs(cli, ['--report', '--min-samples', '5'], { cwd: dir }), /1 invalid evaluation record/);
});

test('--report with ONLY invalid records still warns and withholds (full JSON schema)', () => {
  const { dir, evalDir } = writeReportRepo();
  fs.writeFileSync(path.join(evalDir, 'TASK-20260728-bad.json'), '{ not valid');
  const payload = JSON.parse(runTs(cli, ['--report', '--json'], { cwd: dir }));
  assert.equal(payload.invalid_records.length, 1);
  assert.equal(payload.routing.withheld, true);
  assert.equal(payload.routing.reason_code, 'invalid_records_present');
  assert.ok(payload.experiments);
  assert.ok(payload.recommendation);
  assert.ok('byTier' in payload);
  const human = runTs(cli, ['--report'], { cwd: dir });
  assert.doesNotMatch(human, /has no evaluation records/);
  assert.match(human, /1 invalid evaluation record/);
});

test('--report does not crash on a bad timestamp; lists it invalid_schema', () => {
  const { dir, evalDir } = writeReportRepo();
  fs.writeFileSync(path.join(evalDir, 'TASK-20260728-x.json'), JSON.stringify({ ...rec('standard', 'pass', 100), task_id: 'TASK-20260728-x', evaluation_id: 'eval-TASK-20260728-x', generated_at: 'invalid' }));
  const payload = JSON.parse(runTs(cli, ['--report', '--json'], { cwd: dir }));
  assert.equal(payload.invalid_records.length, 1);
  assert.equal(payload.invalid_records[0].reason_code, 'invalid_schema');
  assert.equal(payload.routing.reason_code, 'invalid_records_present');
});

test('--report reports read_error (not invalid_json) when a record path is unreadable', () => {
  const { dir, evalDir } = writeReportRepo();
  fs.mkdirSync(path.join(evalDir, 'TASK-20260728-x.json')); // a directory: readFileSync throws EISDIR
  const payload = JSON.parse(runTs(cli, ['--report', '--json'], { cwd: dir }));
  assert.equal(payload.invalid_records.length, 1);
  assert.equal(payload.invalid_records[0].reason_code, 'read_error');
  assert.equal(payload.routing.withheld, true);
  assert.equal(payload.routing.reason_code, 'invalid_records_present');
});
