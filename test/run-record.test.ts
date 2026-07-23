import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateRunId, writeRunRecord, listRunRecords } from '../bin/lib/run-record.js';
import type { RunRecord } from '../bin/lib/types.js';

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    schema_version: 1,
    kind: 'forgeai_run_record',
    run_id: 'run-test',
    timestamp: '2026-07-22T00:00:00.000Z',
    adapter: 'anthropic',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    artifact: '.ai/state/context/TASK-01.json',
    objective: 'test objective',
    budget_tokens: 6000,
    estimated_tokens: 4000,
    input_tokens: 4100,
    output_tokens: 800,
    cached_tokens: 1200,
    latency_ms: 5000,
    http_status: 200,
    outcome: 'ok',
    retry_count: 0,
    error: null,
    ...overrides,
  };
}

test('listRunRecords: 3.7.0 record without retry_count normalizes to 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-run-'));
  const dir = path.join(tmp, '.ai/state/runs');
  fs.mkdirSync(dir, { recursive: true });
  const legacy = makeRecord({ run_id: 'run-legacy' }) as Record<string, unknown>;
  delete legacy.retry_count;
  fs.writeFileSync(path.join(dir, 'run-legacy.json'), JSON.stringify(legacy));
  const records = listRunRecords(tmp);
  assert.equal(records.length, 1);
  assert.equal(records[0].retry_count, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('listRunRecords: rejects negative or decimal retry_count', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-run-'));
  const dir = path.join(tmp, '.ai/state/runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'neg.json'), JSON.stringify({ ...makeRecord({ run_id: 'neg' }), retry_count: -1 }));
  fs.writeFileSync(path.join(dir, 'dec.json'), JSON.stringify({ ...makeRecord({ run_id: 'dec' }), retry_count: 1.5 }));
  assert.equal(listRunRecords(tmp).length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('generateRunId starts with "run-"', () => {
  const id = generateRunId();
  assert.ok(id.startsWith('run-'), `expected run- prefix, got ${id}`);
  assert.ok(id.length > 10);
});

test('generateRunId is unique on successive calls', () => {
  const ids = new Set(Array.from({ length: 10 }, () => generateRunId()));
  assert.ok(ids.size > 1);
});

test('writeRunRecord creates the file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  try {
    const record = makeRecord({ run_id: 'run-write-test' });
    writeRunRecord(record, tmp);
    const filePath = path.join(tmp, '.ai', 'state', 'runs', 'run-write-test.json');
    assert.ok(fs.existsSync(filePath));
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RunRecord;
    assert.equal(parsed.run_id, 'run-write-test');
    assert.equal(parsed.kind, 'forgeai_run_record');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('writeRunRecord emits warning to stderr on write failure but does not throw', () => {
  const stderrChunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderrChunks.push(String(chunk));
    return true;
  };
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-fail-'));
    const blocker = path.join(tmp, '.ai');
    fs.writeFileSync(blocker, 'not-a-dir'); // makes mkdir fail
    assert.doesNotThrow(() => writeRunRecord(makeRecord(), tmp));
    assert.ok(stderrChunks.some((c) => c.includes('run record')));
  } finally {
    process.stderr.write = orig;
  }
});

test('listRunRecords returns empty array when directory is absent', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  try {
    assert.deepEqual(listRunRecords(tmp), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('listRunRecords returns records sorted newest-first', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  try {
    writeRunRecord(makeRecord({ run_id: 'run-aaa', timestamp: '2026-07-22T01:00:00.000Z' }), tmp);
    writeRunRecord(makeRecord({ run_id: 'run-bbb', timestamp: '2026-07-22T02:00:00.000Z' }), tmp);
    const records = listRunRecords(tmp);
    assert.equal(records.length, 2);
    assert.equal(records[0]!.run_id, 'run-bbb');
    assert.equal(records[1]!.run_id, 'run-aaa');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('listRunRecords skips non-JSON files and malformed JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  try {
    const runsDir = path.join(tmp, '.ai', 'state', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, 'README.md'), '# ignore');
    fs.writeFileSync(path.join(runsDir, 'broken.json'), 'not-json{');
    fs.writeFileSync(path.join(runsDir, 'wrong-kind.json'), JSON.stringify({ kind: 'other' }));
    writeRunRecord(makeRecord({ run_id: 'run-only-valid' }), tmp);
    const records = listRunRecords(tmp);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.run_id, 'run-only-valid');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('listRunRecords skips records with invalid budget_tokens, estimated_tokens, error, or timestamp', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  try {
    const runsDir = path.join(tmp, '.ai', 'state', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    // negative budget_tokens
    fs.writeFileSync(path.join(runsDir, 'bad-budget.json'), JSON.stringify({ ...JSON.parse(JSON.stringify(makeRecord({ run_id: 'bad-budget' }))), budget_tokens: -1 }));
    // negative estimated_tokens
    fs.writeFileSync(path.join(runsDir, 'bad-est.json'), JSON.stringify({ ...JSON.parse(JSON.stringify(makeRecord({ run_id: 'bad-est' }))), estimated_tokens: -1 }));
    // non-string error field
    fs.writeFileSync(path.join(runsDir, 'bad-error.json'), JSON.stringify({ ...JSON.parse(JSON.stringify(makeRecord({ run_id: 'bad-error' }))), error: 42 }));
    // non-ISO timestamp
    fs.writeFileSync(path.join(runsDir, 'bad-ts.json'), JSON.stringify({ ...JSON.parse(JSON.stringify(makeRecord({ run_id: 'bad-ts' }))), timestamp: 'not-a-date' }));
    writeRunRecord(makeRecord({ run_id: 'run-valid-budget' }), tmp);
    const records = listRunRecords(tmp);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.run_id, 'run-valid-budget');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('listRunRecords emits warning and returns [] when runs path is a file (ENOTDIR)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-enotdir-'));
  const stderrChunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderrChunks.push(String(chunk));
    return true;
  };
  try {
    const runsDir = path.join(tmp, '.ai', 'state', 'runs');
    fs.mkdirSync(path.join(tmp, '.ai', 'state'), { recursive: true });
    fs.writeFileSync(runsDir, 'not-a-directory'); // ENOTDIR trigger
    const records = listRunRecords(tmp);
    assert.deepEqual(records, []);
    assert.ok(stderrChunks.some((c) => c.includes('cannot read runs')));
  } finally {
    process.stderr.write = orig;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('listRunRecords skips records with correct kind but missing required string fields', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-runs-'));
  try {
    const runsDir = path.join(tmp, '.ai', 'state', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    // Has correct kind but no timestamp — sort would crash without isValidRunRecord guard
    fs.writeFileSync(path.join(runsDir, 'no-timestamp.json'), JSON.stringify({ kind: 'forgeai_run_record', run_id: 'x', provider: 'anthropic', model: 'm', outcome: 'ok' }));
    // Has kind + timestamp but no run_id
    fs.writeFileSync(path.join(runsDir, 'no-runid.json'), JSON.stringify({ kind: 'forgeai_run_record', timestamp: '2026-07-22T00:00:00.000Z', provider: 'anthropic', model: 'm', outcome: 'ok' }));
    writeRunRecord(makeRecord({ run_id: 'run-valid-only' }), tmp);
    const records = listRunRecords(tmp);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.run_id, 'run-valid-only');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
