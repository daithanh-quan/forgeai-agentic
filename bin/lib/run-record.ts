import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { RunRecord } from './types.js';
import { root } from './context.js';
import { formatStatus } from './utils.js';

const RUNS_DIR = '.ai/state/runs';

export function generateRunId(): string {
  const ts = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  return `run-${ts}-${crypto.randomUUID()}`;
}

export function writeRunRecord(record: RunRecord, repositoryRoot: string): void {
  try {
    const dir = path.join(repositoryRoot, RUNS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${record.run_id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${formatStatus('warn', `could not write run record: ${String(err)}`)}\n`);
  }
}

const VALID_PROVIDERS_REC = new Set(['anthropic', 'openai', 'gemini']);
const VALID_OUTCOMES_REC = new Set(['ok', 'quota', 'auth', 'error']);

function isNonNegativeInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNullableNonNegativeInt(value: unknown): boolean {
  return value === null || isNonNegativeInt(value);
}

function isIsoTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function hasValidIdentityFields(r: Record<string, unknown>): boolean {
  if (r['kind'] !== 'forgeai_run_record' || r['schema_version'] !== 1) return false;
  const strFields = ['run_id', 'adapter', 'artifact', 'objective'] as const;
  if (strFields.some((k) => typeof r[k] !== 'string')) return false;
  const model = r['model'];
  if (typeof model !== 'string' || model.trim().length === 0) return false;
  return VALID_PROVIDERS_REC.has(String(r['provider'])) && VALID_OUTCOMES_REC.has(String(r['outcome']));
}

function isValidHttpStatusField(hs: unknown): boolean {
  if (hs === null) return true;
  return isNonNegativeInt(hs) && (hs as number) >= 100 && (hs as number) <= 599;
}

function hasValidMetricFields(r: Record<string, unknown>): boolean {
  const lat = r['latency_ms'];
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < 0) return false;
  const tokenFields = ['input_tokens', 'output_tokens', 'cached_tokens'] as const;
  if (tokenFields.some((f) => !isNullableNonNegativeInt(r[f]))) return false;
  if (!isValidHttpStatusField(r['http_status'])) return false;
  return isNonNegativeInt(r['budget_tokens']) && isNonNegativeInt(r['estimated_tokens']);
}

function isValidOptionalTaskId(tid: unknown): boolean {
  if (tid === undefined || tid === null) return true;
  return typeof tid === 'string' && tid.length > 0;
}

function isValidOptionalMode(md: unknown): boolean {
  return md === undefined || md === null || md === 'baseline' || md === 'compact';
}

function hasValidOptionalFields(r: Record<string, unknown>): boolean {
  if (r['error'] !== null && typeof r['error'] !== 'string') return false;
  const rc = r['retry_count'];
  if (rc !== undefined && !isNonNegativeInt(rc)) return false;
  return isValidOptionalTaskId(r['task_id']) && isValidOptionalMode(r['mode']);
}

function isValidCodeModeRunFields(r: Record<string, unknown>): boolean {
  if (r['code_mode'] !== undefined && typeof r['code_mode'] !== 'boolean') return false;
  const rounds = r['tool_rounds'];
  if (rounds !== undefined && !isNonNegativeInt(rounds)) return false;
  const ops = r['sandbox_operations'];
  return ops === undefined || (Array.isArray(ops) && ops.every((item) => typeof item === 'string'));
}

function isValidRunRecordInput(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (!hasValidIdentityFields(r) || !isIsoTimestamp(r['timestamp'])) return false;
  if (!hasValidMetricFields(r) || !hasValidOptionalFields(r)) return false;
  return isValidCodeModeRunFields(r);
}

function parseRunRecordFile(filePath: string): RunRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isValidRunRecordInput(raw)) return null;
    const r = raw as Record<string, unknown>;
    return {
      ...(r as unknown as RunRecord),
      retry_count: (r['retry_count'] as number | undefined) ?? 0,
      task_id: (r['task_id'] as string | null | undefined) ?? null,
      mode: (r['mode'] as RunRecord['mode'] | undefined) ?? 'compact',
    };
  } catch {
    return null;
  }
}

export function listRunRecords(repositoryRoot: string): RunRecord[] {
  const dir = path.join(repositoryRoot, RUNS_DIR);
  if (!fs.existsSync(dir)) return [];

  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    process.stderr.write(`${formatStatus('warn', `cannot read runs directory (${dir}): ${String(err)}`)}\n`);
    return [];
  }

  const records = names
    .filter((name) => name.endsWith('.json'))
    .map((name) => parseRunRecordFile(path.join(dir, name)))
    .filter((rec): rec is RunRecord => rec !== null);

  return records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function formatRunRecordLine(r: RunRecord): string {
  const tokens = r.input_tokens !== null
    ? `in=${r.input_tokens} out=${r.output_tokens} cached=${r.cached_tokens ?? 0}`
    : 'tokens=unknown';
  const status = r.outcome === 'ok' ? 'ok' : 'invalid';
  return formatStatus(status, `${r.run_id}  ${r.provider}/${r.model}  ${r.outcome}  ${tokens}  ${r.latency_ms}ms`);
}

export function runListRuns(): void {
  const records = listRunRecords(root);
  if (records.length === 0) {
    console.log(formatStatus('ok', `${RUNS_DIR} has no run records`));
    return;
  }
  console.log(`Run records (${records.length} total)`);
  console.log('');
  for (const r of records) {
    console.log(formatRunRecordLine(r));
  }
}
