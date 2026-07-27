import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listRunRecords } from '../bin/lib/run-record.js';

function writeRun(dir: string, name: string, extra: Record<string, unknown>): void {
  const runsDir = path.join(dir, '.ai/state/runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const base = {
    schema_version: 1, kind: 'forgeai_run_record', run_id: name, timestamp: '2026-07-27T00:00:00.000Z',
    adapter: 'claude', provider: 'anthropic', model: 'claude-opus-4-8', artifact: '.ai/state/context/t.json',
    objective: 'demo', task_id: 'TASK-20260727-x', budget_tokens: 4000, estimated_tokens: 100,
    input_tokens: 10, output_tokens: 5, cached_tokens: 0, latency_ms: 100, http_status: 200,
    outcome: 'ok', retry_count: 0, error: null,
  };
  fs.writeFileSync(path.join(runsDir, `${name}.json`), JSON.stringify({ ...base, ...extra }, null, 2) + '\n');
}

test('listRunRecords normalizes a missing mode to compact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runmode-'));
  writeRun(dir, 'run-legacy', {});
  const records = listRunRecords(dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].mode, 'compact');
});

test('listRunRecords preserves and validates an explicit mode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runmode-'));
  writeRun(dir, 'run-b', { mode: 'baseline' });
  writeRun(dir, 'run-bad', { mode: 'nope' });
  const modes = listRunRecords(dir).map((r) => r.mode).sort();
  // run-bad is rejected as malformed; only run-b remains.
  assert.deepEqual(modes, ['baseline']);
});
