import type { EvaluationRecord } from './types.js';
import { root, args, getArgValue } from './context.js';
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

// ─── experiment pairing, aggregation, and recommendation (13B) ────────────────

export const MIN_EXPERIMENT_PAIRS = 5;
export const MAX_PASS_RATE_DROP_PCT = 5;
export const MIN_TOKEN_SAVING_PCT = 15;
export const MIN_LATENCY_SAVING_PCT = 15;

export type ExperimentPair = {
  experiment_id: string;
  baseline: EvaluationRecord;
  compact: EvaluationRecord;
  token_saving_pct: number;
  latency_saving_pct: number;
  outcome_preserved: boolean;
};
export type SkippedExperiment = { experiment_id: string; reason: string };
export type ExperimentAggregate = {
  pairs: number;
  baseline_pass_rate: number;
  compact_pass_rate: number;
  pass_rate_drop_pct: number;
  mean_token_saving_pct: number;
  mean_latency_saving_pct: number;
};
export type Recommendation = {
  verdict: 'prefer_compact' | 'keep_baseline' | 'no_material_difference' | null;
  withheld: boolean;
  min_samples: number;
  pairs: number;
  pass_rate_drop_pct: number;
  mean_token_saving_pct: number;
  mean_latency_saving_pct: number;
};

const OUTCOME_RANK: Record<EvaluationRecord['outcome'], number> = { fail: 0, partial: 1, pass: 2 };
// Round ONLY for display/JSON (see runReport); decisions use raw values.
export const round1 = (n: number): number => Math.round(n * 10) / 10;
const tokensOf = (r: EvaluationRecord): number => r.metrics.calls.input_tokens + r.metrics.calls.output_tokens;
// Raw (unrounded) percentage — a true drop just above tolerance must not round down into it.
const savingPct = (base: number, comp: number): number => (base > 0 ? ((base - comp) / base) * 100 : 0);

