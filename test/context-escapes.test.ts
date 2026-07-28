import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { RejectedRequestSnapshot } from '../bin/lib/types.js';
import {
  artifactDigest, escapeId, recordEscapes, recordObservation, resolveEscapeCount, taskEscapeDir, type NewEscape,
} from '../bin/lib/context-escapes.js';

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-esc-')); }
const TASK = 'TASK-20260727-esc';
const DIGEST = 'a'.repeat(64);
const req: RejectedRequestSnapshot = { kind: 'file', path: 'src/a.ts', reason: 'need a' };
const esc = (over: Partial<NewEscape> = {}): NewEscape => ({
  primary_artifact: '.ai/state/context/T.json', primary_digest: DIGEST, request: req, reason_code: 'path_not_in_graph', detail: 'nope', ...over,
});

test('artifactDigest is 64-hex and escapeId is 16-hex, key-order independent', () => {
  assert.match(artifactDigest('{"a":1}'), /^[0-9a-f]{64}$/);
  const a = escapeId(DIGEST, { kind: 'file', path: 'src/a.ts', reason: 'r' }, 'path_not_in_graph');
  const b = escapeId(DIGEST, { reason: 'r', path: 'src/a.ts', kind: 'file' }, 'path_not_in_graph');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('recordEscapes writes one file per escape and dedupes on re-run', () => {
  const root = tmp();
  recordEscapes(TASK, [esc()], root);
  recordEscapes(TASK, [esc()], root); // same escape_id -> deduped
  const evDir = path.join(taskEscapeDir(root, TASK), 'events');
  const files = fs.readdirSync(evDir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 1);
  const rec = JSON.parse(fs.readFileSync(path.join(evDir, files[0]), 'utf8'));
  assert.equal(rec.kind, 'forgeai_context_escape_event');
  assert.equal(files[0], `${rec.escape_id}.json`);
});

test('recordEscapes / recordObservation refuse an invalid task id or digest', () => {
  const root = tmp();
  assert.throws(() => recordEscapes('../evil', [esc()], root), /invalid task_id/);
  assert.throws(() => recordObservation(TASK, { primary_artifact: 'x', primary_digest: 'short' }, root), /primary_digest/);
});

test('resolveEscapeCount: null unobserved, 0 observed-empty, N observed-with-events', () => {
  const root = tmp();
  // no dir at all
  assert.deepEqual(resolveEscapeCount(TASK, DIGEST, root), { ok: true, count: null });
  // observed, no events -> 0
  recordObservation(TASK, { primary_artifact: '.ai/state/context/T.json', primary_digest: DIGEST }, root);
  assert.deepEqual(resolveEscapeCount(TASK, DIGEST, root), { ok: true, count: 0 });
  // observed, two escapes for this digest, one for another digest
  recordEscapes(TASK, [
    esc({ request: { kind: 'file', path: 'src/a.ts', reason: 'r' } }),
    esc({ request: { kind: 'file', path: 'src/b.ts', reason: 'r' } }),
    esc({ primary_digest: 'b'.repeat(64), request: { kind: 'file', path: 'src/c.ts', reason: 'r' } }),
  ], root);
  assert.deepEqual(resolveEscapeCount(TASK, DIGEST, root), { ok: true, count: 2 });
  // a different, unobserved digest -> null even though its events exist
  assert.deepEqual(resolveEscapeCount(TASK, 'b'.repeat(64), root), { ok: true, count: null });
});

test('resolveEscapeCount fails on a malformed marker or event file', () => {
  const root = tmp();
  recordObservation(TASK, { primary_artifact: '.ai/state/context/T.json', primary_digest: DIGEST }, root);
  const evDir = path.join(taskEscapeDir(root, TASK), 'events');
  fs.mkdirSync(evDir, { recursive: true });
  fs.writeFileSync(path.join(evDir, 'deadbeefdeadbeef.json'), '{ broken');
  const r = resolveEscapeCount(TASK, DIGEST, root);
  assert.equal(r.ok, false);
});

test('escapes for malformed requests (missing_reason / missing_name / unknown_kind) are valid, not malformed', () => {
  const root = tmp();
  recordObservation(TASK, { primary_artifact: '.ai/state/context/T.json', primary_digest: DIGEST }, root);
  recordEscapes(TASK, [
    // request intentionally lacks `reason` — this is exactly what missing_reason records
    esc({ request: { kind: 'file', path: 'src/a.ts' }, reason_code: 'missing_reason' }),
    esc({ request: { kind: 'symbol', reason: 'r' }, reason_code: 'missing_name' }),
    esc({ request: { kind: 'weird', reason: 'r' }, reason_code: 'unknown_kind' }),
  ], root);
  const r = resolveEscapeCount(TASK, DIGEST, root);
  assert.deepEqual(r, { ok: true, count: 3 }); // all three round-trip as valid events
});

test('resolveEscapeCount fails structurally when observed/events is a file, not a directory', () => {
  const root = tmp();
  const dir = taskEscapeDir(root, TASK);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'observed'), 'not a directory');
  const r = resolveEscapeCount(TASK, DIGEST, root);
  assert.equal(r.ok, false);
});

test('resolveEscapeCount fails when the task path itself is a file', () => {
  const root = tmp();
  const dir = taskEscapeDir(root, TASK);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.writeFileSync(dir, 'not a directory');
  assert.equal(resolveEscapeCount(TASK, DIGEST, root).ok, false);
});

test('recordEscapes throws on a non-object request and writes no event', () => {
  const root = tmp();
  assert.throws(
    () => recordEscapes(TASK, [esc({ request: [] as unknown as RejectedRequestSnapshot })], root),
    /non-object request/,
  );
  const evDir = path.join(taskEscapeDir(root, TASK), 'events');
  assert.equal(fs.existsSync(evDir) ? fs.readdirSync(evDir).length : 0, 0, 'no poison event written');
});
