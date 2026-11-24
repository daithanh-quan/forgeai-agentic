import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentSession, SessionLockConflict, SessionLockRecord } from './types.js';
import { args, force, getArgValue, recoverStale, root } from './context.js';
import { formatStatus, getErrorMessage } from './utils.js';

export const LOCKS_RELATIVE_DIR = '.ai/state/locks';
export const DEFAULT_LOCK_TTL_SECONDS = 1800;
export const MIN_LOCK_TTL_SECONDS = 5;
export const MAX_LOCK_TTL_SECONDS = 86_400;
const GATE_LOCK_FILE = '.gate.lock';
const GATE_STALE_MS = 5000;
const GATE_MAX_ATTEMPTS = 40;
const GATE_WAIT_MS = 10;
const FINISHED_SESSION_STATUSES = new Set(['done', 'complete', 'completed', 'closed', 'cancelled', 'canceled']);
const BROAD_SCOPE_TOKENS = new Set(['.', '*', 'repo', 'all']);

export type ActiveSessionLockEntry = {
  lock: SessionLockRecord;
  lockPath: string;
};

export type StaleSessionLockEntry = {
  lock: SessionLockRecord;
  lockPath: string;
  reason: string;
};

export type CorruptSessionLockEntry = {
  fileName: string;
  lockPath: string;
  detail: string;
};

export type InspectedSessionLocks = {
  active: ActiveSessionLockEntry[];
  stale: StaleSessionLockEntry[];
  corrupt: CorruptSessionLockEntry[];
};

export type InspectSessionLocksOptions = {
  nowMs?: number;
  checkPid?: (pid: number) => boolean;
  includeLinkedWorktrees?: boolean;
};

export type AcquireSessionLockOptions = {
  sessionId: string;
  writeScope: string[];
  readScope?: string[];
  owner?: string;
  taskId?: string | null;
  objective?: string | null;
  branch?: string | null;
  worktree?: string;
  ttlSeconds?: number;
  pid?: number | null;
  force?: boolean;
  recoverStale?: boolean;
  nowMs?: number;
  checkPid?: (pid: number) => boolean;
};

export type AcquireSessionLockResult =
  | {
      ok: true;
      lock: SessionLockRecord;
      lock_path: string;
      recovered_stale_locks: StaleSessionLockEntry[];
    }
  | {
      ok: false;
      reason: 'invalid_input' | 'already_locked' | 'owner_mismatch' | 'conflict';
      detail: string;
      conflicts: SessionLockConflict[];
      recovered_stale_locks: StaleSessionLockEntry[];
    };

export type HeartbeatSessionLockOptions = {
  sessionId: string;
  owner?: string;
  ttlSeconds?: number;
  pid?: number | null;
  force?: boolean;
  nowMs?: number;
  checkPid?: (pid: number) => boolean;
};

export type HeartbeatSessionLockResult =
  | {
      ok: true;
      lock: SessionLockRecord;
      lock_path: string;
    }
  | {
      ok: false;
      reason: 'invalid_input' | 'not_found' | 'corrupt' | 'owner_mismatch' | 'stale' | 'conflict';
      detail: string;
    };

export type ReleaseSessionLockOptions = {
  sessionId: string;
  owner?: string;
  force?: boolean;
  allowMissing?: boolean;
  nowMs?: number;
  checkPid?: (pid: number) => boolean;
};

export type ReleaseSessionLockResult =
  | {
      ok: true;
      released: SessionLockRecord | null;
      lock_path: string | null;
    }
  | {
      ok: false;
      reason: 'invalid_input' | 'not_found' | 'owner_mismatch';
      detail: string;
    };

export function cleanTableCell(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/\\\|/g, '|')
    .trim();
}

export function splitTableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/);
}

export function parseScopeList(value: string): string[] {
  const cleaned = cleanTableCell(value);
  if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'none') return [];

  return cleaned
    .split(/,|<br\s*\/?>/i)
    .map((item) => cleanTableCell(item))
    .filter(Boolean);
}

export function normalizeScopePath(scope: string): string {
  const trimmed = scope
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');

  if (trimmed === '/') return '.';
  return trimmed.replace(/\/+$/, '') || '.';
}

export function isBroadScope(scope: string): boolean {
  const normalized = normalizeScopePath(scope).toLowerCase();
  return BROAD_SCOPE_TOKENS.has(normalized) || normalized.includes('*');
}

export function scopesOverlap(left: string, right: string): boolean {
  const leftPath = normalizeScopePath(left);
  const rightPath = normalizeScopePath(right);

  if (isBroadScope(leftPath) || isBroadScope(rightPath)) return true;
  if (leftPath === rightPath) return true;
  return leftPath.startsWith(`${rightPath}/`) || rightPath.startsWith(`${leftPath}/`);
}

export function isValidSessionId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) && id !== 'example-session';
}

