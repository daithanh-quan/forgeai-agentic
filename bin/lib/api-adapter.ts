import fs from 'node:fs';
import path from 'node:path';
import type {
  ApiAdapterConfig,
  ApiAdapterEntry,
  ApiCallResult,
  CodeModeOptions,
  CompiledContextArtifact,
  RunRecord
} from './types.js';
import { callAnthropic } from './api-adapters/anthropic.js';
import { callOpenAI } from './api-adapters/openai.js';
import { callGemini } from './api-adapters/gemini.js';
import { generateRunId, writeRunRecord } from './run-record.js';
import { getErrorMessage } from './utils.js';
import { emitRunEvent, nowSeconds, type RunEvent } from './run-events.js';

export const API_ADAPTERS_RELATIVE = '.ai/api-adapters.json';

export type CallApiAdapterOptions = {
  stream?: boolean;
  onDelta?: (text: string) => void;
  codeMode?: boolean;
  codeModeOptions?: CodeModeOptions;
  dispatch?: (
    artifact: CompiledContextArtifact,
    entry: ApiAdapterEntry,
    onDelta?: (t: string) => void,
    codeModeOptions?: CodeModeOptions
  ) => Promise<ApiCallResult>;
  sleep?: (ms: number) => Promise<void>;
  emitEvent?: (event: RunEvent) => void;
  now?: () => number;
};

const VALID_PROVIDERS = new Set(['anthropic', 'openai', 'gemini']);
const KNOWN_TOP_FIELDS = new Set(['version', 'adapters']);
const KNOWN_ENTRY_FIELDS = new Set([
  'provider',
  'model',
  'max_tokens',
  'reasoning_effort',
  'thinking_budget',
  'thinking_level',
  'system',
  'timeout_ms',
  'fallback_adapter',
  'max_retries',
  'retry_base_ms',
  'code_mode',
  'max_tool_rounds'
]);
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTrimmedNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function validateBoundedPositiveInt(
  name: string,
  field: string,
  value: unknown,
  max: number
): string | null {
  if (value === undefined) return null;
  if (!isPositiveInt(value)) return `adapter "${name}" ${field} must be a positive integer`;
  if (value > max) return `adapter "${name}" ${field} exceeds maximum of ${max}`;
  return null;
}

function validateEntryCoreFields(name: string, e: Record<string, unknown>): string | null {
  const unknown = Object.keys(e).find((key) => !KNOWN_ENTRY_FIELDS.has(key));
  if (unknown) return `adapter "${name}" has unknown field "${unknown}"`;
  if (typeof e['provider'] !== 'string') return `adapter "${name}" must have a string provider`;
  if (!VALID_PROVIDERS.has(e['provider'])) {
    return `adapter "${name}" has unknown provider "${e['provider']}"; expected one of: ${[...VALID_PROVIDERS].join(', ')}`;
  }
  if (!isTrimmedNonEmptyString(e['model'])) {
    return `adapter "${name}" model must be a non-empty string without surrounding whitespace`;
  }
  if (e['system'] !== undefined && typeof e['system'] !== 'string') {
    return `adapter "${name}" system must be a string`;
  }
  if (e['fallback_adapter'] !== undefined && !isTrimmedNonEmptyString(e['fallback_adapter'])) {
    return `adapter "${name}" fallback_adapter must be a non-empty string without surrounding whitespace`;
  }
  return null;
}

function validateProviderEnumField(
  name: string,
  e: Record<string, unknown>,
  field: string,
  expectedProvider: string,
  allowedValues: Set<string>
): string | null {
  const val = e[field];
  if (val === undefined) return null;
  if (e['provider'] !== expectedProvider) {
    return `adapter "${name}" ${field} is only valid for provider "${expectedProvider}"`;
  }
  if (typeof val !== 'string' || !allowedValues.has(val)) {
    return `adapter "${name}" ${field} must be one of: ${[...allowedValues].join(', ')}`;
  }
  return null;
}

function isIntInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function validateThinkingBudgetField(name: string, e: Record<string, unknown>): string | null {
  const budget = e['thinking_budget'];
  if (budget === undefined) return null;
  if (e['provider'] !== 'gemini') return `adapter "${name}" thinking_budget is only valid for provider "gemini"`;
  return isIntInRange(budget, -1, 32768) ? null : `adapter "${name}" thinking_budget must be an integer from -1 to 32768`;
}

function validateThinkingOptions(name: string, e: Record<string, unknown>): string | null {
  const err = validateThinkingBudgetField(name, e) ?? validateProviderEnumField(name, e, 'thinking_level', 'gemini', THINKING_LEVELS);
  if (err) return err;
  if (e['thinking_budget'] !== undefined && e['thinking_level'] !== undefined) {
    return `adapter "${name}" cannot set both thinking_budget and thinking_level`;
  }
  return null;
}

