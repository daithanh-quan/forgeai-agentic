import type { ApiAdapterEntry, ApiCallResult, CompiledContextArtifact } from '../types.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_SYSTEM = 'You are a software engineering agent. Process the compiled context artifact and complete the objective stated in it.';

function optionalTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export async function callGemini(
  artifact: CompiledContextArtifact,
  config: ApiAdapterEntry,
  fetcher: typeof fetch = fetch
): Promise<ApiCallResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms: 0, http_status: null, error_kind: 'auth', retryable: false, error: 'GOOGLE_API_KEY is not set; set it with: export GOOGLE_API_KEY=<your-key>' };
  }

  const url = `${GEMINI_BASE}/${encodeURIComponent(config.model)}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(artifact) }] }],
    systemInstruction: { parts: [{ text: config.system ?? DEFAULT_SYSTEM }] },
    generationConfig: { maxOutputTokens: config.max_tokens ?? 8192 },
  });

  const start = Date.now();
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
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

  type GeminiResponse = {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
    usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; cachedContentTokenCount?: unknown };
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
  const data = rawData as GeminiResponse;

  if (!Array.isArray(data.candidates)) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response has no candidates' };
  }
  const candidate = data.candidates[0];
  if (!candidate) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response has no candidates' };
  }

  // Guard missing content/parts — avoids throw on safety-filtered responses
  if (!candidate.content || !Array.isArray(candidate.content.parts)) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response candidate missing content or parts' };
  }

  const textParts = candidate.content.parts.filter((p): p is { text: string } => typeof p?.text === 'string');
  if (textParts.length === 0) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response has no valid text parts' };
  }
  const text = textParts.map((p) => p.text).join('');
  if (text.trim().length === 0) {
    return { ok: false, text: null, input_tokens: null, output_tokens: null, cached_tokens: null, latency_ms, http_status: status, error_kind: 'invalid_response', retryable: false, error: 'response text is empty' };
  }
  return {
    ok: true,
    text,
    input_tokens: optionalTokenCount(data.usageMetadata?.promptTokenCount),
    output_tokens: optionalTokenCount(data.usageMetadata?.candidatesTokenCount),
    cached_tokens: optionalTokenCount(data.usageMetadata?.cachedContentTokenCount),
    latency_ms,
    http_status: status,
    error_kind: null,
    retryable: false,
    error: null,
  };
}