function isReservedLockTarget(normalized: string): boolean {
  const forbiddenPrefixes = ['.git', LOCKS_RELATIVE_DIR];
  return forbiddenPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function sanitizeScopeCandidate(raw: string): string | null {
  const cleaned = raw.trim().replace(/^`|`$/g, '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!cleaned || cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned)) return null;
  for (const part of cleaned.split('/')) {
    if (!part || part === '.' || part === '..') return null;
  }
  if (isReservedLockTarget(cleaned)) return null;
  return normalizeScopePath(cleaned);
}

export function validateLockScopes(
  rawScopes: string[],
  requireNonEmpty: boolean
): { normalized: string[]; error: string | null } {
  const tokens = rawScopes.map((s) => s.trim()).filter(Boolean);
  if (requireNonEmpty && tokens.length === 0) {
    return { normalized: [], error: 'write scope requires at least one repo-relative path or prefix' };
  }
  const normalized: string[] = [];
  for (const token of tokens) {
    const clean = sanitizeScopeCandidate(token);
    if (!clean) {
      return {
        normalized: [],
        error: 'scope paths must be safe repo-relative paths or prefixes (cannot traverse "..", use absolute paths, or target .git or .ai/state/locks)'
      };
    }
    if (!normalized.includes(clean)) normalized.push(clean);
  }
  return { normalized, error: null };
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function evaluateLockStaleness(
  lock: SessionLockRecord,
  nowMs = Date.now(),
  checkPid: (pid: number) => boolean = isProcessAlive
): { stale: boolean; reason: string | null } {
  const expiresMs = Date.parse(lock.expires_at);
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    return { stale: true, reason: `expired at ${lock.expires_at}` };
  }
  if (lock.pid !== null && !checkPid(lock.pid)) {
    return { stale: true, reason: `dead pid ${lock.pid}` };
  }
  return { stale: false, reason: null };
}

function tryRealpath(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function parsePorcelainWorktrees(stdout: string, canonicalRoot: string): string[] {
  const paths = new Set<string>([canonicalRoot]);
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue;
    const wt = line.slice('worktree '.length).trim();
    if (wt) paths.add(tryRealpath(wt));
  }
  return [...paths];
}

export function detectWorktreeContext(repositoryRoot: string): {
  worktree: string;
  branch: string | null;
  linkedWorktrees: string[];
} {
  const canonicalRoot = tryRealpath(repositoryRoot);
  if (!fs.existsSync(path.join(repositoryRoot, '.git'))) {
    return { worktree: canonicalRoot, branch: null, linkedWorktrees: [canonicalRoot] };
  }
  const branchRes = spawnSync('git', ['branch', '--show-current'], { cwd: repositoryRoot, encoding: 'utf8' });
  const branch = branchRes.status === 0 ? branchRes.stdout.trim() || null : null;
  const wtRes = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' });
  const linkedWorktrees = wtRes.status === 0 ? parsePorcelainWorktrees(wtRes.stdout, canonicalRoot) : [canonicalRoot];
  return { worktree: canonicalRoot, branch, linkedWorktrees };
}

export function formatWorktreeRelation(holderWorktree: string, currentRoot: string): string {
  const same = tryRealpath(holderWorktree) === tryRealpath(currentRoot);
  return `${holderWorktree} [${same ? 'current worktree' : 'linked worktree'}]`;
}

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isStringArray(value: unknown, requireNonEmpty: boolean): value is string[] {
  if (!Array.isArray(value)) return false;
  if (requireNonEmpty && value.length === 0) return false;
  return value.every(isNonEmptyString);
}

function hasValidLockIdentity(rec: Record<string, unknown>): boolean {
  if (rec.schema_version !== 1 || rec.kind !== 'forgeai_session_lock') return false;
  if (typeof rec.session_id !== 'string' || !isValidSessionId(rec.session_id)) return false;
  return isNonEmptyString(rec.owner) && isNonEmptyString(rec.worktree);
}

function hasValidLockOptionals(rec: Record<string, unknown>): boolean {
  const nullableStrings = [rec.task_id, rec.objective, rec.branch].every(
    (val) => val === null || typeof val === 'string'
  );
  const validPid = rec.pid === null || isPositiveInt(rec.pid);
  return nullableStrings && validPid && isPositiveInt(rec.ttl_seconds);
}

function hasValidLockScopesAndTimestamps(rec: Record<string, unknown>): boolean {
  if (!isStringArray(rec.write_scope, true) || !isStringArray(rec.read_scope, false)) return false;
  return [rec.acquired_at, rec.heartbeat_at, rec.expires_at].every(isValidIsoTimestamp);
}

export function isValidSessionLockRecord(raw: unknown): raw is SessionLockRecord {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const rec = raw as Record<string, unknown>;
  return [hasValidLockIdentity, hasValidLockOptionals, hasValidLockScopesAndTimestamps].every((fn) => fn(rec));
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isGateStale(gatePath: string, nowMs: number): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(gatePath, 'utf8')) as { pid?: unknown; created_at_ms?: unknown };
    const createdAt = typeof raw.created_at_ms === 'number' ? raw.created_at_ms : 0;
    if (nowMs - createdAt > GATE_STALE_MS) return true;
    return isPositiveInt(raw.pid) && !isProcessAlive(raw.pid);
  } catch {
    return true;
  }
}

function acquireGateFd(gatePath: string): number {
  for (let attempt = 0; attempt < GATE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(gatePath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at_ms: Date.now() }));
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (isGateStale(gatePath, Date.now())) {
        try { fs.unlinkSync(gatePath); } catch { /* ignore race */ }
        continue;
      }
      sleepSync(GATE_WAIT_MS);
    }
  }
  throw new Error('timed out waiting for session lock mutex (.ai/state/locks/.gate.lock)');
}

function withLockGate<T>(repositoryRoot: string, fn: () => T): T {
  const locksDir = path.join(repositoryRoot, LOCKS_RELATIVE_DIR);
  fs.mkdirSync(locksDir, { recursive: true });
  const gatePath = path.join(locksDir, GATE_LOCK_FILE);
  const fd = acquireGateFd(gatePath);
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.unlinkSync(gatePath); } catch { /* ignore */ }
  }
}

