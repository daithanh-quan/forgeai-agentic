import assert from 'node:assert/strict';
import test from 'node:test';
import { nowSeconds, runObservedCheck, type CheckEvent, type RunEvent } from '../bin/lib/run-events.js';

test('nowSeconds returns integer epoch seconds', () => {
  const s = nowSeconds();
  assert.ok(Number.isInteger(s));
  assert.ok(Math.abs(s - Date.now() / 1000) < 5);
});

test('RunEvent union shape compiles', () => {
  const e: RunEvent = { type: 'run_start', ts: 1, adapter: 'a', provider: 'anthropic', model: 'm', objective: 'o', budget_tokens: 100 };
  assert.equal(e.type, 'run_start');
});

test('runObservedCheck emits running then pass', () => {
  const events: CheckEvent[] = [];
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    runObservedCheck('security', () => {}, (event) => events.push(event));
  } finally {
    process.exitCode = previousExitCode;
  }
  assert.deepEqual(events.map(({ type, name, status }) => ({ type, name, status })), [
    { type: 'check.run', name: 'security', status: 'running' },
    { type: 'check.result', name: 'security', status: 'pass' },
  ]);
});

test('runObservedCheck emits fail when a check sets a failing exit code', () => {
  const events: CheckEvent[] = [];
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    runObservedCheck('review', () => { process.exitCode = 1; }, (event) => events.push(event));
  } finally {
    process.exitCode = previousExitCode;
  }
  assert.equal(events.at(-1)?.status, 'fail');
});