function validateMaxRetriesField(name: string, retries: unknown): string | null {
  if (retries === undefined) return null;
  if (typeof retries !== 'number' || !Number.isInteger(retries) || retries < 0) {
    return `adapter "${name}" max_retries must be a non-negative integer`;
  }
  return retries > 5 ? `adapter "${name}" max_retries exceeds maximum of 5` : null;
}

function validateCodeModeEntryFields(name: string, e: Record<string, unknown>): string | null {
  if (e['code_mode'] !== undefined && typeof e['code_mode'] !== 'boolean') {
    return `adapter "${name}" code_mode must be a boolean`;
  }
  const rounds = e['max_tool_rounds'];
  return rounds === undefined || isIntInRange(rounds, 1, 10)
    ? null
    : `adapter "${name}" max_tool_rounds must be an integer from 1 to 10`;
}

function validateSingleAdapterEntry(name: string, entry: unknown): string | null {
  if (name.length === 0) return 'adapter name must not be empty';
  if (typeof entry !== 'object' || entry === null) return `adapter "${name}" must be an object`;
  const e = entry as Record<string, unknown>;
  const checks = [
    validateEntryCoreFields(name, e),
    validateBoundedPositiveInt(name, 'max_tokens', e['max_tokens'], 65536),
    validateProviderEnumField(name, e, 'reasoning_effort', 'openai', REASONING_EFFORTS),
    validateThinkingOptions(name, e),
    validateBoundedPositiveInt(name, 'timeout_ms', e['timeout_ms'], 600000),
    validateMaxRetriesField(name, e['max_retries']),
    validateBoundedPositiveInt(name, 'retry_base_ms', e['retry_base_ms'], 30000),
    validateCodeModeEntryFields(name, e)
  ];
  return checks.find((err): err is string => err !== null) ?? null;
}

export function validateApiAdaptersConfig(
  raw: unknown
): { ok: true; config: ApiAdapterConfig } | { ok: false; detail: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, detail: 'config must be a JSON object (not an array or primitive)' };
  }
  const unknownTop = Object.keys(raw).find((key) => !KNOWN_TOP_FIELDS.has(key));
  if (unknownTop) return { ok: false, detail: `unknown top-level field "${unknownTop}" in api-adapters.json` };
  if ('version' in raw && raw['version'] !== 1) {
    return { ok: false, detail: `unsupported version ${String(raw['version'])}; expected 1` };
  }
  const adapters = raw['adapters'];
  if (adapters === undefined) return { ok: true, config: raw as ApiAdapterConfig };
  if (!isPlainObject(adapters)) return { ok: false, detail: 'adapters must be a plain object' };
  for (const [name, entry] of Object.entries(adapters)) {
    const err = validateSingleAdapterEntry(name, entry);
    if (err) return { ok: false, detail: err };
  }
  return { ok: true, config: raw as ApiAdapterConfig };
}