function writeLockFileAtomic(lockPath: string, record: SessionLockRecord, exclusive: boolean): void {
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  if (exclusive) {
    fs.writeFileSync(lockPath, payload, { flag: 'wx' });
    return;
  }
  const suffix = `${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  const tmpPath = `${lockPath}.tmp.${suffix}`;
  fs.writeFileSync(tmpPath, payload, { flag: 'wx' });
  fs.renameSync(tmpPath, lockPath);
}

function isCandidateLockFileName(fileName: string): boolean {
  return !fileName.startsWith('.') && fileName.endsWith('.json') && !fileName.includes('.tmp.');
}

function classifySingleLockFile(
  lockPath: string,
  fileName: string,
  nowMs: number,
  checkPid: (pid: number) => boolean,
  out: InspectedSessionLocks
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    out.corrupt.push({ fileName, lockPath, detail: `malformed JSON (${getErrorMessage(error)})` });
    return;
  }
  if (!isValidSessionLockRecord(parsed)) {
    out.corrupt.push({ fileName, lockPath, detail: 'invalid session lock schema' });
    return;
  }
  const staleness = evaluateLockStaleness(parsed, nowMs, checkPid);
  if (staleness.stale) {
    out.stale.push({ lock: parsed, lockPath, reason: staleness.reason ?? 'expired' });
  } else {
    out.active.push({ lock: parsed, lockPath });
  }
}

function collectLocksInWorktreeDir(
  wtRoot: string,
  visitedPaths: Set<string>,
  nowMs: number,
  checkPid: (pid: number) => boolean,
  out: InspectedSessionLocks
): void {
  const locksDir = path.join(wtRoot, LOCKS_RELATIVE_DIR);
  if (!fs.existsSync(locksDir)) return;
  for (const fileName of fs.readdirSync(locksDir).sort()) {
    if (!isCandidateLockFileName(fileName)) continue;
    const lockPath = path.join(locksDir, fileName);
    const canonicalFile = tryRealpath(lockPath);
    if (visitedPaths.has(canonicalFile)) continue;
    visitedPaths.add(canonicalFile);
    classifySingleLockFile(lockPath, fileName, nowMs, checkPid, out);
  }
}

export function inspectSessionLocks(
  repositoryRoot = root,
  options: InspectSessionLocksOptions = {}
): InspectedSessionLocks {
  const nowMs = options.nowMs ?? Date.now();
  const checkPid = options.checkPid ?? isProcessAlive;
  const roots = options.includeLinkedWorktrees === false
    ? [tryRealpath(repositoryRoot)]
    : detectWorktreeContext(repositoryRoot).linkedWorktrees;

  const out: InspectedSessionLocks = { active: [], stale: [], corrupt: [] };
  const visitedPaths = new Set<string>();
  for (const wtRoot of roots) {
    collectLocksInWorktreeDir(wtRoot, visitedPaths, nowMs, checkPid, out);
  }

  out.active.sort((a, b) => a.lock.session_id.localeCompare(b.lock.session_id));
  out.stale.sort((a, b) => a.lock.session_id.localeCompare(b.lock.session_id));
  out.corrupt.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return out;
}

function parseSessionRowCells(line: string): AgentSession | null {
  if (!line.startsWith('|') || /^\|\s*-+/.test(line) || /\|\s*ID\s*\|/i.test(line)) return null;
  const cells = splitTableRow(line).map((cell) => cell.trim());
  if (cells.length < 9) return null;
  const id = cleanTableCell(cells[0]);
  if (!id || id === 'example-session') return null;

  return {
    id,
    owner: cleanTableCell(cells[1]),
    task: cleanTableCell(cells[2]),
    branch: cleanTableCell(cells[3]),
    status: cleanTableCell(cells[4]).toLowerCase(),
    started: cleanTableCell(cells[5]),
    readScope: parseScopeList(cells[6]),
    writeScope: parseScopeList(cells[7]),
    notes: cleanTableCell(cells[8])
  };
}

export function parseSessionTable(content: string): AgentSession[] {
  const sessions: AgentSession[] = [];
  let inActiveSessions = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('## ')) {
      inActiveSessions = /^##\s+Active Sessions\b/i.test(line);
      continue;
    }
    if (!inActiveSessions) continue;
    const parsed = parseSessionRowCells(line);
    if (parsed) sessions.push(parsed);
  }

  return sessions;
}

export function isUnfinishedSession(session: AgentSession): boolean {
  return !FINISHED_SESSION_STATUSES.has(session.status);
}

function readUnfinishedTableSessions(repositoryRoot: string): AgentSession[] {
  const sessionsPath = path.join(repositoryRoot, '.ai', 'state', 'sessions.md');
  if (!fs.existsSync(sessionsPath)) return [];
  return parseSessionTable(fs.readFileSync(sessionsPath, 'utf8')).filter(isUnfinishedSession);
}

export function formatConflictMessage(conflict: SessionLockConflict, currentRoot: string): string {
  const wtLabel = formatWorktreeRelation(conflict.worktree, currentRoot);
  const sourceLabel = conflict.holder_source === 'lock' ? 'active lock' : 'active session';
  const expiryPart = conflict.expires_at ? `, expires: ${conflict.expires_at}` : '';
  return `scope '${conflict.requested_scope}' conflicts with ${sourceLabel} '${conflict.holder_id}' on '${conflict.conflicting_scope}' (owner: ${conflict.owner}, branch: ${conflict.branch ?? 'unknown'}, worktree: ${wtLabel}${expiryPart})`;
}

type ConflictCandidate = {
  id: string;
  source: 'lock' | 'sessions_table';
  owner: string;
  branch: string | null;
  worktree: string;
  expiresAt: string | null;
  writeScope: string[];
};

function lockEntriesToCandidates(entries: Array<{ lock: SessionLockRecord }>): ConflictCandidate[] {
  return entries.map(({ lock }) => ({
    id: lock.session_id,
    source: 'lock',
    owner: lock.owner,
    branch: lock.branch,
    worktree: lock.worktree,
    expiresAt: lock.expires_at,
    writeScope: lock.write_scope
  }));
}

function tableSessionsToCandidates(sessions: AgentSession[], currentRoot: string): ConflictCandidate[] {
  const canonical = tryRealpath(currentRoot);
  return sessions.map((s) => ({
    id: s.id,
    source: 'sessions_table',
    owner: s.owner || 'unknown',
    branch: s.branch || null,
    worktree: canonical,
    expiresAt: null,
    writeScope: s.writeScope
  }));
}

function collectCandidateConflicts(
  sessionId: string,
  requestedScopes: string[],
  candidates: ConflictCandidate[],
  currentRoot: string
): SessionLockConflict[] {
  const conflicts: SessionLockConflict[] = [];
  for (const candidate of candidates) {
    if (candidate.id === sessionId) continue;
    for (const reqScope of requestedScopes) {
      const hit = candidate.writeScope.find((held) => scopesOverlap(reqScope, held));
      if (!hit) continue;
      const item: SessionLockConflict = {
        requested_scope: normalizeScopePath(reqScope),
        conflicting_scope: normalizeScopePath(hit),
        holder_id: candidate.id,
        holder_source: candidate.source,
        owner: candidate.owner,
        branch: candidate.branch,
        worktree: candidate.worktree,
        expires_at: candidate.expiresAt,
        detail: ''
      };
      item.detail = formatConflictMessage(item, currentRoot);
      conflicts.push(item);
    }
  }
  return conflicts;
}

function reclaimOverlappingStaleLocks(
  sessionId: string,
  requestedScopes: string[],
  staleEntries: StaleSessionLockEntry[]
): StaleSessionLockEntry[] {
  const recovered: StaleSessionLockEntry[] = [];
  for (const entry of staleEntries) {
    const overlaps = entry.lock.session_id === sessionId
      || requestedScopes.some((req) => entry.lock.write_scope.some((held) => scopesOverlap(req, held)));
    if (!overlaps) continue;
    try {
      fs.unlinkSync(entry.lockPath);
      recovered.push(entry);
    } catch { /* ignore already unlinked */ }
  }
  return recovered;
}

function isValidTtlRange(ttl: number): boolean {
  return Number.isInteger(ttl) && ttl >= MIN_LOCK_TTL_SECONDS && ttl <= MAX_LOCK_TTL_SECONDS;
}

type ValidatedAcquireInputs = {
  writeScope: string[];
  readScope: string[];
  ttlSeconds: number;
  owner: string;
  error: string | null;
};

function invalidAcquireInput(error: string): ValidatedAcquireInputs {
  return { writeScope: [], readScope: [], ttlSeconds: 0, owner: '', error };
}

function resolveAcquireOwner(explicitOwner: string | undefined): string {
  const candidate = explicitOwner !== undefined ? explicitOwner : (process.env.FORGEAI_OWNER ?? 'local-agent');
  return candidate.trim();
}

function validateAcquireInputs(options: AcquireSessionLockOptions): ValidatedAcquireInputs {
  if (!isValidSessionId(options.sessionId)) {
    return invalidAcquireInput(`invalid session id '${options.sessionId}' (use 1-64 alphanumeric, '.', '_', or '-' characters)`);
  }
  const writeCheck = validateLockScopes(options.writeScope, true);
  if (writeCheck.error) return invalidAcquireInput(writeCheck.error);
  const readCheck = validateLockScopes(options.readScope ?? [], false);
  if (readCheck.error) return invalidAcquireInput(readCheck.error);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_LOCK_TTL_SECONDS;
  if (!isValidTtlRange(ttlSeconds)) {
    return invalidAcquireInput(`ttlSeconds must be an integer between ${MIN_LOCK_TTL_SECONDS} and ${MAX_LOCK_TTL_SECONDS}`);
  }
  const owner = resolveAcquireOwner(options.owner);
  if (!owner) return invalidAcquireInput('owner must be a non-empty string');
  return { writeScope: writeCheck.normalized, readScope: readCheck.normalized, ttlSeconds, owner, error: null };
}

function checkSameSessionActiveLock(
  existingSame: ActiveSessionLockEntry | undefined,
  sessionId: string,
  owner: string,
  forceFlag: boolean | undefined,
  recovered: StaleSessionLockEntry[]
): AcquireSessionLockResult | null {
  if (!existingSame) return null;
  if (!forceFlag) {
    return {
      ok: false,
      reason: 'already_locked',
      detail: `session '${sessionId}' already holds an active lock (owner: ${existingSame.lock.owner}, expires: ${existingSame.lock.expires_at}); use --heartbeat-session to extend or --force to replace`,
      conflicts: [],
      recovered_stale_locks: recovered
    };
  }
  if (existingSame.lock.owner !== owner) {
    return {
      ok: false,
      reason: 'owner_mismatch',
      detail: `session '${sessionId}' is owned by '${existingSame.lock.owner}', not '${owner}'`,
      conflicts: [],
      recovered_stale_locks: recovered
    };
  }
  return null;
}

function buildNewSessionLockRecord(
  options: AcquireSessionLockOptions,
  validated: ValidatedAcquireInputs,
  wtContext: { worktree: string; branch: string | null },
  existingSame: ActiveSessionLockEntry | undefined,
  nowMs: number
): SessionLockRecord {
  const nowIso = new Date(nowMs).toISOString();
  const expiresIso = new Date(nowMs + validated.ttlSeconds * 1000).toISOString();
  return {
    schema_version: 1,
    kind: 'forgeai_session_lock',
    session_id: options.sessionId,
    owner: validated.owner,
    task_id: options.taskId ?? null,
    objective: options.objective ?? null,
    branch: options.branch !== undefined ? options.branch : wtContext.branch,
    worktree: options.worktree ? tryRealpath(options.worktree) : wtContext.worktree,
    pid: options.pid ?? null,
    write_scope: validated.writeScope,
    read_scope: validated.readScope,
    acquired_at: existingSame ? existingSame.lock.acquired_at : nowIso,
    heartbeat_at: nowIso,
    expires_at: expiresIso,
    ttl_seconds: validated.ttlSeconds
  };
}

function checkUnrecoveredStaleConflicts(
  sessionId: string,
  writeScope: string[],
  staleEntries: StaleSessionLockEntry[],
  repositoryRoot: string
): AcquireSessionLockResult | null {
  const conflicts = collectCandidateConflicts(
    sessionId,
    writeScope,
    lockEntriesToCandidates(staleEntries),
    repositoryRoot
  );
  if (conflicts.length === 0) return null;
  return {
    ok: false,
    reason: 'conflict',
    detail: `${conflicts[0].detail} (stale lock; pass --recover-stale or run --check-sessions --recover-stale)`,
    conflicts,
    recovered_stale_locks: []
  };
}

function findActiveScopeConflicts(
  sessionId: string,
  writeScope: string[],
  inspected: InspectedSessionLocks,
  repositoryRoot: string
): SessionLockConflict[] {
  const activeCandidates = [
    ...lockEntriesToCandidates(inspected.active),
    ...tableSessionsToCandidates(readUnfinishedTableSessions(repositoryRoot), repositoryRoot)
  ];
  return collectCandidateConflicts(sessionId, writeScope, activeCandidates, repositoryRoot);
}

function executeAcquireInsideGate(
  options: AcquireSessionLockOptions,
  validated: ValidatedAcquireInputs,
  wtContext: { worktree: string; branch: string | null },
  nowMs: number,
  checkPid: (pid: number) => boolean,
  recoverStaleFlag: boolean,
  repositoryRoot: string
): AcquireSessionLockResult {
  const inspected = inspectSessionLocks(repositoryRoot, { nowMs, checkPid });
  if (!recoverStaleFlag) {
    const staleConflict = checkUnrecoveredStaleConflicts(options.sessionId, validated.writeScope, inspected.stale, repositoryRoot);
    if (staleConflict) return staleConflict;
  }
  const recovered = recoverStaleFlag
    ? reclaimOverlappingStaleLocks(options.sessionId, validated.writeScope, inspected.stale)
    : [];

  const existingSame = inspected.active.find((entry) => entry.lock.session_id === options.sessionId);
  const sameCheck = checkSameSessionActiveLock(existingSame, options.sessionId, validated.owner, options.force, recovered);
  if (sameCheck) return sameCheck;

  const conflicts = findActiveScopeConflicts(options.sessionId, validated.writeScope, inspected, repositoryRoot);
  if (conflicts.length > 0) {
    return {
      ok: false,
      reason: 'conflict',
      detail: conflicts.map((c) => c.detail).join('; '),
      conflicts,
      recovered_stale_locks: recovered
    };
  }

  const lock = buildNewSessionLockRecord(options, validated, wtContext, existingSame, nowMs);
  const lockPath = existingSame
    ? existingSame.lockPath
    : path.join(repositoryRoot, LOCKS_RELATIVE_DIR, `${options.sessionId}.json`);
  writeLockFileAtomic(lockPath, lock, !existingSame);

  return { ok: true, lock, lock_path: lockPath, recovered_stale_locks: recovered };
}

export function acquireSessionLock(
  options: AcquireSessionLockOptions,
  repositoryRoot = root
): AcquireSessionLockResult {
  const validated = validateAcquireInputs(options);
  if (validated.error) {
    return { ok: false, reason: 'invalid_input', detail: validated.error, conflicts: [], recovered_stale_locks: [] };
  }

  const wtContext = detectWorktreeContext(repositoryRoot);
  const nowMs = options.nowMs ?? Date.now();
  const checkPid = options.checkPid ?? isProcessAlive;
  const recoverStaleFlag = options.recoverStale !== false;

  return withLockGate(repositoryRoot, () =>
    executeAcquireInsideGate(options, validated, wtContext, nowMs, checkPid, recoverStaleFlag, repositoryRoot)
  );
}

function findLockFileBySessionId(sessionId: string, repositoryRoot: string): string | null {
  const localCandidate = path.join(repositoryRoot, LOCKS_RELATIVE_DIR, `${sessionId}.json`);
  if (fs.existsSync(localCandidate)) return localCandidate;
  for (const wtRoot of detectWorktreeContext(repositoryRoot).linkedWorktrees) {
    const candidate = path.join(wtRoot, LOCKS_RELATIVE_DIR, `${sessionId}.json`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readAndValidateLockOnDisk(
  sessionId: string,
  repositoryRoot: string
): { ok: true; lock: SessionLockRecord; lockPath: string } | { ok: false; reason: 'not_found' | 'corrupt'; detail: string } {
  const lockPath = findLockFileBySessionId(sessionId, repositoryRoot);
  if (!lockPath) {
    return { ok: false, reason: 'not_found', detail: `session lock '${sessionId}' not found` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    return { ok: false, reason: 'corrupt', detail: `session lock '${sessionId}' is corrupt (${getErrorMessage(error)})` };
  }
  if (!isValidSessionLockRecord(parsed)) {
    return { ok: false, reason: 'corrupt', detail: `session lock '${sessionId}' has invalid schema` };
  }
  return { ok: true, lock: parsed, lockPath };
}

function validateHeartbeatStaleness(
  lock: SessionLockRecord,
  options: HeartbeatSessionLockOptions,
  nowMs: number,
  checkPid: (pid: number) => boolean,
  repositoryRoot: string
): HeartbeatSessionLockResult | null {
  const staleness = evaluateLockStaleness(lock, nowMs, checkPid);
  if (!staleness.stale) return null;
  if (!options.force) {
    return {
      ok: false,
      reason: 'stale',
      detail: `session lock '${options.sessionId}' is stale (${staleness.reason}); re-acquire with --lock-session or pass --force`
    };
  }
  const inspected = inspectSessionLocks(repositoryRoot, { nowMs, checkPid });
  const conflicts = collectCandidateConflicts(options.sessionId, lock.write_scope, lockEntriesToCandidates(inspected.active), repositoryRoot);
  if (conflicts.length > 0) {
    return { ok: false, reason: 'conflict', detail: conflicts[0].detail };
  }
  return null;
}

function validateHeartbeatInputs(options: HeartbeatSessionLockOptions): string | null {
  if (!isValidSessionId(options.sessionId)) return `invalid session id '${options.sessionId}'`;
  if (options.ttlSeconds !== undefined && !isValidTtlRange(options.ttlSeconds)) {
    return `ttlSeconds must be between ${MIN_LOCK_TTL_SECONDS} and ${MAX_LOCK_TTL_SECONDS}`;
  }
  return null;
}

function buildUpdatedHeartbeatRecord(
  existing: SessionLockRecord,
  options: HeartbeatSessionLockOptions,
  nowMs: number
): SessionLockRecord {
  const ttlSeconds = options.ttlSeconds ?? existing.ttl_seconds;
  const nowIso = new Date(nowMs).toISOString();
  return {
    ...existing,
    pid: options.pid !== undefined ? options.pid : existing.pid,
    ttl_seconds: ttlSeconds,
    heartbeat_at: nowIso,
    expires_at: new Date(nowMs + ttlSeconds * 1000).toISOString()
  };
}

export function heartbeatSessionLock(
  options: HeartbeatSessionLockOptions,
  repositoryRoot = root
): HeartbeatSessionLockResult {
  const inputError = validateHeartbeatInputs(options);
  if (inputError) return { ok: false, reason: 'invalid_input', detail: inputError };

  const nowMs = options.nowMs ?? Date.now();
  const checkPid = options.checkPid ?? isProcessAlive;

  return withLockGate(repositoryRoot, () => {
    const loaded = readAndValidateLockOnDisk(options.sessionId, repositoryRoot);
    if (!loaded.ok) return loaded;
    if (options.owner !== undefined && loaded.lock.owner !== options.owner.trim()) {
      return {
        ok: false,
        reason: 'owner_mismatch',
        detail: `session lock '${options.sessionId}' is owned by '${loaded.lock.owner}', not '${options.owner.trim()}'`
      };
    }

    const staleCheck = validateHeartbeatStaleness(loaded.lock, options, nowMs, checkPid, repositoryRoot);
    if (staleCheck) return staleCheck;

    const updated = buildUpdatedHeartbeatRecord(loaded.lock, options, nowMs);
    writeLockFileAtomic(loaded.lockPath, updated, false);
    return { ok: true, lock: updated, lock_path: loaded.lockPath };
  });
}

function tryReadLockForRelease(lockPath: string): SessionLockRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    return isValidSessionLockRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}

function isReleaseBlockedByOwner(
  parsed: SessionLockRecord | null,
  options: ReleaseSessionLockOptions,
  nowMs: number,
  checkPid: (pid: number) => boolean
): boolean {
  if (!parsed || options.owner === undefined || options.force) return false;
  if (parsed.owner === options.owner.trim()) return false;
  return !evaluateLockStaleness(parsed, nowMs, checkPid).stale;
}

export function releaseSessionLock(
  options: ReleaseSessionLockOptions,
  repositoryRoot = root
): ReleaseSessionLockResult {
  if (!isValidSessionId(options.sessionId)) {
    return { ok: false, reason: 'invalid_input', detail: `invalid session id '${options.sessionId}'` };
  }
  const nowMs = options.nowMs ?? Date.now();
  const checkPid = options.checkPid ?? isProcessAlive;

  return withLockGate(repositoryRoot, () => {
    const lockPath = findLockFileBySessionId(options.sessionId, repositoryRoot);
    if (!lockPath) {
      if (options.allowMissing) return { ok: true, released: null, lock_path: null };
      return { ok: false, reason: 'not_found', detail: `session lock '${options.sessionId}' not found` };
    }
    const parsed = tryReadLockForRelease(lockPath);
    if (isReleaseBlockedByOwner(parsed, options, nowMs, checkPid)) {
      return {
        ok: false,
        reason: 'owner_mismatch',
        detail: `session lock '${options.sessionId}' is owned by '${parsed!.owner}', not '${options.owner!.trim()}' (pass --force to override)`
      };
    }

    fs.unlinkSync(lockPath);
    return { ok: true, released: parsed, lock_path: lockPath };
  });
}

export function recoverStaleSessionLocks(
  repositoryRoot = root,
  options: InspectSessionLocksOptions = {}
): StaleSessionLockEntry[] {
  return withLockGate(repositoryRoot, () => {
    const inspected = inspectSessionLocks(repositoryRoot, options);
    const recovered: StaleSessionLockEntry[] = [];
    for (const entry of inspected.stale) {
      try {
        fs.unlinkSync(entry.lockPath);
        recovered.push(entry);
      } catch { /* ignore already unlinked */ }
    }
    return recovered;
  });
}

function shouldUnlinkOnProcessExit(lockPath: string, sessionId: string, owner: string): boolean {
  if (!fs.existsSync(lockPath)) return false;
  const raw = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { session_id?: unknown; owner?: unknown; pid?: unknown };
  if (raw.session_id !== sessionId || raw.owner !== owner) return false;
  return raw.pid === null || raw.pid === process.pid;
}

export function registerCrashSafeLockRelease(
  sessionId: string,
  owner: string,
  repositoryRoot = root
): () => void {
  let released = false;
  const lockPath = path.join(repositoryRoot, LOCKS_RELATIVE_DIR, `${sessionId}.json`);
  const onExit = (): void => {
    if (released) return;
    released = true;
    try {
      if (shouldUnlinkOnProcessExit(lockPath, sessionId, owner)) fs.unlinkSync(lockPath);
    } catch { /* best-effort synchronous cleanup on exit */ }
  };

  process.on('exit', onExit);
  return (): void => {
    if (released) return;
    released = true;
    process.removeListener('exit', onExit);
    try {
      releaseSessionLock({ sessionId, owner, allowMissing: true }, repositoryRoot);
    } catch { /* ignore cleanup error */ }
  };
}

export async function withSessionLock<T>(
  options: AcquireSessionLockOptions,
  fn: (lock: SessionLockRecord) => Promise<T> | T,
  repositoryRoot = root
): Promise<T> {
  const result = acquireSessionLock({ ...options, pid: options.pid ?? process.pid }, repositoryRoot);
  if (!result.ok) throw new Error(result.detail);
  const release = registerCrashSafeLockRelease(result.lock.session_id, result.lock.owner, repositoryRoot);
  try {
    return await fn(result.lock);
  } finally {
    release();
  }
}

function parseOptionalIntFlag(flagName: string): { value: number | undefined; error: string | null } {
  const raw = getArgValue(flagName);
  if (raw === null) return { value: undefined, error: null };
  const num = Number(raw);
  if (!isPositiveInt(num)) return { value: undefined, error: `${flagName} must be a positive integer` };
  return { value: num, error: null };
}

function parseTtlAndPidFlags(): { ttl: number | undefined; pid: number | undefined; error: string | null } {
  const ttlFlag = parseOptionalIntFlag('--ttl');
  if (ttlFlag.error) return { ttl: undefined, pid: undefined, error: ttlFlag.error };
  const pidFlag = parseOptionalIntFlag('--pid');
  if (pidFlag.error) return { ttl: undefined, pid: undefined, error: pidFlag.error };
  return { ttl: ttlFlag.value, pid: pidFlag.value, error: null };
}

function emitCliMutationOutcome(
  result: { ok: boolean; detail?: string },
  label: string,
  summaryText: string
): void {
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (!result.ok) {
    process.stderr.write(`Error: ${result.detail ?? 'operation failed'}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(formatStatus(label, summaryText));
}

