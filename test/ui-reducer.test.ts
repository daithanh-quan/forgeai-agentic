import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer } from '../bin/ui/reducer.js';

const ts = 1_000;

test('initialState returns empty state', () => {
  const s = initialState();
  assert.equal(s.connected, false);
  assert.equal(s.task, null);
  assert.deepEqual(s.agents, {});
  assert.deepEqual(s.logs, []);
  assert.deepEqual(s.checks, {});
});

test('orchestrator.start sets task and connected=true', () => {
  const s = reducer(initialState(), { type: 'orchestrator.start', task: 'Build X', ts });
  assert.equal(s.connected, true);
  assert.equal(s.task, 'Build X');
  assert.equal(s.logs.length, 1);
  assert.ok(s.logs[0]!.text.includes('orchestrator'));
});

test('agent.assigned adds agent with running status', () => {
  const s = reducer(initialState(), {
    type: 'agent.assigned', agentId: 'codex-1', role: 'implementer', task: 'Write auth.ts', ts,
  });
  assert.equal(s.connected, true);
  assert.ok(s.agents['codex-1']);
  assert.equal(s.agents['codex-1']!.status, 'running');
  assert.equal(s.agents['codex-1']!.role, 'implementer');
  assert.equal(s.logs.length, 1);
});

test('agent.progress updates message without adding agent', () => {
  const base = reducer(initialState(), {
    type: 'agent.assigned', agentId: 'codex-1', role: 'implementer', task: 'x', ts,
  });
  const s = reducer(base, {
    type: 'agent.progress', agentId: 'codex-1', message: 'Writing auth.ts...', ts,
  });
  assert.equal(s.agents['codex-1']!.message, 'Writing auth.ts...');
  assert.equal(Object.keys(s.agents).length, 1);
});

test('agent.done marks success and sets doneAt', () => {
  const base = reducer(initialState(), {
    type: 'agent.assigned', agentId: 'codex-1', role: 'implementer', task: 'x', ts,
  });
  const s = reducer(base, { type: 'agent.done', agentId: 'codex-1', status: 'success', ts: ts + 30 });
  assert.equal(s.agents['codex-1']!.status, 'success');
  assert.equal(s.agents['codex-1']!.doneAt, ts + 30);
});

test('agent.done with fail status marks fail', () => {
  const base = reducer(initialState(), {
    type: 'agent.assigned', agentId: 'agy-1', role: 'docs', task: 'x', ts,
  });
  const s = reducer(base, { type: 'agent.done', agentId: 'agy-1', status: 'fail', ts: ts + 10 });
  assert.equal(s.agents['agy-1']!.status, 'fail');
});

test('review.start adds reviewer agent card', () => {
  const s = reducer(initialState(), {
    type: 'review.start', agentId: 'reviewer-1', target: 'codex-1', ts,
  });
  assert.ok(s.agents['reviewer-1']);
  assert.equal(s.agents['reviewer-1']!.role, 'reviewer');
  assert.equal(s.agents['reviewer-1']!.status, 'running');
});

test('review.done marks reviewer done', () => {
  const base = reducer(initialState(), {
    type: 'review.start', agentId: 'reviewer-1', target: 'codex-1', ts,
  });
  const s = reducer(base, { type: 'review.done', agentId: 'reviewer-1', status: 'pass', ts: ts + 5 });
  assert.equal(s.agents['reviewer-1']!.status, 'success');
});

test('check.run sets check to running', () => {
  const s = reducer(initialState(), { type: 'check.run', name: 'security', status: 'running', ts });
  assert.equal(s.checks['security'], 'running');
});

test('check.result sets check to result status', () => {
  const base = reducer(initialState(), { type: 'check.run', name: 'security', status: 'running', ts });
  const s = reducer(base, { type: 'check.result', name: 'security', status: 'pass', ts });
  assert.equal(s.checks['security'], 'pass');
});

test('_clear_log empties log array', () => {
  const base = reducer(initialState(), { type: 'orchestrator.start', task: 'x', ts });
  assert.ok(base.logs.length > 0);
  const s = reducer(base, { type: '_clear_log', ts } as any);
  assert.equal(s.logs.length, 0);
});

test('unknown event type appends warn log entry', () => {
  const s = reducer(initialState(), { type: 'some.unknown.event', ts, raw: 'raw line here' });
  assert.equal(s.logs.length, 1);
  assert.equal(s.logs[0]!.level, 'warn');
});

// Issue 4: log cap
test('logs are capped at 500 entries to prevent unbounded growth', () => {
  let state = initialState();
  for (let i = 0; i < 600; i++) {
    state = reducer(state, { type: 'orchestrator.done', ts: i });
  }
  assert.ok(state.logs.length <= 500, `expected ≤500 logs, got ${state.logs.length}`);
  assert.equal(state.logs.length, 500);
});

test('log cap keeps the most recent entries', () => {
  let state = initialState();
  for (let i = 0; i < 600; i++) {
    state = reducer(state, { type: 'orchestrator.done', status: String(i), ts: i });
  }
  // oldest entries should have been dropped
  assert.ok(state.logs[0]!.ts >= 100, 'earliest retained entry should not be from the very start');
});

// Issue 5: orchestrator agent card
test('orchestrator.start adds orchestrator agent card', () => {
  const s = reducer(initialState(), { type: 'orchestrator.start', task: 'Build X', ts });
  assert.ok(s.agents['orchestrator'], 'orchestrator agent card should exist');
  assert.equal(s.agents['orchestrator']!.role, 'orchestrator');
  assert.equal(s.agents['orchestrator']!.status, 'running');
  assert.equal(s.agents['orchestrator']!.task, 'Build X');
});

test('orchestrator.done marks orchestrator agent done with doneAt', () => {
  const base = reducer(initialState(), { type: 'orchestrator.start', task: 'Build X', ts });
  const s = reducer(base, { type: 'orchestrator.done', status: 'success', ts: ts + 100 });
  assert.equal(s.agents['orchestrator']!.status, 'success');
  assert.equal(s.agents['orchestrator']!.doneAt, ts + 100);
});

// Issue 2 (partial): _disconnected event
test('_disconnected event sets disconnected flag in state', () => {
  const base = reducer(initialState(), { type: 'orchestrator.start', task: 'x', ts });
  const s = reducer(base, { type: '_disconnected', ts } as any);
  assert.equal(s.disconnected, true);
  assert.equal(s.logs[s.logs.length - 1]!.level, 'warn');
});