export function loadApiAdapters(
  repositoryRoot: string
): { ok: true; config: ApiAdapterConfig } | { ok: false; detail: string } | null {
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

function makeProviderErrorResult(error: string): ApiCallResult {
  return {
    ok: false,
    text: null,
    input_tokens: null,
    output_tokens: null,
    cached_tokens: null,
    latency_ms: 0,
    http_status: null,
    error_kind: 'provider',
    retryable: false,
    streamed: false,
    retry_count: 0,
    error
  };
}

async function dispatchProvider(
  artifact: CompiledContextArtifact,
  entry: ApiAdapterEntry,
  onDelta?: (t: string) => void,
  codeModeOptions?: CodeModeOptions
): Promise<ApiCallResult> {
  if (entry.provider === 'anthropic') return callAnthropic(artifact, entry, fetch, onDelta, codeModeOptions);
  if (entry.provider === 'openai') return callOpenAI(artifact, entry, fetch, onDelta, codeModeOptions);
  if (entry.provider === 'gemini') return callGemini(artifact, entry, fetch, onDelta, codeModeOptions);
  return makeProviderErrorResult(`unknown provider: ${(entry as { provider: string }).provider}`);
}

function resolveLoadedAdapterEntry(
  adapterName: string,
  repositoryRoot: string
): { ok: true; entry: ApiAdapterEntry } | { ok: false; error: string } {
  const loaded = loadApiAdapters(repositoryRoot);
  if (loaded !== null && !loaded.ok) {
    return { ok: false, error: `invalid ${API_ADAPTERS_RELATIVE}: ${loaded.detail}` };
  }
  const adapterMap = loaded?.ok ? loaded.config.adapters : undefined;
  const entry = adapterMap && Object.hasOwn(adapterMap, adapterName) ? adapterMap[adapterName] : undefined;
  if (!entry) return { ok: false, error: `API adapter '${adapterName}' not found in ${API_ADAPTERS_RELATIVE}` };
  return { ok: true, entry };
}

function classifyRunOutcome(result: ApiCallResult): RunRecord['outcome'] {
  if (result.ok) return 'ok';
  if (result.error_kind === 'quota') return 'quota';
  if (result.error_kind === 'auth') return 'auth';
  return 'error';
}

function buildRunRecord(
  adapterName: string,
  entry: ApiAdapterEntry,
  effectiveModel: string,
  artifact: CompiledContextArtifact,
  artifactPath: string,
  result: ApiCallResult
): RunRecord {
  const outcome = classifyRunOutcome(result);
  const record: RunRecord = {
    schema_version: 1,
    kind: 'forgeai_run_record',
    run_id: generateRunId(),
    timestamp: new Date().toISOString(),
    adapter: adapterName,
    provider: entry.provider,
    model: effectiveModel,
    artifact: artifactPath,
    objective: artifact.objective,
    task_id: artifact.task_id ?? null,
    mode: artifact.mode ?? 'compact',
    budget_tokens: artifact.budget.limit_tokens,
    estimated_tokens: artifact.budget.estimated_tokens,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    cached_tokens: result.cached_tokens,
    latency_ms: result.latency_ms,
    http_status: result.http_status,
    outcome,
    retry_count: result.retry_count,
    error: result.error
  };
  if (result.code_mode) {
    record.code_mode = true;
    record.tool_rounds = result.tool_rounds ?? 0;
    record.sandbox_operations = result.sandbox_operations ?? [];
  }
  return record;
}

function shouldRetryCallResult(result: ApiCallResult, attempt: number, maxRetries: number): boolean {
  if (result.ok || result.streamed) return false;
  return result.retryable && attempt < maxRetries;
}

function resolveDispatchCallbacks(options: CallApiAdapterOptions) {
  return {
    dispatch: options.dispatch ?? dispatchProvider,
    sleep: options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    emit: options.emitEvent ?? emitRunEvent,
    now: options.now ?? Date.now,
    onDelta: options.stream ? options.onDelta : undefined
  };
}

async function runDispatchWithRetries(
  adapterName: string,
  artifact: CompiledContextArtifact,
  dispatchEntry: ApiAdapterEntry,
  codeModeOpts: CodeModeOptions | undefined,
  options: CallApiAdapterOptions
): Promise<ApiCallResult> {
  const { dispatch, sleep, emit, now, onDelta } = resolveDispatchCallbacks(options);
  const maxRetries = dispatchEntry.max_retries ?? 2;
  const baseMs = dispatchEntry.retry_base_ms ?? 500;
  const startWall = now();
  let attempt = 0;

  for (;;) {
    let result: ApiCallResult;
    try {
      result = await dispatch(artifact, dispatchEntry, onDelta, codeModeOpts);
    } catch (err) {
      result = makeProviderErrorResult(getErrorMessage(err));
    }
    if (!shouldRetryCallResult(result, attempt, maxRetries)) {
      return { ...result, retry_count: attempt, latency_ms: now() - startWall };
    }
    const delayMs = baseMs * 2 ** attempt;
    emit({
      type: 'retry_attempt',
      ts: nowSeconds(),
      adapter: adapterName,
      attempt: attempt + 1,
      error_kind: result.error_kind ?? 'error',
      delay_ms: delayMs
    });
    await sleep(delayMs);
    attempt += 1;
  }
}

export async function callApiAdapter(
  adapterName: string,
  artifact: CompiledContextArtifact,
  artifactPath: string,
  repositoryRoot: string,
  modelOverride: string | null = null,
  options: CallApiAdapterOptions = {}
): Promise<{ result: ApiCallResult; record: RunRecord | null }> {
  const resolved = resolveLoadedAdapterEntry(adapterName, repositoryRoot);
  if (!resolved.ok) {
    return { result: makeProviderErrorResult(resolved.error), record: null };
  }
  const { entry } = resolved;
  const emit = options.emitEvent ?? emitRunEvent;
  const effectiveModel = modelOverride ?? entry.model;
  const useCodeMode = Boolean(options.codeMode || entry.code_mode);
  const codeModeOpts = useCodeMode
    ? { repositoryRoot, primaryArtifact: artifact, ...options.codeModeOptions }
    : undefined;
  const dispatchEntry: ApiAdapterEntry = {
    ...entry,
    model: effectiveModel,
    ...(useCodeMode ? { code_mode: true } : {})
  };
  const truncatedObjective = artifact.objective.length > 200
    ? `${artifact.objective.slice(0, 200)}…`
    : artifact.objective;

  emit({
    type: 'run_start',
    ts: nowSeconds(),
    adapter: adapterName,
    provider: entry.provider,
    model: effectiveModel,
    objective: truncatedObjective,
    budget_tokens: artifact.budget.limit_tokens
  });

  const result = await runDispatchWithRetries(adapterName, artifact, dispatchEntry, codeModeOpts, options);
  const record = buildRunRecord(adapterName, entry, effectiveModel, artifact, artifactPath, result);
  writeRunRecord(record, repositoryRoot);
  emit({
    type: 'run_complete',
    ts: nowSeconds(),
    adapter: adapterName,
    outcome: record.outcome,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    latency_ms: result.latency_ms,
    retry_count: result.retry_count
  });
  return { result, record };
}
