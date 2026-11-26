import { executeCodeMode, getForgeAiCodeModeDts } from '../code-mode.js';
import { emitRunEvent, nowSeconds } from '../run-events.js';
import { parseSSE } from './sse.js';
import type {
  ApiAdapterEntry,
  ApiCallResult,
  CodeModeOptions,
  CodeModeResult,
  CompiledContextArtifact
} from '../types.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MAX_ROUNDS = 4;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 120_000;

const DEFAULT_CODE_MODE_SYSTEM =
  'You are a software engineering agent with access to the forgeai_code tool. ' +
  'Use forgeai_code to query/expand bounded context, check code quality, or edit files within the allowed write scope in a single script before returning your final response.';

export function buildForgeAiCodeToolSchema() {
  return {
    name: 'forgeai_code',
    description:
      `Execute a JavaScript Code Mode script in the bounded ForgeAI sandbox to inspect/expand context, query the dependency graph, check code quality, or edit files within the allowed write scope.\n\n${getForgeAiCodeModeDts()}`,
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code using the global forgeai object.'
        }
      },
      required: ['code']
    }
  } as const;
}

export function optionalTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

type TokenAccumulator = {
  input: number | null;
  output: number | null;
  cached: number | null;
  toolRounds: number;
  operations: string[];
};

function addTokenCount(current: number | null, next: unknown): number | null {
  const valid = typeof next === 'number' && Number.isInteger(next) && next >= 0;
  if (!valid) return current;
  return (current ?? 0) + (next as number);
}

function accumulateUsage(totals: TokenAccumulator, input: unknown, output: unknown, cached: unknown): void {
  totals.input = addTokenCount(totals.input, input);
  totals.output = addTokenCount(totals.output, output);
  totals.cached = addTokenCount(totals.cached, cached);
}

function recordSandboxStep(totals: TokenAccumulator, round: number, outcomes: CodeModeResult[]): void {
  const ops = outcomes.flatMap((o) => o.operations);
  const changed = [...new Set(outcomes.flatMap((o) => o.changed_files))].sort();
  const allOk = outcomes.every((o) => o.ok);
  totals.toolRounds += 1;
  totals.operations.push(...ops);
  emitRunEvent({
    type: 'code_mode_step',
    ts: nowSeconds(),
    round,
    operations: ops,
    changed_files: changed,
    ok: allOk
  });
}

export function buildProviderFailure(
  start: number,
  status: number | null,
  kind: ApiCallResult['error_kind'],
  retryable: boolean,
  error: string,
  streamed = false,
  codeMode = false
): ApiCallResult {
  const res: ApiCallResult = {
    ok: false,
    text: null,
    input_tokens: null,
    output_tokens: null,
    cached_tokens: null,
    latency_ms: Date.now() - start,
    http_status: status,
    error_kind: kind,
    retryable: streamed ? false : retryable,
    streamed,
    retry_count: 0,
    error
  };
  if (codeMode) res.code_mode = true;
  return res;
}

export function buildBufferedSuccess(
  start: number,
  status: number,
  text: string,
  tokens: { input: number | null; output: number | null; cached: number | null },
  codeModeMeta?: { toolRounds: number; operations: string[] }
): ApiCallResult {
  if (text.trim().length === 0) {
    return buildProviderFailure(
      start,
      status,
      'invalid_response',
      false,
      'response text is empty',
      false,
      Boolean(codeModeMeta)
    );
  }
  const res: ApiCallResult = {
    ok: true,
    text,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    cached_tokens: tokens.cached,
    latency_ms: Date.now() - start,
    http_status: status,
    error_kind: null,
    retryable: false,
    streamed: false,
    retry_count: 0,
    error: null
  };
  if (codeModeMeta) {
    res.code_mode = true;
    res.tool_rounds = codeModeMeta.toolRounds;
    res.sandbox_operations = codeModeMeta.operations;
  }
  return res;
}

function isRetryableStatus(status: number): boolean {
  if (status === 408) return true;
  return status >= 500 && status < 600;
}

