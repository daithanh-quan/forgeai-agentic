import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPipeReader, emitToPipe } from '../bin/ui/pipe.js';

test('pipe reader receives lines emitted by emitToPipe', async () => {
  const pipePath = path.join(os.tmpdir(), `forgeai-test-${Date.now()}`);
  const received: string[] = [];

  const cleanup = createPipeReader(pipePath, (line) => received.push(line));

  emitToPipe(pipePath, '{"type":"agent.assigned","ts":1}');
  emitToPipe(pipePath, '{"type":"agent.done","ts":2}');

  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.deepEqual(received, [
    '{"type":"agent.assigned","ts":1}',
    '{"type":"agent.done","ts":2}',
  ]);

  cleanup();
  assert.ok(!fs.existsSync(pipePath), 'cleanup must remove pipe file');
});

test('emitToPipe throws when pipe does not exist', () => {
  assert.throws(
    () => emitToPipe('/tmp/nonexistent-forgeai.pipe', '{}'),
    /not running/,
  );
});

test('emitToPipe throws descriptive error when FIFO buffer is full and always closes fd', async () => {
  const { O_WRONLY, O_NONBLOCK } = fs.constants;
  const pipePath = path.join(os.tmpdir(), `forgeai-eagain-${Date.now()}`);
  const cleanup = createPipeReader(pipePath, () => {});

  // Fill the kernel FIFO buffer synchronously. The reader socket drains
  // asynchronously — it cannot run between these synchronous writes and the
  // subsequent emitToPipe call (no event-loop tick between them).
  const fillFd = fs.openSync(pipePath, O_WRONLY | O_NONBLOCK);
  const chunk = Buffer.alloc(8192, 65); // 8 KiB of 'A'
  try {
    for (let i = 0; i < 20; i++) {
      try { fs.writeSync(fillFd, chunk); } catch { break; }
    }
  } finally {
    fs.closeSync(fillFd);
  }

  // Before fix: throws raw 'EAGAIN: resource temporarily unavailable' + fd leaks.
  // After fix: throws descriptive 'buffer is full' message + fd closed via finally.
  assert.throws(
    () => emitToPipe(pipePath, '{"type":"test","ts":0}'),
    /buffer is full/,
  );

  cleanup();
});
