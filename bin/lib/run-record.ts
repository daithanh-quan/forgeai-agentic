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

// Returns true when `raw` is a structurally valid run record for reading.
// Intentionally NOT a `raw is RunRecord` predicate: a pre-12B record may omit
// `retry_count`, which does not satisfy the RunRecord type until normalized in
// listRunRecords. Returning boolean keeps the predicate honest.
function isValidRunRecordInput(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (r['kind'] !== 'forgeai_run_record') return false;
  if (r['schema_version'] !== 1) return false;
  if (typeof r['run_id'] !== 'string' || typeof r['timestamp'] !== 'string') return false;
  if (typeof r['adapter'] !== 'string' || typeof r['artifact'] !== 'string' || typeof r['objective'] !== 'string') return false;
  if (typeof r['model'] !== 'string') return false;
  if (!VALID_PROVIDERS_REC.has(r['provider'] as string)) return false;
  if (!VALID_OUTCOMES_REC.has(r['outcome'] as string)) return false;
  if (typeof r['latency_ms'] !== 'number' || !Number.isFinite(r['latency_ms'] as number) || (r['latency_ms'] as number) < 0) return false;
  for (const field of ['input_tokens', 'output_tokens', 'cached_tokens']) {
    const v = r[field];
    if (v !== null && !(Number.isInteger(v) && (v as number) >= 0)) return false;
  }
  const hs = r['http_status'];
  if (hs !== null && !(Number.isInteger(hs) && (hs as number) >= 100 && (hs as number) <= 599)) return false;
  if (!Number.isInteger(r['budget_tokens']) || (r['budget_tokens'] as number) < 0) return false;
  if (!Number.isInteger(r['estimated_tokens']) || (r['estimated_tokens'] as number) < 0) return false;
  if (r['error'] !== null && typeof r['error'] !== 'string') return false;
  const parsedTs = new Date(r['timestamp'] as string);
  if (Number.isNaN(parsedTs.getTime()) || parsedTs.toISOString() !== r['timestamp']) return false;
  const rc = r['retry_count'];
  if (rc !== undefined && !(Number.isInteger(rc) && (rc as number) >= 0)) return false;
  return true;
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

  const records: RunRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (isValidRunRecordInput(raw)) {
        const r = raw as Record<string, unknown>;
        records.push({ ...(r as unknown as RunRecord), retry_count: (r['retry_count'] as number | undefined) ?? 0 });
      }
    } catch {
      // skip malformed
    }
  }

  return records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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
    const tokens = r.input_tokens !== null
      ? `in=${r.input_tokens} out=${r.output_tokens} cached=${r.cached_tokens ?? 0}`
      : 'tokens=unknown';
    console.log(
      formatStatus(
        r.outcome === 'ok' ? 'ok' : 'invalid',
        `${r.run_id}  ${r.provider}/${r.model}  ${r.outcome}  ${tokens}  ${r.latency_ms}ms`
      )
    );
  }
}