function buildCliAcquireOptions(
  sessionId: string,
  writeScopeRaw: string,
  intFlags: { ttl: number | undefined; pid: number | undefined }
): AcquireSessionLockOptions {
  const readScopeRaw = getArgValue('--read-scope');
  return {
    sessionId,
    writeScope: writeScopeRaw.split(','),
    readScope: readScopeRaw ? readScopeRaw.split(',') : [],
    owner: getArgValue('--owner') ?? undefined,
    taskId: getArgValue('--task'),
    branch: getArgValue('--branch') ?? undefined,
    worktree: getArgValue('--worktree') ?? undefined,
    ttlSeconds: intFlags.ttl,
    pid: intFlags.pid ?? null,
    force,
    recoverStale: true
  };
}

function logRecoveredStaleLocksIfHuman(recovered: StaleSessionLockEntry[]): void {
  if (args.has('--json')) return;
  for (const rec of recovered) {
    console.log(formatStatus('recovered', `stale lock '${rec.lock.session_id}' (${rec.reason})`));
  }
}

type ParsedSessionCliArgs = {
  sessionId: string;
  writeScopeRaw: string;
  ttl: number | undefined;
  pid: number | undefined;
};

function parseSessionCliCommandArgs(usageText: string, requireWriteScope: boolean): ParsedSessionCliArgs | null {
  const sessionId = getArgValue('--session');
  const writeScopeRaw = getArgValue('--write-scope') ?? '';
  if (!sessionId || (requireWriteScope && !writeScopeRaw)) {
    process.stderr.write(`${usageText}\n`);
    process.exitCode = 2;
    return null;
  }
  const intFlags = parseTtlAndPidFlags();
  if (intFlags.error) {
    process.stderr.write(`Error: ${intFlags.error}\n`);
    process.exitCode = 2;
    return null;
  }
  return { sessionId, writeScopeRaw, ttl: intFlags.ttl, pid: intFlags.pid };
}

