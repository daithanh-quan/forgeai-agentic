import type { ApiAdapterEntry, ApiCallResult, CodeModeOptions, CompiledContextArtifact } from '../types.js';
import {
  appendStreamTextChunk,
  applyStreamTokenCounts,
  buildBufferedSuccess,
  buildProviderFailure,
  executeSingleProviderCall,
  OPENAI_DRIVER,
  optionalTokenCount,
  type SingleCallProviderSpec,
  type StreamAccumulatorState,
  type StreamEventAction
} from './code-mode-loop.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_SYSTEM =
  'You are a software engineering agent. Process the compiled context artifact and complete the objective stated in it.';

type OpenAISseEvent = {
  choices?: Array<{ delta?: { content?: unknown } }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
  };
};

function handleOpenAISseFrame(
  dataStr: string,
  state: StreamAccumulatorState,
  onDelta: (text: string) => void
): StreamEventAction {
  if (dataStr === '[DONE]') {
    state.sawEnd = true;
    return 'done';
  }
  let evt: OpenAISseEvent;
  try {
    evt = JSON.parse(dataStr) as OpenAISseEvent;
  } catch {
    return { kind: 'invalid_response', retryable: false, msg: 'malformed SSE event JSON' };
  }
  appendStreamTextChunk(state, evt.choices?.[0]?.delta?.content, onDelta);
  if (evt.usage) {
    applyStreamTokenCounts(
      state,
      evt.usage.prompt_tokens,
      evt.usage.completion_tokens,
      evt.usage.prompt_tokens_details?.cached_tokens
    );
  }
  return 'continue';
}

type OpenAIResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
  };
};

function parseOpenAIBuffered(rawData: unknown, start: number, status: number): ApiCallResult {
  if (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData)) {
    return buildProviderFailure(start, status, 'invalid_response', false, 'response is not a JSON object');
  }
  const data = rawData as OpenAIResponse;
  const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
  if (!choice) {
    return buildProviderFailure(start, status, 'invalid_response', false, 'response has no choices');
  }
  if (typeof choice.message?.content !== 'string') {
    return buildProviderFailure(start, status, 'invalid_response', false, 'response content is not a string');
  }
  return buildBufferedSuccess(start, status, choice.message.content, {
    input: optionalTokenCount(data.usage?.prompt_tokens),
    output: optionalTokenCount(data.usage?.completion_tokens),
    cached: optionalTokenCount(data.usage?.prompt_tokens_details?.cached_tokens)
  });
}

function buildOpenAIBody(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  streaming: boolean
): string {
  const payload: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.max_tokens ?? 8192,
    messages: [
      { role: 'system', content: config.system ?? DEFAULT_SYSTEM },
      { role: 'user', content: JSON.stringify(artifact) }
    ]
  };
  if (config.reasoning_effort) payload.reasoning_effort = config.reasoning_effort;
  if (streaming) {
    payload.stream = true;
    payload.stream_options = { include_usage: true };
  }
  return JSON.stringify(payload);
}

const OPENAI_SPEC: SingleCallProviderSpec = {
  envVar: 'OPENAI_API_KEY',
  endMarkerLabel: '[DONE]',
  buildUrl: () => OPENAI_URL,
  buildHeaders: (apiKey) => ({
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json'
  }),
  buildBody: buildOpenAIBody,
  onStreamFrame: handleOpenAISseFrame,
  parseBuffered: parseOpenAIBuffered,
  codeModeDriver: OPENAI_DRIVER
};

export async function callOpenAI(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch,
  onDelta?: (text: string) => void,
  codeModeOptions?: CodeModeOptions
): Promise<ApiCallResult> {
  return executeSingleProviderCall(OPENAI_SPEC, artifact, config, fetcher, onDelta, codeModeOptions);
}