async function classifyHttpFailure(
  response: Response,
  start: number,
  codeMode = false
): Promise<ApiCallResult | null> {
  if (response.ok) return null;
  const status = response.status;
  const detail = await response.text().catch(() => '');
  const snippet = detail.slice(0, 200);
  if (status === 401 || status === 403) {
    return buildProviderFailure(start, status, 'auth', false, `HTTP ${status}: ${snippet}`, false, codeMode);
  }
  if (status === 429) {
    return buildProviderFailure(start, status, 'quota', true, `HTTP 429: ${snippet}`, false, codeMode);
  }
  return buildProviderFailure(
    start,
    status,
    'provider',
    isRetryableStatus(status),
    `HTTP ${status}: ${snippet}`,
    false,
    codeMode
  );
}

function formatFetchError(err: unknown, timeoutMs: number): string {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return `request timed out after ${timeoutMs}ms`;
  }
  return String(err);
}

export async function sendProviderHttp(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  start: number,
  fetcher: typeof fetch,
  codeMode = false
): Promise<{ ok: true; response: Response; status: number } | { ok: false; result: ApiCallResult }> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    return {
      ok: false,
      result: buildProviderFailure(start, null, 'network', true, formatFetchError(err, timeoutMs), false, codeMode)
    };
  }
  const httpFailure = await classifyHttpFailure(response, start, codeMode);
  if (httpFailure) return { ok: false, result: httpFailure };
  return { ok: true, response, status: response.status };
}

export async function readProviderJsonBody(
  response: Response,
  timeoutMs: number,
  start: number,
  status: number,
  codeMode = false
): Promise<{ ok: true; data: unknown } | { ok: false; result: ApiCallResult }> {
  try {
    return { ok: true, data: await response.json() };
  } catch (bodyErr) {
    const name = bodyErr instanceof Error ? bodyErr.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return {
        ok: false,
        result: buildProviderFailure(start, status, 'network', true, `request timed out after ${timeoutMs}ms`, false, codeMode)
      };
    }
    return {
      ok: false,
      result: buildProviderFailure(start, status, 'invalid_response', false, 'response body is not valid JSON', false, codeMode)
    };
  }
}

async function postJsonRound(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  start: number,
  fetcher: typeof fetch
): Promise<{ ok: true; status: number; data: unknown } | { ok: false; result: ApiCallResult }> {
  const sent = await sendProviderHttp(url, headers, body, timeoutMs, start, fetcher, true);
  if (!sent.ok) return sent;
  const parsed = await readProviderJsonBody(sent.response, timeoutMs, start, sent.status, true);
  if (!parsed.ok) return parsed;
  return { ok: true, status: sent.status, data: parsed.data };
}

function isObjectRecord(item: unknown): item is Record<string, unknown> {
  return typeof item === 'object' && item !== null;
}

type ProviderRoundStep =
  | { kind: 'error'; message: string }
  | { kind: 'final'; text: string }
  | { kind: 'continue'; nextMessages: unknown[]; outcomes: CodeModeResult[] };

function finishOrContinueRound(
  codes: string[],
  text: string,
  isFinalRound: boolean,
  sandboxOptions: CodeModeOptions,
  buildNextMessages: (outcomes: CodeModeResult[]) => unknown[]
): ProviderRoundStep {
  if (codes.length === 0 || isFinalRound) {
    return { kind: 'final', text };
  }
  const outcomes = codes.map((code) => executeCodeMode(code, sandboxOptions));
  return {
    kind: 'continue',
    outcomes,
    nextMessages: buildNextMessages(outcomes)
  };
}

type CodeModeProviderDriver = {
  envVar: string;
  buildUrl: (config: ApiAdapterEntry) => string;
  buildHeaders: (apiKey: string) => Record<string, string>;
  initialMessages: (artifact: CompiledContextArtifact, config: ApiAdapterEntry) => unknown[];
  buildBody: (config: ApiAdapterEntry, messages: unknown[]) => string;
  processRound: (
    data: unknown,
    totals: TokenAccumulator,
    sandboxOptions: CodeModeOptions,
    isFinalRound: boolean
  ) => ProviderRoundStep;
};