export function runLockSession(): void {
  const parsed = parseSessionCliCommandArgs(
    'Usage: forgeai-init --lock-session --session <id> --write-scope <path[,path...]> [--read-scope <path[,path...]>] [--owner <name>] [--task <id>] [--branch <name>] [--worktree <path>] [--ttl <seconds>] [--pid <pid>] [--force] [--json]',
    true
  );
  if (!parsed) return;

  const result = acquireSessionLock(buildCliAcquireOptions(parsed.sessionId, parsed.writeScopeRaw, parsed), root);
  logRecoveredStaleLocksIfHuman(result.recovered_stale_locks);
  const summary = result.ok
    ? `${result.lock.session_id} write: ${result.lock.write_scope.join(', ')} (owner: ${result.lock.owner}, branch: ${result.lock.branch ?? 'unknown'}, expires: ${result.lock.expires_at})`
    : '';
  emitCliMutationOutcome(result, 'locked', summary);
}

export function runHeartbeatSession(): void {
  const parsed = parseSessionCliCommandArgs(
    'Usage: forgeai-init --heartbeat-session --session <id> [--owner <name>] [--ttl <seconds>] [--pid <pid>] [--force] [--json]',
    false
  );
  if (!parsed) return;

  const result = heartbeatSessionLock(
    {
      sessionId: parsed.sessionId,
      owner: getArgValue('--owner') ?? undefined,
      ttlSeconds: parsed.ttl,
      pid: parsed.pid,
      force
    },
    root
  );
  const summary = result.ok
    ? `${result.lock.session_id} extended until ${result.lock.expires_at} (owner: ${result.lock.owner})`
    : '';
  emitCliMutationOutcome(result, 'heartbeat', summary);
}

