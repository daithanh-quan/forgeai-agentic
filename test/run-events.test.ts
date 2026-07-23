import assert from 'node:assert/strict';
import test from 'node:test';
import { nowSeconds, type RunEvent } from '../bin/lib/run-events.js';

test('nowSeconds returns integer epoch seconds', () => {
  const s = nowSeconds();
  assert.ok(Number.isInteger(s));
  assert.ok(Math.abs(s - Date.now() / 1000) < 5);
});

test('RunEvent union shape compiles', () => {
  const e: RunEvent = { type: 'run_start', ts: 1, adapter: 'a', provider: 'anthropic', model: 'm', objective: 'o', budget_tokens: 100 };
  assert.equal(e.type, 'run_start');
});
