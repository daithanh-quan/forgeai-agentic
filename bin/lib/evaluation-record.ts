import fs from 'node:fs';
import path from 'node:path';
import type { CompiledContextArtifact, EvaluationRecord, RunRecord } from './types.js';
import { formatStatus, isValidTaskId, isValidExperimentId } from './utils.js';
import { root, getArgValue } from './context.js';
import { listRunRecords } from './run-record.js';
import { listTaskJournalFiles, parseTaskJournal, extractBulletValue } from './lifecycle.js';
import { extractTableRows, extractLabeledValue, isRealEvidenceRow, validRecommendations } from './review.js';
import { checkArtifactStructure } from './router.js';

const EVAL_DIR = '.ai/state/evaluations';

export function evaluationDir(repositoryRoot: string): string {
  return path.join(repositoryRoot, EVAL_DIR);
}

export function writeEvaluationRecord(record: EvaluationRecord, repositoryRoot: string): void {
  // Guard against path traversal: task_id is interpolated into the filename.
  if (!isValidTaskId(record.task_id)) {
    throw new Error(`refusing to write evaluation record with invalid task_id: ${record.task_id}`);
  }
  const dir = evaluationDir(repositoryRoot);
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, `${record.task_id}.json`);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(tmpPath, finalPath);
}

function isNonNegativeNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}
function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

const VERDICT_TO_OUTCOME: Record<string, EvaluationRecord['outcome']> = {
  approve: 'pass',
  'request changes': 'fail',
  'needs human decision': 'partial',
};
const VALID_RATINGS = new Set(['pass', 'concern', 'fail']);

// The single source of truth for validation.status: derive it from the result
// counts so both the writer (buildEvaluationRecord) and the read-path validator
// agree on what a given (pass, fail, skipped) tally must report.
function deriveValidationStatus(results: { pass: number; fail: number }): EvaluationRecord['validation']['status'] {
  return results.fail > 0 ? 'fail' : results.pass > 0 ? 'pass' : 'partial';
}

function isValidEvaluationRecord(raw: unknown): raw is EvaluationRecord {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (r['kind'] !== 'forgeai_evaluation_record' || r['schema_version'] !== 1) return false;
  if (typeof r['task_id'] !== 'string' || !isValidTaskId(r['task_id'])) return false;
  // evaluation_id is deterministic and must match its task_id.
  if (r['evaluation_id'] !== `eval-${r['task_id']}`) return false;
  // generated_at must be a canonical round-trippable ISO timestamp.
  if (typeof r['generated_at'] !== 'string' || new Date(r['generated_at']).toISOString() !== r['generated_at']) return false;
  if (!['pass', 'fail', 'partial'].includes(r['outcome'] as string)) return false;
  if (typeof r['tier'] !== 'string') return false;
  if (!Array.isArray(r['run_ids']) || !r['run_ids'].every((id) => typeof id === 'string')) return false;
  if (r['context_artifact'] !== null && typeof r['context_artifact'] !== 'string') return false;
  if (typeof r['task_journal'] !== 'string') return false;

  const src = r['outcome_source'] as Record<string, unknown> | undefined;
  if (!src || src['type'] !== 'review_scorecard' || typeof src['scorecard'] !== 'string' || typeof src['verdict'] !== 'string') return false;
  // verdict must be a known recommendation whose mapping matches outcome — this
  // rejects records where e.g. verdict "request changes" claims outcome "pass".
  if (VERDICT_TO_OUTCOME[src['verdict'] as string] !== r['outcome']) return false;

  const val = r['validation'] as Record<string, unknown> | undefined;
  if (!val || !['pass', 'fail', 'partial'].includes(val['status'] as string) || !isNonNegativeInt(val['evidence_count'])) return false;
  const vr = val['results'] as Record<string, unknown> | undefined;
  if (!vr || !isNonNegativeInt(vr['pass']) || !isNonNegativeInt(vr['fail']) || !isNonNegativeInt(vr['skipped'])) return false;
  // evidence_count must equal the sum of its parts.
  if ((val['evidence_count'] as number) !== (vr['pass'] as number) + (vr['fail'] as number) + (vr['skipped'] as number)) return false;
  // status must be the value the counts imply — rejects e.g. status "pass" with fail > 0.
  if (val['status'] !== deriveValidationStatus(vr as { pass: number; fail: number })) return false;

  const metrics = r['metrics'] as Record<string, unknown> | undefined;
  if (!metrics) return false;
  const ctx = metrics['context'] as Record<string, unknown> | undefined;
  if (!ctx) return false;
  // budget_utilization is a real ratio; the rest are non-negative integers.
  if (!isNonNegativeNumber(ctx['budget_utilization'])) return false;
  for (const f of ['selected_files', 'excerpts', 'omitted_candidates', 'budget_limit_tokens', 'budget_estimated_tokens', 'expansion_rounds']) {
    if (!isNonNegativeInt(ctx[f])) return false;
  }
  if (ctx['context_escapes'] !== null && !isNonNegativeInt(ctx['context_escapes'])) return false;
  const calls = metrics['calls'] as Record<string, unknown> | undefined;
  if (!calls) return false;
  // latency_ms is a non-negative real (RunRecord.latency_ms permits decimals);
  // the rest are non-negative integers.
  if (!isNonNegativeNumber(calls['latency_ms'])) return false;
  for (const f of ['model_calls', 'input_tokens', 'output_tokens', 'cached_tokens', 'retries']) {
    if (!isNonNegativeInt(calls[f])) return false;
  }
  const md = r['mode'];
  if (md !== undefined && md !== 'baseline' && md !== 'compact') return false;
  const exp = r['experiment_id'];
  if (exp !== undefined && exp !== null && (typeof exp !== 'string' || !isValidExperimentId(exp))) return false;
  const comp = r['comparability'];
  if (comp !== undefined && comp !== null) {
    if (typeof comp !== 'object') return false;
    const c = comp as Record<string, unknown>;
    if (typeof c['objective'] !== 'string' || typeof c['repository_fingerprint'] !== 'string'
      || typeof c['selection_signature'] !== 'string' || typeof c['acceptance_signature'] !== 'string'
      || typeof c['routing_signature'] !== 'string') return false;
  }
  return true;
}

