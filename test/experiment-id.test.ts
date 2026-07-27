import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidExperimentId } from '../bin/lib/utils.js';

test('isValidExperimentId accepts a well-formed id', () => {
  assert.equal(isValidExperimentId('EXP-20260727-router-refactor'), true);
  assert.equal(isValidExperimentId('EXP-20260727-a'), true);
});

test('isValidExperimentId rejects placeholders, empties, and malformed ids', () => {
  assert.equal(isValidExperimentId('EXP-YYYYMMDD-short-slug'), false);
  assert.equal(isValidExperimentId('EXP-...'), false);
  assert.equal(isValidExperimentId(''), false);
  assert.equal(isValidExperimentId('TASK-20260727-x'), false);
  assert.equal(isValidExperimentId('EXP-2026-x'), false);
  assert.equal(isValidExperimentId('EXP-20260727-Upper'), false);
});