async function executeCodeModeLoop(
  driver: CodeModeProviderDriver,
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch,
  codeModeOptions?: CodeModeOptions
): Promise<ApiCallResult> {
  const apiKey = process.env[driver.envVar];
  if (!apiKey) {
    return buildProviderFailure(
      Date.now(),
      null,
      'auth',
      false,
      `${driver.envVar} is not set; set it with: export ${driver.envVar}=<your-key>`,
      false,
      true
    );
  }
  const start = Date.now();
  const maxRounds = config.max_tool_rounds ?? DEFAULT_MAX_ROUNDS;
  const timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const sandboxOptions: CodeModeOptions = { primaryArtifact: artifact, ...codeModeOptions };
  const messages = driver.initialMessages(artifact, config);
  const totals: TokenAccumulator = { input: null, output: null, cached: null, toolRounds: 0, operations: [] };
  const headers = driver.buildHeaders(apiKey);
  const url = driver.buildUrl(config);

  for (let round = 0; round <= maxRounds; round += 1) {
    const fetched = await postJsonRound(
      url,
      headers,
      driver.buildBody(config, messages),
      timeoutMs,
      start,
      fetcher
    );
    if (!fetched.ok) return fetched.result;
    const step = driver.processRound(fetched.data, totals, sandboxOptions, round === maxRounds);
    if (step.kind === 'error') {
      return buildProviderFailure(start, fetched.status, 'invalid_response', false, step.message, false, true);
    }
    if (step.kind === 'final') {
      return buildBufferedSuccess(start, fetched.status, step.text, totals, {
        toolRounds: totals.toolRounds,
        operations: totals.operations
      });
    }
    recordSandboxStep(totals, round + 1, step.outcomes);
    messages.push(...step.nextMessages);
  }
  return buildProviderFailure(start, 200, 'invalid_response', false, 'exceeded maximum tool rounds', false, true);
}

type AnthropicContentBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
};

type AnthropicRoundPayload = {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: unknown; output_tokens?: unknown; cache_read_input_tokens?: unknown };
};

function processAnthropicRound(
  data: unknown,
  totals: TokenAccumulator,
  sandboxOptions: CodeModeOptions,
  isFinalRound: boolean
): ProviderRoundStep {
  const payload = (isObjectRecord(data) ? data : {}) as AnthropicRoundPayload;
  accumulateUsage(
    totals,
    payload.usage?.input_tokens,
    payload.usage?.output_tokens,
    payload.usage?.cache_read_input_tokens
  );
  if (!Array.isArray(payload.content) || !payload.content.every(isObjectRecord)) {
    return { kind: 'error', message: 'response missing valid content array' };
  }
  const contentBlocks = payload.content;
  const toolBlocks = contentBlocks.filter((c) => c.type === 'tool_use' && c.name === 'forgeai_code');
  const codes = toolBlocks.map((b) => (typeof b.input?.code === 'string' ? b.input.code : ''));
  const text = contentBlocks
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text!)
    .join('');

  return finishOrContinueRound(codes, text, isFinalRound, sandboxOptions, (outcomes) => [
    { role: 'assistant', content: contentBlocks },
    {
      role: 'user',
      content: outcomes.map((outcome, idx) => ({
        type: 'tool_result',
        tool_use_id: String(toolBlocks[idx]?.id ?? `tool_${idx}`),
        content: JSON.stringify(outcome),
        is_error: !outcome.ok
      }))
    }
  ]);
}

const ANTHROPIC_DRIVER: CodeModeProviderDriver = {
  envVar: 'ANTHROPIC_API_KEY',
  buildUrl: () => ANTHROPIC_URL,
  buildHeaders: (apiKey) => ({
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  }),
  initialMessages: (artifact) => [{ role: 'user', content: JSON.stringify(artifact) }],
  buildBody: (config, messages) =>
    JSON.stringify({
      model: config.model,
      max_tokens: config.max_tokens ?? DEFAULT_MAX_TOKENS,
      system: config.system ?? DEFAULT_CODE_MODE_SYSTEM,
      tools: [buildForgeAiCodeToolSchema()],
      messages
    }),
  processRound: processAnthropicRound
};

