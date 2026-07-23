import type { ApiAdapterEntry, ApiCallResult, CompiledContextArtifact } from '../types.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_SYSTEM = 'You are a software engineering agent. Process the compiled context artifact and complete the objective stated in it.';

function optionalTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export async function callAnthropic(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch
): Promise<ApiCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'auth', retryable: false, error: 'ANTHROPIC_API_KEY is not set; set it with: export ANTHROPIC_API_KEY=<your-key>' };
  }

  const body = JSON.stringify({
    model: config.model,
    max_tokens: config.max_tokens ?? 8192,
    system: config.system ?? DEFAULT_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(artifact) }],
  });

  const start = Date.now();
  let response: Response;
  try {
    response = await fetcher(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
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

  type AnthropicResponse = {
    content: Array<{ type: string; text: string }>;
    usage?: { input_tokens?: unknown; output_tokens?: unknown; cache_read_input_tokens?: unknown };
  };
  let data: AnthropicResponse;
  try {
    data = await response.json() as AnthropicResponse;
  } catch (bodyErr) {
    const isTimeout = bodyErr instanceof Error && (bodyErr.name === 'TimeoutError' || bodyErr.name === 'AbortError');
    if (isTimeout) {
      return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'network', retryable: true, error: `request timed out after ${config.timeout_ms ?? 120_000}ms` };
    }
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: Date.now() - start, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response body is not valid JSON' };
  }
  const latency_ms = Date.now() - start;

  if (!Array.isArray(data?.content)) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response missing content array' };
  }

  // Guard null/non-object items — avoids throw on malformed shape (which dispatcher would mis-label 'network')
  const invalidItem = data.content.find((c) => typeof c !== 'object' || c === null);
  if (invalidItem !== undefined) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response content array contains non-object item' };
  }
  // Require at least one text block — empty content is silent data loss
  const textItems = data.content.filter((c) => c.type === 'text');
  if (textItems.length === 0) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response has no text blocks' };
  }
  // Reject text blocks that have no string text field — returning empty string would be silent data loss
  if (textItems.some((c) => typeof c.text !== 'string')) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response has text block with non-string text field' };
  }
  const text = textItems.map((c) => c.text as string).join('');
  if (text.trim().length === 0) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response text is empty' };
  }
  return {
    ok: true,
    text,
    input_tokens: optionalTokenCount(data.usage?.input_tokens),
    output_tokens: optionalTokenCount(data.usage?.output_tokens),
    cached_tokens: optionalTokenCount(data.usage?.cache_read_input_tokens),
    latency_ms,
    http_status: status,
    error_kind: null,
    retryable: false,
    error: null,
  };
}