export function runUnlockSession(): void {
  const sessionId = getArgValue('--session');
  if (!sessionId) {
    process.stderr.write('Usage: forgeai-init --unlock-session --session <id> [--owner <name>] [--force] [--json]\n');
    process.exitCode = 2;
    return;
  }

  const result = releaseSessionLock(
    {
      sessionId,
      owner: getArgValue('--owner') ?? undefined,
      force
    },
    root
  );
  emitCliMutationOutcome(result, 'unlocked', `${sessionId} released`);
}

function buildScopeHolders(unfinishedTable: AgentSession[], activeLocks: ActiveSessionLockEntry[], currentRoot: string): ConflictCandidate[] {
  return [
    ...tableSessionsToCandidates(unfinishedTable, currentRoot),
    ...lockEntriesToCandidates(activeLocks)
  ];
}

function formatHolderCollision(
  left: ConflictCandidate,
  leftScope: string,
  right: ConflictCandidate,
  rightScope: string,
  currentRoot: string
): string {
  const base = `${left.id} (${normalizeScopePath(leftScope)}) conflicts with ${right.id} (${normalizeScopePath(rightScope)})`;
  if (left.source === 'sessions_table' && right.source === 'sessions_table') return base;
  const leftWt = formatWorktreeRelation(left.worktree, currentRoot);
  const rightWt = formatWorktreeRelation(right.worktree, currentRoot);
  return `${base} [owner: ${left.owner} (branch: ${left.branch ?? 'unknown'}, ${leftWt}) vs ${right.owner} (branch: ${right.branch ?? 'unknown'}, ${rightWt})]`;
}