export async function callAnthropicWithCodeMode(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch,
  codeModeOptions?: CodeModeOptions
): Promise<ApiCallResult> {
  return executeCodeModeLoop(ANTHROPIC_DRIVER, artifact, config, fetcher, codeModeOptions);
}

type OpenAIToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAIRoundPayload = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: unknown;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
  };
};

function parseToolCallCode(rawArguments: string | undefined): string {
  try {
    const parsed = JSON.parse(rawArguments ?? '{}') as { code?: unknown };
    return typeof parsed.code === 'string' ? parsed.code : '';
  } catch {
    return '';
  }
}

function processOpenAIRound(
  data: unknown,
  totals: TokenAccumulator,
  sandboxOptions: CodeModeOptions,
  isFinalRound: boolean
): ProviderRoundStep {
  const payload = (isObjectRecord(data) ? data : {}) as OpenAIRoundPayload;
  accumulateUsage(
    totals,
    payload.usage?.prompt_tokens,
    payload.usage?.completion_tokens,
    payload.usage?.prompt_tokens_details?.cached_tokens
  );
  const msg = payload.choices?.[0]?.message;
  if (!isObjectRecord(msg)) {
    return { kind: 'error', message: 'response has no choices' };
  }
  const rawCalls = Array.isArray(msg.tool_calls) ? (msg.tool_calls as OpenAIToolCall[]) : [];
  const toolCalls = rawCalls.filter((tc) => tc.function?.name === 'forgeai_code');
  const codes = toolCalls.map((tc) => parseToolCallCode(tc.function?.arguments));
  const text = typeof msg.content === 'string' ? msg.content : '';

  return finishOrContinueRound(codes, text, isFinalRound, sandboxOptions, (outcomes) => [
    msg,
    ...outcomes.map((outcome, idx) => ({
      role: 'tool',
      tool_call_id: String(toolCalls[idx]?.id ?? `call_${idx}`),
      content: JSON.stringify(outcome)
    }))
  ]);
}

const OPENAI_DRIVER: CodeModeProviderDriver = {
  envVar: 'OPENAI_API_KEY',
  buildUrl: () => OPENAI_URL,
  buildHeaders: (apiKey) => ({
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json'
  }),
  initialMessages: (artifact, config) => [
    { role: 'system', content: config.system ?? DEFAULT_CODE_MODE_SYSTEM },
    { role: 'user', content: JSON.stringify(artifact) }
  ],
  buildBody: (config, messages) => {
    const toolSchema = buildForgeAiCodeToolSchema();
    const payload: Record<string, unknown> = {
      model: config.model,
      max_tokens: config.max_tokens ?? DEFAULT_MAX_TOKENS,
      tools: [
        {
          type: 'function',
          function: {
            name: toolSchema.name,
            description: toolSchema.description,
            parameters: toolSchema.input_schema
          }
        }
      ],
      messages
    };
    if (config.reasoning_effort) payload.reasoning_effort = config.reasoning_effort;
    return JSON.stringify(payload);
  },
  processRound: processOpenAIRound
};

export async function callOpenAIWithCodeMode(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch,
  codeModeOptions?: CodeModeOptions
): Promise<ApiCallResult> {
  return executeCodeModeLoop(OPENAI_DRIVER, artifact, config, fetcher, codeModeOptions);
}

type GeminiPart = {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
};

type GeminiRoundPayload = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  usageMetadata?: {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    cachedContentTokenCount?: unknown;
  };
};

