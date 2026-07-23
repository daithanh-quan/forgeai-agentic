import type { ApiAdapterEntry, ApiCallResult, CompiledContextArtifact } from '../types.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_SYSTEM = 'You are a software engineering agent. Process the compiled context artifact and complete the objective stated in it.';

function optionalTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export async function callOpenAI(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch
): Promise<ApiCallResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'auth', retryable: false, error: 'OPENAI_API_KEY is not set; set it with: export OPENAI_API_KEY=<your-key>' };
  }

  const body = JSON.stringify({
    model: config.model,
    max_tokens: config.max_tokens ?? 8192,
    messages: [
      { role: 'system', content: config.system ?? DEFAULT_SYSTEM },
      { role: 'user', content: JSON.stringify(artifact) },
    ],
  });

  const start = Date.now();
  let response: Response;
  try {
    response = await fetcher(OPENAI_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(config.timeout_ms ?? 120_000),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: null, error_kind: 'network', retryable: true, error: isTimeout ? `request timed out after ${config.timeout_ms ?? 120_000}ms` : String(err) };
  }

  const status = response.status;

  if (status === 401 || status === 403) {
    const detail = await response.text().catch(() => '');
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'auth', retryable: false, error: `HTTP ${status}: ${detail.slice(0, 200)}` };
  }
  if (status === 429) {
    const detail = await response.text().catch(() => '');
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'quota', retryable: true, error: `HTTP 429: ${detail.slice(0, 200)}` };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const retryable = status === 408 || (status >= 500 && status < 600);
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'provider', retryable, error: `HTTP ${status}: ${detail.slice(0, 200)}` };
  }

  type OpenAIResponse = {
    choices?: Array<{ message?: { content: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } };
  };
  let rawData: unknown;
  try {
    rawData = await response.json();
  } catch (bodyErr) {
    const isTimeout = bodyErr instanceof Error && (bodyErr.name === 'TimeoutError' || bodyErr.name === 'AbortError');
    if (isTimeout) {
      return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'network', retryable: true, error: `request timed out after ${config.timeout_ms ?? 120_000}ms` };
    }
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response body is not valid JSON' };
  }
  const latency_ms = Date.now() - start;

  if (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData)) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response is not a JSON object' };
  }
  const data = rawData as OpenAIResponse;

  if (!Array.isArray(data.choices)) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response has no choices' };
  }
  const choice = data.choices[0];
  if (!choice) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response has no choices' };
  }
  // Use optional chaining — choice.message may be absent on malformed responses
  if (typeof choice.message?.content !== 'string') {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response content is not a string' };
  }

  const text = choice.message.content;
  if (text.trim().length === 0) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response text is empty' };
  }
  return {
    ok: true,
    text,
    input_tokens: optionalTokenCount(data.usage?.prompt_tokens),
    output_tokens: optionalTokenCount(data.usage?.completion_tokens),
    cached_tokens: optionalTokenCount(data.usage?.prompt_tokens_details?.cached_tokens),
    latency_ms,
    http_status: status,
    error_kind: null,
    retryable: false,
    error: null,
  };
}
