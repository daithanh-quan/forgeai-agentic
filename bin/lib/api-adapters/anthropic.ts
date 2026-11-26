import type { ApiAdapterEntry, ApiCallResult, CodeModeOptions, CompiledContextArtifact } from '../types.js';
import {
  ANTHROPIC_DRIVER,
  buildBufferedSuccess,
  buildProviderFailure,
  executeSingleProviderCall,
  optionalTokenCount,
  type SingleCallProviderSpec,
  type StreamAccumulatorState,
  type StreamEventAction
} from './code-mode-loop.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_SYSTEM =
  'You are a software engineering agent. Process the compiled context artifact and complete the objective stated in it.';

type AnthropicSseEvent = {
  type?: string;
  delta?: { text?: unknown };
  message?: { usage?: Record<string, unknown> };
  usage?: Record<string, unknown>;
  error?: { type?: string };
};

function handleAnthropicStreamError(evt: AnthropicSseEvent, state: StreamAccumulatorState): StreamEventAction {
  if (state.streamed) {
    return { kind: 'invalid_response', retryable: false, msg: 'stream error after output began' };
  }
  const errType = evt.error?.type ?? 'unknown';
  return { kind: 'provider', retryable: errType === 'overloaded_error', msg: `stream error: ${errType}` };
}

function applyAnthropicStreamEvent(
  evt: AnthropicSseEvent,
  state: StreamAccumulatorState,
  onDelta: (text: string) => void
): StreamEventAction {
  if (evt.type === 'message_start') {
    state.input = optionalTokenCount(evt.message?.usage?.['input_tokens']);
    state.cached = optionalTokenCount(evt.message?.usage?.['cache_read_input_tokens']);
    return 'continue';
  }
  if (evt.type === 'content_block_delta') {
    const chunk = evt.delta?.text;
    if (typeof chunk === 'string' && chunk.length > 0) {
      state.text += chunk;
      state.streamed = true;
      onDelta(chunk);
    }
    return 'continue';
  }
  if (evt.type === 'message_delta') {
    const out = optionalTokenCount(evt.usage?.['output_tokens']);
    if (out !== null) state.output = out;
    return 'continue';
  }
  if (evt.type === 'message_stop') {
    state.sawEnd = true;
    return 'continue';
  }
  return evt.type === 'error' ? handleAnthropicStreamError(evt, state) : 'continue';
}

function handleAnthropicSseFrame(
  dataStr: string,
  state: StreamAccumulatorState,
  onDelta: (text: string) => void
): StreamEventAction {
  let evt: AnthropicSseEvent;
  try {
    evt = JSON.parse(dataStr) as AnthropicSseEvent;
  } catch {
    return { kind: 'invalid_response', retryable: false, msg: 'malformed SSE event JSON' };
  }
  return applyAnthropicStreamEvent(evt, state, onDelta);
}

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: unknown }>;
  usage?: { input_tokens?: unknown; output_tokens?: unknown; cache_read_input_tokens?: unknown };
};

function parseAnthropicBuffered(data: unknown, start: number, status: number): ApiCallResult {
  const payload = (typeof data === 'object' && data !== null ? data : {}) as AnthropicResponse;
  if (!Array.isArray(payload.content)) {
    return buildProviderFailure(start, status, 'invalid_response', false, 'response missing content array');
  }
  if (payload.content.some((c) => typeof c !== 'object' || c === null)) {
    return buildProviderFailure(start, status, 'invalid_response', false, 'response content array contains non-object item');
  }
  const textItems = payload.content.filter((c) => c.type === 'text');
  if (textItems.length === 0) {
    return buildProviderFailure(start, status, 'invalid_response', false, 'response has no text blocks');
  }
  if (textItems.some((c) => typeof c.text !== 'string')) {
    return buildProviderFailure(start, status, 'invalid_response', false, 'response has text block with non-string text field');
  }
  const text = textItems.map((c) => c.text as string).join('');
  return buildBufferedSuccess(start, status, text, {
    input: optionalTokenCount(payload.usage?.input_tokens),
    output: optionalTokenCount(payload.usage?.output_tokens),
    cached: optionalTokenCount(payload.usage?.cache_read_input_tokens)
  });
}

const ANTHROPIC_SPEC: SingleCallProviderSpec = {
  envVar: 'ANTHROPIC_API_KEY',
  endMarkerLabel: 'message_stop',
  buildUrl: () => ANTHROPIC_URL,
  buildHeaders: (apiKey) => ({
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  }),
  buildBody: (artifact, config, streaming) =>
    JSON.stringify({
      model: config.model,
      max_tokens: config.max_tokens ?? 8192,
      system: config.system ?? DEFAULT_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(artifact) }],
      ...(streaming ? { stream: true } : {})
    }),
  onStreamFrame: handleAnthropicSseFrame,
  parseBuffered: parseAnthropicBuffered,
  codeModeDriver: ANTHROPIC_DRIVER
};

export async function callAnthropic(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch,
  onDelta?: (text: string) => void,
  codeModeOptions?: CodeModeOptions
): Promise<ApiCallResult> {
  return executeSingleProviderCall(ANTHROPIC_SPEC, artifact, config, fetcher, onDelta, codeModeOptions);
}
