import assert from 'node:assert/strict';
import test from 'node:test';
import { symbolMatchesObjective } from '../bin/lib/symbol-matching.js';

test('symbol matching recognizes common inflections across identifier conventions', () => {
  for (const [name, term] of [
    ['estimateTokens', 'estimation'], ['stableArtifactEstimate', 'estimation'],
    ['compute_artifact_estimate', 'estimation'], ['HTTPRoute', 'routing'],
    ['detectProjectProfile', 'detection'], ['validatePayload', 'validation'],
    ['parse_request', 'parsing'], ['accessPolicy', 'policies']
  ]) assert.equal(symbolMatchesObjective([name], [term]), true, `${term} should match ${name}`);
});

test('symbol matching preserves existing substring and exact symbol queries', () => {
  assert.equal(symbolMatchesObjective(['runTaskValidation'], ['task']), true);
  assert.equal(symbolMatchesObjective(['runTaskValidation'], ['runtaskvalidation']), true);
  assert.equal(symbolMatchesObjective(['dispatch', 'routeToAdapter'], ['adapter']), true);
});

test('symbol matching does not treat shared short prefixes or synonyms as matches', () => {
  for (const [name, term] of [
    ['status', 'station'], ['run', 'running'], ['log', 'logging'],
    ['route', 'router'], ['compute', 'estimation'], ['encode', 'decode']
  ]) assert.equal(symbolMatchesObjective([name], [term]), false, `${term} should not match ${name}`);
  assert.equal(symbolMatchesObjective(['dispatch'], []), false);
});
