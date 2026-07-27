import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, runTs, type ExecError } from './helpers.js';

const CMP = { objective: 'demo', repository_fingerprint: 'fp', selection_signature: '1:5:a.ts', acceptance_signature: 'npm test', routing_signature: 'anthropic/claude-opus-4-8' };

function writeRec(dir: string, task: string, mode: 'baseline' | 'compact', exp: string | null, outcome: string, input: number): void {
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  const record = {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: `eval-${task}`, task_id: task,
    generated_at: '2026-07-27T00:00:00.000Z', outcome, mode, experiment_id: exp, comparability: exp === null ? null : CMP,
    outcome_source: { type: 'review_scorecard', scorecard: `.ai/state/reviews/${task}.md`, verdict: outcome === 'pass' ? 'approve' : 'request changes' },
    validation: { status: 'pass', evidence_count: 1, results: { pass: 1, fail: 0, skipped: 0 } },
    run_ids: [], context_artifact: '.ai/state/context/x.json', task_journal: `.ai/state/tasks/${task}.md`, tier: 'standard',
    metrics: {
      context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: input, output_tokens: 10, cached_tokens: 0, latency_ms: 100, retries: 0 },
    },
  };
  fs.writeFileSync(path.join(evalDir, `${task}.json`), JSON.stringify(record, null, 2) + '\n');
}

function seedOnePair(dir: string, i: number): void {
  const exp = `EXP-20260727-p${i}`;
  writeRec(dir, `TASK-20260727-b${i}`, 'baseline', exp, 'pass', 1000);
  writeRec(dir, `TASK-20260727-c${i}`, 'compact', exp, 'pass', 400);
}

function report(dir: string, args: string[]): string {
  try {
    return runTs(cli, ['--report', ...args], { cwd: dir });
  } catch (e) {
    const err = e as ExecError;
    return `${String(err.stdout ?? '')}${String(err.stderr ?? '')}`;
  }
}

test('--report withholds the advisory below the sample threshold', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-exp-'));
  seedOnePair(dir, 0);
  const out = report(dir, []);
  assert.match(out, /Experiments/);
  assert.match(out, /insufficient samples \(1\/5\)/);
});

test('--report --json withholds with a null verdict below the threshold', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-exp-'));
  seedOnePair(dir, 0);
  const json = JSON.parse(report(dir, ['--json']));
  assert.equal(json.recommendation.withheld, true);
  assert.equal(json.recommendation.verdict, null);
});

test('--report --min-samples 1 emits the prefer-compact advisory with the pair count', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-exp-'));
  seedOnePair(dir, 0);
  const out = report(dir, ['--min-samples', '1']);
  assert.match(out, /\[advisory\]/);
  assert.match(out, /prefer compact/i);
  assert.match(out, /1 comparable pair\b/);
});

test('--report --json includes experiments and recommendation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-exp-'));
  seedOnePair(dir, 0);
  const json = JSON.parse(report(dir, ['--json', '--min-samples', '1']));
  assert.equal(json.experiments.aggregate.pairs, 1);
  assert.equal(json.recommendation.verdict, 'prefer_compact');
  assert.equal(json.recommendation.withheld, false);
});

test('--report --min-samples rejects a non-positive value', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-exp-'));
  seedOnePair(dir, 0);
  const out = report(dir, ['--min-samples', '0']);
  assert.match(out, /--min-samples must be a positive integer/);
});