function findFirstOverlappingPair(
  left: ConflictCandidate,
  right: ConflictCandidate,
  currentRoot: string
): string | null {
  if (left.id === right.id) return null;
  for (const leftScope of left.writeScope) {
    const overlappingScope = right.writeScope.find((rightScope) => scopesOverlap(leftScope, rightScope));
    if (overlappingScope) {
      return formatHolderCollision(left, leftScope, right, overlappingScope, currentRoot);
    }
  }
  return null;
}

function detectHolderCollisions(holders: ConflictCandidate[], currentRoot: string): string[] {
  const messages: string[] = [];
  for (let leftIndex = 0; leftIndex < holders.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < holders.length; rightIndex += 1) {
      const collision = findFirstOverlappingPair(holders[leftIndex], holders[rightIndex], currentRoot);
      if (collision) messages.push(collision);
    }
  }
  return messages;
}

function printTableAndLockRows(
  sessions: AgentSession[],
  inspected: InspectedSessionLocks,
  recovered: StaleSessionLockEntry[],
  currentRoot: string
): void {
  for (const rec of recovered) {
    console.log(formatStatus('recovered', `${rec.lock.session_id} stale lock removed (${rec.reason})`));
  }
  for (const session of sessions) {
    const writeScope = session.writeScope.length > 0 ? session.writeScope.join(', ') : 'missing';
    const status = isUnfinishedSession(session) ? 'active' : 'closed';
    console.log(formatStatus(status, `${session.id} ${session.status || 'unknown'} write: ${writeScope}`));
  }
  for (const entry of inspected.active) {
    const wt = formatWorktreeRelation(entry.lock.worktree, currentRoot);
    console.log(
      formatStatus(
        'locked',
        `${entry.lock.session_id} active write: ${entry.lock.write_scope.join(', ')} (owner: ${entry.lock.owner}, branch: ${entry.lock.branch ?? 'unknown'}, worktree: ${wt}, expires: ${entry.lock.expires_at})`
      )
    );
  }
  for (const entry of inspected.stale) {
    const wt = formatWorktreeRelation(entry.lock.worktree, currentRoot);
    console.log(
      formatStatus(
        'stale',
        `${entry.lock.session_id} (${entry.reason}) write: ${entry.lock.write_scope.join(', ')} (owner: ${entry.lock.owner}, branch: ${entry.lock.branch ?? 'unknown'}, worktree: ${wt})`
      )
    );
  }
  for (const entry of inspected.corrupt) {
    console.log(formatStatus('invalid', `lock ${entry.fileName}: ${entry.detail}`));
  }
  if (inspected.stale.length > 0) {
    console.log(formatStatus('recover', 'run forgeai-init --check-sessions --recover-stale to clean stale locks'));
  }
}

