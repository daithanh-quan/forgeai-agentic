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
