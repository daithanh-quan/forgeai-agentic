import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { callAnthropic } from '../bin/lib/api-adapters/anthropic.js';
import type { ApiAdapterEntry, CompiledContextArtifact } from '../bin/lib/types.js';

export function minimalArtifact(): CompiledContextArtifact {
  return {
    schema_version: 1,
    kind: 'forgeai_compiled_context',
    objective: 'test objective',
    repository: { revision: null, fingerprint: 'abc123' },
    budget: { limit_tokens: 6000, estimated_tokens: 100, estimator: 'characters_divided_by_4', exhausted: false },
    selection: { max_depth: 2, max_nodes: 10, files: [] },
    rules: [],
    diagnostics: {
      git: { available: false, branch: null, revision: null, staged: 0, unstaged: 0, untracked: 0, changed_files: [], changed_files_truncated: false, diff: [], diff_truncated: false, error: null },
      validation: { package_manager: null, scripts: [] },
    },
    contracts: [],
    entrypoints: [],
    excerpts: [],
    omitted_candidates: 0,
  };
}

function anthropicConfig(): ApiAdapterEntry {
  return { provider: 'anthropic', model: 'claude-sonnet-4-6', max_tokens: 1024 };
}

test('callAnthropic: 200 → ok result with tokens', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    content: [{ type: 'text', text: 'response text' }],
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 30 },
  }), { status: 200 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, true);
  assert.equal(result.text, 'response text');
  assert.equal(result.input_tokens, 100);
  assert.equal(result.output_tokens, 50);
  assert.equal(result.cached_tokens, 30);
  assert.equal(result.http_status, 200);
  assert.equal(result.error_kind, null);
  assert.equal(result.retryable, false);
});

test('callAnthropic: 429 → quota error, retryable', async () => {
  const mockFetch = async (): Promise<Response> =>
    new Response('rate limit', { status: 429 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'quota');
  assert.equal(result.http_status, 429);
  assert.equal(result.retryable, true);
});

test('callAnthropic: 401 → auth error, not retryable', async () => {
  const mockFetch = async (): Promise<Response> =>
    new Response('invalid api key', { status: 401 });

  process.env.ANTHROPIC_API_KEY = 'bad-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'auth');
  assert.equal(result.http_status, 401);
  assert.equal(result.retryable, false);
});

test('callAnthropic: 403 → auth error', async () => {
  const mockFetch = async (): Promise<Response> => new Response('forbidden', { status: 403 });

  process.env.ANTHROPIC_API_KEY = 'bad-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.error_kind, 'auth');
  assert.equal(result.http_status, 403);
});

test('callAnthropic: 500 → provider error, retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('internal error', { status: 500 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'provider');
  assert.equal(result.http_status, 500);
  assert.equal(result.retryable, true);
});

test('callAnthropic: 400 → provider error, not retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('bad request', { status: 400 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'provider');
  assert.equal(result.retryable, false);
});

test('callAnthropic: non-JSON 200 → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response('not json', { status: 200 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callAnthropic: network error → network error_kind', async () => {
  const mockFetch = async (): Promise<Response> => { throw new Error('connection refused'); };

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'network');
  assert.equal(result.http_status, null);
  assert.equal(result.retryable, true);
});

test('callAnthropic: missing ANTHROPIC_API_KEY → auth error without calling fetch', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let fetchCalled = false;
  const mockFetch = async (): Promise<Response> => { fetchCalled = true; return new Response('{}', { status: 200 }); };
  try {
    const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
    assert.equal(result.ok, false);
    assert.equal(result.error_kind, 'auth');
    assert.equal(fetchCalled, false);
    assert.ok(result.error?.includes('ANTHROPIC_API_KEY'));
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('callAnthropic: valid JSON but null content item → invalid_response, not network', async () => {
  // Nested shape is wrong (null item in array) — must NOT throw into dispatcher's catch
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    content: [null],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
  }), { status: 200 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response', 'must not be reclassified as network');
});

test('callAnthropic: text block without text field → invalid_response', async () => {
  // type=text but text field is absent — silently returning empty string is wrong
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    content: [{ type: 'text' }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
  }), { status: 200 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callAnthropic: empty text "" → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    content: [{ type: 'text', text: '' }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
  }), { status: 200 });
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
  assert.ok(result.error?.includes('empty'));
});

test('callAnthropic: whitespace-only text "   " → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    content: [{ type: 'text', text: '   ' }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
  }), { status: 200 });
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callAnthropic: malformed usage fields → ok:true, tokens coerced to null', async () => {
  // Non-integer / negative usage values must not leak through as real numbers
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    content: [{ type: 'text', text: 'hello' }],
    usage: { input_tokens: 'invalid', output_tokens: null, cache_read_input_tokens: -1 },
  }), { status: 200 });
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(result.ok, true);
  assert.equal(result.input_tokens, null);
  assert.equal(result.output_tokens, null);
  assert.equal(result.cached_tokens, null);
});

