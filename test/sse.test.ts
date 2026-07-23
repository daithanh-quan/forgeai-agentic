import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSSE } from '../bin/lib/api-adapters/sse.js';

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}
const enc = (s: string) => new TextEncoder().encode(s);

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of parseSSE(stream)) out.push(d);
  return out;
}

test('parseSSE: single event', async () => {
  assert.deepEqual(await collect(streamFromChunks([enc('data: {"a":1}\n\n')])), ['{"a":1}']);
});

test('parseSSE: JSON frame split across chunks', async () => {
  assert.deepEqual(await collect(streamFromChunks([enc('data: {"a":'), enc('1}\n\n')])), ['{"a":1}']);
});

test('parseSSE: multi-byte UTF-8 split across chunks', async () => {
  const bytes = enc('data: {"t":"é"}\n\n');       // é is 2 bytes
  const cut = bytes.indexOf(enc('é')[0]);          // split inside the é
  assert.deepEqual(await collect(streamFromChunks([bytes.slice(0, cut + 1), bytes.slice(cut + 1)])), ['{"t":"é"}']);
});

test('parseSSE: CRLF delimiters', async () => {
  assert.deepEqual(await collect(streamFromChunks([enc('data: x\r\n\r\ndata: y\r\n\r\n')])), ['x', 'y']);
});

test('parseSSE: comments and multi-line data', async () => {
  assert.deepEqual(await collect(streamFromChunks([enc(': ping\ndata: a\ndata: b\n\n')])), ['a\nb']);
});

test('parseSSE: [DONE] sentinel yielded verbatim', async () => {
  assert.deepEqual(await collect(streamFromChunks([enc('data: [DONE]\n\n')])), ['[DONE]']);
});

test('parseSSE: EOF without trailing blank line still yields', async () => {
  assert.deepEqual(await collect(streamFromChunks([enc('data: {"a":1}')])), ['{"a":1}']);
});
