import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  ContextEscapeEvent, ContextEscapeObservation, EscapeReasonCode, RejectedRequestSnapshot,
} from './types.js';
import { isValidTaskId } from './utils.js';

const ESCAPE_DIR = '.ai/state/context-escapes';
const DIGEST_RE = /^[0-9a-f]{64}$/;
const ESCAPE_ID_RE = /^[0-9a-f]{16}$/;
const REASON_CODES: ReadonlySet<EscapeReasonCode> = new Set<EscapeReasonCode>([
  'missing_reason', 'missing_path', 'missing_name', 'ignored_path', 'path_not_in_graph',
  'symbol_not_found', 'unknown_kind', 'budget_exceeded', 'no_new_context',
]);

export function taskEscapeDir(root: string, taskId: string): string {
  return path.join(root, ESCAPE_DIR, taskId);
}

export function artifactDigest(rawContent: string): string {
  return crypto.createHash('sha256').update(rawContent).digest('hex');
}

// Canonicalize so equal requests hash equally regardless of key order.
function canonicalRequest(request: RejectedRequestSnapshot): string {
  const obj: Record<string, unknown> = {};
  for (const k of Object.keys(request).sort()) obj[k] = request[k];
  return JSON.stringify(obj);
}

export function escapeId(primaryDigest: string, request: RejectedRequestSnapshot, reasonCode: EscapeReasonCode): string {
  const material = `${primaryDigest}\n${canonicalRequest(request)}\n${reasonCode}`;
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 16);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

export function recordObservation(taskId: string, obs: { primary_artifact: string; primary_digest: string }, root: string): void {
  if (!isValidTaskId(taskId)) throw new Error(`refusing to record observation with invalid task_id: ${taskId}`);
  if (!DIGEST_RE.test(obs.primary_digest)) throw new Error(`refusing to record observation with invalid primary_digest: ${obs.primary_digest}`);
  const filePath = path.join(taskEscapeDir(root, taskId), 'observed', `${obs.primary_digest}.json`);
  if (fs.existsSync(filePath)) return; // idempotent
  const record: ContextEscapeObservation = {
    schema_version: 1, kind: 'forgeai_context_escape_observation', task_id: taskId,
    recorded_at: new Date().toISOString(), primary_artifact: obs.primary_artifact, primary_digest: obs.primary_digest,
  };
  writeJsonAtomic(filePath, record);
}

export type NewEscape = {
  primary_artifact: string;
  primary_digest: string;
  request: RejectedRequestSnapshot;
  reason_code: EscapeReasonCode;
  detail: string;
};

export function recordEscapes(taskId: string, escapes: NewEscape[], root: string): void {
  if (!isValidTaskId(taskId)) throw new Error(`refusing to record escapes with invalid task_id: ${taskId}`);
  if (escapes.length === 0) return;
  const now = new Date().toISOString();
  for (const esc of escapes) {
    if (!DIGEST_RE.test(esc.primary_digest)) throw new Error(`refusing to record escape with invalid primary_digest: ${esc.primary_digest}`);
    // Fail-fast on a request the reader would reject (e.g. an array): silently
    // skipping it would leave an observation with no event and let --evaluate
    // report a misleading context_escapes: 0. Consistent with the guards above.
    if (!isPlainObject(esc.request)) throw new Error('refusing to record escape with a non-object request');
    const id = escapeId(esc.primary_digest, esc.request, esc.reason_code);
    const filePath = path.join(taskEscapeDir(root, taskId), 'events', `${id}.json`);
    if (fs.existsSync(filePath)) continue; // dedup by filename
    const record: ContextEscapeEvent = {
      schema_version: 1, kind: 'forgeai_context_escape_event', escape_id: id, task_id: taskId,
      recorded_at: now, primary_artifact: esc.primary_artifact, primary_digest: esc.primary_digest,
      request: esc.request, status: 'rejected', reason_code: esc.reason_code, detail: esc.detail,
    };
    writeJsonAtomic(filePath, record);
  }
}

// ─── read + validate ──────────────────────────────────────────────────────────

function isIso(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
}

// Declined requests are recorded *because* they were malformed (missing
// reason/path/name, unknown kind), so the persisted request is a snapshot, not a
// full request union — we only require a plain object so canonicalRequest() can
// hash it. The recomputed escape_id below is the real integrity check.
function isPlainObject(raw: unknown): raw is RejectedRequestSnapshot {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function isValidObservation(raw: unknown, taskId: string, fileDigest: string): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return r.kind === 'forgeai_context_escape_observation' && r.schema_version === 1
    && r.task_id === taskId && isIso(r.recorded_at)
    && typeof r.primary_artifact === 'string' && (r.primary_artifact as string).length > 0
    && DIGEST_RE.test(fileDigest) && r.primary_digest === fileDigest;
}