// ── OpenAI tests ──────────────────────────────────────────────────────────────

import { callOpenAI } from '../bin/lib/api-adapters/openai.js';

function openaiConfig(): ApiAdapterEntry {
  return { provider: 'openai', model: 'gpt-4.1', max_tokens: 1024 };
}

test('callOpenAI: 200 → ok result with tokens', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: [{ message: { content: 'openai response' } }],
    usage: { prompt_tokens: 200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 50 } },
  }), { status: 200 });

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.ok, true);
  assert.equal(result.text, 'openai response');
  assert.equal(result.input_tokens, 200);
  assert.equal(result.output_tokens, 80);
  assert.equal(result.cached_tokens, 50);
  assert.equal(result.error_kind, null);
});

test('callOpenAI: missing usage → null token counts', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: [{ message: { content: 'ok' } }],
  }), { status: 200 });

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.ok, true);
  assert.equal(result.input_tokens, null);
  assert.equal(result.cached_tokens, null);
});

test('callOpenAI: empty choices → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 0 },
  }), { status: 200 });

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callOpenAI: 429 → quota, retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('{}', { status: 429 });

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.error_kind, 'quota');
  assert.equal(result.retryable, true);
});

test('callOpenAI: 401 → auth, not retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('{}', { status: 401 });

  process.env.OPENAI_API_KEY = 'bad-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.error_kind, 'auth');
  assert.equal(result.retryable, false);
});

test('callOpenAI: 500 → provider error, retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('{}', { status: 500 });

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.error_kind, 'provider');
  assert.equal(result.retryable, true);
});

test('callOpenAI: valid JSON but message missing → invalid_response, not network', async () => {
  // choices[0] exists but no .message — accessing .message.content would throw without guard
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: [{ role: 'assistant' }],  // no 'message' key
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }), { status: 200 });

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response', 'must not be reclassified as network');
});

test('callOpenAI: missing OPENAI_API_KEY → auth, no fetch call', async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  let called = false;
  try {
    const result = await callOpenAI(minimalArtifact(), openaiConfig(), async () => { called = true; return new Response('{}', { status: 200 }); });
    assert.equal(result.error_kind, 'auth');
    assert.equal(called, false);
  } finally {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  }
});

test('callOpenAI: malformed usage fields → ok:true, tokens coerced to null', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: [{ message: { content: 'hello' } }],
    usage: { prompt_tokens: 'invalid', completion_tokens: -1 },
  }), { status: 200 });
  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;
  assert.equal(result.ok, true);
  assert.equal(result.input_tokens, null);
  assert.equal(result.output_tokens, null);
  assert.equal(result.cached_tokens, null);
});

test('callOpenAI: JSON null body → invalid_response (not a throw)', async () => {
  const mockFetch = async (): Promise<Response> => new Response('null', { status: 200 });
  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
  assert.ok(result.error?.includes('not a JSON object'));
});

test('callOpenAI: choices is a plain object (fake-array) → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: { '0': { message: { content: 'accepted malformed' } } },
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }), { status: 200 });
  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callOpenAI: empty text "" → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: [{ message: { content: '' } }],
    usage: { prompt_tokens: 10, completion_tokens: 0 },
  }), { status: 200 });
  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
  assert.ok(result.error?.includes('empty'));
});

test('callOpenAI: whitespace-only text "  " → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    choices: [{ message: { content: '  ' } }],
    usage: { prompt_tokens: 10, completion_tokens: 0 },
  }), { status: 200 });
  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

// ── Gemini tests ──────────────────────────────────────────────────────────────

import { callGemini } from '../bin/lib/api-adapters/gemini.js';

function geminiConfig(): ApiAdapterEntry {
  return { provider: 'gemini', model: 'gemini-2.5-flash', max_tokens: 1024 };
}

test('callGemini: 200 → ok result with tokens including cached', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'gemini response' }] } }],
    usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 60, cachedContentTokenCount: 40 },
  }), { status: 200 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.ok, true);
  assert.equal(result.text, 'gemini response');
  assert.equal(result.input_tokens, 150);
  assert.equal(result.output_tokens, 60);
  assert.equal(result.cached_tokens, 40);
  assert.equal(result.error_kind, null);
});

test('callGemini: API key sent in x-goog-api-key header, not URL', async () => {
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};
  const mockFetch = async (url: string, init: RequestInit): Promise<Response> => {
    capturedUrl = url;
    capturedHeaders = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }), { status: 200 });
  };

  process.env.GOOGLE_API_KEY = 'hdr-key-123';
  await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.ok(!capturedUrl.includes('key='), `API key must NOT appear in URL, got: ${capturedUrl}`);
  assert.equal(capturedHeaders['x-goog-api-key'], 'hdr-key-123', 'x-goog-api-key header must be set');
});