function processGeminiRound(
  data: unknown,
  totals: TokenAccumulator,
  sandboxOptions: CodeModeOptions,
  isFinalRound: boolean
): ProviderRoundStep {
  const payload = (isObjectRecord(data) ? data : {}) as GeminiRoundPayload;
  accumulateUsage(
    totals,
    payload.usageMetadata?.promptTokenCount,
    payload.usageMetadata?.candidatesTokenCount,
    payload.usageMetadata?.cachedContentTokenCount
  );
  const parts = payload.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return { kind: 'error', message: 'response candidate missing content or parts' };
  }
  const callParts = parts.filter((p) => isObjectRecord(p) && p.functionCall?.name === 'forgeai_code');
  const codes = callParts.map((p) =>
    typeof p.functionCall?.args?.code === 'string' ? p.functionCall.args.code : ''
  );
  const text = parts
    .filter((p) => isObjectRecord(p) && typeof p.text === 'string')
    .map((p) => p.text!)
    .join('');

  return finishOrContinueRound(codes, text, isFinalRound, sandboxOptions, (outcomes) => [
    { role: 'model', parts },
    {
      role: 'user',
      parts: outcomes.map((outcome) => ({
        functionResponse: { name: 'forgeai_code', response: outcome }
      }))
    }
  ]);
}

function buildGeminiGenerationConfig(config: ApiAdapterEntry): Record<string, unknown> {
  const gen: Record<string, unknown> = { maxOutputTokens: config.max_tokens ?? DEFAULT_MAX_TOKENS };
  if (config.thinking_budget !== undefined) gen.thinkingConfig = { thinkingBudget: config.thinking_budget };
  if (config.thinking_level !== undefined) gen.thinkingConfig = { thinkingLevel: config.thinking_level };
  return gen;
}

const GEMINI_DRIVER: CodeModeProviderDriver = {
  envVar: 'GOOGLE_API_KEY',
  buildUrl: (config) => `${GEMINI_BASE}/${encodeURIComponent(config.model)}:generateContent`,
  buildHeaders: (apiKey) => ({
    'content-type': 'application/json',
    'x-goog-api-key': apiKey
  }),
  initialMessages: (artifact) => [{ role: 'user', parts: [{ text: JSON.stringify(artifact) }] }],
  buildBody: (config, messages) => {
    const toolSchema = buildForgeAiCodeToolSchema();
    return JSON.stringify({
      contents: messages,
      systemInstruction: { parts: [{ text: config.system ?? DEFAULT_CODE_MODE_SYSTEM }] },
      tools: [
        {
          functionDeclarations: [
            {
              name: toolSchema.name,
              description: toolSchema.description,
              parameters: toolSchema.input_schema
            }
          ]
        }
      ],
      generationConfig: buildGeminiGenerationConfig(config)
    });
  },
  processRound: processGeminiRound
};

export async function callGeminiWithCodeMode(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch,
  codeModeOptions?: CodeModeOptions
): Promise<ApiCallResult> {
  return executeCodeModeLoop(GEMINI_DRIVER, artifact, config, fetcher, codeModeOptions);
}

export type StreamAccumulatorState = {
  text: string;
  input: number | null;
  output: number | null;
  cached: number | null;
  streamed: boolean;
  sawEnd: boolean;
};

export type StreamEventAction =
  | 'continue'
  | 'done'
  | { kind: ApiCallResult['error_kind']; retryable: boolean; msg: string };

export function appendStreamTextChunk(
  state: StreamAccumulatorState,
  chunk: unknown,
  onDelta: (text: string) => void
): void {
  if (typeof chunk === 'string' && chunk.length > 0) {
    state.text += chunk;
    state.streamed = true;
    onDelta(chunk);
  }
}

export function applyStreamTokenCounts(
  state: StreamAccumulatorState,
  inputRaw: unknown,
  outputRaw: unknown,
  cachedRaw: unknown
): void {
  const pi = optionalTokenCount(inputRaw);
  if (pi !== null) state.input = pi;
  const co = optionalTokenCount(outputRaw);
  if (co !== null) state.output = co;
  const ca = optionalTokenCount(cachedRaw);
  if (ca !== null) state.cached = ca;
}

