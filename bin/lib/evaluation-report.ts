import type { EvaluationRecord, RoutingSignature } from './types.js';
import { root, args, getArgValue } from './context.js';
import { formatStatus } from './utils.js';
import { listEvaluationRecordsDetailed } from './evaluation-record.js';

type TierAgg = { count: number; pass: number; partial: number; fail: number; input_tokens: number; output_tokens: number; latency_ms: number; retries: number; signatures?: RoutingSignature[] };
export type Aggregate = { total: number; outcomes: { pass: number; partial: number; fail: number }; byTier: Record<string, TierAgg> };

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
    // Track distinct {provider, model} pairs per tier so a tier remapped across models
    // is excluded (mixed) and a tier with no signature is excluded (missing), rather
    // than blended/trusted. A record with an empty routing_signatures adds none.
    for (const s of r.routing_signatures) {
      tier.signatures ??= [];
      if (!tier.signatures.some((x) => x.provider === s.provider && x.model === s.model)) {
        tier.signatures.push(s);
      }
    }
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

// ─── model-tier routing recommendation (13D) ──────────────────────────────────

// Routing needs a stronger gate than the 5-pair experiment default — at 5 evals a
// pass rate moves in 20-pt steps, degenerate against a 5-pt tolerance.
export const MIN_TIER_SAMPLES = 20;

// The pick is the lowest-*token* tier (not cost), gated on per-tier eval count only;
// it does not control for task difficulty/class. A tier with mixed or missing routing
// signatures is excluded, not merely caveated. Surfaced as an explicit heuristic.
export const ROUTING_CAVEAT =
  'Lowest-token tier (token count, not cost); gated on per-tier eval count only; does not control for task difficulty or task class.';

export type TierExclusionCode = 'missing_signature' | 'mixed_signatures' | 'insufficient_samples';
export type TierRouting = {
  tier: string;
  count: number;
  pass_rate: number;
  mean_tokens_per_eval: number;
  routing_signatures: RoutingSignature[];
  excluded_reason: string | null;
  excluded_reason_code: TierExclusionCode | null;
};
export type RoutingWithholdCode = 'insufficient_eligible_tiers' | 'invalid_records_present';
export type RoutingRecommendation = {
  recommended_tier: string | null;
  best_tier: string | null;
  withheld: boolean;
  reason: string | null;
  reason_code: RoutingWithholdCode | null;
  eligible_tiers: number;
  required_tiers: number;
  min_samples: number;
  heuristic: true;
  caveat: string;
  tiers: TierRouting[];
};