test('callGemini: 429 → quota, retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('{}', { status: 429 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.error_kind, 'quota');
  assert.equal(result.retryable, true);
});

test('callGemini: 403 → auth error', async () => {
  const mockFetch = async (): Promise<Response> => new Response('forbidden', { status: 403 });

  process.env.GOOGLE_API_KEY = 'bad-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.error_kind, 'auth');
  assert.equal(result.http_status, 403);
});

test('callGemini: 503 → provider error, retryable', async () => {
  const mockFetch = async (): Promise<Response> => new Response('unavailable', { status: 503 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.error_kind, 'provider');
  assert.equal(result.retryable, true);
});

test('callGemini: missing candidates → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
  }), { status: 200 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.error_kind, 'invalid_response');
});

test('callGemini: valid JSON but candidate missing content → invalid_response, not network', async () => {
  // candidate exists but no .content — accessing .content.parts would throw without guard
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    candidates: [{ finishReason: 'SAFETY' }],  // no 'content' key
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
  }), { status: 200 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response', 'must not be reclassified as network');
});

test('callGemini: missing GOOGLE_API_KEY → auth, no fetch call', async () => {
  const saved = process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  let called = false;
  try {
    const result = await callGemini(minimalArtifact(), geminiConfig(), async () => { called = true; return new Response('{}', { status: 200 }); });
    assert.equal(result.error_kind, 'auth');
    assert.equal(called, false);
    assert.ok(result.error?.includes('GOOGLE_API_KEY'));
  } finally {
    if (saved !== undefined) process.env.GOOGLE_API_KEY = saved;
  }
});

test('callGemini: non-JSON 200 → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response('not json at all', { status: 200 });
  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callGemini: malformed usage fields → ok:true, tokens coerced to null', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'hello' }] } }],
    usageMetadata: { promptTokenCount: 'invalid', candidatesTokenCount: -1 },
  }), { status: 200 });
  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;
  assert.equal(result.ok, true);
  assert.equal(result.input_tokens, null);
  assert.equal(result.output_tokens, null);
  assert.equal(result.cached_tokens, null);
});

test('callGemini: JSON null body → invalid_response (not a throw)', async () => {
  const mockFetch = async (): Promise<Response> => new Response('null', { status: 200 });
  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
  assert.ok(result.error?.includes('not a JSON object'));
});

test('callGemini: candidates is a plain object (fake-array) → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    candidates: { '0': { content: { parts: [{ text: 'accepted malformed' }] } } },
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  }), { status: 200 });
  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callGemini: empty text "" → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '' }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
  }), { status: 200 });
  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
  assert.ok(result.error?.includes('empty'));
});

test('callGemini: whitespace-only text "  " → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '  ' }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
  }), { status: 200 });
  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;
  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

// ── Dispatcher tests ──────────────────────────────────────────────────────────

import { loadApiAdapters, callApiAdapter, validateApiAdaptersConfig, API_ADAPTERS_RELATIVE } from '../bin/lib/api-adapter.js';

test('API_ADAPTERS_RELATIVE equals .ai/api-adapters.json', () => {
  assert.equal(API_ADAPTERS_RELATIVE, '.ai/api-adapters.json');
});

test('validateApiAdaptersConfig: rejects non-object (string)', () => {
  const r = validateApiAdaptersConfig('not an object');
  assert.equal(r.ok, false);
});

test('validateApiAdaptersConfig: rejects array', () => {
  const r = validateApiAdaptersConfig([{ provider: 'anthropic', model: 'm' }]);
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.toLowerCase().includes('object'));
});

test('validateApiAdaptersConfig: rejects version !== 1', () => {
  const r = validateApiAdaptersConfig({ version: 2, adapters: {} });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('version'));
});