function hasAnyLockEntries(inspected: InspectedSessionLocks, recovered: StaleSessionLockEntry[]): boolean {
  return [inspected.active.length, inspected.stale.length, inspected.corrupt.length, recovered.length].some((n) => n > 0);
}

function reportMissingSessionsFile(jsonMode: boolean): void {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'missing .ai/state/sessions.md' }, null, 2)}\n`);
  } else {
    console.log('ForgeAI session check\n');
    console.log(formatStatus('missing', '.ai/state/sessions.md'));
    console.log('\nResult: session coordination file missing. Run forgeai-init --upgrade to install it.');
  }
  process.exitCode = 1;
}

function renderCheckSessionsHuman(
  sessions: AgentSession[],
  unfinished: AgentSession[],
  inspected: InspectedSessionLocks,
  recovered: StaleSessionLockEntry[],
  missingWriteScopes: AgentSession[],
  collisions: string[],
  hasProblems: boolean
): void {
  console.log('ForgeAI session check\n');
  if (sessions.length === 0 && !hasAnyLockEntries(inspected, recovered)) {
    console.log(formatStatus('ok', 'no real sessions recorded'));
    console.log('\nResult: no active session overlap detected.');
    return;
  }

  printTableAndLockRows(sessions, inspected, recovered, root);
  for (const session of missingWriteScopes) {
    console.log(formatStatus('invalid', `${session.id} has no write scope`));
  }
  for (const message of collisions) {
    console.log(formatStatus('overlap', message));
  }

  console.log('');
  if (hasProblems) {
    console.log('Result: active sessions need coordination before parallel agent work continues.');
    process.exitCode = 1;
    return;
  }
  if (unfinished.length === 0 && inspected.active.length === 0) {
    console.log('Result: no active sessions.');
    return;
  }
  console.log('Result: active sessions have disjoint write scopes.');
}

export function runCheckSessions(): void {
  const jsonMode = args.has('--json');
  const recovered = recoverStale ? recoverStaleSessionLocks(root) : [];
  const inspected = inspectSessionLocks(root);
  const sessionsPath = path.join(root, '.ai', 'state', 'sessions.md');

  if (!fs.existsSync(sessionsPath) && !hasAnyLockEntries(inspected, recovered)) {
    reportMissingSessionsFile(jsonMode);
    return;
  }

  const sessions = fs.existsSync(sessionsPath) ? parseSessionTable(fs.readFileSync(sessionsPath, 'utf8')) : [];
  const unfinished = sessions.filter(isUnfinishedSession);
  const holders = buildScopeHolders(unfinished, inspected.active, root);
  const collisions = detectHolderCollisions(holders, root);
  const missingWriteScopes = unfinished.filter((s) => s.writeScope.length === 0);
  const hasProblems = [missingWriteScopes.length, collisions.length, inspected.stale.length, inspected.corrupt.length].some((n) => n > 0);

  if (jsonMode) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: !hasProblems,
          active_sessions: unfinished,
          active_locks: inspected.active.map((a) => a.lock),
          stale_locks: inspected.stale.map((s) => ({ lock: s.lock, reason: s.reason })),
          recovered_locks: recovered.map((r) => ({ lock: r.lock, reason: r.reason })),
          corrupt_locks: inspected.corrupt,
          overlaps: collisions
        },
        null,
        2
      )}\n`
    );
    if (hasProblems) process.exitCode = 1;
    return;
  }

  renderCheckSessionsHuman(sessions, unfinished, inspected, recovered, missingWriteScopes, collisions, hasProblems);
}