export function recommendRouting(aggregate: Aggregate, minSamples: number): RoutingRecommendation {
  // Build every non-'unknown' tier, marking why any is not a routing candidate.
  // Sorted by name so best/recommended tie-breaks are deterministic.
  const tiers: TierRouting[] = Object.entries(aggregate.byTier)
    .filter(([tier]) => tier !== 'unknown')
    .map(([tier, t]) => {
      const signatures = [...(t.signatures ?? [])].sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
      // Exactly one signature is required. >1 blends models (mixed); 0 means the tier
      // can't be attributed to a model (missing); neither is trusted. Sample-count
      // exclusion is checked last.
      let excluded_reason: string | null = null;
      let excluded_reason_code: TierExclusionCode | null = null;
      if (signatures.length > 1) {
        excluded_reason_code = 'mixed_signatures';
        excluded_reason = `mixed routing signatures: ${signatures.map((s) => `${s.provider}/${s.model}`).join(', ')}`;
      } else if (signatures.length === 0) {
        excluded_reason_code = 'missing_signature';
        excluded_reason = 'missing routing signature';
      } else if (t.count < minSamples) {
        excluded_reason_code = 'insufficient_samples';
        excluded_reason = `only ${t.count} evals (< ${minSamples})`;
      }
      return {
        tier,
        count: t.count,
        pass_rate: (t.pass / t.count) * 100,
        mean_tokens_per_eval: (t.input_tokens + t.output_tokens) / t.count,
        routing_signatures: signatures,
        excluded_reason,
        excluded_reason_code,
      };
    })
    .sort((a, b) => a.tier.localeCompare(b.tier));

  const eligible = tiers.filter((t) => t.excluded_reason === null);
  const REQUIRED_TIERS = 2;
  const base = { min_samples: minSamples, heuristic: true as const, caveat: ROUTING_CAVEAT, tiers, eligible_tiers: eligible.length, required_tiers: REQUIRED_TIERS };
  if (eligible.length < REQUIRED_TIERS) {
    return {
      recommended_tier: null, best_tier: null, withheld: true,
      reason_code: 'insufficient_eligible_tiers',
      reason: `fewer than ${REQUIRED_TIERS} eligible tiers with >= ${minSamples} evaluations (${eligible.length} eligible)`,
      ...base,
    };
  }
  const best = eligible.reduce((m, t) => (t.pass_rate > m.pass_rate ? t : m));
  const candidates = eligible.filter((t) => t.pass_rate >= best.pass_rate - MAX_PASS_RATE_DROP_PCT);
  const recommended = candidates.reduce((m, t) => (t.mean_tokens_per_eval < m.mean_tokens_per_eval ? t : m));
  return { recommended_tier: recommended.tier, best_tier: best.tier, withheld: false, reason: null, reason_code: null, ...base };
}

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
  const { records, invalid } = listEvaluationRecordsDetailed(root);

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

  // Routing advisory: --min-samples (either form) overrides both gates; otherwise
  // routing uses its own higher default. Detect presence with getArgValue (reads both
  // spaced and equals forms) — NOT args.has, which matches only the bare spaced token.
  const routingMinSamples = getArgValue('--min-samples') !== null ? minSamples : MIN_TIER_SAMPLES;
  let routing = recommendRouting(aggregateEvaluations(records), routingMinSamples);
  // Any invalid record makes routing fail closed: a corrupt record can't be attributed
  // to a tier, so it may have changed the pick.
  if (invalid.length > 0) {
    routing = {
      ...routing, withheld: true, recommended_tier: null, best_tier: null,
      reason_code: 'invalid_records_present',
      reason: `${invalid.length} invalid evaluation record${invalid.length === 1 ? '' : 's'} present; routing withheld until resolved`,
    };
  }
  const outRouting = {
    ...routing,
    tiers: routing.tiers.map((t) => ({ ...t, pass_rate: round1(t.pass_rate), mean_tokens_per_eval: round1(t.mean_tokens_per_eval) })),
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
      routing: outRouting,
      invalid_records: invalid,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  console.log('ForgeAI evaluation report');
  console.log('');
  const invalidWarning = () => {
    console.log(formatStatus('warn', `${invalid.length} invalid evaluation record${invalid.length === 1 ? '' : 's'} skipped (${invalid.map((i) => i.file).join(', ')}); routing withheld until resolved`));
  };
  if (records.length === 0) {
    // Only truly empty when there are no valid AND no invalid records; a directory of
    // only corrupt files must still surface them and a withheld routing.
    if (invalid.length === 0) {
      console.log(formatStatus('ok', '.ai/state/evaluations has no evaluation records'));
    } else {
      console.log(formatStatus('skipped', 'no valid evaluation records'));
      invalidWarning();
    }
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
  } else {
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

  // Never let corrupt records vanish silently — warn on the terminal (the JSON carries
  // the full invalid_records list).
  if (invalid.length > 0) {
    console.log('');
    invalidWarning();
  }

  console.log('');
  console.log('Routing');
  if (routing.withheld) {
    console.log(formatStatus('skipped', `routing recommendation withheld — ${routing.reason}`));
  } else {
    const r = routing.tiers.find((t) => t.tier === routing.recommended_tier)!;
    const best = routing.tiers.find((t) => t.tier === routing.best_tier)!;
    console.log(formatStatus('metric', `[advisory · heuristic] route to ${routing.recommended_tier} — ${r.count} eval${r.count === 1 ? '' : 's'}, pass ${round1(r.pass_rate)}%, mean ${Math.round(r.mean_tokens_per_eval)} tokens/eval (lowest-token within ${MAX_PASS_RATE_DROP_PCT} pts of best ${routing.best_tier} ${round1(best.pass_rate)}%; heuristic — token count, not cost; does not control for task difficulty)`));
  }
}