test('validateApiAdaptersConfig: rejects unknown provider', () => {
  const r = validateApiAdaptersConfig({ version: 1, adapters: { x: { provider: 'unknown', model: 'm' } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('unknown provider'));
});

test('validateApiAdaptersConfig: rejects empty adapter name', () => {
  const r = validateApiAdaptersConfig({ version: 1, adapters: { '': { provider: 'anthropic', model: 'm' } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.toLowerCase().includes('name'));
});

test('validateApiAdaptersConfig: rejects non-string system', () => {
  const r = validateApiAdaptersConfig({ version: 1, adapters: { a: { provider: 'anthropic', model: 'm', system: 42 } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('system'));
});

test('validateApiAdaptersConfig: rejects max_tokens > 65536', () => {
  const r = validateApiAdaptersConfig({ version: 1, adapters: { a: { provider: 'anthropic', model: 'm', max_tokens: 100000 } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('max_tokens'));
});

test('validateApiAdaptersConfig: rejects model "   " (whitespace only)', () => {
  const r = validateApiAdaptersConfig({ adapters: { a: { provider: 'anthropic', model: '   ' } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('model'));
});

test('validateApiAdaptersConfig: rejects model " gpt-4.1 " (surrounding whitespace)', () => {
  const r = validateApiAdaptersConfig({ adapters: { a: { provider: 'openai', model: ' gpt-4.1 ' } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('model'));
});

test('validateApiAdaptersConfig: accepts valid config', () => {
  const r = validateApiAdaptersConfig({ version: 1, adapters: { a: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } });
  assert.equal(r.ok, true);
});

test('validateApiAdaptersConfig: rejects fallback_adapter: "" (empty string)', () => {
  const r = validateApiAdaptersConfig({ adapters: { a: { provider: 'anthropic', model: 'm', fallback_adapter: '' } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('fallback_adapter'));
});

test('validateApiAdaptersConfig: rejects fallback_adapter: "  " (whitespace only)', () => {
  const r = validateApiAdaptersConfig({ adapters: { a: { provider: 'anthropic', model: 'm', fallback_adapter: '   ' } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('fallback_adapter'));
});

test('validateApiAdaptersConfig: accepts valid fallback_adapter string', () => {
  const r = validateApiAdaptersConfig({ adapters: { a: { provider: 'anthropic', model: 'm', fallback_adapter: 'claude' } } });
  assert.equal(r.ok, true);
});

test('validateApiAdaptersConfig: rejects fallback_adapter with surrounding whitespace " claude "', () => {
  const r = validateApiAdaptersConfig({ adapters: { a: { provider: 'anthropic', model: 'm', fallback_adapter: ' claude ' } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('fallback_adapter'));
});

test('validateApiAdaptersConfig: rejects unknown adapter field "fallback_adaptor" (typo)', () => {
  const r = validateApiAdaptersConfig({ adapters: { a: { provider: 'anthropic', model: 'm', fallback_adaptor: 'claude' } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('unknown field'));
  assert.ok((r as { detail: string }).detail.includes('fallback_adaptor'));
});

test('validateApiAdaptersConfig: rejects unknown adapter field "timeout_mz" (typo)', () => {
  const r = validateApiAdaptersConfig({ adapters: { a: { provider: 'anthropic', model: 'm', timeout_mz: 30000 } } });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('unknown field'));
  assert.ok((r as { detail: string }).detail.includes('timeout_mz'));
});

test('validateApiAdaptersConfig: rejects unknown top-level field', () => {
  const r = validateApiAdaptersConfig({ version: 1, adapters: {}, extra_field: true });
  assert.equal(r.ok, false);
  assert.ok((r as { detail: string }).detail.includes('extra_field'));
});

test('template contract: every fallback_adapter in api-adapters.json exists in cli-adapters.json', () => {
  const templateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', '.ai');
  const apiAdapters = JSON.parse(fs.readFileSync(path.join(templateDir, 'api-adapters.json'), 'utf8')) as {
    adapters?: Record<string, { fallback_adapter?: string }>;
  };
  const cliAdapters = JSON.parse(fs.readFileSync(path.join(templateDir, 'cli-adapters.json'), 'utf8')) as {
    adapters?: Record<string, unknown>;
  };

  const cliNames = new Set(Object.keys(cliAdapters.adapters ?? {}));
  for (const [name, entry] of Object.entries(apiAdapters.adapters ?? {})) {
    const fb = entry.fallback_adapter;
    if (typeof fb === 'string') {
      assert.ok(cliNames.has(fb), `API adapter "${name}" fallback_adapter "${fb}" is not in templates/.ai/cli-adapters.json`);
    }
  }
});

test('loadApiAdapters: returns null when file absent', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    assert.equal(loadApiAdapters(tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadApiAdapters: returns ok:false on malformed JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    const aiDir = path.join(tmp, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), 'not-json{');
    const r = loadApiAdapters(tmp);
    assert.ok(r !== null);
    assert.equal(r!.ok, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadApiAdapters: returns ok:false on invalid config (unknown provider)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    const aiDir = path.join(tmp, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), JSON.stringify({ adapters: { x: { provider: 'badprovider', model: 'm' } } }));
    const r = loadApiAdapters(tmp);
    assert.ok(r !== null);
    assert.equal(r!.ok, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadApiAdapters: returns valid config', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    const aiDir = path.join(tmp, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), JSON.stringify({
      version: 1,
      adapters: { anthropic: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
    }));
    const r = loadApiAdapters(tmp);
    assert.ok(r !== null && r.ok === true);
    assert.equal(r!.ok && r.config.adapters?.['anthropic']?.model, 'claude-sonnet-4-6');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('callApiAdapter: writes run record on success', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    const aiDir = path.join(tmp, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), JSON.stringify({
      adapters: { anthropic: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
    }));

    process.env.ANTHROPIC_API_KEY = 'test-key';
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
    }), { status: 200 });

    try {
      const artifact = minimalArtifact();
      const { result, record } = await callApiAdapter('anthropic', artifact, '.ai/state/context/T.json', tmp);
      assert.equal(result.ok, true);
      assert.ok(record !== null);
      assert.equal(record!.outcome, 'ok');
      assert.equal(record!.provider, 'anthropic');

      const runsDir = path.join(tmp, '.ai', 'state', 'runs');
      const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json'));
      assert.equal(files.length, 1);
    } finally {
      globalThis.fetch = origFetch;
      delete process.env.ANTHROPIC_API_KEY;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('callApiAdapter: missing adapter config → error result, record is null', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    // No api-adapters.json at all — adapter not found
    const { result, record } = await callApiAdapter('anthropic', minimalArtifact(), '.ai/state/context/T.json', tmp);
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes('not found'));
    assert.equal(record, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('callApiAdapter: "toString" adapter name returns not-found (Object.hasOwn guard)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    fs.mkdirSync(path.join(tmp, '.ai'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.ai', 'api-adapters.json'), JSON.stringify({
      version: 1, adapters: { anthropic: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
    }));
    const { result, record } = await callApiAdapter('toString', minimalArtifact(), '.ai/state/context/T.json', tmp);
    assert.equal(result.ok, false);
    assert.equal(result.error_kind, 'provider');
    assert.ok(result.error?.includes('not found'));
    assert.equal(record, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('callApiAdapter: "constructor" adapter name returns not-found (Object.hasOwn guard)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    fs.mkdirSync(path.join(tmp, '.ai'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.ai', 'api-adapters.json'), JSON.stringify({
      version: 1, adapters: { anthropic: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
    }));
    const { result, record } = await callApiAdapter('constructor', minimalArtifact(), '.ai/state/context/T.json', tmp);
    assert.equal(result.ok, false);
    assert.equal(result.error_kind, 'provider');
    assert.ok(result.error?.includes('not found'));
    assert.equal(record, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('callApiAdapter: invalid config → error result, record is null', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-api-'));
  try {
    const aiDir = path.join(tmp, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), JSON.stringify({ adapters: { x: { provider: 'badprovider', model: 'm' } } }));
    const { result, record } = await callApiAdapter('x', minimalArtifact(), '.ai/state/context/T.json', tmp);
    assert.equal(result.ok, false);
    assert.equal(record, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Router integration tests ───────────────────────────────────────────────────

import { validateArtifact, routeToAdapter } from '../bin/lib/router.js';

function makeValidArtifactFile(dir: string, artifact: CompiledContextArtifact): string {
  const aiDir = path.join(dir, '.ai', 'state', 'context');
  fs.mkdirSync(aiDir, { recursive: true });
  const p = path.join(aiDir, 'TASK.json');
  fs.writeFileSync(p, JSON.stringify(artifact));
  return p;
}

function writeApiAdapters(dir: string, content: unknown): void {
  const aiDir = path.join(dir, '.ai');
  fs.mkdirSync(aiDir, { recursive: true });
  fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), JSON.stringify(content));
}

function writeCliAdapters(dir: string): void {
  // CLI adapter writes a sentinel file when CLI_MARKER env var is set.
  // This lets tests assert CLI ran without capturing stdout (which bypasses
  // process.stdout.write via stdio: ['pipe', 'inherit', 'inherit']).
  const aiDir = path.join(dir, '.ai');
  fs.mkdirSync(aiDir, { recursive: true });
  fs.writeFileSync(path.join(aiDir, 'cli-adapters.json'), JSON.stringify({
    version: 1,
    adapters: {
      fallback: {
        command: process.execPath,
        args: ['-e', "if(process.env.CLI_MARKER)require('fs').writeFileSync(process.env.CLI_MARKER,'1')"],
        input: 'stdin',
      },
    },
  }));
}

test('routeToAdapter: API success → text written to stdout, run record created', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    writeApiAdapters(tmp, { adapters: { myapi: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } });

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'api-success-output' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    }), { status: 200 });

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => { stdoutChunks.push(String(chunk)); return true; };

    process.env.ANTHROPIC_API_KEY = 'test-key';
    try {
      await routeToAdapter(artifact, artifactPath, 'myapi', null, tmp);
    } finally {
      globalThis.fetch = origFetch;
      process.stdout.write = origWrite;
      delete process.env.ANTHROPIC_API_KEY;
    }

    assert.ok(stdoutChunks.join('').includes('api-success-output'));
    const runsDir = path.join(tmp, '.ai', 'state', 'runs');
    const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('routeToAdapter: 429 → CLI fallback runs (marker file written)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    // API adapter named "fallback" — same name as CLI adapter — so 429 triggers fallback
    writeApiAdapters(tmp, { adapters: { fallback: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } });
    writeCliAdapters(tmp);

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => new Response('rate limit', { status: 429 });

    const stderrChunks: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => { stderrChunks.push(String(chunk)); return true; };

    const markerFile = path.join(tmp, 'cli-marker.txt');
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.CLI_MARKER = markerFile;
    const savedExitCode = process.exitCode;
    try {
      await routeToAdapter(artifact, artifactPath, 'fallback', null, tmp);
    } finally {
      globalThis.fetch = origFetch;
      process.stderr.write = origStderr;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLI_MARKER;
      process.exitCode = savedExitCode;
    }

    assert.ok(stderrChunks.join('').includes('quota'), 'should warn about quota');
    assert.ok(fs.existsSync(markerFile), 'CLI fallback must run (marker file must exist)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('routeToAdapter: 401 auth error → exit 1, CLI fallback does NOT run', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    writeApiAdapters(tmp, { adapters: { myapi: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } });
    writeCliAdapters(tmp);

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => new Response('bad key', { status: 401 });

    const stderrChunks: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => { stderrChunks.push(String(chunk)); return true; };

    const markerFile = path.join(tmp, 'cli-marker-auth.txt');
    process.env.ANTHROPIC_API_KEY = 'bad-key';
    process.env.CLI_MARKER = markerFile;
    const savedExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await routeToAdapter(artifact, artifactPath, 'myapi', null, tmp);
    } finally {
      globalThis.fetch = origFetch;
      process.stderr.write = origStderr;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLI_MARKER;
    }

    assert.equal(process.exitCode, 1, 'exit code must be 1 on auth error');
    assert.ok(!fs.existsSync(markerFile), 'CLI fallback must NOT run on auth error');
    process.exitCode = savedExitCode;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('routeToAdapter: same name in API and CLI config → API takes precedence', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    writeApiAdapters(tmp, { adapters: { shared: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } });
    const aiDir = path.join(tmp, '.ai');
    fs.writeFileSync(path.join(aiDir, 'cli-adapters.json'), JSON.stringify({
      version: 1,
      adapters: { shared: { command: process.execPath, args: ['-e', "if(process.env.CLI_MARKER)require('fs').writeFileSync(process.env.CLI_MARKER,'1')"], input: 'stdin' } },
    }));

    const origFetch = globalThis.fetch;
    let apiCalled = false;
    globalThis.fetch = async (): Promise<Response> => {
      apiCalled = true;
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'api-was-called' }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      }), { status: 200 });
    };

    const markerFile = path.join(tmp, 'cli-marker-shared.txt');
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.CLI_MARKER = markerFile;
    try {
      await routeToAdapter(artifact, artifactPath, 'shared', null, tmp);
    } finally {
      globalThis.fetch = origFetch;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLI_MARKER;
    }

    assert.equal(apiCalled, true, 'API adapter must be called');
    assert.ok(!fs.existsSync(markerFile), 'CLI adapter must not run when API adapter is present');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('routeToAdapter: invalid api-adapters.json → fail fast, exit 1', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    writeApiAdapters(tmp, { adapters: { x: { provider: 'badprovider', model: 'm' } } });

    const stderrChunks: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => { stderrChunks.push(String(chunk)); return true; };

    const savedExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await routeToAdapter(artifact, artifactPath, 'x', null, tmp);
    } finally {
      process.stderr.write = origStderr;
    }

    assert.equal(process.exitCode, 1, 'exit code must be 1 on invalid config');
    assert.ok(stderrChunks.join('').toLowerCase().includes('invalid'), 'error message must mention invalid config');
    process.exitCode = savedExitCode;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('routeToAdapter: no API config → CLI adapter runs (marker file written)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-route-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    // No api-adapters.json — only cli-adapters.json
    writeCliAdapters(tmp);

    const markerFile = path.join(tmp, 'cli-marker-noapi.txt');
    process.env.CLI_MARKER = markerFile;
    try {
      await routeToAdapter(artifact, artifactPath, 'fallback', null, tmp);
    } finally {
      delete process.env.CLI_MARKER;
    }

    assert.ok(fs.existsSync(markerFile), 'CLI adapter must run when no API config exists');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Anthropic header test ──────────────────────────────────────────────────────

test('callAnthropic: sends correct headers', async () => {
  let capturedHeaders: Record<string, string> = {};
  const mockFetch = async (_url: string, init: RequestInit): Promise<Response> => {
    capturedHeaders = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    }), { status: 200 });
  };

  process.env.ANTHROPIC_API_KEY = 'hdr-test-key';
  await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(capturedHeaders['x-api-key'], 'hdr-test-key');
  assert.equal(capturedHeaders['anthropic-version'], '2023-06-01');
  assert.equal(capturedHeaders['content-type'], 'application/json');
});

// ── Anthropic empty content test (finding 5) ─────────────────────────────────

test('callAnthropic: content: [] → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    content: [],
    usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0 },
  }), { status: 200 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
  assert.ok(result.error?.includes('no text blocks'));
});

test('callAnthropic: content with only non-text blocks → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    content: [{ type: 'tool_use', id: 'x' }],
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
  }), { status: 200 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

// ── Timeout tests (finding 2) ──────────────────────────────────────────────────

test('callAnthropic: fetch timeout → network error, retryable:true', async () => {
  const timeoutErr = Object.assign(new Error('operation timed out'), { name: 'TimeoutError' });
  const mockFetch = async (): Promise<Response> => { throw timeoutErr; };

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), { ...anthropicConfig(), timeout_ms: 5000 }, mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'network');
  assert.equal(result.retryable, true);
  assert.ok(result.error?.includes('timed out'), `expected "timed out" in "${result.error}"`);
});

test('callOpenAI: fetch timeout → network error, retryable:true', async () => {
  const timeoutErr = Object.assign(new Error('operation timed out'), { name: 'TimeoutError' });
  const mockFetch = async (): Promise<Response> => { throw timeoutErr; };

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), { ...openaiConfig(), timeout_ms: 5000 }, mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'network');
  assert.equal(result.retryable, true);
  assert.ok(result.error?.includes('timed out'), `expected "timed out" in "${result.error}"`);
});

test('callGemini: fetch timeout → network error, retryable:true', async () => {
  const timeoutErr = Object.assign(new Error('operation timed out'), { name: 'TimeoutError' });
  const mockFetch = async (): Promise<Response> => { throw timeoutErr; };

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), { ...geminiConfig(), timeout_ms: 5000 }, mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'network');
  assert.equal(result.retryable, true);
  assert.ok(result.error?.includes('timed out'), `expected "timed out" in "${result.error}"`);
});

// ── Gemini empty text parts tests (finding 3) ─────────────────────────────────

test('callGemini: parts: [{}] → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{}] } }],
  }), { status: 200 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callGemini: parts: [null] → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    candidates: [{ content: { parts: [null] } }],
  }), { status: 200 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

test('callGemini: parts: [] → invalid_response', async () => {
  const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
    candidates: [{ content: { parts: [] } }],
  }), { status: 200 });

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'invalid_response');
});

// ── Body-level timeout tests (finding 4) ──────────────────────────────────────

test('callAnthropic: body read timeout → network error, retryable:true', async () => {
  const timeoutErr = Object.assign(new Error('operation timed out'), { name: 'TimeoutError' });
  const mockFetch = async (): Promise<Response> => ({
    ok: true, status: 200,
    json: () => Promise.reject(timeoutErr),
    text: () => Promise.reject(timeoutErr),
  } as unknown as Response);

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const result = await callAnthropic(minimalArtifact(), anthropicConfig(), mockFetch as typeof fetch);
  delete process.env.ANTHROPIC_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'network');
  assert.equal(result.retryable, true);
  assert.ok(result.error?.includes('timed out'));
});

test('callOpenAI: body read timeout → network error, retryable:true', async () => {
  const timeoutErr = Object.assign(new Error('operation timed out'), { name: 'TimeoutError' });
  const mockFetch = async (): Promise<Response> => ({
    ok: true, status: 200,
    json: () => Promise.reject(timeoutErr),
    text: () => Promise.reject(timeoutErr),
  } as unknown as Response);

  process.env.OPENAI_API_KEY = 'test-key';
  const result = await callOpenAI(minimalArtifact(), openaiConfig(), mockFetch as typeof fetch);
  delete process.env.OPENAI_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'network');
  assert.equal(result.retryable, true);
  assert.ok(result.error?.includes('timed out'));
});

