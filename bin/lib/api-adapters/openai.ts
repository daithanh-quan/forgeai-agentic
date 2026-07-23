import type { ApiAdapterEntry, ApiCallResult, CompiledContextArtifact } from '../types.js';
import { parseSSE } from './sse.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_SYSTEM = 'You are a software engineering agent. Process the compiled context artifact and complete the objective stated in it.';

function optionalTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export async function callOpenAI(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch,
  onDelta?: (text: string) => void
): Promise<ApiCallResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'auth', retryable: false, streamed: false, retry_count: 0, error: 'OPENAI_API_KEY is not set; set it with: export OPENAI_API_KEY=<your-key>' };
  }

  const body = JSON.stringify({
    model: config.model,
    max_tokens: config.max_tokens ?? 8192,
    messages: [
      { role: 'system', content: config.system ?? DEFAULT_SYSTEM },
      { role: 'user', content: JSON.stringify(artifact) },
    ],
    ...(onDelta ? { stream: true, stream_options: { include_usage: true } } : {}),
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
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: null, error_kind: 'network', retryable: true, streamed: false, retry_count: 0, error: isTimeout ? `request timed out after ${config.timeout_ms ?? 120_000}ms` : String(err) };
  }

  const status = response.status;

  if (status === 401 || status === 403) {
    const detail = await response.text().catch(() => '');
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'auth', retryable: false, streamed: false, retry_count: 0, error: `HTTP ${status}: ${detail.slice(0, 200)}` };
  }
  if (status === 429) {
    const detail = await response.text().catch(() => '');
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'quota', retryable: true, streamed: false, retry_count: 0, error: `HTTP 429: ${detail.slice(0, 200)}` };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const retryable = status === 408 || (status >= 500 && status < 600);
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'provider', retryable, streamed: false, retry_count: 0, error: `HTTP ${status}: ${detail.slice(0, 200)}` };
  }

  if (onDelta) {
    if (!response.body) {
      return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'streaming response has no body' };
    }
    let text = '';
    let input: number | null = null, output: number | null = null, cached: number | null = null;
    let streamed = false;
    let sawDone = false;
    const fail = (kind: ApiCallResult['error_kind'], retryable: boolean, msg: string): ApiCallResult => ({
      ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null,
      latency_ms: Date.now() - start, http_status: status, error_kind: kind,
      retryable: streamed ? false : retryable, streamed, retry_count: 0, error: msg,
    });
    try {
      for await (const dataStr of parseSSE(response.body)) {
        if (dataStr === '[DONE]') { sawDone = true; break; }
        let evt: { choices?: Array<{ delta?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } } };
        try { evt = JSON.parse(dataStr); }
        catch { return fail('invalid_response', false, 'malformed SSE event JSON'); }
        const c = evt.choices?.[0]?.delta?.content;
        if (typeof c === 'string' && c.length > 0) { text += c; streamed = true; onDelta(c); }
        if (evt.usage) {
          const pi = optionalTokenCount(evt.usage.prompt_tokens); if (pi !== null) input = pi;
          const co = optionalTokenCount(evt.usage.completion_tokens); if (co !== null) output = co;
          const ca = optionalTokenCount(evt.usage.prompt_tokens_details?.cached_tokens); if (ca !== null) cached = ca;
        }
      }
    } catch {
      return streamed
        ? fail('invalid_response', false, 'stream read failed after output began')
        : fail('network', true, 'stream read failed');
    }
    if (!sawDone) return fail('invalid_response', false, 'stream ended before [DONE]');
    if (text.trim().length === 0) return fail('invalid_response', false, 'response text is empty');
    return { ok: true, text, input_tokens: input, output_tokens: output, cached_tokens: cached, latency_ms: Date.now() - start, http_status: status, error_kind: null, retryable: false, streamed: true, retry_count: 0, error: null };
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
      return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'network', retryable: true, streamed: false, retry_count: 0, error: `request timed out after ${config.timeout_ms ?? 120_000}ms` };
    }
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'response body is not valid JSON' };
  }
  const latency_ms = Date.now() - start;

  if (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData)) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'response is not a JSON object' };
  }
  const data = rawData as OpenAIResponse;

  if (!Array.isArray(data.choices)) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'response has no choices' };
  }
  const choice = data.choices[0];
  if (!choice) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'response has no choices' };
  }
  // Use optional chaining — choice.message may be absent on malformed responses
  if (typeof choice.message?.content !== 'string') {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'response content is not a string' };
  }

  const text = choice.message.content;
  if (text.trim().length === 0) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, streamed: false, retry_count: 0, error: 'response text is empty' };
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
    streamed: false,
    retry_count: 0,
    error: null,
  };
}