function finalizeSseStreamResult(
  state: StreamAccumulatorState,
  start: number,
  status: number,
  endMarkerLabel: string | null
): ApiCallResult {
  if (!state.sawEnd) {
    return buildProviderFailure(
      start,
      status,
      'invalid_response',
      false,
      `stream ended before ${endMarkerLabel}`,
      state.streamed
    );
  }
  if (state.text.trim().length === 0) {
    return buildProviderFailure(start, status, 'invalid_response', false, 'response text is empty', state.streamed);
  }
  return {
    ok: true,
    text: state.text,
    input_tokens: state.input,
    output_tokens: state.output,
    cached_tokens: state.cached,
    latency_ms: Date.now() - start,
    http_status: status,
    error_kind: null,
    retryable: false,
    streamed: true,
    retry_count: 0,
    error: null
  };
}

export async function consumeProviderSseStream(
  response: Response,
  start: number,
  status: number,
  endMarkerLabel: string | null,
  onFrame: (dataStr: string, state: StreamAccumulatorState) => StreamEventAction
): Promise<ApiCallResult> {
  if (!response.body) {
    return buildProviderFailure(start, status, 'invalid_response', false, 'streaming response has no body');
  }
  const state: StreamAccumulatorState = {
    text: '',
    input: null,
    output: null,
    cached: null,
    streamed: false,
    sawEnd: endMarkerLabel === null
  };
  try {
    for await (const dataStr of parseSSE(response.body)) {
      const action = onFrame(dataStr, state);
      if (action === 'done') break;
      if (action !== 'continue') {
        return buildProviderFailure(start, status, action.kind, action.retryable, action.msg, state.streamed);
      }
    }
  } catch {
    const msg = state.streamed ? 'stream read failed after output began' : 'stream read failed';
    const kind = state.streamed ? 'invalid_response' : 'network';
    return buildProviderFailure(start, status, kind, !state.streamed, msg, state.streamed);
  }
  return finalizeSseStreamResult(state, start, status, endMarkerLabel);
}

export type SingleCallProviderSpec = {
  envVar: string;
  endMarkerLabel: string | null;
  buildUrl: (config: ApiAdapterEntry, streaming: boolean) => string;
  buildHeaders: (apiKey: string) => Record<string, string>;
  buildBody: (artifact: CompiledContextArtifact, config: ApiAdapterEntry, streaming: boolean) => string;
  onStreamFrame: (dataStr: string, state: StreamAccumulatorState, onDelta: (text: string) => void) => StreamEventAction;
  parseBuffered: (data: unknown, start: number, status: number) => ApiCallResult;
  codeModeDriver: CodeModeProviderDriver;
};

export async function executeSingleProviderCall(
  spec: SingleCallProviderSpec,
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch,
  onDelta?: (text: string) => void,
  codeModeOptions?: CodeModeOptions
): Promise<ApiCallResult> {
  if ((config.code_mode || codeModeOptions) && !onDelta) {
    return executeCodeModeLoop(spec.codeModeDriver, artifact, config, fetcher, codeModeOptions);
  }
  const apiKey = process.env[spec.envVar];
  if (!apiKey) {
    return buildProviderFailure(
      Date.now(),
      null,
      'auth',
      false,
      `${spec.envVar} is not set; set it with: export ${spec.envVar}=<your-key>`
    );
  }
  const timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const streaming = Boolean(onDelta);
  const start = Date.now();
  const sent = await sendProviderHttp(
    spec.buildUrl(config, streaming),
    spec.buildHeaders(apiKey),
    spec.buildBody(artifact, config, streaming),
    timeoutMs,
    start,
    fetcher
  );
  if (!sent.ok) return sent.result;
  if (onDelta) {
    return consumeProviderSseStream(sent.response, start, sent.status, spec.endMarkerLabel, (frame, state) =>
      spec.onStreamFrame(frame, state, onDelta)
    );
  }
  const parsed = await readProviderJsonBody(sent.response, timeoutMs, start, sent.status);
  if (!parsed.ok) return parsed.result;
  return spec.parseBuffered(parsed.data, start, sent.status);
}

export { ANTHROPIC_DRIVER, OPENAI_DRIVER, GEMINI_DRIVER };