test('callGemini: body read timeout → network error, retryable:true', async () => {
  const timeoutErr = Object.assign(new Error('operation timed out'), { name: 'TimeoutError' });
  const mockFetch = async (): Promise<Response> => ({
    ok: true, status: 200,
    json: () => Promise.reject(timeoutErr),
    text: () => Promise.reject(timeoutErr),
  } as unknown as Response);

  process.env.GOOGLE_API_KEY = 'test-key';
  const result = await callGemini(minimalArtifact(), geminiConfig(), mockFetch as typeof fetch);
  delete process.env.GOOGLE_API_KEY;

  assert.equal(result.ok, false);
  assert.equal(result.error_kind, 'network');
  assert.equal(result.retryable, true);
  assert.ok(result.error?.includes('timed out'));
});

// ── fallback_adapter integration test (finding 2) ────────────────────────────

test('routeToAdapter: 429 with fallback_adapter → named CLI adapter runs, not API adapter name', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-fb-'));
  const artifact = minimalArtifact();
  try {
    const artifactPath = makeValidArtifactFile(tmp, artifact);
    // API adapter "anthropic" → fallback_adapter "claude" (different name)
    writeApiAdapters(tmp, {
      adapters: {
        anthropic: { provider: 'anthropic', model: 'claude-sonnet-4-6', fallback_adapter: 'claude' },
      },
    });
    const aiDir = path.join(tmp, '.ai');
    fs.writeFileSync(path.join(aiDir, 'cli-adapters.json'), JSON.stringify({
      version: 1,
      adapters: {
        claude: {
          command: process.execPath,
          args: ['-e', "if(process.env.CLI_MARKER)require('fs').writeFileSync(process.env.CLI_MARKER,'claude')"],
          input: 'stdin',
        },
        anthropic: {
          command: process.execPath,
          args: ['-e', "if(process.env.CLI_MARKER)require('fs').writeFileSync(process.env.CLI_MARKER,'anthropic-cli')"],
          input: 'stdin',
        },
      },
    }));

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => new Response('rate limit', { status: 429 });

    const stderrChunks: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => { stderrChunks.push(String(chunk)); return true; };

    const markerFile = path.join(tmp, 'cli-marker-fb.txt');
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.CLI_MARKER = markerFile;
    const savedExitCode = process.exitCode;
    try {
      await routeToAdapter(artifact, artifactPath, 'anthropic', null, tmp);
    } finally {
      globalThis.fetch = origFetch;
      process.stderr.write = origStderr;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLI_MARKER;
      process.exitCode = savedExitCode;
    }

    assert.ok(fs.existsSync(markerFile), 'marker file must exist (CLI ran)');
    const written = fs.readFileSync(markerFile, 'utf8');
    assert.equal(written, 'claude', 'fallback_adapter "claude" must run, not "anthropic" CLI');
    assert.ok(stderrChunks.join('').includes("'claude'"), 'warn message must name the fallback adapter');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── validateArgFlag unit tests ────────────────────────────────────────────────

import { validateArgFlag } from '../bin/lib/context.js';

test('validateArgFlag: bare trailing flag → error', () => {
  assert.ok(validateArgFlag('--adapter', ['--route', '--artifact', 'x.json', '--adapter']) !== null);
});

test('validateArgFlag: --flag= empty via equals → error', () => {
  assert.ok(validateArgFlag('--adapter', ['--adapter=']) !== null);
});

test('validateArgFlag: --flag --next-flag (next arg is a flag) → error', () => {
  assert.ok(validateArgFlag('--adapter', ['--adapter', '--model']) !== null);
});

test('validateArgFlag: whitespace-only bare value → error', () => {
  assert.ok(validateArgFlag('--model', ['--model', '   ']) !== null);
});

test('validateArgFlag: equals form value starts with "--" → error', () => {
  assert.ok(validateArgFlag('--model', ['--model=--bad']) !== null);
});

test('validateArgFlag: duplicate flag occurrences → error', () => {
  assert.ok(validateArgFlag('--adapter', ['--adapter', 'claude', '--adapter', 'codex']) !== null);
});

test('validateArgFlag: valid single occurrence bare form → null (ok)', () => {
  assert.equal(validateArgFlag('--adapter', ['--adapter', 'claude']), null);
});

test('validateArgFlag: valid single occurrence equals form → null (ok)', () => {
  assert.equal(validateArgFlag('--model', ['--model=gpt-4.1']), null);
});

test('validateArgFlag: flag absent → null (ok)', () => {
  assert.equal(validateArgFlag('--adapter', ['--route', '--artifact', 'x.json']), null);
});

// ── Model override test (finding 1) ──────────────────────────────────────────

test('callApiAdapter: --model override appears in HTTP body and run record', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-model-'));
  try {
    const aiDir = path.join(tmp, '.ai');
    fs.mkdirSync(aiDir, { recursive: true });
    fs.writeFileSync(path.join(aiDir, 'api-adapters.json'), JSON.stringify({
      adapters: { myapi: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
    }));

    let capturedBody: Record<string, unknown> = {};
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = JSON.parse((init?.body ?? '') as string) as Record<string, unknown>;
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      }), { status: 200 });
    };

    process.env.ANTHROPIC_API_KEY = 'test-key';
    try {
      const { result, record } = await callApiAdapter('myapi', minimalArtifact(), '.ai/state/context/T.json', tmp, 'claude-opus-4-8');
      assert.equal(result.ok, true);
      assert.equal(capturedBody['model'], 'claude-opus-4-8', 'HTTP body must use overridden model');
      assert.equal(record?.model, 'claude-opus-4-8', 'run record must use overridden model');
    } finally {
      globalThis.fetch = origFetch;
      delete process.env.ANTHROPIC_API_KEY;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
