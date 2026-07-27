import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listEvaluationRecords } from '../bin/lib/evaluation-record.js';

function writeRecord(dir: string, taskId: string, extra: Record<string, unknown>): void {
  const evalDir = path.join(dir, '.ai/state/evaluations');
  fs.mkdirSync(evalDir, { recursive: true });
  const base = {
    kind: 'forgeai_evaluation_record', schema_version: 1, evaluation_id: `eval-${taskId}`, task_id: taskId,
    generated_at: '2026-07-27T00:00:00.000Z', outcome: 'pass',
    outcome_source: { type: 'review_scorecard', scorecard: `.ai/state/reviews/${taskId}.md`, verdict: 'approve' },
    validation: { status: 'pass', evidence_count: 1, results: { pass: 1, fail: 0, skipped: 0 } },
    run_ids: [], context_artifact: null, task_journal: `.ai/state/tasks/${taskId}.md`, tier: 'standard',
    metrics: {
      context: { selected_files: 0, excerpts: 0, omitted_candidates: 0, budget_limit_tokens: 0, budget_estimated_tokens: 0, budget_utilization: 0, expansion_rounds: 0, context_escapes: null },
      calls: { model_calls: 1, input_tokens: 100, output_tokens: 20, cached_tokens: 0, latency_ms: 100, retries: 0 },
    },
  };
  fs.writeFileSync(path.join(evalDir, `${taskId}.json`), JSON.stringify({ ...base, ...extra }, null, 2) + '\n');
}

test('listEvaluationRecords normalizes a legacy record (no mode) to compact/null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-evalmode-'));
  writeRecord(dir, 'TASK-20260727-legacy', {});
  const [rec] = listEvaluationRecords(dir);
  assert.equal(rec.mode, 'compact');
  assert.equal(rec.experiment_id, null);
  assert.equal(rec.comparability, null);
});

test('listEvaluationRecords preserves explicit fields and rejects malformed ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-evalmode-'));
  const comparability = { objective: 'demo', repository_fingerprint: 'fp', selection_signature: '1:5:a.ts', acceptance_signature: 'npm test', routing_signature: 'anthropic/claude-opus-4-8' };
  writeRecord(dir, 'TASK-20260727-base', { mode: 'baseline', experiment_id: 'EXP-20260727-e', comparability });
  writeRecord(dir, 'TASK-20260727-bad', { mode: 'nope' });
  writeRecord(dir, 'TASK-20260727-badexp', { experiment_id: 'EXP-1' });
  const byTask = new Map(listEvaluationRecords(dir).map((r) => [r.task_id, r]));
  assert.equal(byTask.get('TASK-20260727-base')?.mode, 'baseline');
  assert.equal(byTask.get('TASK-20260727-base')?.experiment_id, 'EXP-20260727-e');
  assert.deepEqual(byTask.get('TASK-20260727-base')?.comparability, comparability);
  assert.equal(byTask.has('TASK-20260727-bad'), false);         // invalid mode
  assert.equal(byTask.has('TASK-20260727-badexp'), false);      // malformed experiment_id
});