function validateEvent(raw: unknown, taskId: string): ContextEscapeEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'forgeai_context_escape_event' || r.schema_version !== 1) return null;
  if (r.task_id !== taskId) return null;
  if (!isIso(r.recorded_at)) return null;
  if (typeof r.primary_artifact !== 'string' || (r.primary_artifact as string).length === 0) return null;
  if (typeof r.primary_digest !== 'string' || !DIGEST_RE.test(r.primary_digest as string)) return null;
  if (r.status !== 'rejected') return null;
  if (typeof r.reason_code !== 'string' || !REASON_CODES.has(r.reason_code as EscapeReasonCode)) return null;
  if (typeof r.detail !== 'string') return null;
  if (!isPlainObject(r.request)) return null;
  if (typeof r.escape_id !== 'string' || !ESCAPE_ID_RE.test(r.escape_id as string)) return null;
  // Recompute: escape_id must match content (rejects tampered/corrupt files).
  if (escapeId(r.primary_digest as string, r.request, r.reason_code as EscapeReasonCode) !== r.escape_id) return null;
  return r as unknown as ContextEscapeEvent;
}

export type ResolveResult = { ok: true; count: number | null } | { ok: false; reason: string };

// Safely list *.json entries in a directory; ENOTDIR (a file where a directory
// is expected) or any read error surfaces as a structural failure, never a throw.
function listJsonSafely(dir: string, label: string): string[] | { error: string } {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.tmp'));
  } catch (err) {
    return { error: `${label} is not a readable directory: ${String(err)}` };
  }
}

export function resolveEscapeCount(taskId: string, primaryDigest: string, root: string): ResolveResult {
  if (!isValidTaskId(taskId)) return { ok: false, reason: `invalid task id ${taskId}` };
  if (!DIGEST_RE.test(primaryDigest)) return { ok: false, reason: `invalid primary digest` };
  const dir = taskEscapeDir(root, taskId);
  let dirStat: fs.Stats;
  try {
    dirStat = fs.statSync(dir);
  } catch {
    return { ok: true, count: null }; // no store for this task
  }
  // The task path exists but is not a directory — a corrupt store, not "unobserved".
  if (!dirStat.isDirectory()) return { ok: false, reason: `${ESCAPE_DIR}/${taskId} is not a directory` };

  // Observation markers gate null-vs-0.
  let observed = false;
  const obsDir = path.join(dir, 'observed');
  const obsNames = listJsonSafely(obsDir, `${ESCAPE_DIR}/${taskId}/observed`);
  if (!Array.isArray(obsNames)) return { ok: false, reason: obsNames.error };
  for (const name of obsNames) {
    const fileDigest = name.slice(0, -5);
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(path.join(obsDir, name), 'utf8')); }
    catch { return { ok: false, reason: `${ESCAPE_DIR}/${taskId}/observed/${name} is not valid JSON` }; }
    if (!isValidObservation(raw, taskId, fileDigest)) return { ok: false, reason: `${ESCAPE_DIR}/${taskId}/observed/${name} is malformed` };
    if (fileDigest === primaryDigest) observed = true;
  }

  // Count events matching the evaluated primary digest.
  let count = 0;
  const evDir = path.join(dir, 'events');
  const evNames = listJsonSafely(evDir, `${ESCAPE_DIR}/${taskId}/events`);
  if (!Array.isArray(evNames)) return { ok: false, reason: evNames.error };
  for (const name of evNames) {
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(path.join(evDir, name), 'utf8')); }
    catch { return { ok: false, reason: `${ESCAPE_DIR}/${taskId}/events/${name} is not valid JSON` }; }
    const event = validateEvent(raw, taskId);
    if (!event) return { ok: false, reason: `${ESCAPE_DIR}/${taskId}/events/${name} is malformed` };
    if (name !== `${event.escape_id}.json`) return { ok: false, reason: `${ESCAPE_DIR}/${taskId}/events/${name} filename does not match escape_id` };
    if (event.primary_digest === primaryDigest) count += 1;
  }

  return observed ? { ok: true, count } : { ok: true, count: null };
}
