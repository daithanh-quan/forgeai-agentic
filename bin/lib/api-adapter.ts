import fs from 'node:fs';
import path from 'node:path';
import type { ApiAdapterConfig, ApiAdapterEntry, ApiCallResult, CompiledContextArtifact, RunRecord } from './types.js';
import { callAnthropic } from './api-adapters/anthropic.js';
import { callOpenAI } from './api-adapters/openai.js';
import { callGemini } from './api-adapters/gemini.js';
import { generateRunId, writeRunRecord } from './run-record.js';
import { getErrorMessage } from './utils.js';

export const API_ADAPTERS_RELATIVE = '.ai/api-adapters.json';

const VALID_PROVIDERS = new Set(['anthropic', 'openai', 'gemini']);
const KNOWN_TOP_FIELDS = new Set(['version', 'adapters']);
const KNOWN_ENTRY_FIELDS = new Set(['provider', 'model', 'max_tokens', 'system', 'timeout_ms', 'fallback_adapter']);

export function validateApiAdaptersConfig(raw: unknown): { ok: true; config: ApiAdapterConfig } | { ok: false; detail: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, detail: 'config must be a JSON object (not an array or primitive)' };
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_FIELDS.has(key)) {
      return { ok: false, detail: `unknown top-level field "${key}" in api-adapters.json` };
    }
  }
  if ('version' in obj && obj['version'] !== 1) {
    return { ok: false, detail: `unsupported version ${String(obj['version'])}; expected 1` };
  }
  const adapters = obj['adapters'];
  if (adapters !== undefined) {
    if (typeof adapters !== 'object' || adapters === null || Array.isArray(adapters)) {
      return { ok: false, detail: 'adapters must be a plain object' };
    }
    for (const [name, entry] of Object.entries(adapters as Record<string, unknown>)) {
      if (name.length === 0) {
        return { ok: false, detail: 'adapter name must not be empty' };
      }
      if (typeof entry !== 'object' || entry === null) {
        return { ok: false, detail: `adapter "${name}" must be an object` };
      }
      const e = entry as Record<string, unknown>;
      for (const key of Object.keys(e)) {
        if (!KNOWN_ENTRY_FIELDS.has(key)) {
          return { ok: false, detail: `adapter "${name}" has unknown field "${key}"` };
        }
      }
      if (typeof e['provider'] !== 'string') {
        return { ok: false, detail: `adapter "${name}" must have a string provider` };
      }
      if (!VALID_PROVIDERS.has(e['provider'] as string)) {
        return { ok: false, detail: `adapter "${name}" has unknown provider "${String(e['provider'])}"; expected one of: ${[...VALID_PROVIDERS].join(', ')}` };
      }
      const m = e['model'];
      if (typeof m !== 'string' || m.trim().length === 0 || m !== m.trim()) {
        return { ok: false, detail: `adapter "${name}" model must be a non-empty string without surrounding whitespace` };
      }
      if (e['system'] !== undefined && typeof e['system'] !== 'string') {
        return { ok: false, detail: `adapter "${name}" system must be a string` };
      }
      if (e['max_tokens'] !== undefined) {
        if (typeof e['max_tokens'] !== 'number' || !Number.isInteger(e['max_tokens']) || (e['max_tokens'] as number) <= 0) {
          return { ok: false, detail: `adapter "${name}" max_tokens must be a positive integer` };
        }
        if ((e['max_tokens'] as number) > 65536) {
          return { ok: false, detail: `adapter "${name}" max_tokens exceeds maximum of 65536` };
        }
      }
      if (e['timeout_ms'] !== undefined) {
        if (typeof e['timeout_ms'] !== 'number' || !Number.isInteger(e['timeout_ms']) || (e['timeout_ms'] as number) <= 0) {
          return { ok: false, detail: `adapter "${name}" timeout_ms must be a positive integer` };
        }
        if ((e['timeout_ms'] as number) > 600000) {
          return { ok: false, detail: `adapter "${name}" timeout_ms exceeds maximum of 600000` };
        }
      }
      if (e['fallback_adapter'] !== undefined) {
        const fb = e['fallback_adapter'];
        if (typeof fb !== 'string' || fb.trim().length === 0 || fb !== fb.trim()) {
          return { ok: false, detail: `adapter "${name}" fallback_adapter must be a non-empty string without surrounding whitespace` };
        }
      }
    }
  }
  return { ok: true, config: raw as ApiAdapterConfig };
}

export function loadApiAdapters(repositoryRoot: string): { ok: true; config: ApiAdapterConfig } | { ok: false; detail: string } | null {
  const filePath = path.join(repositoryRoot, API_ADAPTERS_RELATIVE);
  if (!fs.existsSync(filePath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { ok: false, detail: `cannot parse ${API_ADAPTERS_RELATIVE}: ${getErrorMessage(err)}` };
  }
  return validateApiAdaptersConfig(raw);
}

async function dispatchProvider(
  artifact: CompiledContextArtifact,
  entry: ApiAdapterEntry
): Promise<ApiCallResult> {
  switch (entry.provider) {
    case 'anthropic': return callAnthropic(artifact, entry);
    case 'openai':    return callOpenAI(artifact, entry);
    case 'gemini':    return callGemini(artifact, entry);
    default:
      return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'provider', retryable: false, error: `unknown provider: ${(entry as { provider: string }).provider}` };
  }
}

export async function callApiAdapter(
  adapterName: string,
  artifact: CompiledContextArtifact,
  artifactPath: string,
  repositoryRoot: string,
  modelOverride: string | null = null
): Promise<{ result: ApiCallResult; record: RunRecord | null }> {
  const loaded = loadApiAdapters(repositoryRoot);

  if (loaded !== null && !loaded.ok) {
    const err = `invalid ${API_ADAPTERS_RELATIVE}: ${loaded.detail}`;
    const result: ApiCallResult = { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'provider', retryable: false, error: err };
    return { result, record: null };
  }

  const adapterMap = loaded?.ok ? loaded.config.adapters : undefined;
  const entry = adapterMap !== undefined && Object.hasOwn(adapterMap, adapterName) ? adapterMap[adapterName] : undefined;
  if (!entry) {
    const err = `API adapter '${adapterName}' not found in ${API_ADAPTERS_RELATIVE}`;
    const result: ApiCallResult = { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'provider', retryable: false, error: err };
    return { result, record: null };
  }

  const effectiveModel = modelOverride ?? entry.model;
  let result: ApiCallResult;
  try {
    result = await dispatchProvider(artifact, { ...entry, model: effectiveModel });
  } catch (err) {
    result = { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'provider', retryable: false, error: getErrorMessage(err) };
  }

  const outcome: RunRecord['outcome'] = result.ok ? 'ok' : result.error_kind === 'quota' ? 'quota' : result.error_kind === 'auth' ? 'auth' : 'error';
  const record: RunRecord = {
    schema_version: 1, kind: 'forgeai_run_record',
    run_id: generateRunId(), timestamp: new Date().toISOString(),
    adapter: adapterName, provider: entry.provider, model: effectiveModel,
    artifact: artifactPath, objective: artifact.objective,
    budget_tokens: artifact.budget.limit_tokens, estimated_tokens: artifact.budget.estimated_tokens,
    input_tokens: result.input_tokens, output_tokens: result.output_tokens,
    cached_tokens: result.cached_tokens, latency_ms: result.latency_ms,
    http_status: result.http_status, outcome, error: result.error,
  };
  writeRunRecord(record, repositoryRoot);
  return { result, record };
}