export function readEvaluationRecord(taskId: string, repositoryRoot: string): EvaluationRecord | null {
  if (!isValidTaskId(taskId)) return null; // guard traversal before building a path
  const filePath = path.join(evaluationDir(repositoryRoot), `${taskId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isValidEvaluationRecord(raw)
      ? { ...raw, mode: raw.mode ?? 'compact', experiment_id: raw.experiment_id ?? null, comparability: raw.comparability ?? null }
      : null;
  } catch {
    return null;
  }
}

export function listEvaluationRecords(repositoryRoot: string): EvaluationRecord[] {
  const dir = evaluationDir(repositoryRoot);
  if (!fs.existsSync(dir)) return [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    process.stderr.write(`${formatStatus('warn', `cannot read evaluations directory (${dir}): ${String(err)}`)}\n`);
    return [];
  }
  const records: EvaluationRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.tmp')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      // Filename must equal `${task_id}.json` — records are keyed by task id, so a
      // mismatch means a stray/renamed file that would duplicate or misattribute.
      if (isValidEvaluationRecord(raw) && name === `${raw.task_id}.json`) {
        records.push({ ...raw, mode: raw.mode ?? 'compact', experiment_id: raw.experiment_id ?? null, comparability: raw.comparability ?? null });
      }
    } catch {
      // skip malformed
    }
  }
  return records.sort((a, b) => b.generated_at.localeCompare(a.generated_at));
}

// ─── tier resolution and metrics ──────────────────────────────────────────────

export function readRoutingTiers(repositoryRoot: string): Record<string, { provider: string; model: string }> {
  const filePath = path.join(repositoryRoot, '.ai/model-routing.yaml');
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const tiersIndex = lines.findIndex((line) => /^tiers:\s*$/.test(line));
  if (tiersIndex === -1) return {};
  const tiers: Record<string, { provider: string; model: string }> = {};
  let current: string | null = null;
  for (let i = tiersIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // left the tiers: block (column-0 key)
    const header = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (header) { current = header[1]; tiers[current] = { provider: '', model: '' }; continue; }
    if (!current) continue;
    const prov = line.match(/^    provider:\s*(.+?)\s*$/);
    if (prov) tiers[current].provider = prov[1].replace(/^["']|["']$/g, '');
    const model = line.match(/^    model:\s*(.+?)\s*$/);
    if (model) tiers[current].model = model[1].replace(/^["']|["']$/g, '');
  }
  return tiers;
}

export function resolveTier(provider: string, model: string, tiers: Record<string, { provider: string; model: string }>): string {
  for (const [name, entry] of Object.entries(tiers)) {
    if (entry.provider === provider && entry.model === model) return name;
  }
  return 'unknown';
}

export function resolveTierForRuns(runs: RunRecord[], tiers: Record<string, { provider: string; model: string }>): string {
  const resolved = new Set(runs.map((r) => resolveTier(r.provider, r.model, tiers)).filter((t) => t !== 'unknown'));
  return resolved.size === 1 ? [...resolved][0] : 'unknown';
}

export function computeMetrics(artifact: CompiledContextArtifact | null, runs: RunRecord[], expansionCount: number): EvaluationRecord['metrics'] {
  const limit = artifact ? artifact.budget.limit_tokens : 0;
  const estimated = artifact ? artifact.budget.estimated_tokens : 0;
  const sum = (pick: (r: RunRecord) => number | null) => runs.reduce((total, r) => total + (pick(r) ?? 0), 0);
  return {
    context: {
      selected_files: artifact ? artifact.selection.files.length : 0,
      excerpts: artifact ? artifact.excerpts.length : 0,
      omitted_candidates: artifact ? artifact.omitted_candidates : 0,
      budget_limit_tokens: limit,
      budget_estimated_tokens: estimated,
      budget_utilization: limit > 0 ? Math.round((estimated / limit) * 1000) / 1000 : 0,
      // Count of expansion artifacts recorded for this task (see runEvaluate).
      expansion_rounds: expansionCount,
      // null = not measured in 13A: rejected need_context requests are only
      // warned to stderr, never persisted. 0 would falsely assert "no escapes".
      context_escapes: null,
    },
    calls: {
      model_calls: runs.length,
      input_tokens: sum((r) => r.input_tokens),
      output_tokens: sum((r) => r.output_tokens),
      cached_tokens: sum((r) => r.cached_tokens),
      latency_ms: sum((r) => r.latency_ms),
      retries: sum((r) => r.retry_count),
    },
  };
}

// ─── consistency gate + outcome derivation ────────────────────────────────────

type BuildInput = {
  taskId: string;
  journalContent: string;
  journalPath: string;
  scorecardContent: string;
  scorecardPath: string;
  runs: RunRecord[];
  artifact: CompiledContextArtifact | null;
  artifactPath: string | null;
  expansionCount: number;
  tiers: Record<string, { provider: string; model: string }>;
  now: string;
};
type BuildResult = { ok: true; record: EvaluationRecord } | { ok: false; errors: string[] };

export function buildEvaluationRecord(input: BuildInput): BuildResult {
  const errors: string[] = [];
  const { taskId, journalContent, scorecardContent, scorecardPath } = input;

  // Scorecard Task ID bullet must match the requested task id.
  const scorecardTaskId = extractBulletValue(scorecardContent, 'Task ID');
  if (scorecardTaskId !== taskId) {
    errors.push(`scorecard Task ID "${scorecardTaskId}" does not match --task ${taskId}`);
  }

  if (/\bTODO\b/i.test(scorecardContent)) {
    errors.push('scorecard still contains a TODO/placeholder');
  }

  const verdict = extractLabeledValue(scorecardContent, 'Verdict').toLowerCase();
  if (!validRecommendations.includes(verdict)) {
    errors.push(`Verdict must be Approve, Request changes, or Needs human decision (got: ${verdict || 'missing'})`);
  }

  // Require at least one dimension row, and every rating must be pass|concern|fail.
  const dimensionRows = extractTableRows(scorecardContent, 'Scorecard');
  if (dimensionRows.length === 0) {
    errors.push('scorecard has no dimension rows');
  }
  let anyDimensionFail = false;
  for (const cells of dimensionRows) {
    // A dimension row must name a real dimension; a blank/placeholder name is a
    // malformed row that would otherwise slip past the gate on its rating alone.
    const dimension = (cells[0] ?? '').trim();
    if (dimension === '' || dimension === '...') {
      errors.push('scorecard has a dimension row with a blank name');
    }
    const rating = (cells[1] ?? '').toLowerCase();
    if (!VALID_RATINGS.has(rating)) {
      errors.push(`scorecard rating "${cells[1] ?? ''}" is not pass|concern|fail`);
    }
    if (rating === 'fail') anyDimensionFail = true;
  }

  // Validation evidence comes from the journal's Commands And Validation table.
  const evidenceRows = extractTableRows(journalContent, 'Commands And Validation').filter(isRealEvidenceRow);
  if (evidenceRows.length === 0) {
    errors.push('no real validation evidence in the journal Commands And Validation table');
  }
  const results = { pass: 0, fail: 0, skipped: 0 };
  for (const cells of evidenceRows) {
    const r = (cells[2] ?? '').toLowerCase();
    if (r === 'pass' || r === 'fail' || r === 'skipped') results[r] += 1;
  }

  // Approve must not be contradicted by fail evidence, a fail dimension rating,
  // or unresolved blockers.
  if (verdict === 'approve') {
    if (results.fail > 0) errors.push('verdict Approve contradicted by a fail validation row');
    if (anyDimensionFail) errors.push('verdict Approve contradicted by a fail scorecard dimension');
    const blockers = extractLabeledValue(scorecardContent, 'Unresolved blockers').toLowerCase();
    if (blockers !== '' && blockers !== 'none') errors.push(`verdict Approve but unresolved blockers: ${blockers}`);
  }

  if (errors.length > 0) return { ok: false, errors };

  const validationStatus = deriveValidationStatus(results);

  const record: EvaluationRecord = {
    kind: 'forgeai_evaluation_record',
    schema_version: 1,
    evaluation_id: `eval-${taskId}`,
    task_id: taskId,
    generated_at: input.now,
    outcome: VERDICT_TO_OUTCOME[verdict],
    outcome_source: { type: 'review_scorecard', scorecard: scorecardPath, verdict },
    validation: { status: validationStatus, evidence_count: evidenceRows.length, results },
    run_ids: input.runs.map((r) => r.run_id),
    context_artifact: input.artifactPath,
    task_journal: input.journalPath,
    mode: input.artifact?.mode ?? 'compact',
    experiment_id: input.artifact?.experiment_id ?? null,
    comparability: input.artifact
      ? {
          objective: input.artifact.objective,
          repository_fingerprint: input.artifact.repository.fingerprint,
          selection_signature: `${input.artifact.selection.max_depth}:${input.artifact.selection.max_nodes}:${input.artifact.selection.files.map((f) => f.path).sort().join(',')}`,
          // Commands And Validation columns are | Date | Command | Result |, so the command is
          // cells[1] (matching review.ts isRealEvidenceRow's [date, command, result]). Date
          // (cells[0]) and Result (cells[2]) are intentionally excluded.
          acceptance_signature: [...new Set(evidenceRows.map((cells) => (cells[1] ?? '').trim()))].sort().join('\n'),
          // provider/model set of the matched runs — proves both modes used the same model(s).
          routing_signature: [...new Set(input.runs.map((r) => `${r.provider}/${r.model}`))].sort().join(','),
        }
      : null,
    tier: resolveTierForRuns(input.runs, input.tiers),
    metrics: computeMetrics(input.artifact, input.runs, input.expansionCount),
  };
  return { ok: true, record };
}

// ─── --evaluate command ───────────────────────────────────────────────────────

type ArtifactLookup = { primary: { rel: string; artifact: CompiledContextArtifact } | null; expansionCount: number; multiplePrimary: boolean };

function findArtifactsForTask(taskId: string, repositoryRoot: string): ArtifactLookup {
  const dir = path.join(repositoryRoot, '.ai/state/context');
  const lookup: ArtifactLookup = { primary: null, expansionCount: 0, multiplePrimary: false };
  if (!fs.existsSync(dir)) return lookup;
  const primaries: Array<{ rel: string; artifact: CompiledContextArtifact }> = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { continue; }
    // Full structural validation (schema_version, task_id/artifact_role shape,
    // selection/excerpts/budget, etc.) WITHOUT fingerprint/graph freshness, so an
    // artifact compiled against an earlier revision is still evaluable. Malformed
    // artifacts are skipped, never crashing computeMetrics.
    if (checkArtifactStructure(raw) !== null) continue;
    // Normalize the additive fields so a pre-3.10.0 artifact reads as a
    // non-experiment (mode: compact, experiment_id: null) rather than leaving
    // experiment_id undefined — otherwise the provenance gate (which tests
    // `experiment_id !== null`) would wrongly fire on legacy artifacts.
    const rawRecord = raw as Record<string, unknown>;
    const artifact: CompiledContextArtifact = {
      ...(raw as CompiledContextArtifact),
      task_id: (rawRecord['task_id'] as string | null | undefined) ?? null,
      artifact_role: (rawRecord['artifact_role'] as CompiledContextArtifact['artifact_role'] | undefined) ?? 'primary',
      mode: (rawRecord['mode'] as CompiledContextArtifact['mode'] | undefined) ?? 'compact',
      experiment_id: (rawRecord['experiment_id'] as string | null | undefined) ?? null,
    };
    if (artifact.task_id !== taskId) continue;
    if (artifact.artifact_role === 'expansion') { lookup.expansionCount += 1; continue; }
    primaries.push({ rel: `.ai/state/context/${name}`, artifact });
  }
  if (primaries.length > 1) lookup.multiplePrimary = true;
  else lookup.primary = primaries[0] ?? null;
  return lookup;
}

export function runEvaluate(): void {
  const taskId = getArgValue('--task');
  if (!taskId) {
    process.stderr.write('Usage: forgeai-init --evaluate --task <TASK-YYYYMMDD-slug>\n');
    process.exitCode = 1;
    return;
  }
  if (!isValidTaskId(taskId)) {
    process.stderr.write(`Error: "${taskId}" is not a valid task id (TASK-YYYYMMDD-slug).\n`);
    process.exitCode = 1;
    return;
  }

  const journalFiles = listTaskJournalFiles().filter((file) => parseTaskJournal(file).taskId === taskId);
  if (journalFiles.length === 0) {
    process.stderr.write(formatStatus('invalid', `no task journal found for ${taskId}`) + '\n');
    process.exitCode = 1;
    return;
  }
  if (journalFiles.length > 1) {
    process.stderr.write(formatStatus('invalid', `multiple task journals match ${taskId}`) + '\n');
    process.exitCode = 1;
    return;
  }
  const journalContent = fs.readFileSync(path.join(root, journalFiles[0]), 'utf8');

  const scorecardRel = `.ai/state/reviews/${taskId}.md`;
  const scorecardAbs = path.join(root, scorecardRel);
  if (!fs.existsSync(scorecardAbs)) {
    process.stderr.write(formatStatus('missing', `${scorecardRel} scorecard for ${taskId}`) + '\n');
    process.exitCode = 1;
    return;
  }
  const scorecardContent = fs.readFileSync(scorecardAbs, 'utf8');

  const lookup = findArtifactsForTask(taskId, root);
  if (lookup.multiplePrimary) {
    process.stderr.write(formatStatus('invalid', `multiple primary context artifacts match ${taskId}`) + '\n');
    process.exitCode = 1;
    return;
  }
  const artifact = lookup.primary?.artifact ?? null;
  const artifactPath = lookup.primary?.rel ?? null;

  const runs = listRunRecords(root).filter((r) => r.task_id === taskId);
  const tiers = readRoutingTiers(root);

  // Experiment provenance gate: applies only when the primary artifact is part of
  // an experiment. An experiment record must be backed by runs that actually came
  // from this mode's artifact — otherwise the comparison would be meaningless.
  if (artifact && artifact.experiment_id !== null) {
    const provErrors: string[] = [];
    if (runs.length === 0) {
      provErrors.push(`experiment task ${taskId} has no run records to compare`);
    }
    for (const r of runs) {
      if (r.mode !== artifact.mode) {
        provErrors.push(`run ${r.run_id} mode '${r.mode}' does not match artifact mode '${artifact.mode}'`);
      }
      if (artifactPath === null || path.resolve(root, r.artifact) !== path.resolve(root, artifactPath)) {
        provErrors.push(`run ${r.run_id} did not route the primary artifact`);
      }
    }
    if (provErrors.length > 0) {
      console.log('ForgeAI evaluation');
      console.log('');
      for (const err of provErrors) console.log(formatStatus('invalid', err));
      console.log('');
      console.log('Result: evaluation failed. No record written.');
      process.exitCode = 1;
      return;
    }
  }

  const result = buildEvaluationRecord({
    taskId, journalContent, journalPath: journalFiles[0], scorecardContent, scorecardPath: scorecardRel,
    runs, artifact, artifactPath, expansionCount: lookup.expansionCount, tiers, now: new Date().toISOString(),
  });

  if (!result.ok) {
    console.log('ForgeAI evaluation');
    console.log('');
    for (const err of result.errors) console.log(formatStatus('invalid', err));
    console.log('');
    console.log('Result: evaluation failed. No record written.');
    process.exitCode = 1;
    return;
  }

  writeEvaluationRecord(result.record, root);
  console.log('ForgeAI evaluation');
  console.log('');
  console.log(formatStatus('ok', `${taskId} → ${result.record.outcome} (verdict: ${result.record.outcome_source.verdict}, ${runs.length} run${runs.length === 1 ? '' : 's'})`));
  console.log(formatStatus('ok', `written to .ai/state/evaluations/${taskId}.json`));
}
