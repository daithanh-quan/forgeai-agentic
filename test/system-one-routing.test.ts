import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decideSystemOneRoute, type SystemOneInput } from '../bin/lib/system-one-routing.js';
import { cli, runTs } from './helpers.js';

function input(overrides: Partial<Record<keyof SystemOneInput['signals'], [number, number]>> = {}): SystemOneInput {
  const values: Record<keyof SystemOneInput['signals'], [number, number]> = {
    mechanical: [1, 1],
    bounded_context: [1, 1],
    deterministic_output: [1, 1],
    cheap_verification: [1, 1],
    ambiguous: [0, 1],
    high_risk: [0, 1],
    requires_synthesis: [0, 1],
    ...overrides,
  };
  return { signals: Object.fromEntries(Object.entries(values).map(([name, [probability, confidence]]) => [name, { probability, confidence }])) as SystemOneInput['signals'] };
}

test('routes a certain mechanical task to answer_now', () => {
  const result = decideSystemOneRoute(input());
  assert.equal(result.decision, 'answer_now');
  assert.equal(result.tier, 'direct');
  assert.equal(result.eligibility_lower_bound, 1);
});

test('low signal confidence shrinks probabilities and prevents answer_now', () => {
  const result = decideSystemOneRoute(input({ mechanical: [1, 0.2] }));
  assert.notEqual(result.decision, 'answer_now');
  assert.equal(result.effective_probabilities.mechanical, 0.6);
});

test('risk is a hard veto even when every positive signal is strong', () => {
  const result = decideSystemOneRoute(input({ high_risk: [0.3, 1] }));
  assert.equal(result.decision, 'deliberate');
  assert.ok(result.vetoes.includes('high_risk'));
});

test('rejects malformed probabilities', () => {
  assert.throws(() => decideSystemOneRoute(input({ ambiguous: [1.1, 1] })), /0 to 1/);
});

test('CLI emits a typed answer_now decision from a signals file', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-system-one-'));
  try {
    fs.writeFileSync(path.join(target, 'signals.json'), JSON.stringify(input()));
    const result = JSON.parse(runTs(cli, ['--skip-update-check', '--system-one-route', '--signals', 'signals.json'], { cwd: target })) as Record<string, unknown>;
    assert.equal(result['schema_version'], 1);
    assert.equal(result['decision'], 'answer_now');
    assert.equal(result['tier'], 'direct');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
