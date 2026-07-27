import type { EvaluationRecord } from './types.js';
import { root, args } from './context.js';
import { formatStatus } from './utils.js';
import { listEvaluationRecords } from './evaluation-record.js';

type TierAgg = { count: number; pass: number; partial: number; fail: number; input_tokens: number; output_tokens: number; latency_ms: number; retries: number };
type Aggregate = { total: number; outcomes: { pass: number; partial: number; fail: number }; byTier: Record<string, TierAgg> };

export function aggregateEvaluations(records: EvaluationRecord[]): Aggregate {
  const agg: Aggregate = { total: records.length, outcomes: { pass: 0, partial: 0, fail: 0 }, byTier: {} };
  for (const r of records) {
    agg.outcomes[r.outcome] += 1;
    const tier = (agg.byTier[r.tier] ??= { count: 0, pass: 0, partial: 0, fail: 0, input_tokens: 0, output_tokens: 0, latency_ms: 0, retries: 0 });
    tier.count += 1;
    tier[r.outcome] += 1;
    tier.input_tokens += r.metrics.calls.input_tokens;
    tier.output_tokens += r.metrics.calls.output_tokens;
    tier.latency_ms += r.metrics.calls.latency_ms;
    tier.retries += r.metrics.calls.retries;
  }
  return agg;
}

function passRate(pass: number, total: number): string {
  return total === 0 ? 'n/a' : `${Math.round((pass / total) * 100)}%`;
}

export function runReport(): void {
  const records = listEvaluationRecords(root);
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(aggregateEvaluations(records), null, 2)}\n`);
    return;
  }
  console.log('ForgeAI evaluation report');
  console.log('');
  if (records.length === 0) {
    console.log(formatStatus('ok', '.ai/state/evaluations has no evaluation records'));
    return;
  }
  const agg = aggregateEvaluations(records);
  console.log(formatStatus('metric', `evaluations: ${agg.total} (pass ${agg.outcomes.pass} / partial ${agg.outcomes.partial} / fail ${agg.outcomes.fail}) — pass rate ${passRate(agg.outcomes.pass, agg.total)}`));
  console.log('');
  console.log('By tier');
  for (const [tier, t] of Object.entries(agg.byTier).sort((a, b) => a[0].localeCompare(b[0]))) {
    const totalTokens = t.input_tokens + t.output_tokens;
    const meanTokens = Math.round(totalTokens / t.count);
    const meanLatency = Math.round(t.latency_ms / t.count);
    console.log(formatStatus('metric', `${tier}: ${t.count} evaluation${t.count === 1 ? '' : 's'}, pass rate ${passRate(t.pass, t.count)}, tokens in=${t.input_tokens} out=${t.output_tokens} (total ${totalTokens}, mean ${meanTokens}), mean latency ${meanLatency}ms, retries ${t.retries}`));
  }
}
