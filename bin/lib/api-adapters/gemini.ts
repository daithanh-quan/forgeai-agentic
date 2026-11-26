import type { ApiAdapterEntry, ApiCallResult, CodeModeOptions, CompiledContextArtifact } from '../types.js';
import {
  appendStreamTextChunk,
  applyStreamTokenCounts,
  buildBufferedSuccess,
  buildProviderFailure,
  executeSingleProviderCall,
  GEMINI_DRIVER,
  optionalTokenCount,
  type SingleCallProviderSpec,
  type StreamAccumulatorState,
  type StreamEventAction
} from './code-mode-loop.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_SYSTEM =
  'You are a software engineering agent. Process the compiled context artifact and complete the objective stated in it.';

type GeminiSseEvent = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  usageMetadata?: {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    cachedContentTokenCount?: unknown;
  };
};

function handleGeminiSseFrame(
  dataStr: string,
  state: StreamAccumulatorState,
  onDelta: (text: string) => void
): StreamEventAction {
  let evt: GeminiSseEvent;
  try {
    evt = JSON.parse(dataStr) as GeminiSseEvent;
  } catch {
    return { kind: 'invalid_response', retryable: false, msg: 'malformed SSE event JSON' };
  }
  for (const part of evt.candidates?.[0]?.content?.parts ?? []) {
    appendStreamTextChunk(state, part?.text, onDelta);
  }
  const meta = evt.usageMetadata;
  if (meta) applyStreamTokenCounts(state, meta.promptTokenCount, meta.candidatesTokenCount, meta.cachedContentTokenCount);
  return 'continue';
}

function parseGeminiBuffered(rawData: unknown, start: number, status: number): ApiCallResult {
  if (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData)) {
    return buildProviderFailure(start, status, 'invalid_response', false, 'response is not a JSON object');
  }
  const data = rawData as GeminiSseEvent;
  const candidate = Array.isArray(data.candidates) ? data.candidates[0] : undefined;
  if (!candidate) {
    return buildProviderFailure(start, status, 'invalid_response', false, 'response has no candidates');
  }
  const parts = candidate.content?.parts;
  if (!Array.isArray(parts)) {
    return buildProviderFailure(start, status, 'invalid_response', false, 'response candidate missing content or parts');
  }
  const textParts = parts.filter((p): p is { text: string } => typeof p?.text === 'string');
  if (textParts.length === 0) {
    return buildProviderFailure(start, status, 'invalid_response', false, 'response has no valid text parts');
  }
  const text = textParts.map((p) => p.text).join('');
  return buildBufferedSuccess(start, status, text, {
    input: optionalTokenCount(data.usageMetadata?.promptTokenCount),
    output: optionalTokenCount(data.usageMetadata?.candidatesTokenCount),
    cached: optionalTokenCount(data.usageMetadata?.cachedContentTokenCount)
  });
}

function buildGeminiBody(artifact: CompiledContextArtifact, config: ApiAdapterEntry): string {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: config.max_tokens ?? 8192
  };
  if (config.thinking_budget !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget: config.thinking_budget };
  }
  if (config.thinking_level !== undefined) {
    generationConfig.thinkingConfig = { thinkingLevel: config.thinking_level };
  }
  return JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(artifact) }] }],
    systemInstruction: { parts: [{ text: config.system ?? DEFAULT_SYSTEM }] },
    generationConfig
  });
}

const GEMINI_SPEC: SingleCallProviderSpec = {
  envVar: 'GOOGLE_API_KEY',
  endMarkerLabel: null,
  buildUrl: (config, streaming) => {
    const encoded = encodeURIComponent(config.model);
    return streaming
      ? `${GEMINI_BASE}/${encoded}:streamGenerateContent?alt=sse`
      : `${GEMINI_BASE}/${encoded}:generateContent`;
  },
  buildHeaders: (apiKey) => ({
    'content-type': 'application/json',
    'x-goog-api-key': apiKey
  }),
  buildBody: (artifact, config) => buildGeminiBody(artifact, config),
  onStreamFrame: handleGeminiSseFrame,
  parseBuffered: parseGeminiBuffered,
  codeModeDriver: GEMINI_DRIVER
};

export async function callGemini(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch,
  onDelta?: (text: string) => void,
  codeModeOptions?: CodeModeOptions
): Promise<ApiCallResult> {
  return executeSingleProviderCall(GEMINI_SPEC, artifact, config, fetcher, onDelta, codeModeOptions);
}