export function pairExperiments(records: EvaluationRecord[]): { pairs: ExperimentPair[]; skipped: SkippedExperiment[] } {
  const byExp = new Map<string, EvaluationRecord[]>();
  for (const r of records) {
    if (r.experiment_id === null) continue; // non-experiment 13A records
    const list = byExp.get(r.experiment_id) ?? [];
    list.push(r);
    byExp.set(r.experiment_id, list);
  }
  const pairs: ExperimentPair[] = [];
  const skipped: SkippedExperiment[] = [];
  for (const [experiment_id, list] of [...byExp.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const baselines = list.filter((r) => r.mode === 'baseline');
    const compacts = list.filter((r) => r.mode === 'compact');
    if (baselines.length !== 1 || compacts.length !== 1 || list.length !== 2) {
      skipped.push({ experiment_id, reason: `expected one baseline and one compact record, got ${baselines.length} baseline / ${compacts.length} compact` });
      continue;
    }
    const baseline = baselines[0];
    const compact = compacts[0];
    // Comparability gate: a valid context-mode experiment differs ONLY in mode.
    if (baseline.metrics.context.expansion_rounds > 0 || compact.metrics.context.expansion_rounds > 0) {
      skipped.push({ experiment_id, reason: 'excluded: an expansion round was recorded (baseline expansion is not whole-file in 13B)' });
      continue;
    }
    if (baseline.comparability === null || compact.comparability === null) {
      skipped.push({ experiment_id, reason: 'excluded: a record has no primary artifact to compare' });
      continue;
    }
    const bc = baseline.comparability;
    const cc = compact.comparability;
    // routing_signature (provider/model) is used instead of a bare tier check so two
    // distinct models that both resolve to tier 'unknown' are still non-comparable.
    if (bc.objective !== cc.objective
      || bc.repository_fingerprint !== cc.repository_fingerprint
      || bc.selection_signature !== cc.selection_signature
      || bc.acceptance_signature !== cc.acceptance_signature
      || bc.routing_signature !== cc.routing_signature) {
      skipped.push({ experiment_id, reason: 'excluded: baseline and compact are not comparable (objective/fingerprint/selection/acceptance/model differ)' });
      continue;
    }
    pairs.push({
      experiment_id,
      baseline,
      compact,
      token_saving_pct: savingPct(tokensOf(baseline), tokensOf(compact)),
      latency_saving_pct: savingPct(baseline.metrics.calls.latency_ms, compact.metrics.calls.latency_ms),
      outcome_preserved: OUTCOME_RANK[compact.outcome] >= OUTCOME_RANK[baseline.outcome],
    });
  }
  return { pairs, skipped };
}

export function aggregateExperiments(pairs: ExperimentPair[]): ExperimentAggregate {
  const n = pairs.length;
  if (n === 0) {
    return { pairs: 0, baseline_pass_rate: 0, compact_pass_rate: 0, pass_rate_drop_pct: 0, mean_token_saving_pct: 0, mean_latency_saving_pct: 0 };
  }
  // Raw values — recommend() applies thresholds to these; rounding is display-only.
  const passRatePct = (pick: (p: ExperimentPair) => EvaluationRecord): number =>
    (pairs.filter((p) => pick(p).outcome === 'pass').length / n) * 100;
  const baseline_pass_rate = passRatePct((p) => p.baseline);
  const compact_pass_rate = passRatePct((p) => p.compact);
  const mean = (pick: (p: ExperimentPair) => number): number => pairs.reduce((s, p) => s + pick(p), 0) / n;
  return {
    pairs: n,
    baseline_pass_rate,
    compact_pass_rate,
    pass_rate_drop_pct: baseline_pass_rate - compact_pass_rate,
    mean_token_saving_pct: mean((p) => p.token_saving_pct),
    mean_latency_saving_pct: mean((p) => p.latency_saving_pct),
  };
}

export function recommend(aggregate: ExperimentAggregate, minSamples: number): Recommendation {
  const base = {
    withheld: false, min_samples: minSamples, pairs: aggregate.pairs,
    pass_rate_drop_pct: aggregate.pass_rate_drop_pct,
    mean_token_saving_pct: aggregate.mean_token_saving_pct,
    mean_latency_saving_pct: aggregate.mean_latency_saving_pct,
  };
  if (aggregate.pairs < minSamples) return { ...base, verdict: null, withheld: true };
  if (aggregate.pass_rate_drop_pct > MAX_PASS_RATE_DROP_PCT) return { ...base, verdict: 'keep_baseline' };
  const material = aggregate.mean_token_saving_pct >= MIN_TOKEN_SAVING_PCT || aggregate.mean_latency_saving_pct >= MIN_LATENCY_SAVING_PCT;
  return { ...base, verdict: material ? 'prefer_compact' : 'no_material_difference' };
}

export function runReport(): void {
  const records = listEvaluationRecords(root);

  // Resolve --min-samples (positive integer; defaults to MIN_EXPERIMENT_PAIRS).
  let minSamples = MIN_EXPERIMENT_PAIRS;
  const minRaw = getArgValue('--min-samples');
  if (minRaw !== null) {
    const parsed = Number(minRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      process.stderr.write('Error: --min-samples must be a positive integer.\n');
      process.exitCode = 1;
      return;
    }
    minSamples = parsed;
  }

  const { pairs, skipped } = pairExperiments(records);
  const aggregate = aggregateExperiments(pairs); // raw values (decisions already made in recommend)
  const recommendation = recommend(aggregate, minSamples);

  // Round ONLY for output. `recommend` already decided on the raw aggregate above.
  const outAggregate = {
    ...aggregate,
    baseline_pass_rate: round1(aggregate.baseline_pass_rate),
    compact_pass_rate: round1(aggregate.compact_pass_rate),
    pass_rate_drop_pct: round1(aggregate.pass_rate_drop_pct),
    mean_token_saving_pct: round1(aggregate.mean_token_saving_pct),
    mean_latency_saving_pct: round1(aggregate.mean_latency_saving_pct),
  };
  const outRecommendation = {
    ...recommendation,
    pass_rate_drop_pct: round1(recommendation.pass_rate_drop_pct),
    mean_token_saving_pct: round1(recommendation.mean_token_saving_pct),
    mean_latency_saving_pct: round1(recommendation.mean_latency_saving_pct),
  };

  if (args.has('--json')) {
    const payload = {
      ...aggregateEvaluations(records),
      experiments: {
        aggregate: outAggregate,
        pairs: pairs.map((p) => ({
          experiment_id: p.experiment_id,
          baseline_outcome: p.baseline.outcome,
          compact_outcome: p.compact.outcome,
          token_saving_pct: round1(p.token_saving_pct),
          latency_saving_pct: round1(p.latency_saving_pct),
          outcome_preserved: p.outcome_preserved,
        })),
        skipped,
      },
      recommendation: outRecommendation,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
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

  console.log('');
  console.log('Experiments');
  if (pairs.length === 0 && skipped.length === 0) {
    console.log(formatStatus('skipped', 'no paired experiments recorded'));
    return;
  }
  for (const p of pairs) {
    console.log(formatStatus('metric', `${p.experiment_id}: baseline ${p.baseline.outcome} vs compact ${p.compact.outcome}, tokens saved ${round1(p.token_saving_pct)}%, latency saved ${round1(p.latency_saving_pct)}%`));
  }
  for (const s of skipped) {
    console.log(formatStatus('skipped', `${s.experiment_id}: ${s.reason}`));
  }
  if (pairs.length > 0) {
    console.log(formatStatus('metric', `pairs ${aggregate.pairs}: baseline pass ${outAggregate.baseline_pass_rate}% vs compact pass ${outAggregate.compact_pass_rate}% (drop ${outAggregate.pass_rate_drop_pct} pts), mean tokens saved ${outAggregate.mean_token_saving_pct}%, mean latency saved ${outAggregate.mean_latency_saving_pct}%`));
  }
  if (recommendation.withheld) {
    console.log(formatStatus('skipped', `insufficient samples (${aggregate.pairs}/${minSamples}) — recommendation withheld`));
  } else {
    // Every advisory line states the pair count (n comparable pairs) per the design.
    const n = `${aggregate.pairs} comparable pair${aggregate.pairs === 1 ? '' : 's'}`;
    const verdictText = recommendation.verdict === 'prefer_compact'
      ? `prefer compact — ${n}, outcomes held (drop ${outAggregate.pass_rate_drop_pct} pts), savings material (tokens ${outAggregate.mean_token_saving_pct}%, latency ${outAggregate.mean_latency_saving_pct}%)`
      : recommendation.verdict === 'keep_baseline'
        ? `keep baseline — ${n}, compact degrades pass rate by ${outAggregate.pass_rate_drop_pct} pts (tolerance ${MAX_PASS_RATE_DROP_PCT})`
        : `no material difference — ${n}, either mode acceptable (tokens ${outAggregate.mean_token_saving_pct}%, latency ${outAggregate.mean_latency_saving_pct}%)`;
    console.log(formatStatus('metric', `[advisory] ${verdictText}`));
  }
}
